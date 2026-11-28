package api

import (
	"bytes"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gehbfarr5/englishpod-trancy-player-public/sync_server/internal/auth"
	"github.com/gehbfarr5/englishpod-trancy-player-public/sync_server/internal/config"
	"github.com/gehbfarr5/englishpod-trancy-player-public/sync_server/internal/ratelimit"
	"github.com/gehbfarr5/englishpod-trancy-player-public/sync_server/internal/store"
)

type testEnv struct {
	srv *Server
	st  *store.Store
	now time.Time
}

func newTestEnv(t *testing.T, gatewaySecret string) *testEnv {
	t.Helper()
	env := &testEnv{
		now: time.UnixMilli(1795400000000),
	}
	nowFn := func() time.Time { return env.now }

	st, err := store.Open(":memory:", nowFn)
	if err != nil {
		t.Fatalf("store.Open error: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })

	cidrs, _ := config.ParseCIDRs([]string{"127.0.0.1/32"})
	cfg := config.Config{
		GatewaySecret:      gatewaySecret,
		CORSOrigins:        []string{"*"},
		TrustedProxyCIDRs:  cidrs,
		MaxDevicesPerGroup: 10,
		PairTTL:            5 * time.Minute,
		MaxBodyBytes:       64 * 1024,
	}
	lim := ratelimit.New(nowFn)
	env.st = st
	env.srv = NewServer(cfg, st, lim, nowFn, log.New(io.Discard, "", 0))
	return env
}

func (e *testEnv) do(t *testing.T, method, path, token, remoteIP string, body any, extraHeaders map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	var raw []byte
	if body != nil {
		switch v := body.(type) {
		case string:
			raw = []byte(v)
		case []byte:
			raw = v
		default:
			var err error
			raw, err = json.Marshal(v)
			if err != nil {
				t.Fatalf("json.Marshal error: %v", err)
			}
		}
	}

	req := httptest.NewRequest(method, path, bytes.NewReader(raw))
	req.RemoteAddr = remoteIP + ":50000"
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for k, v := range extraHeaders {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	e.srv.ServeHTTP(rec, req)
	return rec
}

func decodeMap(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode response JSON (%d %s): %v", rec.Code, rec.Body.String(), err)
	}
	if _, ok := out["serverTimeMs"]; !ok {
		t.Fatalf("response missing serverTimeMs: %s", rec.Body.String())
	}
	return out
}

func TestEndToEndPairingSyncAndRevokeHTTP(t *testing.T) {
	env := newTestEnv(t, "")

	// Health & CORS preflight
	preflight := env.do(t, http.MethodOptions, "/api/sync/v1/sync/pull", "", "203.0.113.10", nil, map[string]string{
		"Origin": "https://example.com",
	})
	if preflight.Code != http.StatusNoContent || preflight.Header().Get("Access-Control-Allow-Origin") != "*" {
		t.Fatalf("CORS preflight unexpected: code=%d headers=%v", preflight.Code, preflight.Header())
	}

	health := env.do(t, http.MethodGet, "/healthz", "", "203.0.113.10", nil, nil)
	if health.Code != http.StatusOK {
		t.Fatalf("/healthz = %d", health.Code)
	}

	// SYNC-01: A creates group + baseline push
	recCreate := env.do(t, http.MethodPost, "/api/sync/v1/pair/create", "", "203.0.113.10", map[string]any{
		"deviceName": "iPhone 17",
		"platform":   "ios",
	}, nil)
	if recCreate.Code != http.StatusOK {
		t.Fatalf("pair/create failed: %d %s", recCreate.Code, recCreate.Body.String())
	}
	createData := decodeMap(t, recCreate)
	tokenA := createData["deviceToken"].(string)
	code := createData["code"].(string)
	devAID := createData["deviceId"].(string)

	recPushA := env.do(t, http.MethodPost, "/api/sync/v1/sync/push", tokenA, "203.0.113.10", map[string]any{
		"lessons": []map[string]any{
			{
				"lessonId":        "0010",
				"lessonCompleted": true,
				"pb": map[string]any{
					"positionMs":   500000,
					"segmentIndex": 40,
					"durationMs":   520000,
					"updatedAtMs":  env.now.UnixMilli(),
					"baseSeq":      0,
				},
			},
		},
		"lastOpened": map[string]any{
			"lessonId":    "0010",
			"updatedAtMs": env.now.UnixMilli(),
			"baseSeq":     0,
		},
	}, nil)
	if recPushA.Code != http.StatusOK {
		t.Fatalf("push A failed: %d %s", recPushA.Code, recPushA.Body.String())
	}

	// SYNC-02: B (Tesla Web) enters lowercase/unhyphenated code -> direct bind
	recClaim := env.do(t, http.MethodPost, "/api/sync/v1/pair/claim", "", "203.0.113.11", map[string]any{
		"code":       strings.ToLower(code),
		"deviceName": "Tesla Web",
		"platform":   "web",
	}, nil)
	if recClaim.Code != http.StatusOK {
		t.Fatalf("pair/claim failed: %d %s", recClaim.Code, recClaim.Body.String())
	}
	claimData := decodeMap(t, recClaim)
	tokenB := claimData["deviceToken"].(string)
	devBID := claimData["deviceId"].(string)

	// A polls /pair/status and sees consumed + Tesla Web
	recStatus := env.do(t, http.MethodGet, "/api/sync/v1/pair/status?code="+code, tokenA, "203.0.113.10", nil, nil)
	if recStatus.Code != http.StatusOK {
		t.Fatalf("pair/status failed: %d %s", recStatus.Code, recStatus.Body.String())
	}
	statusData := decodeMap(t, recStatus)
	if statusData["status"] != "consumed" {
		t.Fatalf("pair/status = %v, want consumed", statusData["status"])
	}

	// B pushes its own historical lesson 0012, then pulls since_seq=0
	env.now = env.now.Add(2 * time.Second)
	recPushB := env.do(t, http.MethodPost, "/api/sync/v1/sync/push", tokenB, "203.0.113.11", map[string]any{
		"lessons": []map[string]any{
			{
				"lessonId":        "0012",
				"lessonCompleted": false,
				"pb": map[string]any{
					"positionMs":  180000,
					"updatedAtMs": env.now.UnixMilli(),
					"baseSeq":     1,
				},
			},
		},
	}, nil)
	if recPushB.Code != http.StatusOK {
		t.Fatalf("push B failed: %d %s", recPushB.Code, recPushB.Body.String())
	}

	recPullB := env.do(t, http.MethodGet, "/api/sync/v1/sync/pull?since_seq=0", tokenB, "203.0.113.11", nil, nil)
	if recPullB.Code != http.StatusOK {
		t.Fatalf("pull B failed: %d", recPullB.Code)
	}
	pullData := decodeMap(t, recPullB)
	if lessonsArr := pullData["lessons"].([]any); len(lessonsArr) != 2 {
		t.Fatalf("expected 2 merged lessons on pull, got %d", len(lessonsArr))
	}

	// Rename B and list devices
	recRename := env.do(t, http.MethodPatch, "/api/sync/v1/devices/me", tokenB, "203.0.113.11", map[string]any{
		"deviceName": "Model 3 Browser",
	}, nil)
	if recRename.Code != http.StatusOK {
		t.Fatalf("rename failed: %d %s", recRename.Code, recRename.Body.String())
	}
	recList := env.do(t, http.MethodGet, "/api/sync/v1/devices", tokenA, "203.0.113.10", nil, nil)
	if recList.Code != http.StatusOK || !strings.Contains(recList.Body.String(), "Model 3 Browser") {
		t.Fatalf("devices list unexpected: %d %s", recList.Code, recList.Body.String())
	}

	// SYNC-13: A revokes B -> B gets 401 DEVICE_REVOKED
	recRevoke := env.do(t, http.MethodDelete, "/api/sync/v1/devices/"+devBID, tokenA, "203.0.113.10", nil, nil)
	if recRevoke.Code != http.StatusOK {
		t.Fatalf("revoke failed: %d %s", recRevoke.Code, recRevoke.Body.String())
	}
	recPullRevoked := env.do(t, http.MethodGet, "/api/sync/v1/sync/pull?since_seq=0", tokenB, "203.0.113.11", nil, nil)
	if recPullRevoked.Code != http.StatusUnauthorized {
		t.Fatalf("revoked device pull code = %d, want 401", recPullRevoked.Code)
	}
	errObj := decodeMap(t, recPullRevoked)["error"].(map[string]any)
	if errObj["code"] != "DEVICE_REVOKED" {
		t.Fatalf("revoked error code = %v, want DEVICE_REVOKED", errObj["code"])
	}

	// A can also revoke self using /devices/me
	recSelfRevoke := env.do(t, http.MethodDelete, "/api/sync/v1/devices/me", tokenA, "203.0.113.10", nil, nil)
	if recSelfRevoke.Code != http.StatusOK || !strings.Contains(recSelfRevoke.Body.String(), devAID) {
		t.Fatalf("self revoke failed: %d %s", recSelfRevoke.Code, recSelfRevoke.Body.String())
	}
}

func TestGatewayRateLimitIsolationAndValidationGuards(t *testing.T) {
	secret := "gateway-shared-secret"
	env := newTestEnv(t, secret)

	claimViaGateway := func(subject string, code string) *httptest.ResponseRecorder {
		bodyBytes, _ := json.Marshal(map[string]any{
			"code":       code,
			"deviceName": "WeChat",
			"platform":   "wechat",
		})
		ts := "1795400000000"
		sig := auth.ComputeGatewaySignature(secret, http.MethodPost, "/api/sync/v1/pair/claim", ts, subject, bodyBytes)
		// Both mini-program users share the same CloudBase NAT IP 198.51.100.1!
		return env.do(t, http.MethodPost, "/api/sync/v1/pair/claim", "", "198.51.100.1", bodyBytes, map[string]string{
			"X-Gateway-Timestamp": ts,
			"X-Gateway-Subject":   subject,
			"X-Gateway-Signature": sig,
		})
	}

	// SYNC-04: User 1 exhausts 5 claim attempts in 1m -> 6th returns 429 RATE_LIMITED
	for i := 0; i < 5; i++ {
		rec := claimViaGateway("wechat_user_1", "K7M9-P2XR")
		if rec.Code != http.StatusNotFound {
			t.Fatalf("attempt %d code = %d, want 404", i+1, rec.Code)
		}
	}
	recLimited := claimViaGateway("wechat_user_1", "K7M9-P2XR")
	if recLimited.Code != http.StatusTooManyRequests {
		t.Fatalf("6th attempt code = %d, want 429", recLimited.Code)
	}

	// User 2 via same NAT IP must NOT be affected.
	recUser2 := claimViaGateway("wechat_user_2", "K7M9-P2XR")
	if recUser2.Code != http.StatusNotFound {
		t.Fatalf("user 2 on shared NAT IP was affected by user 1 rate limit: %d", recUser2.Code)
	}

	// Spoofed X-Gateway-Subject without valid signature falls back to IP limit.
	for i := 0; i < 5; i++ {
		_ = env.do(t, http.MethodPost, "/api/sync/v1/pair/claim", "", "198.51.100.99", map[string]any{
			"code":     "K7M9-P2XR",
			"platform": "web",
		}, map[string]string{
			"X-Gateway-Timestamp": "1795400000000",
			"X-Gateway-Subject":   "spoofed_subject_" + string(rune('a'+i)),
			"X-Gateway-Signature": "deadbeef",
		})
	}
	recSpoof := env.do(t, http.MethodPost, "/api/sync/v1/pair/claim", "", "198.51.100.99", map[string]any{
		"code":     "K7M9-P2XR",
		"platform": "web",
	}, map[string]string{
		"X-Gateway-Timestamp": "1795400000000",
		"X-Gateway-Subject":   "spoofed_subject_z",
		"X-Gateway-Signature": "deadbeef",
	})
	if recSpoof.Code != http.StatusTooManyRequests {
		t.Fatalf("spoofed gateway headers bypassed IP rate limit: %d", recSpoof.Code)
	}

	// SYNC-15: Invalid lesson ID and >64 KB payload rejected
	recCreate := env.do(t, http.MethodPost, "/api/sync/v1/pair/create", "", "203.0.113.20", map[string]any{
		"deviceName": "iPad",
		"platform":   "ipad",
	}, nil)
	token := decodeMap(t, recCreate)["deviceToken"].(string)

	recBadLesson := env.do(t, http.MethodPost, "/api/sync/v1/sync/push", token, "203.0.113.20", map[string]any{
		"lessons": []map[string]any{{"lessonId": "0125", "lessonCompleted": true}},
	}, nil)
	if recBadLesson.Code != http.StatusBadRequest {
		t.Fatalf("invalid lesson 0125 code = %d, want 400", recBadLesson.Code)
	}

	hugePayload := `{"lessons":[],"padding":"` + strings.Repeat("a", 70*1024) + `"}`
	recHuge := env.do(t, http.MethodPost, "/api/sync/v1/sync/push", token, "203.0.113.20", hugePayload, nil)
	if recHuge.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized payload code = %d, want 413", recHuge.Code)
	}
}

func TestPlanASmartGroupMergeHTTP(t *testing.T) {
	env := newTestEnv(t, "")

	// Group 1: HarmonyOS + iPhone
	r1 := decodeMap(t, env.do(t, http.MethodPost, "/api/sync/v1/pair/create", "", "203.0.113.30", map[string]any{
		"deviceName": "HUAWEI Pura X View",
		"platform":   "harmonyos",
	}, nil))
	tokenH := r1["deviceToken"].(string)
	code1 := r1["code"].(string)

	r2 := decodeMap(t, env.do(t, http.MethodPost, "/api/sync/v1/pair/claim", "", "203.0.113.31", map[string]any{
		"code":       code1,
		"deviceName": "iPhone 17",
		"platform":   "ios",
	}, nil))
	tokenI := r2["deviceToken"].(string)

	// Group 2: iPad shows QR
	r3 := decodeMap(t, env.do(t, http.MethodPost, "/api/sync/v1/pair/create", "", "203.0.113.32", map[string]any{
		"deviceName": "iPad 10",
		"platform":   "ipad",
	}, nil))
	codePad := r3["code"].(string)

	// HarmonyOS scans iPad's QR with Bearer tokenH -> smart merge into 3-device group.
	recMerge := env.do(t, http.MethodPost, "/api/sync/v1/pair/claim", tokenH, "203.0.113.30", map[string]any{
		"code":       codePad,
		"deviceName": "HUAWEI Pura X View",
		"platform":   "harmonyos",
	}, nil)
	if recMerge.Code != http.StatusOK {
		t.Fatalf("smart merge HTTP failed: %d %s", recMerge.Code, recMerge.Body.String())
	}
	mergeData := decodeMap(t, recMerge)
	if mergeData["merged"] != true {
		t.Fatalf("expected merged=true, got %+v", mergeData)
	}
	devices := mergeData["devices"].([]any)
	if len(devices) != 3 {
		t.Fatalf("expected 3 devices after merge, got %d", len(devices))
	}

	// iPhone 17 still sees all 3 devices with its original token.
	recListI := env.do(t, http.MethodGet, "/api/sync/v1/devices", tokenI, "203.0.113.31", nil, nil)
	if recListI.Code != http.StatusOK || len(decodeMap(t, recListI)["devices"].([]any)) != 3 {
		t.Fatalf("iPhone 17 devices after merge unexpected: %d %s", recListI.Code, recListI.Body.String())
	}
}

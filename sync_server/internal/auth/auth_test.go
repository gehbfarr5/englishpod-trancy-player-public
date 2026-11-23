package auth

import (
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPairingCodeGenerationAndNormalization(t *testing.T) {
	seen := make(map[string]struct{}, 200)
	for i := 0; i < 200; i++ {
		code, err := GeneratePairingCode()
		if err != nil {
			t.Fatalf("GeneratePairingCode() error: %v", err)
		}
		if len(code) != PairingCodeLength {
			t.Fatalf("len(code) = %d, want %d", len(code), PairingCodeLength)
		}
		if strings.ContainsAny(code, "0O1IL") {
			t.Fatalf("code %q contains forbidden ambiguous character", code)
		}
		seen[code] = struct{}{}

		display := FormatDisplayCode(code)
		if len(display) != 9 || display[4] != '-' {
			t.Fatalf("FormatDisplayCode(%q) = %q", code, display)
		}

		qr := BuildQRPayload(code)
		for _, variant := range []string{code, strings.ToLower(display), "  " + display + " ", qr} {
			got, err := NormalizePairingCode(variant)
			if err != nil || got != code {
				t.Fatalf("NormalizePairingCode(%q) = (%q, %v), want (%q, nil)", variant, got, err, code)
			}
		}
	}
	if len(seen) < 190 {
		t.Fatalf("unexpectedly low uniqueness across 200 generated codes: %d", len(seen))
	}

	invalid := []string{
		"",
		"K7M9P2X",         // too short
		"K7M9P2XRA",       // too long
		"K7M0P2XR",        // forbidden '0'
		"K7MOP2XR",        // forbidden 'O'
		"K7M1P2XR",        // forbidden '1'
		"K7MIP2XR",        // forbidden 'I'
		"K7MLP2XR",        // forbidden 'L'
		"https://evil/c=K7M9P2XR",
		"epsync://v2/pair?c=K7M9P2XR",
		"epsync://v1/other?c=K7M9P2XR",
	}
	for _, raw := range invalid {
		if _, err := NormalizePairingCode(raw); err == nil {
			t.Errorf("NormalizePairingCode(%q) succeeded, want error", raw)
		}
	}
}

func TestDeviceTokenAndSanitizeDeviceName(t *testing.T) {
	tok, err := GenerateDeviceToken()
	if err != nil || len(tok) != 64 {
		t.Fatalf("GenerateDeviceToken() = (%q, %v)", tok, err)
	}
	uuid, err := GenerateUUIDv4()
	if err != nil || len(uuid) != 36 || uuid[14] != '4' {
		t.Fatalf("GenerateUUIDv4() = (%q, %v)", uuid, err)
	}

	if got := SanitizeDeviceName("  <script>iPhone\x00  17</script>  ", "ios"); got != "scriptiPhone 17/script" {
		t.Fatalf("SanitizeDeviceName unexpected result: %q", got)
	}
	if got := SanitizeDeviceName("   <>&\"'\n\t ", "wechat"); got != "WeChat Mini Program" {
		t.Fatalf("SanitizeDeviceName fallback = %q", got)
	}
	long := strings.Repeat("中", 40)
	if got := []rune(SanitizeDeviceName(long, "web")); len(got) != 32 {
		t.Fatalf("SanitizeDeviceName rune truncation len = %d, want 32", len(got))
	}
}

func TestVerifyGatewayRequest(t *testing.T) {
	now := time.UnixMilli(1795400000000)
	secret := "super-secret-gateway-key"
	body := []byte(`{"code":"K7M9-P2XR","platform":"wechat"}`)
	subject := "9f86d081884c7d659a2feaa0c55ad015"
	ts := "1795400005000"
	sig := ComputeGatewaySignature(secret, "POST", "/api/sync/v1/pair/claim", ts, subject, body)

	headers := http.Header{}
	headers.Set("X-Gateway-Timestamp", ts)
	headers.Set("X-Gateway-Subject", subject)
	headers.Set("X-Gateway-Signature", sig)

	gotSubject, ok := VerifyGatewayRequest(secret, now, "POST", "/api/sync/v1/pair/claim", headers, body)
	if !ok || gotSubject != subject {
		t.Fatalf("VerifyGatewayRequest() = (%q, %v), want (%q, true)", gotSubject, ok, subject)
	}

	// Tampered body fails.
	if _, ok := VerifyGatewayRequest(secret, now, "POST", "/api/sync/v1/pair/claim", headers, []byte(`{}`)); ok {
		t.Fatalf("tampered body passed gateway verification")
	}

	// Expired timestamp fails.
	expiredHeaders := headers.Clone()
	expiredHeaders.Set("X-Gateway-Timestamp", "1795399900000")
	if _, ok := VerifyGatewayRequest(secret, now, "POST", "/api/sync/v1/pair/claim", expiredHeaders, body); ok {
		t.Fatalf("expired timestamp passed gateway verification")
	}

	// Spoofed header with empty server secret fails.
	if _, ok := VerifyGatewayRequest("", now, "POST", "/api/sync/v1/pair/claim", headers, body); ok {
		t.Fatalf("empty server secret trusted gateway headers")
	}
}

func TestExtractClientIP(t *testing.T) {
	_, loopbackNet, _ := net.ParseCIDR("127.0.0.1/32")
	trusted := []*net.IPNet{loopbackNet}

	reqTrusted := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	reqTrusted.RemoteAddr = "127.0.0.1:54321"
	reqTrusted.Header.Set("X-Forwarded-For", "203.0.113.9, 10.0.0.1")
	if got := ExtractClientIP(reqTrusted, trusted); got != "203.0.113.9" {
		t.Fatalf("ExtractClientIP(trusted) = %q, want 203.0.113.9", got)
	}

	reqUntrusted := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	reqUntrusted.RemoteAddr = "198.51.100.77:54321"
	reqUntrusted.Header.Set("X-Forwarded-For", "203.0.113.9")
	reqUntrusted.Header.Set("X-Real-IP", "203.0.113.9")
	if got := ExtractClientIP(reqUntrusted, trusted); got != "198.51.100.77" {
		t.Fatalf("ExtractClientIP(untrusted) = %q, want 198.51.100.77", got)
	}
}

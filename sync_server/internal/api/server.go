// Package api exposes the EP-SYNC-001 v1.0 HTTP handlers and middleware.
package api

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gehbfarr5/englishpod-trancy-player-public/sync_server/internal/auth"
	"github.com/gehbfarr5/englishpod-trancy-player-public/sync_server/internal/config"
	"github.com/gehbfarr5/englishpod-trancy-player-public/sync_server/internal/ratelimit"
	"github.com/gehbfarr5/englishpod-trancy-player-public/sync_server/internal/store"
)

// Server serves /healthz and /api/sync/v1/* endpoints.
type Server struct {
	cfg     config.Config
	store   *store.Store
	limiter *ratelimit.Limiter
	now     func() time.Time
	logger  *log.Logger
	handler http.Handler
}

type errorDetail struct {
	Code          string `json:"code"`
	Message       string `json:"message"`
	RetryAfterSec int    `json:"retryAfterSec,omitempty"`
}

type errorEnvelope struct {
	ServerTimeMs int64       `json:"serverTimeMs"`
	Error        errorDetail `json:"error"`
}

// NewServer constructs the HTTP router wrapped with CORS middleware.
func NewServer(cfg config.Config, st *store.Store, lim *ratelimit.Limiter, now func() time.Time, logger *log.Logger) *Server {
	if now == nil {
		now = time.Now
	}
	if logger == nil {
		logger = log.Default()
	}
	if cfg.MaxBodyBytes <= 0 {
		cfg.MaxBodyBytes = config.DefaultMaxBodyBytes
	}

	s := &Server{
		cfg:     cfg,
		store:   st,
		limiter: lim,
		now:     now,
		logger:  logger,
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", s.handleHealth)
	mux.HandleFunc("POST /api/sync/v1/pair/create", s.handlePairCreate)
	mux.HandleFunc("GET /api/sync/v1/pair/status", s.handlePairStatus)
	mux.HandleFunc("POST /api/sync/v1/pair/claim", s.handlePairClaim)
	mux.HandleFunc("POST /api/sync/v1/sync/push", s.handleSyncPush)
	mux.HandleFunc("GET /api/sync/v1/sync/pull", s.handleSyncPull)
	mux.HandleFunc("GET /api/sync/v1/devices", s.handleListDevices)
	mux.HandleFunc("PATCH /api/sync/v1/devices/me", s.handleRenameDevice)
	mux.HandleFunc("DELETE /api/sync/v1/devices/{deviceId}", s.handleRevokeDevice)

	s.handler = s.withCORS(mux)
	return s
}

// ServeHTTP dispatches incoming HTTP requests.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.handler.ServeHTTP(w, r)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Ping(r.Context()); err != nil {
		s.writeError(w, http.StatusServiceUnavailable, "DB_UNAVAILABLE", "database ping failed", 0)
		return
	}
	s.writeJSON(w, http.StatusOK, map[string]any{
		"ok":           true,
		"serverTimeMs": s.now().UnixMilli(),
	})
}

func (s *Server) handlePairCreate(w http.ResponseWriter, r *http.Request) {
	body, ok := s.readBodyLimited(w, r)
	if !ok {
		return
	}
	subject := s.resolveRateSubject(r, body)

	var existing *store.AuthenticatedDevice
	if rawAuth := strings.TrimSpace(r.Header.Get("Authorization")); rawAuth != "" {
		dev, ok := s.authenticateHeader(w, r, rawAuth)
		if !ok {
			return
		}
		existing = dev
	}

	var req struct {
		DeviceName string `json:"deviceName"`
		Platform   string `json:"platform"`
	}
	if len(strings.TrimSpace(string(body))) > 0 {
		if err := json.Unmarshal(body, &req); err != nil {
			s.writeError(w, http.StatusBadRequest, "INVALID_JSON", "malformed JSON request body", 0)
			return
		}
	}
	if existing == nil && !auth.IsValidPlatform(req.Platform) {
		s.writeError(w, http.StatusBadRequest, "INVALID_PLATFORM", "unsupported or missing device platform", 0)
		return
	}

	if allowed, retry := s.limiter.AllowCreate(subject); !allowed {
		s.writeRateLimited(w, retry)
		return
	}

	platform := req.Platform
	if existing != nil && platform == "" {
		platform = existing.Platform
	}

	res, err := s.store.CreatePairingTicket(r.Context(), existing, req.DeviceName, platform, s.cfg.PairTTL)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	s.writeJSON(w, http.StatusOK, struct {
		ServerTimeMs int64 `json:"serverTimeMs"`
		*store.CreatePairResult
	}{
		ServerTimeMs:     s.now().UnixMilli(),
		CreatePairResult: res,
	})
}

func (s *Server) handlePairStatus(w http.ResponseWriter, r *http.Request) {
	dev, ok := s.authenticateRequest(w, r)
	if !ok {
		return
	}
	// Verify optional gateway signature only for consistency; status polling stays lightweight.
	code, err := auth.NormalizePairingCode(r.URL.Query().Get("code"))
	if err != nil {
		s.writeError(w, http.StatusBadRequest, "INVALID_CODE", "invalid pairing code format", 0)
		return
	}

	res, err := s.store.GetPairingStatus(r.Context(), dev, code)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	s.writeJSON(w, http.StatusOK, struct {
		ServerTimeMs int64 `json:"serverTimeMs"`
		*store.PairingStatusResult
	}{
		ServerTimeMs:        s.now().UnixMilli(),
		PairingStatusResult: res,
	})
}

func (s *Server) handlePairClaim(w http.ResponseWriter, r *http.Request) {
	body, ok := s.readBodyLimited(w, r)
	if !ok {
		return
	}
	subject := s.resolveRateSubject(r, body)

	if allowed, retry := s.limiter.AllowClaim(subject); !allowed {
		s.writeRateLimited(w, retry)
		return
	}

	var req struct {
		Code       string `json:"code"`
		DeviceName string `json:"deviceName"`
		Platform   string `json:"platform"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		s.limiter.RecordClaimFailure(subject)
		s.writeError(w, http.StatusBadRequest, "INVALID_JSON", "malformed JSON request body", 0)
		return
	}

	code, err := auth.NormalizePairingCode(req.Code)
	if err != nil {
		s.limiter.RecordClaimFailure(subject)
		s.writeError(w, http.StatusBadRequest, "INVALID_CODE", "invalid pairing code format", 0)
		return
	}
	if !auth.IsValidPlatform(req.Platform) {
		s.writeError(w, http.StatusBadRequest, "INVALID_PLATFORM", "unsupported or missing device platform", 0)
		return
	}

	// Optional caller authentication for Plan A smart group merge:
	// If the scanning device already belongs to a sync group, pass it to the store so the
	// two groups merge atomically without disconnecting existing peer devices.
	// If the caller's old token is stale/revoked, fall back gracefully to a fresh join.
	var existingCaller *store.AuthenticatedDevice
	if rawAuth := strings.TrimSpace(r.Header.Get("Authorization")); rawAuth != "" {
		if token, ok := parseBearerToken(rawAuth); ok {
			if dev, authErr := s.store.AuthenticateDevice(r.Context(), token); authErr == nil {
				existingCaller = dev
			}
		}
	}

	res, err := s.store.ClaimPairingTicket(r.Context(), existingCaller, code, req.DeviceName, req.Platform, s.cfg.MaxDevicesPerGroup)
	if err != nil {
		if errors.Is(err, store.ErrCodeNotFound) || errors.Is(err, store.ErrCodeExpired) || errors.Is(err, store.ErrCodeUsed) {
			s.limiter.RecordClaimFailure(subject)
		}
		s.writeStoreError(w, err)
		return
	}

	s.limiter.RecordClaimSuccess(subject)
	s.writeJSON(w, http.StatusOK, struct {
		ServerTimeMs int64 `json:"serverTimeMs"`
		*store.ClaimPairResult
	}{
		ServerTimeMs:    s.now().UnixMilli(),
		ClaimPairResult: res,
	})
}

func (s *Server) handleSyncPush(w http.ResponseWriter, r *http.Request) {
	body, ok := s.readBodyLimited(w, r)
	if !ok {
		return
	}
	dev, ok := s.authenticateRequest(w, r)
	if !ok {
		return
	}
	if allowed, retry := s.limiter.AllowSync(dev.DeviceID); !allowed {
		s.writeRateLimited(w, retry)
		return
	}

	var req store.PushRequest
	if err := json.Unmarshal(body, &req); err != nil {
		s.writeError(w, http.StatusBadRequest, "INVALID_JSON", "malformed JSON request body", 0)
		return
	}

	res, err := s.store.Push(r.Context(), dev, req)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	s.writeJSON(w, http.StatusOK, struct {
		ServerTimeMs int64 `json:"serverTimeMs"`
		*store.PushResult
	}{
		ServerTimeMs: s.now().UnixMilli(),
		PushResult:   res,
	})
}

func (s *Server) handleSyncPull(w http.ResponseWriter, r *http.Request) {
	dev, ok := s.authenticateRequest(w, r)
	if !ok {
		return
	}
	if allowed, retry := s.limiter.AllowSync(dev.DeviceID); !allowed {
		s.writeRateLimited(w, retry)
		return
	}

	var sinceSeq int64
	if raw := strings.TrimSpace(r.URL.Query().Get("since_seq")); raw != "" {
		v, err := strconv.ParseInt(raw, 10, 64)
		if err != nil || v < 0 {
			s.writeError(w, http.StatusBadRequest, "INVALID_QUERY", "since_seq must be a non-negative integer", 0)
			return
		}
		sinceSeq = v
	}

	res, err := s.store.Pull(r.Context(), dev, sinceSeq)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	s.writeJSON(w, http.StatusOK, struct {
		ServerTimeMs int64 `json:"serverTimeMs"`
		*store.PullResult
	}{
		ServerTimeMs: s.now().UnixMilli(),
		PullResult:   res,
	})
}

func (s *Server) handleListDevices(w http.ResponseWriter, r *http.Request) {
	dev, ok := s.authenticateRequest(w, r)
	if !ok {
		return
	}
	if allowed, retry := s.limiter.AllowSync(dev.DeviceID); !allowed {
		s.writeRateLimited(w, retry)
		return
	}

	devices, err := s.store.ListDevices(r.Context(), dev)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	s.writeJSON(w, http.StatusOK, map[string]any{
		"serverTimeMs": s.now().UnixMilli(),
		"devices":      devices,
	})
}

func (s *Server) handleRenameDevice(w http.ResponseWriter, r *http.Request) {
	body, ok := s.readBodyLimited(w, r)
	if !ok {
		return
	}
	dev, ok := s.authenticateRequest(w, r)
	if !ok {
		return
	}
	if allowed, retry := s.limiter.AllowSync(dev.DeviceID); !allowed {
		s.writeRateLimited(w, retry)
		return
	}

	var req struct {
		DeviceName string `json:"deviceName"`
	}
	if err := json.Unmarshal(body, &req); err != nil {
		s.writeError(w, http.StatusBadRequest, "INVALID_JSON", "malformed JSON request body", 0)
		return
	}

	updated, err := s.store.RenameDevice(r.Context(), dev, req.DeviceName)
	if err != nil {
		s.writeStoreError(w, err)
		return
	}

	s.writeJSON(w, http.StatusOK, map[string]any{
		"serverTimeMs": s.now().UnixMilli(),
		"device":       updated,
	})
}

func (s *Server) handleRevokeDevice(w http.ResponseWriter, r *http.Request) {
	dev, ok := s.authenticateRequest(w, r)
	if !ok {
		return
	}
	if allowed, retry := s.limiter.AllowSync(dev.DeviceID); !allowed {
		s.writeRateLimited(w, retry)
		return
	}

	targetID := strings.TrimSpace(r.PathValue("deviceId"))
	if targetID == "" {
		s.writeError(w, http.StatusBadRequest, "INVALID_DEVICE_ID", "missing deviceId path parameter", 0)
		return
	}
	if targetID == "me" {
		targetID = dev.DeviceID
	}

	if err := s.store.RevokeDevice(r.Context(), dev, targetID); err != nil {
		s.writeStoreError(w, err)
		return
	}

	s.writeJSON(w, http.StatusOK, map[string]any{
		"serverTimeMs":    s.now().UnixMilli(),
		"revokedDeviceId": targetID,
	})
}

// --- Helpers ---

func (s *Server) readBodyLimited(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	if r.Body == nil {
		return nil, true
	}
	r.Body = http.MaxBytesReader(w, r.Body, s.cfg.MaxBodyBytes)
	body, err := io.ReadAll(r.Body)
	if err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			s.writeError(w, http.StatusRequestEntityTooLarge, "PAYLOAD_TOO_LARGE", "request body exceeds 64 KB limit", 0)
			return nil, false
		}
		s.writeError(w, http.StatusBadRequest, "READ_BODY_ERROR", "failed to read request body", 0)
		return nil, false
	}
	return body, true
}

func (s *Server) resolveRateSubject(r *http.Request, body []byte) string {
	if subject, ok := auth.VerifyGatewayRequest(
		s.cfg.GatewaySecret,
		s.now(),
		r.Method,
		r.URL.RequestURI(),
		r.Header,
		body,
	); ok {
		return "gw:" + subject
	}
	return "ip:" + auth.ExtractClientIP(r, s.cfg.TrustedProxyCIDRs)
}

func (s *Server) authenticateRequest(w http.ResponseWriter, r *http.Request) (*store.AuthenticatedDevice, bool) {
	return s.authenticateHeader(w, r, r.Header.Get("Authorization"))
}

func (s *Server) authenticateHeader(w http.ResponseWriter, r *http.Request, rawAuth string) (*store.AuthenticatedDevice, bool) {
	token, ok := parseBearerToken(rawAuth)
	if !ok {
		s.writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "missing or invalid Authorization bearer token", 0)
		return nil, false
	}
	dev, err := s.store.AuthenticateDevice(r.Context(), token)
	if err != nil {
		s.writeStoreError(w, err)
		return nil, false
	}
	return dev, true
}

func parseBearerToken(header string) (string, bool) {
	fields := strings.Fields(strings.TrimSpace(header))
	if len(fields) != 2 || !strings.EqualFold(fields[0], "Bearer") || fields[1] == "" {
		return "", false
	}
	return fields[1], true
}

func (s *Server) writeStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, store.ErrUnauthorized):
		s.writeError(w, http.StatusUnauthorized, "UNAUTHORIZED", "invalid device token", 0)
	case errors.Is(err, store.ErrDeviceRevoked):
		s.writeError(w, http.StatusUnauthorized, "DEVICE_REVOKED", "this device has been unlinked from the sync group", 0)
	case errors.Is(err, store.ErrCodeNotFound):
		s.writeError(w, http.StatusNotFound, "CODE_NOT_FOUND", "pairing code not found", 0)
	case errors.Is(err, store.ErrCodeUsed):
		s.writeError(w, http.StatusConflict, "CODE_USED", "pairing code has already been used", 0)
	case errors.Is(err, store.ErrGroupFull):
		s.writeError(w, http.StatusConflict, "GROUP_FULL", "sync group has reached the maximum of 10 active devices", 0)
	case errors.Is(err, store.ErrCodeExpired):
		s.writeError(w, http.StatusGone, "CODE_EXPIRED", "pairing code has expired", 0)
	case errors.Is(err, store.ErrDeviceNotFound):
		s.writeError(w, http.StatusNotFound, "DEVICE_NOT_FOUND", "device not found in sync group", 0)
	case errors.Is(err, store.ErrInvalidLessonID):
		s.writeError(w, http.StatusBadRequest, "INVALID_LESSON_ID", "lessonId is outside the canonical 335-lesson catalog", 0)
	case errors.Is(err, store.ErrInvalidPosition):
		s.writeError(w, http.StatusBadRequest, "INVALID_POSITION", "track positionMs, durationMs, or segmentIndex out of valid range", 0)
	case errors.Is(err, store.ErrTooManyLessons):
		s.writeError(w, http.StatusBadRequest, "TOO_MANY_LESSONS", "push exceeds 335 lessons", 0)
	case errors.Is(err, store.ErrDuplicateLessonID):
		s.writeError(w, http.StatusBadRequest, "DUPLICATE_LESSON_ID", "duplicate lessonId in push payload", 0)
	default:
		s.logger.Printf("internal server error: %v", err)
		s.writeError(w, http.StatusInternalServerError, "INTERNAL_ERROR", "internal server error", 0)
	}
}

func (s *Server) writeRateLimited(w http.ResponseWriter, retryAfterSec int) {
	if retryAfterSec <= 0 {
		retryAfterSec = 1
	}
	w.Header().Set("Retry-After", strconv.Itoa(retryAfterSec))
	s.writeError(w, http.StatusTooManyRequests, "RATE_LIMITED", "too many requests; please retry later", retryAfterSec)
}

func (s *Server) writeError(w http.ResponseWriter, status int, code, message string, retryAfterSec int) {
	s.writeJSON(w, status, errorEnvelope{
		ServerTimeMs: s.now().UnixMilli(),
		Error: errorDetail{
			Code:          code,
			Message:       message,
			RetryAfterSec: retryAfterSec,
		},
	})
}

func (s *Server) writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		s.logger.Printf("encode response error: %v", err)
	}
}

func (s *Server) withCORS(next http.Handler) http.Handler {
	allowAll := false
	allowedSet := make(map[string]struct{}, len(s.cfg.CORSOrigins))
	for _, origin := range s.cfg.CORSOrigins {
		if origin == "*" {
			allowAll = true
		} else {
			allowedSet[origin] = struct{}{}
		}
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if allowAll {
			w.Header().Set("Access-Control-Allow-Origin", "*")
		} else if origin != "" {
			if _, ok := allowedSet[origin]; ok {
				w.Header().Set("Access-Control-Allow-Origin", origin)
				w.Header().Add("Vary", "Origin")
			}
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Max-Age", "86400")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// Package auth handles pairing codes, device tokens, sanitization, and gateway HMAC signatures.
package auth

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
	"unicode"
)

const (
	// PairingAlphabet is a 31-character Crockford-inspired alphabet excluding 0, O, 1, I, L.
	PairingAlphabet = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
	// PairingCodeLength is the normalized length of a pairing ticket code.
	PairingCodeLength = 8
	// GatewayWindowMs defines the +/- 60s replay protection window for signed gateway requests.
	GatewayWindowMs int64 = 60_000
)

var (
	// ErrInvalidPairingCode is returned when a pairing code or URI does not conform to EP-SYNC-001.
	ErrInvalidPairingCode = errors.New("invalid pairing code format")

	pairingCharSet = func() [256]bool {
		var set [256]bool
		for i := 0; i < len(PairingAlphabet); i++ {
			set[PairingAlphabet[i]] = true
		}
		return set
	}()

	platformDefaults = map[string]string{
		"ios":       "iPhone",
		"ipad":      "iPad",
		"android":   "Android",
		"web":       "Web Browser",
		"wechat":    "WeChat Mini Program",
		"harmonyos": "HarmonyOS",
	}
)

// GeneratePairingCode returns a cryptographically random 8-character pairing code.
func GeneratePairingCode() (string, error) {
	const alphabetLen = byte(len(PairingAlphabet)) // 31
	const maxUnbiased = 256 - (256 % int(alphabetLen))

	out := make([]byte, PairingCodeLength)
	buf := make([]byte, 16)
	filled := 0

	for filled < PairingCodeLength {
		if _, err := io.ReadFull(rand.Reader, buf); err != nil {
			return "", fmt.Errorf("read random bytes: %w", err)
		}
		for _, b := range buf {
			if int(b) >= maxUnbiased {
				continue
			}
			out[filled] = PairingAlphabet[b%alphabetLen]
			filled++
			if filled == PairingCodeLength {
				break
			}
		}
	}
	return string(out), nil
}

// FormatDisplayCode formats an 8-character code as XXXX-XXXX for UI presentation.
func FormatDisplayCode(code string) string {
	if len(code) != PairingCodeLength {
		return code
	}
	return code[:4] + "-" + code[4:]
}

// BuildQRPayload constructs the custom URI payload encoded inside pairing QR codes.
func BuildQRPayload(code string) string {
	return "epsync://v1/pair?c=" + code
}

// NormalizePairingCode accepts raw codes, hyphenated codes, or epsync://v1/pair?c=... QR payloads.
func NormalizePairingCode(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", ErrInvalidPairingCode
	}

	if strings.HasPrefix(strings.ToLower(s), "epsync://") {
		u, err := url.Parse(s)
		if err != nil || !strings.EqualFold(u.Scheme, "epsync") || !strings.EqualFold(u.Host, "v1") || u.Path != "/pair" {
			return "", ErrInvalidPairingCode
		}
		s = strings.TrimSpace(u.Query().Get("c"))
	}

	var b strings.Builder
	b.Grow(PairingCodeLength)
	for i := 0; i < len(s); i++ {
		ch := s[i]
		if ch == '-' || ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r' {
			continue
		}
		if ch >= 'a' && ch <= 'z' {
			ch -= 'a' - 'A'
		}
		if !pairingCharSet[ch] {
			return "", ErrInvalidPairingCode
		}
		b.WriteByte(ch)
	}

	normalized := b.String()
	if len(normalized) != PairingCodeLength {
		return "", ErrInvalidPairingCode
	}
	return normalized, nil
}

// GenerateUUIDv4 creates an RFC 4122 version 4 UUID string.
func GenerateUUIDv4() (string, error) {
	var b [16]byte
	if _, err := io.ReadFull(rand.Reader, b[:]); err != nil {
		return "", fmt.Errorf("read uuid bytes: %w", err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		b[0:4], b[4:6], b[6:8], b[8:10], b[10:16]), nil
}

// GenerateDeviceToken returns a 256-bit cryptographically random bearer token encoded as 64 hex chars.
func GenerateDeviceToken() (string, error) {
	var b [32]byte
	if _, err := io.ReadFull(rand.Reader, b[:]); err != nil {
		return "", fmt.Errorf("read device token bytes: %w", err)
	}
	return hex.EncodeToString(b[:]), nil
}

// HashSecret computes the lowercase hex SHA-256 digest used to store tokens and ticket codes.
func HashSecret(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

// IsValidPlatform reports whether platform matches one of the supported EP-SYNC-001 client types.
func IsValidPlatform(platform string) bool {
	_, ok := platformDefaults[platform]
	return ok
}

// SanitizeDeviceName strips control/HTML characters, collapses whitespace, and caps at 32 runes.
func SanitizeDeviceName(name, platform string) string {
	var cleaned strings.Builder
	cleaned.Grow(len(name))

	for _, r := range name {
		if unicode.IsControl(r) {
			continue
		}
		switch r {
		case '<', '>', '&', '"', '\'':
			continue
		default:
			cleaned.WriteRune(r)
		}
	}

	normalized := strings.Join(strings.Fields(cleaned.String()), " ")
	runes := []rune(normalized)
	if len(runes) > 32 {
		normalized = strings.TrimSpace(string(runes[:32]))
	}
	if normalized != "" {
		return normalized
	}
	if def, ok := platformDefaults[platform]; ok {
		return def
	}
	return "Sync Device"
}

// ComputeGatewaySignature generates the canonical HMAC-SHA256 signature verified for CloudBase proxy calls.
func ComputeGatewaySignature(secret, method, pathAndQuery, timestamp, subject string, body []byte) string {
	bodySum := sha256.Sum256(body)
	canonical := strings.ToUpper(method) + "\n" +
		pathAndQuery + "\n" +
		timestamp + "\n" +
		subject + "\n" +
		hex.EncodeToString(bodySum[:])

	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(canonical))
	return hex.EncodeToString(mac.Sum(nil))
}

// VerifyGatewayRequest checks CloudBase gateway headers and returns the verified rate-limit subject.
func VerifyGatewayRequest(secret string, now time.Time, method, pathAndQuery string, headers http.Header, body []byte) (string, bool) {
	if secret == "" {
		return "", false
	}

	tsRaw := strings.TrimSpace(headers.Get("X-Gateway-Timestamp"))
	subject := strings.TrimSpace(headers.Get("X-Gateway-Subject"))
	sigHex := strings.TrimSpace(headers.Get("X-Gateway-Signature"))
	if tsRaw == "" || subject == "" || sigHex == "" {
		return "", false
	}
	if !isValidGatewaySubject(subject) {
		return "", false
	}

	tsMs, err := strconv.ParseInt(tsRaw, 10, 64)
	if err != nil {
		return "", false
	}
	diff := now.UnixMilli() - tsMs
	if diff == math.MinInt64 || absInt64(diff) > GatewayWindowMs {
		return "", false
	}

	gotSig, err := hex.DecodeString(sigHex)
	if err != nil || len(gotSig) != sha256.Size {
		return "", false
	}

	expectedHex := ComputeGatewaySignature(secret, method, pathAndQuery, tsRaw, subject, body)
	expectedSig, err := hex.DecodeString(expectedHex)
	if err != nil {
		return "", false
	}
	if !hmac.Equal(gotSig, expectedSig) {
		return "", false
	}
	return subject, true
}

// ExtractClientIP determines the direct client IP, honoring proxy headers only from trusted proxies.
func ExtractClientIP(r *http.Request, trustedCIDRs []*net.IPNet) string {
	remoteIP := parseIPOnly(r.RemoteAddr)
	if remoteIP == nil {
		return r.RemoteAddr
	}
	if isTrustedIP(remoteIP, trustedCIDRs) {
		if xri := strings.TrimSpace(r.Header.Get("X-Real-IP")); xri != "" {
			if ip := net.ParseIP(xri); ip != nil {
				return ip.String()
			}
		}
		if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
			for _, part := range strings.Split(xff, ",") {
				if ip := net.ParseIP(strings.TrimSpace(part)); ip != nil {
					return ip.String()
				}
			}
		}
	}
	return remoteIP.String()
}

func isValidGatewaySubject(subject string) bool {
	if len(subject) == 0 || len(subject) > 128 {
		return false
	}
	for i := 0; i < len(subject); i++ {
		c := subject[i]
		isAlphaNum := (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')
		if !isAlphaNum && c != '-' && c != '_' && c != ':' {
			return false
		}
	}
	return true
}

func absInt64(v int64) int64 {
	if v < 0 {
		return -v
	}
	return v
}

func parseIPOnly(addr string) net.IP {
	host, _, err := net.SplitHostPort(strings.TrimSpace(addr))
	if err == nil {
		return net.ParseIP(host)
	}
	return net.ParseIP(strings.TrimSpace(addr))
}

func isTrustedIP(ip net.IP, cidrs []*net.IPNet) bool {
	for _, n := range cidrs {
		if n != nil && n.Contains(ip) {
			return true
		}
	}
	return false
}

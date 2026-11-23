// Package config loads runtime configuration for ep-syncd from environment variables.
package config

import (
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultListenAddr         = "127.0.0.1:8787"
	DefaultDBPath             = "./data/ep-sync.db"
	DefaultCORSOrigins        = "*"
	DefaultTrustedProxyCIDRs  = "127.0.0.1/32,::1/128"
	DefaultMaxDevicesPerGroup = 10
	DefaultPairTTLSeconds     = 300
	DefaultCleanupSeconds     = 3600
	DefaultMaxBodyBytes       = 64 * 1024
)

// Config holds runtime settings for the sync server.
type Config struct {
	ListenAddr         string
	DBPath             string
	GatewaySecret      string
	CORSOrigins        []string
	TrustedProxyCIDRs  []*net.IPNet
	MaxDevicesPerGroup int
	PairTTL            time.Duration
	CleanupInterval    time.Duration
	MaxBodyBytes       int64
}

// LoadFromEnv reads configuration from SYNC_* environment variables with safe defaults.
func LoadFromEnv() (Config, error) {
	cfg := Config{
		ListenAddr:         envOrDefault("SYNC_LISTEN_ADDR", DefaultListenAddr),
		DBPath:             envOrDefault("SYNC_DB_PATH", DefaultDBPath),
		GatewaySecret:      os.Getenv("SYNC_GATEWAY_SECRET"),
		CORSOrigins:        splitCSV(envOrDefault("SYNC_CORS_ORIGINS", DefaultCORSOrigins)),
		MaxDevicesPerGroup: DefaultMaxDevicesPerGroup,
		PairTTL:            DefaultPairTTLSeconds * time.Second,
		CleanupInterval:    DefaultCleanupSeconds * time.Second,
		MaxBodyBytes:       DefaultMaxBodyBytes,
	}

	if v := strings.TrimSpace(os.Getenv("SYNC_MAX_DEVICES_PER_GROUP")); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 || n > 100 {
			return Config{}, fmt.Errorf("invalid SYNC_MAX_DEVICES_PER_GROUP %q", v)
		}
		cfg.MaxDevicesPerGroup = n
	}

	if v := strings.TrimSpace(os.Getenv("SYNC_PAIR_TTL_SECONDS")); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 30 || n > 3600 {
			return Config{}, fmt.Errorf("invalid SYNC_PAIR_TTL_SECONDS %q", v)
		}
		cfg.PairTTL = time.Duration(n) * time.Second
	}

	if v := strings.TrimSpace(os.Getenv("SYNC_CLEANUP_INTERVAL_SECONDS")); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 60 {
			return Config{}, fmt.Errorf("invalid SYNC_CLEANUP_INTERVAL_SECONDS %q", v)
		}
		cfg.CleanupInterval = time.Duration(n) * time.Second
	}

	cidrsRaw := envOrDefault("SYNC_TRUSTED_PROXY_CIDRS", DefaultTrustedProxyCIDRs)
	cidrs, err := ParseCIDRs(splitCSV(cidrsRaw))
	if err != nil {
		return Config{}, fmt.Errorf("invalid SYNC_TRUSTED_PROXY_CIDRS: %w", err)
	}
	cfg.TrustedProxyCIDRs = cidrs

	return cfg, nil
}

// ParseCIDRs parses a slice of CIDR or single IP strings into IPNet entries.
func ParseCIDRs(items []string) ([]*net.IPNet, error) {
	out := make([]*net.IPNet, 0, len(items))
	for _, raw := range items {
		if strings.Contains(raw, "/") {
			_, ipNet, err := net.ParseCIDR(raw)
			if err != nil {
				return nil, fmt.Errorf("parse cidr %q: %w", raw, err)
			}
			out = append(out, ipNet)
			continue
		}
		ip := net.ParseIP(raw)
		if ip == nil {
			return nil, fmt.Errorf("invalid ip %q", raw)
		}
		bits := 32
		if ip.To4() == nil {
			bits = 128
		}
		out = append(out, &net.IPNet{IP: ip, Mask: net.CIDRMask(bits, bits)})
	}
	return out, nil
}

func envOrDefault(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func splitCSV(raw string) []string {
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if s := strings.TrimSpace(part); s != "" {
			out = append(out, s)
		}
	}
	return out
}

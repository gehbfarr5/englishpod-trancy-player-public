// Command ep-syncd runs the EP-SYNC-001 Go + SQLite multi-device sync server.
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"github.com/gehbfarr5/englishpod-trancy-player-public/sync_server/internal/api"
	"github.com/gehbfarr5/englishpod-trancy-player-public/sync_server/internal/config"
	"github.com/gehbfarr5/englishpod-trancy-player-public/sync_server/internal/ratelimit"
	"github.com/gehbfarr5/englishpod-trancy-player-public/sync_server/internal/store"
)

func main() {
	logger := log.New(os.Stdout, "[ep-syncd] ", log.LstdFlags|log.LUTC)

	cfg, err := config.LoadFromEnv()
	if err != nil {
		logger.Fatalf("configuration error: %v", err)
	}

	if cfg.DBPath != ":memory:" {
		if dir := filepath.Dir(cfg.DBPath); dir != "" && dir != "." {
			if err := os.MkdirAll(dir, 0o750); err != nil {
				logger.Fatalf("failed to create db dir %q: %v", dir, err)
			}
		}
	}

	st, err := store.Open(cfg.DBPath, time.Now)
	if err != nil {
		logger.Fatalf("failed to open sqlite store: %v", err)
	}
	defer func() {
		if err := st.Close(); err != nil {
			logger.Printf("store close error: %v", err)
		}
	}()

	limiter := ratelimit.New(time.Now)
	srv := api.NewServer(cfg, st, limiter, time.Now, logger)

	httpServer := &http.Server{
		Addr:              cfg.ListenAddr,
		Handler:           srv,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go runMaintenanceLoop(ctx, cfg.CleanupInterval, st, limiter, logger)

	errCh := make(chan error, 1)
	go func() {
		logger.Printf("listening on %s (db=%s)", cfg.ListenAddr, cfg.DBPath)
		errCh <- httpServer.ListenAndServe()
	}()

	select {
	case err := <-errCh:
		if err != nil && !errors.Is(err, http.ErrServerClosed) {
			logger.Fatalf("http server error: %v", err)
		}
	case <-ctx.Done():
		logger.Printf("shutdown signal received")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(shutdownCtx); err != nil {
			logger.Printf("graceful shutdown error: %v", err)
		}
	}
}

func runMaintenanceLoop(
	ctx context.Context,
	interval time.Duration,
	st *store.Store,
	limiter *ratelimit.Limiter,
	logger *log.Logger,
) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			limiter.EvictExpired()
			stats, err := st.Cleanup(ctx)
			if err != nil {
				logger.Printf("maintenance cleanup error: %v", err)
				continue
			}
			if stats.ExpiredTicketsDeleted > 0 || stats.OrphanedGroupsDeleted > 0 || stats.StaleGroupsDeleted > 0 {
				logger.Printf(
					"maintenance cleanup: tickets=%d orphanedGroups=%d staleGroups=%d",
					stats.ExpiredTicketsDeleted,
					stats.OrphanedGroupsDeleted,
					stats.StaleGroupsDeleted,
				)
			}
		}
	}
}

// Package ratelimit implements thread-safe sliding-window and cooldown rate limiters.
package ratelimit

import (
	"math"
	"sync"
	"time"
)

const (
	claimLimit           = 5
	claimWindow          = time.Minute
	claimMaxFailures     = 10
	claimCooldown        = 15 * time.Minute
	claimFailureStaleAge = time.Hour

	createLimit  = 10
	createWindow = time.Hour

	syncLimit  = 30
	syncWindow = time.Minute
)

type failureState struct {
	count    int
	lastFail time.Time
}

// Limiter enforces per-subject pairing limits and per-device sync limits.
type Limiter struct {
	mu        sync.Mutex
	now       func() time.Time
	claimHits map[string][]time.Time
	failures  map[string]failureState
	cooldowns map[string]time.Time
	createHit map[string][]time.Time
	syncHits  map[string][]time.Time
}

// New constructs a Limiter using time.Now, or a custom clock when non-nil.
func New(now func() time.Time) *Limiter {
	if now == nil {
		now = time.Now
	}
	return &Limiter{
		now:       now,
		claimHits: make(map[string][]time.Time),
		failures:  make(map[string]failureState),
		cooldowns: make(map[string]time.Time),
		createHit: make(map[string][]time.Time),
		syncHits:  make(map[string][]time.Time),
	}
}

// AllowClaim checks whether subject may attempt POST /pair/claim.
func (l *Limiter) AllowClaim(subject string) (bool, int) {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	if until, ok := l.cooldowns[subject]; ok {
		if until.After(now) {
			return false, ceilSeconds(until.Sub(now))
		}
		delete(l.cooldowns, subject)
	}
	return allowWindow(l.claimHits, subject, claimLimit, claimWindow, now)
}

// RecordClaimFailure tracks consecutive pairing claim failures and triggers cooldown after 10 failures.
func (l *Limiter) RecordClaimFailure(subject string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	st := l.failures[subject]
	if !st.lastFail.IsZero() && now.Sub(st.lastFail) > claimFailureStaleAge {
		st.count = 0
	}
	st.count++
	st.lastFail = now
	if st.count >= claimMaxFailures {
		l.cooldowns[subject] = now.Add(claimCooldown)
		delete(l.failures, subject)
		return
	}
	l.failures[subject] = st
}

// RecordClaimSuccess resets consecutive claim failure state for subject.
func (l *Limiter) RecordClaimSuccess(subject string) {
	l.mu.Lock()
	defer l.mu.Unlock()

	delete(l.failures, subject)
	delete(l.cooldowns, subject)
}

// AllowCreate checks whether subject may call POST /pair/create (10 req/hour).
func (l *Limiter) AllowCreate(subject string) (bool, int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return allowWindow(l.createHit, subject, createLimit, createWindow, l.now())
}

// AllowSync checks whether an authenticated device may call push/pull (30 req/minute).
func (l *Limiter) AllowSync(deviceID string) (bool, int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return allowWindow(l.syncHits, deviceID, syncLimit, syncWindow, l.now())
}

// EvictExpired removes expired window buckets, cooldowns, and stale failure entries.
func (l *Limiter) EvictExpired() {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	pruneBucketMap(l.claimHits, claimWindow, now)
	pruneBucketMap(l.createHit, createWindow, now)
	pruneBucketMap(l.syncHits, syncWindow, now)

	for k, until := range l.cooldowns {
		if !until.After(now) {
			delete(l.cooldowns, k)
		}
	}
	for k, st := range l.failures {
		if now.Sub(st.lastFail) > claimFailureStaleAge {
			delete(l.failures, k)
		}
	}
}

func allowWindow(buckets map[string][]time.Time, key string, limit int, window time.Duration, now time.Time) (bool, int) {
	cutoff := now.Add(-window)
	hits := pruneSlice(buckets[key], cutoff)
	if len(hits) >= limit {
		buckets[key] = hits
		wait := hits[0].Add(window).Sub(now)
		return false, ceilSeconds(wait)
	}
	hits = append(hits, now)
	buckets[key] = hits
	return true, 0
}

func pruneBucketMap(buckets map[string][]time.Time, window time.Duration, now time.Time) {
	cutoff := now.Add(-window)
	for key, hits := range buckets {
		pruned := pruneSlice(hits, cutoff)
		if len(pruned) == 0 {
			delete(buckets, key)
		} else {
			buckets[key] = pruned
		}
	}
}

func pruneSlice(hits []time.Time, cutoff time.Time) []time.Time {
	idx := 0
	for idx < len(hits) && !hits[idx].After(cutoff) {
		idx++
	}
	if idx == 0 {
		return hits
	}
	if idx == len(hits) {
		return nil
	}
	remaining := make([]time.Time, len(hits)-idx)
	copy(remaining, hits[idx:])
	return remaining
}

func ceilSeconds(d time.Duration) int {
	if d <= 0 {
		return 1
	}
	return int(math.Ceil(d.Seconds()))
}

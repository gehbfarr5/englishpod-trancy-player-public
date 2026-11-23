package ratelimit

import (
	"testing"
	"time"
)

func TestAllowClaimWindowAndCooldown(t *testing.T) {
	now := time.Unix(1795400000, 0)
	lim := New(func() time.Time { return now })

	for i := 0; i < 5; i++ {
		ok, retry := lim.AllowClaim("user-a")
		if !ok || retry != 0 {
			t.Fatalf("attempt %d: AllowClaim = (%v, %d), want (true, 0)", i+1, ok, retry)
		}
	}
	if ok, retry := lim.AllowClaim("user-a"); ok || retry <= 0 {
		t.Fatalf("6th attempt within 1m: AllowClaim = (%v, %d), want denied", ok, retry)
	}

	// Distinct subject must remain isolated.
	if ok, _ := lim.AllowClaim("user-b"); !ok {
		t.Fatalf("distinct subject user-b was incorrectly rate limited")
	}

	// Advance past 1m window and accumulate 10 consecutive failures.
	now = now.Add(61 * time.Second)
	for i := 0; i < 10; i++ {
		lim.RecordClaimFailure("user-a")
	}
	if ok, retry := lim.AllowClaim("user-a"); ok || retry < 890 {
		t.Fatalf("after 10 failures expected 15m cooldown, got (%v, %d)", ok, retry)
	}

	// Still blocked after 10 minutes.
	now = now.Add(10 * time.Minute)
	if ok, _ := lim.AllowClaim("user-a"); ok {
		t.Fatalf("subject escaped 15m cooldown early")
	}

	// Unblocked after remaining 5+ minutes.
	now = now.Add(6 * time.Minute)
	if ok, _ := lim.AllowClaim("user-a"); !ok {
		t.Fatalf("subject stayed blocked after 15m cooldown expired")
	}

	// Success clears failure streak.
	for i := 0; i < 9; i++ {
		lim.RecordClaimFailure("user-a")
	}
	lim.RecordClaimSuccess("user-a")
	lim.RecordClaimFailure("user-a")
	if ok, _ := lim.AllowClaim("user-a"); !ok {
		t.Fatalf("success did not reset consecutive failure counter")
	}
}

func TestAllowCreateAndSyncWindowsAndEviction(t *testing.T) {
	now := time.Unix(1795400000, 0)
	lim := New(func() time.Time { return now })

	for i := 0; i < 10; i++ {
		if ok, _ := lim.AllowCreate("ip-1"); !ok {
			t.Fatalf("create %d denied unexpectedly", i+1)
		}
	}
	if ok, retry := lim.AllowCreate("ip-1"); ok || retry <= 0 {
		t.Fatalf("11th create within 1h = (%v, %d), want denied", ok, retry)
	}

	for i := 0; i < 30; i++ {
		if ok, _ := lim.AllowSync("dev-1"); !ok {
			t.Fatalf("sync %d denied unexpectedly", i+1)
		}
	}
	if ok, retry := lim.AllowSync("dev-1"); ok || retry <= 0 {
		t.Fatalf("31st sync within 1m = (%v, %d), want denied", ok, retry)
	}

	now = now.Add(2 * time.Hour)
	lim.EvictExpired()
	if ok, _ := lim.AllowCreate("ip-1"); !ok {
		t.Fatalf("create stayed limited after 2h")
	}
	if ok, _ := lim.AllowSync("dev-1"); !ok {
		t.Fatalf("sync stayed limited after 2h")
	}
}

package store

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

func openTestStore(t *testing.T, clock *time.Time) *Store {
	t.Helper()
	st, err := Open(":memory:", func() time.Time { return *clock })
	if err != nil {
		t.Fatalf("Open(:memory:) error: %v", err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return st
}

func intPtr(v int) *int       { return &v }
func int64Ptr(v int64) *int64 { return &v }

func TestPairLifecycleAndGroupLimit(t *testing.T) {
	ctx := context.Background()
	now := time.UnixMilli(1795400000000)
	st := openTestStore(t, &now)

	// Device A creates a new group + pairing ticket.
	pairA, err := st.CreatePairingTicket(ctx, nil, "iPhone 17", "ios", 5*time.Minute)
	if err != nil {
		t.Fatalf("CreatePairingTicket error: %v", err)
	}
	if pairA.DeviceToken == "" || len(pairA.Code) != 8 {
		t.Fatalf("unexpected CreatePairResult: %+v", pairA)
	}

	devA, err := st.AuthenticateDevice(ctx, pairA.DeviceToken)
	if err != nil {
		t.Fatalf("AuthenticateDevice(A) error: %v", err)
	}

	status, err := st.GetPairingStatus(ctx, devA, pairA.Code)
	if err != nil || status.Status != "pending" {
		t.Fatalf("GetPairingStatus = (%+v, %v), want pending", status, err)
	}

	// Device B claims the ticket.
	claimB, err := st.ClaimPairingTicket(ctx, pairA.Code, "Tesla Web", "web", 10)
	if err != nil {
		t.Fatalf("ClaimPairingTicket(B) error: %v", err)
	}
	if claimB.GroupID != pairA.GroupID || len(claimB.Devices) != 2 {
		t.Fatalf("unexpected ClaimPairResult: %+v", claimB)
	}

	// Status should now report consumed with B's info.
	status, err = st.GetPairingStatus(ctx, devA, pairA.Code)
	if err != nil || status.Status != "consumed" || status.ClaimedDevice == nil || status.ClaimedDevice.DeviceID != claimB.DeviceID {
		t.Fatalf("GetPairingStatus after claim = (%+v, %v)", status, err)
	}

	// Reusing the same code must fail with ErrCodeUsed.
	if _, err := st.ClaimPairingTicket(ctx, pairA.Code, "Other", "android", 10); !errors.Is(err, ErrCodeUsed) {
		t.Fatalf("reuse error = %v, want ErrCodeUsed", err)
	}

	// Expired ticket must fail with ErrCodeExpired and status "expired".
	pairExp, err := st.CreatePairingTicket(ctx, devA, "", "ios", 5*time.Minute)
	if err != nil {
		t.Fatalf("CreatePairingTicket(2) error: %v", err)
	}
	now = now.Add(5*time.Minute + time.Second)
	statusExp, err := st.GetPairingStatus(ctx, devA, pairExp.Code)
	if err != nil || statusExp.Status != "expired" {
		t.Fatalf("expired GetPairingStatus = (%+v, %v)", statusExp, err)
	}
	if _, err := st.ClaimPairingTicket(ctx, pairExp.Code, "Late", "android", 10); !errors.Is(err, ErrCodeExpired) {
		t.Fatalf("expired claim error = %v, want ErrCodeExpired", err)
	}

	// Add 8 more devices to reach cap of 10, then 11th must fail with ErrGroupFull.
	for i := 3; i <= 10; i++ {
		tkt, err := st.CreatePairingTicket(ctx, devA, "", "ios", 5*time.Minute)
		if err != nil {
			t.Fatalf("ticket %d error: %v", i, err)
		}
		if _, err := st.ClaimPairingTicket(ctx, tkt.Code, "Device", "android", 10); err != nil {
			t.Fatalf("claim %d error: %v", i, err)
		}
	}
	tkt11, err := st.CreatePairingTicket(ctx, devA, "", "ios", 5*time.Minute)
	if err != nil {
		t.Fatalf("ticket 11 error: %v", err)
	}
	if _, err := st.ClaimPairingTicket(ctx, tkt11.Code, "Device 11", "wechat", 10); !errors.Is(err, ErrGroupFull) {
		t.Fatalf("11th claim error = %v, want ErrGroupFull", err)
	}
}

func TestConflictMergeCausalClockClampingAndMonotonicCompletion(t *testing.T) {
	ctx := context.Background()
	now := time.UnixMilli(1795400000000)
	st := openTestStore(t, &now)

	pA, _ := st.CreatePairingTicket(ctx, nil, "Phone A", "ios", 5*time.Minute)
	cB, _ := st.ClaimPairingTicket(ctx, pA.Code, "Web B", "web", 10)
	devA, _ := st.AuthenticateDevice(ctx, pA.DeviceToken)
	devB, _ := st.AuthenticateDevice(ctx, cB.DeviceToken)

	// 1. Device A pushes lesson 0010 PB and marks completed=true.
	resA1, err := st.Push(ctx, devA, PushRequest{
		Lessons: []LessonPushInput{
			{
				LessonID:        "0010",
				LessonCompleted: true,
				PB: &TrackPointInput{
					PositionMs:   620_000,
					SegmentIndex: intPtr(50),
					DurationMs:   int64Ptr(640_000),
					UpdatedAtMs:  now.UnixMilli(),
					BaseSeq:      0,
				},
			},
		},
		LastOpened: &LastOpenedInput{
			LessonID:    "0010",
			UpdatedAtMs: now.UnixMilli(),
			BaseSeq:     0,
		},
	})
	if err != nil || resA1.ServerSeq != 1 || len(resA1.RejectedConflicts) != 0 {
		t.Fatalf("Push A1 failed: (%+v, %v)", resA1, err)
	}

	// 2. Device B pulls seq=0 -> gets lesson 0010 at seq=1, then replays 0010 from 20% with lessonCompleted=false
	// and updates DG independently. Even though B's clock is 10s BEHIND A's timestamp, baseSeq=1 >= server.pb_seq=1 wins!
	pullB, err := st.Pull(ctx, devB, 0)
	if err != nil || pullB.ServerSeq != 1 || len(pullB.Lessons) != 1 {
		t.Fatalf("Pull B failed: (%+v, %v)", pullB, err)
	}

	now = now.Add(5 * time.Second)
	resB1, err := st.Push(ctx, devB, PushRequest{
		Lessons: []LessonPushInput{
			{
				LessonID:        "0010",
				LessonCompleted: false, // must NOT unset lessonCompleted
				PB: &TrackPointInput{
					PositionMs:   120_000,
					SegmentIndex: intPtr(10),
					DurationMs:   int64Ptr(640_000),
					UpdatedAtMs:  now.UnixMilli() - 10_000, // behind A's timestamp, yet causally newer via baseSeq=1
					BaseSeq:      1,
				},
				DG: &TrackPointInput{
					PositionMs:   45_000,
					SegmentIndex: intPtr(4),
					DurationMs:   int64Ptr(90_000),
					UpdatedAtMs:  now.UnixMilli(),
					BaseSeq:      0,
				},
			},
		},
	})
	if err != nil || resB1.ServerSeq != 2 || len(resB1.RejectedConflicts) != 0 {
		t.Fatalf("Push B1 causal merge failed: (%+v, %v)", resB1, err)
	}

	// Verify lessonCompleted stayed true and PB/DG both reflect B1.
	pullAfterB, err := st.Pull(ctx, devA, 1)
	if err != nil || len(pullAfterB.Lessons) != 1 {
		t.Fatalf("Pull A after B1 failed: (%+v, %v)", pullAfterB, err)
	}
	got0010 := pullAfterB.Lessons[0]
	if !got0010.LessonCompleted {
		t.Fatalf("lessonCompleted regressed to false")
	}
	if got0010.PB == nil || got0010.PB.PositionMs != 120_000 || got0010.DG == nil || got0010.DG.PositionMs != 45_000 {
		t.Fatalf("unexpected PB/DG after causal push: pb=%+v dg=%+v", got0010.PB, got0010.DG)
	}

	// 3. Offline conflict with absurd future clock (year 2099):
	// A pushes PB at now+20s (baseSeq=2 -> server seq=3, pb_updated_at_ms=now+20s).
	// B pushes offline PB with baseSeq=1 (<3) and bogus year-2099 clock.
	// Server clamps B's clock to serverNow+30s -> wait: if A pushed at serverNow+25s, wait let's advance server clock:
	// First A pushes at t0+20s -> pb_updated_at_ms = t0+20s, serverSeq=3.
	// Advance server clock by +10s to t0+30s? Then serverNow+30s would be t0+60s > t0+20s.
	// Instead, keep serverNow at t0+5s, A pushes valid client clock t0+30s (within +30s? t0+35s is clamped to t0+35s),
	// OR better: advance server clock to t0+60s, A pushes at t0+60s (pb_updated_at=t0+60s),
	// then wait: B's bogus 2099 clock is clamped to serverNow+30s, so if A's real timestamp was t0+60s and serverNow was still t0+60s, clamped(+30s) could beat t0+60s unless A was newer.
	// Actually, test clock clamping directly: B with year-2099 clock pushes 0015 (clamped to now+30s);
	// then advance server clock by 2 minutes (now+120s), A pushes 0015 offline with real clock (now+120s) and baseSeq=0 -> A MUST win because 2099 was clamped!
	now = now.Add(5 * time.Second)
	year2099Ms := int64(4070908800000)
	if _, err := st.Push(ctx, devB, PushRequest{
		Lessons: []LessonPushInput{
			{
				LessonID: "0015",
				PB: &TrackPointInput{
					PositionMs:  99_000,
					UpdatedAtMs: year2099Ms,
					BaseSeq:     0,
				},
			},
		},
	}); err != nil {
		t.Fatalf("Push year2099 error: %v", err)
	}

	now = now.Add(2 * time.Minute)
	resReal, err := st.Push(ctx, devA, PushRequest{
		Lessons: []LessonPushInput{
			{
				LessonID: "0015",
				PB: &TrackPointInput{
					PositionMs:  210_000,
					UpdatedAtMs: now.UnixMilli(),
					BaseSeq:     0, // offline conflict against 2099-clamped record
				},
			},
		},
	})
	if err != nil || len(resReal.RejectedConflicts) != 0 {
		t.Fatalf("real timestamp failed to beat clamped year-2099 record: (%+v, %v)", resReal, err)
	}

	// 4. Stale offline conflict with older timestamp must be rejected and return server winning state.
	resStale, err := st.Push(ctx, devB, PushRequest{
		Lessons: []LessonPushInput{
			{
				LessonID: "0015",
				PB: &TrackPointInput{
					PositionMs:  10_000,
					UpdatedAtMs: now.UnixMilli() - 60_000,
					BaseSeq:     0,
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("Push stale error: %v", err)
	}
	if len(resStale.RejectedConflicts) != 1 || resStale.RejectedConflicts[0].ServerTrack.PositionMs != 210_000 {
		t.Fatalf("expected conflict returning 210_000, got: %+v", resStale)
	}
	if len(resStale.AcceptedLessons) != 0 {
		t.Fatalf("pure conflict lesson should not be listed in acceptedLessons: %+v", resStale.AcceptedLessons)
	}
}

func TestRevokeOrphanAndCleanup(t *testing.T) {
	ctx := context.Background()
	now := time.UnixMilli(1795400000000)
	st := openTestStore(t, &now)

	pA, _ := st.CreatePairingTicket(ctx, nil, "iPhone", "ios", 5*time.Minute)
	cB, _ := st.ClaimPairingTicket(ctx, pA.Code, "WeChat", "wechat", 10)
	devA, _ := st.AuthenticateDevice(ctx, pA.DeviceToken)
	devB, _ := st.AuthenticateDevice(ctx, cB.DeviceToken)

	// A revokes B.
	if err := st.RevokeDevice(ctx, devA, devB.DeviceID); err != nil {
		t.Fatalf("RevokeDevice(B) error: %v", err)
	}
	if _, err := st.AuthenticateDevice(ctx, cB.DeviceToken); !errors.Is(err, ErrDeviceRevoked) {
		t.Fatalf("revoked device auth = %v, want ErrDeviceRevoked", err)
	}

	// A revokes self -> group becomes orphaned.
	if err := st.RevokeDevice(ctx, devA, devA.DeviceID); err != nil {
		t.Fatalf("RevokeDevice(A) error: %v", err)
	}

	// Cleanup before 7 days does NOT delete group.
	now = now.Add(6 * 24 * time.Hour)
	statsEarly, err := st.Cleanup(ctx)
	if err != nil || statsEarly.OrphanedGroupsDeleted != 0 {
		t.Fatalf("early Cleanup = (%+v, %v)", statsEarly, err)
	}

	// Cleanup after 7 days deletes orphaned group.
	now = now.Add(2 * 24 * time.Hour)
	statsLate, err := st.Cleanup(ctx)
	if err != nil || statsLate.OrphanedGroupsDeleted != 1 {
		t.Fatalf("late Cleanup = (%+v, %v)", statsLate, err)
	}
}

func TestConcurrentPushRaceSafety(t *testing.T) {
	ctx := context.Background()
	now := time.UnixMilli(1795400000000)
	st := openTestStore(t, &now)

	pA, _ := st.CreatePairingTicket(ctx, nil, "Phone", "ios", 5*time.Minute)
	cB, _ := st.ClaimPairingTicket(ctx, pA.Code, "Web", "web", 10)
	devA, _ := st.AuthenticateDevice(ctx, pA.DeviceToken)
	devB, _ := st.AuthenticateDevice(ctx, cB.DeviceToken)

	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for i := 1; i <= 10; i++ {
			_, err := st.Push(ctx, devA, PushRequest{
				Lessons: []LessonPushInput{{
					LessonID: "0001",
					PB:       &TrackPointInput{PositionMs: int64(i * 1000), UpdatedAtMs: now.UnixMilli() + int64(i)},
				}},
			})
			if err != nil {
				t.Errorf("concurrent push A failed: %v", err)
			}
		}
	}()
	go func() {
		defer wg.Done()
		for i := 1; i <= 10; i++ {
			_, err := st.Push(ctx, devB, PushRequest{
				Lessons: []LessonPushInput{{
					LessonID: "0002",
					DG:       &TrackPointInput{PositionMs: int64(i * 1000), UpdatedAtMs: now.UnixMilli() + int64(i)},
				}},
			})
			if err != nil {
				t.Errorf("concurrent push B failed: %v", err)
			}
		}
	}()
	wg.Wait()

	pull, err := st.Pull(ctx, devA, 0)
	if err != nil || len(pull.Lessons) != 2 {
		t.Fatalf("Pull after concurrent pushes = (%+v, %v)", pull, err)
	}
}

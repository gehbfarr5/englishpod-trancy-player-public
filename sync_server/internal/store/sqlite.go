// Package store implements SQLite WAL persistence and EP-SYNC-001 transactional conflict resolution.
package store

import (
	"context"
	"database/sql"
	_ "embed"
	"errors"
	"fmt"
	"sync"
	"time"

	_ "modernc.org/sqlite"

	"github.com/gehbfarr5/englishpod-trancy-player-public/sync_server/internal/auth"
	"github.com/gehbfarr5/englishpod-trancy-player-public/sync_server/internal/lessons"
)

//go:embed schema.sql
var schemaSQL string

const (
	pastClockWindowMs   int64 = 365 * 24 * 60 * 60 * 1000
	futureClockWindowMs int64 = 30 * 1000
	ticketRetentionMs   int64 = 24 * 60 * 60 * 1000
	orphanRetentionMs   int64 = 7 * 24 * 60 * 60 * 1000
	staleGroupAgeMs     int64 = 180 * 24 * 60 * 60 * 1000
)

// Store wraps SQLite WAL access with serialized write transactions.
type Store struct {
	db      *sql.DB
	writeMu sync.Mutex
	now     func() time.Time
}

// Open opens (or initializes) a SQLite database at dbPath and applies EP-SYNC-001 pragmas and schema.
func Open(dbPath string, now func() time.Time) (*Store, error) {
	if now == nil {
		now = time.Now
	}
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		return nil, fmt.Errorf("open sqlite %q: %w", dbPath, err)
	}
	// Single connection eliminates SQLITE_BUSY write contention in embedded WAL mode.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	pragmas := []string{
		"PRAGMA foreign_keys = ON;",
		"PRAGMA busy_timeout = 5000;",
		"PRAGMA synchronous = NORMAL;",
	}
	if dbPath != ":memory:" {
		pragmas = append([]string{"PRAGMA journal_mode = WAL;"}, pragmas...)
	}
	for _, stmt := range pragmas {
		if _, err := db.Exec(stmt); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("exec %q: %w", stmt, err)
		}
	}
	if _, err := db.Exec(schemaSQL); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("apply schema: %w", err)
	}
	return &Store{db: db, now: now}, nil
}

// Close closes the underlying SQLite database connection.
func (s *Store) Close() error {
	return s.db.Close()
}

// Ping verifies database responsiveness for health checks.
func (s *Store) Ping(ctx context.Context) error {
	return s.db.PingContext(ctx)
}

// CreatePairingTicket issues a 5-minute single-use ticket, creating a new group and device if unauthenticated.
func (s *Store) CreatePairingTicket(
	ctx context.Context,
	existing *AuthenticatedDevice,
	deviceName string,
	platform string,
	ttl time.Duration,
) (*CreatePairResult, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	nowMs := s.now().UnixMilli()
	expiresAtMs := nowMs + ttl.Milliseconds()

	code, err := auth.GeneratePairingCode()
	if err != nil {
		return nil, err
	}
	codeHash := auth.HashSecret(code)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var (
		groupID     string
		deviceID    string
		deviceToken string
	)

	if existing == nil {
		groupID, err = auth.GenerateUUIDv4()
		if err != nil {
			return nil, err
		}
		deviceID, err = auth.GenerateUUIDv4()
		if err != nil {
			return nil, err
		}
		deviceToken, err = auth.GenerateDeviceToken()
		if err != nil {
			return nil, err
		}
		cleanName := auth.SanitizeDeviceName(deviceName, platform)

		if _, err := tx.ExecContext(ctx, `
			INSERT INTO sync_groups (group_id, server_seq, created_at_ms, updated_at_ms)
			VALUES (?, 0, ?, ?)`,
			groupID, nowMs, nowMs,
		); err != nil {
			return nil, fmt.Errorf("insert sync_group: %w", err)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO sync_devices (device_id, group_id, token_hash, device_name, platform, created_at_ms, last_seen_at_ms)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
			deviceID, groupID, auth.HashSecret(deviceToken), cleanName, platform, nowMs, nowMs,
		); err != nil {
			return nil, fmt.Errorf("insert initial device: %w", err)
		}
	} else {
		var revoked sql.NullInt64
		err := tx.QueryRowContext(ctx, `
			SELECT revoked_at_ms FROM sync_devices WHERE device_id = ? AND group_id = ?`,
			existing.DeviceID, existing.GroupID,
		).Scan(&revoked)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, ErrUnauthorized
		}
		if err != nil {
			return nil, err
		}
		if revoked.Valid {
			return nil, ErrDeviceRevoked
		}
		groupID = existing.GroupID
		deviceID = existing.DeviceID
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO pairing_tickets (code_hash, group_id, created_by, created_at_ms, expires_at_ms)
		VALUES (?, ?, ?, ?, ?)`,
		codeHash, groupID, deviceID, nowMs, expiresAtMs,
	); err != nil {
		return nil, fmt.Errorf("insert pairing_ticket: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return &CreatePairResult{
		GroupID:     groupID,
		DeviceID:    deviceID,
		DeviceToken: deviceToken,
		Code:        code,
		DisplayCode: auth.FormatDisplayCode(code),
		QRPayload:   auth.BuildQRPayload(code),
		ExpiresAtMs: expiresAtMs,
	}, nil
}

// GetPairingStatus checks whether a group's pairing ticket is pending, consumed, or expired.
func (s *Store) GetPairingStatus(ctx context.Context, requester *AuthenticatedDevice, normalizedCode string) (*PairingStatusResult, error) {
	codeHash := auth.HashSecret(normalizedCode)
	nowMs := s.now().UnixMilli()

	var (
		groupID      string
		expiresAtMs  int64
		consumedAtMs sql.NullInt64
		consumedBy   sql.NullString
	)
	err := s.db.QueryRowContext(ctx, `
		SELECT group_id, expires_at_ms, consumed_at_ms, consumed_by
		FROM pairing_tickets
		WHERE code_hash = ?`,
		codeHash,
	).Scan(&groupID, &expiresAtMs, &consumedAtMs, &consumedBy)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && groupID != requester.GroupID) {
		return nil, ErrCodeNotFound
	}
	if err != nil {
		return nil, err
	}

	res := &PairingStatusResult{
		Code:        normalizedCode,
		DisplayCode: auth.FormatDisplayCode(normalizedCode),
		ExpiresAtMs: expiresAtMs,
	}

	if consumedAtMs.Valid {
		res.Status = "consumed"
		if consumedBy.Valid {
			var info ClaimedDeviceInfo
			info.ConsumedAtMs = consumedAtMs.Int64
			err := s.db.QueryRowContext(ctx, `
				SELECT device_id, device_name, platform
				FROM sync_devices
				WHERE device_id = ? AND group_id = ?`,
				consumedBy.String, groupID,
			).Scan(&info.DeviceID, &info.DeviceName, &info.Platform)
			if err == nil {
				res.ClaimedDevice = &info
			}
		}
		return res, nil
	}
	if nowMs >= expiresAtMs {
		res.Status = "expired"
		return res, nil
	}
	res.Status = "pending"
	return res, nil
}

// ClaimPairingTicket atomically validates and consumes a ticket, joining the device to the sync group.
func (s *Store) ClaimPairingTicket(
	ctx context.Context,
	normalizedCode string,
	deviceName string,
	platform string,
	maxDevices int,
) (*ClaimPairResult, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	nowMs := s.now().UnixMilli()
	codeHash := auth.HashSecret(normalizedCode)

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var (
		groupID      string
		expiresAtMs  int64
		consumedAtMs sql.NullInt64
	)
	err = tx.QueryRowContext(ctx, `
		SELECT group_id, expires_at_ms, consumed_at_ms
		FROM pairing_tickets
		WHERE code_hash = ?`,
		codeHash,
	).Scan(&groupID, &expiresAtMs, &consumedAtMs)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrCodeNotFound
	}
	if err != nil {
		return nil, err
	}
	if consumedAtMs.Valid {
		return nil, ErrCodeUsed
	}
	if nowMs >= expiresAtMs {
		return nil, ErrCodeExpired
	}

	var activeCount int
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM sync_devices WHERE group_id = ? AND revoked_at_ms IS NULL`,
		groupID,
	).Scan(&activeCount); err != nil {
		return nil, err
	}
	if activeCount >= maxDevices {
		return nil, ErrGroupFull
	}

	newDeviceID, err := auth.GenerateUUIDv4()
	if err != nil {
		return nil, err
	}
	newToken, err := auth.GenerateDeviceToken()
	if err != nil {
		return nil, err
	}
	cleanName := auth.SanitizeDeviceName(deviceName, platform)

	if _, err := tx.ExecContext(ctx, `
		UPDATE pairing_tickets
		SET consumed_at_ms = ?, consumed_by = ?
		WHERE code_hash = ? AND consumed_at_ms IS NULL`,
		nowMs, newDeviceID, codeHash,
	); err != nil {
		return nil, err
	}

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO sync_devices (device_id, group_id, token_hash, device_name, platform, created_at_ms, last_seen_at_ms)
		VALUES (?, ?, ?, ?, ?, ?, ?)`,
		newDeviceID, groupID, auth.HashSecret(newToken), cleanName, platform, nowMs, nowMs,
	); err != nil {
		return nil, err
	}

	if _, err := tx.ExecContext(ctx, `
		UPDATE sync_groups SET orphaned_at_ms = NULL, updated_at_ms = ? WHERE group_id = ?`,
		nowMs, groupID,
	); err != nil {
		return nil, err
	}

	var serverSeq int64
	if err := tx.QueryRowContext(ctx, `
		SELECT server_seq FROM sync_groups WHERE group_id = ?`,
		groupID,
	).Scan(&serverSeq); err != nil {
		return nil, err
	}

	devices, err := queryActiveDevicesTx(ctx, tx, groupID, newDeviceID)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return &ClaimPairResult{
		GroupID:     groupID,
		DeviceID:    newDeviceID,
		DeviceToken: newToken,
		ServerSeq:   serverSeq,
		Devices:     devices,
	}, nil
}

// AuthenticateDevice verifies a bearer token and records last_seen_at_ms for active devices.
func (s *Store) AuthenticateDevice(ctx context.Context, bearerToken string) (*AuthenticatedDevice, error) {
	if bearerToken == "" {
		return nil, ErrUnauthorized
	}
	tokenHash := auth.HashSecret(bearerToken)
	nowMs := s.now().UnixMilli()

	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	var (
		dev     AuthenticatedDevice
		revoked sql.NullInt64
	)
	err := s.db.QueryRowContext(ctx, `
		SELECT device_id, group_id, device_name, platform, revoked_at_ms
		FROM sync_devices
		WHERE token_hash = ?`,
		tokenHash,
	).Scan(&dev.DeviceID, &dev.GroupID, &dev.DeviceName, &dev.Platform, &revoked)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrUnauthorized
	}
	if err != nil {
		return nil, err
	}
	if revoked.Valid {
		return nil, ErrDeviceRevoked
	}

	if _, err := s.db.ExecContext(ctx, `
		UPDATE sync_devices SET last_seen_at_ms = ? WHERE device_id = ?`,
		nowMs, dev.DeviceID,
	); err != nil {
		return nil, err
	}
	return &dev, nil
}

// Push validates and merges incremental lesson/track changes within a single transaction.
func (s *Store) Push(ctx context.Context, dev *AuthenticatedDevice, req PushRequest) (*PushResult, error) {
	if err := validatePushRequest(req); err != nil {
		return nil, err
	}

	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	nowMs := s.now().UnixMilli()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	var (
		currentSeq       int64
		lastOpenedID     sql.NullString
		lastOpenedAtMs   int64
		lastOpenedBy     sql.NullString
		lastOpenedSeq    int64
	)
	if err := tx.QueryRowContext(ctx, `
		SELECT server_seq, last_opened_lesson_id, last_opened_at_ms, last_opened_by, last_opened_seq
		FROM sync_groups
		WHERE group_id = ?`,
		dev.GroupID,
	).Scan(&currentSeq, &lastOpenedID, &lastOpenedAtMs, &lastOpenedBy, &lastOpenedSeq); err != nil {
		return nil, err
	}

	nextSeq := currentSeq + 1
	mutated := false

	accepted := make([]string, 0, len(req.Lessons))
	conflicts := make([]RejectedConflict, 0)

	for _, item := range req.Lessons {
		row, exists, err := loadLessonRowTx(ctx, tx, dev.GroupID, item.LessonID)
		if err != nil {
			return nil, err
		}

		rowChanged := false
		if !exists {
			row = lessonRow{
				GroupID:  dev.GroupID,
				LessonID: item.LessonID,
			}
		}

		if item.LessonCompleted && !row.LessonCompleted {
			row.LessonCompleted = true
			completedTS := item.CompletedAtMs
			if completedTS <= 0 && item.PB != nil {
				completedTS = item.PB.UpdatedAtMs
			}
			if completedTS <= 0 {
				completedTS = nowMs
			}
			row.CompletedAtMs = clampTS(completedTS, nowMs)
			rowChanged = true
		}

		pbChanged, pbConflict := mergeTrack(row.PB, item.PB, nowMs, dev.DeviceID, nextSeq)
		if pbConflict != nil {
			pbConflict.LessonID = item.LessonID
			pbConflict.Track = "pb"
			conflicts = append(conflicts, *pbConflict)
		}
		if pbChanged != nil {
			row.PB = pbChanged
			rowChanged = true
		}

		dgChanged, dgConflict := mergeTrack(row.DG, item.DG, nowMs, dev.DeviceID, nextSeq)
		if dgConflict != nil {
			dgConflict.LessonID = item.LessonID
			dgConflict.Track = "dg"
			conflicts = append(conflicts, *dgConflict)
		}
		if dgChanged != nil {
			row.DG = dgChanged
			rowChanged = true
		}

		if rowChanged {
			row.Seq = nextSeq
			if err := upsertLessonRowTx(ctx, tx, row); err != nil {
				return nil, err
			}
			mutated = true
		}
		// Report as accepted when no conflict rejected this lesson's submitted tracks, or when partial state advanced.
		if pbConflict == nil && dgConflict == nil || rowChanged {
			accepted = append(accepted, item.LessonID)
		}
	}

	var outLastOpened *LastOpenedOutput
	if req.LastOpened != nil && req.LastOpened.LessonID != "" {
		inLO := req.LastOpened
		inTS := clampTS(inLO.UpdatedAtMs, nowMs)

		acceptLO := false
		if !lastOpenedID.Valid || lastOpenedID.String == "" {
			acceptLO = true
		} else if inLO.BaseSeq >= lastOpenedSeq {
			acceptLO = lastOpenedID.String != inLO.LessonID
		} else if inTS > lastOpenedAtMs {
			acceptLO = true
		} else if inTS == lastOpenedAtMs && lastOpenedID.String != inLO.LessonID && dev.DeviceID > lastOpenedBy.String {
			acceptLO = true
		}

		if acceptLO {
			if _, err := tx.ExecContext(ctx, `
				UPDATE sync_groups
				SET last_opened_lesson_id = ?, last_opened_at_ms = ?, last_opened_by = ?, last_opened_seq = ?
				WHERE group_id = ?`,
				inLO.LessonID, inTS, dev.DeviceID, nextSeq, dev.GroupID,
			); err != nil {
				return nil, err
			}
			lastOpenedID = sql.NullString{String: inLO.LessonID, Valid: true}
			lastOpenedAtMs = inTS
			lastOpenedSeq = nextSeq
			mutated = true
		}
		if lastOpenedID.Valid && lastOpenedID.String != "" {
			outLastOpened = &LastOpenedOutput{
				LessonID:    lastOpenedID.String,
				UpdatedAtMs: lastOpenedAtMs,
				Seq:         lastOpenedSeq,
			}
		}
	}

	finalSeq := currentSeq
	if mutated {
		finalSeq = nextSeq
		if _, err := tx.ExecContext(ctx, `
			UPDATE sync_groups SET server_seq = ?, updated_at_ms = ? WHERE group_id = ?`,
			finalSeq, nowMs, dev.GroupID,
		); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}

	return &PushResult{
		ServerSeq:         finalSeq,
		AcceptedLessons:   accepted,
		RejectedConflicts: conflicts,
		LastOpened:        outLastOpened,
	}, nil
}

// Pull returns all lessons modified after sinceSeq along with the group's latest lastOpened anchor.
func (s *Store) Pull(ctx context.Context, dev *AuthenticatedDevice, sinceSeq int64) (*PullResult, error) {
	if sinceSeq < 0 {
		sinceSeq = 0
	}

	var (
		serverSeq      int64
		lastOpenedID   sql.NullString
		lastOpenedAtMs int64
		lastOpenedSeq  int64
	)
	if err := s.db.QueryRowContext(ctx, `
		SELECT server_seq, last_opened_lesson_id, last_opened_at_ms, last_opened_seq
		FROM sync_groups
		WHERE group_id = ?`,
		dev.GroupID,
	).Scan(&serverSeq, &lastOpenedID, &lastOpenedAtMs, &lastOpenedSeq); err != nil {
		return nil, err
	}

	var lo *LastOpenedOutput
	if lastOpenedID.Valid && lastOpenedID.String != "" {
		lo = &LastOpenedOutput{
			LessonID:    lastOpenedID.String,
			UpdatedAtMs: lastOpenedAtMs,
			Seq:         lastOpenedSeq,
		}
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT lesson_id, lesson_completed, completed_at_ms,
		       pb_position_ms, pb_segment_index, pb_duration_ms, pb_updated_at_ms, pb_seq,
		       dg_position_ms, dg_segment_index, dg_duration_ms, dg_updated_at_ms, dg_seq,
		       seq
		FROM lesson_progress
		WHERE group_id = ? AND seq > ?
		ORDER BY seq ASC, lesson_id ASC`,
		dev.GroupID, sinceSeq,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	items := make([]LessonPullOutput, 0)
	for rows.Next() {
		var (
			lessonID      string
			completedInt  int
			completedAtMs int64
			pbPos, pbDur  sql.NullInt64
			pbSeg         sql.NullInt64
			pbUpdatedAt   int64
			pbSeq         int64
			dgPos, dgDur  sql.NullInt64
			dgSeg         sql.NullInt64
			dgUpdatedAt   int64
			dgSeq         int64
			rowSeq        int64
		)
		if err := rows.Scan(
			&lessonID, &completedInt, &completedAtMs,
			&pbPos, &pbSeg, &pbDur, &pbUpdatedAt, &pbSeq,
			&dgPos, &dgSeg, &dgDur, &dgUpdatedAt, &dgSeq,
			&rowSeq,
		); err != nil {
			return nil, err
		}
		items = append(items, LessonPullOutput{
			LessonID:        lessonID,
			LessonCompleted: completedInt != 0,
			CompletedAtMs:   completedAtMs,
			Seq:             rowSeq,
			PB:              buildTrackOutput(pbPos, pbSeg, pbDur, pbUpdatedAt, pbSeq),
			DG:              buildTrackOutput(dgPos, dgSeg, dgDur, dgUpdatedAt, dgSeq),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return &PullResult{
		ServerSeq:  serverSeq,
		HasMore:    false,
		LastOpened: lo,
		Lessons:    items,
	}, nil
}

// ListDevices lists all active (non-revoked) devices in the authenticated device's group.
func (s *Store) ListDevices(ctx context.Context, dev *AuthenticatedDevice) ([]DeviceSummary, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT device_id, device_name, platform, created_at_ms, last_seen_at_ms
		FROM sync_devices
		WHERE group_id = ? AND revoked_at_ms IS NULL
		ORDER BY created_at_ms ASC`,
		dev.GroupID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	return scanDeviceSummaries(rows, dev.DeviceID)
}

// RenameDevice updates the display name of the authenticated device.
func (s *Store) RenameDevice(ctx context.Context, dev *AuthenticatedDevice, newName string) (*DeviceSummary, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	clean := auth.SanitizeDeviceName(newName, dev.Platform)
	if _, err := s.db.ExecContext(ctx, `
		UPDATE sync_devices SET device_name = ? WHERE device_id = ? AND group_id = ? AND revoked_at_ms IS NULL`,
		clean, dev.DeviceID, dev.GroupID,
	); err != nil {
		return nil, err
	}

	var out DeviceSummary
	err := s.db.QueryRowContext(ctx, `
		SELECT device_id, device_name, platform, created_at_ms, last_seen_at_ms
		FROM sync_devices
		WHERE device_id = ? AND group_id = ?`,
		dev.DeviceID, dev.GroupID,
	).Scan(&out.DeviceID, &out.DeviceName, &out.Platform, &out.CreatedAtMs, &out.LastSeenAtMs)
	if err != nil {
		return nil, err
	}
	out.IsCurrent = true
	return &out, nil
}

// RevokeDevice revokes a device in the same group and marks the group orphaned when zero active devices remain.
func (s *Store) RevokeDevice(ctx context.Context, requester *AuthenticatedDevice, targetDeviceID string) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	nowMs := s.now().UnixMilli()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var existingRevoked sql.NullInt64
	err = tx.QueryRowContext(ctx, `
		SELECT revoked_at_ms FROM sync_devices WHERE device_id = ? AND group_id = ?`,
		targetDeviceID, requester.GroupID,
	).Scan(&existingRevoked)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrDeviceNotFound
	}
	if err != nil {
		return err
	}

	if !existingRevoked.Valid {
		if _, err := tx.ExecContext(ctx, `
			UPDATE sync_devices SET revoked_at_ms = ? WHERE device_id = ? AND group_id = ?`,
			nowMs, targetDeviceID, requester.GroupID,
		); err != nil {
			return err
		}
	}

	var activeCount int
	if err := tx.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM sync_devices WHERE group_id = ? AND revoked_at_ms IS NULL`,
		requester.GroupID,
	).Scan(&activeCount); err != nil {
		return err
	}

	if activeCount == 0 {
		if _, err := tx.ExecContext(ctx, `
			UPDATE sync_groups SET orphaned_at_ms = COALESCE(orphaned_at_ms, ?) WHERE group_id = ?`,
			nowMs, requester.GroupID,
		); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// Cleanup deletes expired pairing tickets, 7-day orphaned groups, and 180-day dormant single-device groups.
func (s *Store) Cleanup(ctx context.Context) (CleanupStats, error) {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()

	nowMs := s.now().UnixMilli()
	var stats CleanupStats

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return stats, err
	}
	defer func() { _ = tx.Rollback() }()

	resTickets, err := tx.ExecContext(ctx, `
		DELETE FROM pairing_tickets WHERE expires_at_ms < ?`,
		nowMs-ticketRetentionMs,
	)
	if err != nil {
		return stats, err
	}
	stats.ExpiredTicketsDeleted, _ = resTickets.RowsAffected()

	resOrphaned, err := tx.ExecContext(ctx, `
		DELETE FROM sync_groups WHERE orphaned_at_ms IS NOT NULL AND orphaned_at_ms <= ?`,
		nowMs-orphanRetentionMs,
	)
	if err != nil {
		return stats, err
	}
	stats.OrphanedGroupsDeleted, _ = resOrphaned.RowsAffected()

	resStale, err := tx.ExecContext(ctx, `
		DELETE FROM sync_groups
		WHERE updated_at_ms <= ?
		  AND (SELECT COUNT(*) FROM sync_devices d WHERE d.group_id = sync_groups.group_id AND d.revoked_at_ms IS NULL) <= 1`,
		nowMs-staleGroupAgeMs,
	)
	if err != nil {
		return stats, err
	}
	stats.StaleGroupsDeleted, _ = resStale.RowsAffected()

	if err := tx.Commit(); err != nil {
		return stats, err
	}
	return stats, nil
}

// --- Internal helpers ---

type trackState struct {
	PositionMs   int64
	SegmentIndex *int
	DurationMs   *int64
	UpdatedAtMs  int64
	UpdatedBy    string
	Seq          int64
}

type lessonRow struct {
	GroupID         string
	LessonID        string
	LessonCompleted bool
	CompletedAtMs   int64
	PB              *trackState
	DG              *trackState
	Seq             int64
}

func validatePushRequest(req PushRequest) error {
	if len(req.Lessons) > MaxPushLessons {
		return ErrTooManyLessons
	}
	seen := make(map[string]struct{}, len(req.Lessons))
	for _, l := range req.Lessons {
		if !lessons.IsValid(l.LessonID) {
			return ErrInvalidLessonID
		}
		if _, dup := seen[l.LessonID]; dup {
			return ErrDuplicateLessonID
		}
		seen[l.LessonID] = struct{}{}

		if err := validateTrackInput(l.PB); err != nil {
			return err
		}
		if err := validateTrackInput(l.DG); err != nil {
			return err
		}
	}
	if req.LastOpened != nil && req.LastOpened.LessonID != "" && !lessons.IsValid(req.LastOpened.LessonID) {
		return ErrInvalidLessonID
	}
	return nil
}

func validateTrackInput(in *TrackPointInput) error {
	if in == nil {
		return nil
	}
	if in.PositionMs < 0 || in.PositionMs > MaxTrackDurationMs {
		return ErrInvalidPosition
	}
	if in.DurationMs != nil && (*in.DurationMs < 0 || *in.DurationMs > MaxTrackDurationMs) {
		return ErrInvalidPosition
	}
	if in.SegmentIndex != nil && (*in.SegmentIndex < 0 || *in.SegmentIndex > MaxSegmentIndex) {
		return ErrInvalidPosition
	}
	return nil
}

func clampTS(ts, nowMs int64) int64 {
	minTS := nowMs - pastClockWindowMs
	maxTS := nowMs + futureClockWindowMs
	if ts < minTS {
		return minTS
	}
	if ts > maxTS {
		return maxTS
	}
	return ts
}

func mergeTrack(existing *trackState, incoming *TrackPointInput, nowMs int64, deviceID string, candidateSeq int64) (*trackState, *RejectedConflict) {
	if incoming == nil {
		return nil, nil
	}
	inTS := clampTS(incoming.UpdatedAtMs, nowMs)

	buildAccepted := func() *trackState {
		return &trackState{
			PositionMs:   incoming.PositionMs,
			SegmentIndex: cloneIntPtr(incoming.SegmentIndex),
			DurationMs:   cloneInt64Ptr(incoming.DurationMs),
			UpdatedAtMs:  inTS,
			UpdatedBy:    deviceID,
			Seq:          candidateSeq,
		}
	}

	if existing == nil {
		return buildAccepted(), nil
	}
	if incoming.BaseSeq >= existing.Seq {
		if sameTrackValues(existing, incoming) {
			return nil, nil
		}
		return buildAccepted(), nil
	}

	// Concurrent offline edit: incoming.BaseSeq < existing.Seq
	if inTS > existing.UpdatedAtMs {
		return buildAccepted(), nil
	}
	if inTS == existing.UpdatedAtMs {
		if incoming.PositionMs > existing.PositionMs {
			return buildAccepted(), nil
		}
		if incoming.PositionMs == existing.PositionMs {
			if sameTrackValues(existing, incoming) {
				return nil, nil
			}
			if deviceID > existing.UpdatedBy {
				return buildAccepted(), nil
			}
		}
	}

	return nil, &RejectedConflict{
		Reason: "stale_concurrent_edit",
		ServerTrack: &TrackPointOutput{
			PositionMs:   existing.PositionMs,
			SegmentIndex: cloneIntPtr(existing.SegmentIndex),
			DurationMs:   cloneInt64Ptr(existing.DurationMs),
			UpdatedAtMs:  existing.UpdatedAtMs,
			Seq:          existing.Seq,
		},
	}
}

func sameTrackValues(existing *trackState, incoming *TrackPointInput) bool {
	if existing.PositionMs != incoming.PositionMs {
		return false
	}
	if !equalIntPtr(existing.SegmentIndex, incoming.SegmentIndex) {
		return false
	}
	return equalInt64Ptr(existing.DurationMs, incoming.DurationMs)
}

func loadLessonRowTx(ctx context.Context, tx *sql.Tx, groupID, lessonID string) (lessonRow, bool, error) {
	var (
		row          lessonRow
		completedInt int
		pbPos, pbDur sql.NullInt64
		pbSeg        sql.NullInt64
		pbUpdatedAt  int64
		pbBy         sql.NullString
		pbSeq        int64
		dgPos, dgDur sql.NullInt64
		dgSeg        sql.NullInt64
		dgUpdatedAt  int64
		dgBy         sql.NullString
		dgSeq        int64
	)
	err := tx.QueryRowContext(ctx, `
		SELECT lesson_completed, completed_at_ms,
		       pb_position_ms, pb_segment_index, pb_duration_ms, pb_updated_at_ms, pb_updated_by, pb_seq,
		       dg_position_ms, dg_segment_index, dg_duration_ms, dg_updated_at_ms, dg_updated_by, dg_seq,
		       seq
		FROM lesson_progress
		WHERE group_id = ? AND lesson_id = ?`,
		groupID, lessonID,
	).Scan(
		&completedInt, &row.CompletedAtMs,
		&pbPos, &pbSeg, &pbDur, &pbUpdatedAt, &pbBy, &pbSeq,
		&dgPos, &dgSeg, &dgDur, &dgUpdatedAt, &dgBy, &dgSeq,
		&row.Seq,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return lessonRow{}, false, nil
	}
	if err != nil {
		return lessonRow{}, false, err
	}
	row.GroupID = groupID
	row.LessonID = lessonID
	row.LessonCompleted = completedInt != 0
	row.PB = buildTrackState(pbPos, pbSeg, pbDur, pbUpdatedAt, pbBy, pbSeq)
	row.DG = buildTrackState(dgPos, dgSeg, dgDur, dgUpdatedAt, dgBy, dgSeq)
	return row, true, nil
}

func upsertLessonRowTx(ctx context.Context, tx *sql.Tx, row lessonRow) error {
	completedInt := 0
	if row.LessonCompleted {
		completedInt = 1
	}
	pbPos, pbSeg, pbDur, pbTS, pbBy, pbSeq := unpackTrackState(row.PB)
	dgPos, dgSeg, dgDur, dgTS, dgBy, dgSeq := unpackTrackState(row.DG)

	_, err := tx.ExecContext(ctx, `
		INSERT INTO lesson_progress (
			group_id, lesson_id, lesson_completed, completed_at_ms,
			pb_position_ms, pb_segment_index, pb_duration_ms, pb_updated_at_ms, pb_updated_by, pb_seq,
			dg_position_ms, dg_segment_index, dg_duration_ms, dg_updated_at_ms, dg_updated_by, dg_seq,
			seq
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(group_id, lesson_id) DO UPDATE SET
			lesson_completed = excluded.lesson_completed,
			completed_at_ms  = excluded.completed_at_ms,
			pb_position_ms   = excluded.pb_position_ms,
			pb_segment_index = excluded.pb_segment_index,
			pb_duration_ms   = excluded.pb_duration_ms,
			pb_updated_at_ms = excluded.pb_updated_at_ms,
			pb_updated_by    = excluded.pb_updated_by,
			pb_seq           = excluded.pb_seq,
			dg_position_ms   = excluded.dg_position_ms,
			dg_segment_index = excluded.dg_segment_index,
			dg_duration_ms   = excluded.dg_duration_ms,
			dg_updated_at_ms = excluded.dg_updated_at_ms,
			dg_updated_by    = excluded.dg_updated_by,
			dg_seq           = excluded.dg_seq,
			seq              = excluded.seq`,
		row.GroupID, row.LessonID, completedInt, row.CompletedAtMs,
		pbPos, pbSeg, pbDur, pbTS, pbBy, pbSeq,
		dgPos, dgSeg, dgDur, dgTS, dgBy, dgSeq,
		row.Seq,
	)
	return err
}

func queryActiveDevicesTx(ctx context.Context, tx *sql.Tx, groupID, currentDeviceID string) ([]DeviceSummary, error) {
	rows, err := tx.QueryContext(ctx, `
		SELECT device_id, device_name, platform, created_at_ms, last_seen_at_ms
		FROM sync_devices
		WHERE group_id = ? AND revoked_at_ms IS NULL
		ORDER BY created_at_ms ASC`,
		groupID,
	)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()
	return scanDeviceSummaries(rows, currentDeviceID)
}

func scanDeviceSummaries(rows *sql.Rows, currentDeviceID string) ([]DeviceSummary, error) {
	out := make([]DeviceSummary, 0)
	for rows.Next() {
		var d DeviceSummary
		if err := rows.Scan(&d.DeviceID, &d.DeviceName, &d.Platform, &d.CreatedAtMs, &d.LastSeenAtMs); err != nil {
			return nil, err
		}
		d.IsCurrent = d.DeviceID == currentDeviceID
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func buildTrackState(pos, seg, dur sql.NullInt64, updatedAt int64, updatedBy sql.NullString, seq int64) *trackState {
	if !pos.Valid {
		return nil
	}
	t := &trackState{
		PositionMs:  pos.Int64,
		UpdatedAtMs: updatedAt,
		UpdatedBy:   updatedBy.String,
		Seq:         seq,
	}
	if seg.Valid {
		v := int(seg.Int64)
		t.SegmentIndex = &v
	}
	if dur.Valid {
		v := dur.Int64
		t.DurationMs = &v
	}
	return t
}

func buildTrackOutput(pos, seg, dur sql.NullInt64, updatedAt, seq int64) *TrackPointOutput {
	if !pos.Valid {
		return nil
	}
	t := &TrackPointOutput{
		PositionMs:  pos.Int64,
		UpdatedAtMs: updatedAt,
		Seq:         seq,
	}
	if seg.Valid {
		v := int(seg.Int64)
		t.SegmentIndex = &v
	}
	if dur.Valid {
		v := dur.Int64
		t.DurationMs = &v
	}
	return t
}

func unpackTrackState(t *trackState) (pos, seg, dur sql.NullInt64, updatedAt int64, updatedBy sql.NullString, seq int64) {
	if t == nil {
		return
	}
	pos = sql.NullInt64{Int64: t.PositionMs, Valid: true}
	if t.SegmentIndex != nil {
		seg = sql.NullInt64{Int64: int64(*t.SegmentIndex), Valid: true}
	}
	if t.DurationMs != nil {
		dur = sql.NullInt64{Int64: *t.DurationMs, Valid: true}
	}
	updatedAt = t.UpdatedAtMs
	if t.UpdatedBy != "" {
		updatedBy = sql.NullString{String: t.UpdatedBy, Valid: true}
	}
	seq = t.Seq
	return
}

func cloneIntPtr(p *int) *int {
	if p == nil {
		return nil
	}
	v := *p
	return &v
}

func cloneInt64Ptr(p *int64) *int64 {
	if p == nil {
		return nil
	}
	v := *p
	return &v
}

func equalIntPtr(a, b *int) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func equalInt64Ptr(a, b *int64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

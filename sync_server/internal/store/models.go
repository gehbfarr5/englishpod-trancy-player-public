package store

import "errors"

const (
	// MaxTrackDurationMs bounds positionMs and durationMs to 2 hours.
	MaxTrackDurationMs int64 = 7_200_000
	// MaxSegmentIndex bounds transcript segment indices.
	MaxSegmentIndex = 5000
	// MaxPushLessons caps a single push payload to the canonical 335-lesson set.
	MaxPushLessons = 335
)

var (
	ErrUnauthorized      = errors.New("unauthorized")
	ErrDeviceRevoked     = errors.New("device revoked")
	ErrCodeNotFound      = errors.New("pairing code not found")
	ErrCodeExpired       = errors.New("pairing code expired")
	ErrCodeUsed          = errors.New("pairing code already used")
	ErrGroupFull         = errors.New("sync group has reached device limit")
	ErrDeviceNotFound    = errors.New("device not found in group")
	ErrInvalidLessonID   = errors.New("invalid lesson id")
	ErrInvalidPosition   = errors.New("invalid track position or segment index")
	ErrTooManyLessons    = errors.New("too many lessons in push")
	ErrDuplicateLessonID = errors.New("duplicate lesson id in push")
)

// AuthenticatedDevice represents an active device authenticated by bearer token.
type AuthenticatedDevice struct {
	DeviceID   string
	GroupID    string
	DeviceName string
	Platform   string
}

// CreatePairResult contains newly generated pairing ticket fields.
type CreatePairResult struct {
	GroupID     string `json:"groupId"`
	DeviceID    string `json:"deviceId"`
	DeviceToken string `json:"deviceToken,omitempty"`
	Code        string `json:"code"`
	DisplayCode string `json:"displayCode"`
	QRPayload   string `json:"qrPayload"`
	ExpiresAtMs int64  `json:"expiresAtMs"`
}

// ClaimedDeviceInfo summarizes the device that consumed a pairing ticket.
type ClaimedDeviceInfo struct {
	DeviceID     string `json:"deviceId"`
	DeviceName   string `json:"deviceName"`
	Platform     string `json:"platform"`
	ConsumedAtMs int64  `json:"consumedAtMs"`
}

// PairingStatusResult describes the lifecycle state of a pairing ticket.
type PairingStatusResult struct {
	Code          string             `json:"code"`
	DisplayCode   string             `json:"displayCode"`
	Status        string             `json:"status"` // pending | consumed | expired
	ExpiresAtMs   int64              `json:"expiresAtMs"`
	ClaimedDevice *ClaimedDeviceInfo `json:"claimedDevice,omitempty"`
}

// DeviceSummary represents an active device in a sync group.
type DeviceSummary struct {
	DeviceID     string `json:"deviceId"`
	DeviceName   string `json:"deviceName"`
	Platform     string `json:"platform"`
	CreatedAtMs  int64  `json:"createdAtMs"`
	LastSeenAtMs int64  `json:"lastSeenAtMs"`
	IsCurrent    bool   `json:"isCurrent"`
}

// ClaimPairResult contains credentials and device list returned after claiming a ticket.
type ClaimPairResult struct {
	GroupID        string          `json:"groupId"`
	DeviceID       string          `json:"deviceId"`
	DeviceToken    string          `json:"deviceToken,omitempty"`
	ServerSeq      int64           `json:"serverSeq"`
	Devices        []DeviceSummary `json:"devices"`
	Merged         bool            `json:"merged,omitempty"`
	AlreadyInGroup bool            `json:"alreadyInGroup,omitempty"`
}

// TrackPointInput is an incoming committed position update for podcast or dialogue.
type TrackPointInput struct {
	PositionMs   int64 `json:"positionMs"`
	SegmentIndex *int  `json:"segmentIndex,omitempty"`
	DurationMs   *int64 `json:"durationMs,omitempty"`
	UpdatedAtMs  int64 `json:"updatedAtMs"`
	BaseSeq      int64 `json:"baseSeq"`
}

// TrackPointOutput is the authoritative server representation of a track breakpoint.
type TrackPointOutput struct {
	PositionMs   int64  `json:"positionMs"`
	SegmentIndex *int   `json:"segmentIndex,omitempty"`
	DurationMs   *int64 `json:"durationMs,omitempty"`
	UpdatedAtMs  int64  `json:"updatedAtMs"`
	Seq          int64  `json:"seq"`
}

// LastOpenedInput is an incoming update to the global resume anchor.
type LastOpenedInput struct {
	LessonID    string `json:"lessonId"`
	UpdatedAtMs int64  `json:"updatedAtMs"`
	BaseSeq     int64  `json:"baseSeq"`
}

// LastOpenedOutput is the authoritative global resume anchor.
type LastOpenedOutput struct {
	LessonID    string `json:"lessonId"`
	UpdatedAtMs int64  `json:"updatedAtMs"`
	Seq         int64  `json:"seq"`
}

// LessonPushInput describes changes for one canonical lesson.
type LessonPushInput struct {
	LessonID        string           `json:"lessonId"`
	LessonCompleted bool             `json:"lessonCompleted"`
	CompletedAtMs   int64            `json:"completedAtMs,omitempty"`
	PB              *TrackPointInput `json:"pb,omitempty"`
	DG              *TrackPointInput `json:"dg,omitempty"`
}

// PushRequest is the payload accepted by POST /api/sync/v1/sync/push.
type PushRequest struct {
	Lessons    []LessonPushInput `json:"lessons"`
	LastOpened *LastOpenedInput  `json:"lastOpened,omitempty"`
}

// RejectedConflict communicates a concurrent edit rejected in favor of server state.
type RejectedConflict struct {
	LessonID    string            `json:"lessonId"`
	Track       string            `json:"track"` // pb | dg
	Reason      string            `json:"reason"`
	ServerTrack *TrackPointOutput `json:"serverTrack"`
}

// PushResult summarizes the outcome of a transactional push merge.
type PushResult struct {
	ServerSeq         int64              `json:"serverSeq"`
	AcceptedLessons   []string           `json:"acceptedLessons"`
	RejectedConflicts []RejectedConflict `json:"rejectedConflicts"`
	LastOpened        *LastOpenedOutput  `json:"lastOpened,omitempty"`
}

// LessonPullOutput is one lesson row returned by GET /api/sync/v1/sync/pull.
type LessonPullOutput struct {
	LessonID        string            `json:"lessonId"`
	LessonCompleted bool              `json:"lessonCompleted"`
	CompletedAtMs   int64             `json:"completedAtMs,omitempty"`
	Seq             int64             `json:"seq"`
	PB              *TrackPointOutput `json:"pb"`
	DG              *TrackPointOutput `json:"dg"`
}

// PullResult is the delta payload returned by GET /api/sync/v1/sync/pull.
type PullResult struct {
	ServerSeq  int64              `json:"serverSeq"`
	HasMore    bool               `json:"hasMore"`
	LastOpened *LastOpenedOutput  `json:"lastOpened"`
	Lessons    []LessonPullOutput `json:"lessons"`
}

// CleanupStats reports row counts removed by a background maintenance sweep.
type CleanupStats struct {
	ExpiredTicketsDeleted int64
	OrphanedGroupsDeleted int64
	StaleGroupsDeleted    int64
}

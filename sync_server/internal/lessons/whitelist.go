// Package lessons provides the static canonical whitelist of EnglishPod lesson IDs.
package lessons

import (
	"fmt"
	"sort"
)

const totalLessons = 335

var (
	validIDs map[string]struct{}
	ordered  []string
)

func init() {
	validIDs = make(map[string]struct{}, totalLessons)
	ordered = make([]string, 0, totalLessons)

	addRange := func(start, end int) {
		for i := start; i <= end; i++ {
			id := fmt.Sprintf("%04d", i)
			validIDs[id] = struct{}{}
			ordered = append(ordered, id)
		}
	}

	// Canonical 335 EnglishPod lessons: 0001..0120 (120) and 0151..0365 (215).
	addRange(1, 120)
	addRange(151, 365)
	sort.Strings(ordered)
}

// IsValid reports whether lessonID belongs to the canonical 335-lesson whitelist.
func IsValid(lessonID string) bool {
	_, ok := validIDs[lessonID]
	return ok
}

// Count returns the total number of canonical lessons in the whitelist.
func Count() int {
	return len(ordered)
}

// All returns a defensive copy of all canonical lesson IDs in ascending order.
func All() []string {
	out := make([]string, len(ordered))
	copy(out, ordered)
	return out
}

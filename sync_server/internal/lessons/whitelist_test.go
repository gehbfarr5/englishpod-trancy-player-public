package lessons

import "testing"

func TestWhitelistCountAndBoundaries(t *testing.T) {
	if got := Count(); got != 335 {
		t.Fatalf("Count() = %d, want 335", got)
	}
	if all := All(); len(all) != 335 || all[0] != "0001" || all[len(all)-1] != "0365" {
		t.Fatalf("unexpected All() boundaries: len=%d first=%v last=%v", len(all), all[0], all[len(all)-1])
	}

	validCases := []string{"0001", "0009", "0120", "0151", "0250", "0365"}
	for _, id := range validCases {
		if !IsValid(id) {
			t.Errorf("IsValid(%q) = false, want true", id)
		}
	}

	invalidCases := []string{
		"",
		"0000",
		"1",
		"001",
		"0001 ",
		" 0001",
		"0121",
		"0135",
		"0150",
		"0366",
		"9999",
		"B0001",
		"../0001",
	}
	for _, id := range invalidCases {
		if IsValid(id) {
			t.Errorf("IsValid(%q) = true, want false", id)
		}
	}
}

func TestAllReturnsDefensiveCopy(t *testing.T) {
	copySlice := All()
	copySlice[0] = "corrupted"
	if !IsValid("0001") || All()[0] != "0001" {
		t.Fatalf("mutating All() return value modified internal state")
	}
}

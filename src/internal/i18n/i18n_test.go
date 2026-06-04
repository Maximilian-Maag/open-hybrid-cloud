package i18n

import "testing"

func TestT_positive(t *testing.T) {
	got := T("common.save", "de")
	want := "Speichern"
	if got != want {
		t.Errorf("T(common.save, de): want %q, got %q", want, got)
	}

	got = T("common.save", "en")
	want = "Save"
	if got != want {
		t.Errorf("T(common.save, en): want %q, got %q", want, got)
	}
}

func TestT_negative_unknownKey(t *testing.T) {
	key := "this.key.does.not.exist"
	got := T(key, "de")
	if got != key {
		t.Errorf("unknown key: want key returned as-is %q, got %q", key, got)
	}
}

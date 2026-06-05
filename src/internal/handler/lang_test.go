package handler

import (
	"net/http"
	"testing"
)

func TestParseAcceptLanguage(t *testing.T) {
	tests := []struct {
		header string
		want   string
	}{
		{"de", "de"},
		{"en", "en"},
		{"fr", "fr"},
		{"de-AT", "de"},
		{"de-CH", "de"},
		{"en-US", "en"},
		{"de-CH,de;q=0.9,en;q=0.8", "de"},
		{"en-US,en;q=0.9,de;q=0.8", "en"},
		{"fr-CH, fr;q=0.9, de;q=0.8", "fr"},
		{"de;q=0.9", "de"},
		{"xx", ""},
		{"xx-YY", ""},
		{"", ""},
	}
	for _, tc := range tests {
		t.Run(tc.header, func(t *testing.T) {
			if got := parseAcceptLanguage(tc.header); got != tc.want {
				t.Errorf("parseAcceptLanguage(%q) = %q, want %q", tc.header, got, tc.want)
			}
		})
	}
}

func TestIsSupportedLang_positive(t *testing.T) {
	for _, lang := range []string{"de", "en", "fr", "it", "es", "ru"} {
		if !isSupportedLang(lang) {
			t.Errorf("isSupportedLang(%q) = false, want true", lang)
		}
	}
}

func TestIsSupportedLang_negative(t *testing.T) {
	for _, lang := range []string{"xx", "", "zz", "de-AT", "en-US"} {
		if isSupportedLang(lang) {
			t.Errorf("isSupportedLang(%q) = true, want false", lang)
		}
	}
}

func TestDetectLang_sessLangTakesPriority(t *testing.T) {
	r, _ := http.NewRequest("GET", "/", nil)
	r.Header.Set("Accept-Language", "en")
	if got := detectLang(r, "de"); got != "de" {
		t.Errorf("detectLang with sessLang 'de': got %q, want 'de'", got)
	}
}

func TestDetectLang_unsupportedSessLangFallsBackToHeader(t *testing.T) {
	r, _ := http.NewRequest("GET", "/", nil)
	r.Header.Set("Accept-Language", "fr")
	if got := detectLang(r, "xx"); got != "fr" {
		t.Errorf("detectLang with unsupported sessLang 'xx': got %q, want 'fr'", got)
	}
}

func TestDetectLang_fallbackToAcceptLanguage(t *testing.T) {
	r, _ := http.NewRequest("GET", "/", nil)
	r.Header.Set("Accept-Language", "en-US,en;q=0.9")
	if got := detectLang(r, ""); got != "en" {
		t.Errorf("detectLang with Accept-Language 'en-US': got %q, want 'en'", got)
	}
}

func TestDetectLang_fallbackToDeWhenNoHints(t *testing.T) {
	r, _ := http.NewRequest("GET", "/", nil)
	if got := detectLang(r, ""); got != "de" {
		t.Errorf("detectLang with no hints: got %q, want 'de'", got)
	}
}

func TestDetectLang_unsupportedAcceptLanguageFallsToDe(t *testing.T) {
	r, _ := http.NewRequest("GET", "/", nil)
	r.Header.Set("Accept-Language", "xx-YY")
	if got := detectLang(r, ""); got != "de" {
		t.Errorf("detectLang with unsupported Accept-Language: got %q, want 'de'", got)
	}
}

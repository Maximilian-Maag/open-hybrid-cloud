package exchange

import "testing"

func TestConvert_positive(t *testing.T) {
	svc := NewService("", "")
	svc.LoadRates(map[string]float64{"EUR": 1.0, "USD": 1.1})

	got := svc.Convert(100, "EUR", "USD")
	// floating point: 100 * 1.1 may not be exactly 110.0
	if got < 109.99 || got > 110.01 {
		t.Errorf("Convert(100 EUR→USD): want ~110.0, got %.6f", got)
	}

	// Same currency — must return unchanged
	got = svc.Convert(50, "EUR", "EUR")
	if got != 50 {
		t.Errorf("Convert same currency: want 50, got %.2f", got)
	}
}

func TestConvert_negative_unknownCurrency(t *testing.T) {
	svc := NewService("", "")
	// No rates loaded for XYZ or ABC

	got := svc.Convert(100, "XYZ", "ABC")
	if got != 100 {
		t.Errorf("Convert unknown currencies: want original 100, got %.2f", got)
	}
}

func TestLocaleCurrency_positive(t *testing.T) {
	if got := LocaleCurrency("de"); got != "EUR" {
		t.Errorf("LocaleCurrency(de): want EUR, got %s", got)
	}
	if got := LocaleCurrency("pl"); got != "PLN" {
		t.Errorf("LocaleCurrency(pl): want PLN, got %s", got)
	}
}

func TestLocaleCurrency_negative_unknown(t *testing.T) {
	got := LocaleCurrency("xx")
	if got != "USD" {
		t.Errorf("LocaleCurrency(unknown): want USD fallback, got %s", got)
	}
}

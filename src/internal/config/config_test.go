package config

import (
	"os"
	"testing"
)

func TestLoad_positive(t *testing.T) {
	os.Setenv("SESSION_SECRET", "a-secret-that-is-long-enough-32ch")
	os.Setenv("ADMIN_PASSWORD", "hunter2")
	os.Setenv("PORT", "9090")
	os.Setenv("BASE_CURRENCY", "CHF")
	defer func() {
		os.Unsetenv("SESSION_SECRET")
		os.Unsetenv("ADMIN_PASSWORD")
		os.Unsetenv("PORT")
		os.Unsetenv("BASE_CURRENCY")
	}()

	cfg := Load()

	if cfg.Port != "9090" {
		t.Errorf("Port: want 9090, got %s", cfg.Port)
	}
	if cfg.BaseCurrency != "CHF" {
		t.Errorf("BaseCurrency: want CHF, got %s", cfg.BaseCurrency)
	}
	if cfg.SessionSecret != "a-secret-that-is-long-enough-32ch" {
		t.Errorf("SessionSecret mismatch")
	}
}

func TestLoad_negative_missingSessionSecret(t *testing.T) {
	os.Unsetenv("SESSION_SECRET")
	os.Setenv("ADMIN_PASSWORD", "hunter2")
	defer os.Unsetenv("ADMIN_PASSWORD")

	panicked := false
	func() {
		defer func() {
			if r := recover(); r != nil {
				panicked = true
			}
		}()
		Load()
	}()

	if !panicked {
		t.Error("expected panic when SESSION_SECRET is unset")
	}
}

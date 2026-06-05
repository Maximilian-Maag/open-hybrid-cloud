package handler

import (
	"net/http"
	"testing"
	"time"
)

func TestLoginRateLimiter_allowedForNewIP(t *testing.T) {
	rl := newLoginRateLimiter()
	if !rl.allowed("1.2.3.4") {
		t.Error("allowed: expected true for new IP, got false")
	}
}

func TestLoginRateLimiter_allowedBelowMaxAttempts(t *testing.T) {
	rl := newLoginRateLimiter()
	for range rlMaxAttempts - 1 {
		rl.record("1.2.3.4")
	}
	if !rl.allowed("1.2.3.4") {
		t.Errorf("allowed: expected true after %d attempts, got false", rlMaxAttempts-1)
	}
}

func TestLoginRateLimiter_blockedAfterMaxAttempts(t *testing.T) {
	rl := newLoginRateLimiter()
	for range rlMaxAttempts {
		rl.record("1.2.3.4")
	}
	if rl.allowed("1.2.3.4") {
		t.Errorf("allowed: expected false after %d failed attempts, got true", rlMaxAttempts)
	}
}

func TestLoginRateLimiter_clearResetsBlock(t *testing.T) {
	rl := newLoginRateLimiter()
	for range rlMaxAttempts {
		rl.record("1.2.3.4")
	}
	rl.clear("1.2.3.4")
	if !rl.allowed("1.2.3.4") {
		t.Error("allowed: expected true after clear, got false")
	}
}

func TestLoginRateLimiter_clearUnknownIPIsNoop(t *testing.T) {
	rl := newLoginRateLimiter()
	rl.clear("9.9.9.9") // must not panic
}

func TestLoginRateLimiter_differentIPsAreIndependent(t *testing.T) {
	rl := newLoginRateLimiter()
	for range rlMaxAttempts {
		rl.record("1.1.1.1")
	}
	if !rl.allowed("2.2.2.2") {
		t.Error("allowed: blocking 1.1.1.1 must not affect 2.2.2.2")
	}
}

func TestLoginRateLimiter_expiredWindowAllowsAgain(t *testing.T) {
	rl := newLoginRateLimiter()
	for range rlMaxAttempts {
		rl.record("1.2.3.4")
	}
	rl.mu.Lock()
	rl.entries["1.2.3.4"].resetAt = time.Now().Add(-time.Second)
	rl.mu.Unlock()

	if !rl.allowed("1.2.3.4") {
		t.Error("allowed: expected true after window expiry, got false")
	}
}

func TestLoginRateLimiter_recordAfterWindowExpiryResetsCount(t *testing.T) {
	rl := newLoginRateLimiter()
	for range rlMaxAttempts {
		rl.record("1.2.3.4")
	}
	rl.mu.Lock()
	rl.entries["1.2.3.4"].resetAt = time.Now().Add(-time.Second)
	rl.mu.Unlock()

	rl.record("1.2.3.4") // window expired → resets to count=1
	if !rl.allowed("1.2.3.4") {
		t.Error("allowed: expected true after window reset via record, got false")
	}
}

func TestRemoteIP_IPv4WithPort(t *testing.T) {
	r, _ := http.NewRequest("GET", "/", nil)
	r.RemoteAddr = "192.168.1.100:12345"
	if got := remoteIP(r); got != "192.168.1.100" {
		t.Errorf("remoteIP: got %q, want %q", got, "192.168.1.100")
	}
}

func TestRemoteIP_IPv6WithPort(t *testing.T) {
	r, _ := http.NewRequest("GET", "/", nil)
	r.RemoteAddr = "[::1]:8080"
	if got := remoteIP(r); got != "::1" {
		t.Errorf("remoteIP: got %q, want %q", got, "::1")
	}
}

func TestRemoteIP_noPort(t *testing.T) {
	r, _ := http.NewRequest("GET", "/", nil)
	r.RemoteAddr = "192.168.1.1"
	if got := remoteIP(r); got != "192.168.1.1" {
		t.Errorf("remoteIP: got %q, want %q", got, "192.168.1.1")
	}
}

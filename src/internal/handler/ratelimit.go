package handler

import (
	"net"
	"net/http"
	"sync"
	"time"
)

const (
	rlMaxAttempts = 5
	rlWindow      = 15 * time.Minute
)

type rlEntry struct {
	count   int
	resetAt time.Time
}

type loginRateLimiter struct {
	mu      sync.Mutex
	entries map[string]*rlEntry
}

func newLoginRateLimiter() *loginRateLimiter {
	return &loginRateLimiter{entries: make(map[string]*rlEntry)}
}

// allowed returns true if the IP is still within its attempt budget.
func (rl *loginRateLimiter) allowed(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	rl.cleanup()
	e, ok := rl.entries[ip]
	if !ok {
		return true
	}
	return e.count < rlMaxAttempts
}

// record increments the failure counter for ip.
func (rl *loginRateLimiter) record(ip string) {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	e, ok := rl.entries[ip]
	if !ok || time.Now().After(e.resetAt) {
		rl.entries[ip] = &rlEntry{count: 1, resetAt: time.Now().Add(rlWindow)}
		return
	}
	e.count++
}

// clear removes the entry for ip on successful login.
func (rl *loginRateLimiter) clear(ip string) {
	rl.mu.Lock()
	delete(rl.entries, ip)
	rl.mu.Unlock()
}

// cleanup removes expired entries; must be called with mu held.
func (rl *loginRateLimiter) cleanup() {
	now := time.Now()
	for ip, e := range rl.entries {
		if now.After(e.resetAt) {
			delete(rl.entries, ip)
		}
	}
}

func remoteIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

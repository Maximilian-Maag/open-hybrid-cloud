package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"

	"github.com/gorilla/securecookie"
	"github.com/porr-ag/infra-webshop/internal/model"
)

const cookieName = "infra_session"

type SessionData struct {
	UserID int64      `json:"uid"`
	Email  string     `json:"email"`
	Name   string     `json:"name"`
	Role   model.Role `json:"role"`
	Lang   string     `json:"lang"`
}

type SessionStore struct {
	sc *securecookie.SecureCookie
}

func NewSessionStore(secret string) *SessionStore {
	key := []byte(secret)
	hashKey := key
	blockKey := make([]byte, 32)
	copy(blockKey, key)
	return &SessionStore{sc: securecookie.New(hashKey, blockKey)}
}

func (s *SessionStore) Set(w http.ResponseWriter, d SessionData) error {
	encoded, err := s.sc.Encode(cookieName, d)
	if err != nil {
		return err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    encoded,
		Path:     "/",
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
		Secure:   false, // true in production behind TLS
	})
	return nil
}

func (s *SessionStore) Get(r *http.Request) (*SessionData, bool) {
	c, err := r.Cookie(cookieName)
	if err != nil {
		return nil, false
	}
	var d SessionData
	if err := s.sc.Decode(cookieName, c.Value, &d); err != nil {
		return nil, false
	}
	return &d, true
}

func (s *SessionStore) Clear(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     cookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
	})
}

// Context key for session data
type ctxKey struct{}

func WithSession(ctx context.Context, d *SessionData) context.Context {
	return context.WithValue(ctx, ctxKey{}, d)
}

func FromContext(ctx context.Context) (*SessionData, bool) {
	d, ok := ctx.Value(ctxKey{}).(*SessionData)
	return d, ok && d != nil
}

// FlashData carries a one-time UI message stored in a separate cookie.
type FlashData struct {
	Kind    string `json:"k"` // "success" | "error"
	Message string `json:"m"`
}

const flashCookie = "infra_flash"

func (s *SessionStore) SetFlash(w http.ResponseWriter, kind, msg string) {
	b, _ := json.Marshal(FlashData{Kind: kind, Message: msg})
	// Cookie values must not contain raw double-quotes or other invalid
	// characters. URL-escape the JSON payload so it is safe to roundtrip.
	v := url.QueryEscape(string(b))
	http.SetCookie(w, &http.Cookie{
		Name:     flashCookie,
		Value:    v,
		Path:     "/",
		HttpOnly: true,
		MaxAge:   60,
	})
}

func (s *SessionStore) PopFlash(w http.ResponseWriter, r *http.Request) *FlashData {
	c, err := r.Cookie(flashCookie)
	if err != nil {
		return nil
	}
	http.SetCookie(w, &http.Cookie{Name: flashCookie, Value: "", Path: "/", MaxAge: -1})
	var f FlashData
	// Decode the URL-escaped payload before unmarshalling JSON.
	dec, err2 := url.QueryUnescape(c.Value)
	if err2 != nil {
		return nil
	}
	if err := json.Unmarshal([]byte(dec), &f); err != nil {
		return nil
	}
	return &f
}

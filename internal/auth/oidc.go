package auth

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"net/http"

	gooidc "github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

type OIDCConfig struct {
	TenantID     string
	ClientID     string
	ClientSecret string
	RedirectURL  string
}

type OIDCProvider struct {
	provider *gooidc.Provider
	oauth2   oauth2.Config
	verifier *gooidc.IDTokenVerifier
}

const oidcStateCookie = "oidc_state"

func NewOIDCProvider(ctx context.Context, cfg OIDCConfig) (*OIDCProvider, error) {
	if cfg.TenantID == "" {
		return nil, nil // OIDC not configured
	}
	issuer := fmt.Sprintf("https://login.microsoftonline.com/%s/v2.0", cfg.TenantID)
	p, err := gooidc.NewProvider(ctx, issuer)
	if err != nil {
		return nil, fmt.Errorf("oidc provider: %w", err)
	}
	return &OIDCProvider{
		provider: p,
		oauth2: oauth2.Config{
			ClientID:     cfg.ClientID,
			ClientSecret: cfg.ClientSecret,
			RedirectURL:  cfg.RedirectURL,
			Endpoint:     p.Endpoint(),
			Scopes:       []string{gooidc.ScopeOpenID, "profile", "email"},
		},
		verifier: p.Verifier(&gooidc.Config{ClientID: cfg.ClientID}),
	}, nil
}

func (o *OIDCProvider) StartAuth(w http.ResponseWriter, r *http.Request) {
	state := randomState()
	http.SetCookie(w, &http.Cookie{
		Name:     oidcStateCookie,
		Value:    state,
		Path:     "/",
		HttpOnly: true,
		MaxAge:   300,
	})
	http.Redirect(w, r, o.oauth2.AuthCodeURL(state), http.StatusFound)
}

type OIDCClaims struct {
	Sub   string `json:"sub"`
	Email string `json:"email"`
	Name  string `json:"name"`
}

func (o *OIDCProvider) HandleCallback(r *http.Request) (*OIDCClaims, error) {
	stateCookie, err := r.Cookie(oidcStateCookie)
	if err != nil || stateCookie.Value != r.URL.Query().Get("state") {
		return nil, fmt.Errorf("invalid state")
	}

	token, err := o.oauth2.Exchange(r.Context(), r.URL.Query().Get("code"))
	if err != nil {
		return nil, fmt.Errorf("exchange code: %w", err)
	}

	raw, ok := token.Extra("id_token").(string)
	if !ok {
		return nil, fmt.Errorf("missing id_token")
	}

	idToken, err := o.verifier.Verify(r.Context(), raw)
	if err != nil {
		return nil, fmt.Errorf("verify id_token: %w", err)
	}

	var claims OIDCClaims
	if err := idToken.Claims(&claims); err != nil {
		return nil, fmt.Errorf("parse claims: %w", err)
	}
	return &claims, nil
}

func randomState() string {
	b := make([]byte, 16)
	rand.Read(b)
	return base64.URLEncoding.EncodeToString(b)
}

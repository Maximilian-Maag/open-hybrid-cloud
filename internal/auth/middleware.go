package auth

import (
	"net/http"

	"github.com/porr-ag/infra-webshop/internal/model"
)

// Require returns middleware that ensures a valid session exists.
// Unauthenticated requests are redirected to /login.
func (s *SessionStore) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		d, ok := s.Get(r)
		if !ok {
			http.Redirect(w, r, "/login", http.StatusSeeOther)
			return
		}
		next.ServeHTTP(w, r.WithContext(WithSession(r.Context(), d)))
	})
}

// RequireRole returns middleware that additionally enforces a minimum role.
func (s *SessionStore) RequireRole(role model.Role, next http.Handler) http.Handler {
	return s.Require(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		d, _ := FromContext(r.Context())
		if !hasRole(d.Role, role) {
			http.Error(w, "forbidden", http.StatusForbidden)
			return
		}
		next.ServeHTTP(w, r)
	}))
}

// hasRole returns true if actual meets or exceeds required level.
// Role hierarchy: shop_admin > admin > project_leader
func hasRole(actual, required model.Role) bool {
	rank := map[model.Role]int{
		model.RoleProjectLeader: 1,
		model.RoleAdmin:         2,
		model.RoleShopAdmin:     3,
	}
	return rank[actual] >= rank[required]
}

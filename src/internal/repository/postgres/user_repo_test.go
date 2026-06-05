package postgres

import (
	"context"
	"testing"

	"github.com/open-hybrid-cloud/open-hybrid-cloud/src/internal/model"
)

func TestUserRepo_SaveAndFindByID(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo := NewUserRepository(testPool)

	u := &model.User{Email: "alice@example.com", Name: "Alice", Role: model.RoleAdmin, SSOSub: "sub-alice"}
	if err := repo.Save(ctx, u); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if u.ID == 0 {
		t.Fatal("expected ID after Save")
	}

	got, err := repo.FindByID(ctx, u.ID)
	if err != nil {
		t.Fatalf("FindByID: %v", err)
	}
	if got == nil || got.Email != "alice@example.com" {
		t.Errorf("FindByID: got %v, want email 'alice@example.com'", got)
	}
	if !got.Active {
		t.Error("FindByID: expected Active=true after Save")
	}
}

func TestUserRepo_FindByID_notFound(t *testing.T) {
	resetDB(t)
	got, err := NewUserRepository(testPool).FindByID(context.Background(), 9999)
	if err != nil {
		t.Fatalf("FindByID: unexpected error: %v", err)
	}
	if got != nil {
		t.Errorf("FindByID: want nil for unknown ID, got %+v", got)
	}
}

func TestUserRepo_FindByEmail(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo := NewUserRepository(testPool)

	u := &model.User{Email: "bob@example.com", Name: "Bob", Role: model.RoleProjectLeader, SSOSub: "sub-bob"}
	if err := repo.Save(ctx, u); err != nil {
		t.Fatalf("Save: %v", err)
	}

	got, err := repo.FindByEmail(ctx, "bob@example.com")
	if err != nil {
		t.Fatalf("FindByEmail: %v", err)
	}
	if got == nil || got.ID != u.ID {
		t.Errorf("FindByEmail: got %v, want ID %d", got, u.ID)
	}
}

func TestUserRepo_FindBySSOSub(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo := NewUserRepository(testPool)

	u := &model.User{Email: "carol@example.com", Name: "Carol", Role: model.RoleAdmin, SSOSub: "unique-sub-99"}
	if err := repo.Save(ctx, u); err != nil {
		t.Fatalf("Save: %v", err)
	}

	got, err := repo.FindBySSOSub(ctx, "unique-sub-99")
	if err != nil {
		t.Fatalf("FindBySSOSub: %v", err)
	}
	if got == nil || got.ID != u.ID {
		t.Errorf("FindBySSOSub: want user %d, got %v", u.ID, got)
	}
}

func TestUserRepo_Update(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo := NewUserRepository(testPool)

	u := &model.User{Email: "dave@example.com", Name: "Dave", Role: model.RoleAdmin, SSOSub: "sub-dave"}
	if err := repo.Save(ctx, u); err != nil {
		t.Fatalf("Save: %v", err)
	}

	u.Name = "David"
	u.Role = model.RoleProjectLeader
	if err := repo.Update(ctx, u); err != nil {
		t.Fatalf("Update: %v", err)
	}

	got, _ := repo.FindByID(ctx, u.ID)
	if got.Name != "David" || got.Role != model.RoleProjectLeader {
		t.Errorf("Update: want Name='David' Role='project_leader', got %+v", got)
	}
}

func TestUserRepo_UpdatePassword(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo := NewUserRepository(testPool)

	u := &model.User{Email: "eve@example.com", Name: "Eve", Role: model.RoleAdmin, SSOSub: "sub-eve"}
	if err := repo.Save(ctx, u); err != nil {
		t.Fatalf("Save: %v", err)
	}

	if err := repo.UpdatePassword(ctx, u.ID, "new-hash"); err != nil {
		t.Fatalf("UpdatePassword: %v", err)
	}

	got, _ := repo.FindByID(ctx, u.ID)
	if got.PasswordHash != "new-hash" {
		t.Errorf("UpdatePassword: want 'new-hash', got %q", got.PasswordHash)
	}
}

func TestUserRepo_SetActive(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo := NewUserRepository(testPool)

	u := &model.User{Email: "frank@example.com", Name: "Frank", Role: model.RoleAdmin, SSOSub: "sub-frank"}
	if err := repo.Save(ctx, u); err != nil {
		t.Fatalf("Save: %v", err)
	}

	if err := repo.SetActive(ctx, u.ID, false); err != nil {
		t.Fatalf("SetActive(false): %v", err)
	}
	got, _ := repo.FindByID(ctx, u.ID)
	if got.Active {
		t.Error("SetActive(false): expected Active=false")
	}

	if err := repo.SetActive(ctx, u.ID, true); err != nil {
		t.Fatalf("SetActive(true): %v", err)
	}
	got, _ = repo.FindByID(ctx, u.ID)
	if !got.Active {
		t.Error("SetActive(true): expected Active=true")
	}
}

func TestUserRepo_Delete(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo := NewUserRepository(testPool)

	u := &model.User{Email: "grace@example.com", Name: "Grace", Role: model.RoleAdmin, SSOSub: "sub-grace"}
	if err := repo.Save(ctx, u); err != nil {
		t.Fatalf("Save: %v", err)
	}
	if err := repo.Delete(ctx, u.ID); err != nil {
		t.Fatalf("Delete: %v", err)
	}

	got, _ := repo.FindByID(ctx, u.ID)
	if got != nil {
		t.Errorf("Delete: expected nil after delete, got %+v", got)
	}
}

func TestUserRepo_FindByRole(t *testing.T) {
	resetDB(t)
	ctx := context.Background()
	repo := NewUserRepository(testPool)

	_ = repo.Save(ctx, &model.User{Email: "a@example.com", Name: "A", Role: model.RoleAdmin, SSOSub: "sub-a"})
	_ = repo.Save(ctx, &model.User{Email: "b@example.com", Name: "B", Role: model.RoleAdmin, SSOSub: "sub-b"})
	_ = repo.Save(ctx, &model.User{Email: "c@example.com", Name: "C", Role: model.RoleProjectLeader, SSOSub: "sub-c"})

	admins, err := repo.FindByRole(ctx, model.RoleAdmin)
	if err != nil {
		t.Fatalf("FindByRole: %v", err)
	}
	if len(admins) != 2 {
		t.Errorf("FindByRole(admin): want 2, got %d", len(admins))
	}
}

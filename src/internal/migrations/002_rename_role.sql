-- 002_rename_role.sql: Rename du_admin role to admin

ALTER TABLE users DROP CONSTRAINT users_role_check;

UPDATE users SET role = 'admin' WHERE role = 'du_admin';

ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('admin', 'project_leader', 'shop_admin'));

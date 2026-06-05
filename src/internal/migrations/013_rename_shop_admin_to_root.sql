-- 013_rename_shop_admin_to_root.sql: Rename shop_admin role to root

ALTER TABLE users DROP CONSTRAINT users_role_check;

UPDATE users SET role = 'root' WHERE role = 'shop_admin';

ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('admin', 'project_leader', 'root'));

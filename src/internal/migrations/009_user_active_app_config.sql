-- 009_user_active_app_config.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS app_config (
    id            INT PRIMARY KEY DEFAULT 1,
    smtp_host     TEXT NOT NULL DEFAULT '',
    smtp_port     TEXT NOT NULL DEFAULT '587',
    smtp_from     TEXT NOT NULL DEFAULT '',
    smtp_username TEXT NOT NULL DEFAULT '',
    smtp_password TEXT NOT NULL DEFAULT '',
    smtp_tls      BOOLEAN NOT NULL DEFAULT FALSE,
    ai_provider   TEXT NOT NULL DEFAULT '',
    ai_endpoint   TEXT NOT NULL DEFAULT '',
    ai_api_key    TEXT NOT NULL DEFAULT '',
    ai_model      TEXT NOT NULL DEFAULT '',
    CONSTRAINT app_config_single_row CHECK (id = 1)
);
INSERT INTO app_config(id) VALUES(1) ON CONFLICT DO NOTHING;

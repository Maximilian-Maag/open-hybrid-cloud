CREATE TABLE branding (
    id              INT PRIMARY KEY DEFAULT 1,
    logo_data       BYTEA,
    logo_mime       TEXT NOT NULL DEFAULT 'image/png',
    primary_color   TEXT NOT NULL DEFAULT '#131921',
    secondary_color TEXT NOT NULL DEFAULT '#febd69',
    CONSTRAINT single_row CHECK (id = 1)
);
INSERT INTO branding(id) VALUES(1) ON CONFLICT DO NOTHING;

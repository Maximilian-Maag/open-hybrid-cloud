ALTER TABLE infrastructure_elements
    ADD COLUMN IF NOT EXISTS outputs jsonb NOT NULL DEFAULT '{}';

-- Update default brand colors to Amazon-style palette on existing installations
-- where the colors were never customised (still at the old blue defaults).
UPDATE branding
SET
  primary_color   = '#131921',
  secondary_color = '#febd69'
WHERE
  id = 1
  AND primary_color   = '#1e40af'
  AND secondary_color = '#3b82f6';

ALTER TABLE branding
  ALTER COLUMN primary_color   SET DEFAULT '#131921',
  ALTER COLUMN secondary_color SET DEFAULT '#febd69';

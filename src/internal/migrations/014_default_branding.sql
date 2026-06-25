-- Update default brand colors from the old "Infra Webshop" palette to Open Hybrid Cloud defaults.
-- Only applies if the row still carries the original defaults so user-customized values are preserved.
UPDATE branding
SET primary_color   = '#0f172a',
    secondary_color = '#0ea5e9'
WHERE id = 1
  AND primary_color   = '#131921'
  AND secondary_color = '#febd69';

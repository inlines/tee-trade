-- Preserve applied migrations and infrastructure identifiers during rebranding.
ALTER TABLE products ALTER COLUMN brand SET DEFAULT 'FUTBA';
UPDATE products SET
    name = regexp_replace(name, 'tee[ -]?trade', 'FUTBA', 'gi'),
    brand = regexp_replace(brand, 'tee[ -]?trade', 'FUTBA', 'gi'),
    description = regexp_replace(description, 'tee[ -]?trade', 'FUTBA', 'gi'),
    theme = regexp_replace(theme, 'tee[ -]?trade', 'FUTBA', 'gi'),
    images = regexp_replace(images::text, 'tee[ -]?trade', 'FUTBA', 'gi')::jsonb
WHERE name ~* 'tee[ -]?trade' OR brand ~* 'tee[ -]?trade'
   OR description ~* 'tee[ -]?trade' OR theme ~* 'tee[ -]?trade'
   OR images::text ~* 'tee[ -]?trade';
UPDATE storefront SET settings = regexp_replace(settings::text, 'tee[ -]?trade', 'FUTBA', 'gi')::jsonb
WHERE settings::text ~* 'tee[ -]?trade';
UPDATE catalog_revision SET version = version + 1;

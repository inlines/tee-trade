-- Sizes are free text; existing years are not meaningful sizes.
ALTER TABLE products ADD COLUMN size TEXT NOT NULL DEFAULT '';
ALTER TABLE products DROP COLUMN release_year;
UPDATE catalog_revision SET version = version + 1;

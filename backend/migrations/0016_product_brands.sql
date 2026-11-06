ALTER TABLE products ADD COLUMN brands TEXT[] NOT NULL DEFAULT '{}';
UPDATE products SET brands=ARRAY[btrim(brand)] WHERE btrim(brand)<>'';
ALTER TABLE products DROP COLUMN brand;
UPDATE catalog_revision SET version=version+1;

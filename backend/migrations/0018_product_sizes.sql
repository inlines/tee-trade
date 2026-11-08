ALTER TABLE products ADD COLUMN sizes TEXT[] NOT NULL DEFAULT '{}';
UPDATE products SET sizes=ARRAY[btrim(size)] WHERE btrim(size)<>'';
ALTER TABLE products DROP COLUMN size;
UPDATE catalog_revision SET version=version+1;

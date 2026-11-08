-- Preserve the original oldest-first order; new products append to the end.
CREATE SEQUENCE product_catalog_position_seq;
ALTER TABLE products ADD COLUMN catalog_position bigint;
UPDATE products SET catalog_position = id;
SELECT setval('product_catalog_position_seq', GREATEST(COALESCE((SELECT max(catalog_position) FROM products), 0), 1), EXISTS(SELECT 1 FROM products));
ALTER TABLE products ALTER COLUMN catalog_position SET DEFAULT nextval('product_catalog_position_seq');
ALTER TABLE products ALTER COLUMN catalog_position SET NOT NULL;
ALTER SEQUENCE product_catalog_position_seq OWNED BY products.catalog_position;
CREATE INDEX products_catalog_order_idx ON products(sold, catalog_position, id);
CREATE INDEX products_category_catalog_order_idx ON products(sold, category, catalog_position, id);
UPDATE catalog_revision SET version = version + 1;

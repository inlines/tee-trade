ALTER TABLE products ADD COLUMN sold BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products DROP CONSTRAINT products_category_check;
ALTER TABLE products ADD CONSTRAINT products_category_check CHECK (category IN ('', 'sneakers', 't-shirts', 'accessories', 'headwear', 'hoodies'));

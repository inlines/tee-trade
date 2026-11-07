ALTER TABLE products DROP CONSTRAINT products_category_check;
ALTER TABLE products ADD CONSTRAINT products_category_check
    CHECK (category IN ('', 'sneakers', 't-shirts', 'accessories', 'headwear', 'hoodies', 'sweatshirts', 'longsleeves'));
UPDATE catalog_revision SET version = version + 1;

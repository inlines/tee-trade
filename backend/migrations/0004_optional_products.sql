ALTER TABLE products
    ALTER COLUMN price_cents DROP NOT NULL,
    ALTER COLUMN release_year DROP NOT NULL,
    DROP CONSTRAINT products_brand_check,
    DROP CONSTRAINT products_description_check,
    DROP CONSTRAINT products_theme_check,
    DROP CONSTRAINT products_category_check,
    ADD CHECK (category IN ('', 'sneakers', 't-shirts', 'accessories', 'headwear'));

CREATE OR REPLACE FUNCTION valid_product_images(value JSONB) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN jsonb_typeof(value) <> 'array' THEN FALSE ELSE
        jsonb_array_length(value) <= 12
        AND (SELECT count(*) FROM jsonb_array_elements(value) image WHERE image->>'kind' = 'front') <= 1
        AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(value) image
            WHERE jsonb_typeof(image) <> 'object'
                OR COALESCE(image->>'kind', '') NOT IN ('front', 'detail', 'label')
                OR COALESCE(length(trim(image->>'url')), 0) = 0
                OR jsonb_typeof(image->'url') IS DISTINCT FROM 'string'
                OR jsonb_typeof(image->'alt') IS DISTINCT FROM 'string'
        ) END;
$$;

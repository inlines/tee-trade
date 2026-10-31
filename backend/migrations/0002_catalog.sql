-- Keep the original migration intact so existing databases can upgrade.
CREATE FUNCTION valid_product_images(value JSONB) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE WHEN jsonb_typeof(value) <> 'array' THEN FALSE ELSE
        jsonb_array_length(value) >= 2
        AND value @> '[{"kind":"front"}]'::jsonb
        AND value @> '[{"kind":"label"}]'::jsonb
        AND NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(value) image
            WHERE jsonb_typeof(image) <> 'object'
                OR COALESCE(image->>'kind', '') NOT IN ('front', 'detail', 'label')
                OR COALESCE(length(trim(image->>'url')), 0) = 0
                OR COALESCE(length(trim(image->>'alt')), 0) = 0
                OR jsonb_typeof(image->'url') IS DISTINCT FROM 'string'
                OR jsonb_typeof(image->'alt') IS DISTINCT FROM 'string'
        ) END;
$$;

ALTER TABLE products
    ADD COLUMN category TEXT NOT NULL DEFAULT 't-shirts'
        CHECK (category IN ('sneakers', 't-shirts', 'accessories', 'headwear')),
    ADD COLUMN brand TEXT NOT NULL DEFAULT 'Tee Trade' CHECK (length(trim(brand)) > 0),
    ADD COLUMN release_year INTEGER NOT NULL DEFAULT 2026 CHECK (release_year BETWEEN 1900 AND 2100),
    ADD COLUMN description TEXT NOT NULL DEFAULT 'Демонстрационная позиция каталога.' CHECK (length(trim(description)) > 0),
    ADD COLUMN theme TEXT NOT NULL DEFAULT 'Базовый гардероб' CHECK (length(trim(theme)) > 0),
    ADD COLUMN images JSONB NOT NULL DEFAULT '[{"url":"/images/demo/t-shirt.svg","alt":"Демонстрация футболки, вид спереди","kind":"front"},{"url":"/images/demo/label.svg","alt":"Место для фотографии ярлычка — демонстрация","kind":"label"}]'::jsonb
        CHECK (valid_product_images(images)),
    ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE products SET is_demo = TRUE,
    description = 'Демонстрационная футболка прямого кроя. Эта позиция показывает, как будет выглядеть описание: материал, посадка, состояние и особенности вещи. Иллюстрации нужно заменить фотографиями конкретного товара.',
    images = images || '[{"url":"/images/demo/t-shirt-back.svg","alt":"Демонстрация футболки, вид сзади","kind":"detail"}]'::jsonb
WHERE name IN ('Classic White Tee', 'Essential Black Tee', 'Oversized Sand Tee');

INSERT INTO products (name, price_cents, category, brand, release_year, description, theme, images, is_demo) VALUES
('Court Low / Chalk', 890000, 'sneakers', 'Tee Trade Studio', 2024,
 'Демонстрационная пара низких кроссовок в светлой палитре. Здесь будет описание материалов, состояния подошвы, посадки и комплектации. Изображения являются иллюстрациями.', 'Баскетбольная классика',
 '[{"url":"/images/demo/sneakers.svg","alt":"Демонстрация светлых кроссовок","kind":"front"},{"url":"/images/demo/sneakers-detail.svg","alt":"Демонстрация деталей кроссовок","kind":"detail"},{"url":"/images/demo/label.svg","alt":"Место для фотографии ярлычка — демонстрация","kind":"label"}]', TRUE),
('Runner / Olive', 1090000, 'sneakers', 'Tee Trade Studio', 2023,
 'Демонстрационная модель для городского гардероба. В описании реальной пары будут указаны материалы, следы носки и особенности модели. Изображения являются иллюстрациями.', 'Город и движение',
 '[{"url":"/images/demo/sneakers-olive.svg","alt":"Демонстрация оливковых кроссовок","kind":"front"},{"url":"/images/demo/sneakers-detail.svg","alt":"Место для снимка деталей кроссовок","kind":"detail"},{"url":"/images/demo/label.svg","alt":"Место для фотографии ярлычка — демонстрация","kind":"label"}]', TRUE),
('Everyday Tote', 290000, 'accessories', 'Tee Trade Studio', 2025,
 'Демонстрационная сумка для повседневных вещей. Здесь можно рассказать о ткани, размерах, карманах и состоянии изделия. Изображения являются иллюстрациями.', 'Повседневность',
 '[{"url":"/images/demo/tote.svg","alt":"Демонстрация тканевой сумки","kind":"front"},{"url":"/images/demo/tote-detail.svg","alt":"Демонстрация ручек сумки","kind":"detail"},{"url":"/images/demo/label.svg","alt":"Место для фотографии ярлычка — демонстрация","kind":"label"}]', TRUE),
('Six Panel / Forest', 320000, 'headwear', 'Tee Trade Studio', 2024,
 'Демонстрационная шестипанельная кепка. Описание реального товара будет содержать материал, размер и тип застёжки. Изображения являются иллюстрациями.', 'Outdoor',
 '[{"url":"/images/demo/cap.svg","alt":"Демонстрация зелёной кепки","kind":"front"},{"url":"/images/demo/cap-detail.svg","alt":"Демонстрация деталей кепки","kind":"detail"},{"url":"/images/demo/label.svg","alt":"Место для фотографии ярлычка — демонстрация","kind":"label"}]', TRUE);

UPDATE products SET images = jsonb_set(images, '{0,url}', '"/images/demo/t-shirt-black.svg"') WHERE name = 'Essential Black Tee' AND is_demo;
UPDATE products SET images = jsonb_set(images, '{0,url}', '"/images/demo/t-shirt-sand.svg"') WHERE name = 'Oversized Sand Tee' AND is_demo;

-- New products must provide their own complete metadata and image gallery.
ALTER TABLE products ALTER COLUMN category DROP DEFAULT,
    ALTER COLUMN brand DROP DEFAULT, ALTER COLUMN release_year DROP DEFAULT,
    ALTER COLUMN description DROP DEFAULT, ALTER COLUMN theme DROP DEFAULT,
    ALTER COLUMN images DROP DEFAULT;

-- Run against an initialized database; all changes are rolled back.
BEGIN;
DO $$
DECLARE sample_id INTEGER;
BEGIN
    SELECT id INTO STRICT sample_id FROM products ORDER BY id LIMIT 1;
    BEGIN
        UPDATE products SET images = '[{"url":"/front.jpg","alt":"Спереди","kind":"front"},{"url":"/back.jpg","alt":"Сзади","kind":"detail"}]' WHERE id = sample_id;
        RAISE EXCEPTION 'Product without label was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        UPDATE products SET images = '[{"url":"/front.jpg","alt":"Спереди","kind":"front"},{"url":"","alt":"Ярлычок","kind":"label"}]' WHERE id = sample_id;
        RAISE EXCEPTION 'Empty image URL was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    BEGIN
        UPDATE products SET images = '{}' WHERE id = sample_id;
        RAISE EXCEPTION 'Invalid gallery structure was accepted';
    EXCEPTION WHEN check_violation THEN NULL;
    END;
    IF valid_product_images('[{"url":"/front.jpg","alt":"Спереди","kind":"front"},{"url":"/label.jpg","alt":"Ярлычок","kind":"label"}]') IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Valid gallery was rejected';
    END IF;
    RAISE NOTICE 'Gallery constraints passed';
END $$;
ROLLBACK;

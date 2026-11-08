-- Preserve original labels while indexing case-insensitive multi-value filters.
CREATE FUNCTION catalog_terms(text[]) RETURNS text[] LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT COALESCE(array_agg(lower(btrim(term))), '{}'::text[]) FROM unnest($1) term $$;
CREATE INDEX products_brands_filter_idx ON products USING gin(catalog_terms(brands));
CREATE INDEX products_sizes_filter_idx ON products USING gin(catalog_terms(sizes));
CREATE INDEX products_sold_category_id_idx ON products(sold, category, id);
CREATE INDEX products_sold_id_idx ON products(sold, id);
CREATE INDEX products_sold_price_idx ON products(sold, price_cents, id);
CREATE INDEX requests_completed_id_idx ON purchase_requests((status='completed'), id DESC);
CREATE INDEX chat_messages_unread_idx ON chat_messages(chat_id, is_admin, id);
CREATE INDEX chats_customer_activity_idx ON chats(customer_id, updated_at DESC, id DESC);

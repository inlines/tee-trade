CREATE TABLE admin_account (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL
);
CREATE TABLE admin_sessions (
    token_hash TEXT PRIMARY KEY,
    csrf_token TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ON admin_sessions (expires_at);
CREATE TABLE login_throttle (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    attempts INTEGER NOT NULL,
    window_start TIMESTAMPTZ NOT NULL
);
CREATE TABLE media (
    id TEXT PRIMARY KEY,
    content BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE catalog_revision (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    version BIGINT NOT NULL DEFAULT 1
);
INSERT INTO catalog_revision DEFAULT VALUES;
CREATE TABLE storefront (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    settings JSONB NOT NULL
);
INSERT INTO storefront (settings) SELECT jsonb_build_object(
    'carousel_product_ids', COALESCE(jsonb_agg(id ORDER BY id), '[]'::jsonb),
    'featured_product_ids', (SELECT COALESCE(jsonb_agg(id ORDER BY id), '[]'::jsonb) FROM (SELECT id FROM products ORDER BY id LIMIT 4) first_products),
    'categories', jsonb_build_array('sneakers', 't-shirts', 'accessories', 'headwear'),
    'arrivals_title', 'new arrivals', 'arrivals_subtitle', 'Один гардероб. Твой.',
    'popular_title', 'пользуется спросом',
    'manifesto_eyebrow', 'МЕНЬШЕ СЛУЧАЙНОГО. БОЛЬШЕ СВОЕГО.',
    'manifesto_title', E'У каждой вещи есть детали.\nУ каждого выбора — характер.',
    'manifesto_link_text', 'О проекте Tee Trade ↗',
    'carousel_enabled', true, 'categories_enabled', true,
    'popular_enabled', true, 'manifesto_enabled', true
) FROM products;

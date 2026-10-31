CREATE TABLE customers (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username TEXT NOT NULL,
    username_key TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE customer_sessions (
    token_hash TEXT PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX ON customer_sessions (expires_at);
CREATE TABLE customer_auth_throttle (
    key TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL,
    window_start TIMESTAMPTZ NOT NULL
);

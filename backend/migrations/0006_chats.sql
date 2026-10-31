CREATE TABLE chats (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL,
    product_name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (customer_id, product_id)
);
-- Keep the product ID/name snapshot and conversation even if the product is deleted.
CREATE TABLE chat_messages (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    chat_id BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    is_admin BOOLEAN NOT NULL,
    client_id TEXT NOT NULL CHECK (length(client_id) BETWEEN 1 AND 80),
    body TEXT NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (chat_id, is_admin, client_id)
);
CREATE INDEX ON chat_messages (chat_id, id);
CREATE INDEX ON chats (updated_at DESC);

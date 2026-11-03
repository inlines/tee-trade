CREATE TABLE purchase_requests (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
 chat_id BIGINT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
 product_id INTEGER NOT NULL,
 product_name TEXT NOT NULL,
 last_name TEXT NOT NULL CHECK(length(trim(last_name)) BETWEEN 1 AND 100),
 first_name TEXT NOT NULL CHECK(length(trim(first_name)) BETWEEN 1 AND 100),
 patronymic TEXT NOT NULL DEFAULT '' CHECK(length(patronymic)<=100),
 contact TEXT NOT NULL CHECK(length(trim(contact)) BETWEEN 1 AND 300),
 city TEXT NOT NULL CHECK(length(trim(city)) BETWEEN 1 AND 160),
 status TEXT NOT NULL DEFAULT 'new' CHECK(status IN ('new','in_progress','completed')),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX purchase_requests_active ON purchase_requests(customer_id,product_id) WHERE status <> 'completed';
CREATE INDEX ON purchase_requests(customer_id,id DESC);
CREATE TABLE purchase_request_events (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 request_id BIGINT NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
 for_admin BOOLEAN NOT NULL,
 status TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON purchase_request_events(request_id,id);

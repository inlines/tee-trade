CREATE TABLE product_views (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 product_id INTEGER NOT NULL,
 customer_id BIGINT REFERENCES customers(id) ON DELETE CASCADE,
 visitor_hash TEXT NOT NULL,
 bucket TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(product_id,visitor_hash,bucket)
);
CREATE INDEX ON product_views(created_at);
CREATE INDEX ON product_views(customer_id,product_id,created_at) WHERE customer_id IS NOT NULL;
CREATE INDEX ON customers(created_at);
CREATE INDEX ON purchase_requests(created_at);
CREATE INDEX ON purchase_requests(customer_id,product_id,created_at);
CREATE INDEX ON chat_messages(created_at);
CREATE TABLE analytics_metadata (
 id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(id),
 views_started_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO analytics_metadata(id) VALUES(TRUE);

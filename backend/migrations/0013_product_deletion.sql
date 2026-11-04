-- Historical conversations for previously deleted products remain untouched.
-- New references are checked; deleting an existing product removes its data
-- atomically, including concurrent writes. Messages and request events already
-- cascade from their parent chat/request.
ALTER TABLE chats ADD CONSTRAINT chats_product_fk
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE purchase_requests ADD CONSTRAINT requests_product_fk
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE NOT VALID;
ALTER TABLE product_views ADD CONSTRAINT views_product_fk
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE NOT VALID;
CREATE INDEX IF NOT EXISTS chats_product_idx ON chats(product_id);
CREATE INDEX IF NOT EXISTS requests_product_idx ON purchase_requests(product_id);

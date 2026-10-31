CREATE TABLE products (
    id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0)
);
INSERT INTO products (name, price_cents) VALUES
    ('Classic White Tee', 199000), ('Essential Black Tee', 219000), ('Oversized Sand Tee', 249000);

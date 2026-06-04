-- 011_cascade_product_delete.sql: make product deletions cascade to dependent tables

-- Drop existing FK constraints if they exist and recreate them with ON DELETE CASCADE
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_product_id_fkey;
ALTER TABLE orders
    ADD CONSTRAINT orders_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;

ALTER TABLE infrastructure_elements DROP CONSTRAINT IF EXISTS infrastructure_elements_product_id_fkey;
ALTER TABLE infrastructure_elements
    ADD CONSTRAINT infrastructure_elements_product_id_fkey FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE;

-- Note: product_translations, product_environments and product_webhooks already have ON DELETE CASCADE in the initial schema.

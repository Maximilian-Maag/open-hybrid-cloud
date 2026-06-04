-- 012_cascade_project_category_delete.sql: cascade project and category deletes to dependent tables

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_project_id_fkey;
ALTER TABLE orders
    ADD CONSTRAINT orders_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE infrastructure_elements DROP CONSTRAINT IF EXISTS infrastructure_elements_project_id_fkey;
ALTER TABLE infrastructure_elements
    ADD CONSTRAINT infrastructure_elements_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_category_id_fkey;
ALTER TABLE products
    ADD CONSTRAINT products_category_id_fkey FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE;

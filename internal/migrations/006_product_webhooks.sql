-- Product-specific webhook endpoints, ordered per environment.
-- If rows exist for a product+environment, they override the environment's default webhook_url.
CREATE TABLE product_webhooks (
    id             BIGSERIAL PRIMARY KEY,
    product_id     BIGINT NOT NULL REFERENCES products(id)  ON DELETE CASCADE,
    environment_id BIGINT NOT NULL REFERENCES deployment_environments(id),
    name           TEXT NOT NULL,
    webhook_url    TEXT NOT NULL,
    webhook_token  TEXT NOT NULL,
    exec_order     INT  NOT NULL DEFAULT 0
);

CREATE INDEX idx_product_webhooks ON product_webhooks(product_id, environment_id, exec_order);

-- Widen pipeline_id to a JSON array so multiple concurrent pipelines can be tracked.
-- Existing single IDs are wrapped: '' → [], '123' → ['123']
ALTER TABLE orders
    ALTER COLUMN pipeline_id TYPE JSONB
    USING CASE
        WHEN pipeline_id = '' THEN '[]'::jsonb
        ELSE jsonb_build_array(pipeline_id)
    END;
ALTER TABLE orders ALTER COLUMN pipeline_id SET DEFAULT '[]';

ALTER TABLE infrastructure_elements
    ALTER COLUMN pipeline_id TYPE JSONB
    USING CASE
        WHEN pipeline_id = '' THEN '[]'::jsonb
        ELSE jsonb_build_array(pipeline_id)
    END;
ALTER TABLE infrastructure_elements ALTER COLUMN pipeline_id SET DEFAULT '[]';

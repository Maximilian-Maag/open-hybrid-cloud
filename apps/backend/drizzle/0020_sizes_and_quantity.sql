-- Issues #98 (t-shirt sizing) and #104 (quantity), designed as one change: a cart
-- line is product × environment × size × quantity, and checkout produces ONE
-- order with N infrastructure elements.
--
-- ── Backwards compatibility ───────────────────────────────────────────────────
-- There are live orders and offerings with no size. Nothing here invents one for
-- them: `size_code` is NULLABLE everywhere it appears and NULL means "this
-- offering has no sizes, so its price is the one on product_environments". That
-- is exactly how every existing row already behaved, so existing orders,
-- snapshots and infrastructure keep reading the same price they always did.
-- Synthetic "default" size rows were the alternative and were rejected: they
-- would invent a code and a label no admin ever chose, appear in the buy box as a
-- fake choice, have to be kept in sync with product_environments.price forever,
-- and make "no sizes" indistinguishable from "exactly one size".
--
-- `quantity` and `sequence` default to 1, which is precisely what every order
-- placed before this migration asked for and what every existing element is.

CREATE TABLE IF NOT EXISTS product_environment_sizes (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL,
  environment_id BIGINT NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  sort_order INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  -- Composite FK to the offering rather than two FKs to products and
  -- environments: a size for a pair that is not offered at all is not a thing.
  CONSTRAINT product_environment_sizes_offering_fk
    FOREIGN KEY (product_id, environment_id)
    REFERENCES product_environments(product_id, environment_id) ON DELETE CASCADE,
  -- The code is what an order line stores, so a duplicate would make a stored
  -- line ambiguous.
  CONSTRAINT product_environment_sizes_offering_code_unique
    UNIQUE (product_id, environment_id, code)
);

-- Sizes are always read per offering, ordered by sort_order.
CREATE INDEX IF NOT EXISTS product_environment_sizes_offering_idx
  ON product_environment_sizes (product_id, environment_id, sort_order);

-- The order line: which size, and how many elements it asks for.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS size_code TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS quantity INT NOT NULL DEFAULT 1;

ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS size_code TEXT;
ALTER TABLE cart_items ADD COLUMN IF NOT EXISTS quantity INT NOT NULL DEFAULT 1;

-- The element carries its own size (a teardown needs it without joining the
-- order) and its 1-based position within the order. `sequence` is what makes the
-- Terraform state key of element 3 differ from element 1's; existing elements are
-- 1, which reproduces the state name they were provisioned with unchanged.
ALTER TABLE infrastructure_elements ADD COLUMN IF NOT EXISTS size_code TEXT;
ALTER TABLE infrastructure_elements ADD COLUMN IF NOT EXISTS sequence INT NOT NULL DEFAULT 1;

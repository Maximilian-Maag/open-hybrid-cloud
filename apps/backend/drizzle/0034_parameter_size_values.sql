-- A T-shirt size is a variable TYPE, alongside string / number / bool / dropdown.
--
-- The size a customer picks used to be nothing but a code, a label and a price.
-- It reached the pipeline as SIZE=M, which .ci/base.gitlab-ci.yml duly promoted
-- to TF_VAR_size — and not one template in infra-templates declares
-- `variable "size"`, so OpenTofu dropped it. Choosing XL changed the price and
-- nothing about the machine.
--
-- Now the VARIABLE carries the mapping: `instance_type` is of type `size` and
-- says what each size code means for it. One size can drive several variables,
-- which vSphere needs — num_cpus, memory_mb and disk_size_gb all move together.
--
-- No CHECK on `type` to widen: the enum is enforced by Drizzle and Zod, not by
-- the database. (src/test/setup.ts DOES have one, which is issue #147 — the test
-- schema being stricter than the real one — and it is updated in the same
-- commit as this.)
ALTER TABLE parameters
  ADD COLUMN IF NOT EXISTS size_values jsonb NOT NULL DEFAULT '{}'::jsonb;

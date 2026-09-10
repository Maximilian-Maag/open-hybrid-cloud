-- Approval delegation: out-of-office substitute approver (issue #35).
--
-- What is delegated is AUTHORITY, not identity and not rows. This system has no
-- per-admin approval queue — every admin sees every pending order — so a
-- delegation cannot move an order from one inbox to another. It records that,
-- for a period, one admin's approval authority is also held by another, which is
-- what makes "who approved this, and under whose authority" answerable from the
-- audit log afterwards.
CREATE TABLE IF NOT EXISTS "approval_delegations" (
  "id"           BIGSERIAL PRIMARY KEY,
  -- The admin who is away and is handing their authority over. No ON DELETE:
  -- a delegation that was in force while decisions were made must not lose
  -- either end of its attribution. Users are retired by deactivating them.
  "from_user_id" BIGINT NOT NULL REFERENCES "users"("id"),
  -- The substitute. They approve as THEMSELVES; nothing here impersonates the
  -- delegator.
  "to_user_id"   BIGINT NOT NULL REFERENCES "users"("id"),
  -- DATE, not TIMESTAMPTZ: an out-of-office period is "the 3rd to the 17th", and
  -- storing an instant would make the delegation start and end at whatever hour
  -- the row happened to be written. Both ends are INCLUSIVE — the delegation is
  -- valid through the whole of ends_on and is expired from the next day on.
  "starts_on"    DATE NOT NULL,
  "ends_on"      DATE NOT NULL,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Cancelled before its end date. The row is kept rather than deleted: it may
  -- already have been in force while orders were approved, and the audit entries
  -- that reference it have to keep resolving.
  "revoked_at"   TIMESTAMPTZ,
  CONSTRAINT "approval_delegations_period_check" CHECK ("ends_on" >= "starts_on"),
  -- Delegating to yourself is not a delegation; it would only produce audit
  -- noise claiming an authority nobody granted.
  CONSTRAINT "approval_delegations_not_self_check" CHECK ("from_user_id" <> "to_user_id")
);

-- Expiry is a date comparison at read time, never a job: both read paths are
-- "the non-revoked rows for this user whose period contains today". Indexed from
-- both ends because both are asked on every approvals page load — the authority
-- a user HOLDS (to_user_id) and the authority they have GIVEN AWAY (from_user_id).
CREATE INDEX IF NOT EXISTS "approval_delegations_from_idx"
  ON "approval_delegations" ("from_user_id", "starts_on", "ends_on");
CREATE INDEX IF NOT EXISTS "approval_delegations_to_idx"
  ON "approval_delegations" ("to_user_id", "starts_on", "ends_on");

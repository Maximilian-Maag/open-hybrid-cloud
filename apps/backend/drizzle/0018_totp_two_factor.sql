-- TOTP second factor for the local root account (issue #36).
--
-- Root holds a local password and the highest privilege level in the system, and
-- until now that password was the only thing between an attacker and the product
-- catalogue, the CI credentials and user management. SSO accounts are covered by
-- Entra ID MFA; this closes the one account that is not.
--
-- Two tables rather than columns on `users`, for two different reasons:
--
--   * `user_totp` holds secret material. Every read of `users` goes through a
--     column whitelist to keep `password_hash` out of API responses, and adding
--     more secret-bearing columns to the table that everything selects from is
--     how one of them eventually ends up in a payload. Nothing joins this table
--     into a user object.
--   * `user_recovery_codes` is one-to-many and each row has its own lifecycle
--     (issued, then spent), which a column cannot express.

CREATE TABLE IF NOT EXISTS "user_totp" (
  -- The user id IS the key: a user has exactly one authenticator, and putting
  -- that in the primary key removes the "which of these two rows is live"
  -- question rather than leaving it to a query.
  "user_id"            BIGINT PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  -- An AES-256-GCM envelope (`v1.<iv>.<ciphertext>.<tag>`), never the raw
  -- secret. A TOTP secret cannot be hashed — verification needs the secret
  -- itself — so anyone who can read this column could mint valid codes forever.
  -- The key lives in the environment, so a stolen dump yields nothing usable.
  -- NULL until the first enrollment is confirmed.
  "secret"             TEXT,
  -- An enrollment in flight, kept apart from `secret` so that starting a
  -- re-enrollment cannot break a working authenticator: until a code proves the
  -- new secret actually arrived in an app, the old one keeps letting you in.
  "pending_secret"     TEXT,
  "pending_created_at" TIMESTAMPTZ,
  -- Set the first time a code from `secret` is accepted. `secret IS NOT NULL AND
  -- confirmed_at IS NOT NULL` is the single condition meaning "2FA is on", and
  -- there is deliberately no column that turns it off: the requirement is that
  -- 2FA cannot be disabled once set up, only re-enrolled. The emergency exit is
  -- a DELETE by an operator with database access, documented in the handbook.
  "confirmed_at"       TIMESTAMPTZ,
  -- The RFC 6238 step of the last accepted code. Anything at or below it is
  -- refused, so a code read over a shoulder or captured by a phishing proxy
  -- cannot be replayed for the remaining ~60 s of its window. Here rather than
  -- in process memory because the guard has to survive a restart and hold across
  -- replicas.
  "last_used_step"     BIGINT,
  -- Consecutive failures and the lock they earn. Persisted for the same reason:
  -- a six-digit code is a 10^6 space, so an attacker who can restart the process
  -- — or simply reach a second replica — would otherwise have an unlimited guess
  -- loop, and 10^6 tries at a few per second is days, not centuries.
  "failed_attempts"    INTEGER NOT NULL DEFAULT 0,
  "locked_until"       TIMESTAMPTZ,
  "created_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updated_at"         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS "user_recovery_codes" (
  "id"         BIGSERIAL PRIMARY KEY,
  "user_id"    BIGINT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  -- Hashed, not encrypted. Unlike the TOTP secret, verifying a recovery code
  -- only ever needs to answer "is this the exact string we issued", so the
  -- server has no reason to be able to read it back — and if it could, the
  -- column would be a set of standing passwords in plaintext-equivalent form.
  "code_hash"  TEXT NOT NULL,
  -- Kept after use rather than deleted, so the audit trail can still show that a
  -- recovery code was spent and when. A spent row can never match again.
  "used_at"    TIMESTAMPTZ,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Verification is a single indexed lookup by (user, hash) rather than a scan
-- with a comparison per row: constant time, no dependence on how many codes are
-- left, and no way for the response time to reveal how far down the list a code
-- sat. UNIQUE rather than a plain index because issuing the same code twice to
-- one user would make "each code is usable once" untrue.
CREATE UNIQUE INDEX IF NOT EXISTS "user_recovery_codes_user_id_code_hash_unique"
  ON "user_recovery_codes" ("user_id", "code_hash");

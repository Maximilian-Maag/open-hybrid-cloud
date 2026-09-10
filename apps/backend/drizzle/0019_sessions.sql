-- Server-side sessions with revocation (issue #37).
--
-- Until now a session was a signed JWT and nothing else: nobody could see the
-- sessions on an account, and the only way to end one was to rotate JWT_SECRET,
-- which ends everybody's. A row per session fixes both. The JWT carries this
-- row's id as its `sid` claim, and every authenticated request looks the row up
-- before it does anything else (see src/lib/auth/sessions.ts).
CREATE TABLE IF NOT EXISTS "sessions" (
  "id"           BIGSERIAL PRIMARY KEY,
  "user_id"      BIGINT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  -- SHA-256 of the token, hex. The token itself is never stored: a database dump
  -- must not be a bag of working credentials, and the hash proves everything the
  -- per-request check needs — that the presented token is the one this row was
  -- issued for.
  "token_hash"   TEXT NOT NULL,
  -- Both nullable because both are genuinely unknown sometimes: there is no
  -- trustworthy client address without a trusted proxy (TRUST_PROXY), and a
  -- scripted client sends no User-Agent. NULL says "not recorded".
  "ip"           TEXT,
  "user_agent"   TEXT,
  "created_at"   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Advanced at most once every five minutes, not on every request. The session
  -- list only ever says "last active, roughly"; paying a row update, a WAL record
  -- and a dirtied page on the hottest path in the app to make it exact would be
  -- the wrong trade.
  "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Mirrors the token's own `exp`. Duplicated on purpose: the list has to show a
  -- lifetime without holding the token, and the request check has to be able to
  -- refuse an expired session even when the signature still verifies.
  "expires_at"   TIMESTAMPTZ NOT NULL,
  -- Set, never deleted. A revoked session is evidence, and the audit entry that
  -- records the revocation points at a row that has to still be there.
  "revoked_at"   TIMESTAMPTZ
);

-- The hot path: "is session N still good", once per authenticated request. Served
-- by the primary key, so no index is added for it.
--
-- This one is for the other two reads — a user's own session list, and the
-- "sign out everywhere else" update — both of which are "the live sessions of one
-- user". Ordered so the partial predicate can use it directly.
CREATE INDEX IF NOT EXISTS "sessions_user_live_idx"
  ON "sessions" ("user_id", "last_seen_at" DESC)
  WHERE "revoked_at" IS NULL;

-- No backfill, and that is the point: tokens issued before this migration carry no
-- `sid`, and verifyToken refuses them. Everyone signed in at deploy time signs in
-- again once. Inventing rows for them would mean minting session records whose
-- token_hash cannot be known, which is a row that can never be validated against
-- anything — and accepting sid-less tokens instead would mean revocation quietly
-- did nothing for up to 24 h after release. A single re-login is the cheaper
-- honesty.

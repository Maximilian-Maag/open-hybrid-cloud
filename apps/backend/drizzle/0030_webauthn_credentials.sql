-- WebAuthn/FIDO2 as a second factor, alongside TOTP (issue #197, part 2).
--
-- A hardware key or a passkey, rather than a six-digit code copied out of an app.
-- The difference that matters is not convenience: an assertion is signed over the
-- origin the browser is actually on, so a user who lands on a lookalike domain
-- cannot produce one that verifies here. A TOTP code can be typed into anything.
--
-- ── Why a table and not columns on user_totp ─────────────────────────────────
-- One account may hold several credentials, and should: a single key is a single
-- point of failure, and the whole reason recovery codes exist is that people lose
-- them. `user_totp` is one row per user by design (there is one authenticator
-- secret); this is one row per credential.
--
-- Recovery codes stay shared across both factor types — they are in
-- `user_recovery_codes` and are not duplicated here. A recovery code is the way
-- back in when the FACTOR is gone, whichever kind it was.
CREATE TABLE IF NOT EXISTS "webauthn_credentials" (
  "id"            BIGSERIAL PRIMARY KEY,
  "user_id"       BIGINT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  -- The credential ID the authenticator generated, base64url. Unique across the
  -- whole table and not just per user: the same physical key registered to two
  -- accounts produces two different credential IDs, so a collision here would
  -- mean something is wrong rather than something is shared.
  "credential_id" TEXT NOT NULL UNIQUE,
  -- The COSE public key, base64url. Public by definition — there is no secret on
  -- this side of a WebAuthn registration, which is the other half of why this is
  -- worth having: a database dump yields nothing that can authenticate.
  "public_key"    TEXT NOT NULL,
  -- The authenticator's signature counter. Compared on every assertion and only
  -- ever allowed to increase, which is how a cloned authenticator is detected.
  -- Many modern authenticators (and every passkey) always report 0; see
  -- lib/services/webauthn.ts for what that means for the check.
  "counter"       BIGINT NOT NULL DEFAULT 0,
  -- How the browser reached it ('usb', 'nfc', 'ble', 'internal', 'hybrid'), as a
  -- JSON array. Fed back into the next authentication request so the browser can
  -- prompt for the right thing instead of offering every transport it knows.
  "transports"    JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- What the user called it. They will have more than one, and "YubiKey 5C on my
  -- keyring" is the difference between revoking the lost one and the other one.
  "label"         TEXT NOT NULL,
  -- Whether the credential is synced to a provider (a passkey) or bound to one
  -- device. Not a security decision here, but it is what lets the UI say which is
  -- which, and an operator asking "is anything still tied to the laptop we wiped"
  -- has no other way to answer it.
  "backed_up"     BOOLEAN NOT NULL DEFAULT FALSE,
  "device_type"   TEXT NOT NULL DEFAULT 'singleDevice',
  "created_at"    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "last_used_at"  TIMESTAMPTZ
);

-- Every read is "this user's credentials", for the login step and the settings
-- list alike.
CREATE INDEX IF NOT EXISTS "webauthn_credentials_user_idx"
  ON "webauthn_credentials" ("user_id");

-- ── The ceremony challenge ───────────────────────────────────────────────────
-- A WebAuthn challenge must be server-generated, unpredictable and used exactly
-- once. The MFA challenge in lib/auth/mfaChallenge.ts is a signed token and
-- therefore stateless — which is right for it, and wrong here: a stateless token
-- can be presented twice within its lifetime, and "exactly once" is the property
-- this needs.
--
-- One row per user, replaced whenever a new ceremony starts and deleted when one
-- completes. That also means starting a second ceremony invalidates the first,
-- which is the behaviour you want: two outstanding challenges for one account is
-- not a case worth supporting.
CREATE TABLE IF NOT EXISTS "webauthn_challenges" (
  "user_id"    BIGINT PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "challenge"  TEXT NOT NULL,
  -- 'register' or 'authenticate'. A registration challenge must not be
  -- redeemable as an authentication one: they prove different things, and the
  -- registration ceremony happens inside an already-authenticated session.
  "kind"       TEXT NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

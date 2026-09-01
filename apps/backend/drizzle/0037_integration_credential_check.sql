-- An integration that claims authentication must have something to send.
--
-- `updateIntegration` enforces this in TypeScript, but it reads the row outside
-- any transaction, so two concurrent updates walk through the check (#195,
-- finding 9). A constraint is evaluated against the row as committed and cannot
-- be raced.

-- Any row already in the forbidden state is not waiting for a credential, it is
-- sending `Authorization: Bearer ` on every probe. Saying so in the data is
-- both more honest and less harmful than continuing to send an empty header,
-- and it surfaces in the admin UI where an operator can put a token back.
UPDATE "integrations" SET "auth_type" = 'none' WHERE "auth_type" <> 'none' AND "credential" IS NULL;
--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_credential_check" CHECK (auth_type = 'none' OR credential IS NOT NULL);

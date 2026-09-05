-- Why an element has no Terraform outputs (issue #215).
--
-- `recordOutputs` distinguishes five reasons and logs each one: no CI source for
-- the environment, a provider whose job logs cannot be read, a trigger URL with no
-- project segment, a log fetch that threw, and a log that simply contained no
-- Outputs block. All five rendered as the same empty card, so "the template
-- declares none" and "your CI token expired" were indistinguishable to the person
-- looking at the element — and the only person who could act on it was the one who
-- could not see the log.
--
-- On hcp-dev that cost an afternoon: the VM deployed, the order completed, and the
-- outputs were unreachable because the CI source's access token had been revoked.
-- The backend knew, in one line, in a container log.
--
-- NULL means "nothing went wrong": either outputs were recorded, or the element
-- has not settled yet. It is cleared on every successful read, so a token that is
-- fixed and a pipeline that is re-run leave no stale complaint behind.
ALTER TABLE "infrastructure_elements"
  ADD COLUMN IF NOT EXISTS "outputs_error" TEXT;

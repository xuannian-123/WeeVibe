-- Additive: existing saved answers become version 1 without altering any answer data.
-- Version 0 is a request precondition for "no previous answer", never a stored row.
ALTER TABLE "RequirementSubmission"
  ADD COLUMN "responseVersion" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "RequirementSubmission"
  ADD CONSTRAINT "RequirementSubmission_responseVersion_positive" CHECK ("responseVersion" > 0);

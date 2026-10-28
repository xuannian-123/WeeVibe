ALTER TABLE "Gathering" ADD COLUMN "submissionSequence" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "GatheringMember" ADD COLUMN "firstSubmissionSequence" INTEGER;
-- Existing submitted members are eligible before every event created after this migration.
-- Historical answer bodies are deliberately not replayed into notifications.
UPDATE "GatheringMember" SET "firstSubmissionSequence" = 0 WHERE "responseVersion" > 0;
ALTER TABLE "Gathering" ADD CONSTRAINT "Gathering_submission_sequence_check" CHECK ("submissionSequence" >= 0);
ALTER TABLE "GatheringMember" ADD CONSTRAINT "GatheringMember_first_submission_check" CHECK (
  ("responseVersion" = 0 AND "firstSubmissionSequence" IS NULL)
  OR ("responseVersion" > 0 AND "firstSubmissionSequence" IS NOT NULL AND "firstSubmissionSequence" >= 0)
);

CREATE TABLE "GatheringSubmissionEvent" (
  "id" UUID NOT NULL, "gatheringId" UUID NOT NULL, "actorUserId" UUID NOT NULL,
  "actorVersion" INTEGER NOT NULL, "sequence" INTEGER NOT NULL, "action" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GatheringSubmissionEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GatheringSubmissionEvent_sequence_check" CHECK ("sequence" > 0),
  CONSTRAINT "GatheringSubmissionEvent_action_check" CHECK (
    ("action" = 'submitted' AND "actorVersion" = 1) OR ("action" = 'updated' AND "actorVersion" > 1)
  )
);
CREATE UNIQUE INDEX "GatheringSubmissionEvent_gatheringId_actorUserId_actorVersion_key" ON "GatheringSubmissionEvent"("gatheringId", "actorUserId", "actorVersion");
CREATE UNIQUE INDEX "GatheringSubmissionEvent_gatheringId_sequence_key" ON "GatheringSubmissionEvent"("gatheringId", "sequence");
ALTER TABLE "GatheringSubmissionEvent" ADD CONSTRAINT "GatheringSubmissionEvent_gatheringId_fkey" FOREIGN KEY ("gatheringId") REFERENCES "Gathering"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GatheringSubmissionEvent" ADD CONSTRAINT "GatheringSubmissionEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "GatheringNotificationRecipient" (
  "id" UUID NOT NULL, "eventId" UUID NOT NULL, "userId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GatheringNotificationRecipient_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GatheringNotificationRecipient_eventId_userId_key" ON "GatheringNotificationRecipient"("eventId", "userId");
CREATE INDEX "GatheringNotificationRecipient_userId_createdAt_idx" ON "GatheringNotificationRecipient"("userId", "createdAt");
ALTER TABLE "GatheringNotificationRecipient" ADD CONSTRAINT "GatheringNotificationRecipient_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "GatheringSubmissionEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GatheringNotificationRecipient" ADD CONSTRAINT "GatheringNotificationRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "GatheringSubscriptionGrant" (
  "id" UUID NOT NULL, "userId" UUID NOT NULL, "gatheringId" UUID NOT NULL, "scope" TEXT NOT NULL, "appId" TEXT NOT NULL,
  "templateId" TEXT NOT NULL, "authorizationKey" TEXT NOT NULL, "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GatheringSubscriptionGrant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GatheringSubscriptionGrant_userId_authorizationKey_key" ON "GatheringSubscriptionGrant"("userId", "authorizationKey");
CREATE INDEX "GatheringSubscriptionGrant_available_idx" ON "GatheringSubscriptionGrant"("userId", "gatheringId", "scope", "appId", "templateId", "consumedAt");
ALTER TABLE "GatheringSubscriptionGrant" ADD CONSTRAINT "GatheringSubscriptionGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GatheringSubscriptionGrant" ADD CONSTRAINT "GatheringSubscriptionGrant_gatheringId_fkey" FOREIGN KEY ("gatheringId") REFERENCES "Gathering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "GatheringPushOutbox" (
  "id" UUID NOT NULL, "recipientId" UUID NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending',
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "attempts" INTEGER NOT NULL DEFAULT 0,
  "leaseTokenHash" CHAR(64), "leaseExpiresAt" TIMESTAMP(3), "grantId" UUID, "lastErrorCode" INTEGER,
  "sentAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GatheringPushOutbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GatheringPushOutbox_status_check" CHECK ("status" IN ('pending','leased','sent','failed','unknown')),
  CONSTRAINT "GatheringPushOutbox_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "GatheringPushOutbox_lease_check" CHECK (("leaseTokenHash" IS NULL) = ("leaseExpiresAt" IS NULL))
);
CREATE UNIQUE INDEX "GatheringPushOutbox_recipientId_key" ON "GatheringPushOutbox"("recipientId");
CREATE UNIQUE INDEX "GatheringPushOutbox_grantId_key" ON "GatheringPushOutbox"("grantId");
CREATE INDEX "GatheringPushOutbox_status_nextAttemptAt_idx" ON "GatheringPushOutbox"("status", "nextAttemptAt");
ALTER TABLE "GatheringPushOutbox" ADD CONSTRAINT "GatheringPushOutbox_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "GatheringNotificationRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GatheringPushOutbox" ADD CONSTRAINT "GatheringPushOutbox_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "GatheringSubscriptionGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "GatheringWorkerNonce" (
  "id" UUID NOT NULL, "scope" TEXT NOT NULL, "appId" TEXT NOT NULL, "nonceHash" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GatheringWorkerNonce_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GatheringWorkerNonce_scope_appId_nonceHash_key" ON "GatheringWorkerNonce"("scope", "appId", "nonceHash");
CREATE INDEX "GatheringWorkerNonce_expiresAt_idx" ON "GatheringWorkerNonce"("expiresAt");

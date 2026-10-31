CREATE TABLE "GatheringArrangementVersion" (
  "id" UUID NOT NULL,
  "gatheringId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "generationId" UUID NOT NULL,
  "planId" TEXT NOT NULL,
  "sourceHash" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "publishedByUserId" UUID NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GatheringArrangementVersion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GatheringArrangementVersion_gatheringId_version_key" ON "GatheringArrangementVersion"("gatheringId", "version");
CREATE UNIQUE INDEX "GatheringArrangementVersion_gatheringId_idempotencyKey_key" ON "GatheringArrangementVersion"("gatheringId", "idempotencyKey");
CREATE INDEX "GatheringArrangementVersion_gatheringId_publishedAt_idx" ON "GatheringArrangementVersion"("gatheringId", "publishedAt");
ALTER TABLE "GatheringArrangementVersion" ADD CONSTRAINT "GatheringArrangementVersion_gatheringId_fkey" FOREIGN KEY ("gatheringId") REFERENCES "Gathering"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GatheringArrangementVersion" ADD CONSTRAINT "GatheringArrangementVersion_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "GatheringGeneration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GatheringArrangementVersion" ADD CONSTRAINT "GatheringArrangementVersion_publishedByUserId_fkey" FOREIGN KEY ("publishedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "GatheringGeneration" ADD COLUMN "baseArrangementId" UUID;
ALTER TABLE "GatheringGeneration" ADD COLUMN "adjustmentHash" TEXT;
ALTER TABLE "GatheringGeneration" ADD CONSTRAINT "GatheringGeneration_baseArrangementId_fkey" FOREIGN KEY ("baseArrangementId") REFERENCES "GatheringArrangementVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "GatheringGeneration_baseArrangementId_idx" ON "GatheringGeneration"("baseArrangementId");

CREATE TABLE "GatheringAttendance" (
  "id" UUID NOT NULL,
  "gatheringId" UUID NOT NULL,
  "memberUserId" UUID NOT NULL,
  "arrangementId" UUID NOT NULL,
  "decision" TEXT NOT NULL,
  "responseVersion" INTEGER NOT NULL DEFAULT 1,
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GatheringAttendance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GatheringAttendance_decision_check" CHECK ("decision" IN ('going','unsure','not_going'))
);
CREATE UNIQUE INDEX "GatheringAttendance_gatheringId_memberUserId_arrangementId_key" ON "GatheringAttendance"("gatheringId", "memberUserId", "arrangementId");
CREATE UNIQUE INDEX "GatheringAttendance_gatheringId_memberUserId_idempotencyKey_key" ON "GatheringAttendance"("gatheringId", "memberUserId", "idempotencyKey");
CREATE INDEX "GatheringAttendance_arrangementId_decision_idx" ON "GatheringAttendance"("arrangementId", "decision");
ALTER TABLE "GatheringAttendance" ADD CONSTRAINT "GatheringAttendance_gatheringId_fkey" FOREIGN KEY ("gatheringId") REFERENCES "Gathering"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GatheringAttendance" ADD CONSTRAINT "GatheringAttendance_memberUserId_fkey" FOREIGN KEY ("memberUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GatheringAttendance" ADD CONSTRAINT "GatheringAttendance_arrangementId_fkey" FOREIGN KEY ("arrangementId") REFERENCES "GatheringArrangementVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "GatheringFeedback" (
  "id" UUID NOT NULL,
  "gatheringId" UUID NOT NULL,
  "authorUserId" UUID NOT NULL,
  "arrangementId" UUID NOT NULL,
  "body" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "idempotencyKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "GatheringFeedback_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "GatheringFeedback_status_check" CHECK ("status" IN ('open','applied','dismissed'))
);
CREATE UNIQUE INDEX "GatheringFeedback_gatheringId_authorUserId_idempotencyKey_key" ON "GatheringFeedback"("gatheringId", "authorUserId", "idempotencyKey");
CREATE INDEX "GatheringFeedback_arrangementId_createdAt_idx" ON "GatheringFeedback"("arrangementId", "createdAt");
ALTER TABLE "GatheringFeedback" ADD CONSTRAINT "GatheringFeedback_gatheringId_fkey" FOREIGN KEY ("gatheringId") REFERENCES "Gathering"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GatheringFeedback" ADD CONSTRAINT "GatheringFeedback_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GatheringFeedback" ADD CONSTRAINT "GatheringFeedback_arrangementId_fkey" FOREIGN KEY ("arrangementId") REFERENCES "GatheringArrangementVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Additive, not applied to shared/production databases.
CREATE TABLE "RequirementSurvey" (
 "id" UUID PRIMARY KEY,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('friend', 'team')),
 "ownerUserId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "activityId" UUID UNIQUE REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "draft" JSONB NOT NULL,
 "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision" > 0),
 "status" TEXT NOT NULL DEFAULT 'draft' CHECK ("status" IN ('draft', 'open', 'closed', 'finalized')),
 "deadlineAt" TIMESTAMP(3), "closedAt" TIMESTAMP(3), "finalSelection" JSONB,
 "creationKey" TEXT NOT NULL, "creationHash" CHAR(64) NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "RequirementSurvey_kind_activity_check" CHECK (("kind" = 'friend' AND "activityId" IS NOT NULL) OR ("kind" = 'team' AND "activityId" IS NULL)),
 CONSTRAINT "RequirementSurvey_published_deadline_check" CHECK ("status" = 'draft' OR "deadlineAt" IS NOT NULL),
 UNIQUE ("ownerUserId", "creationKey")
);
CREATE INDEX "RequirementSurvey_ownerUserId_updatedAt_idx" ON "RequirementSurvey"("ownerUserId", "updatedAt");
CREATE TABLE "RequirementSubmission" (
 "collectionId" UUID NOT NULL REFERENCES "RequirementSurvey"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "revision" INTEGER NOT NULL CHECK ("revision" > 0),
 "publicAnswers" JSONB NOT NULL, "privateOrigin" JSONB,
 "updatedAt" TIMESTAMP(3) NOT NULL,
 PRIMARY KEY ("collectionId", "userId")
);
CREATE INDEX "RequirementSubmission_userId_updatedAt_idx" ON "RequirementSubmission"("userId", "updatedAt");
CREATE TABLE "RequirementWriteBudget" (
 "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "scope" TEXT NOT NULL, "bucketStart" TIMESTAMP(3) NOT NULL, "count" INTEGER NOT NULL CHECK ("count" >= 0),
 PRIMARY KEY ("userId", "scope")
);

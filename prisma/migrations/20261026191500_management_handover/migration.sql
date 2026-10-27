-- Additive only: no ownership reset, old-row rewrite, or history deletion.
CREATE TYPE "ManagementHandoverStatus" AS ENUM ('pending', 'accepted', 'rejected', 'withdrawn', 'invalidated');
CREATE TABLE "ManagementHandover" (
 "id" UUID NOT NULL,
 "activityId" UUID NOT NULL,
 "fromUserId" UUID NOT NULL,
 "toUserId" UUID NOT NULL,
 "fromManagementRevision" INTEGER NOT NULL,
 "creationKey" TEXT NOT NULL,
 "status" "ManagementHandoverStatus" NOT NULL DEFAULT 'pending',
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "resolvedAt" TIMESTAMP(3),
 CONSTRAINT "ManagementHandover_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "ManagementHandover_distinct_users" CHECK ("fromUserId" <> "toUserId"),
 CONSTRAINT "ManagementHandover_positive_revision" CHECK ("fromManagementRevision" > 0),
 CONSTRAINT "ManagementHandover_resolution_time" CHECK (("status" = 'pending' AND "resolvedAt" IS NULL) OR ("status" <> 'pending' AND "resolvedAt" IS NOT NULL)),
 CONSTRAINT "ManagementHandover_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ManagementHandover_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 CONSTRAINT "ManagementHandover_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ManagementHandover_one_pending_per_activity" ON "ManagementHandover"("activityId") WHERE "status" = 'pending';
CREATE UNIQUE INDEX "ManagementHandover_fromUserId_creationKey_key" ON "ManagementHandover"("fromUserId", "creationKey");
CREATE INDEX "ManagementHandover_activityId_createdAt_idx" ON "ManagementHandover"("activityId", "createdAt");
CREATE INDEX "ManagementHandover_toUserId_status_idx" ON "ManagementHandover"("toUserId", "status");

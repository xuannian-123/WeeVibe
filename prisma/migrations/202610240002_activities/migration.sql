-- Offline additive WG-02/03 migration. NOT executed against PostgreSQL in round two.
-- CreateEnum
CREATE TYPE "ActivitySegmentType" AS ENUM ('sport', 'dinner', 'karaoke', 'drinks', 'board_game', 'custom');

-- CreateEnum
CREATE TYPE "ActivityApplicationStatus" AS ENUM ('pending', 'approved', 'rejected', 'withdrawn');

-- CreateEnum
CREATE TYPE "ParticipationStatus" AS ENUM ('joined', 'exited');

-- CreateEnum
CREATE TYPE "SegmentVerificationStatus" AS ENUM ('unknown', 'manual_checked');

-- CreateEnum
CREATE TYPE "SegmentBookingStatus" AS ENUM ('unknown', 'manual_booked');

-- CreateTable
CREATE TABLE "Activity" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "currentManagerId" UUID NOT NULL,
    "mainSegmentId" UUID,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "membershipRevision" INTEGER NOT NULL DEFAULT 1,
    "managementRevision" INTEGER NOT NULL DEFAULT 1,
    "mainRevision" INTEGER NOT NULL DEFAULT 1,
    "confirmedMainRevision" INTEGER,
    "confirmedPlanRevision" INTEGER,
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Segment" (
    "id" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "clientRef" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "type" "ActivitySegmentType" NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "minimumParticipants" INTEGER NOT NULL,
    "capacity" INTEGER NOT NULL,
    "location" JSONB NOT NULL,
    "fee" JSONB NOT NULL,
    "requirements" TEXT NOT NULL,
    "planRevision" INTEGER NOT NULL DEFAULT 1,
    "cancelledAt" TIMESTAMP(3),
    "verificationStatus" "SegmentVerificationStatus" NOT NULL DEFAULT 'unknown',
    "bookingStatus" "SegmentBookingStatus" NOT NULL DEFAULT 'unknown',

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityApplication" (
    "id" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "applicantUserId" UUID NOT NULL,
    "displayName" TEXT,
    "status" "ActivityApplicationStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ActivityApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApplicationTarget" (
    "activityId" UUID NOT NULL,
    "applicationId" UUID NOT NULL,
    "segmentId" UUID NOT NULL,
    "acceptedPlanRevision" INTEGER NOT NULL,

    CONSTRAINT "ApplicationTarget_pkey" PRIMARY KEY ("applicationId","segmentId")
);

-- CreateTable
CREATE TABLE "Participation" (
    "id" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "segmentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "ParticipationStatus" NOT NULL DEFAULT 'joined',
    "acceptedPlanRevision" INTEGER,
    "acceptedAt" TIMESTAMP(3),
    "displayName" TEXT,
    "sourceApplicationId" UUID,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "exitedAt" TIMESTAMP(3),

    CONSTRAINT "Participation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityMutationKey" (
    "actorUserId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "activityId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityMutationKey_pkey" PRIMARY KEY ("actorUserId","key")
);

-- CreateTable
CREATE TABLE "ActivityEvent" (
    "id" UUID NOT NULL,
    "activityId" UUID NOT NULL,
    "actorUserId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Segment_activityId_id_key" ON "Segment"("activityId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Segment_activityId_clientRef_key" ON "Segment"("activityId", "clientRef");

-- CreateIndex
CREATE UNIQUE INDEX "Segment_activityId_position_key" ON "Segment"("activityId", "position");

-- CreateIndex
CREATE INDEX "ActivityApplication_activityId_status_idx" ON "ActivityApplication"("activityId", "status");

-- CreateIndex
CREATE INDEX "ActivityApplication_applicantUserId_idx" ON "ActivityApplication"("applicantUserId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityApplication_activityId_id_key" ON "ActivityApplication"("activityId", "id");

-- CreateIndex
CREATE INDEX "Participation_activityId_userId_idx" ON "Participation"("activityId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Participation_segmentId_userId_key" ON "Participation"("segmentId", "userId");

-- CreateIndex
CREATE INDEX "ActivityEvent_activityId_revision_idx" ON "ActivityEvent"("activityId", "revision");

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_currentManagerId_fkey" FOREIGN KEY ("currentManagerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_id_mainSegmentId_fkey" FOREIGN KEY ("id", "mainSegmentId") REFERENCES "Segment"("activityId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityApplication" ADD CONSTRAINT "ActivityApplication_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityApplication" ADD CONSTRAINT "ActivityApplication_applicantUserId_fkey" FOREIGN KEY ("applicantUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationTarget" ADD CONSTRAINT "ApplicationTarget_activityId_applicationId_fkey" FOREIGN KEY ("activityId", "applicationId") REFERENCES "ActivityApplication"("activityId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApplicationTarget" ADD CONSTRAINT "ApplicationTarget_activityId_segmentId_fkey" FOREIGN KEY ("activityId", "segmentId") REFERENCES "Segment"("activityId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_activityId_segmentId_fkey" FOREIGN KEY ("activityId", "segmentId") REFERENCES "Segment"("activityId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_activityId_sourceApplicationId_fkey" FOREIGN KEY ("activityId", "sourceApplicationId") REFERENCES "ActivityApplication"("activityId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ActivityMutationKey" ADD CONSTRAINT "ActivityMutationKey_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityMutationKey" ADD CONSTRAINT "ActivityMutationKey_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Persistent structural guards complement (not replace) transactional seat checks.
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_participant_limits_check"
    CHECK ("minimumParticipants" >= 1 AND "capacity" >= "minimumParticipants");
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_time_order_check"
    CHECK ("startsAt" < "endsAt" AND "deadlineAt" <= "startsAt");
ALTER TABLE "Segment" ADD CONSTRAINT "Segment_revision_position_check"
    CHECK ("planRevision" >= 1 AND "position" >= 0);
ALTER TABLE "ApplicationTarget" ADD CONSTRAINT "ApplicationTarget_revision_check"
    CHECK ("acceptedPlanRevision" >= 1);
ALTER TABLE "Participation" ADD CONSTRAINT "Participation_revision_check"
    CHECK ("acceptedPlanRevision" IS NULL OR "acceptedPlanRevision" >= 1);

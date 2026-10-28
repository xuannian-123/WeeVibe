-- CreateTable
CREATE TABLE "Gathering" (
    "id" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "details" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "creationKey" TEXT NOT NULL,
    "creationHash" TEXT NOT NULL,
    "currentGenerationId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gathering_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GatheringMember" (
    "gatheringId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "publicIntake" JSONB NOT NULL,
    "privateIntake" JSONB NOT NULL,
    "answers" JSONB NOT NULL,
    "responseVersion" INTEGER NOT NULL DEFAULT 0,
    "lastWriteKey" TEXT,
    "lastWriteHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GatheringMember_pkey" PRIMARY KEY ("gatheringId","userId")
);

-- CreateTable
CREATE TABLE "GatheringGeneration" (
    "id" UUID NOT NULL,
    "gatheringId" UUID NOT NULL,
    "creatorUserId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GatheringGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Gathering_ownerUserId_updatedAt_idx" ON "Gathering"("ownerUserId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Gathering_ownerUserId_creationKey_key" ON "Gathering"("ownerUserId", "creationKey");

-- CreateIndex
CREATE INDEX "GatheringMember_userId_updatedAt_idx" ON "GatheringMember"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "GatheringGeneration_gatheringId_createdAt_idx" ON "GatheringGeneration"("gatheringId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GatheringGeneration_gatheringId_idempotencyKey_key" ON "GatheringGeneration"("gatheringId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "Gathering" ADD CONSTRAINT "Gathering_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatheringMember" ADD CONSTRAINT "GatheringMember_gatheringId_fkey" FOREIGN KEY ("gatheringId") REFERENCES "Gathering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatheringMember" ADD CONSTRAINT "GatheringMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatheringGeneration" ADD CONSTRAINT "GatheringGeneration_gatheringId_fkey" FOREIGN KEY ("gatheringId") REFERENCES "Gathering"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GatheringGeneration" ADD CONSTRAINT "GatheringGeneration_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "Gathering" ADD CONSTRAINT "Gathering_kind_check" CHECK ("kind" IN ('friend','team'));
ALTER TABLE "Gathering" ADD CONSTRAINT "Gathering_revision_check" CHECK ("revision" > 0);
ALTER TABLE "GatheringMember" ADD CONSTRAINT "GatheringMember_version_check" CHECK ("responseVersion" >= 0);
ALTER TABLE "GatheringGeneration" ADD CONSTRAINT "GatheringGeneration_status_check" CHECK ("status" IN ('processing','ready','failed'));
CREATE UNIQUE INDEX "GatheringGeneration_one_processing_idx" ON "GatheringGeneration" ("gatheringId") WHERE "status" = 'processing';

-- Final choice is appended to the gathering flow; the preceding migrations are unchanged.
ALTER TABLE "Gathering"
    ADD COLUMN "finalGenerationId" UUID,
    ADD COLUMN "finalPlanId" TEXT,
    ADD COLUMN "finalizedAt" TIMESTAMP(3);

ALTER TABLE "Gathering" ADD CONSTRAINT "Gathering_final_choice_check" CHECK (
    ("finalGenerationId" IS NULL AND "finalPlanId" IS NULL AND "finalizedAt" IS NULL)
    OR
    ("kind" = 'friend' AND "finalGenerationId" IS NOT NULL AND "finalPlanId" IS NOT NULL
        AND "finalizedAt" IS NOT NULL AND "currentGenerationId" IS NOT NULL
        AND "currentGenerationId" = "finalGenerationId"
        AND "finalPlanId" ~ '^[a-z][a-z0-9_-]{0,63}$')
);

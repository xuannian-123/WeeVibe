-- The unique digest is consumed in the same transaction as identity/session creation.
CREATE TABLE "CloudLoginUse" (
    "digest" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CloudLoginUse_pkey" PRIMARY KEY ("digest")
);

CREATE INDEX "CloudLoginUse_expiresAt_idx" ON "CloudLoginUse"("expiresAt");

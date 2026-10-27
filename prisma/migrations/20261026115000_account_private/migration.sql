-- Additive only. Not executed against any shared or production database.
CREATE TABLE "PrivateProfile" (
 "userId" UUID PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "data" JSONB NOT NULL,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "SavedVenue" (
 "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "providerId" TEXT NOT NULL,
 "data" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("userId", "providerId")
);
CREATE TABLE "MessageRead" (
 "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "messageId" TEXT NOT NULL,
 "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("userId", "messageId")
);

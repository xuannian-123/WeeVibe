-- Additive; never applied to shared or production databases by this task.
CREATE TABLE "UserAvatar" (
 "userId" UUID PRIMARY KEY REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "bytes" BYTEA NOT NULL,
 "contentType" TEXT NOT NULL,
 "digest" CHAR(64) NOT NULL,
 "updatedAt" TIMESTAMP(3) NOT NULL
);

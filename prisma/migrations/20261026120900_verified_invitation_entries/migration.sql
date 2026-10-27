-- Additive; source records do not grant participation or group membership.
CREATE TABLE "InvitationSource" (
 "id" UUID PRIMARY KEY,
 "activityId" UUID NOT NULL REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "inviterUserId" UUID NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "inviterDisplayName" TEXT, "inviterAvatarUrl" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("activityId", "inviterUserId")
);
CREATE TABLE "ReceivedInvitation" (
 "userId" UUID NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "invitationId" UUID NOT NULL REFERENCES "InvitationSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "savedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("userId", "invitationId")
);
CREATE INDEX "ReceivedInvitation_userId_savedAt_idx" ON "ReceivedInvitation"("userId", "savedAt");

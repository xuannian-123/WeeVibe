-- Generated from schema.prisma via offline migrate diff; NOT applied to a database.
CREATE SCHEMA IF NOT EXISTS "public";
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "WechatIdentity" (
    "id" UUID NOT NULL,
    "appId" TEXT NOT NULL,
    "openId" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    CONSTRAINT "WechatIdentity_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "AuthSession" (
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("tokenHash")
);
CREATE TABLE "UserTestRecord" (
    "userId" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserTestRecord_pkey" PRIMARY KEY ("userId")
);
CREATE UNIQUE INDEX "WechatIdentity_appId_openId_key" ON "WechatIdentity"("appId", "openId");
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");
ALTER TABLE "WechatIdentity" ADD CONSTRAINT "WechatIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserTestRecord" ADD CONSTRAINT "UserTestRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

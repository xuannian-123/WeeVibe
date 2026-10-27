-- Additive, not applied to shared/production databases.
ALTER TABLE "Participation" ADD COLUMN "lateArrivalAt" TIMESTAMP(3), ADD COLUMN "lateNoticeAt" TIMESTAMP(3);

-- Source only. Deployment must explicitly pair this migration with the API.
ALTER TABLE "GatheringMember" ADD COLUMN "avatarKey" TEXT;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "GatheringMember" GROUP BY "gatheringId" HAVING count(*) > 504) THEN
    RAISE EXCEPTION 'Activity exceeds the non-repeating avatar pool';
  END IF;
END $$;

-- One random permutation per existing activity. No profile or private answers
-- enter the assignment. The legacy animalId column stays intact for old reads.
WITH pool AS (
  SELECT 'art-' || animal || '-' || lpad(color::text,2,'0') AS key,
    row_number() OVER (ORDER BY random()) AS n
  FROM unnest(ARRAY['rabbit','hedgehog','elephant','squirrel','panda','ox','fox','dog','lion','wolf','pig','cat','monkey','sheep','tiger','crab','giraffe','horse','rooster','duck','deer']) AS animal
  CROSS JOIN generate_series(0,23) AS color
), members AS (
  SELECT "gatheringId", "userId", row_number() OVER (PARTITION BY "gatheringId" ORDER BY random()) AS n
  FROM "GatheringMember"
)
UPDATE "GatheringMember" AS member SET "avatarKey"=pool.key
FROM members JOIN pool USING(n)
WHERE member."gatheringId"=members."gatheringId" AND member."userId"=members."userId";

ALTER TABLE "GatheringMember" ADD CONSTRAINT "GatheringMember_avatar_key_check"
  CHECK ("avatarKey" IS NULL OR "avatarKey" ~ '^art-(rabbit|hedgehog|elephant|squirrel|panda|ox|fox|dog|lion|wolf|pig|cat|monkey|sheep|tiger|crab|giraffe|horse|rooster|duck|deer)-(0[0-9]|1[0-9]|2[0-3])$');
CREATE UNIQUE INDEX "GatheringMember_gatheringId_avatarKey_key" ON "GatheringMember"("gatheringId","avatarKey");

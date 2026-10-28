-- A random animal is stored once for existing and new members; no profile/photo is read.
ALTER TABLE "GatheringMember" ADD COLUMN "animalId" TEXT NOT NULL
  DEFAULT ((ARRAY['cat','dog','fox','rabbit','bear','panda','koala','tiger','lion','penguin','owl','capybara'])[1 + floor(random() * 12)::int]);
ALTER TABLE "GatheringMember" ADD CONSTRAINT "GatheringMember_animal_check"
  CHECK ("animalId" IN ('cat','dog','fox','rabbit','bear','panda','koala','tiger','lion','penguin','owl','capybara'));

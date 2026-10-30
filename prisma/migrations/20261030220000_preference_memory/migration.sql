CREATE TABLE "PreferenceMemory" (
 "userId" uuid PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
 learning boolean NOT NULL DEFAULT false, recommending boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1, "profileVersion" integer NOT NULL DEFAULT 1, barriers jsonb NOT NULL DEFAULT '{}', profile jsonb NOT NULL DEFAULT '[]', overrides jsonb NOT NULL DEFAULT '{}'
);
CREATE TABLE "PreferenceLearningJob" (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), "userId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
 "sourceId" uuid NOT NULL REFERENCES "Gathering"(id) ON DELETE CASCADE,
 "sourceVersion" integer NOT NULL, epoch integer NOT NULL, status text NOT NULL DEFAULT 'pending',
 attempts integer NOT NULL DEFAULT 0, "availableAt" timestamptz NOT NULL DEFAULT now(), "createdAt" timestamptz NOT NULL DEFAULT now(),
 UNIQUE ("userId","sourceId","sourceVersion")
);
CREATE INDEX "PreferenceLearningJob_pending" ON "PreferenceLearningJob"(status,"availableAt");
CREATE TABLE "PreferenceEvidence" (
 "userId" uuid NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
 "sourceId" uuid NOT NULL REFERENCES "Gathering"(id) ON DELETE CASCADE,
 category text NOT NULL CHECK(category IN ('play','travel','pace')), "sourceVersion" integer NOT NULL,
 "values" jsonb NOT NULL, "occurredAt" timestamptz NOT NULL,
 PRIMARY KEY ("userId","sourceId",category)
);

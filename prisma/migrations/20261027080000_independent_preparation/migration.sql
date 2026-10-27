-- Permit idea-first friend preparations without creating a placeholder activity.
-- Existing surveys/answers and original migration files remain unchanged.
ALTER TABLE "RequirementSurvey" DROP CONSTRAINT "RequirementSurvey_kind_activity_check";
ALTER TABLE "RequirementSurvey" ADD CONSTRAINT "RequirementSurvey_kind_activity_check"
  CHECK (("kind" = 'friend') OR ("kind" = 'team' AND "activityId" IS NULL));

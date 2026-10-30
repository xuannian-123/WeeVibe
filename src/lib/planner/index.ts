// 算法模块对外接口（见 docs/CONTRACT.md 第四节「算法 C」）
export { generateSlots, MAX_SLOTS } from "./slots";
export { fairCenter, minEnclosingCircle } from "./center";
export { experienceFor, publicExperience, type PlanContext } from "./experience";
export { planJu, ALGORITHM_VERSION, LABEL_TEXT, outputHashOf } from "./plan";
export { buildSwipeDeck, predictSwipes, autofillFromProfile, availabilityFromBusy } from "./intake";
export { fairnessWeights, ledgerEntryFor } from "./fairness";
export { replanStable, proposalAt } from "./replan";
export { itineraryFor, etaFor } from "./itinerary";
export { splitBill, settle } from "./bill";
export { canonicalJson, chainName, slotLabel } from "./util";
export { checkDiet, dietConflictReason } from "./diet";
export { demoPeople, DEMO_VENUE, DEMO_ORGANIZER_PLACE, type DemoPerson } from "./demo";
export {
  solveGrouping,
  symmetricFamiliarity,
  normalizeInterests,
  canonicalInput,
  groupingStats,
  tableSizes,
  pairKey,
  AVOID_COVER,
  GROUPING_VERSION,
  type GroupingInput,
  type GroupingPerson,
  type GroupingResult,
} from "./grouping";
export {
  planFormats,
  pickFormat,
  nextIntensity,
  majorityFeel,
  firstRoundWhy,
  adjustText,
  tableTopics,
  isDiningCategory,
  type FormatContext,
} from "./formats";
export { slotWeather, classifyWeather, risksFor, openFits, parseOpenTime, weatherEffects, type SlotWeather, type WeatherKind } from "./external";
export { poiIndoor } from "./needs";
// v6 活动层（docs/AVATAR.md 第 3 节）
export {
  ACTIVITY_LIB,
  activityByKey,
  activitiesIn,
  activityFit,
  scoreActivities,
  type ActivityInfo,
  type ActivityProfile,
  type ActivityScore,
} from "./activities";
export { buildPrograms, programExperience, moodSummary, type Program, type ProgramRow, type SegRun } from "./program";
export { activityMode, proposalIdOf, whereText } from "./plan";

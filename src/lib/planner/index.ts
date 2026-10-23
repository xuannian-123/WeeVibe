// 算法模块对外接口（见 docs/CONTRACT.md 第四节「算法 C」）
export { generateSlots, MAX_SLOTS } from "./slots";
export { fairCenter, minEnclosingCircle } from "./center";
export { experienceFor, publicExperience, type PlanContext } from "./experience";
export { planJu, ALGORITHM_VERSION, LABEL_TEXT, outputHashOf } from "./plan";
export { buildSwipeDeck, predictSwipes, autofillFromProfile, availabilityFromBusy } from "./intake";
export { fairnessWeights, ledgerEntryFor } from "./fairness";
export { replanStable } from "./replan";
export { itineraryFor, etaFor } from "./itinerary";
export { splitBill, settle } from "./bill";
export { canonicalJson, chainName, slotLabel } from "./util";
export { checkDiet, dietConflictReason } from "./diet";
export { demoPeople, DEMO_VENUE, DEMO_ORGANIZER_PLACE, type DemoPerson } from "./demo";

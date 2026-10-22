// 算法模块对外接口（见 docs/CONTRACT.md）
export { generateSlots, pickSlot, MAX_SLOTS } from "./slots";
export { fairCenter, minEnclosingCircle } from "./center";
export { planJu, settle, chainName, effectiveBudget } from "./plan";
export { checkDiet, dietConflictReason } from "./diet";
export { scoreOption, WEIGHTS } from "./score";

// 共享类型契约 —— 前端 / 后端 / 算法三方共用。改动前先找 leader。

export type LatLng = { lat: number; lng: number };

export type Place = LatLng & { label: string };

/** AI 从一句话里解析出的组局需求 */
export type JuSpec = {
  /** 活动类型，如 火锅 / 烧烤 / 桌游 / 羽毛球 / KTV */
  category: string;
  /** 用于搜索场地的关键词，如 ["火锅"] */
  poiKeywords: string[];
  headcount?: number;
  /** 人均预算上限（元） */
  budgetPerPerson?: number;
  /** 候选日期 YYYY-MM-DD，按时间顺序 */
  dates: string[];
  /** 每天可开始的最早 / 最晚时间 HH:mm */
  earliest: string;
  latest: string;
  durationMinutes: number;
  /** 城市，如 "苏州" */
  city: string;
  notes?: string;
};

/** 候选开始时间，成员在这些时间里勾选自己有空的 */
export type Slot = {
  id: string; // 如 "2026-10-23T18:30"
  start: string; // ISO，带 +08:00
  end: string;
};

export type DietTag =
  | "不吃辣"
  | "素食"
  | "清真"
  | "不吃牛肉"
  | "不吃海鲜"
  | "不吃内脏";

export type Member = {
  id: string;
  juId: string;
  name: string;
  /** 头像用的 emoji */
  avatar: string;
  location: Place;
  availableSlotIds: string[];
  dietRaw: string;
  dietTags: DietTag[];
  /** 个人人均预算上限，可空 */
  budgetMax?: number;
  status: "in" | "out";
  joinedAt: string;
  isOrganizer: boolean;
};

export type Poi = LatLng & {
  id: string;
  name: string;
  address: string;
  /** 0-5 */
  rating?: number;
  /** 人均（元） */
  costPerPerson?: number;
  /** 高德类型，如 "餐饮服务;中餐厅;火锅店" */
  type: string;
  tel?: string;
  photoUrl?: string;
};

export type Commute = { memberId: string; minutes: number; distanceKm: number };

export type PlanOption = {
  poi: Poi;
  /** 综合分 0-100 */
  score: number;
  commutes: Commute[];
  maxCommute: number;
  avgCommute: number;
  /** 忌口冲突，如 ["小王：不吃辣（川味火锅）"]；空数组 = 无冲突 */
  conflicts: string[];
  /** 结构化理由，如 ["最远的人 18 分钟", "人均 92 元，在预算内"] */
  reasons: string[];
  /** LLM 生成的一句话推荐语（可空，后端补） */
  blurb?: string;
};

export type Plan = {
  slotId: string;
  /** 这个时间能来的成员 */
  attendeeIds: string[];
  /** 没法来的成员 */
  absentIds: string[];
  /** 公平集合点（搜索中心） */
  center: LatLng;
  options: PlanOption[]; // 通常 3 个
  computedAt: string;
};

export type JuStatus = "collecting" | "voting" | "confirmed" | "cancelled";

export type Ju = {
  id: string;
  title: string;
  rawPrompt: string;
  spec: JuSpec;
  slots: Slot[];
  status: JuStatus;
  createdAt: string;
  plan?: Plan;
  /** memberId -> poi.id */
  votes: Record<string, string>;
  /** 定局后选中的 poi.id */
  confirmedPoiId?: string;
  /** AA 结算（P1） */
  settlement?: { total: number; perPerson: number; payerName?: string };
};

/** GET /api/ju/[id] 的返回 —— 前端轮询用的全量状态 */
export type JuState = {
  ju: Ju;
  members: Member[];
};

/** 地图能力抽象：高德实现 + 无 key 时的 mock 实现 */
export interface MapProvider {
  /** 地点联想搜索（成员填出发地用） */
  searchPlaces(q: string, city: string): Promise<Place[]>;
  reverseGeocode(p: LatLng): Promise<string>;
  /** 在 center 附近 radius 米内按关键词搜场地 */
  searchAround(center: LatLng, keywords: string[], radiusM: number, city: string): Promise<Poi[]>;
  /** 多个起点到一个终点的通勤估算 */
  commute(origins: LatLng[], dest: LatLng): Promise<{ minutes: number; distanceKm: number }[]>;
}

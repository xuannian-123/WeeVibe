// 共享类型契约 v2 —— 前端 / 后端 / 算法三方共用。改动前先找 leader。
// v2 核心：局长私聊每个人 → 按「每个人的感受」联合决定时间 × 地点 → 把取舍讲清楚 → 思考过程直播。

export type LatLng = { lat: number; lng: number };

export type Place = LatLng & { label: string };

/** AI 从发起人一句话里解析出的组局需求 */
export type JuSpec = {
  /** 活动类型，如 火锅 / 烧烤 / 桌游 / 羽毛球 / KTV */
  category: string;
  /** 用于搜索场地的关键词，如 ["火锅"] */
  poiKeywords: string[];
  headcount?: number;
  /** 发起人说的人均预算（公开）。成员私下说的预算在 MemberPrivate 里 */
  budgetPerPerson?: number;
  /** 候选日期 YYYY-MM-DD，按时间顺序 */
  dates: string[];
  /** 每天可开始的最早 / 最晚时间 HH:mm */
  earliest: string;
  latest: string;
  durationMinutes: number;
  city: string;
  notes?: string;
};

/** 候选开始时间 */
export type Slot = {
  id: string; // 如 "2026-10-23T18:30"
  start: string; // ISO，带 +08:00
  end: string;
};

export type DietTag = "不吃辣" | "素食" | "清真" | "不吃牛肉" | "不吃海鲜" | "不吃内脏";

/** 某一天这个人的时间情况（局长从私聊里提取） */
export type DayAvailability = {
  /** 最早几点能从出发地出发 HH:mm（如 6 点半下班 → "18:30"） */
  from: string;
  /** 几点前必须回到出发地 HH:mm（门禁 / 末班车 / 家里有事），可空 */
  homeBy?: string;
  /** 这一天的意愿 */
  pref: "best" | "ok" | "meh";
};

/** 刷卡表态 */
export type SwipeVerdict = "love" | "like" | "pass";

/** 局长私聊的一轮 */
export type ChatTurn = { role: "juzhang" | "me"; text: string; at: string };

/** 私聊里局长想让前端顺手弹出的输入组件 */
export type ChatWidget = "location" | "time" | "diet" | "budget" | "swipe" | null;

/** 只有本人和后端可见的东西 —— 公开接口绝不能返回 */
export type MemberPrivate = {
  chat: ChatTurn[];
  /** 私下说的人均上限 */
  budgetMax?: number;
  /** 私下说的其他约束原话摘要，如 "这周减肥，别太油" */
  notes: string[];
  /** poi.id -> 表态 */
  swipes: Record<string, SwipeVerdict>;
};

/** 入局进度（公开） */
export type IntakeStage = "chatting" | "swiping" | "done";

export type Member = {
  id: string;
  juId: string;
  name: string;
  /** 头像 emoji */
  avatar: string;
  /** 出发地；私聊还没问到时为空 */
  location?: Place;
  /** 日期 YYYY-MM-DD -> 那天的时间情况；没出现的日期 = 那天不行 */
  availability: Record<string, DayAvailability>;
  dietTags: DietTag[];
  /** 主角 / 必到：这个人来不了的方案直接否决 */
  role: "guest" | "must";
  intake: IntakeStage;
  status: "in" | "out";
  joinedAt: string;
  isOrganizer: boolean;
  /** 跨局记忆用的设备级档案 id */
  profileId?: string;
  /** 从打开链接到入局完成的秒数（PMF 数据） */
  fillSeconds?: number;
  /** /dev/seed 生成的演示成员，不计入任何统计 */
  isDemo?: boolean;
  /** 仅后端 & 本人：公开视图里一定是 undefined */
  private?: MemberPrivate;
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
  /** 营业时间原文，如 "11:00-22:00" */
  openTime?: string;
};

/** 某个人在某个方案下的真实体验（公开安全：不含私密预算 / 私密备注 / 具体刷卡结果） */
export type Experience = {
  memberId: string;
  status: "full" | "late" | "early" | "lateEarly" | "absent";
  /** 预计到达 HH:mm */
  arriveAt?: string;
  lateMin: number;
  /** 必须离开的时间 HH:mm（有 homeBy 时） */
  leaveAt?: string;
  /** 能待多少分钟 */
  stayMin: number;
  commuteMin: number;
  /** 这个人的满意度 0-100 */
  utility: number;
  /** 给人看的说明，公开安全，如 "下班赶过来，晚到 10 分钟" */
  notes: string[];
};

/** 一个完整方案 = 时间 × 地点 */
export type Proposal = {
  id: string;
  slot: Slot;
  poi: Poi;
  experiences: Experience[];
  attendCount: number;
  /** 到场的人里最不开心那位的满意度（公平性核心指标） */
  minUtility: number;
  avgUtility: number;
  /** 综合分 0-100 */
  score: number;
  /** 一句话概括，如 "8 人全到，小林晚 10 分钟" */
  headline: string;
  /** 取舍说明（公开安全），如 ["老王来不了", "饭点可能要排队 20 分钟"] */
  tradeoffs: string[];
  /** 亮点，如 ["人均 96，大家都在预算内", "3 人刷卡点了想去"] */
  highlights: string[];
  /** LLM 润色的一句话 */
  blurb?: string;
  recommended: boolean;
};

export type Plan = {
  proposals: Proposal[]; // 2-3 个，彼此有实质差异
  /** 局长为什么推荐那个（公开安全） */
  recommendation: string;
  center: LatLng;
  computedAt: string;
};

/** 局长思考流的一步（公开安全，大屏直播用） */
export type TraceEvent = {
  id: string;
  at: string;
  kind: "listen" | "search" | "filter" | "compute" | "decide" | "warn" | "done";
  text: string;
};

export type JuStatus = "collecting" | "voting" | "confirmed" | "cancelled";

export type Ju = {
  id: string;
  title: string;
  rawPrompt: string;
  organizerName?: string;
  spec: JuSpec;
  slots: Slot[];
  status: JuStatus;
  createdAt: string;
  /** 截止时间：到点还在收集就自动出方案，还在投票就自动按推荐定局 */
  deadline?: string;
  plan?: Plan;
  /** memberId -> proposal.id */
  votes: Record<string, string>;
  confirmedProposalId?: string;
  /** 最近 80 条思考流 */
  trace: TraceEvent[];
  /** AA：公开只给总数和人数 */
  settlement?: { total: number; perPerson: number; payerName?: string };
};

/** GET /api/ju/[id] —— 公开视图（所有 member.private 已剥离）；带 x-member-token 时附上 me */
export type JuState = {
  ju: Ju;
  members: Member[];
  /** 当前请求者本人（含 private），未带 token 或 token 无效时为空 */
  me?: Member;
};

/** 定局后发给某个人的专属卡片 */
export type Itinerary = {
  proposalId: string;
  /** 建议出发时间 HH:mm */
  departAt: string;
  arriveAt: string;
  commuteMin: number;
  /** 路线要点，如 ["步行 400 米到漕宝路站", "地铁 9 号线 3 站", "步行 6 分钟"] */
  route: string[];
  /** 必须离开时间（有 homeBy 时） */
  leaveAt?: string;
  /** 你该转多少（AA 后才有，只给本人） */
  aaAmount?: number;
  payerName?: string;
};

/** 每个阶段可以直接复制到群里的话 */
export type GroupMessages = {
  /** 当前阶段的群公告 */
  broadcast: string;
  /** 给还没完成入局的人的单独催促（公开安全） */
  nudges: { memberId: string; name: string; text: string }[];
  /** 定局后的订位话术（给发起人） */
  reservationScript?: string;
};

/** 跨局记忆：设备级档案 */
export type Profile = {
  id: string;
  name?: string;
  avatar?: string;
  lastLocation?: Place;
  dietTags: DietTag[];
  /** 历次的通勤负担：当次通勤分钟数 / 当次到场者平均通勤，>1 表示比别人跑得远 */
  burdens: { juId: string; ratio: number; at: string }[];
};

/** GET /api/stats —— 路演用的真实使用数据，只统计非演示成员 */
export type Stats = {
  /** 至少 2 个真实成员的局 */
  juCount: number;
  confirmedCount: number;
  memberCount: number;
  medianFillSeconds?: number;
  recent: { id: string; title: string; members: number; status: JuStatus; createdAt: string }[];
  hourly: { hour: string; joins: number }[];
  generatedAt: string;
};

/** 地图能力抽象：高德实现 + 无 key 时的 mock 实现 */
export interface MapProvider {
  searchPlaces(q: string, city: string): Promise<Place[]>;
  reverseGeocode(p: LatLng): Promise<string>;
  searchAround(center: LatLng, keywords: string[], radiusM: number, city: string): Promise<Poi[]>;
  commute(origins: LatLng[], dest: LatLng): Promise<{ minutes: number; distanceKm: number }[]>;
  /** 公交 / 地铁路线（给个人行程卡），失败时实现方应退回到打车估算 */
  transitRoute(origin: LatLng, dest: LatLng, city: string): Promise<{ minutes: number; steps: string[] }>;
}

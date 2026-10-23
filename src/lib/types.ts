// 共享类型契约 v3 —— 前端 / 后端 / 算法三方共用。改动前先找 leader。
// v3 核心：组局里所有尴尬的事都交给局长。私密信息进来，对外只说聚合结论（隐私防火墙）。
// 字段旁的 #N 对应 docs/CONTRACT.md 里的 16 个痛点。

export type LatLng = { lat: number; lng: number };

export type Place = LatLng & { label: string };

/** AI 从发起人一句话（或群聊截图）里解析出的组局需求 */
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

/** 某一天这个人的时间情况（局长从私聊 / 课表截图里提取） */
export type DayAvailability = {
  /** 最早几点能从出发地出发 HH:mm（如 6 点半下班 → "18:30"） */
  from: string;
  /** 几点前必须回到出发地 HH:mm（门禁 / 末班车 / 家里有事），可空 */
  homeBy?: string;
  /** 这一天的意愿 */
  pref: "best" | "ok" | "meh";
};

/** #7 课表截图解析出的忙碌时段 */
export type BusyBlock = {
  /** 1 = 周一 … 7 = 周日 */
  weekday: number;
  from: string; // HH:mm
  to: string; // HH:mm
  label?: string; // 如 "高数"
};

/** 刷卡表态 */
export type SwipeVerdict = "love" | "like" | "pass";

/** 局长私聊的一轮 */
export type ChatTurn = { role: "juzhang" | "me"; text: string; at: string };

/** 私聊里局长想让前端顺手弹出的输入组件 */
export type ChatWidget = "rsvp" | "location" | "time" | "schedule" | "diet" | "budget" | "swipe" | null;

/** 局长发给某个人的私信（站内信），只在本人视图里出现 */
export type Notice = {
  id: string;
  at: string;
  kind:
    | "nudge" // #11 催入局 / 催投票
    | "depart" // #11 该出发了
    | "eta" // #11 有人晚到（聚合）
    | "match" // #2 互选成功
    | "promoted" // #2 / #12 候补转正（不说是第几圈）
    | "revision" // #12 定局后有变化
    | "quorum" // #1 成局 / 未成局
    | "autofill" // #6 局长替你预填了
    | "payment" // #14 该转钱 / 提醒
    | "recap"; // #16 局后回顾
  text: string;
  read?: boolean;
};

/** 分账明细的一行（只给本人） */
export type BillShareLine = { itemName: string; amount: number; reason?: string };

/** 分账相关的私密事实，从私聊里提取 */
export type BillFacts = {
  noAlcohol?: boolean;
  /** 中途走了（定局后由本人或发起人标记） */
  leftEarly?: boolean;
  /** 没吃的菜名关键词 */
  skipItems?: string[];
};

/** 只有本人和后端可见的东西 —— 公开接口绝不能返回（只在带正确 x-member-token 的本人请求里返回） */
export type MemberPrivate = {
  chat: ChatTurn[];
  /** #1 #5 私下表态这次来不来。no = 体面拒绝：公开视图里这个人直接不存在 */
  rsvp?: "yes" | "no";
  /** 日期 YYYY-MM-DD -> 那天的时间情况；没出现的日期 = 那天不行。门禁属于"说不出口"的信息，所以是私密的 */
  availability: Record<string, DayAvailability>;
  dietTags: DietTag[];
  /** 私下说的人均上限 */
  budgetMax?: number;
  /** 私下说的其他约束原话摘要，如 "这周减肥，别太油" */
  notes: string[];
  /** poi.id -> 表态 */
  swipes: Record<string, SwipeVerdict>;
  /** #6 局长替他预填的字段（说"都行"或截止时还没回），本人随时可改 */
  autoFilled: ("availability" | "swipes" | "budget" | "diet")[];
  /** #2 想认识 / 想坐一起的人（memberId）。单方面标记永远不会被任何人看到 */
  wants: string[];
  /** #2 互选成功的人（后端算出） */
  matches: string[];
  /** #15 分账相关的私密事实 */
  billFacts: BillFacts;
  /** #11 #14 等：局长的私信 */
  inbox: Notice[];
  /** #14 定局 AA 后：该转多少、转了没 */
  payment?: { amount: number; lines: BillShareLine[]; paid: boolean; remindedAt: string[] };
};

/** 只有服务端知道的东西 —— 连本人也不返回 */
export type MemberSecret = {
  /** x-member-token */
  token: string;
  /** #2 从第几圈邀请链接进来（1 = 核心圈）。本人也不知道自己是第几圈 */
  tier: number;
};

/** 入局进度（公开） */
export type IntakeStage = "chatting" | "swiping" | "done";

export type Member = {
  id: string;
  juId: string;
  name: string;
  /** 头像 emoji */
  avatar: string;
  /** 出发地；私聊还没问到时为空。用于大屏抽象地图和公平中心，视为公开 */
  location?: Place;
  /** 主角 / 必到：这个人来不了的方案直接否决 */
  role: "guest" | "must";
  intake: IntakeStage;
  /**
   * in = 在局里；out = 退出 / 私下拒绝（公开视图里不出现）；
   * waitlist = #2 候补（名额满了或所在的圈还没开放；公开视图里不出现，只计数）
   */
  status: "in" | "out" | "waitlist";
  joinedAt: string;
  isOrganizer: boolean;
  /** 跨局记忆用的设备级档案 id */
  profileId?: string;
  /** #3 认领了群聊截图里预填的哪一位 */
  seedId?: string;
  /** 从打开链接到入局完成的秒数（PMF 数据） */
  fillSeconds?: number;
  /** /dev/seed 生成的演示成员，不计入任何统计 */
  isDemo?: boolean;
  /** #11 路上共享的预计到达：只有算出来的时间，服务端从不保存坐标 */
  eta?: { arriveAt: string; lateMin: number; updatedAt: string };
  /** 仅后端 & 本人：公开视图里一定是 undefined */
  private?: MemberPrivate;
  /** 仅后端：任何接口都不返回 */
  secret?: MemberSecret;
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

/**
 * 某个人在某个方案下的体验 —— 公开版。
 * 隐私硬规则：这里的每个字段只能由公开因素算出（通勤、出发时间造成的迟到、门禁造成的早走时刻、时段）。
 * 私密预算、刷卡、私密备注、忌口绝不能影响这里的任何数字或文字，否则看满意度就能反推出谁预算紧。
 * 也因此，超预算永远不会让一个人在公开视图里变成 absent。
 */
export type Experience = {
  memberId: string;
  status: "full" | "late" | "early" | "lateEarly" | "absent";
  /** 预计到达 HH:mm */
  arriveAt?: string;
  lateMin: number;
  /** 必须离开的时间 HH:mm（只给时刻，不给原因） */
  leaveAt?: string;
  /** 能待多少分钟 */
  stayMin: number;
  commuteMin: number;
  /** 只由公开因素算出的满意度 0-100 */
  utility: number;
  /** 给人看的说明，公开安全，如 "晚到 10 分钟" "21:40 需先走"（不说原因） */
  notes: string[];
};

/** 只给本人：算上私密因素（预算、刷卡、忌口、备注）后的真实体验 */
export type MyExperience = {
  proposalId: string;
  utility: number;
  /** 如 "人均 118，超出你说的 80" "你刷卡点了超想去" */
  notes: string[];
};

/** #9 方案的定位标签，保证 2-3 个方案彼此有实质差异 */
export type ProposalLabel = "most-people" | "most-comfortable" | "cheapest" | "balanced";

/** 一个完整方案 = 时间 × 地点 */
export type Proposal = {
  id: string;
  label: ProposalLabel;
  /** 如 "人最全" "大家最舒服" "最省钱" */
  labelText: string;
  slot: Slot;
  poi: Poi;
  experiences: Experience[];
  attendCount: number;
  /** 到场者里最不开心那位的满意度（内部含私密因素算，只公开聚合值） */
  minUtility: number;
  avgUtility: number;
  /** 综合分 0-100 */
  score: number;
  /** 一句话概括，如 "8 人全到，有 1 人晚 10 分钟" */
  headline: string;
  /** 取舍说明（公开安全），如 ["老王来不了", "饭点可能要排队 20 分钟"] */
  tradeoffs: string[];
  /** 亮点（公开安全），如 ["人均 96，大家都在预算内", "3 人刷卡点了想去"] */
  highlights: string[];
  /** LLM 润色的一句话 */
  blurb?: string;
  recommended: boolean;
};

/** #9 可复核的拍板：同样输入一定得到同样结论 */
export type PlanAudit = {
  /** 规划输入（含私密数据）的 HMAC-SHA256，密钥是每个局自己的 auditSecret —— 证明输入没变，又不能被穷举反推 */
  inputHash: string;
  /** 规划结果（方案、排序、分数）的 SHA-256 */
  outputHash: string;
  /** slot × poi 候选组合数 */
  candidates: number;
  /** 候选 × 成员 的体验计算次数 */
  evaluations: number;
  /** 帕累托前沿上的候选数 */
  paretoSize: number;
  algorithmVersion: string;
};

export type Plan = {
  proposals: Proposal[]; // 2-3 个，彼此有实质差异
  /** 局长为什么推荐那个（公开安全） */
  recommendation: string;
  /** #10 跨局公平的公开说明（聚合），如 "这次优先照顾了前几次跑得最远的 1 位朋友" */
  caredFor?: string;
  /** 聚合后的约束说明，公开安全；只有 1 人有某约束时只说"有人"，不给能反推的细节 */
  constraintSummaries: string[];
  center: LatLng;
  audit: PlanAudit;
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

/** #3 群聊截图里识别出的人 */
export type SeedMember = {
  id: string;
  name: string;
  /** 在群里说的态度。said = no 的人公开视图里不显示（#5） */
  said: "yes" | "no" | "maybe";
  /** 群里的原话（本来就是公开的） */
  quote?: string;
  /** 如 "周六加班到 6 点" */
  hint?: string;
  /** 认领者 memberId */
  claimedBy?: string;
};

/** #15 小票 */
export type ReceiptItemTag = "alcohol" | "spicy" | "meat" | "beef" | "seafood" | "offal" | "drink" | "shared";
export type ReceiptItem = { id: string; name: string; price: number; qty: number; tags: ReceiptItemTag[] };
export type Receipt = {
  items: ReceiptItem[];
  /** 实付总额 */
  total: number;
  serviceFee?: number;
  discount?: number;
  /** 没有 LLM / 用了示例小票 */
  fallback?: boolean;
};

/** #15 分账结果（只在服务端和付款人视图里完整出现；每人只看到自己那份） */
export type BillSplit = {
  perMember: Record<string, { amount: number; lines: BillShareLine[] }>;
  total: number;
  /** 公开安全的聚合说明，如 "酒水只由喝酒的人分摊" "有人提前离开，少摊了部分菜" */
  explain: string[];
};

/** 只有发起人（x-admin-token）能看的东西 —— 公开视图里一定是 undefined */
export type JuAdmin = {
  /** #2 分层邀请链接：token -> 第几圈 */
  tiers: { token: string; tier: number; label: string; openedAt?: string }[];
  /** #9 PlanAudit.inputHash 的 HMAC 密钥 */
  auditSecret: string;
  /** #15 */
  receipt?: Receipt;
  split?: BillSplit;
  /** #14 每个人的转账状态（只给付款人 / 发起人） */
  payments?: Record<string, { amount: number; paid: boolean }>;
  /** 演示用时钟偏移（分钟），让定时提醒可以快进 */
  clockOffsetMin?: number;
};

export type Ju = {
  id: string;
  title: string;
  rawPrompt: string;
  organizerName?: string;
  spec: JuSpec;
  slots: Slot[];
  status: JuStatus;
  createdAt: string;
  /** 截止时间：到点还在收集就自动出方案（没回的人由局长预填 #6），还在投票就自动按推荐定局 */
  deadline?: string;
  plan?: Plan;
  /** memberId -> proposal.id */
  votes: Record<string, string>;
  confirmedProposalId?: string;
  /** 最近 80 条思考流 */
  trace: TraceEvent[];
  /** #1 门限成局：凑够 min 人私下说"来"才公开成局；之前谁说了来、谁拒绝了，对任何人都不可见 */
  quorum?: { min: number; state: "pending" | "met" | "failed"; deadline?: string; metAt?: string };
  /** #2 名额上限；满了之后新来的进候补 */
  capacity?: number;
  /** #3 群聊截图预填 */
  seeds?: SeedMember[];
  /** #8 群公告历史，最新在最后，每条都能直接复制到群里 */
  announcements: { at: string; text: string }[];
  /** #4 攒批重算：自上次出方案以来积累的成员变化数 */
  pendingChanges: number;
  /** #12 定局后的稳定重规划记录 */
  revisions: { at: string; reason: string; changes: string[] }[];
  /** #13 订位 */
  reservation?: { status: "none" | "scripted" | "called" | "booked"; tableSize?: number; note?: string };
  /** #14 #15 AA：公开只给总额和已转人数，不给谁没转 */
  settlement?: { total: number; perPerson?: number; itemized: boolean; payerName?: string; payCount: number; paidCount: number };
  /** #16 局后回顾 */
  recap?: { text: string; photos: string[]; at: string };
  /** #16 「再约」生成的新局 */
  nextJuId?: string;
  /** 仅后端 & 发起人 */
  admin?: JuAdmin;
};

/** 公开聚合数字（随 JuState 一起返回） */
export type PublicCounts = {
  /** 在局里的人 */
  in: number;
  /** 完成入局（私聊 + 刷卡）的人 */
  done: number;
  waitlist: number;
  /** #1 门限进度：已私下说"来"的人数 / 门槛 */
  quorumHave?: number;
  quorumNeed?: number;
  /** #2 局里互选成功的对数（只给数，不给谁） */
  matchPairs: number;
};

/** GET /api/ju/[id] —— 公开视图（所有 private / secret / admin 已剥离）；带 x-member-token 时附上 me 和 mine */
export type JuState = {
  ju: Ju;
  /** 只含 status = in 的成员；#1 门限未达成时只含发起人 */
  members: Member[];
  counts: PublicCounts;
  /** 当前请求者本人（含 private，不含 secret），未带 token 或 token 无效时为空 */
  me?: Member;
  /** 只给本人的视图 */
  mine?: {
    experiences: MyExperience[];
    itinerary?: Itinerary;
    /** #2 互选成功的人的名字（局长会安排坐一起） */
    matchNames: string[];
    unread: number;
  };
  /** 带 x-admin-token 时附上（含 ju.admin） */
  isAdmin?: boolean;
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
  /** #2 局长安排坐在一起的人 */
  seatWith?: string[];
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
  /** #13 模拟订位通话的对白（前端用语音合成播放） */
  reservationDialog?: { who: "局长" | "店员"; text: string }[];
};

/**
 * 隐私防火墙：写任何公开文案（方案润色、群公告、订位话术、局后回顾）的 LLM，只能拿到这个对象。
 * 由 src/lib/server/firewall.ts 从 Ju + Member[] 构造，类型上就拿不到 MemberPrivate。
 */
export type PublicFacts = {
  title: string;
  category: string;
  city: string;
  status: JuStatus;
  organizerName?: string;
  members: { id: string; name: string; avatar: string; role: Member["role"]; intake: IntakeStage; isOrganizer: boolean }[];
  counts: PublicCounts;
  constraintSummaries: string[];
  proposals?: {
    id: string;
    labelText: string;
    slotLabel: string;
    poiName: string;
    costPerPerson?: number;
    attendCount: number;
    headline: string;
    tradeoffs: string[];
    highlights: string[];
    recommended: boolean;
  }[];
  recommendation?: string;
  caredFor?: string;
  confirmed?: { slotLabel: string; poiName: string; address: string; tel?: string; headcount: number };
  settlement?: { total: number; payCount: number; paidCount: number; explain: string[] };
  revisions?: string[];
};

/** #3 群聊截图解析结果 */
export type ChatScreenshotParse = {
  title: string;
  spec: JuSpec;
  seeds: Omit<SeedMember, "id" | "claimedBy">[];
  /** 没有 LLM / 用了示例截图 */
  fallback?: boolean;
};

/** 私聊一轮的回复 */
export type ChatReply = {
  reply: string;
  widget: ChatWidget;
  quickReplies: string[];
  done: boolean;
};

/** 私聊一轮从用户话里提取出的更新 */
export type ChatPatch = Partial<Pick<Member, "location" | "name">> & {
  rsvp?: "yes" | "no";
  availability?: Record<string, DayAvailability>;
  dietTags?: DietTag[];
  budgetMax?: number;
  note?: string;
  billFacts?: BillFacts;
  /** #6 用户说"都行 / 随便 / 你定"：让局长按档案预填 */
  wantsAutofill?: boolean;
};

/** 跨局公平账本的一笔（#10） */
export type LedgerEntry = {
  juId: string;
  at: string;
  commuteMin: number;
  /** 当次到场者的平均通勤 */
  avgCommuteMin: number;
  /** 当次体验（含私密因素） */
  utility: number;
  /** 这次吃了多少亏：(100 - utility) + 通勤超出平均的部分，>= 0 */
  regret: number;
};

/** 跨局记忆：设备级档案 */
export type Profile = {
  id: string;
  name?: string;
  avatar?: string;
  lastLocation?: Place;
  dietTags: DietTag[];
  /** #10 跨局公平账本 */
  ledger: LedgerEntry[];
  /** #6 从历次刷卡 / 投票学到的偏好：键是品类词或连锁名，值 -1..1 */
  tastes: Record<string, number>;
  /** #6 常用价位（人均） */
  typicalBudget?: number;
  /** #6 常用时间 */
  usualFrom?: string;
  usualHomeBy?: string;
};

/** GET /api/stats —— 路演用的真实使用数据，只统计非演示成员 */
export type Stats = {
  /** 至少 2 个真实成员的局 */
  juCount: number;
  confirmedCount: number;
  memberCount: number;
  medianFillSeconds?: number;
  /** 真实成员里在私聊中主动说了私密约束（预算 / 门禁 / 备注 / 拒绝）的比例 0-1 —— 验证核心亮点的 PMF 指标 */
  privateShareRate?: number;
  recent: { id: string; title: string; members: number; status: JuStatus; createdAt: string }[];
  hourly: { hour: string; joins: number }[];
  generatedAt: string;
};

/** GET /api/privacy/selftest —— 反事实泄露检验的结果（路演 / 大屏展示用） */
export type PrivacySelfTest = {
  runs: number;
  leaks: number;
  /** 每类检验各跑了多少次 */
  checks: { name: string; runs: number; leaks: number }[];
  at: string;
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

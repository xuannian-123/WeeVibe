// 共享类型契约 v4 —— 前端 / 后端 / 算法三方共用。改动前先找 leader。
// v3 核心：组局里所有尴尬的事都交给局长。私密信息进来，对外只说聚合结论（隐私防火墙）。
// v4 聚焦半生不熟的小团体：局长还管"到了现场怎么坐、怎么熟起来"（#17–#21 局内编排 + 圈子记忆）。
// 字段旁的 #N 对应 docs/CONTRACT.md 里的痛点编号。

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
  /** 城市是怎么定的：said = 发起人亲口说的；ip = 按发起人的网络位置猜的；location = 按第一个人给的出发地校正的；default = 兜底 */
  cityFrom?: "said" | "ip" | "location" | "default";
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

/** 私聊里局长要收集的一项信息 */
export type ChatAsk = "rsvp" | "location" | "time" | "diet" | "budget" | "notes" | "swipe";

/** 局长私聊的一轮。ask = 局长这一轮问的是哪一项（旧记录没有，靠文字推断） */
export type ChatTurn = { role: "juzhang" | "me"; text: string; at: string; ask?: ChatAsk };

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
    | "recap" // #16 局后回顾
    | "seat" // #18 座位排好了 / 下一轮换桌
    | "click" // #20 双方都觉得聊得来
    | "ask"; // v5 局长私下问你一件事（协商）
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
  // ---- v4 半生不熟：以下字段旧数据里没有，一律可选 ----
  /** #17 我觉得我和 TA 多熟（memberId -> 0/1/2）。单方面的感觉，谁也看不到，对方也看不到 */
  know?: Record<string, Familiarity>;
  /** #17 know 里哪些是局长按上次同桌的记忆预填的（本人可改） */
  knowAuto?: string[];
  /** #17 今天的社交电量 */
  energy?: SocialEnergy;
  /** #18 悄悄：别和 TA 排一桌（最多 1 人）。局长用"诱饵分组"让它不可推断 */
  avoid?: string[];
  /** #19 每一轮私下的感受（轮次 -> 感受），只以聚合数字出现 */
  feel?: Record<string, RoundFeel>;
  /** #20 局后：和谁聊得来。双方都选了才揭晓，单方面永远没人知道 */
  clicked?: string[];
  /** #20 双方都选了"聊得来"的人（后端算出） */
  clickMatches?: string[];
  // ---- v5 决策：需求模型（docs/DECISION.md 第 2 节） ----
  /** 私聊 / 组件抽出来的其他需求（时间、预算、忌口仍在各自的字段里，needsOf 会把它们合成一张完整清单） */
  needs?: Need[];
  /** 预算有多在意：1 随口一提 / 2 在意（默认）/ 3 很在意（"手头紧"） */
  budgetStrength?: NeedStrength;
  /** 局长正在等本人确认的一条硬约束（大模型从自然语言里推断的，确认前按硬约束算，保护本人） */
  pendingConfirm?: PendingConfirm;
  /** 本人确认过的硬约束 key（如 "homeBy"、"diet:清真"、need id） */
  confirmed?: string[];
  // ---- v5 极端情况：协商（docs/DECISION.md 第 5 节） ----
  /** 局长私下问本人的事（是 / 否） */
  asks?: NegotiationAsk[];
  /** 本人同意放宽的时间门槛（"这次只能待 35 分钟也来"） */
  relax?: { maxLateMin?: number; minStayMin?: number };
  /** 本人同意这次不计较的软偏好（need id 或 "budget"） */
  waived?: string[];
};

/** 局长私下问一个人的是 / 否问题。只问软的（时间门槛、软偏好），绝不请人违反硬约束 */
export type NegotiationAsk = {
  id: string;
  /** selfTime：请本人接受晚到 / 少待一会儿；waiveSoft：请本人这次不计较某条软偏好 */
  kind: "selfTime" | "waiveSoft";
  text: string;
  relax?: { maxLateMin?: number; minStayMin?: number };
  needKey?: string;
  status: "pending" | "yes" | "no";
  at: string;
  answeredAt?: string;
};

/** 推荐方案的冲突诊断（公开安全：只有分类后的人数） */
export type Diagnosis = {
  /** 没被照顾到的人数 */
  uncared: number;
  /** "有 1 位朋友时间凑不上" "2 人觉得偏贵" */
  reasons: string[];
  /** 局长正在私下问的人数 */
  coordinating: number;
  /** 局长没法自己解决、建议发起人做的事："加一个候选时间" */
  suggestions: string[];
};

// ---------------------------------------------------------------- v5 需求模型

export type NeedDim = "time" | "travel" | "money" | "food" | "activity" | "ambience" | "people" | "body" | "join";
export type NeedStrength = 1 | 2 | 3;

/** 能算的需求规则。算不了的用 custom：照样记下给本人看，但如实说"局长没法算进去" */
export type NeedRule =
  | { t: "maxCommute"; minutes: number }
  | { t: "leaveBy"; at: string }
  | { t: "avoidCategory"; words: string[] }
  | { t: "preferCategory"; words: string[] }
  | { t: "quiet" }
  | { t: "noAlcohol" }
  | { t: "indoor" }
  | { t: "lightFood" }
  | { t: "noQueue" }
  | { t: "custom" };

export type Need = {
  id: string;
  dim: NeedDim;
  kind: "hard" | "soft";
  strength: NeedStrength;
  rule: NeedRule;
  /** 局长复述的一句话，如"单程不超过 30 分钟" */
  text: string;
  /** 原话（只在本人视图） */
  evidence?: string;
  source: "chat" | "widget" | "screenshot" | "swipe" | "profile" | "negotiation";
  at: string;
};

export type PendingConfirm = {
  /** "homeBy" | "diet:清真" | need id */
  key: string;
  /** 局长的确认问句里复述的内容，如"23:00 前必须回去" */
  text: string;
  at: string;
};

/** 某条需求在某个方案里的结果（只给本人） */
export type NeedResult = {
  text: string;
  result: "met" | "partial" | "unmet" | "unknown" | "noted";
  detail?: string;
};

/** v4 #17 我和 TA 熟不熟：0 不认识 / 1 见过几次 / 2 挺熟 */
export type Familiarity = 0 | 1 | 2;

/** v4 #17 今天的社交电量：low = 想安静点（每一轮都给留熟人） */
export type SocialEnergy = "low" | "mid" | "high";

/** v4 #19 这一轮的感受 */
export type RoundFeel = "stiff" | "ok" | "loud";

/** v4 #19 一轮感受的聚合计数 */
export type FeelCounts = { stiff: number; ok: number; loud: number; total: number };

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
  /** v4 #17 自愿公开的兴趣标签（填的时候明确告诉本人"会给同桌看"），用来给每桌出话题 */
  interests?: string[];
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
  /** v5：是否在室内（高德有楼层信息 = 在楼里；公园 / 景区 / 露营 = 户外；不知道就不填） */
  indoor?: boolean;
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
  /** v5：你跟局长说的每一条需求，在这个方案里怎么样了 */
  needs?: NeedResult[];
  /** v5：这个方案有没有照顾到你（能来 + 硬约束都满足 + 满意度不低于保底线） */
  cared?: boolean;
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
  /** v5：被照顾到的人数（能来 + 硬约束满足 + 满意度 ≥ 保底线；内部含私密因素算，只公开聚合数） */
  cared?: number;
  /** v5：会在现场翻车的风险（天气 / 打烊 / 排队 / 夜归），每条都带应对办法 */
  risks?: Risk[];
  /** v5：户外方案碰上坏天气（或 4 天外没有预报）时的室内备案 */
  fallback?: Fallback;
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
  /** v5：推荐理由，三级准则各一句（公开安全：只用公开因素和聚合数） */
  why?: string[];
  /** v5：推荐方案没能照顾到所有人时的诊断（公开安全：只有分类人数） */
  diagnosis?: Diagnosis;
  /** v5：协商摘要（聚合），如"局长私下协调了 1 位朋友" */
  coordination?: string;
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
  /** v4 #21 这个局是从哪一局「再约」来的（同一个圈子的上一局） */
  prevJuId?: string;
  /** v4 #18 局内编排：分几轮、每轮怎么分桌、玩什么 */
  seating?: Seating;
  /** v5 定局后的天气复查（活动前 24 小时 / 3 小时各一次；天气是公开事实） */
  weatherAlert?: WeatherAlert;
  /** 仅后端 & 发起人 */
  admin?: JuAdmin;
};

// ---------------------------------------------------------------- v4 局内编排（半生不熟）

/** #19 一轮的玩法（规则库里挑，强度随反馈调整） */
export type RoundFormat = {
  key: string;
  name: string;
  /** 1 = 轻松（有题目卡、不用当众表现）… 3 = 热闹（跨桌挑战） */
  intensity: 1 | 2 | 3;
  minutes: number;
  /** 一句话玩法说明 */
  how: string;
};

export type SeatingTable = {
  id: string;
  memberIds: string[];
  /** 这桌的话题卡：只从大家自愿公开的兴趣里来 */
  topics: string[];
};

export type SeatingRound = {
  index: number;
  format: RoundFormat;
  tables: SeatingTable[];
  status: "upcoming" | "live" | "done";
  /** #19 这一轮私下感受的聚合（这轮结束后才写入；人数太少时不写，免得能对上是谁） */
  feedback?: FeelCounts;
  /** #19 局长根据上一轮的反馈做了什么调整（公开安全） */
  adjust?: string;
};

/** 公开的聚合数字：只有对数，没有"谁和谁" */
export type SeatingMetrics = {
  people: number;
  /** C(n, 2) */
  pairs: number;
  /** 排座之前就认识的对数（任一方说"见过"或"挺熟"都算） */
  knownBefore: number;
  /** 这次第一次同桌、之前互不认识的对数 */
  newPairs: number;
  /** 第一轮每个人桌上都至少有一位认识的人 */
  everyoneAnchored: boolean;
  /** 互选成功的对数里，被安排同桌的 */
  matchesSeated: number;
  matchPairs: number;
  /** 从头到尾没同桌过的对数 —— 悄悄回避的请求就藏在这里面（#18 可否认） */
  neverTogether: number;
};

export type SeatingAudit = {
  /** 分组输入（含私密标记）的 HMAC-SHA256，密钥是每个局自己的 auditSecret */
  inputHash: string;
  /** 分组结果的 SHA-256 */
  outputHash: string;
  restarts: number;
  /** 局部搜索评估过的换位次数 */
  evaluations: number;
  algorithmVersion: string;
};

export type Seating = {
  rounds: SeatingRound[];
  /** 正在进行第几轮（-1 = 还没开始） */
  current: number;
  /** 排座时的参数 */
  tableSize: number;
  metrics: SeatingMetrics;
  audit: SeatingAudit;
  /** 没到场的人（现场看得见的事实，公开） */
  absentIds: string[];
  computedAt: string;
  /** 第几版（中途有人没来 / 根据反馈重排会 +1） */
  version: number;
};

/** #18 只给本人：我在每一轮坐哪、为什么这么排（只用本人自己的标记解释） */
export type MySeat = {
  round: number;
  tableId: string;
  /** 同桌的人（名字本来就公开） */
  mates: string[];
  /** 如 "这桌有你挺熟的小林" "另外 2 位你还不认识，话题卡给你们准备好了" */
  notes: string[];
};

/** GET /api/ju/:id/circle —— 同一个圈子一局一局熟起来（全是聚合数字） */
export type CircleStep = {
  juId: string;
  title: string;
  /** 活动开始时间（ISO），没定局时为空 */
  at?: string;
  people: number;
  pairs: number;
  /** 这一局开始前就认识的对数 */
  knownBefore: number;
  /** 这一局结束后认识的对数 = knownBefore + newPairs */
  knownAfter: number;
  /** 双方都觉得"聊得来"的对数 */
  clickPairs: number;
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
    /** #18 我每一轮坐哪（排座之后才有） */
    seats?: MySeat[];
    /** #20 双方都觉得聊得来的人的名字 */
    clickNames?: string[];
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
  /** v5：推荐理由（三级准则各一句） */
  why?: string[];
  confirmed?: {
    slotLabel: string;
    poiName: string;
    address: string;
    tel?: string;
    headcount: number;
    /** v5 决定书的公开部分 */
    why?: string[];
    risks?: { text: string; mitigation: string }[];
    fallback?: { trigger: string; poiName: string };
    groupActions?: string[];
  };
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
  /** v5：抽出来的其他需求（还没有 id / 时间戳，入库时补） */
  needs?: Omit<Need, "id" | "at" | "source">[];
  /** v5：预算有多在意 */
  budgetStrength?: NeedStrength;
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
  /** v4 #21 我和别人熟不熟的记忆（对方的 profileId -> 0/1/2）：同桌过至少"见过"，选了聊得来就是"挺熟"。只有本人档案里有 */
  know?: Record<string, Familiarity>;
  /** v5 让步账：在协商里答应过让步的局（最近的越多，下次越不先问他） */
  concessions?: { juId: string; at: string }[];
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

/** v5 天气：高德只给今天起 4 天、白天 / 夜间各一条（没有降水概率、没有逐小时） */
export type WeatherHalf = { text: string; temp: number; windPower: string };
export type WeatherDay = { date: string; day: WeatherHalf; night: WeatherHalf };

/** v5 方案的风险（公开安全：只涉及所有人共享的公开事实） */
export type Risk = {
  kind: "weather" | "closing" | "queue" | "lateNight" | "unknown";
  level: "low" | "mid" | "high";
  /** "周五夜间预报小雨" */
  text: string;
  /** "带伞；这家在室内，不受影响" */
  mitigation: string;
  confidence: "known" | "estimated" | "unknown";
};

/** v5 定局后天气复查的结果 */
export type WeatherAlert = {
  phase: "24h" | "3h";
  at: string;
  /** "周六白天" */
  label: string;
  /** "中雨" / "暂无预报" */
  text: string;
  kind: "ok" | "light" | "heavy" | "unknown";
  /** 定局的店在户外 */
  outdoor: boolean;
  /** 建议发起人切到备案（户外 + 中雨以上，且有备案） */
  suggestFallback?: boolean;
  /** 已经切到备案了 */
  switched?: boolean;
};

/** v5 备案：触发条件 + B 方案（室内） */
export type Fallback = {
  /** "当天预报中雨及以上" */
  trigger: string;
  /** 完整的店（公开信息）：切到备案时要用它重算每个人的体验 */
  poi: Poi;
  /** 备案对应的候选方案 id（同一时间、换成室内的店） */
  proposalId: string;
};

/** 地图能力抽象：高德实现 + 无 key 时的 mock 实现 */
export interface MapProvider {
  searchPlaces(q: string, city: string): Promise<Place[]>;
  reverseGeocode(p: LatLng): Promise<string>;
  searchAround(center: LatLng, keywords: string[], radiusM: number, city: string): Promise<Poi[]>;
  commute(origins: LatLng[], dest: LatLng): Promise<{ minutes: number; distanceKm: number }[]>;
  /** 公交 / 地铁路线（给个人行程卡），失败时实现方应退回到打车估算 */
  transitRoute(origin: LatLng, dest: LatLng, city: string): Promise<{ minutes: number; steps: string[] }>;
  /** v5：集合点附近的天气预报（可选；拿不到返回 []，当作"未知"） */
  weather?(center: LatLng): Promise<WeatherDay[]>;
  /** 按 IP 猜城市（全国；拿不到返回 undefined） */
  cityOfIp?(ip: string): Promise<string | undefined>;
  /** 坐标在哪个城市（全国；直辖市返回"北京"这样的名字） */
  cityAt?(p: LatLng): Promise<string | undefined>;
}

# AI 局长 v2 · 团队契约

> **一个替你保密、替你拍板、替你照顾每个人的 AI 局长。**
> 组局难的不是找店，是那些群里说不出口的话："我最近手头紧""我其实不想吃火锅""11 点前要回宿舍"，以及没人愿意当拍板和催人的那个人。

共享类型全部在 `src/lib/types.ts`（v2），**不要私自改**；需要改先在汇报里写明理由。

## 用户旅程

1. **发起**：发起人说一句话 → 局长解析 → 发起人设截止时间（可选）、标记主角（可选）→ 拿到一条写好的群消息和链接。
2. **私聊局长**：朋友点开链接，不是表单，是一个和局长的私聊。局长 3–5 轮问清：
   - 从哪出发（可以直接说，也可以用定位 / 搜索组件）
   - 哪天几点能出发、几点前要回去、哪天最好（"6 点半下班，从漕河泾过来，11 点前回宿舍"）
   - 忌口
   - 预算（委婉问，"不方便在群里说的，可以悄悄告诉我"）
   - 还有什么想让局长知道的
   老朋友（有 profileId）会被认出来："阿杰又见面了，还是从漕河泾出发？"
3. **刷卡**：局长给 5–6 张附近真实店卡，右滑想去、上滑超想去、左滑不想。说"都行"的人也能 10 秒表态。
4. **局长思考**：截止时间到 / 发起人点"出方案" → 局长把每个候选时间 × 每家店对每个人的真实体验都算一遍，挑出 2–3 个**有实质差异**的方案，讲清取舍，给出推荐和理由。全过程写入思考流，大屏直播。
5. **投票 / 拍板**：成员投票；过半自动定局；截止时间到按推荐定局；发起人可随时拍板。
6. **成局**：盖章。每个人拿到**自己的**行程卡（几点出发、怎么走、几点得走）；发起人拿到订位话术和群公告；AA 只私下告诉每个人该转多少。
7. **记忆**：局后把每个人这次的通勤负担记进档案，下次组局时跑得远的人会被优先照顾。

## 隐私规则（硬性，后端必须有测试）

- `member.private`（私聊记录、私密预算、私密备注、具体刷卡结果）**只在带正确 `x-member-token` 的本人请求里返回**，其他任何接口、思考流、方案说明、群消息、LLM 生成内容里都不能出现可追溯到个人的私密信息。
- 公开文案只能说聚合结论："有人预算偏紧，已按大家都舒服的价位筛选""3 人刷卡点了想去"。
- 不能说"小林预算紧"，也不能在只有 1 个人有某约束时说出能反推是谁的细节。

## 决策模型（算法 C 实现，确定性代码，不交给 LLM）

对每个候选（slot × poi）、每个在场成员，算一份 `Experience`：

- **到达**：`arrive = max(slot.start, day.from + commute)`；`lateMin = arrive - slot.start`。
- **离开**：有 `homeBy` 时 `leaveAt = homeBy - commute`；`stayMin = min(slot.end, leaveAt) - arrive`。
- **来不了（absent）**：那天不在 availability 里；或 `lateMin > 45`；或 `stayMin < 60`。
- **满意度 utility（0–100）**，从 100 扣分：迟到、早走（按分钟）；通勤超过 15 分钟的部分；当天意愿 ok / meh；超出**私密预算**（超 30% 视同来不了）；忌口冲突（火锅 + 不吃辣 → 鸳鸯锅减轻扣分）；刷卡表态（love 加分，like 小加分，pass 重扣）；饭点高峰排队（周五周六 18:00–19:30 的热门品类小扣）。
- **照顾**：档案里历史通勤负担高的人，本次权重上调，让局长更照顾他。
- **方案打分**：主角来不了的方案直接否决。综合分 = 公平（在场者最低满意度）为主 + 平均满意度 + 到场比例。
- **方案挑选**：2–3 个，彼此必须有实质差异，比如"人最全"vs"大家最舒服"vs"最省钱"，不要三家只差一点的同时段店。每个方案生成 `headline`、`tradeoffs`、`highlights`，全部公开安全。
- **推荐理由**：用人话讲清为什么推荐这个，例如"主角必须到；小林晚 10 分钟可以接受"。
- **思考流**：计算过程中通过回调产出 `TraceEvent`，要具体、有数字、公开安全。

## 模块接口

```ts
// 算法 C —— src/lib/planner/index.ts
export function generateSlots(spec: JuSpec): Slot[];
export function fairCenter(points: LatLng[]): LatLng;
export function experienceFor(member: Member, slot: Slot, poi: Poi, commuteMin: number, ctx: PlanContext): Experience;
export async function planJu(ju: Ju, members: Member[], map: MapProvider, opts?: {
  onTrace?: (kind: TraceEvent["kind"], text: string) => void;
  /** profileId -> 历史平均负担比 */
  burdens?: Record<string, number>;
  now?: Date;
}): Promise<Plan>;                                   // 不含 blurb
export async function buildSwipeDeck(ju: Ju, members: Member[], me: Member, map: MapProvider): Promise<Poi[]>; // 5-6 张
export function settle(total: number, n: number): { total: number; perPerson: number };

// 地图 C —— src/lib/map/index.ts：getMapProvider() 增加 transitRoute（高德 /v3/direction/transit/integrated；失败退回打车估算）
```

```ts
// LLM / Agent B —— src/lib/llm/**、src/lib/server/**
export async function parsePrompt(prompt, now, defaultCity): Promise<{ title; spec }>;   // 保留
export async function chatTurn(ju, member, profile | undefined, userText | null): Promise<{
  reply: string; widget: ChatWidget; quickReplies: string[];
  patch: Partial<Pick<Member, "location" | "availability" | "dietTags" | "name">> & { budgetMax?: number; note?: string };
  done: boolean;
}>; // userText 为 null = 开场白。LLM 不可用时退化为脚本式问答，用 quickReplies 引导
export async function polishPlan(ju, plan, members): Promise<Plan>;  // 给每个方案写 blurb，润色 recommendation；不得泄露私密信息
export async function groupMessages(ju, members, origin): Promise<GroupMessages>;
```

## HTTP API（B 实现，A 调用）

返回 JSON，出错 `{ error }`。🔒 = `x-admin-token`（创建局时返回）。👤 = `x-member-token`（入局时返回）。

| 方法 & 路径 | 请求 | 返回 |
|---|---|---|
| `POST /api/parse` | `{ prompt }` | `{ title, spec, slots }` |
| `POST /api/ju` | `{ prompt, organizerName, title?, spec?, deadline? }` | `{ id, adminToken }` |
| `GET /api/ju/:id` | 可带 👤 | `JuState`（会顺便执行到期的截止动作） |
| `PATCH /api/ju/:id` 🔒 | `{ deadline?, title? }` | `JuState` |
| `POST /api/ju/:id/join` | `{ name, avatar?, profileId?, isOrganizer? }` | `{ memberId, memberToken, opening: { reply, widget, quickReplies } }` |
| `POST /api/ju/:id/chat` 👤 | `{ text }`，或用组件提交结构化数据 `{ location?, availability?, dietTags?, budgetMax? }` | `{ reply, widget, quickReplies, done, me: Member }` |
| `GET /api/ju/:id/deck` 👤 | – | `Poi[]` |
| `POST /api/ju/:id/swipe` 👤 | `{ poiId, verdict }` | `{ me: Member }`，刷完自动变成 intake done |
| `PATCH /api/ju/:id/members/:mid` 👤 本人 / 🔒 | 本人可改 `{ status }`；🔒 可改 `{ role }` | `JuState` |
| `POST /api/ju/:id/plan` 🔒 | – | `JuState`（status → voting） |
| `POST /api/ju/:id/vote` 👤 | `{ proposalId }` | `JuState`；在场者过半投同一方案自动定局 |
| `POST /api/ju/:id/confirm` 🔒 | `{ proposalId }` | `JuState` |
| `GET /api/ju/:id/itinerary` 👤 | – | `Itinerary`（定局后） |
| `GET /api/ju/:id/messages` 🔒 | – | `GroupMessages` |
| `POST /api/ju/:id/settle` 🔒 | `{ total, payerName? }` | `JuState` |
| `GET /api/ju/:id/ics` | – | 日历文件 |
| `GET /api/profile/:pid` | – | `Profile \| null` |
| `GET /api/geo/search?q=&city=` | – | `Place[]` |
| `GET /api/geo/reverse?lat=&lng=&from=wgs84` | – | `Place` |
| `GET /api/stats` | – | `Stats` |
| `POST /api/dev/seed/:id` 🔒 | `{ count? }` | `JuState`：加 5–6 个演示成员，有完整的 availability / 私密预算 / 刷卡 / 忌口，**刻意制造冲突**（有人晚下班、有人有门禁、有人预算紧、有人不吃辣），让方案有取舍可讲 |

成员退出、新成员完成入局、主角变更时，如果已有方案，后端自动重算（清空票数），并写思考流。

## 页面（A 实现）

- `/` 发起页：一句话 → 预览 → 称呼 → 可选截止时间 → 创建 → 进局页（发起人自己也走一遍私聊）。
- `/j/:id` 手机局页：私聊（气泡 + 内联组件 + 快捷回复）→ 刷卡 → 等待室（谁在聊、谁刷完；发起人有：复制群消息、催人、标主角、出方案）→ 方案对比（每个方案先看"你的体验"，再看全员矩阵、取舍、亮点、推荐理由）→ 投票 → 成局（盖章、我的行程卡、加入日历、AA；发起人还有订位话术和群公告）。
- `/j/:id/screen` 大屏 1920×1080：二维码 + 入局进度；抽象地图；**局长思考流**（逐条打字机出现）；出方案后变成"人 × 方案"体验矩阵和推荐理由；成局盖章。
- `/stats`：保留。

## 文件归属

| 角色 | 负责 |
|---|---|
| 算法（C） | `src/lib/planner/**`、`src/lib/map/**` |
| 后端 / Agent（B） | `src/lib/db.ts`、`src/lib/llm/**`、`src/lib/server/**`、`src/app/api/**`、`scripts/**`（`deploy.sh` 除外） |
| 前端（A） | `src/app/**`（除 `api/`）、`src/components/**`、`src/lib/client/**`、`public/**` |
| leader | `src/lib/types.ts`、`docs/**`、`package.json`、`next.config.ts`、`scripts/deploy.sh` |

## 运行约定

- dev server：前端 3000（`.next`）；后端 `NEXT_DIST_DIR=.next-b npx next dev -p 3001`；leader 3002（`.next-l`）。
- `.env.local` 已配好真实高德 key 和 DeepSeek key，所有人共用。场馆：上海徐汇 36space（`DEMO_CENTER=31.167645,121.431950`）。
- **没有 key 时整条链路也必须能跑**（mock 地图 + 脚本式私聊）。
- 单测 `npm test`；v2 改造期间别人目录的 tsc 报错是正常的，最终由 leader 联调收口。
- 生产环境 https://ju.yuanshengzhe.com，部署只由 leader 执行，**不要在生产跑 smoke**。

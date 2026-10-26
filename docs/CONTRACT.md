# AI 局长 v4 · 团队契约

> **组局里所有尴尬的事，都交给局长。**
> 群里说不出口的话（预算、门禁、不想去、催钱、和谁还不熟），私下告诉局长；局长对外只说聚合结论，而且能证明没说漏。
>
> **v4 聚焦半生不熟的小团体**（新社团、新班级、刚组的项目组 / 公司小组）：熟人之间微信群就够用，完全陌生的人根本不组局，
> 中间这群人最想熟起来、又最说不出口。局长除了定时间地点，还管**到了现场怎么坐、一局一局怎么熟起来**（#17–#21，见第十节）。

共享类型全部在 `src/lib/types.ts`（v4），**不要私自改**；确实要改，在最终汇报里写明改了什么、为什么。

## 一、21 个痛点 → 方案 → 技术亮点

| # | 痛点 | 方案 | 技术亮点 |
|---|---|---|---|
| 1 | 怕发了没人回 | **门限成局**：凑够 N 人私下说"来"才公开成局，凑不够悄悄作废 | 门限揭示机制；达成前任何人（含发起人）都看不到谁表了态 |
| 2 | 叫谁不叫谁 | **互选匹配**（双方都标"想认识"才揭晓，局长安排坐一起）+ **分层邀请**（核心圈先，空位自动放给下一圈，候补转正时不说是第几圈） | 密封匹配；圈层只存在服务端 |
| 3 | 总是同一个人张罗 | **群聊截图开局**：识别谁说了去 / 不去 / 在加班，预填进局 | 多模态解析聊天截图 → 结构化需求 + 预填成员 |
| 4 | 说不出口的约束 | **私聊局长 + 隐私防火墙** | 三层隔离 + 反事实泄露检验 + 攒批重算防时序推断 |
| 5 | 想推掉不好意思 | **可否认的缺席**：私下说不来，公开视图里这个人直接不存在 | "没空 / 不想去 / 没回"对外不可区分 |
| 6 | "都行"、已读不回 | **局长替你预填**：按档案填时间 / 价位 / 刷卡，10 秒确认 | 从历史刷卡投票学偏好（tastes） |
| 7 | 时间对不上 | **课表截图导入** + 一句话说清时间 | 多模态课表解析；时间 × 通勤 × 门禁联合求解 |
| 8 | 信息被刷屏 | 每次状态变化自动生成可复制的群公告 | （产品功能） |
| 9 | 没人拍板、拍板背锅 | **局长拍板，可复核**：确定性算法 + 公开审计哈希 + 一键复算 | 帕累托前沿上挑有实质差异的方案；HMAC 审计 |
| 10 | 总是同一个人妥协 | **跨局公平账本** | 对累计遗憾做 max-min，长期最吃亏的人优先 |
| 11 | 没人愿意催人 | **局长主动提醒**：按真实路线算出发时间；路上只共享 ETA 不共享位置；私下催没回的人 | 主动智能体（定时任务）；只共享结论不共享原始数据 |
| 12 | 人数临时变动 | **稳定重规划**：优先保原方案，换桌 / 候补转正 | 带"改动最小"约束的增量重规划 |
| 13 | 订位没人管 | 订位话术 + **模拟通话演示**（语音合成播放局长和店员对白）+ 一键拨号 | 真电话外呼需要运营商语音账号，本期不接，界面上必须标"模拟" |
| 14 | 催钱尴尬 | **局长私下催款**：只私下告诉每个人该转多少，过期私下提醒；群里只显示"已转 4/6" | 主动智能体 + 防火墙 |
| 15 | AA 不公平 | **拍小票自动分账**：酒水只分给喝酒的，不吃辣的不摊辣锅，提前走的少摊 | 多模态小票解析 + 按私密约束逐项分摊 |
| 16 | 散了就散了 | **局后回顾**（照片 + 一段话）+ **一键再约**（同一拨人、带上档案） | 档案延续 |
| 17 | 不熟的人坐一起冷场、熟人抱团 | **私下标"和谁熟不熟" + 今天的社交电量 + 公开兴趣** → 局长排座：第一轮每人桌上都有熟人，之后每轮换桌 | 多轮分桌 = 社交高尔夫球手问题的约束变体；多起点 + 迭代局部搜索；熟悉度**双方取高**，单向关系不可见 |
| 18 | 不想和某人坐一桌，说出来更尴尬 | **悄悄回避**（最多 1 人） | **诱饵分组**：从没同桌的对数 ≥ 3 × 回避数，任何一对"没同桌"是因为有人提了要求的比例 ≤ 1/3；藏不住就不执行，结果和没人提逐字节相同 |
| 19 | 第一轮拘谨、没人敢说 | **每轮私下反馈**（拘谨 / 刚好 / 太吵）→ 换桌时局长调玩法强度、加强锚点、重排后面的座位 | 聚合反馈（≥ 3 条才公开数字）+ 带"已坐过的不动、未来尽量少改"约束的增量重排 |
| 20 | 散场后不知道谁也想再聊 | **局后私下选"和谁聊得来"**，双方都选了才揭晓 | 密封互选（同 #2） |
| 21 | 下次又从零开始 | **圈子记忆**：同桌过的人在各自档案里至少是"见过"，聊得来的是"挺熟"；再约时局长双向预填；大屏画"一局比一局熟" | 只写本人自己的档案；圈子曲线全是对数，没有"谁和谁" |

## 二、隐私规则（硬性，后端必须有测试）

1. `member.private` **只**在带正确 `x-member-token` 的本人请求里返回；`member.secret` 任何接口都不返回；`ju.admin` 只在带 `x-admin-token` 的请求里返回。
2. 公开 `members` 只含 `status = in` 的人；`out` / `waitlist` 的人对外不存在，只体现在 `counts` 里。#1 门限未达成时，公开 `members` 只含发起人。
3. **公开 `Experience` 的每个字段只能由公开因素算出**（通勤、出发时刻、门禁造成的离开时刻、时段）。私密预算 / 刷卡 / 忌口 / 备注只影响内部满意度和聚合值，绝不出现在单人公开数字里。超预算永远不会让人变成 `absent`。
4. 公开文案只说聚合结论："有人预算偏紧，已按大家都舒服的价位筛选""3 人刷卡点了想去"。只有 1 个人有某约束时只说"有人"，不给能反推是谁的细节。
5. **写公开文案的 LLM 只能拿到 `PublicFacts`**（函数签名里就不接受 `Member`）。私聊 LLM 能看到本人私密信息，但它的输出只回给本人。
6. **攒批重算**：方案出来之后，单个成员的加入 / 退出 / 改私密信息不立即重算（否则"小林一进来方案就变便宜"会暴露小林）。只在以下情况重算：截止时间到；发起人点"出方案"；`pendingChanges >= 2` 且距上次重算 ≥ 3 分钟。重算时思考流只说"有 N 位朋友更新了情况"。
7. 反事实检验（`src/lib/server/privacy.test.ts` + `GET /api/privacy/selftest`）：
   - **交换检验**：造两个公开信息完全相同的成员 A、B，私密信息不同；生成全部公开输出（JuState 公开视图、plan、trace、PublicFacts、规则版群公告）；然后把 A、B 的私密信息对调再生成一遍；把第二份输出里的 A、B 互换后，必须和第一份逐字节相同。
   - **字面检验**：任何私密备注原文、私密预算数字、单方面 wants、rsvp=no 的名字、waitlist 的名字、tier，都不能出现在任何公开输出里。
   - 至少 200 组随机场景，0 泄露。

## 三、决策模型（算法 C，确定性代码，不交给 LLM）

对每个候选（slot × poi）、每个在场成员，算两份体验：

- **公开体验 `Experience`**（只用公开因素）：
  - 到达：`arrive = max(slot.start, day.from + commute)`；`lateMin = arrive - slot.start`
  - 离开：有 `homeBy` 时 `leaveAt = homeBy - commute`；`stayMin = min(slot.end, leaveAt) - arrive`
  - absent：那天不在 availability 里；或 `lateMin > 45`；或 `stayMin < 60`
  - 公开 utility：从 100 扣迟到、早走、通勤超 15 分钟、当天意愿 ok/meh
- **私密体验 `MyExperience`**：公开 utility 再叠加 超私密预算（超 30% 重扣但不 absent）、忌口冲突（火锅 + 不吃辣 → 鸳鸯锅减轻）、刷卡（love +、like 小 +、pass 重扣）、私密备注关键词、饭点排队。
- **#10 照顾**：`fairnessWeights(ledgers)`，账本里累计遗憾越高，本次在 max-min 里的权重越高。
- **方案打分**：主角来不了的方案直接否决。综合分 = 加权最低满意度（公平）为主 + 平均满意度 + 到场比例。
- **#9 方案挑选**：先求帕累托前沿（到场人数 × 加权最低满意度 × 人均价格），再在前沿上挑 2–3 个**标签不同**的方案（人最全 / 大家最舒服 / 最省钱 / 均衡），不允许三家只差一点的同时段店。
- **#9 审计**：`inputHash = HMAC-SHA256(auditSecret, canonicalJSON(规划输入))`，`outputHash = SHA-256(canonicalJSON(方案))`。同样输入必须得到逐字节相同的输出（不许用 `Math.random`、不许依赖对象键顺序）。
- **思考流**：通过 `onTrace` 回调产出，具体、有数字、公开安全，如"计算了 12 个时段 × 8 家店 × 6 个人 = 576 次体验""帕累托前沿上剩 5 个候选""有人预算偏紧，排除了人均 150 以上的 3 家"。

## 四、模块接口

签名就是契约。还没实现的函数，调用方照签名写，联调期间跨目录的 tsc 报错是正常的，最终由 leader 收口。**被依赖的一方请最先把导出签名写出来**（哪怕函数体先用最简实现），减少别人的红线。

### 算法 C —— `src/lib/planner/**`、`src/lib/map/**`

```ts
// src/lib/planner/index.ts 导出：
export function generateSlots(spec: JuSpec): Slot[];
export function fairCenter(points: LatLng[]): LatLng;
export function experienceFor(member: Member, slot: Slot, poi: Poi, commuteMin: number, ctx: PlanContext):
  { pub: Experience; mine: { utility: number; notes: string[] } };
export async function planJu(ju: Ju, members: Member[], map: MapProvider, opts: {
  auditSecret: string;
  onTrace?: (kind: TraceEvent["kind"], text: string) => void;
  /** memberId -> 该成员档案里的账本 */
  ledgers?: Record<string, LedgerEntry[]>;
  now?: Date;
}): Promise<{ plan: Plan; mine: Record<string, MyExperience[]> }>;   // plan 不含 blurb；只用 status=in 的成员
export async function buildSwipeDeck(ju: Ju, members: Member[], me: Member, map: MapProvider): Promise<Poi[]>; // 5-6 张，确定性
export function predictSwipes(profile: Profile | undefined, deck: Poi[]): Record<string, SwipeVerdict>;      // #6
export function autofillFromProfile(profile: Profile | undefined, ju: Ju):
  { availability: Record<string, DayAvailability>; budgetMax?: number; dietTags: DietTag[] };                // #6 无档案时给温和默认值
export function availabilityFromBusy(busy: BusyBlock[], spec: JuSpec, base?: { from?: string; homeBy?: string }):
  Record<string, DayAvailability>;                                                                           // #7
export function fairnessWeights(ledgers: Record<string, LedgerEntry[]>): Record<string, number>;             // #10 权重 1.0–1.6
export function ledgerEntryFor(juId: string, me: MyExperience & { commuteMin: number }, avgCommuteMin: number, at: string): LedgerEntry; // #10
export async function replanStable(ju: Ju, members: Member[], current: Proposal, map: MapProvider, opts: { now?: Date }):
  Promise<{ proposal: Proposal; changes: string[]; tableSize: number; keptVenue: boolean }>;                 // #12 changes 公开安全
export async function itineraryFor(member: Member, proposal: Proposal, map: MapProvider, city: string): Promise<Itinerary>; // #11
export async function etaFor(pos: LatLng, proposal: Proposal, map: MapProvider, now: Date):
  Promise<{ arriveAt: string; lateMin: number }>;                                                            // #11
export function splitBill(receipt: Receipt, attendees: Member[]): BillSplit;                                 // #15 用 private.dietTags / billFacts；金额精确到分，总和 = receipt.total
export function settle(total: number, n: number): { total: number; perPerson: number };
export function canonicalJson(x: unknown): string;   // 审计用
```

`src/lib/map/index.ts`：`getMapProvider()` 返回的对象实现完整 `MapProvider`（含 `transitRoute`：高德 `/v3/direction/transit/integrated`，失败退回打车估算；mock 也要实现；`withFallback` 要包上它）。

### LLM / 多模态 B1 —— `src/lib/llm/**`

全部函数在没有 key、超时、输出不合法时都必须**降级**而不是抛错。多模态函数接受 `image`：`data:image/jpeg;base64,...`，或者字符串 `"demo"`（直接返回内置示例，`fallback: true`，路演备用）。

```ts
// src/lib/llm/index.ts 导出：
export async function parsePrompt(prompt: string, now: Date, defaultCity: string): Promise<{ title: string; spec: JuSpec }>; // 保留
export async function parseChatScreenshot(image: string, now: Date, defaultCity: string): Promise<ChatScreenshotParse>;    // #3
export async function parseSchedule(image: string): Promise<{ busy: BusyBlock[]; fallback?: boolean }>;                    // #7
export async function parseReceipt(image: string): Promise<Receipt>;                                                       // #15
/** 私聊一轮。userText = null 表示开场白。会看到本人私密信息，输出只回本人 */
export async function chatTurn(ctx: {
  ju: Ju;
  me: Member;            // 含 private
  profile?: Profile;     // 老朋友会被认出来
  userText: string | null;
  quorumPending: boolean; // #1 时第一问是"这次能来吗"
  now: Date;
}): Promise<ChatReply & { patch: ChatPatch }>;
// ---- 以下是"公开 LLM"：只接受 PublicFacts，类型上拿不到私密信息 ----
export async function polishPlan(facts: PublicFacts, plan: Plan): Promise<Plan>;          // 写 blurb、润色 recommendation；只能改文字，不能改数字和排序
export async function groupMessages(facts: PublicFacts): Promise<GroupMessages>;           // 按 facts.status 出当前阶段的群公告 / 催促 / 订位话术 / 模拟通话对白
export async function writeRecap(facts: PublicFacts, photoCount: number): Promise<string>; // #16
```

私聊流程（规则降级版也要走通）：#1 时先问来不来（rsvp）→ 从哪出发（widget location）→ 哪天几点能出发 / 几点前要回（widget time，或上传课表 widget schedule）→ 忌口（diet）→ 预算（委婉："不方便在群里说的，可以悄悄告诉我"，widget budget）→ 还有什么想让局长知道的 → 刷卡（widget swipe，done=true）。用户说"都行 / 随便 / 你定"→ `patch.wantsAutofill = true`。老朋友："阿杰又见面了，还是从漕河泾出发？"。用户说不来 → `rsvp: "no"`，局长体面回应"收到，这事只有我知道"。

### 后端核心 B2 —— `src/lib/db.ts`、`src/lib/server/{ju,firewall,intake,profile,http,schemas,seed,stats,geo,privacy}*.ts`、对应路由

```ts
// src/lib/server/firewall.ts
export function publicState(ju: Ju, members: Member[], viewer?: { memberToken?: string; adminToken?: string }): JuState;
export function publicFacts(ju: Ju, members: Member[]): PublicFacts;
export function publicMember(m: Member): Member;               // 剥掉 private / secret
// src/lib/server/ju.ts 额外导出给 B3 用：
export async function withJuLock<T>(id: string, fn: () => Promise<T>): Promise<T>;
export function loadJu(id: string): Ju;
export function nowFor(ju: Ju): Date;                          // 叠加 admin.clockOffsetMin 的"演示时钟"
export function memberByToken(juId: string, token: string): Member; // 401 / 403
export function appendTrace(ju: Ju, kind: TraceEvent["kind"], text: string): void;
export function announce(ju: Ju, text: string): void;          // #8 追加群公告
// src/lib/server/profile.ts
export function getProfile(pid: string): Profile | null;
export function saveProfile(p: Profile): void;
```

### 后端主动智能体 B3 —— `src/lib/server/after/**`、`src/instrumentation.ts`、对应路由

```ts
// src/lib/server/after/inbox.ts
export function pushNotice(m: Member, kind: Notice["kind"], text: string, now: Date): void; // 只改内存对象，调用方负责保存
// src/lib/server/after/scheduler.ts
export async function tickJu(juId: string): Promise<void>;   // 幂等。到点的：门限截止 / 方案截止(交给 B2 的函数) / 出发提醒 / 催入局 / 催款
export function startScheduler(): void;                      // instrumentation.ts 里调，每 30 秒 tick 一遍活跃的局
// src/lib/server/after/changes.ts
export async function onMembershipChangedAfterConfirm(juId: string, reason: string): Promise<void>; // #12 B2 在定局后有人退出/加入时调用
```

`GET /api/ju/:id` 每次被访问时 B2 先调 `tickJu`（懒执行兜底），后台还有 `startScheduler`。

## 五、HTTP API

返回 JSON，出错 `{ error }`。🔒 = `x-admin-token`（创建局时返回）。👤 = `x-member-token`（入局时返回）。图片一律 data URL（前端先压到长边 ≤ 1600px 的 JPEG），或字符串 `"demo"`。

**B2 负责：**

| 方法 & 路径 | 请求 | 返回 |
|---|---|---|
| `POST /api/parse` | `{ prompt }` | `{ title, spec, slots }` |
| `POST /api/parse/screenshot` | `{ image }` | `ChatScreenshotParse & { slots }` #3 |
| `POST /api/ju` | `{ prompt, organizerName, title?, spec?, deadline?, quorum?: { min, deadline? }, capacity?, tiers?: number (1-3), seeds? }` | `{ id, adminToken, tierLinks: { tier, label, token }[] }` |
| `GET /api/ju/:id` | 可带 👤 / 🔒 | `JuState` |
| `PATCH /api/ju/:id` 🔒 | `{ deadline?, title?, capacity? }` | `JuState` |
| `POST /api/ju/:id/join` | `{ name, avatar?, profileId?, isOrganizer?, tierToken?, seedId? }` | `{ memberId, memberToken, status, opening: ChatReply }` |
| `POST /api/ju/:id/chat` 👤 | `{ text }`，或组件提交 `{ rsvp?, location?, availability?, dietTags?, budgetMax?, schedule?: image, autofill?: true }` | `ChatReply & { me: Member }` |
| `GET /api/ju/:id/deck` 👤 | – | `{ deck: Poi[], predicted?: Record<string, SwipeVerdict> }` #6 |
| `POST /api/ju/:id/swipe` 👤 | `{ poiId, verdict }` | `{ me }`；刷完 intake → done |
| `POST /api/ju/:id/wants` 👤 | `{ memberIds }` | `{ me, matchNames }` #2 |
| `PATCH /api/ju/:id/members/:mid` 👤本人 / 🔒 | 本人 `{ status: "in" \| "out" }`；🔒 `{ role }` | `JuState` |
| `POST /api/ju/:id/tiers/:tier/open` 🔒 | – | `JuState` #2 |
| `POST /api/ju/:id/plan` 🔒 | – | `JuState`（status → voting） |
| `GET /api/ju/:id/plan/verify` | – | `{ ok, inputHash, outputHash, recomputedOutputHash }` #9 |
| `POST /api/ju/:id/vote` 👤 | `{ proposalId }` | `JuState`；在场者过半投同一方案自动定局 |
| `POST /api/ju/:id/confirm` 🔒 | `{ proposalId }` | `JuState` |
| `GET /api/ju/:id/messages` 🔒 | – | `GroupMessages` |
| `GET /api/ju/:id/ics` | – | 日历文件（含出发前提醒） |
| `GET /api/profile/:pid` | – | `Profile \| null` |
| `GET /api/geo/search?q=&city=`、`GET /api/geo/reverse?lat=&lng=&from=wgs84` | – | `Place[]` / `Place` |
| `GET /api/stats` | – | `Stats` |
| `GET /api/privacy/selftest` | – | `PrivacySelfTest`（结果缓存 10 分钟） |
| `POST /api/dev/seed/:id` 🔒 | `{ count? }` | `JuState`：见第八节演示场景 |

**B3 负责：**

| 方法 & 路径 | 请求 | 返回 |
|---|---|---|
| `GET /api/ju/:id/itinerary` 👤 | – | `Itinerary` #11 |
| `POST /api/ju/:id/eta` 👤 | `{ lat, lng, from?: "wgs84" }` | `{ eta }`；坐标算完即丢，不落库 #11 |
| `GET /api/ju/:id/inbox` 👤 / `POST /api/ju/:id/inbox/read` 👤 | – | `Notice[]` |
| `POST /api/ju/:id/nudge` 🔒 | – | `{ nudged: number }`（发起人只知道人数）#11 |
| `POST /api/ju/:id/reservation` 🔒 | `{ status?, tableSize? }` | `GroupMessages` #13 |
| `POST /api/ju/:id/receipt` 🔒 | `{ image }` | `{ receipt, split: BillSplit }`（发起人预览）#15 |
| `POST /api/ju/:id/settle` 🔒 | `{ total?, payerName?, useReceipt? }` | `JuState` #14 #15 |
| `POST /api/ju/:id/paid` 👤 | – | `{ me }` #14 |
| `POST /api/ju/:id/remind-pay` 🔒 | – | `{ reminded: number }` #14 |
| `GET /api/ju/:id/payments` 🔒 | – | `Record<memberId, { name, amount, paid }>`（只给付款人 / 发起人）#14 |
| `POST /api/ju/:id/photos` 👤 | `{ image }` | `{ url }` #16（存 `data/photos/<juId>/`） |
| `GET /api/ju/:id/photos/:pid` | – | 图片 |
| `POST /api/ju/:id/recap` 🔒 | – | `JuState` #16（同时把这次的账本记进每个人的档案 #10） |
| `POST /api/ju/:id/again` 🔒 | `{ prompt? }` | `{ id, adminToken, tierLinks }` #16 新局，seeds = 这次在场的人 |
| `POST /api/dev/clock/:id` 🔒 | `{ offsetMin }` | `JuState`：演示快进 |

## 六、页面

- **A2** `/` 发起页：一句话 **或** 上传群聊截图（#3，有"用示例截图"按钮）→ 预览（spec + 预填的人）→ 称呼 → 可选：门限成局（#1）、名额 + 分几圈邀请（#2）、截止时间 → 创建 → 每一圈一个链接 + 群消息，一键复制 → 发起人进局页自己也走一遍私聊。
- **A1** `/j/:id` 手机局页（成员体验）：
  - 入口：认领截图里的自己（#3）→ 私聊局长（气泡 + 内联组件：rsvp / 定位搜索 / 时间 / **课表上传** / 忌口 / 预算 / 快捷回复；"都行"会看到局长的预填并可改 #6）→ 刷卡（右滑想去、上滑超想去、左滑不想；预填的卡片带"局长猜你"标记）
  - 等待室：门限进度（#1，"还差 2 人"）、谁完成了；"想认识谁"私密多选（#2，明确写"只有对方也选了你才会揭晓"）；候补状态显示为"局长正在确认名额"，不出现"第二圈"
  - 方案对比：每个方案先看"你的体验"（mine），再看全员矩阵（公开 utility）、标签、取舍、亮点、推荐理由、跨局照顾说明；"可复核"徽章（点开看审计哈希 + 一键复算 #9）
  - 投票 → 成局：盖章；我的行程卡（出发时间、路线、几点得走、坐在一起的人）；加入日历；"我在路上"共享 ETA（#11）；站内信横幅
  - 局后：我该转多少 + 明细 + "我已转"（#14 #15）；上传照片；回顾页（#16）
- **A2** 发起人控制台 `src/components/organizer/**`，A1 在局页里带 admin token 时渲染 `<OrganizerPanel state={...} />`：复制群公告 / 群消息（#8）、局长去催（#11）、标主角、开放下一圈（#2）、出方案、拍板、订位话术 + **模拟通话**（`speechSynthesis` 按对白播放，明确标"模拟演示"，旁边一键拨打店家电话 #13）、拍小票 → 分账预览 → 结算（#15）→ 已转 x/n + 私下提醒没转的人（#14）、生成回顾、一键再约（#16）、演示快进（dev）。
- **A2** `/j/:id/screen` 大屏 1920×1080：二维码 + 门限进度 / 入局进度；抽象地图；**局长思考流**（逐条打字机）；出方案后"人 × 方案"体验矩阵（公开 utility）+ 推荐理由 + 照顾说明 + **审计面板**（候选数、体验计算次数、帕累托前沿、哈希、"复算一致 ✓"）+ **隐私面板**（反事实检验 N 次 0 泄露，来自 `/api/privacy/selftest`）；成局盖章；局后照片墙 + 回顾。
- **A2** `/firewall` 路演讲解页：隐私防火墙三层架构图 + 实时自检结果 + "评委可以试试问局长谁预算最紧"。
- `/stats`：保留，加上 `privateShareRate`。

## 七、文件归属

| 角色 | 负责 |
|---|---|
| 算法（C） | `src/lib/planner/**`、`src/lib/map/**` |
| LLM / 多模态（B1） | `src/lib/llm/**` |
| 后端核心（B2） | `src/lib/db.ts`、`src/lib/server/*.ts`（`after/` 除外）、`src/app/api/**`（B3 列出的路由除外）、`scripts/smoke.ts` |
| 后端主动智能体（B3） | `src/lib/server/after/**`、`src/instrumentation.ts`、第五节 B3 表里的路由 |
| 前端成员体验（A1） | `src/app/j/[id]/page.tsx`、`src/components/ju/**`、`src/components/{ui,toast,Stamp,fixtures}.tsx`、`src/lib/client/**`、`src/app/globals.css`、`src/app/layout.tsx` |
| 前端发起 / 控制台 / 大屏（A2） | `src/app/page.tsx`、`src/app/j/[id]/screen/**`、`src/app/firewall/**`、`src/app/stats/**`、`src/app/dev/**`、`src/components/{organizer,screen,launch,stats}/**`、`public/**` |
| leader | `src/lib/types.ts`、`docs/**`、`package.json`、`next.config.ts`、`scripts/deploy.sh`、git 提交与部署 |

A2 需要 `src/lib/client/api.ts` 里的新方法时，在自己目录里写 `src/components/organizer/api.ts` 之类的薄封装，不要改 A1 的文件。

## 八、演示场景（`POST /api/dev/seed/:id`，B2 实现，C 的算法要让它有戏）

加 6 个演示成员（`isDemo: true`），刻意制造冲突，让方案有取舍可讲：

- 阿杰：漕河泾，6 点半下班（晚到），档案里有 3 次"跑得最远"的账本（#10 被照顾）
- 小林：私密预算 80（#4），刷卡把最贵那家 pass 了
- 老王：11 点前回宿舍（门禁，私密），不吃辣
- 小周：说"都行"，由局长预填（#6）
- 阿May：私下 rsvp = no（#5，公开视图里不存在）
- 大刘：从第二圈进来、名额满了在候补（#2），有人退出后转正
- 小林和阿杰互相标了"想认识"（#2 互选成功 1 对）

## 九、运行约定

- dev server（各用各的 distDir，互不干扰）：A1 `3000`（`.next`）；A2 `NEXT_DIST_DIR=.next-a2 npx next dev -p 3003`；B2 `NEXT_DIST_DIR=.next-b npx next dev -p 3001`；B3 `NEXT_DIST_DIR=.next-b3 npx next dev -p 3004`；leader `3002`（`.next-l`）。
- `.env.local` 已配好真实高德 key、DeepSeek key、Anthropic key（Claude 支持看图，多模态走它），所有人共用。场馆：上海徐汇 36space（`DEMO_CENTER=31.167645,121.431950`）。
- **没有任何 key 时整条链路也必须能跑**（mock 地图 + 脚本式私聊 + 多模态返回示例）。
- 单测 `npm test`；只看自己目录的 tsc 报错：`npx tsc --noEmit -p . 2>&1 | grep <你的目录>`。
- **不要 `git commit`、不要 `npm install`、不要改别人的文件、不要部署。** 需要新依赖或改契约，写进最终汇报。
- 生产环境 https://ju.yuanshengzhe.com，部署只由 leader 执行，**不要在生产跑 smoke**。

## 十、v4 局内编排（#17–#21）

### 1. 数据（全部可选，旧数据没有）

- `MemberPrivate.know: Record<memberId, 0|1|2>`：我觉得和 TA 多熟（不认识 / 见过 / 挺熟）。**单方面，对方也看不到**。`knowAuto` 记哪些是按档案记忆预填的。
- `MemberPrivate.energy: "low"|"mid"|"high"`：今天的社交电量。low = 每一轮都留熟人，第一轮玩法从轻松档开始。
- `MemberPrivate.avoid: [memberId]`：悄悄不想同桌，最多 1 人。
- `MemberPrivate.feel: Record<轮次, "stiff"|"ok"|"loud">`：每轮的私下感受。
- `MemberPrivate.clicked / clickMatches`：局后"聊得来"，双方都选了才进 `clickMatches`。
- `Member.interests`：**公开**兴趣（填的时候写明"会给同桌看"），只用来出话题卡。
- `Ju.seating: Seating`（公开，座位本来就是现场看得见的）：轮次、每桌、玩法、话题卡、聚合反馈 `feedback`、调整说明 `adjust`、`metrics`（全是对数）、`audit`（HMAC 输入承诺 + 输出哈希）。
- `Ju.prevJuId`：「再约」链；`Profile.know: Record<对方 profileId, 0|1|2>`：圈子记忆。
- `JuPrivate.seatSnapshot`：最近一次排座的输入和诱饵对，**只在服务端**，复算用。
- `JuState.mine.seats`：我每一轮坐哪 + 为什么这么排（**只用本人自己的标记解释**）；`mine.clickNames`。

### 2. 隐私规则（硬性，`privacy.test.ts` 里有对应检验）

1. 熟悉度**对称化：fam = max(两边说的)**。只要对方说了挺熟，我标什么都不影响任何公开输出（检验 5：单向标记隐藏）。
2. 单方面"想认识""聊得来"不进算法、不改变任何公开输出（检验 6）。
3. 回避：硬约束不同桌 + 诱饵掩护，从没同桌的对数 ≥ `AVOID_COVER`(3) × 回避数；做不到就**不执行**，并用和"没人提回避"完全相同的随机标签重算，输出逐字节相同；公开的 `audit.evaluations` 只记最后一次求解（否则诱饵迭代次数本身就是信号）（检验 7：可否认回避）。
4. 私下拒绝 / 退出的人对排座毫无影响，也从公开座位表里消失（可否认缺席检验在排座 + 推进轮次之后跑）。
5. 本人座位说明只用本人自己的标记：没标过的人不说"不认识"。
6. 轮次反馈少于 3 条不公开具体数字；多数派感受只以"上一轮有 N 位朋友觉得有点拘谨"这种聚合句出现。
7. 排座本身由私密标记决定（这是功能），所以**交换检验停在排座之前**比；排座之后由检验 5–7 + 字面检验 + 身份隔离覆盖。`audit.inputHash` 是带每局密钥的 HMAC 承诺，和方案的一样不参与逐字节比较。
8. 防火墙圈层正则从"第 N 轮"收窄为"第 N 圈 / 层 / 轮邀请"：v4 起"第 N 轮"是公开的活动轮次。

### 3. 算法（`src/lib/planner/grouping.ts`、`formats.ts`，确定性）

- 目标：+ 新交流（之前不认识 10 / 见过 4 / 挺熟 0.5）+ 共同公开兴趣；− 重复同桌；− 没有锚点（第一轮所有人、电量低的人每一轮，权重 80，和回避同级——这是对用户的承诺）；− 一桌全熟人；− 互选的人一次都没同桌；− 回避 / 诱饵同桌（80）；− 重排时和上一版不同。
- 求解：每局密钥 HMAC 派生的多起点 + 最陡下降（两人换桌，增量计分）+ 每个起点 12 次扰动再下降（迭代局部搜索）。30 人 3 轮毫秒级。
- 玩法：规则库（吃饭类 = 换座；其他 = 分组环节），第一轮有人电量低或熟识比例 < 35% 就从轻松档开始，之后逐轮升温；上一轮多数拘谨 → 留在轻松档并加强锚点重排（`anchorBoost = 1.6`），太吵 → 降一档。
- 话题卡：只说至少 2 人共有的公开兴趣 + 一张通用题目卡。

### 4. HTTP API

| 方法 & 路径 | 请求 | 返回 |
|---|---|---|
| `POST /api/ju/:id/social` 👤 | `{ know?, energy?, avoid?: [id], interests? }` | `{ me }` |
| `POST /api/ju/:id/seating` 🔒 | `{ rounds?: 1-3, tableSize?: 2-8 }`（定局后、第一轮开始前可重排） | `JuState` |
| `POST /api/ju/:id/seating/next` 🔒 | – | `JuState`：开始第 1 轮 / 结束当前轮（写入聚合反馈）并按反馈调整下一轮 |
| `POST /api/ju/:id/seating/absent` 🔒 | `{ memberId, absent }` | `JuState`：重排还没开始的轮次 |
| `GET /api/ju/:id/seating/verify` | – | `{ ok, inputHash, outputHash, recomputedOutputHash }` |
| `POST /api/ju/:id/feel` 👤 | `{ round, feel }`（只能给正在进行的那轮） | `{ me }` |
| `POST /api/ju/:id/clicked` 👤 | `{ memberIds }`（定局后） | `{ me, clickNames }` |
| `GET /api/ju/:id/circle` | – | `CircleStep[]`：顺着 prevJuId 最多 8 局 |
| `POST /api/dev/seed/:id` 🔒 | `{ scene: "club" }` | 社团团建演示场景（见下） |

定局后有人退出 / 加入（#12）时，`replanAfterChangeLocked` 会顺带重排还没开始的轮次；生成回顾时（#16）一起到场的人在各自档案里记成"见过"。

### 5. 演示场景 `scene = "club"`

摄影社第 3 次聚会：发起人 = 社长 + 9 个演示成员。4 个老社员互相挺熟、都和社长挺熟；5 个新生之间零星见过；两拨人基本不认识。
木木电量低（每轮都有熟人）；小鹿悄悄不想和大鹏一桌（诱饵掩护）；橙子和知夏互选。前两次聚会作为圈子历史挂在 prevJuId 链上
（3→9 对、9→15 对），这一局 16 对起步。`social.test.ts` 用 30 个随机密钥压测（开发时跑过 100 个）：2 轮和 3 轮都满足以上全部设定。

演示路径：发起 → 控制台「社团演示」→ 出方案 → 拍板 → 控制台「局内编排」排座 → 大屏看座位板和关系升级 → 「开始第 1 轮」→ 成员私下点"有点拘谨" → 「下一轮」看局长怎么调。

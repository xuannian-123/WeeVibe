# AI 局长 · 团队契约

> 一句话，局就组好了。发起人说一句话 → 分享 H5 链接到微信群 → 朋友 10 秒填时间/出发地/忌口 → AI 算出共同时间 + 通勤最公平的 3 家店 → 投票 → 盖章定局。

共享类型全部在 `src/lib/types.ts`，**不要私自改**；需要改先停下来在汇报里写明理由，由 leader 统一改。

## 文件归属（只改自己的目录）

| 角色 | 负责 |
|---|---|
| 算法（C） | `src/lib/planner/**`、`src/lib/map/**`、对应 `*.test.ts` |
| 后端（B） | `src/lib/db.ts`、`src/lib/llm/**`、`src/lib/server/**`、`src/app/api/**`、`scripts/**` |
| 前端（A） | `src/app/**` 中除 `api/` 以外的页面、`src/components/**`、`src/app/globals.css`、`public/**` |
| leader | `src/lib/types.ts`、`docs/**`、`package.json`、`next.config.ts`、`.env.example` |

需要新增依赖：在汇报里提出，由 leader 安装。

## 运行约定

- 多人同时跑 dev server 时用不同的输出目录和端口，避免 `.next` 冲突：
  - 前端：`npm run dev`（3000 端口，`.next`）
  - 后端：`NEXT_DIST_DIR=.next-b npx next dev -p 3001`
- 单测：`npm test`（vitest）
- 没有任何 key 时整个应用必须能跑：地图走 mock、LLM 走规则兜底。现场 Demo 也靠这个兜底。

## 环境变量（见 `.env.example`）

- `AMAP_KEY`：高德 Web 服务 key。为空时用 mock 地图。
- `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`：OpenAI 兼容接口（DeepSeek / 通义 / Kimi 都行）。
- `ANTHROPIC_API_KEY`：设置了就优先用 Claude（模型 `claude-sonnet-5-5`）。
- 两种 LLM 都没配：走规则解析兜底。
- `DEMO_CITY` / `DEMO_CENTER`（`lat,lng`）：默认城市和地图中心，mock 数据围绕它生成。

## 算法模块接口（C 实现，B 调用）

```ts
// src/lib/planner/index.ts
export function generateSlots(spec: JuSpec): Slot[];          // 最多 12 个候选开始时间
export function pickSlot(slots: Slot[], members: Member[]): { slotId: string; attendeeIds: string[]; absentIds: string[] };
export function fairCenter(points: LatLng[]): LatLng;          // 让"最远的人"尽量近的点（minimax）
export async function planJu(ju: Ju, members: Member[], map: MapProvider): Promise<Plan>; // 不含 blurb
export function settle(total: number, attendeeCount: number): { total: number; perPerson: number };

// src/lib/map/index.ts
export function getMapProvider(): MapProvider;                 // 有 AMAP_KEY 用高德，否则 mock
```

打分原则：最长通勤（公平）权重最高，其次预算匹配、忌口冲突、评分。打分必须是确定性代码，不交给 LLM。

## LLM 模块接口（B 实现）

```ts
// src/lib/llm/index.ts
export async function parsePrompt(prompt: string, now: Date, defaultCity: string): Promise<{ title: string; spec: JuSpec }>;
export async function parseDiet(raw: string): Promise<DietTag[]>;
export async function writeBlurbs(ju: Ju, plan: Plan, members: Member[]): Promise<string[]>; // 每个 option 一句
```

每个函数都必须有规则兜底，LLM 超时（8 秒）或出错时自动降级。

## HTTP API（B 实现，A 调用）

所有返回都是 JSON；出错时返回 `{ error: string }` 并带 4xx/5xx。管理操作需要请求头 `x-admin-token`（创建局时返回，前端存 localStorage）。

| 方法 & 路径 | 请求体 | 返回 |
|---|---|---|
| `POST /api/parse` | `{ prompt }` | `{ title, spec, slots }`（预览，不落库） |
| `POST /api/ju` | `{ prompt, organizerName, title?, spec? }` | `{ id, adminToken, organizerMemberId: null }` |
| `GET /api/ju/:id` | – | `JuState` |
| `POST /api/ju/:id/members` | `{ name, avatar?, location: Place, availableSlotIds, dietRaw, budgetMax?, isOrganizer? }` | `{ memberId }` |
| `PATCH /api/ju/:id/members/:mid` | 同上的部分字段，或 `{ status: "out" }` | `{ ok: true }` |
| `POST /api/ju/:id/plan` 🔒 | – | `JuState`（status → voting，含 plan 和 blurb） |
| `POST /api/ju/:id/vote` | `{ memberId, poiId }` | `JuState`。在场成员过半投同一家时自动定局 |
| `POST /api/ju/:id/confirm` 🔒 | `{ poiId }` | `JuState`（status → confirmed） |
| `POST /api/ju/:id/settle` | `{ total, payerName? }` | `JuState` |
| `GET /api/ju/:id/ics` | – | `text/calendar` 文件，含提前 2 小时提醒 |
| `GET /api/geo/search?q=&city=` | – | `Place[]` |
| `GET /api/geo/reverse?lat=&lng=&from=wgs84` | – | `Place`（浏览器定位传 `from=wgs84`，后端用 `wgs84ToGcj02` 转成高德坐标后再返回） |
| `POST /api/dev/seed/:id` 🔒 | `{ count? }` | `JuState`（加入 5–6 个演示成员，Demo 兜底用） |

有成员退出（status out）且已出方案时，后端自动重算 plan。

## 页面（A 实现）

- `/` 发起页：一句话输入 → 预览解析结果（可微调）→ 填自己的名字 → 创建 → 跳到局页并给出分享卡。
- `/j/:id` 局页（手机）：按状态展示 —— 填写表单 / 等待中 / 投票 / 已定局（盖章动画 + 加入日历 + AA）。
- `/j/:id/screen` 大屏（路演投屏，1920×1080）：二维码 + 抽象地图（成员点、公平中心、候选店、连线）+ 时间热力 + 实时人数；发起人在这页也能点"出方案 / 定局"。

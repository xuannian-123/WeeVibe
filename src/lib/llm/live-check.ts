// 手动联调脚本：用 .env.local 里的真 key 把 LLM 模块的每个导出各调一次，打印耗时和是否降级。
// 用法：npx tsx src/lib/llm/live-check.ts            （在项目根目录跑）
//      npx tsx src/lib/llm/live-check.ts --only=vision
// 看图用 src/lib/llm/fixtures/ 里的三张图（小票 / 群聊 / 课表，用 System.Drawing 画的中文图）。
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Ju, Member, Plan, PublicFacts } from "../types";

// ---------------------------------------------------------------- 读 .env.local（不覆盖已有环境变量）

function loadEnv(file: string) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const v = m[2].replace(/^["']|["']$/g, "");
    if (v && !process.env[m[1]]) process.env[m[1]] = v;
  }
}
loadEnv(resolve(process.cwd(), ".env.local"));

const NOW = new Date();
const FIXTURES = resolve(process.cwd(), "src/lib/llm/fixtures");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);

function img(name: string): string {
  return `data:image/png;base64,${readFileSync(resolve(FIXTURES, name)).toString("base64")}`;
}

type Row = { name: string; ms: number; status: string; detail: string };
const rows: Row[] = [];

/** 跑一个函数：捕获 [llm] 降级告警，判断是真调通了还是降级 */
async function check<T>(name: string, fn: () => Promise<T>, summarize: (x: T) => string, fellBack?: (x: T) => boolean) {
  const warns: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => void warns.push(a.map(String).join(" "));
  const t0 = Date.now();
  try {
    const out = await fn();
    const ms = Date.now() - t0;
    const fb = warns.length > 0 || (fellBack?.(out) ?? false);
    rows.push({ name, ms, status: fb ? "降级" : "LLM ✓", detail: (fb && warns[0] ? `${warns[0]} | ` : "") + summarize(out) });
  } catch (e) {
    rows.push({ name, ms: Date.now() - t0, status: "抛错 ✗", detail: String((e as Error)?.message ?? e) });
  } finally {
    console.warn = orig;
  }
  const r = rows[rows.length - 1];
  console.log(`\n[${r.status}] ${r.name}  ${r.ms}ms\n  ${r.detail}`);
}

async function main() {
  const llm = await import("./index");
  const { callLlmJson } = await import("./provider");
  console.log(`文本 provider：${llm.currentProvider()}；看图 provider：${llm.visionProvider()}`);

  const ju: Ju = {
    id: "live",
    title: "周六火锅局",
    rawPrompt: "周六晚上火锅",
    spec: {
      category: "火锅",
      poiKeywords: ["火锅"],
      dates: (await llm.parsePrompt("周六晚上火锅", NOW, "上海")).spec.dates,
      earliest: "18:00",
      latest: "20:00",
      durationMinutes: 120,
      city: "上海",
    },
    slots: [],
    status: "collecting",
    createdAt: NOW.toISOString(),
    votes: {},
    trace: [],
    announcements: [],
    pendingChanges: 0,
    revisions: [],
  };
  const me: Member = {
    id: "m1",
    juId: "live",
    name: "小周",
    avatar: "🐼",
    role: "guest",
    intake: "chatting",
    status: "in",
    joinedAt: NOW.toISOString(),
    isOrganizer: false,
    private: {
      chat: [{ role: "juzhang", text: "你从哪儿出发？在下面搜一下，或者直接告诉我。", at: NOW.toISOString() }],
      availability: {},
      dietTags: [],
      notes: [],
      swipes: {},
      autoFilled: [],
      wants: [],
      matches: [],
      billFacts: {},
      inbox: [],
    },
  };
  const facts: PublicFacts = {
    title: "周六火锅局",
    category: "火锅",
    city: "上海",
    status: "confirmed",
    organizerName: "小林",
    members: [
      { id: "a", name: "小林", avatar: "🐱", role: "guest", intake: "done", isOrganizer: true },
      { id: "b", name: "阿杰", avatar: "🐶", role: "must", intake: "done", isOrganizer: false },
      { id: "c", name: "小周", avatar: "🐼", role: "guest", intake: "done", isOrganizer: false },
    ],
    counts: { in: 3, done: 3, waitlist: 0, matchPairs: 0 },
    constraintSummaries: ["有人不吃辣，已优先选能点鸳鸯锅的店", "有人预算偏紧，已按大家都舒服的价位筛选"],
    proposals: [
      {
        id: "p1",
        labelText: "人最全",
        slotLabel: "周六 18:30",
        poiName: "蜀大侠火锅（徐汇店）",
        costPerPerson: 98,
        attendCount: 3,
        headline: "3 人全到，有 1 人晚 15 分钟",
        tradeoffs: ["饭点可能要排队 20 分钟"],
        highlights: ["人均 98，大家都在预算内", "2 人刷卡点了超想去"],
        recommended: true,
      },
      {
        id: "p2",
        labelText: "最省钱",
        slotLabel: "周六 19:00",
        poiName: "小龙坎（漕河泾店）",
        costPerPerson: 76,
        attendCount: 2,
        headline: "2 人到，人均最低",
        tradeoffs: ["有 1 人来不了"],
        highlights: ["人均 76"],
        recommended: false,
      },
    ],
    recommendation: "推荐「人最全」：3 人都能到，人均 98 在大家的预算内",
    confirmed: { slotLabel: "周六 18:30", poiName: "蜀大侠火锅（徐汇店）", address: "徐汇区漕溪北路 88 号", headcount: 3 },
  };
  const plan: Plan = {
    proposals: facts.proposals!.map((p, i) => ({
      id: p.id,
      label: i === 0 ? "most-people" : "cheapest",
      labelText: p.labelText,
      slot: { id: "s", start: `${ju.spec.dates[0]}T18:30:00+08:00`, end: `${ju.spec.dates[0]}T20:30:00+08:00` },
      poi: { id: `poi${i}`, name: p.poiName, address: "徐汇区", lat: 31.17, lng: 121.43, type: "火锅", costPerPerson: p.costPerPerson, rating: 4.6 },
      experiences: [],
      attendCount: p.attendCount,
      minUtility: 70,
      avgUtility: 82,
      score: 85 - i * 6,
      headline: p.headline,
      tradeoffs: p.tradeoffs,
      highlights: p.highlights,
      recommended: p.recommended,
    })),
    recommendation: facts.recommendation!,
    constraintSummaries: facts.constraintSummaries,
    center: { lat: 31.17, lng: 121.43 },
    audit: { inputHash: "-", outputHash: "-", candidates: 24, evaluations: 72, paretoSize: 4, algorithmVersion: "live" },
    computedAt: NOW.toISOString(),
  };

  if (only !== "vision") {
    await check("parsePrompt", () => llm.parsePrompt("下周五晚上7点在徐汇吃烤肉，6个人人均150", NOW, "上海"), (x) => JSON.stringify(x));
    await check("parseDiet", () => llm.parseDiet("海里的东西我都不碰，另外最近在吃斋"), (x) => JSON.stringify(x));
    await check(
      "chatTurn",
      () => llm.chatTurn({ ju, me, userText: "6 点半下班，从漕河泾过来，11 点前回宿舍，我不喝酒哈", quorumPending: false, now: NOW }),
      (x) => `${x.reply} | widget=${x.widget} | patch=${JSON.stringify(x.patch)}`,
    );
    await check("polishPlan", () => llm.polishPlan({ ...facts, status: "voting" }, plan), (x) =>
      `${x.proposals.map((p) => p.blurb).join(" / ")} | ${x.recommendation}`,
    );
    await check("groupMessages(confirmed)", () => llm.groupMessages(facts), (x) =>
      `${x.broadcast.replace(/\n/g, " ⏎ ")} | 话术：${x.reservationScript} | 对白 ${x.reservationDialog?.length} 句：${x.reservationDialog?.map((l) => `${l.who}:${l.text}`).join(" ")}`,
    );
    await check("groupMessages(voting)", () => llm.groupMessages({ ...facts, status: "voting", confirmed: undefined }), (x) =>
      x.broadcast.replace(/\n/g, " ⏎ "),
    );
    await check("writeRecap", () => llm.writeRecap({ ...facts, settlement: { total: 430, payCount: 3, paidCount: 3, explain: [] } }, 9), (x) => x);
  }

  if (only !== "text") {
    if (llm.visionProvider() === "rules") {
      console.log("\n[跳过] 看图：没有能看图的 provider（需要 ANTHROPIC_API_KEY，或 OpenAI 兼容多模态模型 + LLM_VISION=1）");
      rows.push({ name: "看图（全部）", ms: 0, status: "跳过", detail: "没有能看图的 provider" });
    } else {
      await check(
        "看图冒烟（callLlmJson + image）",
        () =>
          callLlmJson({
            system: "你在看一张图片，回答问题。",
            user: "这张小票的实付金额是多少？图里第一行的店名是什么？",
            images: [img("receipt.png")],
            schema: {
              type: "object",
              additionalProperties: false,
              required: ["total", "shop"],
              properties: { total: { type: "number" }, shop: { type: "string" } },
            },
            maxTokens: 200,
          }),
        (x) => JSON.stringify(x),
      );
      await check("parseReceipt(fixture)", () => llm.parseReceipt(img("receipt.png")), (x) =>
        `total=${x.total} fee=${x.serviceFee} discount=${x.discount} | ${x.items.map((i) => `${i.name}×${i.qty}@${i.price}[${i.tags.join(",")}]`).join(" ")}`,
        (x) => !!x.fallback,
      );
      await check("parseChatScreenshot(fixture)", () => llm.parseChatScreenshot(img("chat.png"), NOW, "上海"), (x) =>
        `${x.title} | ${JSON.stringify(x.spec)} | ${x.seeds.map((s) => `${s.name}:${s.said}${s.hint ? `(${s.hint})` : ""}`).join(" ")}`,
        (x) => !!x.fallback,
      );
      await check("parseSchedule(fixture)", () => llm.parseSchedule(img("schedule.png")), (x) =>
        x.busy.map((b) => `周${b.weekday} ${b.from}-${b.to} ${b.label ?? ""}`).join("；"),
        (x) => !!x.fallback,
      );
    }
  }

  console.log("\n================ 汇总");
  for (const r of rows) console.log(`${r.status.padEnd(6)} ${String(r.ms).padStart(6)}ms  ${r.name}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

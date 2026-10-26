// 理解测试集 · 大模型版：同一份数据（src/lib/planner/needs.dataset.ts）走一遍线上同款私聊，
// 看合并后（规则 + 大模型）抽出来的需求对不对。需要真实的大模型 key，不进 CI。
// 用法：npx tsx --env-file=.env.local scripts/eval-needs.ts
import { chatTurn } from "../src/lib/llm/chat";
import { currentProvider } from "../src/lib/llm/provider";
import type { ExtractedNeed } from "../src/lib/planner/needs";
import type { Ju, Member } from "../src/lib/types";

import { UNDERSTANDING_SET, type Exp } from "../src/lib/planner/needs.dataset";

function ok(got: ExtractedNeed[], exp: Exp[]): boolean {
  const m = (g2: ExtractedNeed, e: Exp) => {
    const r = g2.rule as { t: string; minutes?: number; at?: string; words?: string[] };
    if (g2.dim !== e.dim || r.t !== e.t) return false;
    if (e.kind && g2.kind !== e.kind) return false;
    if (e.minutes !== undefined && r.minutes !== e.minutes) return false;
    if (e.at && r.at !== e.at) return false;
    if (e.words && JSON.stringify([...(r.words ?? [])].sort()) !== JSON.stringify([...e.words].sort())) return false;
    return true; // 强度不严格比：大模型对"在意程度"的判断允许和规则不同
  };
  return got.length === exp.length && exp.every((e) => got.some((x) => m(x, e)));
}

async function main() {
  if (currentProvider() === "rules") {
    console.error("没有配置大模型 key：用 npx tsx --env-file=.env.local scripts/eval-needs.ts");
    process.exit(1);
  }
  const ju: Ju = {
    id: "eval",
    title: "周五火锅局",
    rawPrompt: "",
    spec: { category: "火锅", poiKeywords: ["火锅"], dates: ["2030-11-01"], earliest: "18:00", latest: "19:30", durationMinutes: 150, city: "上海" },
    slots: [],
    status: "collecting",
    createdAt: new Date().toISOString(),
    votes: {},
    trace: [],
    announcements: [],
    pendingChanges: 0,
    revisions: [],
  };
  let pass = 0;
  const wrong: string[] = [];
  for (const [text, exp] of UNDERSTANDING_SET) {
    const me: Member = {
      id: "m1",
      juId: "eval",
      name: "小林",
      avatar: "🙂",
      role: "guest",
      intake: "chatting",
      status: "in",
      joinedAt: new Date().toISOString(),
      isOrganizer: false,
      location: { lat: 31.2, lng: 121.43, label: "徐家汇" },
      private: {
        chat: [{ role: "juzhang", text: "还有什么想让局长知道的吗？只有我知道。", at: new Date().toISOString(), ask: "notes" }],
        rsvp: "yes",
        availability: { "2030-11-01": { from: "18:30", pref: "ok" } },
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
    const r = await chatTurn({ ju, me, userText: text, quorumPending: false, now: new Date() });
    const got = r.patch.needs ?? [];
    if (ok(got, exp)) pass++;
    else wrong.push(`「${text}」\n    期望 ${JSON.stringify(exp)}\n    实际 ${JSON.stringify(got.map((n) => ({ dim: n.dim, ...n.rule, kind: n.kind })))}`);
    process.stdout.write(ok(got, exp) ? "." : "x");
  }
  console.log(`\n\n${pass}/${UNDERSTANDING_SET.length} 正确（${currentProvider()}）`);
  if (wrong.length) console.log(wrong.join("\n"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

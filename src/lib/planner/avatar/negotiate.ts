// v6 分身谈判协议（docs/AVATAR.md 第 4 节）：五轮，全部确定性（同样输入 → 逐字同样的记录）。
//   0 交底（密封）：分身把授权书交给局长，公开只说聚合数
//   1 出方案：不让步时最好的方案 + 卡点（被卡住的分身各说一句，只说类别）
//   2 让步：give 内自动同意（写本人 avatarLog）；超出 give、不碰底线 → 局长私下问本人（v5 NegotiationAsk）；碰底线 → 不问
//   3 交换与补偿：两人在不同维度各让一小步、缺一不可；让过步的人记进让步账（两段式时第二段优先照顾他的口味）
//   4 拍板：v5 三级准则；每人私下收到"你得到了什么 / 分身替你让了什么 / 为什么"
// 隐私（AVATAR.md 第 6 节）：公开记录的说话人只有"局长"和分身代号。代号按事件内容的规范顺序分配
// （先渲染出"把自己换成 @、别人换成 ?"的内容签名，按签名排序发代号），和成员 id、加入顺序、真名、分身名都无关——
// 所以把两个公开信息相同的人的隐藏信息互换，公开记录逐字相同（privacy.ts 的 negotiation 检验）。
// 文案只用公开因素（时段、店、公开体验里的晚到 / 能待多久）和聚合人数；1 个人时只说"有人 / 有 1 位朋友"。
import type { AvatarLogEntry, Diagnosis, Give, Member, Mood, Negotiation, NegotiationEvent, Proposal } from "../../types";
import { ABSENT_LATE_MIN, HARD_DIET, MIN_STAY_MIN, slotTimes, timeFit } from "../experience";
import type { Candidate } from "../plan";
import { reasonsFor, type AskDraft } from "../repair";
import { cmpStr, minToHm, sha256Hex, slotLabel } from "../util";
import type { GiveUse, Given } from "./give";
import { GIVE_DIMS, MOOD_TEXT, giveInEffect, hasGive, splitFloors } from "./mandate";

export const NEGOTIATION_ROUNDS = 5;

// ---------------------------------------------------------------- 事件草稿：说话人和文中提到的分身先用成员下标占位

type Actor = { a: number };
type Part = string | Actor;
type Draft = { round: NegotiationEvent["round"]; speaker: "局长" | Actor; kind: NegotiationEvent["kind"]; parts: Part[] };
type RoundDrafts = { head: Draft[]; body: Draft[]; foot: Draft[] };

const boss = (round: Draft["round"], kind: Draft["kind"], ...parts: Part[]): Draft => ({ round, speaker: "局长", kind, parts });
const avatar = (round: Draft["round"], a: number, kind: Draft["kind"], ...parts: Part[]): Draft => ({ round, speaker: { a }, kind, parts });

const actorsOf = (d: Draft): number[] => [...(typeof d.speaker === "string" ? [] : [d.speaker.a]), ...d.parts.filter((p): p is Actor => typeof p !== "string").map((p) => p.a)];

/** 某个分身视角下的事件签名：自己 → @，别人 → ?（与身份无关，只和内容有关） */
function sig(d: Draft, self: number): string {
  const who = (x: Actor) => (x.a === self ? "@" : "?");
  const sp = typeof d.speaker === "string" ? d.speaker : who(d.speaker);
  return `${d.round}|${d.kind}|${sp}|${d.parts.map((p) => (typeof p === "string" ? p : who(p))).join("")}`;
}

/** 代号：A、B、C…（超过 26 个时 Z2、Z3…） */
function codeName(k: number): string {
  return `分身 ${k < 26 ? String.fromCharCode(65 + k) : `Z${k - 24}`}`;
}

/** 同一轮里分身发言的先后：先亮卡点，再让步，再说"去问本人" */
const KIND_ORDER: NegotiationEvent["kind"][] = ["open", "propose", "block", "concede", "ask", "trade", "compensate", "decide"];

/** 按内容签名发代号，再按 (类别, 内容, 代号) 给每轮的分身发言排序 */
function render(rounds: RoundDrafts[]): NegotiationEvent[] {
  const all = rounds.flatMap((r) => [...r.head, ...r.body, ...r.foot]);
  const actors = [...new Set(all.flatMap(actorsOf))];
  const signature = new Map(actors.map((a) => [a, all.filter((d) => actorsOf(d).includes(a)).map((d) => sig(d, a)).join("\n")]));
  // 签名完全相同的两个分身互换代号，输出逐字不变，所以这里的平局怎么破都不影响结果
  const order = [...actors].sort((x, y) => cmpStr(signature.get(x)!, signature.get(y)!) || x - y);
  const code = new Map(order.map((a, k) => [a, codeName(k)]));
  const text = (d: Draft) => d.parts.map((p) => (typeof p === "string" ? p : code.get(p.a)!)).join("");
  const speaker = (d: Draft) => (typeof d.speaker === "string" ? d.speaker : code.get(d.speaker.a)!);
  const neutral = (d: Draft) => sig(d, -1);
  const kindRank = (d: Draft) => KIND_ORDER.indexOf(d.kind);
  const out: NegotiationEvent[] = [];
  for (const r of rounds) {
    const body = [...r.body].sort(
      (x, y) => kindRank(x) - kindRank(y) || cmpStr(neutral(x), neutral(y)) || cmpStr(speaker(x), speaker(y)) || cmpStr(text(x), text(y)),
    );
    for (const d of [...r.head, ...body, ...r.foot]) out.push({ round: d.round, speaker: speaker(d), kind: d.kind, text: text(d) });
  }
  return out;
}

// ---------------------------------------------------------------- 卡点（只说类别）

type Block = "day" | "late" | "floorTime" | "floorDiet" | "floorOther" | "money" | "soft";

/** 某人在某候选里为什么没被照顾到（m 是规划用的有效成员：被降级的底线已经不在硬约束里） */
export function blockOf(m: Member, c: Candidate, i: number): Block {
  if (c.pubs[i].status === "absent") {
    const tf = timeFit(m, c.slot, c.pubs[i].commuteMin);
    if (!tf.dayOk) return "day";
    const { start, end } = slotTimes(c.slot);
    const minStay = Math.min(MIN_STAY_MIN, end - start, m.private?.relax?.minStayMin ?? MIN_STAY_MIN);
    const maxLate = Math.max(ABSENT_LATE_MIN, m.private?.relax?.maxLateMin ?? 0);
    if (tf.stay < minStay && tf.leaveAt && tf.late <= maxLate) return "floorTime";
    return "late";
  }
  if (c.flags[i].hard) {
    const hardDiet = (m.private?.dietTags ?? []).some((t) => HARD_DIET.includes(t));
    return c.flags[i].dietConflict && hardDiet ? "floorDiet" : "floorOther";
  }
  const top = [...(c.softs[i] ?? [])].sort((a, b) => b.cost - a.cost || cmpStr(a.key, b.key))[0];
  return top?.key === "budget" ? "money" : "soft";
}

const BLOCK_TEXT: Record<Block, string> = {
  day: "这天我来不了。",
  late: "这个时间我赶不上。",
  floorTime: "我这边有条底线，时间上动不了。",
  floorDiet: "吃的方面我有条底线，这家不行。",
  floorOther: "我有条底线，这个方案碰到了。",
  money: "这家的价格超出我能接受的了。",
  soft: "这个方案我不太满意。",
};

const isFloorBlock = (b: Block) => b === "floorTime" || b === "floorDiet" || b === "floorOther" || b === "day";

// ---------------------------------------------------------------- 文案小工具

/** k 个人：1 人说"有 1 位朋友"，否则说"k 位朋友" */
const friends = (k: number) => (k === 1 ? "有 1 位朋友" : `${k} 位朋友`);
const caredText = (cared: number, n: number) => (cared === n ? `${n} 个人都照顾到了` : `照顾到 ${cared}/${n}`);

/** 让步在公开记录里怎么说：只用公开体验里的数（晚到几分钟、能待多久），预算 / 通勤只说"松一点" */
function concedePhrase(dims: (keyof Give)[], c: Candidate, i: number): string {
  const e = c.pubs[i];
  const out: string[] = [];
  for (const k of dims) {
    if (k === "lateMin") out.push(`晚到 ${e.lateMin} 分钟我也来`);
    else if (k === "stayCutMin") out.push(`早点走也行，能待 ${e.stayMin} 分钟就来`);
    else if (k === "budgetUp") out.push("价格上我可以松一点");
    else out.push("路上远一点我也能接受");
  }
  return `${out.join("，")}——在授权范围内。`;
}

function tradePhrase(dims: (keyof Give)[], c: Candidate, i: number): string {
  const k = dims[0];
  if (k === "lateMin") return `晚到 ${c.pubs[i].lateMin} 分钟`;
  if (k === "stayCutMin") return "早走一点";
  if (k === "budgetUp") return "多花一点";
  return "多走一点路";
}

const dimsOf = (u: GiveUse) => GIVE_DIMS.filter((k) => (u.used[k] ?? 0) > 0);

function whereText(c: Candidate, p?: Proposal): string {
  const segs = p?.segments ?? c.segments;
  if (segs && segs.length >= 1 && (segs.length >= 2 || c.program)) {
    return segs.map((s, k) => `${k === 0 ? slotLabel(s.start) : minToHm(slotTimes({ id: "", start: s.start, end: s.end }).start)} ${s.activityName}（${s.poi.name}）`).join(" → ");
  }
  return `${slotLabel(c.slot.start)} 在${c.poi.name}`;
}

// ---------------------------------------------------------------- 交换

/**
 * 交换：推荐方案里两个人在不同维度各用了一点 give，而且缺一不可——
 * 在所有至少照顾到同样多人的候选里，找不到其中任何一个人可以不让步的。最多 2 对。
 */
export function findTrades(rec: Candidate, pool: Candidate[], given: Given): [GiveUse, GiveUse][] {
  const uses = given.uses.get(rec) ?? [];
  if (uses.length < 2) return [];
  const necessary = (u: GiveUse) =>
    !pool.some((c) => c !== rec && c.cared >= rec.cared && !c.vetoed && !(given.uses.get(c) ?? []).some((x) => x.i === u.i));
  // 规范顺序：按让步的维度和量排（不按成员）
  const key = (u: GiveUse) => `${dimsOf(u).join(",")}|${GIVE_DIMS.map((k) => String(u.used[k] ?? 0).padStart(4, "0")).join(",")}`;
  const cand = uses.filter(necessary).sort((x, y) => cmpStr(key(x), key(y)));
  const out: [GiveUse, GiveUse][] = [];
  const used = new Set<number>();
  for (let x = 0; x < cand.length && out.length < 2; x++) {
    if (used.has(cand[x].i)) continue;
    for (let y = x + 1; y < cand.length; y++) {
      if (used.has(cand[y].i)) continue;
      if (dimsOf(cand[x])[0] === dimsOf(cand[y])[0]) continue;
      out.push([cand[x], cand[y]]);
      used.add(cand[x].i);
      used.add(cand[y].i);
      break;
    }
  }
  return out;
}

// ---------------------------------------------------------------- 主流程

export type NegotiateInput = {
  /** 原始在局成员（授权书、心情、问过的问题都在这里） */
  members: Member[];
  /** 规划用的有效成员（planMember），和候选一一对应 */
  planMembers: Member[];
  /** 不让步时的推荐（第 1 轮讲它） */
  baseRec: Candidate;
  /** 不让步时的候选池（第 1 轮里亮底线用：底线把哪些方案排除了） */
  basePool: Candidate[];
  /** 启用 give 之后的候选 */
  given: Given;
  pool: Candidate[];
  /** 最终推荐（启用 give 之后按三级准则的第一名） */
  rec: Candidate;
  /** 推荐方案（两段式时有 segments） */
  proposal?: Proposal;
  asks: AskDraft[];
  diagnosis?: Diagnosis;
  why: string[];
  /** programs：v6 活动层的节目数（有节目时按"节目 × 开始时间"说） */
  counts: { slots: number; pois: number; programs?: number };
  now: Date;
};

export type NegotiateResult = {
  negotiation: Negotiation;
  /** memberId -> 分身替本人做的事（这次重新生成的部分；撤回过的、问过的问题由服务端保留） */
  logs: Record<string, AvatarLogEntry[]>;
  /** 这次自动让了步的人（服务端记进让步账：下次局里优先照顾、少找他让步） */
  conceded: string[];
};

export function negotiate(input: NegotiateInput): NegotiateResult {
  const { members, planMembers, baseRec, basePool, given, pool, rec, proposal, asks, diagnosis, why, counts } = input;
  const n = members.length;
  const idxOf = new Map(members.map((m, i) => [m.id, i]));
  const uses = given.uses.get(rec) ?? [];
  const askedIdx = asks.map((a) => idxOf.get(a.memberId)).filter((i): i is number => i !== undefined);
  const yesIdx = members.map((m, i) => ((m.private?.asks ?? []).some((a) => a.status === "yes") ? i : -1)).filter((i) => i >= 0);
  const trades = findTrades(rec, pool, given);
  const segs = proposal?.segments && proposal.segments.length >= 2 ? proposal.segments : undefined;

  // ---- 第 0 轮：交底（密封，只说聚合数）
  const r0: RoundDrafts = { head: [], body: [], foot: [] };
  const withFloors = members.filter((m) => splitFloors(m).floors.length > 0).length;
  const withGive = members.filter((m) => hasGive(giveInEffect(m))).length;
  const drafts = members.filter((m) => m.private?.mandate?.status !== "confirmed").length;
  const styleCount = (st: string) => members.filter((m) => m.private?.mandate?.status === "confirmed" && m.private.mandate.style === st).length;
  const easy = styleCount("easy");
  const firm = styleCount("firm");
  r0.head.push(
    boss(
      0,
      "open",
      `${n} 个分身交了授权书（密封，局长只用不说）：` +
        [
          withFloors ? `其中 ${withFloors} 个有底线` : "没有人有底线",
          withGive ? `${withGive} 个授权了可以让一点` : "",
          easy || firm ? [easy ? `${easy} 个很随和` : "", firm ? `${firm} 个很坚持` : ""].filter(Boolean).join("、") : "",
        ]
          .filter(Boolean)
          .join("，") +
        "。",
    ),
  );
  if (drafts) r0.head.push(boss(0, "open", `${drafts === n ? "大家" : `${drafts} 个分身`}还没确认授权书：只守底线、不替本人让步。`));
  const moods = new Map<Mood, number>();
  for (const m of members) if (m.private?.mood) moods.set(m.private.mood, (moods.get(m.private.mood) ?? 0) + 1);
  const moodOrder: Mood[] = ["hype", "chill", "active", "lazy"];
  const named = moodOrder.filter((k) => (moods.get(k) ?? 0) >= 2).map((k) => `${moods.get(k)} 位${MOOD_TEXT[k].replace(/^这次/, "")}`);
  const single = moodOrder.some((k) => moods.get(k) === 1);
  if (named.length) r0.head.push(boss(0, "open", `这次的状态：${[...named, single ? "另外有人有自己的状态" : ""].filter(Boolean).join("，")}。`));
  else if (single) r0.head.push(boss(0, "open", "这次大家的状态各有各的。"));

  // ---- 第 1 轮：出方案（不让步时最好的那个）+ 卡点
  const r1: RoundDrafts = { head: [], body: [], foot: [] };
  r1.head.push(
    boss(
      1,
      "propose",
      `算了 ${counts.programs ? `${counts.programs} 个节目 × ${counts.slots} 个开始时间` : `${counts.slots} 个时段 × ${counts.pois} 家店`} × ${n} 个人。先不让步，最好的是${whereText(baseRec)}：${caredText(baseRec.cared, n)}。`,
    ),
  );
  const baseBlocked = planMembers.map((_, i) => i).filter((i) => !baseRec.mines[i].cared);
  for (const i of baseBlocked) r1.body.push(avatar(1, i, "block", BLOCK_TEXT[blockOf(planMembers[i], baseRec, i)]));
  // 底线把一部分方案排除了的分身也亮一下底线（只说类别："时间上动不了"）
  planMembers.forEach((m, i) => {
    if (baseBlocked.includes(i) || !splitFloors(members[i]).floors.length) return;
    const hit = new Set<Block>();
    for (const c of basePool) {
      if (c.mines[i].cared) continue;
      const b = blockOf(m, c, i);
      if (b === "floorTime" || b === "floorDiet" || b === "floorOther") hit.add(b);
    }
    for (const b of ["floorTime", "floorDiet", "floorOther"] as Block[]) if (hit.has(b)) r1.body.push(avatar(1, i, "block", BLOCK_TEXT[b]));
  });
  if (baseBlocked.length) {
    const rs = reasonsFor(baseRec);
    r1.foot.push(boss(1, "propose", `卡在：${rs.join("，")}。看看谁能让一小步。`));
  } else {
    // 两段式不让步就照顾到了所有人：把"只玩一样最多照顾到几个"摆出来，讲清楚局长是怎么做到的（只有人数）
    const bestOne = baseRec.segments?.length === 2 ? Math.max(0, ...basePool.filter((c) => (c.segments?.length ?? 1) < 2).map((c) => c.cared)) : baseRec.cared;
    r1.foot.push(
      boss(
        1,
        "propose",
        bestOne < baseRec.cared
          ? `只玩一样的话最多照顾到 ${bestOne}/${n}；拆成两段——晚到的直接来第二段，要早走的玩完第一段再走——不用谁让步。`
          : "不用谁让步。",
      ),
    );
  }

  // ---- 第 2 轮：让步
  const r2: RoundDrafts = { head: [], body: [], foot: [] };
  const changed = rec.slot.id !== baseRec.slot.id || rec.poi.id !== baseRec.poi.id;
  if (changed && (uses.length || askedIdx.length)) r2.head.push(boss(2, "propose", `换个方案：${whereText(rec, proposal)}——这样只要有人让一小步。`));
  if (yesIdx.length) r2.head.push(boss(2, "concede", `之前私下问过的${friends(yesIdx.length)}答应让一步，已经算进去了。`));
  for (const u of uses) r2.body.push(avatar(2, u.i, "concede", concedePhrase(dimsOf(u), rec, u.i)));
  for (const i of askedIdx) r2.body.push(avatar(2, i, "ask", "再往下就超出我的授权了，我去问问本人。"));
  const stuck = planMembers.map((_, i) => i).filter((i) => !rec.mines[i].cared && !askedIdx.includes(i));
  const floorStuck = stuck.filter((i) => isFloorBlock(blockOf(planMembers[i], rec, i))).length;
  if (floorStuck) r2.foot.push(boss(2, "block", `${friends(floorStuck)}卡在底线上——底线不谈，不去问，换别的办法。`));
  if (stuck.length - floorStuck > 0) r2.foot.push(boss(2, "block", `还有 ${stuck.length - floorStuck} 位朋友这次实在照顾不到，局长先记下。`));
  for (const sg of diagnosis?.suggestions ?? []) r2.foot.push(boss(2, "propose", `建议发起人：${sg}。`));
  if (uses.length || changed || askedIdx.length) {
    r2.foot.push(
      boss(
        2,
        "decide",
        `那就${whereText(rec, proposal)}，${caredText(rec.cared, n)}` + (askedIdx.length ? `；等 ${askedIdx.length} 位朋友回复，答应了就自动重算。` : "。"),
      ),
    );
  } else r2.foot.push(boss(2, "decide", "这一轮没人需要让步。"));

  // ---- 第 3 轮：交换与补偿
  const r3: RoundDrafts = { head: [], body: [], foot: [] };
  for (const [x, y] of trades) {
    r3.body.push(boss(3, "trade", { a: x.i }, ` ${tradePhrase(dimsOf(x), rec, x.i)}，`, { a: y.i }, ` ${tradePhrase(dimsOf(y), rec, y.i)}——两人各让一小步，换来两个人都能来。`));
  }
  const concededIdx = [...new Set([...uses.map((u) => u.i), ...yesIdx])];
  if (concededIdx.length) {
    const k = concededIdx.length;
    const who = k === 1 ? "有 1 位朋友让了步" : `${k} 位朋友让了步`;
    r3.foot.push(
      boss(
        3,
        "compensate",
        segs ? `${who}：第二段「${segs[1].activityName}」优先照顾让过步的朋友的口味。` : `${who}：记进让步账，下次局里优先照顾，也少找${k === 1 ? "他" : "他们"}让步。`,
      ),
    );
  }
  const uncared = n - rec.cared - askedIdx.length;
  if (uncared > 0) r3.foot.push(boss(3, "compensate", `这次没照顾到的${uncared === 1 ? "那位朋友" : ` ${uncared} 位朋友`}记进公平账本，下次优先。`));
  if (!trades.length && !concededIdx.length && uncared <= 0) r3.foot.push(boss(3, "compensate", "这次没人让步，不用交换，也不用补偿。"));

  // ---- 第 4 轮：拍板
  const r4: RoundDrafts = { head: [], body: [], foot: [] };
  r4.head.push(boss(4, "decide", `拍板：${whereText(rec, proposal)}，${rec.attend} 人到场。`));
  if (why.length) r4.head.push(boss(4, "decide", `为什么：${why.join("；")}。`));
  r4.foot.push(boss(4, "decide", "每个分身会私下告诉本人：你得到了什么、替你让了什么、为什么。"));

  const events = render([r0, r1, r2, r3, r4]);
  const autoConcessions = uses.length;
  const outcome =
    `${n} 个分身谈了 ${NEGOTIATION_ROUNDS} 轮：` +
    [
      autoConcessions ? `${autoConcessions} 次自动让步` : "",
      trades.length ? `${trades.length} 次交换` : "",
      askedIdx.length ? `私下问了 ${askedIdx.length} 位` : "",
    ]
      .filter(Boolean)
      .join("、") +
    (autoConcessions || trades.length || askedIdx.length ? "，" : "没人需要让步，") +
    caredText(rec.cared, n);

  return {
    negotiation: { events, autoConcessions, asked: askedIdx.length, trades: trades.length, outcome },
    logs: privateLogs(input, uses, segs, concededIdx),
    conceded: uses.map((u) => u.memberId),
  };
}

// ---------------------------------------------------------------- 本人视图

const entryId = (kind: string, text: string, dim?: string) => `av-${kind}${dim ? `-${dim}` : ""}-${sha256Hex(text).slice(0, 8)}`;

function entry(kind: AvatarLogEntry["kind"], text: string, at: string, dim?: keyof Give): AvatarLogEntry {
  return { id: entryId(kind, text, dim), at, kind, text, ...(dim ? { dim } : {}) };
}

/** 每人私下的"分身替你做了什么"：你得到了什么 / 分身替你让了什么 / 为什么（可以用本人的私密细节，只给本人） */
function privateLogs(input: NegotiateInput, uses: GiveUse[], segs: Proposal["segments"], concededIdx: number[]): Record<string, AvatarLogEntry[]> {
  const { members, planMembers, rec, why } = input;
  const at = input.now.toISOString();
  const where = whereText(rec, input.proposal);
  const out: Record<string, AvatarLogEntry[]> = {};
  members.forEach((m, i) => {
    const log: AvatarLogEntry[] = [];
    const e = rec.pubs[i];
    const give = giveInEffect(m);
    const u = uses.find((x) => x.i === i);
    // 分身替你让了什么
    for (const k of u ? dimsOf(u) : []) {
      const v = u!.used[k]!;
      let text: string;
      if (k === "lateMin") text = `替你多让了 ${v} 分钟：${slotLabel(rec.slot.start)} 开始，你大约 ${e.arriveAt} 到（晚到 ${e.lateMin} 分钟），在你授权的 ${give.lateMin} 分钟以内`;
      else if (k === "stayCutMin")
        text = `替你少待了 ${v} 分钟：你大约能待 ${e.stayMin} 分钟${e.leaveAt ? `（${e.leaveAt} 得走）` : ""}，在你授权的 ${give.stayCutMin} 分钟以内`;
      else if (k === "budgetUp") {
        const b = m.private?.budgetMax ?? 0;
        const over = (rec.poi.costPerPerson ?? b) - b;
        text =
          over > v
            ? `替你多出了 ${v} 元（你授权的上限）：这家人均 ${rec.poi.costPerPerson}，比你说的 ${b} 多 ${over}，多出来的部分照常算进你的满意度`
            : `替你多出了 ${v} 元：这家人均 ${rec.poi.costPerPerson}，比你说的 ${b} 多 ${v}，在你授权的 ${give.budgetUp} 元以内`;
      } else text = `替你多走了 ${v} 分钟：路上 ${e.commuteMin} 分钟，在你授权的 ${give.commuteUp} 分钟以内`;
      log.push(entry("concede", text, at, k));
    }
    // 守住了什么
    const { floors } = splitFloors(m);
    if (floors.length) {
      const names = floors.map((f) => f.text).join("、");
      if (e.status !== "absent" && !rec.flags[i].hard) log.push(entry("held", `守住了你的底线：${names}`, at));
      else log.push(entry("held", `你的底线（${names}）和这次的方案碰上了，分身没有松口——底线不谈`, at));
    }
    // 你得到了什么
    if (e.status === "absent") {
      const b = blockOf(planMembers[i], rec, i);
      log.push(entry("gained", `这次的方案（${where}）你来不了：${b === "day" ? "那天你没空" : b === "floorTime" ? "能待的时间太短" : "时间凑不上"}。这次没照顾到你，下次你优先`, at));
    } else {
      // 用了预算授权时，结果里的"人均 X 以内"是放宽后的数，不拿来说（上面的让步记录已经说清楚了）
      const usedBudget = !!u && (u.used.budgetUp ?? 0) > 0;
      const got = rec.mines[i].needs
        .filter((r, k) => k > 0 && r.result === "met" && !(usedBudget && /^人均 \d+ 以内$/.test(r.text)) && r.detail !== "不是吃饭的地方")
        .slice(0, 3)
        .map((r) => (r.detail ? `${r.text}（${r.detail}）` : r.text));
      // 没顾上的也如实说（分身对本人报喜也报忧）；用了预算授权的超额上面的让步记录已经说了
      const missed = rec.mines[i].needs
        .filter((r, k) => k > 0 && (r.result === "unmet" || r.result === "partial") && !(usedBudget && /^人均 \d+ 以内$/.test(r.text)))
        .slice(0, 2)
        .map((r) => (r.detail ? `${r.text}（${r.detail}）` : r.text));
      const time = e.status === "full" ? "全程都在" : e.notes.join("，");
      log.push(
        entry(
          "gained",
          `你得到了：${where}，${time}${got.length ? `；${got.join("；")}` : ""}${missed.length ? `。没顾上的：${missed.join("；")}` : ""}${rec.mines[i].cared ? "" : "。这次没完全照顾到你，下次你优先"}`,
          at,
        ),
      );
    }
    // 补偿
    if (concededIdx.includes(i)) {
      log.push(entry("compensated", segs ? `你让了步：第二段「${segs[1].activityName}」优先照顾你的口味` : "你这次让了步，记进让步账：下次局里优先照顾你，也少找你让步", at));
    }
    // 为什么
    if (why.length) log.push(entry("gained", `为什么这么定：${why.join("；")}`, at));
    out[m.id] = log;
  });
  return out;
}

/** 给 A 的第二段挑店用：让过步的人口味权重更高（1.5），其余 1 */
export function compensationWeights(members: Member[], conceded: string[]): Record<string, number> {
  const set = new Set(conceded);
  return Object.fromEntries(members.map((m) => [m.id, set.has(m.id) ? 1.5 : 1]));
}

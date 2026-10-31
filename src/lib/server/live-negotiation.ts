// v6 实时分身谈判（docs/AVATAR.md 第 4 节）：局长主持秩序，分身们真的讨论、表态、让步，局长按规则统一结论。
// 议程：
//   0 交底：局长说聚合情况，每个分身各说一句开场（大模型，用自己的话）
//   1 方案讨论：局长讲卡点、摆出 2–3 个方案；分身们看着每个方案对自己主人怎么样（只有自己知道）和别人说了什么，
//      表态（支持 / 反对 / 愿意为它主动让一步）、说理由、互相回应；第二圈让意见不同的分身回应。
//      局长汇总：只在"一样公平"的方案之间（照顾到的人一样多、最吃亏的人损失差不多），选呼声最高的（deliberate.ts）。
//   2–4 让步 / 交换补偿 / 拍板：按选定方案的规则版议程点名，分身用自己的口吻说；超出授权时分身自己决定问不问主人。
// 结论由规则 + 讨论记录决定：同一份讨论记录（ju_private.live.stances）复算一定得到同一个结论；照顾人数和最吃亏的人由规则保底。
// 每说一句就追加进 plan.negotiation.events（status = live），大家实时看；说完 status = done，可以回看。
// 没有大模型 / 某一句不合规 / 超时：那一句用规则版的话（表态按本人的满意度）。整个任务出错或进程重启：补齐规则版记录。
import * as db from "../db";
import { avatarSpeak, guardAvatarSay, type AvatarTurn } from "../llm/avatarAgent";
import { currentProvider } from "../llm/provider";
import { deliberationPick, supportScores, type Stance } from "../planner/avatar/deliberate";
import { mandateOf } from "../planner/avatar/mandate";
import { whereText, type LiveOption } from "../planner/plan";
import type { AvatarStyle, Ju, Member, MyExperience, NegotiationEvent, Proposal } from "../types";
import { numbersIn, sensitiveOf } from "./firewall";
import { announceAt, applyAvatar, issueAsks } from "./ju-core";
import { loadJu, loadMembers, mutateJu, recordConcession } from "./ju";
import { getProfile } from "./profile";

/** 两句之间至少隔多久：太快大家看不过来 */
export const liveGapMs = () => Number(process.env.JUZHANG_LIVE_GAP_MS ?? 1100);
/** 单个分身一句话最多等多久，超时就用规则版 */
export const LIVE_SPEAK_TIMEOUT_MS = 9000;
/** 讨论第二圈最多让几个意见不同的分身回应 */
export const RESPOND_MAX = 3;

export function liveEnabled(): boolean {
  return process.env.JUZHANG_LIVE_NEGOTIATION !== "off" && currentProvider() !== "rules";
}

/**
 * 本进程里正在跑的谈判（juId:computedAt）：进程重启后不在这里 = 需要补齐。
 * 挂在 globalThis 上：Next 会给不同的路由各打包一份模块，模块级变量各是各的，别的路由会误以为谈判断了
 */
const running: Set<string> = ((globalThis as { __juLiveRunning?: Set<string> }).__juLiveRunning ??= new Set<string>());
export const isLiveRunning = (juId: string, computedAt: string) => running.has(`${juId}:${computedAt}`);

/** 出方案时调用（锁里）：登记后放到锁外跑 */
export function startLiveNegotiation(juId: string, computedAt: string): void {
  const key = `${juId}:${computedAt}`;
  if (running.has(key)) return;
  running.add(key);
  setTimeout(() => {
    void runLive(juId, computedAt)
      .catch(async (e) => {
        console.warn(`[live ${juId}] 实时谈判出错，补齐规则版：${(e as Error)?.message ?? e}`);
        await finishWithTemplate(juId, computedAt).catch(() => undefined);
      })
      .finally(() => running.delete(key));
  }, 0);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 没有大模型时的开场白：只看风格（风格的分布本来就公开在交底那句里） */
const OPEN_FALLBACK: Record<AvatarStyle, string> = {
  easy: "我都行，听大家的。",
  balanced: "我这边有几件要紧的，其余都好商量。",
  firm: "这次我有想要的，会争取一下。",
};

/**
 * 方案的公开摘要（讨论时大家都看得到）。方案页上"小林这个时间来不了"可以写名字，谈判记录里不行：
 * 前面分身刚说过"这个时间我赶不上"，名字一出现代号就对上人了。所以名字一律换成"有位朋友"
 */
function optionSummary(p: Proposal, names: string[]): string {
  let s = [whereText(p), p.headline, ...p.tradeoffs.slice(0, 2)].filter(Boolean).join("；");
  for (const n of [...names].sort((a, b) => b.length - a.length)) s = s.split(n).join("有位朋友");
  return s;
}

/** 这个方案对本人怎么样（只给他自己的分身看） */
function mineText(x: MyExperience | undefined): string {
  if (!x) return "不清楚";
  const mood = x.utility >= 80 ? "很满意" : x.utility >= 60 ? "还行" : "不太满意";
  return [x.cared === false ? "没完全照顾到你" : "能照顾到你", mood, ...x.notes.slice(0, 3)].join("；");
}

/**
 * 局长的汇总：讲清楚为什么定这个——听了大家的；或者呼声最高的那个为什么不能选（只用公开的人数：照顾到几个人）。
 * 讨论不能为了多数人的喜好让人照顾不到，这句话要说给大家听。
 */
function verdictText(a: {
  list: { no: number; id: string; label: string }[];
  options: LiveOption[];
  score: Record<string, number>;
  chosen: string;
  ruleChoice: string;
  propOf: (id: string) => Proposal;
  n: number;
  waiting: boolean;
  tally: string;
}): string {
  const label = (id: string) => a.list.find((o) => o.id === id)!.label;
  const lead = [...a.list].sort((x, y) => a.score[y.id] - a.score[x.id] || x.no - y.no)[0].id;
  const head = `大家的呼声：${a.tally}。`;
  if (a.chosen !== a.ruleChoice) return `${head}这几个方案照顾到的人一样多、最吃亏的人也差不多，就听大家的——按「${label(a.chosen)}」谈细节。`;
  if (lead === a.chosen) return `${head}「${label(a.chosen)}」呼声最高，也照顾得最周全，就按它谈细节。`;
  const rc = a.propOf(a.ruleChoice).cared;
  const lc = a.propOf(lead).cared;
  if (lc !== undefined && rc !== undefined && lc < rc)
    return `${head}「${label(lead)}」呼声最高，但它只照顾到 ${lc}/${a.n}，「${label(a.ruleChoice)}」能照顾到 ${rc}/${a.n}——不能为了多数人的喜好让人照顾不到，就按「${label(a.ruleChoice)}」谈细节。`;
  if (a.waiting) return `${head}「${label(lead)}」呼声最高，不过还有朋友在等本人回复，先按照顾得最周全的「${label(a.ruleChoice)}」谈；回复回来会再算一遍。`;
  return `${head}「${label(lead)}」呼声最高，但会让最吃亏的那位朋友更吃亏，就按「${label(a.ruleChoice)}」谈细节。`;
}

/** 规则版议程里的代号换成这一场的代号（备选方案的议程是单独算的，代号可能不一样） */
function remap(text: string, from: Record<string, string>, to: Record<string, string>): string {
  const byCode = new Map(Object.entries(from).map(([mid, code]) => [code, to[mid] ?? code]));
  return text.replace(/分身 (?:Z\d+|[A-Z])/g, (c) => byCode.get(c) ?? c);
}

async function runLive(juId: string, computedAt: string): Promise<void> {
  const job = db.getJuPrivate(juId).live;
  if (!job || job.computedAt !== computedAt) return;
  const ju0 = loadJu(juId);
  const members = loadMembers(juId);
  const mine = db.getJuPrivate(juId).mine;
  const byId = new Map(members.map((m) => [m.id, m]));
  const sens = sensitiveOf(ju0, members);
  const names = members.flatMap((m) => [m.name, (m.profileId && getProfile(m.profileId)?.avatarName) || ""]).filter((s) => s.trim().length >= 2);
  // 数字只能来自这一句要表达的意思（规则版那句话 / 公开的方案摘要）：分身不能改数，开场白里不能有数
  const guard = (text: string, intent: string) => guardAvatarSay(text, { names, notes: sens.notes, allowedNumbers: numbersIn(intent) });
  const proposals = ju0.plan?.proposals ?? [];
  const options: LiveOption[] = (job.options ?? [{ proposalId: proposals[0]?.id ?? "", fair: true }]).filter((o) => proposals.some((p) => p.id === o.proposalId));
  const propOf = (id: string) => proposals.find((p) => p.id === id)!;
  const codes = job.codes;

  const said: NegotiationEvent[] = [];
  let last = 0;
  // 兜底：公开记录里任何一句出现名字（真名 / 分身名）都换成"有位朋友"——代号不能被名字对上
  const byLength = [...names].sort((a, b) => b.length - a.length);
  const anon = (t: string) => byLength.reduce((s, x) => s.split(x).join("有位朋友"), t);
  const push = async (raw: NegotiationEvent): Promise<boolean> => {
    const e = { ...raw, text: anon(raw.text) };
    const wait = last + liveGapMs() - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    return mutateJu(juId, (ctx) => {
      const neg = ctx.ju.plan?.negotiation;
      // 谈判期间又出了新方案（有人改了情况）：这一场作废，新的那场接着谈
      if (!neg || ctx.ju.plan!.computedAt !== computedAt || neg.status !== "live") {
        ctx.save = false;
        return false;
      }
      neg.events.push(e);
      said.push(e);
      return true;
    });
  };
  /** fellBack = 这句没用分身自己的话（大模型没回 / 不合规），调用方可以按分身的表态重写兜底句 */
  const speak = async (m: Member, turn: AvatarTurn, fallback: string, intent: string) => {
    try {
      const r = await avatarSpeak({ code: codes[m.id], view: mandateOf(m), mood: m.private?.mood, context: said, turn }, LIVE_SPEAK_TIMEOUT_MS);
      const ok = guard(r.say, intent);
      return { ...r, say: ok ?? fallback, fellBack: !ok };
    } catch {
      return { say: fallback, fellBack: true } as Awaited<ReturnType<typeof avatarSpeak>> & { fellBack: boolean };
    }
  };

  const tpl = job.template.events;
  // ---- 0 交底 + 开场
  let i = 0;
  while (i < tpl.length && tpl[i].round === 0) if (!(await push(tpl[i++]))) return;
  const talkers = members.filter((m) => codes[m.id] && m.status === "in" && m.private?.rsvp !== "no").sort((a, b) => (codes[a.id] < codes[b.id] ? -1 : 1));
  const openings = await Promise.all(talkers.map((m) => speak(m, { kind: "open" }, OPEN_FALLBACK[mandateOf(m).style], "")));
  for (let k = 0; k < talkers.length; k++) if (!(await push({ round: 0, speaker: codes[talkers[k].id], kind: "open", text: openings[k].say }))) return;

  // ---- 1 方案讨论：先讲卡点（规则版第 1 轮），再摆方案、大家表态
  while (i < tpl.length && tpl[i].round === 1) {
    const who = job.speakers[i];
    const m = who ? byId.get(who) : undefined;
    const e = tpl[i++];
    const text = m ? (await speak(m, { kind: "say", eventKind: e.kind, intent: e.text }, e.text, e.text)).say : e.text;
    if (!(await push({ ...e, text }))) return;
  }
  const list = options.map((o, k) => ({ no: k + 1, id: o.proposalId, label: propOf(o.proposalId).labelText, summary: optionSummary(propOf(o.proposalId), names) }));
  const publicNums = list.map((o) => `${o.summary} ${o.no}`).join(" ");
  if (list.length > 1) {
    if (!(await push({ round: 1, speaker: "局长", kind: "propose", text: `把能让一小步的情况都算进去，有 ${list.length} 个方案：` }))) return;
    for (const o of list) if (!(await push({ round: 1, speaker: "局长", kind: "propose", text: `方案 ${o.no}「${o.label}」：${o.summary}` }))) return;
    if (!(await push({ round: 1, speaker: "局长", kind: "propose", text: "各位分身说说看：支持哪个、为什么？" }))) return;
  } else if (!(await push({ round: 1, speaker: "局长", kind: "propose", text: `就一个方案照顾得最好：${list[0]?.summary ?? ""}。各位分身有什么看法？` }))) return;

  const stances = new Map<string, Stance>();
  const argue = async (m: Member, respond: boolean) => {
    const turnOpts = list.map((o) => ({ no: o.no, label: o.label, summary: o.summary, mine: mineText(mine[m.id]?.find((x) => x.proposalId === o.id)) }));
    // 没有大模型时：按本人在各方案里的满意度表态
    const best = [...list].sort((a, b) => (mine[m.id]?.find((x) => x.proposalId === b.id)?.utility ?? 0) - (mine[m.id]?.find((x) => x.proposalId === a.id)?.utility ?? 0))[0];
    const r = await speak(m, { kind: "argue", options: turnOpts, respond }, `我更倾向方案 ${best.no}「${best.label}」。`, publicNums);
    const support = list.find((o) => o.no === (r.support ?? best.no))!;
    const oppose = r.oppose ? list.find((o) => o.no === r.oppose) : undefined;
    stances.set(m.id, { code: codes[m.id], support: support.id, ...(oppose ? { oppose: oppose.id } : {}), ...(r.offer ? { offer: true } : {}) });
    // 兜底句跟着真实的表态写（不能说支持 1、票投给 2）
    const text = r.fellBack ? `${respond ? "我还是" : "我"}支持方案 ${support.no}「${support.label}」${r.offer ? "，为它我可以让一步" : ""}。` : r.say;
    return push({ round: 1, speaker: codes[m.id], kind: "argue", text });
  };
  for (const m of talkers) if (!(await argue(m, false))) return;
  // 第二圈：和多数人意见不同的分身（支持的不是呼声最高的那个），挑几个回应（可以坚持，也可以改主意）
  if (list.length > 1) {
    const sc = supportScores(list.map((o) => o.id), [...stances.values()]);
    const lead = [...list].sort((a, b) => sc[b.id] - sc[a.id] || a.no - b.no)[0].id;
    const dissent = talkers.filter((m) => stances.get(m.id)?.support !== lead).slice(0, RESPOND_MAX);
    for (const m of dissent) if (!(await argue(m, true))) return;
  }
  const finalStances = [...stances.values()];
  const { chosen, score } = deliberationPick(options, finalStances);
  const ruleChoice = options[0].proposalId;
  const tally = list.map((o) => `「${o.label}」${score[o.id] > 0 ? "+" : ""}${score[o.id]}`).join("、");
  const verdict = verdictText({ list, options, score, chosen, ruleChoice, propOf, n: talkers.length, waiting: job.asks.length > 0, tally });
  if (!(await push({ round: 1, speaker: "局长", kind: "decide", text: verdict }))) return;

  // ---- 2–4 按选定方案的议程：让步 / 交换补偿 / 拍板
  const opt = options.find((o) => o.proposalId === chosen)!;
  const talk = chosen === ruleChoice ? { negotiation: job.template, speakers: job.speakers, codes } : opt.talk!;
  const ev = talk.negotiation.events;
  const declined: string[] = [];
  const asks = chosen === ruleChoice ? job.asks : [];
  for (let k = 0; k < ev.length; k++) {
    if (ev[k].round < 2) continue;
    const e = { ...ev[k], speaker: ev[k].speaker === "局长" ? "局长" : remap(ev[k].speaker, talk.codes, codes), text: remap(ev[k].text, talk.codes, codes) };
    const who = talk.speakers[k];
    const m = who ? byId.get(who) : undefined;
    if (!m) {
      const left = asks.length - declined.length;
      const text = declined.length ? e.text.replace(/；等 \d+ 位朋友回复，答应了就自动重算。/, left > 0 ? `；等 ${left} 位朋友回复，答应了就自动重算。` : "。") : e.text;
      if (!(await push({ ...e, text }))) return;
      continue;
    }
    if (e.kind === "ask") {
      const draft = asks.find((a) => a.memberId === m.id);
      if (!draft) {
        if (!(await push(e))) return;
        continue;
      }
      const r = await speak(m, { kind: "ask", request: draft.text, floorRelated: false }, e.text, e.text);
      if (r.action === "decline") declined.push(m.id);
      if (!(await push({ ...e, text: r.say }))) return;
      if (r.action !== "decline")
        await mutateJu(juId, (ctx) => {
          if (ctx.ju.plan?.computedAt !== computedAt) return void (ctx.save = false);
          issueAsks(ctx.members.filter((x) => x.status === "in"), [draft], ctx.now);
        });
      continue;
    }
    const r = await speak(m, { kind: "say", eventKind: e.kind, intent: e.text }, e.text, e.text);
    if (!(await push({ ...e, text: r.say }))) return;
  }

  // ---- 谈完：定下的方案写回去（改选了就换推荐），"分身替你做了什么"按定下的方案写，status = done
  await mutateJu(juId, (ctx) => {
    const plan = ctx.ju.plan;
    const neg = plan?.negotiation;
    if (!plan || !neg || plan.computedAt !== computedAt) return void (ctx.save = false);
    const idx = plan.proposals.findIndex((p) => p.id === chosen);
    if (idx > 0) {
      const [c] = plan.proposals.splice(idx, 1);
      plan.proposals.unshift(c);
      plan.proposals.forEach((p, k) => (p.recommended = k === 0));
      if (opt.talk?.why.length) plan.why = opt.talk.why;
      plan.recommendation = `推荐「${c.labelText}」：${whereText(c)}。${(plan.why ?? []).join("；")}（分身们讨论后选的）`;
      announceAt(ctx.ju, `🗣 分身们讨论后，局长改推荐「${c.labelText}」：${whereText(c)}。点链接看谈判过程、投一票～`, ctx.now);
    }
    plan.discussion = { ruleChoice, chosen, support: score };
    const tn = talk.negotiation;
    neg.autoConcessions = tn.autoConcessions;
    neg.trades = tn.trades;
    neg.asked = Math.max(0, (chosen === ruleChoice ? tn.asked : 0) - declined.length);
    neg.outcome = `${tn.outcome.replace(/、?私下问了 \d+ 位/, neg.asked ? `、私下问了 ${neg.asked} 位` : "").replace(/：、/, "：")}${idx > 0 ? "（讨论后改选）" : ""}`;
    neg.status = "done";
    const ins = ctx.members.filter((m) => m.status === "in");
    const logs = chosen === ruleChoice ? (job.options?.[0]?.talk ?? opt.talk) : opt.talk;
    if (logs) applyAvatar(ctx.ju, ins, { logs: logs.logs, conceded: logs.conceded }, ctx.now, recordConcession);
    if (ctx.priv.live?.computedAt === computedAt) ctx.priv.live = { ...ctx.priv.live, stances: finalStances, chosen };
  });
}

/** 补齐：用规则版的完整记录收尾，没发出去的"问主人"按规则版照常发（大模型挂了 / 进程重启） */
export async function finishWithTemplate(juId: string, computedAt: string): Promise<void> {
  await mutateJu(juId, (ctx) => finishLocked(ctx.ju, ctx.members, ctx.priv, computedAt, ctx.now) || void (ctx.save = false));
}

/** 锁里用：这一场还停在 live、但本进程没在跑（重启过）→ 补齐规则版（推荐方案不变）。返回是否改了 */
export function finishLocked(ju: Ju, members: Member[], priv: db.JuPrivate, computedAt: string, now: Date): boolean {
  const neg = ju.plan?.negotiation;
  if (!neg || ju.plan!.computedAt !== computedAt || neg.status !== "live") return false;
  const job = priv.live?.computedAt === computedAt ? priv.live : undefined;
  if (job) {
    neg.events = job.template.events;
    const ins = members.filter((m) => m.status === "in");
    const asked = new Set(members.flatMap((m) => ((m.private?.asks ?? []).some((a) => a.status === "pending") ? [m.id] : [])));
    issueAsks(ins.filter((m) => !asked.has(m.id)), job.asks, now);
    const rec = job.options?.[0]?.talk;
    if (rec) applyAvatar(ju, ins, { logs: rec.logs, conceded: rec.conceded }, now, recordConcession);
  }
  neg.status = "done";
  return true;
}

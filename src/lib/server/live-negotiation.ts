// v6 实时分身谈判（docs/AVATAR.md 第 4 节）：局长主持秩序，分身们真的一句句说。
// 出方案时规则已经算好了结论和每一步的意思（planJu → negotiate 的规则版记录）；这里按那份议程点名：
//   局长的话照规则版说（主持、摆方案、拍板）；轮到分身时，叫那个分身的智能体用自己的口吻说出来；
//   第 0 轮每个分身各说一句开场；超出授权的请求由分身自己决定私下问主人还是替主人婉拒。
// 每说一句就追加进 plan.negotiation.events（status = live），大家的手机和大屏轮询着实时看；说完 status = done，可以回看。
// 结论不由对话决定：能不能让、让多少由规则算（授权范围内必须同意），所以同样的输入还是同样的结论；变的只是措辞。
// 没有大模型 / 某一句不合规 / 超时：那一句用规则版的话。整个任务出错或进程重启：直接补齐规则版记录。
import * as db from "../db";
import { avatarSpeak, guardAvatarSay, type AvatarTurn } from "../llm/avatarAgent";
import { currentProvider } from "../llm/provider";
import { mandateOf } from "../planner/avatar/mandate";
import type { AvatarStyle, Ju, Member, NegotiationEvent } from "../types";
import { numbersIn, sensitiveOf } from "./firewall";
import { issueAsks } from "./ju-core";
import { loadJu, loadMembers, mutateJu } from "./ju";
import { getProfile } from "./profile";

/** 两句之间至少隔多久：太快大家看不过来 */
export const liveGapMs = () => Number(process.env.JUZHANG_LIVE_GAP_MS ?? 1100);
/** 单个分身一句话最多等多久，超时就用规则版 */
export const LIVE_SPEAK_TIMEOUT_MS = 9000;

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

async function runLive(juId: string, computedAt: string): Promise<void> {
  const job = db.getJuPrivate(juId).live;
  if (!job || job.computedAt !== computedAt) return;
  const ju0 = loadJu(juId);
  const members = loadMembers(juId);
  const byId = new Map(members.map((m) => [m.id, m]));
  const sens = sensitiveOf(ju0, members);
  const names = members.flatMap((m) => [m.name, (m.profileId && getProfile(m.profileId)?.avatarName) || ""]).filter((s) => s.trim().length >= 2);
  // 数字只能来自这一句要表达的意思（规则版那句话）：分身不能改数，开场白里不能有数
  const guard = (text: string, intent: string) => guardAvatarSay(text, { names, notes: sens.notes, allowedNumbers: numbersIn(intent) });

  const said: NegotiationEvent[] = [];
  let last = 0;
  const push = async (e: NegotiationEvent): Promise<boolean> => {
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
  const speak = async (m: Member, turn: AvatarTurn, fallback: string): Promise<{ say: string; action?: "ask_owner" | "decline" }> => {
    try {
      const r = await avatarSpeak({ code: job.codes[m.id], view: mandateOf(m), mood: m.private?.mood, context: said, turn }, LIVE_SPEAK_TIMEOUT_MS);
      return { say: guard(r.say, turn.kind === "say" ? turn.intent : fallback) ?? fallback, ...(r.action ? { action: r.action } : {}) };
    } catch {
      return { say: fallback };
    }
  };

  const tpl = job.template.events;
  let i = 0;
  // 第 0 轮：局长交底，然后每个分身各说一句开场（一起生成，按代号顺序一句句放出来）
  while (i < tpl.length && tpl[i].round === 0) if (!(await push(tpl[i++]))) return;
  const openers = members
    .filter((m) => job.codes[m.id] && m.status === "in" && m.private?.rsvp !== "no")
    .sort((a, b) => (job.codes[a.id] < job.codes[b.id] ? -1 : 1));
  const openings = await Promise.all(openers.map((m) => speak(m, { kind: "open" }, OPEN_FALLBACK[mandateOf(m).style])));
  for (let k = 0; k < openers.length; k++) if (!(await push({ round: 0, speaker: job.codes[openers[k].id], kind: "open", text: openings[k].say }))) return;

  // 第 1–4 轮：按议程点名
  const declined: string[] = [];
  for (; i < tpl.length; i++) {
    const e = tpl[i];
    const who = job.speakers[i];
    const m = who ? byId.get(who) : undefined;
    if (!m) {
      // 局长的话：有分身替主人婉拒了，"等 N 位朋友回复"跟着改
      const asked = job.asks.length - declined.length;
      const text = declined.length ? e.text.replace(/；等 \d+ 位朋友回复，答应了就自动重算。/, asked > 0 ? `；等 ${asked} 位朋友回复，答应了就自动重算。` : "。") : e.text;
      if (!(await push({ ...e, text }))) return;
      continue;
    }
    if (e.kind === "ask") {
      const draft = job.asks.find((a) => a.memberId === m.id);
      if (!draft) {
        if (!(await push(e))) return;
        continue;
      }
      const r = await speak(m, { kind: "ask", request: draft.text, floorRelated: false }, e.text);
      if (r.action === "decline") declined.push(m.id);
      if (!(await push({ ...e, text: r.say }))) return;
      // 分身决定去问主人：私信马上发出去（主人答应了就自动重算）
      if (r.action !== "decline")
        await mutateJu(juId, (ctx) => {
          if (ctx.ju.plan?.computedAt !== computedAt) return void (ctx.save = false);
          issueAsks(ctx.members.filter((x) => x.status === "in"), [draft], ctx.now);
        });
      continue;
    }
    const r = await speak(m, { kind: "say", eventKind: e.kind, intent: e.text }, e.text);
    if (!(await push({ ...e, text: r.say }))) return;
  }

  // 谈完：status = done（可以回看）；有分身替主人婉拒的，聚合数字跟着改
  await mutateJu(juId, (ctx) => {
    const neg = ctx.ju.plan?.negotiation;
    if (!neg || ctx.ju.plan!.computedAt !== computedAt) return void (ctx.save = false);
    neg.status = "done";
    if (declined.length) {
      neg.asked = Math.max(0, neg.asked - declined.length);
      neg.outcome = neg.outcome.replace(/、?私下问了 \d+ 位/, neg.asked ? `、私下问了 ${neg.asked} 位` : "").replace(/：、/, "：");
    }
    if (ctx.priv.live?.computedAt === computedAt) delete ctx.priv.live;
  });
}

/** 补齐：用规则版的完整记录收尾，没发出去的"问主人"按规则版照常发（大模型挂了 / 进程重启） */
export async function finishWithTemplate(juId: string, computedAt: string): Promise<void> {
  await mutateJu(juId, (ctx) => finishLocked(ctx.ju, ctx.members, ctx.priv, computedAt, ctx.now) || void (ctx.save = false));
}

/** 锁里用：这一场还停在 live、但本进程没在跑（重启过）→ 补齐。返回是否改了 */
export function finishLocked(ju: Ju, members: Member[], priv: db.JuPrivate, computedAt: string, now: Date): boolean {
  const neg = ju.plan?.negotiation;
  if (!neg || ju.plan!.computedAt !== computedAt || neg.status !== "live") return false;
  const job = priv.live?.computedAt === computedAt ? priv.live : undefined;
  if (job) {
    neg.events = job.template.events;
    const asked = new Set(members.flatMap((m) => ((m.private?.asks ?? []).some((a) => a.status === "pending") ? [m.id] : [])));
    issueAsks(members.filter((m) => m.status === "in" && !asked.has(m.id)), job.asks, now);
    delete priv.live;
  }
  neg.status = "done";
  return true;
}

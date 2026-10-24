"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { BillSplit, GroupMessages, JuState, Proposal, Receipt } from "@/lib/types";
import { compressImage } from "@/lib/client/image";
import { store } from "@/lib/client/storage";
import { Button, RotatingText, Sheet, copyText } from "@/components/ui";
import { toast } from "@/components/toast";
import { InviteLinks } from "@/components/launch/InviteLinks";
import { confirmedProposal, slotLabel, voteTally, yuan } from "@/components/screen/fmt";
import { errMsg, organizerApi, type CreateResult, type OrganizerApi, type Payments } from "./api";
import { SimCall } from "./SimCall";

/** gallery 里换成假实现；默认是真接口 */
export const OrganizerApiContext = createContext<OrganizerApi>(organizerApi);

const PLAN_LINES = ["局长正在掐指一算…", "在帕累托前沿上挑方案…", "核对每个人的通勤…", "写审计哈希…"];

type Ctx = {
  state: JuState;
  admin: string;
  api: OrganizerApi;
  busy: string | null;
  run: (key: string, fn: () => Promise<void>) => () => Promise<void>;
  apply: (s: JuState) => void;
  refresh: () => Promise<void>;
};

/* ───────── 小积木 ───────── */
function Card({ title, hint, children, tone = "card" }: { title: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; tone?: "card" | "gold" }) {
  return (
    <section className={`rounded-[var(--radius-card)] border-2 border-ink p-3.5 ${tone === "gold" ? "bg-mustard-soft" : "bg-card"}`}>
      <div className="mb-2.5 flex items-baseline gap-2">
        <h4 className="text-[16px] font-black">{title}</h4>
        {hint && <span className="ml-auto text-right text-[12px] text-ink-faint">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Meter({ have, need, label }: { have: number; need: number; label?: string }) {
  const pct = need > 0 ? Math.min(100, (have / need) * 100) : 0;
  return (
    <div>
      <div className="relative h-3.5 overflow-hidden rounded-full border-2 border-ink bg-paper">
        <div className="absolute inset-y-0 left-0 bg-cinnabar transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>
      {label && <div className="mt-1 text-[12px] text-ink-soft">{label}</div>}
    </div>
  );
}

function CopyBlock({ text, label = "复制", clamp }: { text: string; label?: string; clamp?: boolean }) {
  const [full, setFull] = useState(false);
  const long = !!clamp && text.split("\n").length + text.length / 40 > 4;
  return (
    <div>
      <p className={`whitespace-pre-wrap rounded-lg border-2 border-dashed border-line bg-paper px-3 py-2 text-[14px] leading-relaxed ${long && !full ? "line-clamp-3" : ""}`}>
        {text}
      </p>
      {long && (
        <button type="button" onClick={() => setFull((x) => !x)} className="mt-1 min-h-9 text-[13px] font-bold text-ink-soft underline underline-offset-4">
          {full ? "收起" : "展开全文"}
        </button>
      )}
      <Button
        variant="gold"
        size="sm"
        className="mt-2 w-full"
        onClick={async () => toast((await copyText(text)) ? "已复制，去群里粘贴" : "复制失败，长按文字手动复制", "ok")}
      >
        {label}
      </Button>
    </div>
  );
}

/* ───────── #8 群公告 ───────── */
function useMessages(c: Ctx) {
  const { state, admin, api } = c;
  const [msgs, setMsgs] = useState<GroupMessages | null>(null);
  const key = [
    state.ju.status,
    state.counts.in,
    state.counts.done,
    state.ju.plan?.computedAt,
    state.ju.confirmedProposalId,
    state.ju.settlement?.paidCount,
    state.ju.announcements.length,
  ].join("|");
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      api
        .messages(state.ju.id, admin)
        .then((m) => alive && setMsgs((old) => ({ ...old, ...m })))
        .catch(() => {});
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [key, api, admin, state.ju.id]);
  return [msgs, setMsgs] as const;
}

function Broadcast({ msgs, state }: { msgs: GroupMessages | null; state: JuState }) {
  const fallback = state.ju.announcements.at(-1)?.text;
  const text = msgs?.broadcast || fallback;
  return (
    <Card title="📣 群公告">
      {text ? <CopyBlock text={text} label="复制群公告" clamp /> : <p className="text-[14px] text-ink-faint">局长在写…</p>}
    </Card>
  );
}

/* ───────── 收人阶段 ───────── */
function Collecting({ c, msgs }: { c: Ctx; msgs: GroupMessages | null }) {
  const { state, admin, api, busy, run, apply } = c;
  const { ju, counts } = state;
  const q = ju.quorum;
  const pending = q?.state === "pending";
  const tiers = ju.admin?.tiers ?? [];
  const nextTier = tiers.find((t) => !t.openedAt);
  const [nudged, setNudged] = useState<number | null>(null);
  const notDone = counts.in - counts.done;

  return (
    <>
      {q && (
        <Card title={pending ? "🤫 门限成局" : "✅ 人凑够了"} hint={pending ? "谁说了来、谁拒绝了，你也看不到" : undefined} tone={pending ? "gold" : "card"}>
          <div className="mb-2 flex items-end gap-1.5">
            <span className="font-num text-[34px] font-bold leading-none">{counts.quorumHave ?? 0}</span>
            <span className="pb-0.5 text-[15px] font-bold text-ink-soft">/ {counts.quorumNeed ?? q.min} 人私下说了来</span>
          </div>
          <Meter have={counts.quorumHave ?? 0} need={counts.quorumNeed ?? q.min} />
          <p className="mt-2 text-[13px] leading-relaxed text-ink-soft">
            {pending
              ? `再有 ${Math.max(0, (counts.quorumNeed ?? q.min) - (counts.quorumHave ?? 0))} 人说来就公开成局；凑不够的话，局长会悄悄作废，没有人知道是谁没来。`
              : "已公开成局，接下来大家会陆续填完。"}
          </p>
        </Card>
      )}

      <Card title="👥 入局进度" hint={counts.waitlist ? `另有 ${counts.waitlist} 人在候补` : undefined}>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            ["在局里", counts.in],
            ["填完了", counts.done],
            ["互选成功", counts.matchPairs],
          ].map(([l, n]) => (
            <div key={l} className="rounded-lg bg-paper-deep py-2">
              <div className="font-num text-[24px] font-bold leading-none">{n}</div>
              <div className="mt-1 text-[12px] text-ink-soft">{l}{l === "互选成功" ? " 对" : ""}</div>
            </div>
          ))}
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3 w-full"
          disabled={notDone <= 0 && !pending}
          loading={busy === "nudge"}
          onClick={run("nudge", async () => {
            const r = await api.nudge(ju.id, admin);
            setNudged(r.nudged);
            toast(r.nudged ? `局长私下催了 ${r.nudged} 个人` : "暂时没有需要催的人", "ok");
          })}
        >
          🔔 局长去催
        </Button>
        <p className="mt-1.5 text-center text-[12px] text-ink-faint">
          {nudged != null ? `刚催了 ${nudged} 人 · 你不会知道是谁，他们也不知道是你让催的` : "局长私下提醒还没填完的人，不点名"}
        </p>
      </Card>

      {tiers.length > 0 && (
        <Card title="🔗 邀请链接" hint={tiers.length > 1 ? "核心圈先发，空位再放给下一圈" : undefined}>
          <InviteLinks
            compact
            id={ju.id}
            title={ju.title}
            organizerName={ju.organizerName}
            quorumMin={q?.min}
            links={tiers.map((t) => ({ ...t, locked: !t.openedAt }))}
          />
          {nextTier && (
            <Button
              variant="ink"
              size="sm"
              className="mt-3 w-full"
              loading={busy === "tier"}
              onClick={run("tier", async () => {
                apply(await api.openTier(ju.id, admin, nextTier.tier));
                toast(`${nextTier.label}已开放；转正的人不会知道自己是第几圈`, "ok");
              })}
            >
              开放{nextTier.label}
            </Button>
          )}
        </Card>
      )}

      <MustPicker c={c} />
      <Broadcast msgs={msgs} state={state} />

      <Button
        size="lg"
        className="w-full"
        disabled={pending || counts.in < 2}
        loading={busy === "plan"}
        onClick={run("plan", async () => apply(await api.plan(ju.id, admin)))}
      >
        {busy === "plan" ? <RotatingText lines={PLAN_LINES} /> : "让局长出方案 →"}
      </Button>
      <p className="-mt-1 text-center text-[12px] text-ink-faint">
        {pending ? "人还没凑够，凑够了才能出方案" : counts.in < 2 ? "至少两个人才能出方案" : "没填完的人，局长会按他的习惯替他预填"}
      </p>
    </>
  );
}

function MustPicker({ c }: { c: Ctx }) {
  const { state, admin, api, busy, run, apply } = c;
  const others = state.members;
  if (others.length < 2) return null;
  return (
    <Card title="⭐ 谁是主角" hint="主角来不了的方案直接不考虑">
      <div className="flex flex-wrap gap-2">
        {others.map((m) => {
          const must = m.role === "must";
          return (
            <button
              key={m.id}
              type="button"
              aria-pressed={must}
              disabled={busy === `role-${m.id}`}
              onClick={run(`role-${m.id}`, async () => apply(await api.setRole(state.ju.id, admin, m.id, must ? "guest" : "must")))}
              className={`pressable inline-flex min-h-11 items-center gap-1.5 rounded-full border-2 border-ink px-3 text-[14px] font-semibold disabled:opacity-50 ${
                must ? "bg-cinnabar text-white shadow-sticker-sm" : "bg-card text-ink-soft"
              }`}
            >
              <span>{m.avatar}</span>
              {m.name}
              {must && <span className="text-[12px]">主角</span>}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/* ───────── 投票阶段 ───────── */
function Voting({ c, msgs }: { c: Ctx; msgs: GroupMessages | null }) {
  const { state, admin, api, busy, run, apply } = c;
  const { ju } = state;
  const plan = ju.plan;
  const tally = voteTally(ju);
  const voted = Object.keys(ju.votes ?? {}).length;
  const [pick, setPick] = useState<Proposal | null>(null);
  if (!plan) return null;
  return (
    <>
      <Card title="🗳️ 大家在投" hint={<span className="font-num">{voted}/{state.counts.in} 已投 · 过半自动定局</span>}>
        <p className="mb-2.5 text-[12.5px] text-ink-faint">你自己投票在“我的”里；这里的拍板不算投票。</p>
        <ul className="space-y-2.5">
          {plan.proposals.map((p) => {
            const n = tally[p.id] ?? 0;
            return (
              <li key={p.id} className={`rounded-xl border-2 p-3 ${p.recommended ? "border-cinnabar bg-cinnabar-soft" : "border-ink bg-paper"}`}>
                <div className="flex items-center gap-2">
                  <span className="rounded-md border-2 border-ink bg-mustard px-1.5 text-[12px] font-black">{p.labelText}</span>
                  {p.recommended && <span className="text-[12px] font-bold text-cinnabar">局长推荐</span>}
                  <span className="font-num ml-auto text-[22px] font-bold leading-none">{n}<span className="text-[12px] text-ink-faint"> 票</span></span>
                </div>
                <div className="mt-1.5 truncate text-[15px] font-black">{p.poi.name}</div>
                <div className="font-num mt-0.5 text-[12px] text-ink-soft">
                  {slotLabel(p.slot)} · {p.attendCount} 人到{p.poi.costPerPerson != null ? ` · 人均 ${p.poi.costPerPerson}` : ""}
                </div>
                <Button variant={p.recommended ? "primary" : "secondary"} size="sm" className="mt-2 w-full" onClick={() => setPick(p)}>
                  不等投票，直接拍板
                </Button>
              </li>
            );
          })}
        </ul>
        {ju.pendingChanges > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full"
            loading={busy === "replan"}
            onClick={run("replan", async () => apply(await api.plan(ju.id, admin)))}
          >
            有 {ju.pendingChanges} 位朋友更新了情况 · 重新出方案
          </Button>
        )}
      </Card>
      <Card title="🔔 催投票">
        <Button
          variant="secondary"
          size="sm"
          className="w-full"
          loading={busy === "nudge"}
          onClick={run("nudge", async () => {
            const r = await api.nudge(ju.id, admin);
            toast(r.nudged ? `局长私下催了 ${r.nudged} 个人` : "大家都投了", "ok");
          })}
        >
          局长去催还没投的人
        </Button>
      </Card>
      <Broadcast msgs={msgs} state={state} />
      <Sheet open={!!pick} onClose={() => setPick(null)} title="直接拍板定局？">
        {pick && (
          <div className="pb-4">
            {voted < state.counts.in && (
              <div className="mb-3 rounded-xl border-2 border-cinnabar bg-cinnabar-soft p-3">
                <p className="text-[14.5px] font-black text-cinnabar">
                  {voted === 0 ? `还没有人投票（0/${state.counts.in}）` : `还有 ${state.counts.in - voted} 人没投票（${voted}/${state.counts.in}）`}
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">现在拍板就不等大家投了，定局卡上会写“发起人拍板”。</p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-2.5 w-full"
                  loading={busy === "nudge"}
                  onClick={run("nudge", async () => {
                    const r = await api.nudge(ju.id, admin);
                    toast(r.nudged ? `局长私下催了 ${r.nudged} 个人` : "大家都投了", "ok");
                    setPick(null);
                  })}
                >
                  先让局长催一下大家
                </Button>
              </div>
            )}
            <p className="text-[15px] leading-relaxed text-ink-soft">
              {slotLabel(pick.slot)}，{pick.poi.name}。盖章后局长会通知所有人，并给每个人发专属行程卡。
            </p>
            <Button
              size="lg"
              className="mt-4 w-full"
              loading={busy === "confirm"}
              onClick={run("confirm", async () => {
                apply(await api.confirm(ju.id, admin, pick.id));
                setPick(null);
              })}
            >
              盖章 🔴
            </Button>
          </div>
        )}
      </Sheet>
    </>
  );
}

/* ───────── 定局后：订位 #13 ───────── */
type Dialog = NonNullable<GroupMessages["reservationDialog"]>;

/** 后端没给对白时的本地兜底（只用公开信息：时间、人数、店名） */
function fallbackDialog(shop: string, when: string, n: number): { script: string; dialog: Dialog } {
  const script = `您好，想订${when}的位子，${n} 位，麻烦帮忙留一张桌，谢谢！`;
  return {
    script,
    dialog: [
      { who: "店员", text: `您好，${shop}，请问有什么可以帮您？` },
      { who: "局长", text: `您好，想订${when}，${n} 位。` },
      { who: "店员", text: `${n} 位是吧，我看一下……有的，给您留一张桌。` },
      { who: "局长", text: "太好了，谢谢！我们可能有一两位稍晚一点到。" },
      { who: "店员", text: "没问题，帮您备注了，桌子留到开始后十五分钟。" },
      { who: "局长", text: "好嘞，到时候见！" },
    ],
  };
}

function Reservation({ c, msgs, setMsgs }: { c: Ctx; msgs: GroupMessages | null; setMsgs: (m: GroupMessages) => void }) {
  const { state, admin, api, busy, run, refresh } = c;
  const p = confirmedProposal(state.ju);
  const r = state.ju.reservation;
  const [called, setCalled] = useState(false);
  // 订位对白单独存：群公告随阶段刷新时不会把它冲掉
  const [talk, setTalk] = useState<{ script?: string; dialog?: Dialog } | null>(null);
  const fetched = useRef(false);
  const tableSize = r?.tableSize ?? p?.attendCount ?? state.counts.in;
  useEffect(() => {
    if (fetched.current || !p) return;
    fetched.current = true;
    const local = fallbackDialog(p.poi.name, slotLabel(p.slot), tableSize);
    api
      .reservation(state.ju.id, admin, { tableSize })
      .then((m) =>
        setTalk({
          script: m.reservationScript || local.script,
          dialog: m.reservationDialog?.length ? m.reservationDialog : local.dialog,
        }),
      )
      .catch(() => setTalk(local));
  }, [api, admin, state.ju.id, p, tableSize]);
  if (!p) return null;
  const booked = r?.status === "booked";
  const script = talk?.script ?? msgs?.reservationScript;
  const dialog = talk?.dialog ?? msgs?.reservationDialog;
  const body = (
    <>
      {script && (
        <details className="mb-3">
          <summary className="min-h-9 cursor-pointer text-[14px] font-bold text-ink-soft">订位话术（自己打的话照着念）</summary>
          <div className="mt-2">
            <CopyBlock text={script} label="复制话术" />
          </div>
        </details>
      )}
      {dialog?.length ? (
        <SimCall
          dialog={dialog}
          shopName={p.poi.name}
          tel={p.poi.tel}
          onDone={() => {
            setCalled(true);
            if (r?.status !== "booked") api.reservation(state.ju.id, admin, { status: "called" }).catch(() => {});
          }}
        />
      ) : (
        <p className="text-[14px] text-ink-faint">局长在准备订位对白…</p>
      )}
      {!booked && (
        <Button
          variant={called ? "primary" : "secondary"}
          size="sm"
          className="mt-3 w-full"
          loading={busy === "booked"}
          onClick={run("booked", async () => {
            const m = await api.reservation(state.ju.id, admin, { status: "booked", tableSize });
            setMsgs({ ...msgs, ...m });
            await refresh();
            toast("订好了，局长会在群公告里带上", "ok");
          })}
        >
          ✓ 已订好位
        </Button>
      )}
      {!p.poi.tel && <p className="mt-2 text-[12px] text-ink-faint">这家店没留电话，到店报名字就行</p>}
    </>
  );
  // 已经结算了：订位这一步折起来，不占地方
  if (state.ju.settlement) {
    return (
      <details className="rounded-[var(--radius-card)] border-2 border-ink bg-card p-3.5">
        <summary className="min-h-8 cursor-pointer text-[16px] font-black">📞 订位{booked ? " · 已订好" : ""}<span className="ml-2 text-[12px] font-normal text-ink-faint">（再听一遍模拟通话）</span></summary>
        <div className="mt-3">{body}</div>
      </details>
    );
  }
  return (
    <Card title="📞 订位" hint={booked ? `已订好 · ${tableSize} 位` : "局长替你开口"}>
      {body}
    </Card>
  );
}

/* ───────── 定局后：拍小票分账 #15 + 催款 #14 ───────── */
function Bill({ c }: { c: Ctx }) {
  const { state, admin, api, busy, run, apply } = c;
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<{ receipt: Receipt; split: BillSplit } | null>(
    state.ju.admin?.receipt && state.ju.admin?.split ? { receipt: state.ju.admin.receipt, split: state.ju.admin.split } : null,
  );
  const [manual, setManual] = useState("");
  const names = useMemo(() => new Map(state.members.map((m) => [m.id, m])), [state.members]);
  const payer = state.ju.organizerName ?? state.members.find((m) => m.isOrganizer)?.name;

  const upload = (image: string) => run("receipt", async () => setPreview(await api.receipt(state.ju.id, admin, image)))();

  return (
    <Card title="🧾 拍小票分账" hint="酒水只分给喝酒的，不吃辣的不摊辣锅">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          try {
            await upload(await compressImage(f, 1600));
          } catch (err) {
            toast(errMsg(err), "error");
          }
        }}
      />
      {!preview ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" loading={busy === "receipt"} onClick={() => fileRef.current?.click()}>
              📷 拍小票
            </Button>
            <Button variant="secondary" size="sm" disabled={busy === "receipt"} onClick={() => upload("demo")}>
              用示例小票
            </Button>
          </div>
          {busy === "receipt" && (
            <div className="mt-3" aria-live="polite">
              <div className="relative h-2 overflow-hidden rounded-full border-2 border-ink bg-paper">
                <span className="absolute inset-y-0 left-0 w-1/3 animate-[slide_1.3s_ease-in-out_infinite] rounded-full bg-cinnabar" />
              </div>
              <style>{`@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}`}</style>
              <p className="mt-1.5 text-center text-[13px] font-semibold text-ink-soft">
                <RotatingText lines={["局长正在看小票…", "一行一行认菜名…", "看看谁喝了酒…", "按忌口逐项分摊…"]} interval={1600} />
              </p>
              <p className="text-center text-[12px] text-ink-faint">看图一般要 5–10 秒</p>
            </div>
          )}
          <div className="mt-3 flex items-center gap-2">
            <input
              className="field font-num !min-h-11 flex-1"
              inputMode="decimal"
              placeholder="或者直接填总额，平均分"
              value={manual}
              onChange={(e) => setManual(e.target.value.replace(/[^\d.]/g, ""))}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={!Number(manual)}
              loading={busy === "settle"}
              onClick={run("settle", async () => apply(await api.settle(state.ju.id, admin, { total: Number(manual), payerName: payer })))}
            >
              AA
            </Button>
          </div>
        </>
      ) : (
        <div className="animate-rise">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[13px] font-bold text-ink-soft">
              识别出 {preview.receipt.items.length} 项{preview.receipt.fallback ? " · 示例小票" : ""}
            </span>
            <span className="font-num text-[22px] font-bold">{yuan(preview.receipt.total)}</span>
          </div>
          <ul className="divide-y divide-dashed divide-line rounded-lg border-2 border-ink bg-paper px-3">
            {Object.entries(preview.split.perMember).map(([mid, v]) => {
              const m = names.get(mid);
              return (
                <li key={mid} className="flex items-center gap-2 py-2 text-[14px]">
                  <span>{m?.avatar ?? "🙂"}</span>
                  <span className="font-bold">{m?.name ?? "朋友"}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink-faint">
                    {v.lines.map((l) => l.reason ?? l.itemName).filter(Boolean).slice(0, 2).join(" · ")}
                  </span>
                  <span className="font-num font-bold">{yuan(v.amount)}</span>
                </li>
              );
            })}
          </ul>
          {preview.split.explain.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-[12px] text-ink-soft">
              {preview.split.explain.map((e) => (
                <li key={e}>· {e}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[12px] text-ink-faint">每个人只会私下收到自己那份和明细，群里只显示“已转几人”。</p>
          <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPreview(null)}>
              重拍
            </Button>
            <Button
              size="sm"
              loading={busy === "settle"}
              onClick={run("settle", async () => apply(await api.settle(state.ju.id, admin, { useReceipt: true, payerName: payer })))}
            >
              按这个分，私下通知每个人
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function PayStatus({ c }: { c: Ctx }) {
  const { state, admin, api, busy, run } = c;
  const s = state.ju.settlement!;
  const [pays, setPays] = useState<Payments | null>(null);
  useEffect(() => {
    let alive = true;
    api
      .payments(state.ju.id, admin)
      .then((p) => alive && setPays(p))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [api, admin, state.ju.id, s.paidCount]);
  const unpaid = s.payCount - s.paidCount;
  return (
    <Card title="💸 收钱" hint={s.payerName ? `转给 ${s.payerName}` : undefined}>
      <div className="mb-2 flex items-end gap-2">
        <span className="font-num text-[34px] font-bold leading-none">
          {s.paidCount}/{s.payCount}
        </span>
        <span className="pb-0.5 text-[14px] font-bold text-ink-soft">已转 · 总额 {yuan(s.total)}{s.itemized ? " · 按小票逐项分" : ""}</span>
      </div>
      <Meter have={s.paidCount} need={s.payCount} />
      {pays && (
        <ul className="mt-3 grid grid-cols-2 gap-1.5 text-[13px]">
          {Object.entries(pays).map(([id, p]) => (
            <li key={id} className={`flex items-center gap-1.5 rounded-lg px-2 py-1.5 ${p.paid ? "bg-paper-deep text-ink-faint" : "border-2 border-dashed border-cinnabar"}`}>
              <span className="truncate font-bold">{p.name}</span>
              <span className="font-num ml-auto">{yuan(p.amount)}</span>
              <span>{p.paid ? "✓" : "…"}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[12px] text-ink-faint">这张表只有你能看到；群里只有“已转 {s.paidCount}/{s.payCount}”。</p>
      {unpaid > 0 && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-2 w-full"
          loading={busy === "remind"}
          onClick={run("remind", async () => {
            const r = await api.remindPay(state.ju.id, admin);
            toast(r.reminded ? `局长私下提醒了 ${r.reminded} 人，不会在群里点名` : "大家都转了", "ok");
          })}
        >
          局长私下提醒没转的人
        </Button>
      )}
    </Card>
  );
}

/* ───────── 局后 #16 ───────── */
function After({ c }: { c: Ctx }) {
  const { state, admin, api, busy, run, apply } = c;
  const recap = state.ju.recap;
  const [again, setAgain] = useState<CreateResult | null>(null);
  return (
    <>
      <Card title="📸 局后回顾" hint={recap ? `${recap.photos.length} 张照片` : "大家传的照片 + 局长写一段话"}>
        {recap ? (
          <CopyBlock text={recap.text} label="复制回顾发群里" />
        ) : (
          <Button variant="secondary" size="sm" className="w-full" loading={busy === "recap"} onClick={run("recap", async () => apply(await api.recap(state.ju.id, admin)))}>
            生成回顾
          </Button>
        )}
        {recap && (
          <Button variant="ghost" size="sm" className="mt-1 w-full" loading={busy === "recap"} onClick={run("recap", async () => apply(await api.recap(state.ju.id, admin)))}>
            有新照片了，重新写一段
          </Button>
        )}
      </Card>
      <Card title="🔁 一键再约" hint="同一拨人，带上各自的习惯">
        {again ? (
          <div className="animate-rise">
            <InviteLinks compact id={again.id} title={`${state.ju.title}（再约）`} organizerName={state.ju.organizerName} links={again.tierLinks} />
            <Link href={`/j/${again.id}`} className="pressable mt-3 flex min-h-12 items-center justify-center rounded-[var(--radius-btn)] border-2 border-ink bg-cinnabar font-bold text-white shadow-sticker">
              去新局 →
            </Link>
          </div>
        ) : state.ju.nextJuId ? (
          <Link href={`/j/${state.ju.nextJuId}`} className="pressable flex min-h-12 items-center justify-center rounded-[var(--radius-btn)] border-2 border-ink bg-card font-bold shadow-sticker-sm">
            已经再约过了，去新局 →
          </Link>
        ) : (
          <Button
            size="sm"
            className="w-full"
            loading={busy === "again"}
            onClick={run("again", async () => {
              const r = await api.again(state.ju.id, admin);
              store.setAdmin(r.id, r.adminToken);
              setAgain(r);
            })}
          >
            同一拨人，再约一次
          </Button>
        )}
      </Card>
    </>
  );
}

/* ───────── 演示工具（dev / ?demo=1） ───────── */
function useDemoMode() {
  const [on, setOn] = useState(process.env.NODE_ENV !== "production");
  useEffect(() => {
    try {
      const q = new URLSearchParams(window.location.search).get("demo");
      if (q === "1") window.localStorage.setItem("jz:demo", "1");
      if (q === "0") window.localStorage.removeItem("jz:demo");
      if (window.localStorage.getItem("jz:demo") === "1") setOn(true);
    } catch {
      /* 隐私模式 */
    }
  }, []);
  return on;
}

function DemoTools({ c }: { c: Ctx }) {
  const { state, admin, api, busy, run, apply } = c;
  const off = state.ju.admin?.clockOffsetMin ?? 0;
  const p = confirmedProposal(state.ju);
  const shift = (target: number, label: string) =>
    run(`clock-${label}`, async () => {
      apply(await api.devClock(state.ju.id, admin, Math.round(target)));
      toast(`演示时钟：${label}`, "ok");
    });
  const beforeDepart = p ? (new Date(p.slot.start).getTime() - 70 * 60000 - Date.now()) / 60000 : null;
  const btn = "min-h-10 rounded-full border-2 border-dashed border-ink-faint px-3 text-[13px] font-bold text-ink-soft disabled:opacity-40";
  return (
    <section className="rounded-[var(--radius-card)] border-2 border-dashed border-ink-faint p-3">
      <div className="mb-2 flex items-baseline gap-2 text-[13px] font-black text-ink-soft">
        🧪 演示工具
        <span className="font-num ml-auto text-[12px] font-normal text-ink-faint">时钟 {off >= 0 ? "+" : ""}{off} 分钟</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {state.ju.status === "collecting" && (
          <button className={btn} disabled={!!busy} onClick={run("seed", async () => apply(await api.devSeed(state.ju.id, admin)))}>
            {busy === "seed" ? "拉人中…" : "加入演示朋友"}
          </button>
        )}
        <button className={btn} disabled={!!busy} onClick={shift(off + 30, "+30 分钟")}>
          +30 分钟
        </button>
        {beforeDepart != null && (
          <button className={btn} disabled={!!busy} onClick={shift(beforeDepart, "到出发前")}>
            到出发前
          </button>
        )}
        <button className={btn} disabled={!!busy} onClick={shift(off + 1440, "+1 天")}>
          +1 天
        </button>
        {off !== 0 && (
          <button className={btn} disabled={!!busy} onClick={shift(0, "回到现在")}>
            回到现在
          </button>
        )}
      </div>
    </section>
  );
}

/* ───────── 定局后：按时间先后只放眼前的事 ───────── */
function Confirmed({ c, msgs, setMsgs }: { c: Ctx; msgs: GroupMessages | null; setMsgs: (m: GroupMessages) => void }) {
  const { state } = c;
  const p = confirmedProposal(state.ju);
  const over = !!state.ju.settlement || !!state.ju.recap?.text || (p ? Date.now() >= Date.parse(p.slot.end) : false);
  const changes = state.ju.revisions.length > 0 && (
    <Card title="🔄 定局后的变化">
      <ul className="space-y-1 text-[13px] text-ink-soft">
        {state.ju.revisions.slice(-3).flatMap((r) => r.changes).map((t, i) => (
          <li key={i}>· {t}</li>
        ))}
      </ul>
    </Card>
  );
  const afterTools = (
    <>
      {state.ju.settlement ? <PayStatus c={c} /> : <Bill c={c} />}
      <After c={c} />
    </>
  );
  if (over) {
    return (
      <>
        {afterTools}
        {changes}
        <Reservation c={c} msgs={msgs} setMsgs={setMsgs} />
        <Broadcast msgs={msgs} state={state} />
      </>
    );
  }
  return (
    <>
      <Reservation c={c} msgs={msgs} setMsgs={setMsgs} />
      {changes}
      <Broadcast msgs={msgs} state={state} />
      <details className="rounded-[var(--radius-card)] border-2 border-dashed border-ink-faint px-3.5 py-2">
        <summary className="min-h-10 cursor-pointer py-2 text-[15px] font-black text-ink-soft">吃完以后：拍小票分账 · 回顾 · 再约</summary>
        <div className="space-y-3 pb-2 pt-1">{afterTools}</div>
      </details>
    </>
  );
}

/* ───────── 主体 ───────── */
const STATUS_HEAD: Record<string, [string, string]> = {
  collecting: ["收人中", "等大家私聊局长"],
  voting: ["投票中", "大家在挑方案"],
  confirmed: ["已成局", "现在该做的在最上面"],
  cancelled: ["局已散", "这次没凑成"],
};

/** 发起人控制台（A1 在局页里带 admin token 时渲染）：按 ju.status 只显示当下该做的事 */
export function OrganizerPanel(props: { state: JuState; adminToken: string; onState: (s: JuState) => void }) {
  const { state, adminToken: admin, onState } = props;
  const api = useContext(OrganizerApiContext);
  const [busy, setBusy] = useState<string | null>(null);
  const demo = useDemoMode();

  const apply = onState;
  const refresh = useCallback(async () => {
    onState(await api.getJu(state.ju.id, admin));
  }, [api, admin, onState, state.ju.id]);

  // A1 若拿的是不带 admin 的公开视图，补拉一次发起人视图（含邀请链接 / 时钟）
  const triedAdmin = useRef(false);
  useEffect(() => {
    if (state.ju.admin || triedAdmin.current) return;
    triedAdmin.current = true;
    refresh().catch(() => {});
  }, [state.ju.admin, refresh]);

  const run = useCallback(
    (key: string, fn: () => Promise<void>) => async () => {
      setBusy(key);
      try {
        await fn();
      } catch (e) {
        toast(errMsg(e), "error");
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const c: Ctx = { state, admin, api, busy, run, apply, refresh };
  const [msgs, setMsgs] = useMessages(c);
  const st = state.ju.status;
  const [head, sub] = STATUS_HEAD[st] ?? [st, ""];

  return (
    <section className="relative rounded-[20px] border-2 border-ink bg-paper-deep p-3 shadow-sticker" aria-label="局长控制台">
      <header className="mb-3 flex items-center gap-2 px-1">
        <span className="flex size-8 -rotate-6 items-center justify-center rounded-md border-2 border-ink bg-cinnabar text-[15px] font-black text-white">令</span>
        <div className="min-w-0">
          <h3 className="text-[17px] font-black leading-tight">局长控制台</h3>
          <p className="text-[12px] text-ink-faint">{sub}</p>
        </div>
        <span className="ml-auto rounded-full border-2 border-ink bg-card px-2.5 py-0.5 text-[12px] font-bold">{head}</span>
      </header>

      <div className="space-y-3">
        {st === "collecting" && <Collecting c={c} msgs={msgs} />}
        {st === "voting" && <Voting c={c} msgs={msgs} />}
        {st === "confirmed" && <Confirmed c={c} msgs={msgs} setMsgs={setMsgs} />}
        {st === "cancelled" && (
          <Card title="🍃 这次没凑成">
            <p className="text-[14px] leading-relaxed text-ink-soft">
              {state.ju.quorum?.state === "failed" ? "门槛没凑够，局长已经悄悄作废了。谁说了来、谁没来，没有人知道。" : "这个局已经散了。"}
            </p>
            <Link href="/" className="pressable mt-3 flex min-h-12 items-center justify-center rounded-[var(--radius-btn)] border-2 border-ink bg-card font-bold shadow-sticker-sm">
              换个时间再发起 →
            </Link>
          </Card>
        )}
        {demo && <DemoTools c={c} />}
      </div>
    </section>
  );
}

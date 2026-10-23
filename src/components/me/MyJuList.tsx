"use client";

// 我的局：这台设备上发起过 / 加入过的局。没有账号体系，局的凭证存在浏览器里（storage.ts），
// 所以这里从本地 token 扫出局 id，再逐个拉一次状态（带上 token，能看到“我”下一步该干什么）。
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { JuState } from "@/lib/types";
import { api, ApiError } from "@/lib/client/api";
import { store } from "@/lib/client/storage";
import { confirmedProposal, dayLabel, slotText, yuan } from "@/lib/client/format";
import { Button, SealLogo, Spinner, StatusBadge } from "@/components/ui";
import { categoryEmoji } from "@/components/ju/JuHeader";

type Row =
  | { id: string; admin: boolean; kind: "ok"; state: JuState }
  | { id: string; admin: boolean; kind: "gone" }
  | { id: string; admin: boolean; kind: "error"; msg: string };

type Next = { text: string; urgent: boolean };

/** 我在这个局里下一步该干什么 */
function nextFor(state: JuState, admin: boolean): Next {
  const { ju, me, mine, counts } = state;
  const p = me?.private;
  if (ju.status === "cancelled") return { text: ju.quorum?.state === "failed" ? "这次没凑齐，悄悄散了" : "这个局散了", urgent: false };
  if (me?.status === "out") return { text: "你私下说了这次不来", urgent: false };
  if (me?.status === "waitlist") return { text: "局长正在确认名额", urgent: false };
  if (me && me.intake === "chatting") return { text: "去和局长私聊", urgent: true };
  if (me && me.intake === "swiping") return { text: "还差刷几家店", urgent: true };

  if (ju.status === "collecting") {
    if (ju.quorum?.state === "pending" && counts.quorumNeed) {
      return { text: `还差 ${Math.max(0, counts.quorumNeed - (counts.quorumHave ?? 0))} 人成局`, urgent: false };
    }
    return admin ? { text: `${counts.done}/${counts.in} 人说好了，可以出方案`, urgent: counts.done >= 2 } : { text: "等局长出方案", urgent: false };
  }
  if (ju.status === "voting") {
    if (me && !ju.votes[me.id]) return { text: "方案出来了，去投票", urgent: true };
    const voted = Object.keys(ju.votes).length;
    return admin ? { text: `已投 ${voted}/${counts.in}，可以拍板`, urgent: false } : { text: "已投票，等结果", urgent: false };
  }
  // confirmed
  if (p?.payment && !p.payment.paid) return { text: `该转 ¥${yuan(p.payment.amount)}`, urgent: true };
  if (ju.recap?.text) return { text: "看局后回顾", urgent: false };
  if (admin && ju.settlement) return { text: `已转 ${ju.settlement.paidCount}/${ju.settlement.payCount}`, urgent: false };
  if (mine?.itinerary?.departAt) return { text: `${mine.itinerary.departAt} 出发`, urgent: false };
  return { text: "已成局", urgent: false };
}

function whenText(state: JuState): string {
  const { ju } = state;
  const p = confirmedProposal(ju);
  if (p) return `${slotText(p.slot)} · ${p.poi.name}`;
  const ds = ju.spec.dates.slice(0, 2).map((d) => dayLabel(d));
  return `${ds.join("、")}${ju.spec.dates.length > 2 ? " 等" : ""} · ${ju.spec.earliest}–${ju.spec.latest}`;
}

const ORDER: Record<string, number> = { voting: 0, collecting: 1, confirmed: 2, cancelled: 3 };

export function MyJuList() {
  const [rows, setRows] = useState<Row[] | null>(null);

  const load = useCallback(async () => {
    const mine = store.myJu();
    const out = await Promise.all(
      mine.map(async ({ id, admin }): Promise<Row> => {
        try {
          return { id, admin, kind: "ok", state: await api.getJu(id) };
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) return { id, admin, kind: "gone" };
          return { id, admin, kind: "error", msg: e instanceof Error ? e.message : "加载失败" };
        }
      }),
    );
    out.sort((a, b) => {
      if (a.kind !== "ok" || b.kind !== "ok") return a.kind === "ok" ? -1 : b.kind === "ok" ? 1 : 0;
      const ua = nextFor(a.state, a.admin).urgent ? 0 : 1;
      const ub = nextFor(b.state, b.admin).urgent ? 0 : 1;
      if (ua !== ub) return ua - ub;
      const oa = ORDER[a.state.ju.status] ?? 9;
      const ob = ORDER[b.state.ju.status] ?? 9;
      if (oa !== ob) return oa - ob;
      return b.state.ju.createdAt.localeCompare(a.state.ju.createdAt);
    });
    setRows(out);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const forget = (id: string) => {
    store.forget(id);
    setRows((r) => r?.filter((x) => x.id !== id) ?? null);
  };

  return (
    <main className="mx-auto w-full max-w-[480px] px-4 pb-16">
      <div className="flex items-center justify-between gap-2 pb-2" style={{ paddingTop: "max(14px, env(safe-area-inset-top))" }}>
        <Link href="/" className="flex min-h-11 items-center gap-2.5" aria-label="AI 局长首页">
          <SealLogo size={34} />
          <span className="text-[17px] font-black tracking-wide">AI 局长</span>
        </Link>
        <Link
          href="/"
          className="pressable min-h-10 rounded-full border-2 border-ink bg-cinnabar px-4 py-2 text-[13px] font-black text-white shadow-sticker-sm"
        >
          ＋ 发起新局
        </Link>
      </div>

      <h1 className="mt-4 text-[28px] font-black">我的局</h1>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-faint">
        在这台手机上发起过、加入过的局都在这里。局记在这个浏览器里，换手机或清了浏览器数据就看不到了——用原来的链接重新打开就行。
      </p>

      {rows === null && (
        <div className="mt-12 flex justify-center text-ink-soft">
          <Spinner />
        </div>
      )}

      {rows?.length === 0 && (
        <section className="sticker mt-8 p-7 text-center">
          <div className="mb-2 text-5xl">🍲</div>
          <p className="text-[18px] font-black">这台手机上还没有局</p>
          <p className="mt-2 text-[14px] text-ink-soft">说一句话就能开一个，局长帮你张罗。</p>
          <Link href="/" className="mt-5 inline-flex min-h-11 items-center font-bold underline underline-offset-4">
            去发起一个 →
          </Link>
        </section>
      )}

      <ul className="mt-6 space-y-3">
        {rows?.map((r) => (
          <li key={r.id}>
            {r.kind === "ok" ? <JuCard row={r} /> : <BrokenCard row={r} onForget={() => forget(r.id)} onRetry={load} />}
          </li>
        ))}
      </ul>
    </main>
  );
}

function JuCard({ row }: { row: Extract<Row, { kind: "ok" }> }) {
  const { state, admin } = row;
  const { ju, mine } = state;
  const next = nextFor(state, admin);
  const unread = mine?.unread ?? 0;
  const muted = ju.status === "cancelled";
  return (
    <Link
      href={`/j/${ju.id}`}
      className={`pressable sticker block p-4 ${muted ? "opacity-60" : ""}`}
      aria-label={`${ju.title}，${next.text}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 text-[28px] leading-none" aria-hidden>
          {categoryEmoji(ju.spec.category)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-[17px] font-black">{ju.title}</span>
            <span className="shrink-0 rounded-full border border-ink/30 px-2 py-0.5 text-[11px] font-bold text-ink-soft">
              {admin ? "我发起" : "我参与"}
            </span>
          </div>
          <p className="mt-1 truncate text-[13px] text-ink-soft">{whenText(state)}</p>
        </div>
        <StatusBadge status={ju.status} />
      </div>
      <div className="mt-3 flex items-center gap-2 border-t-2 border-dashed border-line pt-3">
        <span className={`text-[14px] font-black ${next.urgent ? "text-cinnabar" : "text-ink"}`}>
          {next.urgent && "👉 "}
          {next.text}
        </span>
        {unread > 0 && (
          <span className="rounded-full bg-cinnabar px-2 py-0.5 text-[11px] font-black text-white">{unread} 条私信</span>
        )}
        <span className="ml-auto text-[18px] text-ink-faint" aria-hidden>
          ›
        </span>
      </div>
    </Link>
  );
}

function BrokenCard({
  row,
  onForget,
  onRetry,
}: {
  row: Extract<Row, { kind: "gone" | "error" }>;
  onForget: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="sticker flex items-center gap-3 p-4 opacity-80">
      <span className="text-[24px]" aria-hidden>
        {row.kind === "gone" ? "🕵️" : "📡"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-black">{row.kind === "gone" ? "这个局找不到了" : "没加载出来"}</p>
        <p className="truncate text-[12px] text-ink-faint">{row.kind === "gone" ? `局号 ${row.id}` : row.msg}</p>
      </div>
      {row.kind === "gone" ? (
        <Button variant="ghost" onClick={onForget} className="shrink-0">
          移除
        </Button>
      ) : (
        <Button variant="ghost" onClick={onRetry} className="shrink-0">
          重试
        </Button>
      )}
    </div>
  );
}

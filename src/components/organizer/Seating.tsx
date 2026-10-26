"use client";

// v4 发起人控制台：局内编排（#18 排座 / #19 轮次推进 + 聚合反馈 / 现场有人没到）。
// 发起人看到的和大家一样只有公开信息：谁坐哪、聚合数字。谁和谁熟、谁提了回避，发起人也看不到。
import { useState } from "react";
import type { JuState, Member, Seating, SeatingRound } from "@/lib/types";
import { Avatar, Button } from "@/components/ui";
import { toast } from "@/components/toast";
import { Card, CopyBlock, type Ctx } from "./bits";

const tableNo = (id: string) => Number(id.split("t").at(-1)) + 1;

/** 默认每桌几人：吃饭 5 人一桌，其他活动 4 人一组（和服务端一致） */
function defaultTableSize(category: string): number {
  return /火锅|烧烤|烤肉|日料|聚餐|吃饭|饭|自助|串|料理|餐/.test(category) ? 5 : 4;
}

function seatingText(state: JuState, s: Seating): string {
  const name = new Map(state.members.map((m) => [m.id, m.name]));
  const lines = [`【局长排座】${s.rounds.length} 轮，每轮换一次桌：`];
  for (const r of s.rounds) {
    lines.push(`第 ${r.index + 1} 轮「${r.format.name}」`);
    for (const t of r.tables) lines.push(`  ${tableNo(t.id)} 号桌：${t.memberIds.map((id) => name.get(id) ?? "").filter(Boolean).join("、")}`);
  }
  lines.push("每个人的座位局长也私信了，到了按座位坐就好～");
  return lines.join("\n");
}

function Stepper({ label, value, options, onChange }: { label: string; value: number; options: number[]; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-[13px] font-bold text-ink-soft">{label}</span>
      <div className="flex flex-1 gap-1.5">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={value === o}
            onClick={() => onChange(o)}
            className={`font-num min-h-10 flex-1 rounded-lg border-2 border-ink text-[15px] font-bold ${value === o ? "bg-ink text-paper" : "bg-card"}`}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

function RoundBlock({ r, byId, live }: { r: SeatingRound; byId: Map<string, Member>; live: boolean }) {
  return (
    <div className={`rounded-xl border-2 p-2.5 ${live ? "border-cinnabar bg-cinnabar-soft" : "border-line bg-paper"}`}>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-[14px] font-black">
          第 {r.index + 1} 轮 · {r.format.name}
        </span>
        <span className={`ml-auto text-[12px] font-bold ${live ? "text-cinnabar" : "text-ink-faint"}`}>
          {r.status === "live" ? "● 进行中" : r.status === "done" ? "已结束" : "未开始"}
        </span>
      </div>
      {r.adjust && <p className="mb-1.5 text-[12.5px] leading-snug text-ink-soft">🧭 {r.adjust}</p>}
      <div className="space-y-1">
        {r.tables.map((t) => (
          <div key={t.id} className="flex items-center gap-2">
            <span className="font-num w-9 shrink-0 text-[12px] font-bold text-ink-faint">{tableNo(t.id)} 号</span>
            <span className="flex min-w-0 flex-1 flex-wrap gap-x-2 gap-y-0.5 text-[13px] font-semibold">
              {t.memberIds.map((id) => {
                const m = byId.get(id);
                return m ? (
                  <span key={id} className="inline-flex items-center gap-0.5">
                    <span aria-hidden>{m.avatar}</span>
                    {m.name}
                  </span>
                ) : null;
              })}
            </span>
          </div>
        ))}
      </div>
      {r.feedback && (
        <p className="font-num mt-1.5 text-[12px] text-ink-soft">
          私下反馈：😶 拘谨 {r.feedback.stiff} · 🙂 刚好 {r.feedback.ok} · 🔊 吵 {r.feedback.loud}
        </p>
      )}
    </div>
  );
}

export function SeatingPanel({ c }: { c: Ctx }) {
  const { state, admin, api, busy, run, apply } = c;
  const s = state.ju.seating;
  const [rounds, setRounds] = useState(s?.rounds.length ?? 2);
  const [size, setSize] = useState(s?.tableSize ?? defaultTableSize(state.ju.spec.category));
  const [verified, setVerified] = useState<boolean | null>(null);
  const byId = new Map(state.members.map((m) => [m.id, m]));
  const n = state.members.filter((m) => !s?.absentIds.includes(m.id)).length;

  const generate = run("seating", async () => {
    apply(await api.seating(state.ju.id, admin, { rounds, tableSize: size }));
    setVerified(null);
    toast("排好了，每个人的座位已经私信过去 💺", "ok");
  });

  if (!s) {
    return (
      <Card title="💺 局内编排" hint="半生不熟的局，坐哪很重要" tour="org-seating">
        <p className="mb-3 text-[13.5px] leading-relaxed text-ink-soft">
          局长按大家私下标的“熟不熟”分桌：第一轮每人桌上都有认识的人，之后每轮换桌，让没说过话的人坐到一起。谁和谁熟、谁提了什么，<b className="text-ink">你也看不到</b>。
        </p>
        <div className="space-y-2">
          <Stepper label="分几轮" value={rounds} options={[1, 2, 3]} onChange={setRounds} />
          <Stepper label="每桌几人" value={size} options={[3, 4, 5, 6]} onChange={setSize} />
        </div>
        <Button className="mt-3 w-full" size="sm" loading={busy === "seating"} disabled={n < 3} onClick={generate}>
          {n < 3 ? "至少 3 个人才需要排座" : `局长排座（${n} 人）`}
        </Button>
      </Card>
    );
  }

  const m = s.metrics;
  const started = s.current >= 0;
  const finished = s.current >= s.rounds.length;
  const live = started && !finished ? s.rounds[s.current] : undefined;
  const seated = state.members.filter((x) => s.rounds.some((r) => r.tables.some((t) => t.memberIds.includes(x.id))) || s.absentIds.includes(x.id));
  const hasUpcoming = s.rounds.some((r) => r.status === "upcoming");

  return (
    <Card title="💺 局内编排" hint={`${m.people} 人 · ${s.rounds[0]?.tables.length ?? 0} 桌 · ${s.rounds.length} 轮`} tour="org-seating">
      <div className="mb-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border-2 border-ink bg-mustard-soft px-1 py-1.5">
          <div className="font-num text-[22px] font-bold leading-none">{m.newPairs}</div>
          <div className="mt-0.5 text-[11.5px] font-bold text-ink-soft">对新认识</div>
        </div>
        <div className="rounded-lg border-2 border-ink bg-paper px-1 py-1.5">
          <div className="font-num text-[22px] font-bold leading-none">{m.knownBefore}</div>
          <div className="mt-0.5 text-[11.5px] font-bold text-ink-soft">对本来就认识</div>
        </div>
        <div className="rounded-lg border-2 border-ink bg-paper px-1 py-1.5">
          <div className="font-num text-[22px] font-bold leading-none">{m.pairs}</div>
          <div className="mt-0.5 text-[11.5px] font-bold text-ink-soft">对一共</div>
        </div>
      </div>
      <ul className="mb-3 space-y-0.5 text-[13px]">
        {m.everyoneAnchored && <li>✓ 第一轮每个人桌上都有认识的人</li>}
        {m.matchPairs > 0 && (
          <li>
            ✓ 互选成功的 {m.matchPairs} 对，{m.matchesSeated} 对安排同桌
          </li>
        )}
        <li className="text-ink-soft">🔒 谁标了谁、谁想避开谁，你和大家一样看不到</li>
      </ul>

      <div className="mb-3 space-y-2">
        {s.rounds.map((r) => (
          <RoundBlock key={r.index} r={r} byId={byId} live={r.status === "live"} />
        ))}
      </div>

      {!finished && (
        <Button
          className="w-full"
          size="sm"
          variant={started ? "secondary" : "primary"}
          loading={busy === "round"}
          onClick={run("round", async () => {
            apply(await api.nextRound(state.ju.id, admin));
            toast(started ? "换桌啦，局长按大家的反馈调整了下一轮" : "第 1 轮开始！", "ok");
          })}
        >
          {!started ? "开始第 1 轮" : s.current + 1 >= s.rounds.length ? `第 ${s.current + 1} 轮结束，散场` : `第 ${s.current + 1} 轮结束，开始第 ${s.current + 2} 轮`}
        </Button>
      )}
      {live && <p className="mt-1.5 text-center text-[12px] text-ink-faint">大家正在私下反馈这一轮的感受，换桌时局长会照着调</p>}
      {finished && <p className="rounded-lg bg-jade px-3 py-2 text-center text-[13.5px] font-bold text-white">都玩完啦！大家可以私下选“和谁聊得来”了</p>}

      {hasUpcoming && (
        <details className="mt-3 rounded-lg border-2 border-dashed border-line px-3 py-1">
          <summary className="min-h-10 cursor-pointer py-2 text-[13.5px] font-bold text-ink-soft">有人没到？（后面几轮自动重排，已经坐过的不动）</summary>
          <div className="flex flex-wrap gap-1.5 pb-2">
            {seated.map((x) => {
              const absent = s.absentIds.includes(x.id);
              return (
                <button
                  key={x.id}
                  type="button"
                  aria-pressed={absent}
                  disabled={!!busy}
                  onClick={run(`absent-${x.id}`, async () => apply(await api.seatAbsent(state.ju.id, admin, x.id, !absent)))}
                  className={`inline-flex min-h-9 items-center gap-1 rounded-full border-2 border-ink py-0.5 pl-0.5 pr-2.5 text-[13px] font-semibold disabled:opacity-60 ${absent ? "bg-ink-faint text-white line-through" : "bg-card"}`}
                >
                  <Avatar emoji={x.avatar} size={24} />
                  {x.name}
                </button>
              );
            })}
          </div>
        </details>
      )}

      {!started && (
        <details className="mt-2 rounded-lg border-2 border-dashed border-line px-3 py-1">
          <summary className="min-h-10 cursor-pointer py-2 text-[13.5px] font-bold text-ink-soft">换个分法重排</summary>
          <div className="space-y-2 pb-2">
            <Stepper label="分几轮" value={rounds} options={[1, 2, 3]} onChange={setRounds} />
            <Stepper label="每桌几人" value={size} options={[3, 4, 5, 6]} onChange={setSize} />
            <Button variant="secondary" size="sm" className="w-full" loading={busy === "seating"} onClick={generate}>
              重新排
            </Button>
          </div>
        </details>
      )}

      <div className="mt-3 flex items-center gap-2 border-t-2 border-dashed border-line pt-2.5">
        <span className="font-num min-w-0 flex-1 truncate text-[11.5px] text-ink-faint">
          #{s.audit.outputHash.slice(0, 10)} · {s.audit.evaluations} 次换位评估
        </span>
        <button
          type="button"
          disabled={busy === "verify-seat"}
          onClick={run("verify-seat", async () => {
            const r = await api.verifySeating(state.ju.id);
            setVerified(r.ok);
            toast(r.ok ? "复算一致 ✓ 同样的输入一定得到同样的座位" : "复算不一致，请联系局长", r.ok ? "ok" : "error");
          })}
          className={`min-h-9 shrink-0 rounded-full border-2 border-ink px-3 text-[12.5px] font-black ${verified ? "bg-jade text-white" : "bg-card"}`}
        >
          {verified ? "✓ 复算一致" : busy === "verify-seat" ? "复算中…" : "一键复算"}
        </button>
      </div>

      <details className="mt-2">
        <summary className="min-h-10 cursor-pointer py-2 text-[13.5px] font-bold text-ink-soft">复制座位表发群里</summary>
        <CopyBlock text={seatingText(state, s)} label="复制座位表" clamp />
      </details>
    </Card>
  );
}

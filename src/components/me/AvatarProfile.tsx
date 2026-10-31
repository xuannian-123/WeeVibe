"use client";

// v6 /me「分身眼中的你」（docs/AVATAR.md 5.3）：分身记得的你，分成「我说的」和「分身猜的」两栏。
// 每条都能改、删、"忘掉"。猜的带把握度（半衰期 60 天，越久越淡），永远不会被当成底线。
// 档案按设备级 profileId 读写（没有账号体系），只有这台设备看得到。
import { useEffect, useState, type ReactNode } from "react";
import type { AvatarStyle, DietTag, Profile, Transport } from "@/lib/types";
import { api, errMsg, type ProfileEditBody } from "@/lib/client/api";
import { store } from "@/lib/client/storage";
import { activityOf, ONBOARD_DECK } from "@/lib/client/activities";
import { STYLE_LABEL } from "@/lib/client/mandate";
import { learnedFacts, saidFacts } from "@/lib/client/profileFacts";
import { Button, Chip, Meter, Spinner } from "@/components/ui";
import { DIETS } from "@/components/ju/widgets";
import { toast } from "@/components/toast";

const TRANSPORTS: [Transport, string][] = [["metro", "🚇 地铁公交"], ["taxi", "🚕 打车"], ["drive", "🚗 开车"], ["bike", "🚲 骑车"], ["walk", "🚶 走路"]];
const KIND_ICON = { home: "🏠", work: "🏢", school: "🎓", other: "📍" } as const;
const TASTE_LEVELS: [number, string][] = [[-0.5, "没兴趣"], [0.5, "喜欢"], [1, "超爱"]];
const FEEDBACK_TEXT = { great: "很棒", tired: "太累", pricey: "太贵", far: "太远", loud: "太吵", ok: "还行" } as const;

export function AvatarProfile() {
  const [pid, setPid] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = store.profileId();
    setPid(id);
    api
      .profile(id)
      .then(setProfile)
      .catch(() => setProfile(null));
  }, []);

  const save = async (body: ProfileEditBody, done = "改好了") => {
    if (!pid || busy) return;
    setBusy(true);
    try {
      setProfile(await api.editProfile(pid, body));
      setEditing(null);
      toast(done, "ok");
    } catch (e) {
      toast(errMsg(e), "error");
    } finally {
      setBusy(false);
    }
  };

  if (profile === undefined)
    return (
      <div className="mt-8 flex justify-center text-ink-soft">
        <Spinner />
      </div>
    );
  if (!profile)
    return (
      <section className="sticker mt-4 p-5 text-center">
        <div className="mb-1 text-4xl">🫥</div>
        <p className="text-[16px] font-black">分身还不认识你</p>
        <p className="mt-1 text-[13px] text-ink-soft">下次入局花 1 分钟「认识你的分身」，它就会替你去谈。</p>
      </section>
    );

  const now = new Date();
  const learned = learnedFacts(profile, now);
  const said = new Map(saidFacts(profile).map((f) => [f.key, f]));
  const tastes = Object.entries(profile.activityTastes ?? {}).filter(([k]) => activityOf(k));
  const ed = (k: string) => editing === k;

  return (
    <div className="mt-4 space-y-4">
      <section className="sticker overflow-hidden">
        <div className="flex items-center gap-3 border-b-2 border-ink bg-ink px-4 py-3 text-paper">
          <span className="text-[30px]" aria-hidden>🤖</span>
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-bold text-mustard">分身眼中的你</p>
            <p className="truncate text-[19px] font-black">{profile.avatarName || "你的分身"}</p>
          </div>
          <span className="shrink-0 rounded-full border border-mustard px-2 py-0.5 text-[12px] font-bold text-mustard">{STYLE_LABEL[profile.style ?? "balanced"]}</span>
        </div>

        <h2 className="px-4 pt-3 text-[15px] font-black">🗣 我说的</h2>
        <p className="px-4 text-[12px] text-ink-faint">你亲口说过、填过的。分身只按这些守底线。</p>
        <ul className="divide-y-2 divide-dashed divide-line">
          <Row label="分身名" value={profile.avatarName} editing={ed("name")} onEdit={() => setEditing("name")} onDelete={() => save({ avatarName: null }, "删掉了")}>
            <TextEdit initial={profile.avatarName ?? ""} max={12} onSave={(v) => save({ avatarName: v || null })} busy={busy} />
          </Row>
          <Row label="谈判风格" value={profile.style ? STYLE_LABEL[profile.style] : undefined} editing={ed("style")} onEdit={() => setEditing("style")} onDelete={() => save({ style: null }, "删掉了")}>
            <div className="flex gap-2">
              {(["easy", "balanced", "firm"] as AvatarStyle[]).map((s) => (
                <Chip key={s} selected={profile.style === s} onClick={() => void save({ style: s })}>{STYLE_LABEL[s]}</Chip>
              ))}
            </div>
          </Row>
          <Row
            label="常用出发地"
            value={profile.places?.length ? profile.places.map((p) => `${KIND_ICON[p.kind]} ${p.place.label || "已定位"}`).join("　") : undefined}
            editing={ed("places")}
            onEdit={() => setEditing("places")}
            onDelete={() => save({ places: null }, "删掉了")}
          >
            <ul className="space-y-1.5">
              {(profile.places ?? []).map((p, i) => (
                <li key={`${p.kind}-${i}`} className="flex items-center gap-2 text-[14px]">
                  <span className="min-w-0 flex-1 truncate">{KIND_ICON[p.kind]} {p.place.label}</span>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save({ places: (profile.places ?? []).filter((_, j) => j !== i) }, "删掉了")}>删</Button>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[12px] text-ink-faint">新的出发地在入局卡片里选一次就会记住。</p>
          </Row>
          <Row label="常用交通" value={TRANSPORTS.find(([t]) => t === profile.transport)?.[1]} editing={ed("transport")} onEdit={() => setEditing("transport")} onDelete={() => save({ transport: null }, "删掉了")}>
            <div className="flex flex-wrap gap-2">
              {TRANSPORTS.map(([t, label]) => (
                <Chip key={t} selected={profile.transport === t} onClick={() => void save({ transport: t })} className="px-3 text-[14px]">{label}</Chip>
              ))}
            </div>
          </Row>
          <Row label="门禁" value={profile.usualHomeBy ? `${profile.usualHomeBy} 前回去` : undefined} editing={ed("homeBy")} onEdit={() => setEditing("homeBy")} onDelete={() => save({ usualHomeBy: null }, "删掉了")}>
            <TimeEdit initial={profile.usualHomeBy ?? "22:30"} onSave={(v) => save({ usualHomeBy: v })} busy={busy} />
          </Row>
          <Row label="忌口" value={profile.dietTags.length ? profile.dietTags.join("、") : undefined} editing={ed("diet")} onEdit={() => setEditing("diet")} onDelete={() => save({ dietTags: [] }, "删掉了")}>
            <div className="flex flex-wrap gap-2">
              {DIETS.map((d: DietTag) => (
                <Chip key={d} selected={profile.dietTags.includes(d)} onClick={() => void save({ dietTags: profile.dietTags.includes(d) ? profile.dietTags.filter((x) => x !== d) : [...profile.dietTags, d] })} className="px-3 text-[14px]">{d}</Chip>
              ))}
            </div>
          </Row>
          <Row label="身体" value={profile.body?.length ? profile.body.join("、") : undefined} editing={ed("body")} onEdit={() => setEditing("body")} onDelete={() => save({ body: [] }, "删掉了")}>
            <div className="flex flex-wrap gap-2">
              {["膝盖不好", "腰不好", "怕冷", "怀孕中"].map((b) => {
                const on = (profile.body ?? []).includes(b);
                return <Chip key={b} selected={on} onClick={() => void save({ body: on ? (profile.body ?? []).filter((x) => x !== b) : [...(profile.body ?? []), b] })} className="px-3 text-[14px]">{b}</Chip>;
              })}
            </div>
          </Row>
          <Row label="平时人均" value={profile.typicalBudget ? `¥${profile.typicalBudget} 左右` : said.get("budget")?.text} editing={ed("budget")} onEdit={() => setEditing("budget")} onDelete={() => save({ typicalBudget: null }, "删掉了")}>
            <NumberEdit initial={profile.typicalBudget ?? 100} onSave={(v) => save({ typicalBudget: v })} busy={busy} />
          </Row>
          {(["noAlcohol", "allergy"] as const).filter((k) => said.has(k)).map((k) => (
            <Row key={k} label={k === "noAlcohol" ? "酒" : "过敏"} value={said.get(k)!.text} editing={false} onDelete={() => save({ forget: [k] }, "删掉了")} />
          ))}
          <Row
            label="活动口味"
            value={tastes.length ? tastes.map(([k, v]) => `${activityOf(k)!.emoji}${v >= 1 ? "超爱" : v > 0 ? "喜欢" : "没兴趣"}`).join(" ") : undefined}
            editing={ed("tastes")}
            onEdit={() => setEditing("tastes")}
            onDelete={() => save({ activityTastes: {} }, "删掉了")}
          >
            <ul className="space-y-1.5">
              {ONBOARD_DECK.map((k) => {
                const a = activityOf(k)!;
                const cur = profile.activityTastes?.[k];
                return (
                  <li key={k} className="flex items-center gap-1.5">
                    <span className="w-20 shrink-0 text-[13px] font-bold">{a.emoji} {a.name}</span>
                    {TASTE_LEVELS.map(([v, label]) => (
                      <Chip
                        key={v}
                        selected={cur === v}
                        onClick={() => {
                          const next = { ...(profile.activityTastes ?? {}) };
                          if (cur === v) delete next[k];
                          else next[k] = v;
                          void save({ activityTastes: next });
                        }}
                        className="min-h-9 px-2.5 text-[12.5px]"
                      >
                        {label}
                      </Chip>
                    ))}
                  </li>
                );
              })}
            </ul>
          </Row>
        </ul>
      </section>

      <section className="sticker p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[15px] font-black">🔮 分身猜的</h2>
          {learned.length > 0 && (
            <button type="button" disabled={busy} onClick={() => void save({ forgetLearned: true }, "都忘掉了")} className="min-h-10 text-[13px] font-bold text-ink-soft underline decoration-ink-faint underline-offset-4">全部忘掉</button>
          )}
        </div>
        <p className="mt-0.5 text-[12px] leading-relaxed text-ink-faint">从你的入局、投票和局后反馈里猜的，只当默认值，永远不会当成底线；两个月不提就淡一半。</p>
        {learned.length === 0 ? (
          <p className="mt-3 text-[13px] text-ink-soft">还没猜出什么。</p>
        ) : (
          <ul className="mt-3 space-y-2.5">
            {learned.map((f) => (
              <li key={f.key} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-bold">{f.text}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <Meter value={f.confidence * 100} tone="gold" className="w-24" />
                    <span className="text-[11px] text-ink-faint">{f.confidence >= 0.6 ? "挺有把握" : f.confidence >= 0.3 ? "有点把握" : "随便猜猜"}</span>
                  </div>
                </div>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void save({ forget: [f.key] }, "忘掉了")}>忘掉</Button>
              </li>
            ))}
          </ul>
        )}
        {!!profile.feedback?.length && (
          <p className="mt-3 border-t-2 border-dashed border-line pt-2.5 text-[12px] text-ink-soft">
            你给过 {profile.feedback.length} 次局后反馈，最近一次：{FEEDBACK_TEXT[profile.feedback[profile.feedback.length - 1].verdict]}
          </p>
        )}
      </section>
    </div>
  );
}

function Row({ label, value, editing, onEdit, onDelete, children }: { label: string; value?: string; editing: boolean; onEdit?: () => void; onDelete: () => void; children?: ReactNode }) {
  return (
    <li className="px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className="w-[4.5rem] shrink-0 text-[12.5px] font-bold text-ink-soft">{label}</span>
        <span className={`min-w-0 flex-1 break-words text-[14px] ${value ? "font-black" : "text-ink-faint"}`}>{value ?? "没说过"}</span>
        {onEdit && (
          <button type="button" onClick={onEdit} className="min-h-10 shrink-0 px-1.5 text-[13px] font-bold text-cinnabar">{value ? "改" : "填"}</button>
        )}
        {value && (
          <button type="button" onClick={onDelete} className="min-h-10 shrink-0 px-1.5 text-[13px] font-bold text-ink-soft">删</button>
        )}
      </div>
      {editing && children && <div className="animate-rise mt-2">{children}</div>}
    </li>
  );
}

function TextEdit({ initial, max, onSave, busy }: { initial: string; max: number; onSave: (v: string) => void; busy: boolean }) {
  const [v, setV] = useState(initial);
  return (
    <div className="flex gap-2">
      <input className="field min-w-0 flex-1 text-[14px]" maxLength={max} value={v} onChange={(e) => setV(e.target.value)} aria-label="新的值" />
      <Button size="sm" loading={busy} onClick={() => onSave(v.trim())}>保存</Button>
    </div>
  );
}

function TimeEdit({ initial, onSave, busy }: { initial: string; onSave: (v: string) => void; busy: boolean }) {
  const [v, setV] = useState(initial);
  return (
    <div className="flex gap-2">
      <input type="time" className="field w-32 px-2 py-2 text-[14px]" value={v} onChange={(e) => setV(e.target.value)} aria-label="几点前回去" />
      <Button size="sm" loading={busy} disabled={!v} onClick={() => onSave(v)}>保存</Button>
    </div>
  );
}

function NumberEdit({ initial, onSave, busy }: { initial: number; onSave: (v: number) => void; busy: boolean }) {
  const [v, setV] = useState(String(initial));
  const n = Number(v);
  return (
    <div className="flex items-center gap-2">
      <span className="font-bold">¥</span>
      <input type="number" inputMode="numeric" min={1} className="field w-28 px-2 py-2 text-[14px]" value={v} onChange={(e) => setV(e.target.value)} aria-label="平时人均" />
      <Button size="sm" loading={busy} disabled={!(n > 0)} onClick={() => onSave(Math.round(n))}>保存</Button>
    </div>
  );
}

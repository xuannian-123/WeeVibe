"use client";

// 开发用假后端：/j/<id>?mock=<fixture>（仅非生产环境）。动作在本地改 fixture，私聊按规则脚本推进。
import { useMemo, useRef, useState } from "react";
import type { ChatReply, ChatTurn, ChatWidget, JuState, Member, MemberPrivate } from "@/lib/types";
import { FIXTURES, fixtureConfirmed, fixtureDeck, fixturePredicted, fixtureVoting, type FixtureKey } from "@/components/fixtures";
import type { JuActions, JuHook } from "./useJu";
import type { ChatBody } from "./api";

const wait = (ms = 400) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();

const ASK: Record<Exclude<ChatWidget, null>, string> = {
  rsvp: "这次能来吗？说不来也没关系，只有我知道。",
  location: "收到 👌 你一般从哪出发？",
  time: "哪天几点能出发？有门禁或者末班车的话也告诉我，群里不会知道。",
  schedule: "传张课表截图也行，我来看哪些时间有课。",
  diet: "有什么不吃的吗？",
  budget: "人均多少以内你比较舒服？不方便在群里说的，悄悄告诉我就好。",
  swipe: "最后一步，刷几家店吧，右滑想去 🃏",
};

function nextWidget(me: Member, p: MemberPrivate, quorumPending: boolean, askedNote: boolean): ChatWidget {
  if (!p.rsvp && quorumPending) return "rsvp";
  if (!me.location) return "location";
  if (!Object.keys(p.availability).length) return "time";
  if (!p.dietTags.length && !p.notes.includes("__diet")) return "diet";
  if (p.budgetMax == null && !p.autoFilled.includes("budget") && !p.notes.includes("__budget")) return "budget";
  if (!askedNote) return null;
  return "swipe";
}

export function useMockJu(id: string, key: string): JuHook {
  const initial = FIXTURES[(key in FIXTURES ? key : "waiting") as FixtureKey];
  const [state, setState] = useState<JuState>(() => structuredClone({ ...initial, ju: { ...initial.ju, id } }));
  const ref = useRef(state);
  ref.current = state;
  const askedNote = useRef(false);

  const set = (f: (s: JuState) => JuState) => {
    const next = f(structuredClone(ref.current));
    ref.current = next;
    setState(next);
    return next;
  };

  const actions = useMemo<JuActions>(() => {
    const patchMe = (f: (me: Member, p: MemberPrivate) => void) =>
      set((s) => {
        if (s.me?.private) f(s.me, s.me.private);
        if (s.me) s.members = s.members.map((m) => (m.id === s.me!.id ? { ...m, intake: s.me!.intake, location: s.me!.location } : m));
        return s;
      });
    return {
      refresh: async () => {},
      apply: (s) => set(() => s),
      join: async (body) => {
        await wait(500);
        const opening: ChatReply = {
          reply: `${body.name}你好～我是这次${ref.current.ju.spec.category}局的局长 🙋 群里不方便说的，都可以悄悄告诉我，我只说结论，不说是谁。${ref.current.ju.quorum?.state === "pending" ? "先问一句：这次能来吗？" : "你一般从哪出发？"}`,
          widget: ref.current.ju.quorum?.state === "pending" ? "rsvp" : "location",
          quickReplies: [],
          done: false,
        };
        const me: Member = {
          id: "me",
          juId: id,
          name: body.name,
          avatar: body.avatar ?? "🙂",
          role: "guest",
          intake: "chatting",
          status: "in",
          joinedAt: now(),
          isOrganizer: !!body.isOrganizer,
          seedId: body.seedId,
          private: {
            chat: [{ role: "juzhang", text: opening.reply, at: now() }],
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
        set((s) => ({ ...s, me, mine: { experiences: [], matchNames: [], unread: 0 } }));
        return { memberId: "me", memberToken: "mock", status: "in", opening };
      },
      chat: async (body: ChatBody) => {
        await wait(500);
        let say = "";
        let reply = "";
        const quorumPending = ref.current.ju.quorum?.state === "pending";
        const next = patchMe((me, p) => {
          if ("text" in body) {
            say = body.text;
            if (/都行|随便|你定/.test(body.text)) {
              p.availability = { [ref.current.ju.spec.dates[0]]: { from: "18:30", pref: "ok" }, [ref.current.ju.spec.dates[1] ?? ref.current.ju.spec.dates[0]]: { from: "17:00", pref: "ok" } };
              p.budgetMax ??= 100;
              p.autoFilled = ["availability", "budget"];
              reply = "好嘞，我按你平时的习惯先填上了，你看看对不对 👇";
            } else if (/没有了|就这些|没了/.test(body.text)) {
              askedNote.current = true;
            } else if (/不限|都行/.test(body.text)) {
              p.notes.push("__budget");
            } else {
              p.notes.push(body.text);
              reply = "记下了，这句话只有我知道 🤐";
            }
          } else {
            if (body.rsvp) {
              p.rsvp = body.rsvp;
              say = body.rsvp === "yes" ? "能来！" : "这次来不了";
              if (body.rsvp === "no") {
                me.status = "out";
                reply = "收到，这事只有我知道 🤝 群里不会出现你的名字，也看不出你是没空还是没回。下次有局我再悄悄问你。";
              }
            }
            if (body.location) {
              me.location = body.location;
              say = `从${body.location.label}出发`;
            }
            if (body.availability) {
              p.availability = body.availability;
              p.autoFilled = p.autoFilled.filter((x) => x !== "availability");
              say = "时间填好了";
            }
            if (body.schedule) {
              p.availability = { [ref.current.ju.spec.dates[0]]: { from: "18:10", pref: "ok" } };
              say = "📷 发了一张课表截图";
              reply = "看到了：周五下午 4 点到 5 点 50 有课，所以 18:10 之后才能出发，我记下了 📒";
            }
            if (body.dietTags) {
              p.dietTags = body.dietTags;
              if (!body.dietTags.length) p.notes.push("__diet");
              p.autoFilled = p.autoFilled.filter((x) => x !== "diet");
              say = body.dietTags.join("、") || "啥都吃";
            }
            if (body.budgetMax != null) {
              p.budgetMax = body.budgetMax;
              p.autoFilled = p.autoFilled.filter((x) => x !== "budget");
              say = `人均 ${body.budgetMax} 以内`;
            }
            if (body.autofill) {
              p.availability = { [ref.current.ju.spec.dates[0]]: { from: "18:30", pref: "ok" } };
              p.budgetMax ??= 100;
              p.autoFilled = ["availability", "budget"];
              say = "都行";
              reply = "好嘞，我按你平时的习惯先填上了，随时可以改 👇";
            }
          }
          const w = me.status === "out" ? null : nextWidget(me, p, quorumPending, askedNote.current);
          if (!reply) reply = w ? ASK[w] : "还有什么想让局长知道的吗？比如这周在减肥、想早点回。";
          const turns: ChatTurn[] = [
            { role: "me", text: say, at: now() },
            { role: "juzhang", text: reply, at: now() },
          ];
          p.chat.push(...turns);
          if (w === "swipe") me.intake = "chatting";
        });
        const me = next.me!;
        const w = me.status === "out" ? null : nextWidget(me, me.private!, quorumPending, askedNote.current);
        return {
          reply: me.private!.chat.at(-1)!.text,
          widget: w,
          quickReplies: w === "time" || w === "budget" ? ["都行"] : w === null && me.status !== "out" ? ["没有了"] : [],
          done: w === "swipe",
          me,
        };
      },
      deck: async () => {
        await wait(600);
        set((s) => {
          if (s.me) s.me.intake = "swiping";
          return s;
        });
        return { deck: fixtureDeck, predicted: fixturePredicted };
      },
      swipe: async (poiId, verdict) => {
        await wait(150);
        const s = patchMe((me, p) => {
          p.swipes[poiId] = verdict;
          if (Object.keys(p.swipes).length >= fixtureDeck.length) me.intake = "done";
        });
        return s.me!;
      },
      wants: async (ids) => {
        await wait(400);
        const names = ids.includes("m2") ? ["阿杰"] : [];
        set((s) => {
          if (s.me?.private) {
            s.me.private.wants = ids;
            s.me.private.matches = ids.includes("m2") ? ["m2"] : [];
          }
          s.mine = { experiences: [], unread: 0, ...s.mine, matchNames: names };
          return s;
        });
        return names;
      },
      setStatus: async (status) => {
        await wait(300);
        patchMe((me) => {
          me.status = status;
        });
      },
      vote: async (pid) => {
        await wait(300);
        set((s) => {
          s.ju.votes = { ...s.ju.votes, me: pid };
          const n = Object.values(s.ju.votes).filter((v) => v === pid).length;
          if (n > s.counts.in / 2) {
            s.ju.status = "confirmed";
            s.ju.confirmedProposalId = pid;
          }
          return s;
        });
      },
      verify: async () => {
        await wait(700);
        const a = ref.current.ju.plan!.audit;
        return { ok: true, inputHash: a.inputHash, outputHash: a.outputHash, recomputedOutputHash: a.outputHash };
      },
      itinerary: async () => {
        await wait(500);
        return fixtureConfirmed.mine!.itinerary!;
      },
      eta: async () => {
        await wait(800);
        const eta = { arriveAt: "2026-10-23T11:03:00.000Z", lateMin: 3, updatedAt: now() };
        patchMe((me) => {
          me.eta = eta;
        });
        return eta;
      },
      inbox: async () => ref.current.me?.private?.inbox ?? [],
      inboxRead: async () => {
        const s = patchMe((_, p) => {
          p.inbox = p.inbox.map((n) => ({ ...n, read: true }));
        });
        return s.me?.private?.inbox ?? [];
      },
      paid: async () => {
        await wait(400);
        set((s) => {
          if (s.me?.private?.payment) s.me.private.payment.paid = true;
          if (s.ju.settlement) s.ju.settlement.paidCount += 1;
          return s;
        });
      },
      uploadPhoto: async (image) => {
        await wait(600);
        return image;
      },
      plan: async () => {
        await wait(1200);
        set((s) => ({ ...s, ju: { ...s.ju, status: "voting", plan: fixtureVoting.ju.plan, votes: {} }, mine: fixtureVoting.mine }));
      },
      confirm: async (pid) => {
        set((s) => ({ ...s, ju: { ...s.ju, status: "confirmed", confirmedProposalId: pid } }));
      },
      seed: async () => {
        set(() => structuredClone({ ...FIXTURES.waiting, ju: { ...FIXTURES.waiting.ju, id } }));
      },
    };
  }, [id]);

  return { state, loadError: null, offline: false, memberId: state.me?.id ?? null, adminToken: null, tierToken: null, ready: true, actions };
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Itinerary, JuState, Member, Notice, SwipeVerdict } from "@/lib/types";
import { api, ApiError, type ChatBody, type ChatResult, type DeckResult, type JoinBody, type JoinResult, type VerifyResult } from "./api";
import { store } from "./storage";

/** 页面组件只依赖这组动作；mock / gallery 用假实现替换 */
export type JuActions = {
  refresh: () => Promise<void>;
  /** 用接口返回的完整 JuState 覆盖（OrganizerPanel 的 onState 也走这里） */
  apply: (s: JuState) => void;
  join: (body: JoinBody) => Promise<JoinResult>;
  chat: (body: ChatBody) => Promise<ChatResult>;
  deck: () => Promise<DeckResult>;
  swipe: (poiId: string, verdict: SwipeVerdict) => Promise<Member>;
  /** #2 返回互选成功的名字 */
  wants: (memberIds: string[]) => Promise<string[]>;
  setStatus: (status: "in" | "out") => Promise<void>;
  vote: (proposalId: string) => Promise<void>;
  verify: () => Promise<VerifyResult>;
  itinerary: () => Promise<Itinerary>;
  eta: (lat: number, lng: number) => Promise<NonNullable<Member["eta"]>>;
  inbox: () => Promise<Notice[]>;
  inboxRead: () => Promise<Notice[]>;
  paid: () => Promise<void>;
  uploadPhoto: (image: string) => Promise<string>;
  /* 发起人（大屏等旧调用方用；控制台走自己的封装） */
  plan: () => Promise<void>;
  confirm: (proposalId: string) => Promise<void>;
  seed: (count?: number) => Promise<void>;
};

export type JuHook = {
  state: JuState | null;
  loadError: { msg: string; status: number } | null;
  offline: boolean;
  memberId: string | null;
  adminToken: string | null;
  /** #2 分层邀请链接带来的 token（入局时带上） */
  tierToken: string | null;
  ready: boolean;
  actions: JuActions;
};

/** 等待 / 投票期 3 秒，其他 10 秒 */
export function pollInterval(s: JuState | null): number {
  if (!s) return 3000;
  const { status } = s.ju;
  if (status === "voting") return 3000;
  if (status === "collecting") {
    const intake = s.me?.intake;
    // 正在私聊 / 刷卡的人页面上是本地交互，慢一点就行
    if (intake === "chatting" || intake === "swiping") return 10000;
    return 3000;
  }
  return 10000;
}

/** 从链接里收 token：#admin=xxx / ?admin=xxx（发起人换设备）、?t=xxx（分层邀请） */
function captureUrlTokens(id: string): string | null {
  try {
    const url = new URL(window.location.href);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    const admin = hash.get("admin") ?? url.searchParams.get("admin");
    if (admin) store.setAdmin(id, admin);
    const tier = url.searchParams.get("t") ?? url.searchParams.get("tier") ?? hash.get("t");
    if (tier) store.setJson(`jz:tier:${id}`, tier);
    if (admin || url.searchParams.has("admin") || hash.has("admin")) {
      // token 不要留在地址栏里，免得截图 / 转发泄露
      url.searchParams.delete("admin");
      hash.delete("admin");
      const h = hash.toString();
      window.history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + (h ? `#${h}` : ""));
    }
  } catch {
    /* ignore */
  }
  return store.getJson<string>(`jz:tier:${id}`);
}

export function useJu(id: string): JuHook {
  const [state, setState] = useState<JuState | null>(null);
  const [loadError, setLoadError] = useState<{ msg: string; status: number } | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [adminToken, setAdminToken] = useState<string | null>(null);
  const [tierToken, setTierToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [offline, setOffline] = useState(false);

  // 每次写操作 +1；写操作期间发出的轮询结果作废，避免旧数据覆盖新数据
  const seq = useRef(0);
  const hasState = useRef(false);
  const stateRef = useRef<JuState | null>(null);
  const kick = useRef<() => void>(() => {});

  const commit = useCallback((s: JuState) => {
    hasState.current = true;
    stateRef.current = s;
    setState(s);
    if (s.me?.id) setMemberId(s.me.id);
  }, []);

  useEffect(() => {
    setTierToken(captureUrlTokens(id));
    setMemberId(store.getMember(id));
    setAdminToken(store.getAdmin(id));
    setReady(true);
  }, [id]);

  const fetchOnce = useCallback(async () => {
    const mySeq = seq.current;
    try {
      const s = await api.getJu(id);
      if (mySeq !== seq.current) return;
      // 没认出本人（token 失效 / 还没入局）时页面按"未入局"处理，重新入局会覆盖旧 token
      commit(s);
      setLoadError(null);
      setOffline(false);
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError("网络开小差了", 0);
      if (!hasState.current) setLoadError({ msg: err.message, status: err.status });
      else setOffline(true); // 已有数据时静默重试，只亮一个小提示
    }
  }, [id, commit]);

  // 轮询：只在页面可见时请求；节奏跟着状态走
  useEffect(() => {
    if (!ready) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inflight = false;

    const tick = async () => {
      if (stopped) return;
      clearTimeout(timer);
      if (document.visibilityState === "visible" && !inflight) {
        inflight = true;
        await fetchOnce();
        inflight = false;
      }
      if (!stopped && document.visibilityState === "visible") timer = setTimeout(tick, pollInterval(stateRef.current));
    };
    kick.current = () => void tick();
    tick();

    const onVis = () => {
      if (document.visibilityState === "visible") tick();
      else clearTimeout(timer); // 页面隐藏时停
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [fetchOnce, ready]);

  const actions = useMemo<JuActions>(() => {
    const apply = (s: JuState) => {
      seq.current++;
      commit(s);
    };
    const applyMe = (me: Member) => {
      seq.current++;
      const cur = stateRef.current;
      if (!cur) return;
      const members = cur.members.map((m) => (m.id === me.id ? { ...m, intake: me.intake, status: me.status, name: me.name, avatar: me.avatar, location: me.location } : m));
      commit({ ...cur, me, members });
    };
    const needMe = () => {
      if (!store.getMemberToken(id)) throw new ApiError("先和局长打个招呼，入局后再来", 401);
    };
    return {
      apply,
      refresh: async () => {
        seq.current++;
        await fetchOnce();
      },
      join: async (body) => {
        seq.current++;
        const r = await api.join(id, { profileId: store.profileId(), ...body });
        store.setName(body.name);
        if (body.avatar) store.setAvatar(body.avatar);
        store.setJson(`jz:reply:${id}`, r.opening);
        setMemberId(r.memberId);
        await fetchOnce();
        return r;
      },
      chat: async (body) => {
        needMe();
        const r = await api.chat(id, body);
        store.setJson(`jz:reply:${id}`, { reply: r.reply, widget: r.widget, quickReplies: r.quickReplies, done: r.done });
        applyMe(r.me);
        // 私聊里可能改了 rsvp / 进了刷卡，公开视图跟着刷新
        if (r.done || "rsvp" in body) kick.current();
        return r;
      },
      deck: async () => {
        needMe();
        return api.deck(id);
      },
      swipe: async (poiId, verdict) => {
        needMe();
        const r = await api.swipe(id, poiId, verdict);
        applyMe(r.me);
        if (r.me.intake === "done") kick.current();
        return r.me;
      },
      wants: async (memberIds) => {
        needMe();
        const r = await api.wants(id, memberIds);
        applyMe(r.me);
        const cur = stateRef.current;
        if (cur) commit({ ...cur, mine: { experiences: [], unread: 0, ...cur.mine, matchNames: r.matchNames } });
        return r.matchNames;
      },
      setStatus: async (status) => {
        const mid = store.getMember(id);
        if (!mid) throw new ApiError("先入局", 400);
        apply(await api.setMyStatus(id, mid, status));
      },
      vote: async (proposalId) => {
        const mid = store.getMember(id);
        if (!mid) throw new ApiError("先入局才能投票", 400);
        // 乐观更新：点下去立刻看到自己的票
        seq.current++;
        const cur = stateRef.current;
        if (cur) commit({ ...cur, ju: { ...cur.ju, votes: { ...cur.ju.votes, [mid]: proposalId } } });
        try {
          apply(await api.vote(id, proposalId));
        } catch (e) {
          await fetchOnce();
          throw e;
        }
      },
      verify: () => api.verifyPlan(id),
      itinerary: async () => {
        needMe();
        return api.itinerary(id);
      },
      eta: async (lat, lng) => {
        needMe();
        const r = await api.eta(id, lat, lng);
        kick.current();
        return r.eta;
      },
      inbox: () => api.inbox(id),
      inboxRead: async () => {
        const r = await api.inboxRead(id);
        const cur = stateRef.current;
        if (cur?.me?.private) {
          commit({
            ...cur,
            me: { ...cur.me, private: { ...cur.me.private, inbox: r } },
            mine: cur.mine ? { ...cur.mine, unread: 0 } : cur.mine,
          });
        }
        return r;
      },
      paid: async () => {
        needMe();
        const r = await api.paid(id);
        applyMe(r.me);
        kick.current();
      },
      uploadPhoto: async (image) => {
        needMe();
        const r = await api.uploadPhoto(id, image);
        kick.current();
        return r.url;
      },
      plan: async () => apply(await api.plan(id)),
      confirm: async (proposalId) => apply(await api.confirm(id, proposalId)),
      seed: async (count) => apply(await api.seed(id, count)),
    };
  }, [id, fetchOnce, commit]);

  return { state, loadError, offline, memberId, adminToken, tierToken, ready, actions };
}

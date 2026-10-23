// localStorage 小工具：微信 / 隐私模式下可能抛异常，全部 try/catch。
// token 按局 id 分开存：jz:admin:<id>、jz:mtoken:<id>、jz:member:<id>

function get(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function set(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function getJson<T>(key: string): T | null {
  const raw = get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function randomId(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  } catch {
    /* 落到下面 */
  }
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export const store = {
  /* ── 发起人 ── */
  getAdmin: (id: string) => get(`jz:admin:${id}`),
  setAdmin: (id: string, token: string | null) => set(`jz:admin:${id}`, token),

  /* ── 成员（x-member-token） ── */
  getMemberToken: (id: string) => get(`jz:mtoken:${id}`),
  /** 本人 memberId */
  getMember: (id: string) => get(`jz:member:${id}`),
  /** 传 null 清掉；兼容旧写法 setMember(id, memberId) */
  setMember: (id: string, mid: string | null, token?: string | null) => {
    set(`jz:member:${id}`, mid);
    if (token !== undefined) set(`jz:mtoken:${id}`, token);
    if (mid === null) set(`jz:mtoken:${id}`, null);
  },

  /* ── 设备级 ── */
  getName: () => get("jz:name"),
  setName: (name: string) => set("jz:name", name),
  getAvatar: () => get("jz:avatar"),
  setAvatar: (a: string) => set("jz:avatar", a),
  /** 跨局档案 id（设备级），没有就生成一个 */
  profileId: (): string => {
    let pid = get("jz:pid");
    if (!pid) {
      pid = randomId();
      set("jz:pid", pid);
    }
    return pid;
  },

  /* ── 我的局：这台设备上发起过 / 加入过的局（从 token 键里扫出来） ── */
  myJu: (): { id: string; admin: boolean; member: boolean }[] => {
    const seen = new Map<string, { id: string; admin: boolean; member: boolean }>();
    try {
      const ls = window.localStorage;
      for (let i = 0; i < ls.length; i++) {
        const m = /^jz:(admin|mtoken):(.+)$/.exec(ls.key(i) ?? "");
        if (!m) continue;
        const e = seen.get(m[2]) ?? { id: m[2], admin: false, member: false };
        if (m[1] === "admin") e.admin = true;
        else e.member = true;
        seen.set(m[2], e);
      }
    } catch {
      /* 隐私模式读不了就当没有 */
    }
    return [...seen.values()];
  },
  /** 从“我的局”里移除（局不存在了 / 用户自己删） */
  forget: (id: string) => {
    for (const k of [`jz:admin:${id}`, `jz:mtoken:${id}`, `jz:member:${id}`]) set(k, null);
  },

  /* ── 页面小状态 ── */
  getJson,
  setJson: (key: string, v: unknown) => set(key, v === null ? null : JSON.stringify(v)),
  getFlag: (key: string) => get(`jz:f:${key}`) === "1",
  setFlag: (key: string, on = true) => set(`jz:f:${key}`, on ? "1" : null),
};

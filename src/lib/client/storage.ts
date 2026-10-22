// localStorage 小工具：微信 / 隐私模式下可能抛异常，全部 try/catch

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

export const store = {
  getAdmin: (id: string) => get(`jz:admin:${id}`),
  setAdmin: (id: string, token: string) => set(`jz:admin:${id}`, token),
  getMember: (id: string) => get(`jz:member:${id}`),
  setMember: (id: string, mid: string | null) => set(`jz:member:${id}`, mid),
  getName: () => get("jz:name"),
  setName: (name: string) => set("jz:name", name),
  getAvatar: () => get("jz:avatar"),
  setAvatar: (a: string) => set("jz:avatar", a),
};

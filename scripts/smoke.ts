// v3 全流程冒烟：npx tsx scripts/smoke.ts http://localhost:3001   （只对本地 dev 跑，不要对生产跑）
// parse / 截图 → 建局（门限 + 两圈）→ 发起人私聊 + 刷卡 → 门限前不可见 → 朋友们入局、成局揭晓
// → seed 演示场景 → 防火墙检查 → 出方案 → 复算 → 群消息 → 投票过半定局 → 有人退出（候补转正）→ 复算 → ics → stats → 隐私自检
// 任何一步失败以非 0 退出。
import type {
  ChatReply,
  ChatScreenshotParse,
  GroupMessages,
  JuSpec,
  JuState,
  Member,
  Poi,
  PrivacySelfTest,
  Slot,
  Stats,
  SwipeVerdict,
} from "../src/lib/types";

const BASE = (process.argv[2] || process.env.SMOKE_BASE || "http://localhost:3001").replace(/\/+$/, "");
const PROMPT = process.argv[3] || "周五晚上一起吃火锅，人均100左右";
if (/yuanshengzhe\.com/.test(BASE)) {
  console.error("不要对生产跑 smoke");
  process.exit(2);
}

let step = 0;
function log(title: string, ...lines: unknown[]) {
  console.log(`\n[${++step}] ${title}`);
  for (const l of lines) console.log("    ", typeof l === "string" ? l : JSON.stringify(l));
}
function fail(msg: string): never {
  console.error(`\n✗ 第 ${step + 1} 步失败：${msg}`);
  process.exit(1);
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) fail(msg);
}

async function call<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  expect = [200, 201],
): Promise<{ status: number; data: T; res: Response }> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    fail(`${method} ${path} 请求失败：${(e as Error).message}（dev server 起了吗？）`);
  }
  const ct = res.headers.get("content-type") ?? "";
  const data = (ct.includes("json") ? await res.json() : await res.text()) as T;
  if (!expect.includes(res.status)) {
    fail(`${method} ${path} → HTTP ${res.status}（期望 ${expect.join("/")}）：${JSON.stringify(data).slice(0, 300)}`);
  }
  return { status: res.status, data, res };
}

const PLACES = [
  { label: "上海交通大学徐汇校区", lat: 31.2005, lng: 121.4335 },
  { label: "徐家汇", lat: 31.1952, lng: 121.4372 },
  { label: "龙华寺", lat: 31.1757, lng: 121.4497 },
  { label: "上海南站", lat: 31.1545, lng: 121.43 },
  { label: "长宁来福士", lat: 31.2185, lng: 121.4235 },
];

async function main() {
  console.log(`AI 局长 v3 smoke → ${BASE}`);
  const statsBefore = (await call<Stats>("GET", "/api/stats")).data;
  assert(statsBefore.hourly?.length === 72, "stats.hourly 应覆盖 72 小时");

  // 解析
  const parsed = (await call<{ title: string; spec: JuSpec; slots: Slot[] }>("POST", "/api/parse", { prompt: PROMPT })).data;
  assert(parsed.title && parsed.spec?.dates?.length && parsed.slots?.length, "parse 返回缺字段");
  const shot = (await call<ChatScreenshotParse & { slots: Slot[] }>("POST", "/api/parse/screenshot", { image: "demo" })).data;
  assert(shot.spec && shot.seeds?.length && shot.slots?.length, "截图解析返回缺字段");
  log(
    "解析",
    `一句话「${PROMPT}」→ ${parsed.title} / ${parsed.spec.category} / ${parsed.spec.city} / ${parsed.spec.dates.join(",")} / ${parsed.slots.length} 个时段`,
    `示例截图 → ${shot.title} / ${shot.spec.city}，预填 ${shot.seeds.map((s) => `${s.name}(${s.said})`).join(" ")}${shot.fallback ? "（示例）" : ""}`,
  );
  assert(parsed.spec.city.includes("上海"), `默认城市应为上海，实际 ${parsed.spec.city}`);

  // 建局：门限 3 人 + 两圈
  const created = (
    await call<{ id: string; adminToken: string; tierLinks: { tier: number; label: string; token: string }[] }>("POST", "/api/ju", {
      prompt: PROMPT,
      organizerName: "老周",
      quorum: { min: 3 },
      tiers: 2,
    })
  ).data;
  assert(created.id && created.adminToken && created.tierLinks?.length === 2, "建局返回不对");
  const id = created.id;
  const admin = { "x-admin-token": created.adminToken };
  let state = (await call<JuState>("GET", `/api/ju/${id}`)).data;
  assert(state.ju.status === "collecting" && state.ju.quorum?.state === "pending", "新局应为 collecting + 门限 pending");
  assert(!state.ju.admin && !state.isAdmin, "公开视图不应有 admin");
  assert(state.ju.announcements.length >= 1, "建局应发一条群公告");
  log("建局", `id=${id} 「${state.ju.title}」门限 ${state.ju.quorum?.min} 人，圈层链接：${created.tierLinks.map((t) => t.label).join(" / ")}`);

  // 鉴权
  await call("POST", `/api/ju/${id}/plan`, undefined, {}, [401]);
  await call("POST", `/api/ju/${id}/plan`, undefined, { "x-admin-token": "wrong" }, [401]);
  await call("POST", `/api/dev/seed/${id}`, {}, {}, [401]);
  await call("GET", `/api/ju/nope404`, undefined, {}, [404]);
  await call("POST", `/api/ju/${id}/chat`, { text: "hi" }, {}, [401]);
  await call("POST", `/api/ju/${id}/chat`, { text: "hi" }, { "x-member-token": "wrong" }, [403]);
  const adminView = (await call<JuState>("GET", `/api/ju/${id}`, undefined, admin)).data;
  assert(adminView.isAdmin && adminView.ju.admin?.tiers.length === 2, "带 admin token 应看到 ju.admin");
  log("鉴权", "无 / 错 admin token → 401；无 member token → 401；错 → 403；不存在 → 404；admin 视图带 ju.admin ✓");

  // 发起人入局 + 私聊（组件提交）+ 刷卡
  const org = (
    await call<{ memberId: string; memberToken: string; status: string; opening: ChatReply }>(
      "POST",
      `/api/ju/${id}/join`,
      { name: "老周", isOrganizer: true, profileId: `smoke-${id}-org` },
      admin,
    )
  ).data;
  assert(org.memberToken && org.status === "in" && org.opening.reply, "发起人入局失败");
  const orgH = { "x-member-token": org.memberToken };
  const turns: string[] = [`局长：${org.opening.reply}`];
  const say = async (h: Record<string, string>, body: unknown) =>
    (await call<ChatReply & { me: Member }>("POST", `/api/ju/${id}/chat`, body, h)).data;
  const day0 = state.ju.spec.dates[0];
  for (const body of [
    { rsvp: "yes" },
    { location: PLACES[0] },
    { availability: { [day0]: { from: "18:00", homeBy: "22:30", pref: "best" } } },
    { dietTags: [] },
    { budgetMax: 120 },
    { text: "没有了，谢谢局长" },
  ]) {
    const r = await say(orgH, body);
    turns.push(`我：${JSON.stringify(body)}`, `局长：${r.reply}${r.widget ? ` [${r.widget}]` : ""}`);
  }
  const deck = (await call<{ deck: Poi[] }>("GET", `/api/ju/${id}/deck`, undefined, orgH)).data.deck;
  assert(deck.length >= 3, `刷卡牌堆太少：${deck.length}`);
  let me: Member | undefined;
  for (const [i, p] of deck.entries()) {
    const v: SwipeVerdict = i === 0 ? "love" : i === deck.length - 1 ? "pass" : "like";
    me = (await call<{ me: Member }>("POST", `/api/ju/${id}/swipe`, { poiId: p.id, verdict: v }, orgH)).data.me;
  }
  assert(me?.intake === "done", `刷完卡应入局完成，实际 ${me?.intake}`);
  assert(me.private?.budgetMax === 120 && !me.secret, "本人视图应有 private、没有 secret");
  log("发起人私聊 + 刷卡", ...turns.slice(0, 8), `刷卡 ${deck.length} 张：${deck.map((p) => p.name).join("、")} → intake=done`);

  // 门限前：谁表了态对外不可见
  const friends: { name: string; token: string; id: string }[] = [];
  for (const [i, name] of ["小吴", "阿郑", "小钱", "老孙"].entries()) {
    const j = (await call<{ memberId: string; memberToken: string; status: string }>("POST", `/api/ju/${id}/join`, { name })).data;
    friends.push({ name, token: j.memberToken, id: j.memberId });
    const h = { "x-member-token": j.memberToken };
    if (i === 0) {
      await say(h, { rsvp: "yes" });
      state = (await call<JuState>("GET", `/api/ju/${id}`)).data;
      assert(state.members.length === 1 && state.members[0].isOrganizer, "门限前公开名单应只有发起人");
      assert(state.counts.quorumHave === 2 && state.ju.quorum?.state === "pending", `门限进度应为 2/3，实际 ${state.counts.quorumHave}`);
      log("门限前", `已入局 ${state.counts.in} 人，私下说"来"的 ${state.counts.quorumHave}/${state.counts.quorumNeed}，公开名单只有发起人 ✓`);
    } else {
      await say(h, { rsvp: "yes" });
    }
    await say(h, { location: PLACES[i + 1] });
    await say(h, { availability: { [day0]: { from: i === 3 ? "19:00" : "18:00", pref: "ok" } } });
  }
  state = (await call<JuState>("GET", `/api/ju/${id}`)).data;
  assert(state.ju.quorum?.state === "met", "门限应已达成");
  assert(state.members.length === 5, `成局后公开名单应有 5 人，实际 ${state.members.length}`);
  log("成局揭晓", `门限达成 → 公开名单：${state.members.map((m) => m.name).join("、")}`, `群公告：${state.ju.announcements.at(-1)?.text}`);

  // seed 演示场景
  state = (await call<JuState>("POST", `/api/dev/seed/${id}`, {}, admin)).data;
  const names = state.members.map((m) => m.name);
  for (const n of ["阿杰", "小林", "老王", "小周"]) assert(names.includes(n), `seed 后应有 ${n}`);
  assert(!JSON.stringify(state).includes("阿May"), "阿May 私下说了不来，公开视图里不应出现");
  assert(!names.includes("大刘") && state.counts.waitlist === 1, "大刘应在候补");
  assert(state.counts.matchPairs === 1, `应有 1 对互选，实际 ${state.counts.matchPairs}`);
  log("seed 演示场景", `在局 ${state.counts.in} 人：${names.join("、")}`, `候补 ${state.counts.waitlist}，互选 ${state.counts.matchPairs} 对；阿May 不存在 ✓`);

  // 防火墙：公开视图 / 别人的 token
  const pub = JSON.stringify((await call<JuState>("GET", `/api/ju/${id}`)).data);
  for (const bad of ['"private"', '"secret"', '"admin"', '"profileId"', '"budgetMax"', "阿May", "大刘", "好友圈", created.adminToken, org.memberToken]) {
    assert(!pub.includes(bad), `公开视图泄露了 ${bad}`);
  }
  const asFriend = (await call<JuState>("GET", `/api/ju/${id}`, undefined, { "x-member-token": friends[0].token })).data;
  assert(asFriend.me?.id === friends[0].id && !asFriend.me.secret, "本人视图不对");
  assert(!JSON.stringify({ ...asFriend, me: undefined }).includes('"budgetMax":120'), "别人能看到发起人的预算");
  log("防火墙", "公开视图无 private/secret/admin/profileId/预算/不在场的人/圈层/token ✓；别人的 token 看不到发起人的预算 ✓");

  // 出方案
  state = (await call<JuState>("POST", `/api/ju/${id}/plan`, undefined, admin)).data;
  const plan = state.ju.plan;
  assert(state.ju.status === "voting" && plan, `出方案后应为 voting，实际 ${state.ju.status}`);
  assert(plan.proposals.length >= 2 && plan.proposals.every((p) => p.blurb), "方案应有 2-3 个、都有 blurb");
  assert(plan.proposals.some((p) => p.recommended), "应有推荐方案");
  const mine = (await call<JuState>("GET", `/api/ju/${id}`, undefined, orgH)).data.mine;
  assert(mine && mine.experiences.length === plan.proposals.length, "本人视图应带每个方案的 mine");
  log(
    "出方案",
    ...plan.proposals.map(
      (p) => `${p.recommended ? "★" : " "} ${p.labelText}：${p.slot.id} ${p.poi.name} 人均${p.poi.costPerPerson ?? "-"} 到场${p.attendCount} 分${p.score}「${p.blurb}」`,
    ),
    `推荐理由：${plan.recommendation}`,
    `约束聚合：${plan.constraintSummaries.join("；")}`,
    `${plan.caredFor ?? ""}`,
    `审计：${plan.audit.candidates} 候选 × ${plan.audit.evaluations} 次体验，前沿 ${plan.audit.paretoSize}，out=${plan.audit.outputHash.slice(0, 12)}…`,
    `思考流（最后 5 条）：${state.ju.trace.slice(-5).map((t) => t.text).join(" | ")}`,
    `我的体验：${mine.experiences.map((e) => `${e.utility}`).join(" / ")}`,
  );

  // 复算
  const v1 = (await call<{ ok: boolean; outputHash: string; recomputedOutputHash: string }>("GET", `/api/ju/${id}/plan/verify`)).data;
  assert(v1.ok && v1.outputHash === v1.recomputedOutputHash, "复算哈希不一致");
  log("一键复算", `ok=${v1.ok} ${v1.outputHash.slice(0, 16)}… = ${v1.recomputedOutputHash.slice(0, 16)}…`);

  // 群消息
  const msgs = (await call<GroupMessages>("GET", `/api/ju/${id}/messages`, undefined, admin)).data;
  assert(msgs.broadcast && !/阿May|大刘/.test(JSON.stringify(msgs)), "群消息不对或泄露");
  await call("GET", `/api/ju/${id}/messages`, undefined, {}, [401]);
  log("群消息", msgs.broadcast.split("\n")[0], `催促 ${msgs.nudges.length} 条`);

  // 投票：5 个真实成员都投推荐方案（在局 9 人，第 5 票过半）
  const target = plan.proposals.find((p) => p.recommended)!.id;
  const voters = [{ token: org.memberToken }, ...friends];
  let votes = 0;
  for (const v of voters) {
    state = (await call<JuState>("POST", `/api/ju/${id}/vote`, { proposalId: target }, { "x-member-token": v.token })).data;
    votes++;
    if (state.ju.status === "confirmed") break;
  }
  assert(state.ju.status === "confirmed" && state.ju.confirmedProposalId === target, `投票过半后应自动定局（${votes} 票 / ${state.counts.in} 人）`);
  await call("POST", `/api/ju/${id}/vote`, { proposalId: target }, { "x-member-token": org.memberToken }, [409]);
  const withItin = (await call<JuState>("GET", `/api/ju/${id}`, undefined, orgH)).data;
  log(
    "投票定局",
    `${votes}/${state.counts.in} 票 → 自动定局 ✓（再投 → 409 ✓）`,
    `群公告：${state.ju.announcements.at(-1)?.text.replace(/\n/g, " / ")}`,
    withItin.mine?.itinerary ? `我的行程卡：${withItin.mine.itinerary.departAt} 出发，${withItin.mine.itinerary.route.join(" → ")}` : "（行程卡暂无）",
  );

  // 有人退出 → 候补转正（B3 稳定重规划）
  const leaver = friends[3];
  state = (await call<JuState>("PATCH", `/api/ju/${id}/members/${leaver.id}`, { status: "out" }, { "x-member-token": leaver.token })).data;
  state = (await call<JuState>("GET", `/api/ju/${id}`)).data;
  assert(!state.members.some((m) => m.name === leaver.name), "退出的人还在公开名单里");
  assert(state.members.some((m) => m.name === "大刘"), "有人退出后大刘应转正");
  assert(state.ju.revisions.length >= 1, "定局后有人退出应有一条 revision");
  assert(!JSON.stringify(state.ju.revisions).includes(leaver.name), "revision 不应点名");
  log("有人退出", `${leaver.name} 退出 → 大刘转正 ✓`, `revision：${JSON.stringify(state.ju.revisions.at(-1))}`);

  const v2 = (await call<{ ok: boolean; outputHash: string; recomputedOutputHash: string }>("GET", `/api/ju/${id}/plan/verify`)).data;
  assert(v2.ok, "退出后复算应仍与出方案时一致（同样的输入）");
  log("再次复算", `ok=${v2.ok}`);

  // ics
  const ics = await call<string>("GET", `/api/ju/${id}/ics?m=${friends[0].id}`);
  assert((ics.res.headers.get("content-type") ?? "").startsWith("text/calendar"), "ics content-type 不对");
  for (const k of ["BEGIN:VEVENT", "DTSTART:", "BEGIN:VALARM", "TRIGGER:-PT2H", "STATUS:CONFIRMED"]) assert(ics.data.includes(k), `ics 缺少 ${k}`);
  const triggers = ics.data.split("\r\n").filter((l) => l.startsWith("TRIGGER"));
  assert(triggers.length === 2, "ics 应有两个提醒（含出发前提醒）");
  log("日历", ...ics.data.split("\r\n").filter((l) => /^(DTSTART|SUMMARY|TRIGGER)/.test(l)));

  // 档案（#6）
  const prof = (await call<{ typicalBudget?: number; tastes: Record<string, number> } | null>("GET", `/api/profile/smoke-${id}-org`)).data;
  assert(prof && prof.typicalBudget === 120 && Object.keys(prof.tastes).length > 0, "入局完成后档案应记下预算和口味");
  log("档案", `typicalBudget=${prof.typicalBudget} tastes=${JSON.stringify(prof.tastes).slice(0, 80)}`);

  // stats
  const statsAfter = (await call<Stats>("GET", "/api/stats")).data;
  const delta = statsAfter.memberCount - statsBefore.memberCount;
  assert(delta >= 5, `memberCount 应至少 +5，实际 +${delta}`);
  assert(statsAfter.recent.some((r) => r.id === id && r.members === 5), "本局（5 个真实成员）应出现在 recent 里");
  assert(statsAfter.privateShareRate !== undefined, "应给出 privateShareRate");
  log("stats", `memberCount +${delta}（演示成员不计）；privateShareRate=${statsAfter.privateShareRate}`);

  // 隐私自检
  const t0 = Date.now();
  const st = (await call<PrivacySelfTest>("GET", "/api/privacy/selftest")).data;
  assert(st.runs >= 200 && st.leaks === 0, `反事实检验：${st.runs} 组 ${st.leaks} 处泄露`);
  log("反事实检验", `${st.runs} 组随机场景，${st.leaks} 泄露（${Date.now() - t0}ms）`, ...st.checks.map((c) => `${c.name}：${c.runs} 次 / ${c.leaks} 泄露`));

  console.log(`\n✓ v3 全流程通过（${step} 步）。局页：${BASE}/j/${id}`);
}

main().catch((e) => fail((e as Error).stack ?? String(e)));

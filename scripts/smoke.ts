// 全流程冒烟：npx tsx scripts/smoke.ts http://localhost:3001
// parse → 建局 → 加入 3 人 → seed → plan → (退出重算) → 投票直到自动定局 → ics → settle
// 任何一步失败以非 0 退出。
import type { JuSpec, JuState, Place, Slot, Stats } from "../src/lib/types";

const BASE = (process.argv[2] || process.env.SMOKE_BASE || "http://localhost:3001").replace(/\/+$/, "");
const PROMPT = process.argv[3] || "周五晚上8个人吃火锅人均100";

let step = 0;
function log(title: string, ...lines: unknown[]) {
  console.log(`\n[${++step}] ${title}`);
  for (const l of lines) console.log("    ", typeof l === "string" ? l : JSON.stringify(l));
}
function fail(msg: string): never {
  console.error(`\n✗ 第 ${step} 步失败：${msg}`);
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
      signal: AbortSignal.timeout(60_000),
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

async function main() {
  console.log(`AI 局长 smoke → ${BASE}`);
  const statsBefore = (await call<Stats>("GET", "/api/stats")).data;
  assert(Array.isArray(statsBefore.hourly) && statsBefore.hourly.length === 72, "stats.hourly 应覆盖 72 小时");

  // 1. parse
  const parsed = (await call<{ title: string; spec: JuSpec; slots: Slot[] }>("POST", "/api/parse", { prompt: PROMPT })).data;
  assert(parsed.title && parsed.spec?.dates?.length && parsed.slots?.length, "parse 返回缺字段");
  log(
    `parse「${PROMPT}」`,
    `title=${parsed.title} category=${parsed.spec.category} keywords=${parsed.spec.poiKeywords.join("/")}`,
    `dates=${parsed.spec.dates.join(",")} ${parsed.spec.earliest}-${parsed.spec.latest} ${parsed.spec.durationMinutes}min`,
    `headcount=${parsed.spec.headcount} budget=${parsed.spec.budgetPerPerson} city=${parsed.spec.city} slots=${parsed.slots.length}`,
  );

  // 2. 建局
  const created = (
    await call<{ id: string; adminToken: string; organizerMemberId: null }>("POST", "/api/ju", {
      prompt: PROMPT,
      organizerName: "局长",
    })
  ).data;
  assert(created.id && created.adminToken, "建局没返回 id / adminToken");
  const id = created.id;
  const admin = { "x-admin-token": created.adminToken };
  let state = (await call<JuState>("GET", `/api/ju/${id}`)).data;
  assert(state.ju.status === "collecting", `新局状态应为 collecting，实际 ${state.ju.status}`);
  log("建局", `id=${id} title=${state.ju.title} slots=${state.ju.slots.length}`);

  // 2b. 管理接口无 token → 401
  await call("POST", `/api/ju/${id}/plan`, undefined, {}, [401]);
  await call("POST", `/api/ju/${id}/plan`, undefined, { "x-admin-token": "wrong" }, [401]);
  await call("POST", `/api/dev/seed/${id}`, {}, {}, [401]);
  await call("GET", `/api/ju/nope404`, undefined, {}, [404]);
  log("鉴权", "plan / seed 不带或带错 token → 401 ✓，不存在的局 → 404 ✓");

  // 3. 加入 3 人（地点走 geo 接口）
  const hot = state.ju.slots[Math.min(1, state.ju.slots.length - 1)].id;
  const search = (await call<Place[]>("GET", `/api/geo/search?q=${encodeURIComponent("金鸡湖")}`)).data;
  assert(Array.isArray(search) && search.length > 0, "geo/search 没返回地点");
  const rev = (await call<Place>("GET", `/api/geo/reverse?lat=31.3&lng=120.7&from=wgs84`)).data;
  assert(typeof rev.lat === "number" && rev.label, "geo/reverse 返回不对");
  const all = (await call<Place[]>("GET", `/api/geo/search?q=`)).data;
  const joiners = [
    // 局长的 fillSeconds 超出 0–3600，应被丢弃
    { name: "局长", isOrganizer: true, dietRaw: "", location: search[0], fillSeconds: 99999 },
    { name: "小周", dietRaw: "不能吃辣，回民", location: all[1] ?? search[0], fillSeconds: 8 },
    { name: "Lily", dietRaw: "都行", location: all[5] ?? search[0], fillSeconds: 12.3 },
  ];
  const ids: string[] = [];
  for (const j of joiners) {
    const r = (await call<{ memberId: string }>("POST", `/api/ju/${id}/members`, { ...j, availableSlotIds: [hot] })).data;
    assert(r.memberId, "加入没返回 memberId");
    ids.push(r.memberId);
  }
  state = (await call<JuState>("GET", `/api/ju/${id}`)).data;
  const zhou = state.members.find((m) => m.name === "小周");
  assert(state.members.length === 3, `应有 3 人，实际 ${state.members.length}`);
  assert(zhou && zhou.dietTags.includes("不吃辣") && zhou.dietTags.includes("清真"), `忌口解析不对：${zhou?.dietTags}`);
  assert(new Set(state.members.map((m) => m.avatar)).size === 3, "头像应各不相同");
  const fillOf = (name: string) => state.members.find((m) => m.name === name)?.fillSeconds;
  assert(fillOf("小周") === 8 && fillOf("Lily") === 12.3, "fillSeconds 没存上");
  assert(fillOf("局长") === undefined, "超出范围的 fillSeconds 应被丢弃");
  assert(state.members.every((m) => !m.isDemo), "真实成员不应标记 isDemo");
  log(
    "加入 3 人",
    `geo/search 金鸡湖 → ${search[0].label}；reverse(wgs84) → ${rev.label} (${rev.lat.toFixed(4)},${rev.lng.toFixed(4)})`,
    ...state.members.map(
      (m) => `${m.avatar} ${m.name} @${m.location.label} 忌口=${JSON.stringify(m.dietTags)} fill=${m.fillSeconds ?? "-"}`,
    ),
  );

  // 4. seed
  state = (await call<JuState>("POST", `/api/dev/seed/${id}`, {}, admin)).data;
  assert(state.members.length >= 8, `seed 后人数应 ≥ 8，实际 ${state.members.length}`);
  const demoCount = state.members.filter((m) => m.isDemo).length;
  assert(demoCount === state.members.length - 3, `seed 成员都应标记 isDemo，实际 ${demoCount}`);
  log("seed 演示成员", `共 ${state.members.length} 人：${state.members.map((m) => `${m.avatar}${m.name}`).join(" ")}`);

  // 5. plan
  state = (await call<JuState>("POST", `/api/ju/${id}/plan`, undefined, admin)).data;
  let plan = state.ju.plan;
  assert(state.ju.status === "voting" && plan, `plan 后应为 voting，实际 ${state.ju.status}`);
  assert(plan.options.length > 0, "plan 没有候选店");
  assert(plan.options.every((o) => o.blurb), "有候选店缺 blurb");
  const nameOf = (mid: string) => state.members.find((m) => m.id === mid)?.name ?? mid;
  log(
    "出方案",
    `slot=${plan.slotId} 到场 ${plan.attendeeIds.length} 人，缺席：${plan.absentIds.map(nameOf).join("、") || "无"}`,
    ...plan.options.map(
      (o, i) =>
        `#${i + 1} ${o.poi.name} 分${o.score} 最远${o.maxCommute}min 人均${o.poi.costPerPerson ?? "-"} 冲突${o.conflicts.length} 「${o.blurb}」`,
    ),
  );

  // 6. 有人退出 → 自动重算
  const leaver = state.members.find((m) => !m.isOrganizer && plan!.attendeeIds.includes(m.id) && !ids.includes(m.id));
  assert(leaver, "找不到可以退出的演示成员");
  const before = plan.computedAt;
  await call("PATCH", `/api/ju/${id}/members/${leaver.id}`, { status: "out" });
  state = (await call<JuState>("GET", `/api/ju/${id}`)).data;
  plan = state.ju.plan!;
  assert(plan.computedAt !== before, "成员退出后没有自动重算");
  assert(!plan.attendeeIds.includes(leaver.id), "退出的人还在到场名单里");
  log("退出重算", `${leaver.name} 退出 → 重算，到场 ${plan.attendeeIds.length} 人，第一推荐 ${plan.options[0].poi.name}`);

  // 7. 投票直到自动定局
  const target = plan.options[0].poi.id;
  const inIds = new Set(state.members.filter((m) => m.status === "in").map((m) => m.id));
  const voters = plan.attendeeIds.filter((x) => inIds.has(x));
  let votes = 0;
  for (const mid of voters) {
    state = (await call<JuState>("POST", `/api/ju/${id}/vote`, { memberId: mid, poiId: target })).data;
    votes++;
    if (state.ju.status === "confirmed") break;
  }
  assert(state.ju.status === "confirmed" && state.ju.confirmedPoiId === target, "投票过半后没有自动定局");
  assert(votes * 2 > voters.length && (votes - 1) * 2 <= voters.length, `定局时机不对：${votes}/${voters.length}`);
  await call("POST", `/api/ju/${id}/vote`, { memberId: voters[0], poiId: target }, {}, [409]);
  log("投票", `${votes}/${voters.length} 票投给 ${plan.options[0].poi.name} → 自动定局 ✓（定局后再投 → 409 ✓）`);

  // 8. ics
  const ics = await call<string>("GET", `/api/ju/${id}/ics`);
  const ct = ics.res.headers.get("content-type") ?? "";
  const cd = ics.res.headers.get("content-disposition") ?? "";
  assert(ct.startsWith("text/calendar"), `ics content-type 不对：${ct}`);
  for (const k of ["BEGIN:VCALENDAR", "BEGIN:VEVENT", "DTSTART:", "LOCATION:", "BEGIN:VALARM", "TRIGGER:-PT2H", "END:VCALENDAR"]) {
    assert(ics.data.includes(k), `ics 缺少 ${k}`);
  }
  assert(cd.includes("filename*=UTF-8''"), `content-disposition 不对：${cd}`);
  log(
    "日历文件",
    `content-disposition: ${cd}`,
    ...ics.data.split("\r\n").filter((l) => /^(DTSTART|DTEND|SUMMARY|LOCATION|TRIGGER)/.test(l)),
  );

  // 9. settle
  state = (await call<JuState>("POST", `/api/ju/${id}/settle`, { total: 888, payerName: "局长" })).data;
  const s = state.ju.settlement;
  assert(s && s.total === 888 && s.perPerson > 0, "settle 结果不对");
  log("AA", `总计 ${s.total} 元，${voters.length} 人，每人 ${s.perPerson} 元，转给 ${s.payerName}`);

  // 10. stats：演示成员不能算进 memberCount（别人同时在用这个库时 delta 可能更大，所以只卡上界和本局）
  const statsAfter = (await call<Stats>("GET", "/api/stats")).data;
  const delta = statsAfter.memberCount - statsBefore.memberCount;
  const sumJoins = (st: Stats) => st.hourly.reduce((a, h) => a + h.joins, 0);
  assert(delta >= 3, `memberCount 应至少 +3（3 个真实成员），实际 +${delta}`);
  assert(delta < 3 + demoCount, `memberCount +${delta}：演示成员被算进去了`);
  const mine = statsAfter.recent.find((r) => r.id === id);
  assert(mine, "本局（3 个真实成员）应出现在 recent 里");
  assert(mine.members === 3, `recent 里本局应为 3 个真实成员，实际 ${mine.members}`);
  assert(mine.status === "confirmed", `recent 里本局状态应为 confirmed，实际 ${mine.status}`);
  assert(statsAfter.juCount >= statsBefore.juCount + 1, "juCount 没有增加");
  assert(statsAfter.confirmedCount >= statsBefore.confirmedCount + 1, "confirmedCount 没有增加");
  assert(statsAfter.medianFillSeconds !== undefined, "有真实 fillSeconds 时应给出中位数");
  assert(statsAfter.hourly.length === 72, "stats.hourly 应覆盖 72 小时");
  assert(sumJoins(statsAfter) - sumJoins(statsBefore) >= 3, "hourly 入局数没增加");
  log(
    "stats",
    `memberCount ${statsBefore.memberCount} → ${statsAfter.memberCount}（+${delta}，本局 seed 了 ${demoCount} 个演示成员，未计入）`,
    `juCount=${statsAfter.juCount} confirmed=${statsAfter.confirmedCount} medianFill=${statsAfter.medianFillSeconds}s 本局 recent: ${mine.members} 人 ${mine.status}`,
    `hourly 最近一小时 ${statsAfter.hourly.at(-1)?.hour} joins=${statsAfter.hourly.at(-1)?.joins}`,
  );

  console.log(`\n✓ 全流程通过（${step} 步）。局页：${BASE}/j/${id}`);
}

main().catch((e) => fail((e as Error).stack ?? String(e)));

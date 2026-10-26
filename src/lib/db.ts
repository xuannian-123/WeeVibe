// 存储层：Node 内置 node:sqlite（DatabaseSync），JSON 列存 Ju / Member / Profile。
// 文件：data/juzhang.db（可用 JUZHANG_DB 覆盖，测试可传 ":memory:"）。
//
// 隐私分层：
// - ju.data       整个 Ju（含 admin；出接口前由 firewall.publicState 剥离）
// - members.data  整个 Member（含 private / secret；出接口前由 firewall 剥离）
// - ju_private    只有服务端用的东西：每个人的 mine（私密体验）、出方案时的输入快照（#9 复算）、
//                 攒批重算的待处理成员集合（#4）、刷卡牌堆、排座输入快照和诱饵对（#18）。这张表的内容永远不会原样出接口。
// - profiles      设备级档案（#6 #10），只按 profileId 读写
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { GroupingInput } from "./planner/grouping";
import type { Ju, LedgerEntry, Member, MyExperience, Poi, Profile } from "./types";
import { upgradeJu, upgradeMember } from "./legacy";

type Store = { db: DatabaseSync; file: string };

const g = globalThis as unknown as { __juzhangDb?: Store };

function open(file: string): Store {
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 3000;
    CREATE TABLE IF NOT EXISTS ju (
      id TEXT PRIMARY KEY,
      admin_token TEXT NOT NULL,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      ju_id TEXT NOT NULL,
      data TEXT NOT NULL,
      joined_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS members_ju ON members(ju_id);
    CREATE TABLE IF NOT EXISTS ju_private (
      ju_id TEXT PRIMARY KEY,
      data TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return { db, file };
}

function store(): DatabaseSync {
  // dev 模式下 HMR 会重新执行模块，挂在 globalThis 上避免重复打开；测试里切换 JUZHANG_DB 时重新打开
  const file = process.env.JUZHANG_DB || path.join(process.cwd(), "data", "juzhang.db");
  if (!g.__juzhangDb || g.__juzhangDb.file !== file) g.__juzhangDb = open(file);
  return g.__juzhangDb.db;
}

/** 测试用：丢掉当前连接（:memory: 库随之清空） */
export function _resetDbForTest(): void {
  if (g.__juzhangDb) {
    try {
      g.__juzhangDb.db.close();
    } catch {
      /* 已关闭 */
    }
  }
  g.__juzhangDb = undefined;
}

// ---------------------------------------------------------------- ju

export function insertJu(ju: Ju, adminToken: string): void {
  store()
    .prepare("INSERT INTO ju (id, admin_token, data, updated_at) VALUES (?, ?, ?, ?)")
    .run(ju.id, adminToken, JSON.stringify(ju), new Date().toISOString());
}

export function getJu(id: string): Ju | null {
  const row = store().prepare("SELECT data FROM ju WHERE id = ?").get(id) as { data: string } | undefined;
  return row ? (upgradeJu(JSON.parse(row.data) as Ju)) : null;
}

export function saveJu(ju: Ju): void {
  store()
    .prepare("UPDATE ju SET data = ?, updated_at = ? WHERE id = ?")
    .run(JSON.stringify(ju), new Date().toISOString(), ju.id);
}

export function getAdminToken(id: string): string | null {
  const row = store().prepare("SELECT admin_token FROM ju WHERE id = ?").get(id) as
    | { admin_token: string }
    | undefined;
  return row ? row.admin_token : null;
}

/** 统计 / 定时任务用：全部局（黑客松量级，全表扫描即可） */
export function listAllJu(): Ju[] {
  const rows = store().prepare("SELECT data FROM ju").all() as { data: string }[];
  return rows.map((r) => upgradeJu(JSON.parse(r.data) as Ju));
}

/** 定时任务用：还没结束的局的 id（collecting / voting / confirmed） */
export function listActiveJuIds(): string[] {
  const rows = store()
    .prepare(
      `SELECT id FROM ju WHERE json_extract(data, '$.status') IN ('collecting', 'voting', 'confirmed')
       ORDER BY updated_at DESC LIMIT 500`,
    )
    .all() as { id: string }[];
  return rows.map((r) => r.id);
}

// ---------------------------------------------------------------- members

export function listMembers(juId: string): Member[] {
  const rows = store()
    .prepare("SELECT data FROM members WHERE ju_id = ? ORDER BY joined_at, rowid")
    .all(juId) as { data: string }[];
  return rows.map((r) => upgradeMember(JSON.parse(r.data) as Member));
}

export function listAllMembers(): Member[] {
  const rows = store().prepare("SELECT data FROM members").all() as { data: string }[];
  return rows.map((r) => upgradeMember(JSON.parse(r.data) as Member));
}

export function getMember(id: string): Member | null {
  const row = store().prepare("SELECT data FROM members WHERE id = ?").get(id) as { data: string } | undefined;
  return row ? (upgradeMember(JSON.parse(row.data) as Member)) : null;
}

export function upsertMember(m: Member): void {
  store()
    .prepare(
      `INSERT INTO members (id, ju_id, data, joined_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    )
    .run(m.id, m.juId, JSON.stringify(m), m.joinedAt);
}

// ---------------------------------------------------------------- ju_private（只在服务端）

/** 出方案时的输入快照：#9 复算用同样的输入（含当时的地图返回）重跑一遍 */
export type PlanSnapshot = {
  ju: Ju;
  members: Member[];
  ledgers: Record<string, LedgerEntry[]>;
  now: string;
  /** 地图调用记录：key = 方法 + 参数的 JSON，value = 返回值。复算时回放，避免实时路况让哈希对不上 */
  mapLog: Record<string, unknown>;
  /** v5 让步账（影响诊断里"正在协调几人"，复算要用同一份） */
  concessions?: Record<string, number>;
};

export type JuPrivate = {
  /** memberId -> 该成员在各方案下的私密体验（只给本人） */
  mine: Record<string, MyExperience[]>;
  snapshot?: PlanSnapshot;
  /** #4 自上次出方案以来有变化的成员（ju.pendingChanges = 它的长度） */
  pendingMembers: string[];
  /** 第一次出方案的时刻（截止时间自动定局用） */
  firstPlanAt?: string;
  /** memberId -> 发给他的刷卡牌堆，刷完才算入局完成 */
  decks: Record<string, Pick<Poi, "id" | "name" | "type">[]>;
  /** #18 最近一次排座的输入（含私密标记）和诱饵对：一键复算用，永远不出接口 */
  seatSnapshot?: { input: GroupingInput; decoys: [string, string][] };
};

export function getJuPrivate(juId: string): JuPrivate {
  const row = store().prepare("SELECT data FROM ju_private WHERE ju_id = ?").get(juId) as { data: string } | undefined;
  const base: JuPrivate = { mine: {}, pendingMembers: [], decks: {} };
  return row ? { ...base, ...(JSON.parse(row.data) as Partial<JuPrivate>) } : base;
}

export function saveJuPrivate(juId: string, p: JuPrivate): void {
  store()
    .prepare(
      `INSERT INTO ju_private (ju_id, data) VALUES (?, ?)
       ON CONFLICT(ju_id) DO UPDATE SET data = excluded.data`,
    )
    .run(juId, JSON.stringify(p));
}

// ---------------------------------------------------------------- profiles

export function getProfileRow(id: string): Profile | null {
  const row = store().prepare("SELECT data FROM profiles WHERE id = ?").get(id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Profile) : null;
}

export function upsertProfile(p: Profile): void {
  store()
    .prepare(
      `INSERT INTO profiles (id, data, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run(p.id, JSON.stringify(p), new Date().toISOString());
}

// ---------------------------------------------------------------- 事务

/** 在一个事务里执行（DatabaseSync 是同步的，事务内不要 await） */
export function tx<T>(fn: () => T): T {
  const db = store();
  db.exec("BEGIN IMMEDIATE");
  try {
    const r = fn();
    db.exec("COMMIT");
    return r;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

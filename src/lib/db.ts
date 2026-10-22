// 存储层：Node 内置 node:sqlite（DatabaseSync），JSON 列存 Ju / Member。
// 文件：data/juzhang.db（可用 JUZHANG_DB 覆盖，测试可传 ":memory:"）。
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import type { Ju, Member } from "./types";

type Store = { db: DatabaseSync };

const g = globalThis as unknown as { __juzhangDb?: Store };

function open(): Store {
  const file = process.env.JUZHANG_DB || path.join(process.cwd(), "data", "juzhang.db");
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
  `);
  return { db };
}

function store(): DatabaseSync {
  // dev 模式下 HMR 会重新执行模块，挂在 globalThis 上避免重复打开
  if (!g.__juzhangDb) g.__juzhangDb = open();
  return g.__juzhangDb.db;
}

export function insertJu(ju: Ju, adminToken: string): void {
  store()
    .prepare("INSERT INTO ju (id, admin_token, data, updated_at) VALUES (?, ?, ?, ?)")
    .run(ju.id, adminToken, JSON.stringify(ju), new Date().toISOString());
}

export function getJu(id: string): Ju | null {
  const row = store().prepare("SELECT data FROM ju WHERE id = ?").get(id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Ju) : null;
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

export function listMembers(juId: string): Member[] {
  const rows = store()
    .prepare("SELECT data FROM members WHERE ju_id = ? ORDER BY joined_at, rowid")
    .all(juId) as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Member);
}

/** 统计用：全部局 / 全部成员（黑客松量级，全表扫描即可） */
export function listAllJu(): Ju[] {
  const rows = store().prepare("SELECT data FROM ju").all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Ju);
}

export function listAllMembers(): Member[] {
  const rows = store().prepare("SELECT data FROM members").all() as { data: string }[];
  return rows.map((r) => JSON.parse(r.data) as Member);
}

export function getMember(id: string): Member | null {
  const row = store().prepare("SELECT data FROM members WHERE id = ?").get(id) as { data: string } | undefined;
  return row ? (JSON.parse(row.data) as Member) : null;
}

export function upsertMember(m: Member): void {
  store()
    .prepare(
      `INSERT INTO members (id, ju_id, data, joined_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
    )
    .run(m.id, m.juId, JSON.stringify(m), m.joinedAt);
}

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

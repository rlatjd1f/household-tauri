// 기존 Python 앱(database.py)의 스키마와 동작을 그대로 옮긴 데이터 계층.
// 같은 household.db 파일을 두 앱이 함께 쓸 수 있도록 테이블 구조를 바꾸지 않는다.
import { invoke as tauriInvoke, isTauri } from "@tauri-apps/api/core";

// 브라우저 미리보기에서는 메모리 SQLite로 대신 실행 (실제 앱에서는 Rust 명령 사용)
const invoke = async <T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> =>
  isTauri() ? tauriInvoke<T>(cmd, args) : (await import("./previewBackend")).previewInvoke(cmd, args);

export type SqlParam = string | number | null;
type Row = Record<string, unknown>;

export interface Household { id: number; name: string; created_at: string; }
export type CategoryType = "소비" | "소득" | "결제수단" | "자본";
export interface Category { id: number; type: CategoryType; parent_category: string; sub_category: string; color: string | null; }
export interface Asset { id: number; asset_name: string; initial_balance: number; current_balance: number; }
export type EntryType = "지출" | "수입";
export interface LedgerEntry {
  id: number; date: string; type: EntryType; category_id: number | null; asset_id: number | null;
  amount: number; memo: string | null; payee: string | null; payment_method: string | null;
  parent_category: string | null; sub_category: string | null; asset_name: string | null; color: string | null;
}
export interface LedgerInput {
  date: string; type: EntryType; category_id: number | null; asset_id: number | null;
  amount: number; memo: string; payee: string; payment_method: string;
}
export type BudgetMap = Record<string, Record<number, number>>;

const SCHEMA_VERSION = 1;

// SQLite에서 $1은 '나온 순서대로' 번호가 매겨지는 이름 있는 매개변수라 순서가 바뀌면 값이 어긋난다.
// 번호대로 바인딩되는 ?1 형식으로 바꿔서 보낸다.
const numbered = (sql: string) => sql.replace(/\$(\d+)/g, "?$1");

export function select<T = Row>(sql: string, params: SqlParam[] = []): Promise<T[]> {
  return invoke<T[]>("db_select", { sql: numbered(sql), params });
}

export function execute(sql: string, params: SqlParam[] = []): Promise<{ changes: number; last_insert_id: number }> {
  return invoke("db_execute", { sql: numbered(sql), params });
}

/** 여러 문장을 한 트랜잭션으로 실행 (하나라도 실패하면 모두 취소) */
export function batch(statements: { sql: string; params?: SqlParam[] }[]): Promise<number> {
  return invoke<number>("db_batch", { statements: statements.map((s) => ({ sql: numbered(s.sql), params: s.params ?? [] })) });
}

export function dbPath(): Promise<string> {
  return invoke<string>("db_path_string");
}

const isUniqueError = (e: unknown) => String(e).includes("UNIQUE constraint failed");
const monthPattern = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}-%`;

// --- 스키마 ---
const TABLES: Record<string, string> = {
  households: `CREATE TABLE IF NOT EXISTS households (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`,
  categories: `CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    parent_category TEXT NOT NULL,
    sub_category TEXT NOT NULL,
    color TEXT,
    UNIQUE(household_id, type, parent_category, sub_category),
    FOREIGN KEY (household_id) REFERENCES households (id) ON DELETE CASCADE)`,
  budgets: `CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id INTEGER NOT NULL,
    year INTEGER NOT NULL,
    month INTEGER NOT NULL,
    category_name TEXT NOT NULL,
    amount INTEGER DEFAULT 0,
    UNIQUE(household_id, year, month, category_name),
    FOREIGN KEY (household_id) REFERENCES households (id) ON DELETE CASCADE)`,
  assets: `CREATE TABLE IF NOT EXISTS assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id INTEGER NOT NULL,
    asset_name TEXT NOT NULL,
    initial_balance INTEGER DEFAULT 0,
    current_balance INTEGER DEFAULT 0,
    UNIQUE(household_id, asset_name),
    FOREIGN KEY (household_id) REFERENCES households (id) ON DELETE CASCADE)`,
  ledgers: `CREATE TABLE IF NOT EXISTS ledgers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    household_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    type TEXT NOT NULL,
    category_id INTEGER,
    asset_id INTEGER,
    amount INTEGER NOT NULL,
    memo TEXT,
    payee TEXT,
    payment_method TEXT,
    FOREIGN KEY (household_id) REFERENCES households (id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories (id),
    FOREIGN KEY (asset_id) REFERENCES assets (id))`,
};

async function columns(table: string): Promise<string[]> {
  return (await select<{ name: string }>(`PRAGMA table_info(${table})`)).map((c) => c.name);
}

/** 예전 스키마(UNIQUE에 household_id가 없음)를 데이터를 보존하며 새 스키마로 재구성 */
async function rebuildTable(table: string, defaultHid: number) {
  const temp = `${table}_rebuild`;
  const createSql = TABLES[table].replace(`CREATE TABLE IF NOT EXISTS ${table}`, `CREATE TABLE ${temp}`);
  await execute(`DROP TABLE IF EXISTS ${temp}`);
  await execute(createSql);
  const oldCols = new Set(await columns(table));
  const newCols = await columns(temp);
  const exprs = newCols.map((c) => (oldCols.has(c) ? c : c === "household_id" ? String(Math.trunc(defaultHid)) : "NULL"));
  await batch([
    { sql: `INSERT OR IGNORE INTO ${temp} (${newCols.join(", ")}) SELECT ${exprs.join(", ")} FROM ${table}` },
    { sql: `DROP TABLE ${table}` },
    { sql: `ALTER TABLE ${temp} RENAME TO ${table}` },
  ]);
}

export async function initDb() {
  for (const sql of Object.values(TABLES)) await execute(sql);

  const [{ count }] = await select<{ count: number }>("SELECT COUNT(*) AS count FROM households");
  if (count === 0) await execute("INSERT INTO households (name) VALUES ('기본 가계부')");
  const [{ id: defaultHid }] = await select<{ id: number }>("SELECT id FROM households LIMIT 1");

  for (const table of ["categories", "budgets", "assets"]) {
    const [info] = await select<{ sql: string }>("SELECT sql FROM sqlite_master WHERE type='table' AND name=$1", [table]);
    if (info && !info.sql.replace(/\s/g, "").includes("UNIQUE(household_id,")) await rebuildTable(table, defaultHid);
  }

  if (!(await columns("categories")).includes("color")) await execute("ALTER TABLE categories ADD COLUMN color TEXT");
  const ledgerCols = await columns("ledgers");
  if (!ledgerCols.includes("household_id")) {
    await execute("ALTER TABLE ledgers ADD COLUMN household_id INTEGER REFERENCES households(id)");
    await execute("UPDATE ledgers SET household_id = $1", [defaultHid]);
  }
  if (!ledgerCols.includes("payee")) await execute("ALTER TABLE ledgers ADD COLUMN payee TEXT");
  if (!ledgerCols.includes("payment_method")) await execute("ALTER TABLE ledgers ADD COLUMN payment_method TEXT");

  const [{ user_version: version }] = await select<{ user_version: number }>("PRAGMA user_version");
  if (version < 1) {
    // 가계부 내역의 asset_id는 결제수단 분류 id라서 예전 버전이 잘못 갱신한 자산 잔액을 되돌리고,
    // 외래키가 꺼져 있어 남아 있던 삭제된 가계부의 데이터를 정리 (Python 앱과 같은 일회성 정리)
    const cleanup = ["categories", "budgets", "assets", "ledgers"].map((t) => ({
      sql: `DELETE FROM ${t} WHERE household_id IS NULL OR household_id NOT IN (SELECT id FROM households)`,
    }));
    await batch([{ sql: "UPDATE assets SET current_balance = initial_balance" }, ...cleanup]);
  }
  if (version < SCHEMA_VERSION) await execute(`PRAGMA user_version = ${SCHEMA_VERSION}`);

  if (!isTauri()) {
    const [{ n }] = await select<{ n: number }>("SELECT COUNT(*) AS n FROM ledgers");
    if (n === 0) await (await import("./previewBackend")).seedPreview(execute);
  }
}

// --- 가계부 ---
export const getHouseholds = () =>
  select<Household>("SELECT id, name, created_at FROM households ORDER BY created_at DESC");

export async function addHousehold(name: string): Promise<number | null> {
  try { return (await execute("INSERT INTO households (name) VALUES ($1)", [name])).last_insert_id; }
  catch (e) { if (isUniqueError(e)) return null; throw e; }
}

export async function renameHousehold(id: number, name: string): Promise<boolean> {
  try { await execute("UPDATE households SET name = $1 WHERE id = $2", [name, id]); return true; }
  catch (e) { if (isUniqueError(e)) return false; throw e; }
}

const householdRowDeletes = (hid: number) =>
  ["ledgers", "budgets", "assets", "categories"].map((t) => ({ sql: `DELETE FROM ${t} WHERE household_id = $1`, params: [hid] }));

/** foreign_keys가 꺼져 있어 ON DELETE CASCADE가 동작하지 않으므로 하위 데이터를 직접 삭제 */
export const deleteHousehold = (hid: number) =>
  batch([...householdRowDeletes(hid), { sql: "DELETE FROM households WHERE id = $1", params: [hid] }]);

// --- 분류 ---
export function getCategories(hid: number, type?: CategoryType) {
  return type
    ? select<Category>("SELECT id, type, parent_category, sub_category, color FROM categories WHERE household_id = $1 AND type = $2", [hid, type])
    : select<Category>("SELECT id, type, parent_category, sub_category, color FROM categories WHERE household_id = $1", [hid]);
}

export async function addCategory(hid: number, type: CategoryType, parent: string, sub: string): Promise<boolean> {
  try {
    await execute("INSERT INTO categories (household_id, type, parent_category, sub_category, color) VALUES ($1, $2, $3, $4, NULL)", [hid, type, parent, sub]);
    return true;
  } catch (e) { if (isUniqueError(e)) return false; throw e; }
}

export const deleteCategory = (id: number) => execute("DELETE FROM categories WHERE id = $1", [id]);
export const deleteCategoryParent = (hid: number, type: CategoryType, parent: string) =>
  execute("DELETE FROM categories WHERE household_id = $1 AND type = $2 AND parent_category = $3", [hid, type, parent]);
export const renameCategoryParent = (hid: number, type: CategoryType, oldName: string, newName: string) =>
  execute("UPDATE categories SET parent_category = $1 WHERE household_id = $2 AND type = $3 AND parent_category = $4", [newName, hid, type, oldName]);
export const renameCategorySub = (id: number, name: string) =>
  execute("UPDATE categories SET sub_category = $1 WHERE id = $2", [name, id]);
export const setCategoryColor = (id: number, color: string | null) =>
  execute("UPDATE categories SET color = $1 WHERE id = $2", [color, id]);

// --- 자산 ---
export const getAssets = (hid: number) =>
  select<Asset>("SELECT id, asset_name, initial_balance, current_balance FROM assets WHERE household_id = $1", [hid]);

export async function addAsset(hid: number, name: string, initialBalance: number): Promise<boolean> {
  try {
    await execute("INSERT INTO assets (household_id, asset_name, initial_balance, current_balance) VALUES ($1, $2, $3, $3)", [hid, name, initialBalance]);
    return true;
  } catch (e) { if (isUniqueError(e)) return false; throw e; }
}

/** 자산명·기초 잔액 수정. 현재 잔액은 기초 잔액이 바뀐 만큼 함께 조정 */
export async function updateAsset(id: number, name: string, initialBalance: number): Promise<boolean> {
  try {
    await execute(
      "UPDATE assets SET asset_name = $1, current_balance = current_balance + ($2 - initial_balance), initial_balance = $2 WHERE id = $3",
      [name, initialBalance, id]);
    return true;
  } catch (e) { if (isUniqueError(e)) return false; throw e; }
}

export const deleteAsset = (id: number) => execute("DELETE FROM assets WHERE id = $1", [id]);

// --- 가계부 내역 ---
export const getLedgerEntries = (hid: number, year: number, month: number) =>
  select<LedgerEntry>(`
    SELECT l.id, l.date, l.type, l.category_id, l.asset_id, l.amount, l.memo, l.payee, l.payment_method,
           c.parent_category, c.sub_category, p.sub_category AS asset_name, c.color
    FROM ledgers l
    LEFT JOIN categories c ON l.category_id = c.id
    LEFT JOIN categories p ON l.asset_id = p.id
    WHERE l.household_id = $1 AND l.date LIKE $2
    ORDER BY l.date ASC, l.id ASC`, [hid, monthPattern(year, month)]);

export async function addLedgerEntry(hid: number, e: LedgerInput): Promise<number> {
  const res = await execute(
    "INSERT INTO ledgers (household_id, date, type, category_id, asset_id, amount, memo, payee, payment_method) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [hid, e.date, e.type, e.category_id, e.asset_id, e.amount, e.memo, e.payee, e.payment_method]);
  return res.last_insert_id;
}

export const updateLedgerEntry = (id: number, e: LedgerInput) =>
  execute(
    "UPDATE ledgers SET date=$1, type=$2, category_id=$3, asset_id=$4, amount=$5, memo=$6, payee=$7, payment_method=$8 WHERE id=$9",
    [e.date, e.type, e.category_id, e.asset_id, e.amount, e.memo, e.payee, e.payment_method, id]);

export const deleteLedgerEntry = (id: number) => execute("DELETE FROM ledgers WHERE id = $1", [id]);

// --- 예산 ---
export async function getBudgets(hid: number, year: number): Promise<BudgetMap> {
  const rows = await select<{ month: number; category_name: string; amount: number }>(
    "SELECT month, category_name, amount FROM budgets WHERE household_id = $1 AND year = $2", [hid, year]);
  const data: BudgetMap = {};
  for (const r of rows) (data[r.category_name] ??= {})[r.month] = r.amount;
  return data;
}

const BUDGET_UPSERT = "INSERT INTO budgets (household_id, year, month, category_name, amount) VALUES ($1, $2, $3, $4, $5) "
  + "ON CONFLICT(household_id, year, month, category_name) DO UPDATE SET amount = excluded.amount";

/** rows: [월, 항목명, 금액] 목록을 한 트랜잭션으로 저장 */
export const saveBudgets = (hid: number, year: number, rows: [number, string, number][]) =>
  batch(rows.map(([m, c, a]) => ({ sql: BUDGET_UPSERT, params: [hid, year, m, c, a] })));

// --- 리포트 집계 ---
export const getMonthlyCategoryStats = (hid: number, year: number, month: number) =>
  select<{ parent_category: string; total: number }>(`
    SELECT c.parent_category, SUM(l.amount) AS total
    FROM ledgers l JOIN categories c ON l.category_id = c.id
    WHERE l.household_id = $1 AND l.type = '지출' AND l.date LIKE $2
    GROUP BY c.parent_category`, [hid, monthPattern(year, month)]);

export const getMonthlyDailyTrends = (hid: number, year: number, month: number) =>
  select<{ day: string; total: number }>(`
    SELECT SUBSTR(date, 9, 2) AS day, SUM(amount) AS total
    FROM ledgers WHERE household_id = $1 AND type = '지출' AND date LIKE $2
    GROUP BY day ORDER BY day`, [hid, monthPattern(year, month)]);

/** { '01': { 수입, 지출 }, ..., '12': {...} } */
export async function getYearlyMonthlyTrends(hid: number, year: number) {
  const rows = await select<{ month: string; type: EntryType; total: number }>(`
    SELECT SUBSTR(date, 6, 2) AS month, type, SUM(amount) AS total
    FROM ledgers WHERE household_id = $1 AND date LIKE $2
    GROUP BY month, type ORDER BY month`, [hid, `${year}-%`]);
  const data: Record<string, { 수입: number; 지출: number }> = {};
  for (let m = 1; m <= 12; m++) data[String(m).padStart(2, "0")] = { 수입: 0, 지출: 0 };
  for (const r of rows) if (data[r.month]) data[r.month][r.type] = r.total;
  return data;
}

// --- 엑셀 이관 ---
/** 가계부 내역이나 예산이 있는 연도 (오름차순) */
export async function getDataYears(hid: number): Promise<number[]> {
  const rows = await select<{ y: string }>(`
    SELECT substr(date, 1, 4) AS y FROM ledgers WHERE household_id = $1 AND date GLOB '[0-9][0-9][0-9][0-9]-*'
    UNION SELECT CAST(year AS TEXT) FROM budgets WHERE household_id = $1 AND amount <> 0
    ORDER BY 1`, [hid]);
  return rows.map((r) => Number(r.y)).filter((y) => Number.isInteger(y));
}

export async function getExportData(hid: number, year: number) {
  const categories = await select<Category>(
    "SELECT id, type, parent_category, sub_category, color FROM categories WHERE household_id = $1 ORDER BY type, parent_category, id", [hid]);
  const budgets = await select<{ month: number; category_name: string; amount: number }>(
    "SELECT month, category_name, amount FROM budgets WHERE household_id = $1 AND year = $2 ORDER BY month, category_name", [hid, year]);
  const assets = await select<{ asset_name: string; initial_balance: number; current_balance: number }>(
    "SELECT asset_name, initial_balance, current_balance FROM assets WHERE household_id = $1 ORDER BY id", [hid]);
  const ledgers = await select<{
    date: string; type: EntryType; amount: number; memo: string | null; payee: string | null; payment_method: string | null;
    parent_category: string | null; sub_category: string | null; payment_parent: string | null; payment_name: string | null;
  }>(`
    SELECT l.date, l.type, l.amount, l.memo, l.payee, l.payment_method,
           c.parent_category, c.sub_category, p.parent_category AS payment_parent, p.sub_category AS payment_name
    FROM ledgers l
    LEFT JOIN categories c ON l.category_id = c.id
    LEFT JOIN categories p ON l.asset_id = p.id
    WHERE l.household_id = $1 AND l.date LIKE $2
    ORDER BY l.date ASC, l.id ASC`, [hid, `${year}-%`]);
  return { categories, budgets, assets, ledgers };
}

export interface ImportData {
  categories: { type: CategoryType; parent: string; sub: string; color: string | null }[];
  budgets: { month: number; name: string; amount: number }[];
  assets: { name: string; amount: number }[];
  ledgers: (Omit<LedgerInput, "category_id" | "asset_id"> & {
    category: [CategoryType, string, string]; payment: [CategoryType, string, string] | null;
  })[];
}

/**
 * 엑셀에서 읽은 데이터를 한 트랜잭션으로 반영.
 * 분류는 병합(id 유지, 파일에 색이 있으면 색 갱신), 자산은 같은 이름이면 금액 갱신,
 * 해당 연도의 예산과 내역만 교체 (다른 연도 데이터는 유지)
 */
export async function importHouseholdYear(hid: number, year: number, data: ImportData) {
  const before: { sql: string; params?: SqlParam[] }[] = [];
  for (const c of data.categories) {
    before.push({ sql: "INSERT OR IGNORE INTO categories (household_id, type, parent_category, sub_category, color) VALUES ($1, $2, $3, $4, NULL)", params: [hid, c.type, c.parent, c.sub] });
    if (c.color) before.push({ sql: "UPDATE categories SET color = $1 WHERE household_id = $2 AND type = $3 AND parent_category = $4 AND sub_category = $5", params: [c.color, hid, c.type, c.parent, c.sub] });
  }
  for (const a of data.assets) {
    before.push({
      sql: "INSERT INTO assets (household_id, asset_name, initial_balance, current_balance) VALUES ($1, $2, $3, $3) "
        + "ON CONFLICT(household_id, asset_name) DO UPDATE SET initial_balance = excluded.initial_balance, current_balance = excluded.current_balance",
      params: [hid, a.name, a.amount],
    });
  }
  before.push({ sql: "DELETE FROM budgets WHERE household_id = $1 AND year = $2", params: [hid, year] });
  for (const b of data.budgets) before.push({ sql: BUDGET_UPSERT, params: [hid, year, b.month, b.name, b.amount] });
  before.push({ sql: "DELETE FROM ledgers WHERE household_id = $1 AND date LIKE $2", params: [hid, `${year}-%`] });

  // 분류 id는 같은 트랜잭션 안에서 이름으로 찾아 넣음 (매개변수 번호: 가계부, 유형, 대분류, 중분류)
  const catId = (t: number, p: number, s: number) =>
    `(SELECT id FROM categories WHERE household_id = $1 AND type = $${t} AND parent_category = $${p} AND sub_category = $${s})`;
  const ledgerStatements = data.ledgers.map((e) => {
    const c = e.category, p = e.payment;
    return {
      sql: `INSERT INTO ledgers (household_id, date, type, category_id, asset_id, amount, memo, payee, payment_method)
            VALUES ($1, $5, $6, ${catId(2, 3, 4)}, ${p ? catId(10, 11, 12) : "NULL"}, $7, $8, $9, $13)`,
      params: [hid, c[0], c[1], c[2], e.date, e.type, e.amount, e.memo, e.payee, p?.[0] ?? null, p?.[1] ?? null, p?.[2] ?? null, e.payment_method],
    };
  });
  return batch([...before, ...ledgerStatements]);
}

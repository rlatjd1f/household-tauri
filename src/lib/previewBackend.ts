// 브라우저 미리보기 전용 백엔드: Tauri 없이 화면을 확인할 수 있도록
// Rust의 db_select / db_execute / db_batch를 메모리 SQLite(sql.js)로 흉내 낸다.
// 실제 앱(Tauri)에서는 불러오지 않는다.
import initSqlJs, { type Database, type SqlValue } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm.wasm?url";

type Params = (string | number | null)[];
let dbPromise: Promise<Database> | null = null;

const getDb = () => (dbPromise ??= initSqlJs({ locateFile: () => wasmUrl }).then((SQL) => new SQL.Database()));

function select(db: Database, sql: string, params: Params) {
  const stmt = db.prepare(sql);
  try {
    stmt.bind(params as SqlValue[]);
    const rows: Record<string, unknown>[] = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    return rows;
  } finally {
    stmt.free();
  }
}

function run(db: Database, sql: string, params: Params) {
  db.run(sql, params as SqlValue[]);
  const changes = db.getRowsModified();
  const [{ id }] = select(db, "SELECT last_insert_rowid() AS id", []) as { id: number }[];
  return { changes, last_insert_id: id };
}

export async function previewInvoke(cmd: string, args: Record<string, any>): Promise<any> {
  const db = await getDb();
  switch (cmd) {
    case "db_path_string": return "(브라우저 미리보기 - 메모리 DB)";
    case "db_select": return select(db, args.sql, args.params);
    case "db_execute": return run(db, args.sql, args.params);
    case "db_batch": {
      db.run("BEGIN");
      try {
        let total = 0;
        for (const st of args.statements) total += run(db, st.sql, st.params).changes;
        db.run("COMMIT");
        return total;
      } catch (e) {
        db.run("ROLLBACK");
        throw e;
      }
    }
  }
  throw new Error(`미리보기에서 지원하지 않는 명령: ${cmd}`);
}

/** 미리보기용 예시 데이터 (빈 DB일 때만) */
export async function seedPreview(execute: (sql: string, params?: Params) => Promise<unknown>) {
  const year = new Date().getFullYear();
  const cats: [string, string, string, string | null][] = [
    ["소비", "식비", "식재료", "#ccff90"], ["소비", "식비", "외식", null], ["소비", "쇼핑", "생필품", null],
    ["소비", "고정지출(주거)", "관리비", "#cbf0f8"], ["소비", "고정지출(주거)", "월세", null], ["소비", "이자", "일반대출", null],
    ["소득", "근로", "월급", null], ["소득", "부수입", "블로그", null],
    ["결제수단", "신용카드", "성카드", null], ["결제수단", "은행", "우리은행", null], ["결제수단", "현금", "현금", null],
    ["자본", "자본", "예금", null],
  ];
  for (const [t, p, s, c] of cats) {
    await execute("INSERT OR IGNORE INTO categories (household_id, type, parent_category, sub_category, color) VALUES (1, $1, $2, $3, $4)", [t, p, s, c]);
  }
  await execute("INSERT OR IGNORE INTO assets (household_id, asset_name, initial_balance, current_balance) VALUES (1, '자본금', 32735000, 32735000)");
  for (let m = 1; m <= 12; m++) {
    for (const [name, amount] of [["식비", 300000], ["고정지출(주거)", 400000], ["쇼핑", 100000]] as const) {
      await execute("INSERT OR IGNORE INTO budgets (household_id, year, month, category_name, amount) VALUES (1, $1, $2, $3, $4)", [year, m, name, amount]);
    }
  }
  const rows: [number, number, string, string, string, string, string, number, string, string][] = [
    [3, 1, "지출", "소비|쇼핑|생필품", "은행", "우리은행", "다이소", 16000, "샤워커튼 / 면봉", ""],
    [3, 1, "지출", "소비|식비|식재료", "신용카드", "성카드", "쿠팡", 16320, "계란", ""],
    [3, 11, "지출", "소비|이자|일반대출", "은행", "우리은행", "", 204123, "", ""],
    [3, 11, "지출", "소비|고정지출(주거)|월세", "은행", "우리은행", "", 150000, "", ""],
    [3, 25, "지출", "소비|고정지출(주거)|관리비", "은행", "우리은행", "", 157070, "", ""],
    [3, 28, "지출", "소비|식비|외식", "신용카드", "성카드", "트레이더스", 65900, "만두 / 두부", ""],
    [3, 25, "수입", "소득|근로|월급", "", "", "회사", 3000000, "", ""],
    [2, 10, "지출", "소비|식비|식재료", "현금", "현금", "망원시장", 23000, "", ""],
  ];
  for (const [m, d, type, key, pm, an, payee, amount, memo] of rows) {
    const [t, p, s] = key.split("|");
    const date = `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    await execute(`INSERT INTO ledgers (household_id, date, type, category_id, asset_id, amount, memo, payee, payment_method)
      VALUES (1, $1, $2,
        (SELECT id FROM categories WHERE household_id = 1 AND type = $3 AND parent_category = $4 AND sub_category = $5),
        (SELECT id FROM categories WHERE household_id = 1 AND type = '결제수단' AND parent_category = $6 AND sub_category = $7),
        $8, $9, $10, $6)`, [date, type, t, p, s, pm, an, amount, memo, payee]);
  }
}

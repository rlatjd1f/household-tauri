// 데이터베이스 접근만 Rust에서 담당하고, 앱 로직은 프런트엔드(TypeScript)에 둔다.
// SQLite 연결 하나를 Mutex로 공유해 여러 쿼리를 한 트랜잭션으로 묶을 수 있게 한다.
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value};
use std::path::PathBuf;
use std::sync::Mutex;

const APP_DIR_NAME: &str = "HouseholdManager";
const DB_FILENAME: &str = "household.db";

struct Db(Mutex<Option<Connection>>);

/// 기존 Python 앱과 같은 위치의 DB를 사용한다.
/// Windows: %LOCALAPPDATA%\HouseholdManager, macOS: ~/Library/Application Support/HouseholdManager,
/// 그 외: $XDG_DATA_HOME 또는 ~/.local/share. HOUSEHOLD_DB_PATH가 있으면 그 경로를 우선 사용(테스트용).
fn db_path() -> Result<PathBuf, String> {
    if let Ok(path) = std::env::var("HOUSEHOLD_DB_PATH") {
        if !path.is_empty() {
            return Ok(PathBuf::from(path));
        }
    }
    let home = || std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")).map(PathBuf::from);
    let base = if cfg!(target_os = "windows") {
        std::env::var("LOCALAPPDATA")
            .map(PathBuf::from)
            .or_else(|_| home().map(|h| h.join("AppData").join("Local")))
    } else if cfg!(target_os = "macos") {
        home().map(|h| h.join("Library").join("Application Support"))
    } else {
        std::env::var("XDG_DATA_HOME")
            .map(PathBuf::from)
            .or_else(|_| home().map(|h| h.join(".local").join("share")))
    }
    .map_err(|_| "사용자 데이터 폴더를 찾을 수 없습니다.".to_string())?;
    Ok(base.join(APP_DIR_NAME).join(DB_FILENAME))
}

fn to_sql(value: &Value) -> SqlValue {
    match value {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(*b as i64),
        Value::Number(n) => match n.as_i64() {
            Some(i) => SqlValue::Integer(i),
            None => SqlValue::Real(n.as_f64().unwrap_or(0.0)),
        },
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

fn to_json(value: ValueRef) -> Value {
    match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => Value::Number(i.into()),
        ValueRef::Real(f) => Number::from_f64(f).map(Value::Number).unwrap_or(Value::Null),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(_) => Value::Null,
    }
}

fn with_conn<T>(state: &tauri::State<Db>, f: impl FnOnce(&mut Connection) -> Result<T, String>) -> Result<T, String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if guard.is_none() {
        let path = db_path()?;
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        *guard = Some(open_db(&path)?);
    }
    f(guard.as_mut().unwrap())
}

/// 내장 SQLite는 외래 키 검사가 기본으로 켜져 있음.
/// 가계부 내역의 asset_id에는 자산이 아니라 결제수단 분류 id가 들어가므로(기존 앱과 같은 구조)
/// 기존 파이썬 앱처럼 외래 키 검사를 끔
fn open_db(path: &std::path::Path) -> Result<Connection, String> {
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    conn.pragma_update(None, "foreign_keys", false).map_err(|e| e.to_string())?;
    Ok(conn)
}

fn select_rows(conn: &Connection, sql: &str, params: &[Value]) -> Result<Vec<Map<String, Value>>, String> {
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let mut rows = stmt
        .query(params_from_iter(params.iter().map(to_sql)))
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    while let Some(row) = rows.next().map_err(|e| e.to_string())? {
        let mut obj = Map::new();
        for (i, name) in names.iter().enumerate() {
            obj.insert(name.clone(), to_json(row.get_ref(i).map_err(|e| e.to_string())?));
        }
        out.push(obj);
    }
    Ok(out)
}

#[derive(Serialize)]
struct ExecResult {
    changes: usize,
    last_insert_id: i64,
}

#[derive(Deserialize)]
struct Statement {
    sql: String,
    #[serde(default)]
    params: Vec<Value>,
}

#[tauri::command]
fn db_path_string() -> Result<String, String> {
    db_path().map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn db_select(state: tauri::State<Db>, sql: String, params: Vec<Value>) -> Result<Vec<Map<String, Value>>, String> {
    with_conn(&state, |conn| select_rows(conn, &sql, &params))
}

#[tauri::command]
fn db_execute(state: tauri::State<Db>, sql: String, params: Vec<Value>) -> Result<ExecResult, String> {
    with_conn(&state, |conn| {
        let changes = conn
            .execute(&sql, params_from_iter(params.iter().map(to_sql)))
            .map_err(|e| e.to_string())?;
        Ok(ExecResult { changes, last_insert_id: conn.last_insert_rowid() })
    })
}

/// 여러 문장을 한 트랜잭션으로 실행한다. 하나라도 실패하면 모두 되돌린다.
#[tauri::command]
fn db_batch(state: tauri::State<Db>, statements: Vec<Statement>) -> Result<usize, String> {
    with_conn(&state, |conn| {
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        let mut total = 0;
        for st in &statements {
            total += tx
                .execute(&st.sql, params_from_iter(st.params.iter().map(to_sql)))
                .map_err(|e| format!("{e} (SQL: {})", st.sql))?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(total)
    })
}

/// 엑셀 가져오기: 사용자가 파일 선택 창에서 고른 파일을 읽음
#[tauri::command]
fn read_file_bytes(path: String) -> Result<tauri::ipc::Response, String> {
    std::fs::read(&path).map(tauri::ipc::Response::new).map_err(|e| format!("파일을 읽을 수 없습니다: {e}"))
}

/// 엑셀 내보내기: 사용자가 저장 창에서 고른 경로에 씀
#[tauri::command]
fn write_file_bytes(path: String, data: Vec<u8>) -> Result<(), String> {
    std::fs::write(&path, data).map_err(|e| format!("파일을 저장할 수 없습니다: {e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(Db(Mutex::new(None)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            db_path_string, db_select, db_execute, db_batch, read_file_bytes, write_file_bytes
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ledger_can_store_payment_category_id_in_asset_id() {
        let path = std::env::temp_dir().join(format!("household-fk-test-{}.db", std::process::id()));
        let _ = std::fs::remove_file(&path);
        let conn = open_db(&path).unwrap();
        conn.execute_batch(
            "CREATE TABLE assets (id INTEGER PRIMARY KEY);
             CREATE TABLE ledgers (id INTEGER PRIMARY KEY, asset_id INTEGER,
                FOREIGN KEY (asset_id) REFERENCES assets (id));
             INSERT INTO ledgers (asset_id) VALUES (999);",
        )
        .unwrap();
        drop(conn);
        std::fs::remove_file(&path).unwrap();
    }
}

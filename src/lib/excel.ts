// 엑셀 내보내기/가져오기 (기존 앱 migration_util.py와 같은 시트 구성)
import type ExcelJS from "exceljs";
import { getExportData, type CategoryType, type EntryType, type ImportData } from "./db";
import { pad2 } from "./format";

const loadExcel = async () => (await import("exceljs")).default;

const TYPE_ORDER: CategoryType[] = ["소비", "결제수단", "소득", "자본"];
const TYPE_TITLES: Record<CategoryType, string> = { 소비: "소비 분류", 결제수단: "결제분류", 소득: "소득 분류", 자본: "자본, 부채 분류" };
const SECTION_TITLES = ["연도 설정", "소비 분류", "결제분류", "소득 분류", "자본, 부채 분류"];
const LEDGER_HEADERS = ["소비날짜", "결제수단", "수단명", "대분류", "항목", "지출금액", "사용처", "코멘트", null,
  "소득날짜", "대분류", "항목", "소득 금액", "소득처", "코멘트"];

// --- 공통 ---
const solid = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

/** 수식은 계산 결과, 서식 있는 글자는 글자만 꺼냄 */
function plain(value: ExcelJS.CellValue): string | number | Date | null {
  if (value == null) return null;
  if (value instanceof Date || typeof value === "number" || typeof value === "string") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if ("result" in value) return plain(value.result as ExcelJS.CellValue);
  if ("richText" in value) return value.richText.map((t) => t.text).join("");
  if ("text" in value) return String(value.text);
  return null;
}

const text = (value: ExcelJS.CellValue) => { const v = plain(value); return v == null ? "" : v instanceof Date ? formatDate(v) : String(v).trim(); };

function toInt(value: ExcelJS.CellValue): number | null {
  const v = plain(value);
  if (v == null || v === "" || v instanceof Date) return null;
  const n = Number(String(v).replace(/,/g, "").trim());
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

// 엑셀 날짜는 UTC 기준으로 저장됨
const formatDate = (d: Date) => `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;

/** '2026-03-05', '3/5', '5'(그 달의 5일), 엑셀 날짜 → 'YYYY-MM-DD' */
export function parseExcelDate(value: ExcelJS.CellValue, year: number, fallbackMonth?: number): string | null {
  const v = plain(value);
  if (v == null) return null;
  if (v instanceof Date) return formatDate(v);
  const s = String(v).trim();
  if (!s) return null;
  let m = /(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${pad2(Number(m[2]))}-${pad2(Number(m[3]))}`;
  m = /(\d{1,2})\s*[./]\s*(\d{1,2})/.exec(s);
  if (m) return `${year}-${pad2(Number(m[1]))}-${pad2(Number(m[2]))}`;
  if (/^\d{1,2}$/.test(s) && fallbackMonth) return `${year}-${pad2(fallbackMonth)}-${pad2(Number(s))}`;
  return s;
}

/** 셀 배경색(단색 채우기)을 '#rrggbb'로. 채우기가 없거나 테마 색이면 null */
function fillColor(cell: ExcelJS.Cell): string | null {
  const fill = cell.fill;
  if (fill?.type !== "pattern" || fill.pattern !== "solid") return null;
  const argb = fill.fgColor?.argb;
  if (!argb || !/^[0-9A-Fa-f]{8}$/.test(argb)) return null;
  const color = `#${argb.slice(2).toLowerCase()}`;
  // 흰색 배경은 색을 지정하지 않은 것으로 봄
  return color === "#ffffff" ? null : color;
}

/** 병합된 셀 중 첫 칸이 아닌 칸 (exceljs는 병합 범위의 모든 칸에 첫 칸 값을 돌려줌) */
const isMergedFollower = (cell: ExcelJS.Cell) => cell.isMerged && cell.master.address !== cell.address;

function rowValues(row: ExcelJS.Row): ExcelJS.CellValue[] {
  // exceljs의 row.values는 1번 열부터 시작하므로 0번을 버림
  const values = (row.values as ExcelJS.CellValue[]).slice(1);
  return values;
}

// --- 내보내기 ---
function titleRow(sheet: ExcelJS.Worksheet, title: string, maxCol: number) {
  sheet.mergeCells(1, 1, 1, maxCol);
  const cell = sheet.getCell(1, 1);
  cell.value = title;
  cell.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  cell.fill = solid("FF4F81BD");
  cell.alignment = { horizontal: "center" };
}

function headers(sheet: ExcelJS.Worksheet, row: number, values: (string | null)[]) {
  values.forEach((h, i) => {
    const cell = sheet.getCell(row, i + 1);
    cell.value = h;
    if (h) {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = solid("FF5B7DB1");
      cell.alignment = { horizontal: "center" };
    }
  });
}

const widths = (sheet: ExcelJS.Worksheet, w: Record<number, number>) => { for (const [c, v] of Object.entries(w)) sheet.getColumn(Number(c)).width = v; };

export async function buildExportWorkbook(hid: number, year: number): Promise<Uint8Array> {
  const Excel = await loadExcel();
  const { categories, budgets, assets, ledgers } = await getExportData(hid, year);
  const wb = new Excel.Workbook();

  // 설정하기: 대분류 행마다 중분류를 옆 칸에 쓰고, 중분류 색상은 셀 배경색으로 저장
  const settings = wb.addWorksheet("설정하기");
  titleRow(settings, "설정하기", 12);
  settings.getCell(2, 1).value = "연도 설정";
  settings.getCell(2, 3).value = year;
  let row = 4;
  for (const type of TYPE_ORDER) {
    const parents = new Map<string, { sub: string; color: string | null }[]>();
    for (const c of categories.filter((c) => c.type === type)) {
      if (!parents.has(c.parent_category)) parents.set(c.parent_category, []);
      const subs = parents.get(c.parent_category)!;
      if (!subs.some((s) => s.sub === c.sub_category)) subs.push({ sub: c.sub_category, color: c.color });
    }
    if (!parents.size) continue;
    const section = settings.getCell(row, 1);
    section.value = TYPE_TITLES[type];
    section.font = { bold: true, color: { argb: "FFFFFFFF" } };
    section.fill = solid("FF70AD47");
    row++;
    for (const [parent, subs] of parents) {
      settings.getCell(row, 1).value = parent;
      settings.getCell(row, 2).value = subs.map((s) => s.sub).join(",");
      subs.forEach((s, i) => {
        const cell = settings.getCell(row, i + 3);
        cell.value = s.sub;
        if (s.color && /^#[0-9a-fA-F]{6}$/.test(s.color)) cell.fill = solid(`FF${s.color.slice(1).toUpperCase()}`);
      });
      row++;
    }
    row++;
  }
  widths(settings, { 1: 18, 2: 36, 3: 16, 4: 16, 5: 16, 6: 16, 7: 16, 8: 16 });

  // 예산 설정
  const budgetSheet = wb.addWorksheet("예산 설정");
  const parents: string[] = [];
  for (const c of categories) if (c.type === "소비" && !parents.includes(c.parent_category)) parents.push(c.parent_category);
  for (const b of budgets) if (!parents.includes(b.category_name)) parents.push(b.category_name);
  const budgetHeaders = ["총 예산", "월＼대분류", ...parents];
  headers(budgetSheet, 1, budgetHeaders);
  const budgetMap = new Map(budgets.map((b) => [`${b.month}|${b.category_name}`, b.amount]));
  const lastCol = budgetSheet.getColumn(budgetHeaders.length).letter;
  for (let m = 1; m <= 12; m++) {
    const r = m + 2;
    budgetSheet.getCell(r, 1).value = { formula: `SUM(C${r}:${lastCol}${r})` };
    budgetSheet.getCell(r, 2).value = `${m}월`;
    parents.forEach((p, i) => {
      const cell = budgetSheet.getCell(r, i + 3);
      cell.value = budgetMap.get(`${m}|${p}`) ?? 0;
      cell.numFmt = "#,##0";
    });
  }
  widths(budgetSheet, { 1: 14, 2: 12, ...Object.fromEntries(parents.map((_, i) => [i + 3, 16])) });

  // 자산 관리
  const assetSheet = wb.addWorksheet("자산 관리");
  titleRow(assetSheet, "자산 관리", 5);
  headers(assetSheet, 3, ["자산명", "초기 금액", "현재 금액", null, "자본금"]);
  let capital = 0;
  assets.forEach((a, i) => {
    const r = i + 4;
    assetSheet.getCell(r, 1).value = a.asset_name;
    assetSheet.getCell(r, 2).value = a.initial_balance || 0;
    assetSheet.getCell(r, 3).value = a.current_balance || 0;
    assetSheet.getCell(r, 2).numFmt = assetSheet.getCell(r, 3).numFmt = "#,##0";
    if (a.asset_name === "자본금") capital = a.initial_balance || a.current_balance || 0;
  });
  if (!capital) capital = assets.reduce((s, a) => s + (a.initial_balance || 0), 0);
  assetSheet.getCell(3, 6).value = capital;
  assetSheet.getCell(3, 6).numFmt = "#,##0";
  widths(assetSheet, { 1: 18, 2: 14, 3: 14, 5: 12, 6: 14 });

  // 1~12월
  for (let m = 1; m <= 12; m++) {
    const sheet = wb.addWorksheet(`${m}월`);
    const cells: [string, ExcelJS.CellValue][] = [
      ["A1", `${m}월 - 소비 · 소득`], ["C1", "월 예산 :"], ["D1", { formula: `'예산 설정'!A${m + 2}` } as ExcelJS.CellFormulaValue],
      ["E1", "현재 지출 :"], ["F1", { formula: "SUM(F4:F996)" } as ExcelJS.CellFormulaValue], ["G1", "예산 :"],
      ["H1", { formula: 'IF(D1=0,"-",D1-F1)' } as ExcelJS.CellFormulaValue], ["L1", "현재 소득 :"], ["M1", { formula: "SUM(M4:M996)" } as ExcelJS.CellFormulaValue],
    ];
    for (const [addr, v] of cells) sheet.getCell(addr).value = v;
    headers(sheet, 3, LEDGER_HEADERS);
    const monthRows = ledgers.filter((l) => parseExcelDate(l.date, year)?.slice(5, 7) === pad2(m));
    const expenses = monthRows.filter((l) => l.type === "지출");
    const incomes = monthRows.filter((l) => l.type === "수입");
    for (let i = 0; i < Math.max(expenses.length, incomes.length); i++) {
      const r = i + 4;
      const e = expenses[i];
      if (e) {
        [parseExcelDate(e.date, year, m), e.payment_method || e.payment_parent || "", e.payment_name ?? "", e.parent_category ?? "",
          e.sub_category ?? "", e.amount || 0, e.payee ?? "", e.memo ?? ""].forEach((v, c) => (sheet.getCell(r, c + 1).value = v));
        sheet.getCell(r, 6).numFmt = "#,##0";
      }
      const n = incomes[i];
      if (n) {
        [parseExcelDate(n.date, year, m), n.parent_category ?? "", n.sub_category ?? "", n.amount || 0, n.payee ?? "", n.memo ?? ""]
          .forEach((v, c) => (sheet.getCell(r, c + 10).value = v));
        sheet.getCell(r, 13).numFmt = "#,##0";
      }
    }
    widths(sheet, { 1: 13, 2: 12, 3: 14, 4: 16, 5: 14, 6: 12, 7: 16, 8: 20, 9: 4, 10: 13, 11: 14, 12: 14, 13: 12, 14: 16, 15: 20 });
  }

  return new Uint8Array(await wb.xlsx.writeBuffer());
}

// --- 가져오기 ---
function importYear(wb: ExcelJS.Workbook): number {
  const sheet = wb.getWorksheet("설정하기");
  let found: number | null = null;
  sheet?.eachRow((row) => {
    if (found) return;
    const values = rowValues(row);
    const idx = values.findIndex((v) => text(v) === "연도 설정");
    if (idx >= 0) found = values.slice(idx + 1).map(toInt).find((v) => v) ?? null;
  });
  return found ?? new Date().getFullYear();
}

/** 엑셀을 DB에 반영하기 전에 모두 읽어 둠 (읽다가 오류가 나도 기존 데이터는 그대로) */
export async function parseWorkbook(bytes: Uint8Array): Promise<{ year: number; data: ImportData }> {
  const Excel = await loadExcel();
  const wb = new Excel.Workbook();
  await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const year = importYear(wb);
  const data: ImportData = { categories: [], budgets: [], assets: [], ledgers: [] };

  const settings = wb.getWorksheet("설정하기");
  let currentType: CategoryType = "소비";
  settings?.eachRow((row) => {
    const first = text(row.getCell(1).value);
    if (!first || first === "설정하기") return;
    if (first.includes("소비 분류")) currentType = "소비";
    else if (first.includes("소득 분류")) currentType = "소득";
    else if (first.includes("결제분류")) currentType = "결제수단";
    else if (first.includes("자본") && first.includes("부채")) currentType = "자본";
    if (SECTION_TITLES.includes(first) || !text(row.getCell(3).value)) return;
    for (let c = 3; c <= row.cellCount; c++) {
      const cell = row.getCell(c);
      if (isMergedFollower(cell)) continue;
      const sub = text(cell.value);
      if (sub) data.categories.push({ type: currentType, parent: first, sub, color: fillColor(cell) });
    }
  });

  const budgetSheet = wb.getWorksheet("예산 설정");
  if (budgetSheet) {
    const headerRow = budgetSheet.getRow(1);
    budgetSheet.eachRow((row, r) => {
      if (r < 3) return;
      const label = text(row.getCell(2).value);
      if (!label.includes("월")) return;
      const month = toInt(label.replace("월", ""));
      if (!month || month < 1 || month > 12) return;
      for (let c = 3; c <= Math.max(row.cellCount, headerRow.cellCount); c++) {
        const name = text(headerRow.getCell(c).value);
        const amount = toInt(row.getCell(c).value);
        if (name && amount) data.budgets.push({ month, name, amount });
      }
    });
  }

  const assetSheet = wb.getWorksheet("자산 관리");
  let capitalFound = false;
  assetSheet?.eachRow((row) => {
    if (capitalFound) return;
    const values = rowValues(row);
    const idx = values.findIndex((v) => text(v) === "자본금");
    if (idx < 0) return;
    const amount = values.slice(idx + 1).map(toInt).find((v) => v != null);
    if (amount != null) { data.assets.push({ name: "자본금", amount }); capitalFound = true; }
  });

  for (let m = 1; m <= 12; m++) {
    const sheet = wb.getWorksheet(`${m}월`);
    if (!sheet) continue;
    let headerRowIndex = 0, es = -1, ins = -1;
    sheet.eachRow((row, r) => {
      if (headerRowIndex) return;
      const values = rowValues(row).map(text);
      if (values.includes("소비날짜") && values.includes("소득날짜")) {
        headerRowIndex = r; es = values.indexOf("소비날짜") + 1; ins = values.indexOf("소득날짜") + 1;
      }
    });
    if (!headerRowIndex) continue;
    sheet.eachRow((row, r) => {
      if (r <= headerRowIndex) return;
      const cell = (c: number) => row.getCell(c).value;
      const expenseAmount = toInt(cell(es + 5));
      if (text(cell(es)) && expenseAmount) {
        const pm = text(cell(es + 1)), an = text(cell(es + 2));
        data.ledgers.push({
          date: parseExcelDate(cell(es), year, m) ?? "", type: "지출" as EntryType,
          category: ["소비", text(cell(es + 3)), text(cell(es + 4))], payment: ["결제수단", pm, an],
          amount: expenseAmount, payee: text(cell(es + 6)), memo: text(cell(es + 7)), payment_method: pm,
        });
      }
      const incomeAmount = toInt(cell(ins + 3));
      if (text(cell(ins)) && incomeAmount) {
        data.ledgers.push({
          date: parseExcelDate(cell(ins), year, m) ?? "", type: "수입" as EntryType,
          category: ["소득", text(cell(ins + 1)), text(cell(ins + 2))], payment: null,
          amount: incomeAmount, payee: text(cell(ins + 4)), memo: text(cell(ins + 5)), payment_method: "",
        });
      }
    });
  }
  return { year, data };
}

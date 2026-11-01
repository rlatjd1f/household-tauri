<script lang="ts">
  // 월별 가계부의 지출/소득 표 (AG Grid). 저장 방식은 기존 앱과 같이 행별 저장(✅/❓) + 모두 저장.
  import { onDestroy, onMount } from "svelte";
  import {
    AllCommunityModule, ModuleRegistry, createGrid,
    type CellKeyDownEvent, type ColDef, type GridApi, type ICellRendererParams, type IRowNode,
  } from "ag-grid-community";
  import { gridTheme } from "$lib/gridTheme";
  import { app } from "$lib/state.svelte";
  import {
    addLedgerEntry, updateLedgerEntry, deleteLedgerEntry,
    type Category, type CategoryType, type EntryType, type LedgerEntry, type LedgerInput,
  } from "$lib/db";
  import { formatNumber, pad2, parseAmount, textColorFor } from "$lib/format";
  import { alertDialog, confirmDialog, showNotice } from "$lib/dialogs.svelte";

  ModuleRegistry.registerModules([AllCommunityModule]);

  export interface LedgerRow {
    key: number; id: number | null; isNew: boolean; dirty: boolean;
    date: string; pm: string; an: string; parent: string; sub: string; amount: number; payee: string; memo: string;
  }

  let { type, month, entries, categories, onchange }: {
    type: EntryType; month: number; entries: LedgerEntry[]; categories: Category[];
    /** 합계/저장 상태가 바뀌었을 때 (상단 요약 갱신용) */
    onchange: () => void;
  } = $props();

  // 표 종류(type)는 화면을 만드는 동안 바뀌지 않음
  // svelte-ignore state_referenced_locally
  const catType: CategoryType = type === "지출" ? "소비" : "소득";
  let el: HTMLDivElement;
  let api: GridApi<LedgerRow> | undefined;
  let nextKey = 1;
  let lastAmountInvalid = false;

  const byType = (t: CategoryType) => categories.filter((c) => c.type === t);
  const parentsOf = (t: CategoryType) => [...new Set(byType(t).map((c) => c.parent_category))].sort((a, b) => a.localeCompare(b, "ko"));
  const subsOf = (t: CategoryType, parent: string) => byType(t).filter((c) => c.parent_category === parent).map((c) => c.sub_category);
  const findCat = (t: CategoryType, parent: string, sub: string) =>
    categories.find((c) => c.type === t && c.parent_category === parent && c.sub_category === sub) ?? null;

  const toRow = (e: LedgerEntry): LedgerRow => ({
    key: nextKey++, id: e.id, isNew: false, dirty: false, date: e.date,
    pm: e.payment_method ?? "", an: e.asset_name ?? "", parent: e.parent_category ?? "", sub: e.sub_category ?? "",
    amount: e.amount, payee: e.payee ?? "", memo: e.memo ?? "",
  });

  const isThisMonth = (date: string) => date.startsWith(`${app.year}-${pad2(month)}-`);

  function defaultDate() {
    const today = new Date();
    const day = today.getFullYear() === app.year && today.getMonth() + 1 === month ? today.getDate() : 1;
    return `${app.year}-${pad2(month)}-${pad2(day)}`;
  }

  const selectCol = (field: keyof LedgerRow, headerName: string, values: (r: LedgerRow) => string[], minWidth: number): ColDef<LedgerRow> => ({
    field, headerName, flex: minWidth, minWidth, cellEditor: "agSelectCellEditor",
    cellEditorParams: (p: { data: LedgerRow }) => ({ values: ["", ...values(p.data)] }),
    // 드롭다운은 한 번 클릭으로 바로 열고, 셀에 ▾ 표시
    singleClickEdit: true, cellClass: "select-cell",
    tooltipField: field,
  });

  function statusRenderer(p: ICellRendererParams<LedgerRow>) {
    const button = document.createElement("button");
    button.className = "status";
    button.textContent = p.data?.dirty ? "❓" : "✅";
    button.title = p.data?.dirty ? "저장하지 않음 (클릭해서 저장)" : "저장됨";
    button.onclick = () => p.node && saveNode(p.node);
    return button;
  }

  function columnDefs(): ColDef<LedgerRow>[] {
    const date: ColDef<LedgerRow> = {
      field: "date", headerName: type === "지출" ? "소비날짜" : "소득날짜", flex: 100, minWidth: 112,
      cellEditor: "agDateStringCellEditor", sort: "asc",
      // 저장하지 않은 새 행은 맨 아래, 나머지는 날짜 → 입력 순서
      comparator: (a: string, b: string, na: IRowNode<LedgerRow>, nb: IRowNode<LedgerRow>) =>
        Number(na.data!.isNew) - Number(nb.data!.isNew) || a.localeCompare(b) || na.data!.key - nb.data!.key,
    };
    const amount: ColDef<LedgerRow> = {
      field: "amount", headerName: type === "지출" ? "지출금액" : "소득 금액", flex: 95, minWidth: 104, type: "rightAligned",
      // 숫자 전용 편집기는 '12,000원'이나 잘못된 입력을 그냥 버리므로, 글자로 받아 parseAmount로 해석
      cellDataType: false, cellEditor: "agTextCellEditor",
      valueFormatter: (p) => formatNumber(p.value),
      // AG Grid는 입력하는 동안에도 값을 해석하므로 여기서는 결과만 기록하고, 안내는 편집이 끝난 뒤 표시
      valueParser: (p) => {
        const v = parseAmount(p.newValue);
        lastAmountInvalid = v === null;
        return v === null ? p.oldValue : v;
      },
    };
    const status: ColDef<LedgerRow> = {
      colId: "status", headerName: "저장", width: 60, minWidth: 60, editable: false, cellRenderer: statusRenderer,
      cellClass: "status-cell", headerClass: "status-header",
    };
    if (type === "지출") {
      return [
        date,
        selectCol("pm", "결제수단", () => parentsOf("결제수단"), 85),
        selectCol("an", "수단명", (r) => subsOf("결제수단", r.pm), 90),
        selectCol("parent", "대분류", () => parentsOf("소비"), 110),
        selectCol("sub", "항목", (r) => subsOf("소비", r.parent), 90),
        amount,
        { field: "payee", headerName: "사용처", flex: 100, minWidth: 80, tooltipField: "payee" },
        { field: "memo", headerName: "코멘트", flex: 160, minWidth: 100, tooltipField: "memo" },
        status,
      ];
    }
    return [
      date,
      selectCol("parent", "대분류", () => parentsOf("소득"), 85),
      selectCol("sub", "항목", (r) => subsOf("소득", r.parent), 80),
      amount,
      { field: "payee", headerName: "소득처", flex: 90, minWidth: 80, tooltipField: "payee" },
      status,
    ];
  }

  function refreshStatus(node: IRowNode<LedgerRow>) {
    api?.refreshCells({ rowNodes: [node], columns: ["status"], force: true });
  }

  const allRows = () => { const rows: LedgerRow[] = []; api?.forEachNode((n) => n.data && rows.push(n.data)); return rows; };
  const visibleRows = () => { const rows: LedgerRow[] = []; api?.forEachNodeAfterFilter((n) => n.data && rows.push(n.data)); return rows; };

  export const total = (visibleOnly = false) => (visibleOnly ? visibleRows() : allRows()).reduce((s, r) => s + (r.amount || 0), 0);
  export const isFiltered = () => visibleRows().length !== allRows().length;
  export const hasUnsaved = () => allRows().some((r) => r.dirty);
  export const setFilter = (text: string) => { api?.setGridOption("quickFilterText", text); onchange(); };

  export function addRow() {
    if (!api) return;
    const row: LedgerRow = { key: nextKey++, id: null, isNew: true, dirty: true, date: defaultDate(), pm: "", an: "", parent: "", sub: "", amount: 0, payee: "", memo: "" };
    const [node] = api.applyTransaction({ add: [row] })?.add ?? [];
    if (node?.rowIndex != null) {
      api.ensureIndexVisible(node.rowIndex);
      api.setFocusedCell(node.rowIndex, "date");
    }
    onchange();
  }

  export async function deleteSelected() {
    const nodes = api?.getSelectedNodes() ?? [];
    if (!nodes.length) return alertDialog("안내", "삭제할 행을 먼저 선택하세요.");
    if (!(await confirmDialog("삭제 확인", `선택한 ${nodes.length}개 행을 삭제하시겠습니까?`, { okText: "삭제", danger: true }))) return;
    for (const n of nodes) if (n.data?.id) await deleteLedgerEntry(n.data.id);
    api?.applyTransaction({ remove: nodes.map((n) => n.data!) });
    onchange();
  }

  /** 분류가 없거나 다른 달 날짜일 때 저장 전에 확인 */
  async function confirmSave(r: LedgerRow, catId: number | null, payId: number | null) {
    const notes: string[] = [];
    if (catId == null) {
      notes.push(r.parent || r.sub
        ? `'${r.parent} > ${r.sub}' 분류가 설정에 없어 분류 없이 저장됩니다.`
        : "대분류/항목이 비어 있어 분류 없이 저장됩니다. (리포트 분류별 통계에서 빠집니다)");
    }
    if (type === "지출" && (r.pm || r.an) && payId == null) notes.push(`'${r.pm} > ${r.an}' 결제수단이 설정에 없습니다.`);
    if (!isThisMonth(r.date)) notes.push(`날짜가 ${r.date.slice(0, 4)}년 ${Number(r.date.slice(5, 7))}월이라 저장하면 해당 월 가계부로 이동합니다.`);
    if (!notes.length) return true;
    return confirmDialog("저장 확인", `${r.date} 내역\n\n${notes.map((n) => `• ${n}`).join("\n")}\n\n그대로 저장할까요?`);
  }

  async function saveNode(node: IRowNode<LedgerRow>): Promise<boolean> {
    const r = node.data;
    if (!r || !api) return false;
    api.stopEditing();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date ?? "")) { await alertDialog("저장 실패", "날짜를 입력해 주세요."); return false; }
    const cat = findCat(catType, r.parent, r.sub);
    const pay = type === "지출" ? findCat("결제수단", r.pm, r.an) : null;
    if (!(await confirmSave(r, cat?.id ?? null, pay?.id ?? null))) return false;
    const input: LedgerInput = {
      date: r.date, type, category_id: cat?.id ?? null, asset_id: pay?.id ?? null,
      amount: r.amount, memo: type === "지출" ? r.memo : "", payee: r.payee, payment_method: type === "지출" ? r.pm : "",
    };
    try {
      if (r.id) await updateLedgerEntry(r.id, input);
      else r.id = await addLedgerEntry(app.householdId!, input);
    } catch (e) {
      await alertDialog("저장 실패", `저장 중 오류 발생: ${e}`);
      return false;
    }
    if (!isThisMonth(r.date)) {
      api.applyTransaction({ remove: [r] });
    } else {
      r.dirty = false; r.isNew = false;
      api.refreshClientSideRowModel("sort");
      refreshStatus(node);
      if (node.rowIndex != null) api.ensureIndexVisible(node.rowIndex);
    }
    onchange();
    return true;
  }

  /** 저장하지 않은 행을 모두 저장하고 [저장, 실패] 건수를 반환 */
  export async function saveAll(): Promise<[number, number]> {
    const nodes: IRowNode<LedgerRow>[] = [];
    api?.forEachNodeAfterFilterAndSort((n) => n.data?.dirty && nodes.push(n));
    let saved = 0, failed = 0;
    for (const n of nodes) (await saveNode(n)) ? saved++ : failed++;
    return [saved, failed];
  }

  function onCellKeyDown(e: CellKeyDownEvent<LedgerRow>) {
    const key = (e.event as KeyboardEvent | undefined)?.key;
    if (key !== "Enter" || e.rowIndex == null || !api) return;
    // 마지막 행에서 엔터 → 새 행 추가 후 같은 열로 이동 (편집 중이면 편집을 마친 뒤)
    if (e.rowIndex === api.getDisplayedRowCount() - 1) {
      const col = e.column.getColId();
      setTimeout(() => {
        if (api!.getEditingCells().length) return;
        addRow();
        api!.setFocusedCell(api!.getDisplayedRowCount() - 1, col === "status" ? "date" : col);
      }, 0);
    }
  }

  onMount(() => {
    api = createGrid<LedgerRow>(el, {
      theme: gridTheme(38),
      rowData: entries.map(toRow),
      columnDefs: columnDefs(),
      defaultColDef: { editable: true, sortable: false, resizable: true, suppressMovable: true, suppressHeaderMenuButton: true },
      getRowId: (p) => String(p.data.key),
      rowSelection: { mode: "multiRow", checkboxes: false, headerCheckbox: false, enableClickSelection: true },
      enterNavigatesVertically: true,
      enterNavigatesVerticallyAfterEdit: true,
      stopEditingWhenCellsLoseFocus: true,
      tooltipShowDelay: 400,
      overlayNoRowsTemplate: '<span class="ag-overlay-no-rows-center">내역이 없습니다. 아래 "행 추가"로 입력하세요.</span>',
      getRowStyle: (p) => {
        const color = p.data ? findCat(catType, p.data.parent, p.data.sub)?.color : null;
        return color ? { background: color, color: textColorFor(color) ?? "#191f28" } : undefined;
      },
      onCellValueChanged: (e) => {
        if (!e.data) return;
        // 상위 드롭다운이 바뀌면 하위 값을 비움
        if (e.colDef.field === "parent" && e.oldValue !== e.newValue) e.node.setDataValue("sub", "");
        if (e.colDef.field === "pm" && e.oldValue !== e.newValue) e.node.setDataValue("an", "");
        e.data.dirty = true;
        refreshStatus(e.node);
        if (e.colDef.field === "parent" || e.colDef.field === "sub") api?.redrawRows({ rowNodes: [e.node] });
        onchange();
      },
      onCellKeyDown,
      // 드롭다운 편집을 시작하면 목록까지 바로 펼침 (기본은 한 번 더 클릭해야 열림)
      onCellEditingStarted: (e) => {
        if (e.colDef.cellEditor !== "agSelectCellEditor") return;
        setTimeout(() => el.querySelector(".ag-cell-inline-editing .ag-picker-field-wrapper")
          ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })), 0);
      },
      onCellEditingStopped: (e) => {
        if (e.colDef.field === "amount" && lastAmountInvalid) {
          lastAmountInvalid = false;
          showNotice("금액은 숫자로 입력해 주세요. (환불·취소는 -5000 처럼 마이너스로 입력)");
        }
      },
    });
    onchange();
  });

  onDestroy(() => api?.destroy());
</script>

<div class="grid" bind:this={el}></div>

<style>
  .grid { flex: 1; min-height: 0; }
  /* ▾ 자리는 편집 중이 아닐 때만 비움 (편집 중에 여백을 두면 드롭다운 옆에 빈 칸이 생김) */
  .grid :global(.select-cell:not(.ag-cell-inline-editing)) { cursor: pointer; padding-right: 20px; }
  .grid :global(.select-cell:not(.ag-cell-inline-editing)::after) { content: "▾"; position: absolute; right: 10px; top: 0; color: #b0b8c1; font-size: 12px; }
  .grid :global(.status-header) { padding: 0 8px; }
  .grid :global(.status-header .ag-header-cell-label) { justify-content: center; }
  .grid :global(.status-cell) { display: flex; align-items: center; justify-content: center; padding: 0; }
  .grid :global(button.status) { background: transparent; border: none; padding: 0 6px; font-size: 15px; line-height: 1; }
  .grid :global(button.status:hover) { background: transparent; transform: scale(1.15); }
</style>

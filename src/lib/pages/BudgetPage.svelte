<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import {
    AllCommunityModule, ModuleRegistry, createGrid,
    type ColDef, type GridApi, type ICellRendererParams,
  } from "ag-grid-community";
  import { gridTheme } from "$lib/gridTheme";
  import { app } from "$lib/state.svelte";
  import { getBudgets, getCategories, saveBudgets } from "$lib/db";
  import { formatNumber, parseAmount } from "$lib/format";
  import { alertDialog, promptDialog, showNotice } from "$lib/dialogs.svelte";

  ModuleRegistry.registerModules([AllCommunityModule]);

  // 소비 분류가 하나도 없을 때 사용하는 기본 예산 항목 (기존 앱과 동일)
  const DEFAULT_CATEGORIES = ["고정지출(주거)", "이자", "월세", "식비", "자동차·교통", "개인관리", "문화생활", "쇼핑", "변동지출", "투자", "상환"];
  const EMOJIS: Record<string, string> = {
    "고정지출(주거)": "🏠", 이자: "💰", 월세: "🏘️", 식비: "🍔", "자동차·교통": "🚌", 개인관리: "💇",
    문화생활: "🎬", 쇼핑: "🛍️", 변동지출: "📈", 투자: "🚀", 상환: "📉",
  };
  const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

  type BudgetRow = { name: string } & Record<`m${number}`, number>;

  let el: HTMLDivElement;
  let api: GridApi<BudgetRow> | undefined;
  let dirty = $state(false);

  const totalRow = (rows: BudgetRow[]) => {
    const t = { name: "✨ 월별 총합" } as BudgetRow;
    for (const m of MONTHS) t[`m${m}`] = rows.reduce((s, r) => s + (r[`m${m}`] || 0), 0);
    return t;
  };
  const rows = () => { const out: BudgetRow[] = []; api?.forEachNode((n) => n.data && out.push(n.data)); return out; };
  const refreshTotal = () => api?.setGridOption("pinnedBottomRowData", [totalRow(rows())]);

  async function applyAll(row: BudgetRow) {
    const text = await promptDialog("일괄 적용", `[${row.name}]\n12개월 전체에 적용할 금액을 입력하세요:`, "0");
    if (text == null) return;
    const amount = parseAmount(text);
    if (amount == null || amount < 0) return alertDialog("오류", "금액은 0 이상의 숫자로 입력해 주세요.");
    for (const m of MONTHS) row[`m${m}`] = amount;
    api?.applyTransaction({ update: [row] });
    dirty = true;
    refreshTotal();
  }

  function applyButton(p: ICellRendererParams<BudgetRow>) {
    if (p.node.rowPinned) return "";
    const b = document.createElement("button");
    b.className = "apply"; b.textContent = "일괄 적용";
    b.onclick = () => p.data && applyAll(p.data);
    return b;
  }

  async function save() {
    api?.stopEditing();
    const data: [number, string, number][] = [];
    for (const r of rows()) for (const m of MONTHS) data.push([m, r.name, r[`m${m}`] || 0]);
    try {
      await saveBudgets(app.householdId!, app.year, data);
      dirty = false;
      showNotice(`${app.year}년 항목별 예산이 저장되었습니다.`);
    } catch (e) {
      alertDialog("오류", `저장 중 오류 발생: ${e}`);
    }
  }

  onMount(async () => {
    const hid = app.householdId!;
    const [budgets, cats] = await Promise.all([getBudgets(hid, app.year), getCategories(hid, "소비")]);
    const names = [...new Set(cats.map((c) => c.parent_category))].sort((a, b) => a.localeCompare(b, "ko"));
    // 분류에서 빠졌더라도 이미 예산이 있는 항목은 계속 표시
    for (const name of Object.keys(budgets)) if (!names.includes(name)) names.push(name);
    const data = (names.length ? names : DEFAULT_CATEGORIES).map((name) => {
      const r = { name } as BudgetRow;
      for (const m of MONTHS) r[`m${m}`] = budgets[name]?.[m] ?? 0;
      return r;
    });

    const monthCols: ColDef<BudgetRow>[] = MONTHS.map((m) => ({
      field: `m${m}` as keyof BudgetRow, headerName: `${m}월`, flex: 1, minWidth: 96, type: "rightAligned",
      cellDataType: false, cellEditor: "agTextCellEditor",
      editable: (p) => !p.node.rowPinned,
      valueFormatter: (p) => formatNumber(p.value),
      valueParser: (p) => { const v = parseAmount(p.newValue); return v == null || v < 0 ? p.oldValue : v; },
    }));
    api = createGrid<BudgetRow>(el, {
      theme: gridTheme(),
      rowData: data,
      pinnedBottomRowData: [totalRow(data)],
      columnDefs: [
        { field: "name", headerName: "항목", pinned: "left", width: 160, editable: false,
          valueFormatter: (p) => (EMOJIS[p.value] && !p.node?.rowPinned ? `${EMOJIS[p.value]} ${p.value}` : p.value) },
        { colId: "apply", headerName: "일괄 적용", pinned: "left", width: 108, cellClass: "apply-cell", editable: false, cellRenderer: applyButton },
        ...monthCols,
      ],
      defaultColDef: { sortable: false, resizable: true, suppressMovable: true, suppressHeaderMenuButton: true },
      getRowId: (p) => p.data.name,
      enterNavigatesVertically: true,
      enterNavigatesVerticallyAfterEdit: true,
      stopEditingWhenCellsLoseFocus: true,
      getRowStyle: (p) => (p.node.rowPinned ? { background: "#f9fafb", color: "#191f28", fontWeight: "700" } : undefined),
      onCellValueChanged: () => { dirty = true; refreshTotal(); },
    });
    app.hasUnsaved = () => dirty;
  });

  onDestroy(() => api?.destroy());

  function onkeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); save(); }
  }
</script>

<svelte:window {onkeydown} />

<div class="page">
  <header>
    <h2>📊 {app.year}년 항목별 월간 예산 설정</h2>
    <span class="muted">예산 항목은 설정의 소비 대분류를 따릅니다.{dirty ? " · 저장하지 않은 변경이 있습니다." : ""}</span>
    <span class="spacer"></span>
    <button onclick={save}>💾 전체 저장</button>
  </header>
  <div class="grid card" bind:this={el}></div>
</div>

<style>
  .page { display: flex; flex-direction: column; gap: 14px; height: 100%; }
  header { display: flex; align-items: center; gap: 14px; }
  h2 { margin: 0; font-size: 20px; font-weight: 700; color: var(--text-strong); }
  .spacer { flex: 1; }
  .grid { flex: 1; min-height: 0; padding: 0; overflow: hidden; }
  .grid :global(.apply-cell) { display: flex; align-items: center; justify-content: center; padding: 0; }
  .grid :global(button.apply) { background: var(--blue-soft); color: var(--blue-text); border-radius: 8px; padding: 0 10px;
    height: 28px; line-height: 28px; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .grid :global(button.apply:hover) { background: var(--blue-soft-hover); }
</style>

<script lang="ts">
  // 자산 관리: 저축·적금·자본 목록, 목표, 자산별 월 저축/소비 (입력하면 바로 저장)
  import { onDestroy, onMount } from "svelte";
  import {
    AllCommunityModule, ModuleRegistry, createGrid,
    type ColDef, type GridApi, type ICellRendererParams, type ValueParserParams,
  } from "ag-grid-community";
  import { gridTheme } from "$lib/gridTheme";
  import { app } from "$lib/state.svelte";
  import {
    addSavingsAccount, deleteSavingsAccount, getSavingsAccounts, getSavingsFlows, getSavingsGoal,
    saveSavingsGoal, setSavingsFlow, updateSavingsAccount,
    type FlowKind, type SavingsAccount, type SavingsFlow, type SavingsGoal,
  } from "$lib/db";
  import { formatNumber, isValidDate, parseAmount } from "$lib/format";
  import { alertDialog, confirmDialog, showNotice } from "$lib/dialogs.svelte";
  import { MONTHS, currentAmounts, goalProgress, monthlySummary } from "$lib/savings";

  ModuleRegistry.registerModules([AllCommunityModule]);

  type FlowRow = { key: string; accountId: number | null; label: string; kind: FlowKind | "합계"; total?: number } & Record<`m${number}`, number>;

  let accounts = $state<SavingsAccount[]>([]);
  let flows = $state<SavingsFlow[]>([]);
  let goal = $state<SavingsGoal>({ target_amount: 0, start_date: "", end_date: "" });
  let goalAmountText = $state("");

  let accountEl: HTMLDivElement, flowEl: HTMLDivElement;
  let accountApi: GridApi<SavingsAccount> | undefined, flowApi: GridApi<FlowRow> | undefined;

  const amounts = $derived(currentAmounts(accounts, flows));
  const total = $derived([...amounts.values()].reduce((s, v) => s + v, 0));
  const summary = $derived(monthlySummary(accounts, flows, app.year));
  const yearSaving = $derived(summary.saving.reduce((s, v) => s + v, 0));
  const yearSpending = $derived(summary.spending.reduce((s, v) => s + v, 0));
  const progress = $derived(goalProgress(goal, total));

  const label = (a: SavingsAccount) => [a.institution, a.name].filter(Boolean).join(" · ") || a.kind || "(이름 없음)";
  const amountParser = (p: ValueParserParams) => { const v = parseAmount(p.newValue); return v == null || v < 0 ? p.oldValue : v; };
  const won = (v: number | null | undefined) => (v ? formatNumber(v) : "");

  // --- 자산 목록 ---
  function accountColumns(): ColDef<SavingsAccount>[] {
    const money = (field: keyof SavingsAccount, headerName: string): ColDef<SavingsAccount> => ({
      field, headerName, flex: 1, minWidth: 110, type: "rightAligned", cellDataType: false, cellEditor: "agTextCellEditor",
      valueFormatter: (p) => won(p.value as number), valueParser: amountParser,
    });
    return [
      { colId: "no", headerName: "No", width: 56, editable: false, valueGetter: (p) => (p.node?.rowIndex ?? 0) + 1, cellClass: "muted-cell" },
      { field: "kind", headerName: "구분", width: 90 },
      { field: "institution", headerName: "금융기관", flex: 1, minWidth: 100 },
      { field: "name", headerName: "내용", flex: 1.4, minWidth: 120 },
      money("target_amount", "목표 저축액"),
      { colId: "current", headerName: "현재까지 모은 금액", flex: 1.1, minWidth: 130, editable: false, type: "rightAligned",
        valueGetter: (p) => (p.data ? amounts.get(p.data.id) ?? 0 : 0), valueFormatter: (p) => formatNumber(p.value), cellClass: "strong-cell" },
      money("maturity_amount", "만기시 금액"),
      { colId: "ratio", headerName: "목표대비", width: 96, editable: false, type: "rightAligned", cellClass: "ok-cell",
        valueGetter: (p) => (p.data?.target_amount ? (amounts.get(p.data.id) ?? 0) / p.data.target_amount : null),
        valueFormatter: (p) => (p.value == null ? "" : `${(p.value * 100).toFixed(1)}%`) },
      money("base_amount", "기존 저축액"),
      { field: "memo", headerName: "비고", flex: 1.4, minWidth: 120, tooltipField: "memo" },
    ];
  }

  // --- 월별 저축·소비 ---
  function flowRows(): FlowRow[] {
    const rows: FlowRow[] = [];
    for (const a of accounts) {
      for (const kind of ["저축", "소비"] as const) {
        const row = { key: `${a.id}|${kind}`, accountId: a.id, label: label(a), kind } as FlowRow;
        for (const m of MONTHS) row[`m${m}`] = 0;
        rows.push(row);
      }
    }
    const byKey = new Map(rows.map((r) => [r.key, r]));
    for (const f of flows) {
      const row = f.year === app.year ? byKey.get(`${f.account_id}|${f.kind}`) : undefined;
      if (row) row[`m${f.month}`] = f.amount;
    }
    return rows;
  }

  function pinnedRows(): FlowRow[] {
    const make = (key: string, label: string, values: number[]) => {
      const row = { key, accountId: null, label, kind: "합계" } as FlowRow;
      MONTHS.forEach((m, i) => (row[`m${m}`] = values[i]));
      return row;
    };
    return [
      make("saving", "월 누적 저축", summary.saving),
      make("spending", "월 누적 소비", summary.spending),
      make("balance", "월 자본 현황", summary.balance),
    ];
  }

  function kindRenderer(p: ICellRendererParams<FlowRow>) {
    if (p.node.rowPinned) return "";
    const span = document.createElement("span");
    span.className = `badge ${p.value === "저축" ? "save" : "spend"}`;
    span.textContent = p.value;
    return span;
  }

  function flowColumns(): ColDef<FlowRow>[] {
    return [
      { field: "label", headerName: "자산", pinned: "left", width: 190, editable: false,
        valueFormatter: (p) => (p.node?.rowPinned || p.data?.kind === "저축" ? p.value : ""), tooltipField: "label" },
      { field: "kind", headerName: "구분", pinned: "left", width: 72, editable: false, cellRenderer: kindRenderer },
      ...MONTHS.map((m): ColDef<FlowRow> => ({
        field: `m${m}`, headerName: `${m}월`, flex: 1, minWidth: 120, type: "rightAligned",
        cellDataType: false, cellEditor: "agTextCellEditor",
        editable: (p) => !p.node.rowPinned,
        // 자본 현황은 0도 표시, 나머지는 금액이 있을 때만
        valueFormatter: (p) => (p.data?.key === "balance" ? formatNumber(p.value) : won(p.value)),
        valueParser: amountParser,
      })),
    ];
  }

  // --- 갱신 ---
  async function reload() {
    const hid = app.householdId!;
    [accounts, flows, goal] = await Promise.all([getSavingsAccounts(hid), getSavingsFlows(hid), getSavingsGoal(hid)]);
    goalAmountText = goal.target_amount ? formatNumber(goal.target_amount) : "";
    accountApi?.setGridOption("rowData", accounts.map((a) => ({ ...a })));
    flowApi?.setGridOption("rowData", flowRows());
  }

  // 계산값(현재 금액, 월 합계)이 바뀌면 표의 계산 칸과 합계 행만 다시 그림
  $effect(() => {
    void amounts;
    accountApi?.refreshCells({ columns: ["current", "ratio"], force: true });
  });
  // 표가 만들어지기 전에도 합계를 먼저 계산해야 이후 변경을 추적함
  $effect(() => {
    const rows = pinnedRows();
    flowApi?.setGridOption("pinnedBottomRowData", rows);
  });

  async function addAccount() {
    const id = await addSavingsAccount(app.householdId!, {
      kind: "", institution: "", name: "", target_amount: 0, maturity_amount: 0, base_amount: 0, memo: "",
    });
    await reload();
    const index = accounts.findIndex((a) => a.id === id);
    if (index >= 0) { accountApi?.ensureIndexVisible(index); accountApi?.startEditingCell({ rowIndex: index, colKey: "kind" }); }
  }

  async function removeAccounts() {
    const rows = accountApi?.getSelectedRows() ?? [];
    if (!rows.length) return alertDialog("안내", "삭제할 자산을 먼저 선택하세요.");
    const ok = await confirmDialog("삭제 확인",
      `선택한 자산 ${rows.length}개와 그 월별 저축·소비 기록을 모두 삭제하시겠습니까?`, { okText: "삭제", danger: true });
    if (!ok) return;
    for (const r of rows) await deleteSavingsAccount(r.id);
    await reload();
  }

  async function saveGoal() {
    const amount = parseAmount(goalAmountText || "0");
    if (amount == null || amount < 0) { goalAmountText = goal.target_amount ? formatNumber(goal.target_amount) : ""; return alertDialog("오류", "목표 금액은 숫자로 입력해 주세요."); }
    for (const d of [goal.start_date, goal.end_date]) if (d && !isValidDate(d)) return;
    goal = { ...goal, target_amount: amount };
    goalAmountText = amount ? formatNumber(amount) : "";
    await saveSavingsGoal(app.householdId!, goal);
  }

  onMount(async () => {
    accountApi = createGrid<SavingsAccount>(accountEl, {
      theme: gridTheme(),
      columnDefs: accountColumns(),
      defaultColDef: { editable: true, sortable: false, resizable: true, suppressMovable: true, suppressHeaderMenuButton: true },
      getRowId: (p) => String(p.data.id),
      domLayout: "autoHeight",
      rowSelection: { mode: "multiRow", checkboxes: false, headerCheckbox: false, enableClickSelection: true },
      stopEditingWhenCellsLoseFocus: true,
      enterNavigatesVertically: true,
      enterNavigatesVerticallyAfterEdit: true,
      tooltipShowDelay: 400,
      overlayNoRowsTemplate: '<span class="ag-overlay-no-rows-center">등록된 자산이 없습니다. "+ 자산 추가"로 시작하세요.</span>',
      onCellValueChanged: async (e) => {
        const a = e.data;
        await updateSavingsAccount(a.id, {
          kind: a.kind.trim(), institution: a.institution.trim(), name: a.name.trim(),
          target_amount: a.target_amount, maturity_amount: a.maturity_amount, base_amount: a.base_amount, memo: a.memo.trim(),
        });
        accounts = accounts.map((x) => (x.id === a.id ? { ...a } : x));
        // 이름이 바뀌면 월별 표의 자산 이름도 바꿈
        if (["kind", "institution", "name"].includes(e.colDef.field ?? "")) flowApi?.setGridOption("rowData", flowRows());
      },
    });

    flowApi = createGrid<FlowRow>(flowEl, {
      theme: gridTheme(),
      columnDefs: flowColumns(),
      defaultColDef: { sortable: false, resizable: true, suppressMovable: true, suppressHeaderMenuButton: true },
      getRowId: (p) => p.data.key,
      domLayout: "autoHeight",
      stopEditingWhenCellsLoseFocus: true,
      enterNavigatesVertically: true,
      enterNavigatesVerticallyAfterEdit: true,
      getRowClass: (p) => (p.node.rowPinned ? `total-row ${p.data?.key}` : p.data?.kind === "소비" ? "spend-row" : undefined),
      overlayNoRowsTemplate: '<span class="ag-overlay-no-rows-center">자산을 추가하면 월별 저축·소비를 입력할 수 있습니다.</span>',
      onCellValueChanged: async (e) => {
        const r = e.data, month = Number(e.colDef.field!.slice(1)), amount = Number(e.newValue) || 0;
        if (r.accountId == null || r.kind === "합계") return;
        try {
          await setSavingsFlow(app.householdId!, r.accountId, app.year, month, r.kind, amount);
        } catch (err) {
          return alertDialog("저장 실패", `저장 중 오류 발생: ${err}`);
        }
        const rest = flows.filter((f) => !(f.account_id === r.accountId && f.year === app.year && f.month === month && f.kind === r.kind));
        flows = amount ? [...rest, { account_id: r.accountId, year: app.year, month, kind: r.kind, amount }] : rest;
        showNotice("저장되었습니다.", 1200);
      },
    });

    await reload();
  });

  onDestroy(() => { accountApi?.destroy(); flowApi?.destroy(); });
</script>

<div class="page">
  <div class="top">
    <div class="card kpi">
      <p class="label">자산 현황</p>
      <p class="value">{formatNumber(total)}원</p>
      <p class="sub">{app.year}년 저축 <b class="save">{formatNumber(yearSaving)}</b> · 소비 <b class="spend">{formatNumber(yearSpending)}</b></p>
    </div>
    <div class="card goal">
      <div class="goal-head">
        <p class="card-title">🎯 저축 · 적금 · 자본 목표</p>
        {#if goal.target_amount}
          <span class="rate">{(progress.rate * 100).toFixed(1)}%</span>
        {/if}
      </div>
      <div class="goal-inputs">
        <label>최종 목표 금액<input placeholder="예: 100,000,000" bind:value={goalAmountText} onchange={saveGoal} /></label>
        <label>시작일<input type="date" bind:value={goal.start_date} onchange={saveGoal} /></label>
        <label>목표 달성일<input type="date" bind:value={goal.end_date} onchange={saveGoal} /></label>
      </div>
      {#if goal.target_amount}
        <div class="bar"><div class="fill" style:width="{Math.min(100, progress.rate * 100)}%"></div></div>
        <p class="sub">
          현재까지 모은 금액 <b>{formatNumber(total)}원</b>
          {#if progress.remaining}
            · 남은 금액 <b>{formatNumber(progress.remaining)}원</b>
            {#if progress.perMonth}· 목표일까지 매달 <b class="save">{formatNumber(progress.perMonth)}원</b>{/if}
          {:else}
            · 🎉 목표를 달성했습니다!
          {/if}
        </p>
      {:else}
        <p class="sub">목표 금액을 입력하면 달성률을 보여드려요.</p>
      {/if}
    </div>
  </div>

  <section class="card">
    <header>
      <h3>저축 · 적금 · 자본 관리</h3>
      <span class="muted hint">칸을 더블클릭해서 입력하면 바로 저장됩니다.</span>
      <span class="spacer"></span>
      <button class="weak" onclick={addAccount}>+ 자산 추가</button>
      <button class="secondary" onclick={removeAccounts}>삭제</button>
    </header>
    <div class="grid" bind:this={accountEl}></div>
  </section>

  <section class="card">
    <header>
      <h3>{app.year}년 월별 저축 · 소비</h3>
      <span class="muted hint">현재까지 모은 금액 = 기존 저축액 + 저축 합계 − 소비 합계 (모든 연도)</span>
    </header>
    <div class="grid" bind:this={flowEl}></div>
  </section>
</div>

<style>
  .page { display: flex; flex-direction: column; gap: 16px; padding-bottom: 8px; }
  .top { display: grid; grid-template-columns: minmax(240px, 1fr) minmax(0, 2.4fr); gap: 16px; }
  .kpi p, .goal p { margin: 0; }
  .label { font-size: 13px; color: var(--text-sub); }
  .value { font-size: 28px; font-weight: 700; color: var(--text-strong); margin: 6px 0 8px !important; letter-spacing: -0.02em; white-space: nowrap; }
  .sub { font-size: 13px; color: var(--muted); }
  .sub b { color: var(--text-strong); }
  .save { color: var(--blue) !important; }
  .spend { color: var(--red) !important; }
  .goal { display: flex; flex-direction: column; gap: 12px; }
  .goal-head { display: flex; align-items: baseline; justify-content: space-between; }
  .goal-head .card-title { margin: 0; }
  .rate { font-size: 22px; font-weight: 700; color: var(--blue); }
  .goal-inputs { display: grid; grid-template-columns: 1.4fr 1fr 1fr; gap: 10px; }
  .goal-inputs label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-sub); }
  .goal-inputs input { min-width: 0; }
  .bar { height: 10px; border-radius: 5px; background: var(--gray-soft); overflow: hidden; }
  .fill { height: 100%; border-radius: 5px; background: var(--blue); transition: width 0.3s; }
  section { display: flex; flex-direction: column; gap: 12px; }
  header { display: flex; align-items: center; gap: 10px; }
  h3 { margin: 0; font-size: 16px; font-weight: 700; color: var(--text-strong); white-space: nowrap; }
  .hint { font-size: 12px; }
  .spacer { flex: 1; }
  .grid :global(.muted-cell) { color: var(--muted); }
  .grid :global(.strong-cell) { font-weight: 700; color: var(--text-strong); }
  .grid :global(.ok-cell) { color: var(--green); font-weight: 600; }
  .grid :global(.spend-row) { background: #fffafa; }
  .grid :global(.badge) { display: inline-block; padding: 0 8px; border-radius: 6px; font-size: 12px; font-weight: 600; line-height: 22px; }
  .grid :global(.badge.save) { background: var(--blue-soft); color: var(--blue-text); }
  .grid :global(.badge.spend) { background: var(--red-soft); color: var(--red); }
  .grid :global(.total-row) { font-weight: 700; background: #f9fafb; }
  .grid :global(.total-row.saving) { color: var(--blue-text); }
  .grid :global(.total-row.spending) { color: var(--red); }
  .grid :global(.total-row.balance) { color: var(--text-strong); }
</style>

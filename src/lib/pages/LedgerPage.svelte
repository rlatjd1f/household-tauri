<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "$lib/state.svelte";
  import { getBudgets, getCategories, getLedgerEntries, type Category, type LedgerEntry } from "$lib/db";
  import { formatNumber } from "$lib/format";
  import { alertDialog } from "$lib/dialogs.svelte";
  import LedgerGrid from "$lib/components/LedgerGrid.svelte";

  let { month }: { month: number } = $props();

  let loaded = $state(false);
  let entries = $state<LedgerEntry[]>([]);
  let categories = $state<Category[]>([]);
  let monthBudget = $state(0);
  let expenseGrid = $state<LedgerGrid>();
  let incomeGrid = $state<LedgerGrid>();
  let summary = $state({ expense: 0, income: 0, filtered: false, filteredExpense: 0, filteredIncome: 0 });

  onMount(async () => {
    const hid = app.householdId!;
    [entries, categories] = await Promise.all([getLedgerEntries(hid, app.year, month), getCategories(hid)]);
    const budgets = await getBudgets(hid, app.year);
    monthBudget = Object.values(budgets).reduce((s, m) => s + (m[month] ?? 0), 0);
    loaded = true;
    app.hasUnsaved = () => !!(expenseGrid?.hasUnsaved() || incomeGrid?.hasUnsaved());
  });

  function refreshSummary() {
    if (!expenseGrid || !incomeGrid) return;
    summary = {
      expense: expenseGrid.total(), income: incomeGrid.total(),
      filtered: expenseGrid.isFiltered() || incomeGrid.isFiltered(),
      filteredExpense: expenseGrid.total(true), filteredIncome: incomeGrid.total(true),
    };
  }

  // 두 표가 모두 만들어진 뒤 처음 합계를 계산 (각 표의 첫 알림은 연결 전에 와서 무시됨)
  $effect(() => { if (expenseGrid && incomeGrid) refreshSummary(); });

  const remaining = $derived(monthBudget - summary.expense);

  async function saveAll(grids: (LedgerGrid | undefined)[]) {
    let saved = 0, failed = 0;
    for (const g of grids) { if (!g) continue; const [s, f] = await g.saveAll(); saved += s; failed += f; }
    if (failed) await alertDialog("모두 저장", `${saved}건을 저장했고 ${failed}건은 저장하지 않았습니다.`);
  }

  function onkeydown(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveAll([expenseGrid, incomeGrid]); }
  }
</script>

<svelte:window {onkeydown} />

<div class="page">
  <div class="summary card">
    <h2 class="title">{app.year}년 {month}월</h2>
    <div class="stat"><span>월 예산</span><b>{formatNumber(monthBudget)}원</b></div>
    <div class="stat"><span>지출</span><b class={remaining < 0 ? "over" : "ok"}>{formatNumber(summary.expense)}원</b></div>
    <div class="stat"><span>남은 예산</span><b class={remaining < 0 ? "over" : "ok"}>{formatNumber(remaining)}원</b></div>
    <div class="stat"><span>수입</span><b>{formatNumber(summary.income)}원</b></div>
    {#if summary.filtered}
      <span class="muted filtered">🔍 검색 결과: 지출 {formatNumber(summary.filteredExpense)} · 수입 {formatNumber(summary.filteredIncome)}</span>
    {/if}
  </div>

  {#if loaded}
    <div class="tables">
      <section class="card box">
        <header>
          <h3 class="expense">💸 소비 내역 (지출)</h3>
          <input placeholder="검색/필터..." oninput={(e) => expenseGrid?.setFilter(e.currentTarget.value)} />
        </header>
        <LedgerGrid bind:this={expenseGrid} type="지출" {month} entries={entries.filter((e) => e.type === "지출")} {categories} onchange={refreshSummary} />
        <footer>
          <button class="weak" onclick={() => expenseGrid?.addRow()}>+ 지출 행 추가</button>
          <button class="secondary" onclick={() => expenseGrid?.deleteSelected()}>- 삭제</button>
          <span class="spacer"></span>
          <button title="저장하지 않은 행(❓)을 모두 저장합니다. (Ctrl+S: 지출·소득 모두)" onclick={() => saveAll([expenseGrid])}>💾 모두 저장</button>
        </footer>
      </section>
      <section class="card box">
        <header>
          <h3 class="income">💰 소득 내역 (수입)</h3>
          <input placeholder="검색/필터..." oninput={(e) => incomeGrid?.setFilter(e.currentTarget.value)} />
        </header>
        <LedgerGrid bind:this={incomeGrid} type="수입" {month} entries={entries.filter((e) => e.type === "수입")} {categories} onchange={refreshSummary} />
        <footer>
          <button class="weak" onclick={() => incomeGrid?.addRow()}>+ 수입 행 추가</button>
          <button class="secondary" onclick={() => incomeGrid?.deleteSelected()}>- 삭제</button>
          <span class="spacer"></span>
          <button title="저장하지 않은 행(❓)을 모두 저장합니다. (Ctrl+S: 지출·소득 모두)" onclick={() => saveAll([incomeGrid])}>💾 모두 저장</button>
        </footer>
      </section>
    </div>
  {/if}
</div>

<style>
  .page { display: flex; flex-direction: column; gap: 16px; height: 100%; }
  .summary { display: flex; align-items: center; gap: 36px; padding: 18px 24px; flex-wrap: wrap; row-gap: 8px; }
  .title { margin: 0; font-size: 20px; font-weight: 700; color: var(--text-strong); }
  .stat { display: flex; flex-direction: column; gap: 2px; }
  .stat span { font-size: 12px; color: var(--muted); }
  .stat b { font-size: 17px; font-weight: 700; color: var(--text-strong); font-variant-numeric: tabular-nums; }
  .stat b.over { color: var(--red); }
  .stat b.ok { color: var(--green); }
  .filtered { font-size: 12px; }
  .tables { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 65fr) minmax(340px, 35fr); gap: 16px; }
  .box { display: flex; flex-direction: column; min-width: 0; min-height: 0; padding: 18px; gap: 12px; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  h3 { margin: 0; font-size: 16px; font-weight: 700; white-space: nowrap; color: var(--text-strong); }
  header input { width: 160px; min-width: 80px; flex-shrink: 1; font-size: 12px; padding: 6px 10px; }
  footer { display: flex; gap: 8px; }
  footer button { white-space: nowrap; padding: 8px 14px; }
  .spacer { flex: 1; }
</style>

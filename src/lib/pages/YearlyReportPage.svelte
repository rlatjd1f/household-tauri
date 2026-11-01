<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "$lib/state.svelte";
  import { getLedgerEntries, getYearlyMonthlyTrends } from "$lib/db";
  import { formatNumber } from "$lib/format";
  import { COLORS, categoryAxis, tooltip, valueAxis } from "$lib/reports";
  import Chart from "$lib/components/Chart.svelte";

  let months = $state<{ month: number; income: number; expense: number; net: number }[]>([]);
  let topCategories = $state<[string, number][]>([]);

  onMount(async () => {
    const hid = app.householdId!;
    const trends = await getYearlyMonthlyTrends(hid, app.year);
    months = Object.keys(trends).sort().map((m) => {
      const { 수입: income, 지출: expense } = trends[m];
      return { month: Number(m), income, expense, net: income - expense };
    });
    const totals = new Map<string, number>();
    const all = await Promise.all(Array.from({ length: 12 }, (_, i) => getLedgerEntries(hid, app.year, i + 1)));
    for (const e of all.flat()) {
      if (e.type !== "지출") continue;
      const key = e.parent_category || "미분류";
      totals.set(key, (totals.get(key) ?? 0) + e.amount);
    }
    topCategories = [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  });

  const totalIncome = $derived(months.reduce((s, m) => s + m.income, 0));
  const totalExpense = $derived(months.reduce((s, m) => s + m.expense, 0));
  const totalNet = $derived(totalIncome - totalExpense);
  const activeMonths = $derived(months.filter((m) => m.income || m.expense).length);
  // 평균 월지출은 지출이 입력된 달만 기준으로 계산
  const expenseMonths = $derived(months.filter((m) => m.expense).length);
  const avgExpense = $derived(expenseMonths ? Math.floor(totalExpense / expenseMonths) : 0);
  const peak = (key: "income" | "expense") => months.reduce((best, m) => (m[key] > (best?.[key] ?? -Infinity) ? m : best), months[0]);
  const expensePeak = $derived(months.length ? peak("expense") : null);
  const incomePeak = $derived(months.length ? peak("income") : null);
  const deficitMonths = $derived(months.filter((m) => m.net < 0).map((m) => `${m.month}월`));

  const trendOption = $derived({
    title: { text: `${app.year}년 재정 흐름 (단위: 원)`, left: "center", textStyle: { fontSize: 14, fontWeight: "bold", color: "#191f28" } },
    tooltip: tooltip(),
    legend: { top: 38, data: ["수입", "지출", "순현금흐름"] },
    grid: { left: 70, right: 30, top: 84, bottom: 30 },
    xAxis: categoryAxis(months.map((m) => `${m.month}월`)),
    yAxis: valueAxis(),
    series: [
      { name: "순현금흐름", type: "bar", barMaxWidth: 36, itemStyle: { color: "rgba(3,178,108,.45)" },
        data: months.map((m) => ({ value: m.net, itemStyle: { color: m.net >= 0 ? "rgba(3,178,108,.25)" : "rgba(240,68,82,.25)" } })) },
      { name: "수입", type: "line", data: months.map((m) => m.income), itemStyle: { color: COLORS.blue }, areaStyle: { opacity: 0.08 } },
      { name: "지출", type: "line", data: months.map((m) => m.expense), itemStyle: { color: COLORS.red }, areaStyle: { opacity: 0.08 } },
    ],
  });
</script>

<div class="page">
  <div class="kpis">
    <div class="card kpi"><p class="label">연간 수입</p><p class="value blue">{formatNumber(totalIncome)}원</p><p class="sub">입력 월 {activeMonths}개월</p></div>
    <div class="card kpi"><p class="label">연간 지출</p><p class="value over">{formatNumber(totalExpense)}원</p><p class="sub">월평균 {formatNumber(avgExpense)}원</p></div>
    <div class="card kpi"><p class="label">순저축</p><p class="value {totalNet >= 0 ? 'ok' : 'over'}">{formatNumber(totalNet)}원</p>
      <p class="sub">{totalIncome ? `저축률 ${((totalNet / totalIncome) * 100).toFixed(1)}%` : "수입 내역 없음"}</p></div>
    <div class="card kpi"><p class="label">평균 월지출</p><p class="value">{formatNumber(avgExpense)}원</p><p class="sub">지출 입력 {expenseMonths}개월 기준</p></div>
  </div>

  <div class="card chart-card">
    <p class="card-title">📈 {app.year}년 수입/지출 추이</p>
    <div class="chart"><Chart option={trendOption} empty={!activeMonths} /></div>
  </div>

  <div class="bottom">
    <div class="card">
      <p class="card-title">🗓️ 월별 요약</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>월</th><th class="num">수입</th><th class="num">지출</th><th class="num">차액</th></tr></thead>
          <tbody>
            {#each months as m}
              <tr><td>{m.month}월</td><td class="num">{formatNumber(m.income)}</td><td class="num">{formatNumber(m.expense)}</td>
                <td class="num {m.net >= 0 ? 'ok' : 'over'}">{formatNumber(m.net)}</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
    <div class="card">
      <p class="card-title">🏆 연간 지출 Top 5</p>
      <table>
        <thead><tr><th>순위</th><th>분류</th><th class="num">금액</th></tr></thead>
        <tbody>
          {#each topCategories as [name, amount], i}
            <tr><td>{i + 1}</td><td>{name}</td><td class="num">{formatNumber(amount)}</td></tr>
          {:else}
            <tr><td colspan="3" class="muted">지출 내역이 없습니다.</td></tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="card insights">
      <p class="card-title">💡 연간 인사이트</p>
      <p><b>가장 지출이 큰 달</b>: {expensePeak?.expense ? `${expensePeak.month}월 (${formatNumber(expensePeak.expense)}원)` : "지출 내역 없음"}</p>
      <p><b>가장 수입이 큰 달</b>: {incomePeak?.income ? `${incomePeak.month}월 (${formatNumber(incomePeak.income)}원)` : "수입 내역 없음"}</p>
      <p><b>최대 지출 분류</b>: {topCategories[0] ? `${topCategories[0][0]} ${formatNumber(topCategories[0][1])}원` : "데이터 없음"}</p>
      <p><b>적자 월</b>: {deficitMonths.length ? deficitMonths.join(", ") : "없음"}</p>
    </div>
  </div>
</div>

<style>
  .page { display: flex; flex-direction: column; gap: 16px; min-height: 100%; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; }
  .kpi p { margin: 2px 0; }
  .label { font-size: 13px; color: var(--text-sub); }
  .sub { font-size: 12px; color: var(--muted); }
  .value { font-size: 24px; font-weight: 700; color: var(--text-strong); letter-spacing: -0.02em; white-space: nowrap; }
  .blue { color: var(--blue); }
  .chart-card { display: flex; flex-direction: column; height: 400px; }
  .chart { flex: 1; min-height: 0; }
  .bottom { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 4fr) minmax(0, 5fr); gap: 16px; }
  .table-wrap { max-height: 260px; overflow: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; color: var(--text-strong); }
  th, td { padding: 9px 10px; border-bottom: 1px solid var(--gray-soft); text-align: left; white-space: nowrap; }
  th { position: sticky; top: 0; background: #f9fafb; font-weight: 600; color: var(--text-sub); }
  th.num, td.num { text-align: right; }
  .insights p { line-height: 1.7; font-size: 14px; margin: 6px 0; }
</style>

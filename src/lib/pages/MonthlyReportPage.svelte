<script lang="ts">
  import { onMount } from "svelte";
  import { app } from "$lib/state.svelte";
  import {
    getBudgets, getLedgerEntries, getMonthlyCategoryStats, getMonthlyDailyTrends, getYearlyMonthlyTrends,
    type LedgerEntry,
  } from "$lib/db";
  import { daysInMonth, formatNumber } from "$lib/format";
  import { CHART_FONT, COLORS, FIXED_CATEGORIES, categoryAxis, tooltip, valueAxis } from "$lib/reports";
  import Chart from "$lib/components/Chart.svelte";

  const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

  let month = $state(new Date().getMonth() + 1);
  let cats = $state<{ parent_category: string; total: number }[]>([]);
  let daily = $state<{ day: string; total: number }[]>([]);
  let top10 = $state<LedgerEntry[]>([]);
  let monthBudget = $state(0);

  const totalExp = $derived(cats.reduce((s, c) => s + c.total, 0));
  const totalVar = $derived(cats.filter((c) => !FIXED_CATEGORIES.includes(c.parent_category)).reduce((s, c) => s + c.total, 0));
  const varRatio = $derived(totalExp > 0 ? (totalVar / totalExp) * 100 : 0);
  const diff = $derived(totalExp - monthBudget);

  /** 올해는 이번 달(내역이 없으면 그 이전 마지막 입력 월), 다른 연도는 마지막 입력 월 */
  async function defaultMonth() {
    const trends = await getYearlyMonthlyTrends(app.householdId!, app.year);
    const months = Object.entries(trends).filter(([, v]) => v.수입 || v.지출).map(([m]) => Number(m));
    const now = new Date();
    if (app.year === now.getFullYear()) {
      const past = months.filter((m) => m <= now.getMonth() + 1);
      return months.includes(now.getMonth() + 1) || !past.length ? now.getMonth() + 1 : Math.max(...past);
    }
    return months.length ? Math.max(...months) : 1;
  }

  async function load(m: number) {
    month = m;
    const hid = app.householdId!;
    const [c, d, entries, budgets] = await Promise.all([
      getMonthlyCategoryStats(hid, app.year, m), getMonthlyDailyTrends(hid, app.year, m),
      getLedgerEntries(hid, app.year, m), getBudgets(hid, app.year),
    ]);
    cats = c.sort((a, b) => b.total - a.total);
    daily = d;
    top10 = entries.filter((e) => e.type === "지출").sort((a, b) => b.amount - a.amount).slice(0, 10);
    monthBudget = Object.values(budgets).reduce((s, v) => s + (v[m] ?? 0), 0);
  }

  onMount(async () => load(await defaultMonth()));

  const categoryOption = $derived({
    title: { text: `${month}월 항목별 지출`, left: "center", textStyle: { fontSize: 14, fontWeight: "bold", color: "#191f28" } },
    tooltip: tooltip(),
    grid: { left: 60, right: 20, top: 50, bottom: 30 },
    xAxis: categoryAxis(cats.map((c) => c.parent_category)),
    yAxis: valueAxis(),
    series: [{
      type: "bar", data: cats.map((c) => c.total), barMaxWidth: 48, itemStyle: { color: COLORS.blue, borderRadius: [6, 6, 0, 0] },
      label: { show: true, position: "top", formatter: (p: { value: number }) => formatNumber(p.value), color: COLORS.blue, fontWeight: "bold", ...CHART_FONT },
    }],
  });

  const dailyOption = $derived.by(() => {
    const days = Array.from({ length: daysInMonth(app.year, month) }, (_, i) => i + 1);
    const byDay = new Map(daily.map((d) => [Number(d.day), d.total]));
    return {
      tooltip: tooltip(),
      grid: { left: 60, right: 20, top: 20, bottom: 30 },
      // 지출 없는 날은 비워 두어 이어진 것처럼 보이지 않게 막대로 표시
      xAxis: categoryAxis(days.map((d) => `${d}일`), { axisLabel: { interval: 4, color: COLORS.text, ...CHART_FONT } }),
      yAxis: valueAxis(),
      series: [{ type: "bar", data: days.map((d) => byDay.get(d) ?? 0), itemStyle: { color: COLORS.blue, borderRadius: [4, 4, 0, 0] }, barMaxWidth: 18 }],
    };
  });

  const biggest = $derived(top10[0]);
  const biggestWhere = $derived.by(() => {
    if (!biggest) return "";
    const payee = (biggest.payee ?? "").trim();
    const category = [biggest.parent_category, biggest.sub_category].filter(Boolean).join(">");
    return payee ? `${payee}에서 쓴 ` : category ? `${category} 항목 ` : "";
  });
  const peakDay = $derived(daily.length ? [...daily].sort((a, b) => b.total - a.total)[0] : null);
</script>

<div class="page">
  <div class="months">
    <span>📅 {app.year}년 분석 월 선택:</span>
    {#each MONTHS as m}
      <button class="month" class:active={m === month} onclick={() => load(m)}>{m}월</button>
    {/each}
  </div>

  <div class="kpis">
    <div class="card">
      <p class="card-title">⚠️ 변동비 집중 모니터링</p>
      <p class="big">이번 달 변동비 <b>{formatNumber(totalVar)}원</b> 지출</p>
      <p class="muted">전체 지출 중 {varRatio.toFixed(1)}% 차지</p>
    </div>
    <div class="card">
      <p class="card-title">📉 예산 집행률 디테일</p>
      <p class="big">예산 {formatNumber(monthBudget)}원 중 <b>{formatNumber(totalExp)}원</b> 지출</p>
      <p>결과: {#if diff > 0}<span class="over">{formatNumber(diff)}원 초과</span>{:else}<span class="ok">{formatNumber(-diff)}원 절약</span>{/if}</p>
    </div>
  </div>

  <div class="row two">
    <div class="card chart-card">
      <p class="card-title">📊 카테고리별 지출 현황</p>
      <div class="chart"><Chart option={categoryOption} empty={!cats.length} /></div>
    </div>
    <div class="card chart-card">
      <p class="card-title">✨ 이달의 주요 소비처 (Top 10)</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>날짜</th><th>카테고리</th><th>사용처</th><th>결제수단</th><th class="num">금액</th></tr></thead>
          <tbody>
            {#each top10 as e (e.id)}
              <tr>
                <td>{e.date}</td>
                <td>{[e.parent_category, e.sub_category].filter(Boolean).join(">") || "미분류"}</td>
                <td>{e.payee ?? ""}</td><td>{e.payment_method ?? ""}</td>
                <td class="num">{formatNumber(e.amount)}</td>
              </tr>
            {:else}
              <tr><td colspan="5" class="muted center">지출 내역이 없습니다.</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <div class="row three">
    <div class="card chart-card">
      <p class="card-title">📅 일별 지출 추이</p>
      <div class="chart"><Chart option={dailyOption} empty={!daily.length} /></div>
    </div>
    <div class="card insights">
      <p class="card-title">💡 소비 패턴 분석 인사이트</p>
      {#if !biggest}
        <p>데이터가 부족하여 분석을 진행할 수 없습니다.</p>
      {:else}
        <p>📍 가장 큰 지출은 <b>{biggest.date}</b>, <b>{biggestWhere}</b>{formatNumber(biggest.amount)}원입니다.</p>
        {#if peakDay}<p>📅 {month}월 {peakDay.day}일에 지출 피크가 발생했습니다. 해당 일의 소비 내역을 점검해 보세요.</p>{/if}
        {#if varRatio > 50}
          <p class="over">⚠️ 변동비 비중이 {varRatio.toFixed(1)}%로 높습니다. 불필요한 쇼핑이나 외식이 없었는지 확인이 필요합니다.</p>
        {:else}
          <p class="blue">✅ 변동비가 잘 통제되고 있습니다. 지금처럼 유지해 주세요!</p>
        {/if}
      {/if}
    </div>
  </div>
</div>

<style>
  .page { display: flex; flex-direction: column; gap: 16px; min-height: 100%; }
  .months { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .month { background: var(--card); color: var(--text); padding: 7px 16px; font-weight: 500; border-radius: 20px; }
  .month:hover:not(.active) { background: var(--gray-hover) !important; }
  .month.active { background: var(--text-strong); color: #fff; font-weight: 700; }
  .kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .kpis p { margin: 4px 0; }
  .big { font-size: 20px; font-weight: 700; color: var(--text-strong); }
  .row { display: grid; gap: 16px; }
  .row.two { grid-template-columns: 4fr 3fr; height: 360px; }
  .row.three { grid-template-columns: 7fr 5fr; height: 300px; }
  .chart-card { display: flex; flex-direction: column; min-height: 0; }
  .chart { flex: 1; min-height: 0; }
  .table-wrap { flex: 1; overflow: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; color: var(--text-strong); }
  th, td { padding: 9px 10px; border-bottom: 1px solid var(--gray-soft); text-align: left; white-space: nowrap; }
  th { position: sticky; top: 0; background: #f9fafb; font-weight: 600; color: var(--text-sub); }
  th.num, td.num { text-align: right; }
  .center { text-align: center; }
  .insights p { line-height: 1.7; font-size: 14px; margin: 6px 0; }
  .blue { color: var(--blue); }
</style>

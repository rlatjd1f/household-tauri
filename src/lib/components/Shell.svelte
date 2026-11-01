<script lang="ts">
  import { onMount, type Component } from "svelte";
  import { getVersion } from "@tauri-apps/api/app";
  import { app, monthOf, type PageKey } from "$lib/state.svelte";
  import { ALT, alertDialog, confirmDialog, promptWithAltDialog, showNotice } from "$lib/dialogs.svelte";
  import { getDataYears, importHouseholdYear } from "$lib/db";
  import { pickFolder, pickXlsx, safeFileName, saveXlsx, saveXlsxToFolder } from "$lib/files";
  import Placeholder from "$lib/pages/Placeholder.svelte";

  let { onback }: { onback: () => void } = $props();

  let version = $state("");
  onMount(async () => { version = await getVersion().catch(() => ""); });

  const menu: { key: PageKey; label: string }[] = [
    { key: "settings", label: "⚙️  설정" },
    { key: "budget", label: "📊  예산 설정" },
    { key: "asset", label: "💰  자산 설정" },
    { key: "report_monthly", label: "📈  월별 리포트" },
    { key: "report_yearly", label: "📅  연도별 리포트" },
  ];
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  // 화면은 처음 열 때 불러옴 (리포트는 차트 라이브러리를 그때 내려받음)
  const loaders: Partial<Record<string, () => Promise<{ default: Component<any> }>>> = {
    settings: () => import("$lib/pages/SettingsPage.svelte"),
    month: () => import("$lib/pages/LedgerPage.svelte"),
    budget: () => import("$lib/pages/BudgetPage.svelte"),
    asset: () => import("$lib/pages/AssetPage.svelte"),
    report_monthly: () => import("$lib/pages/MonthlyReportPage.svelte"),
    report_yearly: () => import("$lib/pages/YearlyReportPage.svelte"),
  };
  // 불러온 화면과 그 화면의 키를 함께 보관해, 다음 화면을 불러오는 동안 이전 화면이 새 값으로 잠깐 다시 그려지지 않게 함
  let loaded = $state<{ key: string; component: Component<any> }>({ key: "", component: Placeholder });
  const pageKey = $derived(monthOf(app.page) ? "month" : app.page);

  $effect(() => {
    const key = pageKey;
    const load = loaders[key];
    if (!load) { loaded = { key, component: Placeholder }; return; }
    load().then((m) => { if (pageKey === key) loaded = { key, component: m.default }; });
  });

  /** 저장하지 않은 변경이 있으면 이동 전에 확인 */
  async function confirmLeave() {
    if (!app.hasUnsaved()) return true;
    return confirmDialog("저장하지 않은 내역", "저장하지 않은 행(❓)이 있습니다.\n계속하면 변경 내용이 사라집니다. 계속하시겠습니까?");
  }

  async function go(key: PageKey) {
    if (key === app.page || !(await confirmLeave())) return;
    app.hasUnsaved = () => false;
    app.page = key;
  }

  async function changeYear(e: Event) {
    const input = e.currentTarget as HTMLInputElement;
    const year = Number(input.value);
    if (!Number.isInteger(year) || year < 2000 || year > 2100) { input.value = String(app.year); return; }
    if (year === app.year) return;
    if (!(await confirmLeave())) { input.value = String(app.year); return; }
    app.hasUnsaved = () => false;
    app.year = year;
  }

  async function importExcel() {
    if (!(await confirmLeave())) return;
    const file = await pickXlsx();
    if (!file) return;
    let parsed;
    try {
      const { parseWorkbook } = await import("$lib/excel");
      parsed = await parseWorkbook(file.bytes);
    } catch (e) {
      return alertDialog("오류", `엑셀 파일을 읽는 중 오류 발생: ${e}`);
    }
    const { year, data } = parsed;
    const ok = await confirmDialog("데이터 이관 확인",
      `${year}년 예산과 가계부 내역을 엑셀 데이터로 교체하시겠습니까?\n` +
      "분류와 자산은 기존 데이터에 병합되며, 다른 연도의 데이터는 유지됩니다.\n" +
      `(가계부 내역 ${data.ledgers.length}건, 예산 ${data.budgets.length}건)`, { okText: "가져오기" });
    if (!ok) return;
    try {
      await importHouseholdYear(app.householdId!, year, data);
    } catch (e) {
      return alertDialog("오류", `엑셀 임포트 중 오류 발생: ${e}\n기존 데이터는 변경되지 않았습니다.`);
    }
    app.hasUnsaved = () => false;
    app.reloadToken++;
    await alertDialog("완료", "엑셀 데이터 이관이 성공적으로 완료되었습니다.");
  }

  const exportFileName = (year: number) => safeFileName(`${app.householdName}_${year}_가계부.xlsx`);

  async function exportExcel() {
    const text = await promptWithAltDialog("엑셀 내보내기",
      "내보낼 연도를 입력하세요.\n'모든 연도'를 누르면 연도별 파일로 한 번에 저장합니다.", String(app.year), "모든 연도");
    if (text == null) return;
    if (text === ALT) return exportAllYears();
    const year = Number(text);
    if (!Number.isInteger(year) || year < 1900 || year > 2100) return alertDialog("오류", "연도를 올바르게 입력해 주세요.");
    try {
      const { buildExportWorkbook } = await import("$lib/excel");
      const bytes = await buildExportWorkbook(app.householdId!, year);
      if (await saveXlsx(exportFileName(year), bytes)) showNotice("엑셀 내보내기가 완료되었습니다.");
    } catch (e) {
      alertDialog("오류", `엑셀 내보내기 중 오류 발생: ${e}`);
    }
  }

  async function exportAllYears() {
    const years = await getDataYears(app.householdId!);
    if (!years.length) return alertDialog("안내", "내보낼 데이터가 없습니다. (가계부 내역이나 예산이 있는 연도가 없습니다)");
    const ok = await confirmDialog("모든 연도 내보내기",
      `내보낼 연도: ${years.map((y) => `${y}년`).join(", ")}\n연도별로 파일 ${years.length}개를 만듭니다. 저장할 폴더를 선택해 주세요.\n` +
      "(폴더에 같은 이름의 파일이 있으면 덮어씁니다)", { okText: "폴더 선택" });
    if (!ok) return;
    const folder = await pickFolder();
    if (folder == null) return;
    const done: number[] = [];
    try {
      const { buildExportWorkbook } = await import("$lib/excel");
      for (const year of years) {
        showNotice(`엑셀 내보내는 중... (${year}년, ${done.length + 1}/${years.length})`, 60_000);
        await saveXlsxToFolder(folder, exportFileName(year), await buildExportWorkbook(app.householdId!, year));
        done.push(year);
      }
      showNotice(`${years.length}개 연도를 내보냈습니다.\n${folder}`, 5000);
    } catch (e) {
      showNotice("", 0);
      alertDialog("오류", `${done.length ? `${done.join(", ")}년은 저장했지만 ` : ""}엑셀 내보내기 중 오류 발생: ${e}`);
    }
  }

  async function back() {
    if (await confirmLeave()) onback();
  }
</script>

<div class="shell">
  <aside>
    <div class="top-buttons">
      <div class="excel">
        <button class="secondary" onclick={importExcel}>📂 엑셀 임포트</button>
        <button class="secondary" onclick={exportExcel}>📤 엑셀 내보내기</button>
      </div>
      <button class="weak" onclick={back}>⬅️ 가계부 선택 이동</button>
      <label class="year">
        <span>📅 연도</span>
        <input type="number" min="2000" max="2100" value={app.year} onchange={changeYear} />
      </label>
    </div>
    <nav>
      {#each menu as item}
        <button class="nav" class:active={app.page === item.key} onclick={() => go(item.key)}>{item.label}</button>
      {/each}
      <div class="nav header">📋  월별 가계부</div>
      {#each months as m}
        <button class="nav month" class:active={app.page === `month_${m}`} onclick={() => go(`month_${m}`)}>{m}월</button>
      {/each}
    </nav>
    {#if version}<p class="version">v{version}</p>{/if}
  </aside>
  <section class="content">
    {#if loaded.key === pageKey}
      {#key `${app.page}|${app.year}|${app.reloadToken}`}
        <loaded.component month={monthOf(app.page)} />
      {/key}
    {/if}
  </section>
</div>

<style>
  .shell { display: flex; height: 100vh; }
  aside { width: 240px; flex: none; display: flex; flex-direction: column; padding: 16px 0 12px; background: var(--card); }
  .top-buttons { display: flex; flex-direction: column; gap: 8px; padding: 0 14px 12px; }
  .excel { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .excel button { padding: 9px 2px; font-size: 12px; white-space: nowrap; }
  .top-buttons > button { padding: 10px; }
  .year { display: flex; align-items: center; justify-content: space-between; font-weight: 600; color: var(--text-strong); padding: 6px 4px 0; }
  .year input { width: 96px; }
  nav { flex: 1; overflow: auto; display: flex; flex-direction: column; gap: 2px; padding: 8px 12px; border-top: 1px solid var(--gray-soft); }
  .nav { text-align: left; background: transparent; color: var(--text); font-weight: 500; font-size: 14px;
    padding: 10px 14px; border-radius: 10px; white-space: pre; }
  .nav:hover:not(.header):not(.active) { background: var(--gray-soft) !important; }
  .nav.active, .nav.active:hover { background: var(--blue-soft); color: var(--blue-text); font-weight: 700; }
  .nav.header { color: var(--muted); font-size: 12px; font-weight: 600; padding: 14px 14px 6px; cursor: default; }
  .nav.month { padding-left: 30px; }
  .version { text-align: center; color: var(--placeholder); font-size: 12px; margin: 6px 0 0; }
  .content { flex: 1; min-width: 0; padding: 24px 28px; overflow: auto; }
</style>

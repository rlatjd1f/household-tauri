<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { AllCommunityModule, ModuleRegistry, createGrid, themeQuartz, type GridApi } from "ag-grid-community";
  import { app } from "$lib/state.svelte";
  import { addAsset, deleteAsset, getAssets, updateAsset, type Asset } from "$lib/db";
  import { formatNumber, parseAmount } from "$lib/format";
  import { alertDialog, confirmDialog, showNotice } from "$lib/dialogs.svelte";

  ModuleRegistry.registerModules([AllCommunityModule]);

  let el: HTMLDivElement;
  let api: GridApi<Asset> | undefined;
  let name = $state("");
  let balance = $state("");

  const reload = async () => api?.setGridOption("rowData", await getAssets(app.householdId!));

  async function add() {
    const n = name.trim(), b = parseAmount(balance);
    if (!n || b == null) return alertDialog("오류", "자산명을 입력하고 기초 잔액은 숫자로 입력해 주세요.");
    if (!(await addAsset(app.householdId!, n, b))) return alertDialog("오류", "이미 존재하는 자산명입니다.");
    name = ""; balance = "";
    await reload();
  }

  async function remove() {
    const rows = api?.getSelectedRows() ?? [];
    if (!rows.length) return alertDialog("안내", "삭제할 자산을 먼저 선택하세요.");
    if (!(await confirmDialog("확인", `선택한 자산 ${rows.length}개를 삭제하시겠습니까?`, { okText: "삭제", danger: true }))) return;
    for (const r of rows) await deleteAsset(r.id);
    await reload();
  }

  onMount(async () => {
    api = createGrid<Asset>(el, {
      theme: themeQuartz.withParams({ fontFamily: "inherit", fontSize: 13, accentColor: "#1a73e8", headerBackgroundColor: "#f8f9fa", rowHeight: 40, borderColor: "#dadce0" }),
      rowData: await getAssets(app.householdId!),
      columnDefs: [
        { field: "asset_name", headerName: "자산명", flex: 2, editable: true },
        { field: "initial_balance", headerName: "기초 잔액", flex: 1, editable: true, type: "rightAligned",
          cellDataType: false, cellEditor: "agTextCellEditor",
          valueFormatter: (p) => formatNumber(p.value),
          valueParser: (p) => parseAmount(p.newValue) ?? p.oldValue },
        { field: "current_balance", headerName: "현재 잔액", flex: 1, type: "rightAligned", valueFormatter: (p) => formatNumber(p.value) },
      ],
      defaultColDef: { sortable: false, resizable: true, suppressMovable: true, suppressHeaderMenuButton: true },
      getRowId: (p) => String(p.data.id),
      rowSelection: { mode: "multiRow", checkboxes: false, headerCheckbox: false, enableClickSelection: true },
      stopEditingWhenCellsLoseFocus: true,
      overlayNoRowsTemplate: '<span class="ag-overlay-no-rows-center">자산이 없습니다. 아래에서 추가하세요.</span>',
      onCellValueChanged: async (e) => {
        const a = e.data;
        if (!a.asset_name.trim()) { await alertDialog("오류", "자산명을 입력해 주세요."); return reload(); }
        if (!(await updateAsset(a.id, a.asset_name.trim(), a.initial_balance))) await alertDialog("오류", "이미 존재하는 자산명입니다.");
        else showNotice("저장되었습니다.", 1500);
        await reload();
      },
    });
  });

  onDestroy(() => api?.destroy());
</script>

<div class="page">
  <div class="grid card" bind:this={el}></div>
  <p class="muted hint">자산명과 기초 잔액은 더블클릭해서 수정할 수 있습니다. (수정하면 바로 저장)</p>
  <div class="form">
    <label>자산명: <input placeholder="자산명 (예: 국민은행)" bind:value={name} onkeydown={(e) => e.key === "Enter" && add()} /></label>
    <label>기초 잔액: <input placeholder="기초 잔액 (숫자만)" bind:value={balance} onkeydown={(e) => e.key === "Enter" && add()} /></label>
    <button onclick={add}>자산 추가</button>
    <button class="secondary" onclick={remove}>삭제</button>
  </div>
</div>

<style>
  .page { display: flex; flex-direction: column; gap: 10px; height: 100%; }
  .grid { flex: 1; min-height: 0; padding: 0; overflow: hidden; }
  .hint { margin: 0; font-size: 12px; }
  .form { display: flex; gap: 10px; align-items: center; }
  .form label { display: flex; align-items: center; gap: 6px; flex: 1; font-weight: 600; }
  .form input { flex: 1; }
</style>

<script lang="ts">
  import { onMount } from "svelte";
  import { getVersion } from "@tauri-apps/api/app";
  import { getHouseholds, addHousehold, renameHousehold, deleteHousehold, type Household } from "$lib/db";
  import { alertDialog, confirmDialog, promptDialog } from "$lib/dialogs.svelte";

  let { onselect }: { onselect: (h: Household) => void } = $props();

  let households = $state<Household[]>([]);
  let selectedId = $state<number | null>(null);
  let version = $state("");
  const selected = $derived(households.find((h) => h.id === selectedId) ?? null);

  async function refresh() {
    households = await getHouseholds();
    if (!households.some((h) => h.id === selectedId)) selectedId = households[0]?.id ?? null;
  }

  onMount(async () => {
    await refresh();
    version = await getVersion().catch(() => "");
  });

  async function create() {
    const name = (await promptDialog("새 가계부", "가계부 이름을 입력하세요:"))?.trim();
    if (!name) return;
    const id = await addHousehold(name);
    if (id == null) return alertDialog("오류", "이미 존재하는 이름입니다.");
    selectedId = id;
    await refresh();
  }

  async function rename() {
    if (!selected) return;
    const name = (await promptDialog("가계부 이름 변경", `'${selected.name}'의 새로운 이름을 입력하세요:`, selected.name))?.trim();
    if (!name || name === selected.name) return;
    if (!(await renameHousehold(selected.id, name))) return alertDialog("오류", "이미 존재하는 이름이거나 오류가 발생했습니다.");
    await refresh();
  }

  async function remove() {
    if (!selected) return;
    const ok = await confirmDialog("삭제 확인", `'${selected.name}'의 모든 데이터를 영구 삭제하시겠습니까?`, { okText: "삭제", danger: true });
    if (!ok) return;
    await deleteHousehold(selected.id);
    await refresh();
  }

  function choose() {
    if (selected) onselect(selected);
    else alertDialog("안내", "가계부를 먼저 선택해 주세요.");
  }
</script>

<main>
  <h1>🏠 관리할 가계부를 선택하세요</h1>
  <ul class="list">
    {#each households as h (h.id)}
      <li>
        <button class="item" class:active={h.id === selectedId}
          onclick={() => (selectedId = h.id)} ondblclick={() => onselect(h)}>
          {h.name} <span class="muted">(생성일: {h.created_at?.slice(0, 10)})</span>
        </button>
      </li>
    {/each}
  </ul>
  <div class="row">
    <button onclick={create}>+ 새 가계부 만들기</button>
    <button onclick={rename} disabled={!selected}>🏷️ 이름 변경</button>
    <button class="danger" onclick={remove} disabled={!selected}>🗑️ 삭제</button>
  </div>
  <button class="choose" onclick={choose}>선택 완료 (더블클릭 가능)</button>
  {#if version}<p class="version">v{version}</p>{/if}
</main>

<style>
  main { max-width: 640px; margin: 0 auto; padding: 40px 24px; display: flex; flex-direction: column; gap: 18px; height: 100vh; }
  h1 { text-align: center; font-size: 20px; color: var(--blue); margin: 0; }
  .list { list-style: none; margin: 0; padding: 10px; flex: 1; overflow: auto; background: #fff; border: 1px solid var(--border); border-radius: 12px; }
  .item { width: 100%; text-align: left; background: transparent; border: none; border-bottom: 1px solid var(--gray-soft);
    border-radius: 8px; color: var(--text-strong); font-size: 15px; font-weight: 500; padding: 18px 12px; }
  .item:hover { background: var(--gray-soft); }
  .item.active { background: var(--blue-soft); color: var(--blue); }
  .row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .choose { height: 50px; font-size: 16px; }
  .version { text-align: center; color: #9aa0a6; font-size: 12px; margin: 0; }
</style>

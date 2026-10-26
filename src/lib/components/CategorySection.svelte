<script lang="ts">
  import { app } from "$lib/state.svelte";
  import {
    getCategories, addCategory, deleteCategory, deleteCategoryParent, renameCategoryParent,
    renameCategorySub, setCategoryColor, type Category, type CategoryType,
  } from "$lib/db";
  import { alertDialog, confirmDialog, promptDialog } from "$lib/dialogs.svelte";
  import ColorPicker from "./ColorPicker.svelte";

  let { title, type }: { title: string; type: CategoryType } = $props();

  type Selection = { kind: "parent"; name: string } | { kind: "sub"; cat: Category } | null;

  let categories = $state<Category[]>([]);
  let collapsed = $state<Record<string, boolean>>({});
  let selection = $state<Selection>(null);
  let parentInput = $state("");
  let subInput = $state("");
  let coloring = $state<Category | null>(null);

  const groups = $derived.by(() => {
    const map = new Map<string, Category[]>();
    for (const c of categories) {
      if (!map.has(c.parent_category)) map.set(c.parent_category, []);
      map.get(c.parent_category)!.push(c);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b, "ko"))
      .map(([parent, subs]) => ({ parent, subs: subs.sort((a, b) => a.sub_category.localeCompare(b.sub_category, "ko")) }));
  });

  async function load() {
    if (app.householdId == null) return;
    categories = await getCategories(app.householdId, type);
  }
  $effect(() => { load(); });

  function selectParent(name: string) {
    selection = { kind: "parent", name };
    parentInput = name; subInput = "";
  }
  function selectSub(cat: Category) {
    selection = { kind: "sub", cat };
    parentInput = cat.parent_category; subInput = cat.sub_category;
  }

  async function add() {
    const parent = parentInput.trim(), sub = subInput.trim();
    if (!parent || !sub) return alertDialog("경고", "대분류와 중분류를 모두 입력하세요.");
    if (!(await addCategory(app.householdId!, type, parent, sub))) return alertDialog("오류", "이미 존재하는 항목입니다.");
    subInput = "";
    await load();
  }

  async function remove() {
    if (!selection) return alertDialog("경고", "삭제할 분류를 선택하세요.");
    if (selection.kind === "parent") {
      const ok = await confirmDialog("확인", `대분류 '${selection.name}'와(과) 소속된 모든 중분류를 삭제하시겠습니까?`, { okText: "삭제", danger: true });
      if (!ok) return;
      await deleteCategoryParent(app.householdId!, type, selection.name);
    } else {
      await deleteCategory(selection.cat.id);
    }
    selection = null;
    await load();
  }

  async function rename(target: NonNullable<Selection>) {
    const current = target.kind === "parent" ? target.name : target.cat.sub_category;
    const name = (await promptDialog("이름 수정", `'${current}'의 새 이름을 입력하세요:`, current))?.trim();
    if (!name || name === current) return;
    if (target.kind === "parent") await renameCategoryParent(app.householdId!, type, current, name);
    else await renameCategorySub(target.cat.id, name);
    await load();
  }

  async function pickColor(color: string | null) {
    if (coloring) await setCategoryColor(coloring.id, color);
    coloring = null;
    await load();
  }

  function onkeydown(e: KeyboardEvent) {
    if (e.key === "Delete") { e.preventDefault(); remove(); }
    else if (e.key === "F2" && selection) { e.preventDefault(); rename(selection); }
  }
</script>

<div class="card section">
  <h3>{title}</h3>
  <div class="tree" role="tree" tabindex="0" {onkeydown}>
    {#each groups as g (g.parent)}
      <div class="parent-row" class:selected={selection?.kind === "parent" && selection.name === g.parent}>
        <button class="toggle" aria-label="펼치기/접기" onclick={() => (collapsed[g.parent] = !collapsed[g.parent])}>
          {collapsed[g.parent] ? "▸" : "▾"}
        </button>
        <button class="label parent" onclick={() => selectParent(g.parent)} ondblclick={() => rename({ kind: "parent", name: g.parent })}>
          📂 {g.parent}
        </button>
      </div>
      {#if !collapsed[g.parent]}
        {#each g.subs as c (c.id)}
          <div class="sub-row" class:selected={selection?.kind === "sub" && selection.cat.id === c.id}>
            <button class="label" title={c.sub_category} onclick={() => selectSub(c)} ondblclick={() => rename({ kind: "sub", cat: c })}>
              └ {c.sub_category}
            </button>
            <button class="color" class:empty={!c.color} style:background={c.color ?? "#fff"}
              title="중분류 색상 선택" aria-label="중분류 색상 선택" onclick={() => (coloring = c)}></button>
          </div>
        {/each}
      {/if}
    {:else}
      <p class="muted empty-text">분류가 없습니다. 아래에서 추가하세요.</p>
    {/each}
  </div>
  <div class="inputs">
    <input placeholder="대분류" bind:value={parentInput} onkeydown={(e) => e.key === "Enter" && add()} />
    <input placeholder="중분류" bind:value={subInput} onkeydown={(e) => e.key === "Enter" && add()} />
  </div>
  <div class="buttons">
    <button onclick={add} disabled={selection?.kind === "sub"}>추가</button>
    <button class="secondary" onclick={remove}>삭제</button>
  </div>
  <p class="hint muted">더블클릭(F2)으로 이름 수정 · Delete로 삭제</p>
</div>

{#if coloring}
  <ColorPicker initial={coloring.color} onpick={pickColor} oncancel={() => (coloring = null)} />
{/if}

<style>
  .section { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
  h3 { margin: 0 0 10px; font-size: 16px; font-weight: 600; color: var(--text-strong); }
  .tree { flex: 1; overflow: auto; border: 1px solid var(--border); border-radius: 8px; padding: 6px; outline: none; }
  .tree:focus-visible { border-color: var(--blue); }
  .parent-row, .sub-row { display: flex; align-items: center; border-radius: 6px; }
  .parent-row { background: var(--blue-soft); margin-top: 4px; }
  .selected { box-shadow: inset 0 0 0 2px var(--blue); }
  .toggle, .label { background: transparent; border: none; color: inherit; font-weight: inherit; padding: 6px; }
  .toggle { width: 24px; padding: 6px 0; color: var(--muted); }
  .toggle:hover, .label:hover { background: transparent !important; }
  .label { flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-weight: 500; }
  .label.parent { color: #174ea6; font-weight: 700; }
  .sub-row .label { padding-left: 30px; }
  .color { width: 26px; height: 18px; padding: 0; border-radius: 8px; border: 1px solid var(--blue); flex: none; margin-right: 4px; }
  .color.empty { border-color: var(--border); }
  .inputs, .buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
  .inputs input { min-width: 0; }
  .hint { margin: 6px 0 0; font-size: 11px; }
  .empty-text { padding: 10px; }
</style>

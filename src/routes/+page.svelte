<script lang="ts">
  import { onMount } from "svelte";
  import { initDb, type Household } from "$lib/db";
  import { app } from "$lib/state.svelte";
  import HouseholdSelector from "$lib/components/HouseholdSelector.svelte";
  import Shell from "$lib/components/Shell.svelte";
  import DialogHost from "$lib/components/DialogHost.svelte";

  let ready = $state(false);
  let error = $state("");

  onMount(async () => {
    try {
      await initDb();
      ready = true;
    } catch (e) {
      error = String(e);
    }
  });

  function open(h: Household) {
    app.householdId = h.id;
    app.householdName = h.name;
    app.page = "settings";
    document.title = `Household Manager - ${h.name}`;
  }

  function back() {
    app.householdId = null;
    document.title = "가계부 선택";
  }
</script>

{#if error}
  <main class="error"><h1>데이터베이스를 열 수 없습니다</h1><pre>{error}</pre></main>
{:else if ready}
  {#if app.householdId == null}
    <HouseholdSelector onselect={open} />
  {:else}
    {#key app.householdId}<Shell onback={back} />{/key}
  {/if}
{/if}
<DialogHost />

<style>
  .error { padding: 40px; }
  .error h1 { color: var(--red); font-size: 18px; }
</style>

<script lang="ts">
  import { ALT, dialog, notice } from "$lib/dialogs.svelte";

  let input = $state<HTMLInputElement>();

  $effect(() => {
    if (dialog.current?.kind === "prompt") queueMicrotask(() => input?.select());
  });

  function ok() {
    const d = dialog.current;
    if (!d) return;
    d.resolve(d.kind === "prompt" ? d.value : true);
  }
  const cancel = () => dialog.current?.resolve(dialog.current.kind === "prompt" ? null : false);

  function onkeydown(e: KeyboardEvent) {
    if (!dialog.current?.armed) return;
    if (e.key === "Escape") { e.preventDefault(); cancel(); }
    else if (e.key === "Enter") { e.preventDefault(); ok(); }
  }
</script>

<svelte:window {onkeydown} />

{#if notice.text}
  <div class="notice" role="status">{notice.text}</div>
{/if}

{#if dialog.current}
  {@const d = dialog.current}
  <div class="backdrop" role="presentation">
    <div class="box" role="dialog" aria-modal="true" aria-label={d.title}>
      <h2>{d.title}</h2>
      <p>{d.message}</p>
      {#if d.kind === "prompt"}
        <input bind:this={input} bind:value={d.value} />
      {/if}
      <div class="actions">
        {#if d.kind !== "alert"}<button class="secondary" onclick={cancel}>취소</button>{/if}
        {#if d.altText}<button class="weak" onclick={() => d.resolve(ALT)}>{d.altText}</button>{/if}
        <button class={d.danger ? "danger" : ""} onclick={ok}>{d.okText}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .notice { position: fixed; top: 20px; left: 50%; transform: translateX(-50%); z-index: 110; white-space: pre-line;
    background: rgba(25, 31, 40, 0.92); color: #fff; padding: 12px 20px; border-radius: 14px; font-size: 14px; font-weight: 500;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18); }
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); display: grid; place-items: center; z-index: 100; }
  .box { background: #fff; border-radius: 20px; padding: 24px; width: min(420px, 92vw); box-shadow: 0 12px 40px rgba(0, 0, 0, 0.16); }
  h2 { margin: 0 0 8px; font-size: 18px; font-weight: 700; color: var(--text-strong); }
  p { margin: 0 0 20px; white-space: pre-line; line-height: 1.6; font-size: 14px; color: var(--text); }
  input { width: 100%; margin-bottom: 20px; font-size: 15px; padding: 12px 14px; }
  .actions { display: flex; gap: 8px; }
  .actions :global(button) { flex: 1; padding: 13px 16px; font-size: 15px; border-radius: 14px; }
</style>

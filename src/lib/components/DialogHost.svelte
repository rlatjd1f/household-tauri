<script lang="ts">
  import { dialog, notice } from "$lib/dialogs.svelte";

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
        <button class={d.danger ? "danger" : ""} onclick={ok}>{d.okText}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .notice { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); z-index: 110; white-space: pre-line;
    background: #202124; color: #fff; padding: 10px 18px; border-radius: 8px; font-size: 13px; box-shadow: 0 4px 14px rgba(0,0,0,.25); }
  .backdrop { position: fixed; inset: 0; background: rgba(32, 33, 36, 0.35); display: grid; place-items: center; z-index: 100; }
  .box { background: #fff; border-radius: 12px; padding: 20px 22px; width: min(440px, 92vw); box-shadow: 0 8px 28px rgba(0,0,0,.2); }
  h2 { margin: 0 0 8px; font-size: 16px; color: var(--text-strong); }
  p { margin: 0 0 14px; white-space: pre-line; line-height: 1.6; font-size: 14px; }
  input { width: 100%; margin-bottom: 14px; }
  .actions { display: flex; justify-content: flex-end; gap: 8px; }
</style>

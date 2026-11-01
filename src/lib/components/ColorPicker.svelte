<script lang="ts">
  // 중분류 색상 선택: 기본 팔레트 + 직접 선택 + 색 없음
  let { initial, onpick, oncancel }: {
    initial: string | null;
    onpick: (color: string | null) => void;
    oncancel: () => void;
  } = $props();

  const palette = [
    "#f28b82", "#fbbc04", "#fff475", "#ccff90", "#a7ffeb", "#cbf0f8", "#aecbfa", "#d7aefb",
    "#fdcfe8", "#e6c9a8", "#e8eaed", "#ffffff", "#d93025", "#f29900", "#188038", "#1a73e8",
    "#ffcdd2", "#ffe0b2", "#fff9c4", "#c8e6c9", "#b2dfdb", "#b3e5fc", "#c5cae9", "#e1bee7",
    "#ef9a9a", "#ffcc80", "#fff59d", "#a5d6a7", "#80cbc4", "#81d4fa", "#9fa8da", "#ce93d8",
  ];
  // svelte-ignore state_referenced_locally
  let color = $state(initial ?? "#e8f0fe");
</script>

<div class="backdrop" role="presentation" onclick={oncancel}>
  <div class="box" role="dialog" aria-modal="true" aria-label="중분류 색상 선택" tabindex="-1"
    onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.key === "Escape" && oncancel()}>
    <h2>🎨 중분류 색상 선택</h2>
    <div class="grid">
      {#each palette as c}
        <button class="swatch" class:picked={c === color} style:background={c} title={c} aria-label={c}
          onclick={() => (color = c)}></button>
      {/each}
    </div>
    <label class="custom">
      직접 선택 <input type="color" bind:value={color} />
      <span class="preview" style:background={color}>미리보기</span>
    </label>
    <div class="actions">
      <button class="secondary" onclick={() => onpick(null)}>색 없음</button>
      <span class="spacer"></span>
      <button class="secondary" onclick={oncancel}>취소</button>
      <button onclick={() => onpick(color)}>확인</button>
    </div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.4); display: grid; place-items: center; z-index: 90; }
  .box { background: #fff; border-radius: 20px; padding: 24px; width: 400px; box-shadow: 0 12px 40px rgba(0, 0, 0, 0.16); }
  h2 { margin: 0 0 16px; font-size: 18px; font-weight: 700; color: var(--text-strong); }
  .grid { display: grid; grid-template-columns: repeat(8, 1fr); gap: 8px; }
  .swatch { height: 30px; padding: 0; border: 1px solid rgba(0, 29, 58, 0.12); border-radius: 50%; aspect-ratio: 1; }
  .swatch:hover { transform: scale(1.1); }
  .swatch.picked { outline: 2px solid var(--blue); outline-offset: 2px; }
  .custom { display: flex; align-items: center; gap: 10px; margin: 18px 0; font-weight: 600; color: var(--text-strong); }
  .custom input { width: 44px; height: 32px; padding: 2px; }
  .preview { flex: 1; text-align: center; border-radius: 10px; padding: 8px; }
  .actions { display: flex; gap: 8px; }
  .spacer { flex: 1; }
</style>

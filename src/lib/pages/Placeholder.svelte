<script lang="ts">
  import { app } from "$lib/state.svelte";
  let { month }: { month?: number | null } = $props();
</script>

<div class="card">
  <p class="card-title">준비 중</p>
  <p class="muted">{app.year}년 {month ? `${month}월 가계부` : app.page} 화면은 아직 만들고 있습니다.</p>
</div>

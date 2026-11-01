<script lang="ts">
  import CategorySection from "$lib/components/CategorySection.svelte";
</script>

<div class="grid">
  <CategorySection title="💸 소비 항목 관리" type="소비" />
  <CategorySection title="💰 소득 항목 관리" type="소득" />
  <CategorySection title="💳 결제수단 관리" type="결제수단" />
  <CategorySection title="🏦 자본/부채 관리" type="자본" />
</div>

<style>
  .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; height: 100%; }
</style>

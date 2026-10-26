<script lang="ts">
  // ECharts 래퍼: 필요한 차트 종류만 불러와 크기를 줄이고, 창 크기가 바뀌면 다시 그림
  import { onDestroy, onMount } from "svelte";
  import * as echarts from "echarts/core";
  import { BarChart, LineChart } from "echarts/charts";
  import { GridComponent, LegendComponent, TitleComponent, TooltipComponent } from "echarts/components";
  import { CanvasRenderer } from "echarts/renderers";

  echarts.use([BarChart, LineChart, GridComponent, LegendComponent, TitleComponent, TooltipComponent, CanvasRenderer]);

  let { option, empty = false, emptyText = "데이터가 없습니다." }: {
    option: echarts.EChartsCoreOption; empty?: boolean; emptyText?: string;
  } = $props();

  let el: HTMLDivElement;
  let chart: echarts.ECharts | undefined;
  let observer: ResizeObserver | undefined;

  onMount(() => {
    chart = echarts.init(el, undefined, { renderer: "canvas" });
    observer = new ResizeObserver(() => chart?.resize());
    observer.observe(el);
  });

  $effect(() => {
    if (chart && !empty) chart.setOption(option, true);
    else chart?.clear();
  });

  onDestroy(() => { observer?.disconnect(); chart?.dispose(); });
</script>

<div class="wrap">
  <div class="chart" bind:this={el}></div>
  {#if empty}<p class="empty muted">{emptyText}</p>{/if}
</div>

<style>
  .wrap { position: relative; width: 100%; height: 100%; min-height: 0; }
  .chart { width: 100%; height: 100%; }
  .empty { position: absolute; inset: 0; display: grid; place-items: center; margin: 0; }
</style>

// 리포트 공통: 차트 스타일과 고정비 기준 (기존 앱과 동일)
import { formatNumber } from "./format";

/** 이 대분류는 고정비, 나머지는 변동비 */
export const FIXED_CATEGORIES = ["고정지출(주거)", "이자", "월세", "상환"];

export const CHART_FONT = { fontFamily: "Pretendard Variable, Pretendard, Malgun Gothic, Apple SD Gothic Neo, sans-serif", fontSize: 11 };
export const COLORS = { blue: "#3182f6", red: "#f04452", green: "#03b26c", grid: "#f2f4f6", axis: "#e5e8eb", text: "#8b95a1" };

export const valueAxis = () => ({
  type: "value" as const,
  axisLabel: { formatter: (v: number) => formatNumber(v), color: COLORS.text, ...CHART_FONT },
  splitLine: { lineStyle: { type: "dashed" as const, color: COLORS.grid } },
});

export const categoryAxis = (data: (string | number)[], extra: Record<string, unknown> = {}) => ({
  type: "category" as const, data,
  axisLine: { lineStyle: { color: COLORS.axis } },
  axisTick: { show: false },
  axisLabel: { color: COLORS.text, ...CHART_FONT },
  ...extra,
});

export const tooltip = (trigger: "axis" | "item" = "axis") => ({
  trigger,
  valueFormatter: (v: unknown) => `${formatNumber(Number(v))}원`,
  textStyle: CHART_FONT,
});

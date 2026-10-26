// 앱 전체에서 공유하는 상태: 선택한 가계부, 연도, 현재 화면

export type PageKey = "settings" | "budget" | "asset" | "report_monthly" | "report_yearly" | `month_${number}`;

export const app = $state({
  householdId: null as number | null,
  householdName: "",
  year: new Date().getFullYear(),
  page: "settings" as PageKey,
  /** 엑셀 가져오기처럼 데이터가 바뀌면 올려서 현재 화면을 다시 불러옴 */
  reloadToken: 0,
  /** 현재 화면에 저장하지 않은 변경이 있으면 이동 전에 확인 */
  hasUnsaved: (() => false) as () => boolean,
});

export const monthOf = (page: PageKey) => (page.startsWith("month_") ? Number(page.slice(6)) : null);

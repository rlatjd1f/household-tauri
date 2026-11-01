// 자산 관리 계산: 현재 금액 = 기존 저축액 + 저축 합계 - 소비 합계 (모든 연도)
import type { SavingsAccount, SavingsFlow, SavingsGoal } from "./db";

export const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

const signed = (f: SavingsFlow) => (f.kind === "저축" ? f.amount : -f.amount);

/** 자산별 현재 금액 */
export function currentAmounts(accounts: SavingsAccount[], flows: SavingsFlow[]) {
  const result = new Map(accounts.map((a) => [a.id, a.base_amount]));
  for (const f of flows) if (result.has(f.account_id)) result.set(f.account_id, result.get(f.account_id)! + signed(f));
  return result;
}

/** 선택한 연도의 월별 저축·소비 합계와 월말 자본 현황 */
export function monthlySummary(accounts: SavingsAccount[], flows: SavingsFlow[], year: number) {
  const ids = new Set(accounts.map((a) => a.id));
  const valid = flows.filter((f) => ids.has(f.account_id));
  const saving = MONTHS.map(() => 0), spending = MONTHS.map(() => 0);
  let running = accounts.reduce((s, a) => s + a.base_amount, 0);
  for (const f of valid) {
    if (f.year < year) running += signed(f);
    else if (f.year === year) (f.kind === "저축" ? saving : spending)[f.month - 1] += f.amount;
  }
  const balance = MONTHS.map((_, i) => (running += saving[i] - spending[i]));
  return { saving, spending, balance };
}

/** 목표 달성률과 목표일까지 매달 모아야 할 금액 */
export function goalProgress(goal: SavingsGoal, total: number, today = new Date()) {
  const rate = goal.target_amount > 0 ? total / goal.target_amount : 0;
  const remaining = Math.max(0, goal.target_amount - total);
  let monthsLeft: number | null = null;
  const end = /^(\d{4})-(\d{2})-\d{2}$/.exec(goal.end_date);
  if (end) monthsLeft = Math.max(0, (Number(end[1]) - today.getFullYear()) * 12 + Number(end[2]) - (today.getMonth() + 1));
  const perMonth = remaining && monthsLeft ? Math.ceil(remaining / monthsLeft) : null;
  return { rate, remaining, monthsLeft, perMonth };
}

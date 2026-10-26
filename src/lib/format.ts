// 숫자·금액·날짜 표시와 입력 해석

export const formatNumber = (value: number | null | undefined) => (value ?? 0).toLocaleString("ko-KR");

const AMOUNT_PATTERN = /^-?\d{1,15}$/;

/** '12,000', '12000원', '₩12,000', '-5000'(환불) -> 숫자, 그 외 null */
export function parseAmount(text: string | number | null | undefined): number | null {
  if (typeof text === "number") return Number.isInteger(text) ? text : null;
  const cleaned = (text ?? "").replace(/[,\s원₩]/g, "");
  return AMOUNT_PATTERN.test(cleaned) ? Number(cleaned) : null;
}

export const pad2 = (n: number) => String(n).padStart(2, "0");
export const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();
export const isValidDate = (text: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
};

/** 배경색에 맞춰 읽기 쉬운 글자색 */
export function textColorFor(background: string | null | undefined): string | undefined {
  const m = /^#([0-9a-f]{6})$/i.exec(background ?? "");
  if (!m) return undefined;
  const v = parseInt(m[1], 16);
  const luminance = 0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255);
  return luminance > 150 ? "#202124" : "#ffffff";
}

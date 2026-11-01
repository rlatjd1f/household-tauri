// 모든 표(가계부·예산·자산)가 함께 쓰는 토스 스타일 AG Grid 테마
import { themeQuartz } from "ag-grid-community";

export const gridTheme = (rowHeight = 40) =>
  themeQuartz.withParams({
    fontFamily: "inherit",
    fontSize: 14,
    foregroundColor: "#333d4b",
    accentColor: "#3182f6",
    backgroundColor: "#ffffff",
    borderColor: "#f2f4f6",
    wrapperBorder: false,
    wrapperBorderRadius: 12,
    headerBackgroundColor: "#f9fafb",
    headerTextColor: "#6b7684",
    headerFontSize: 13,
    headerFontWeight: 600,
    headerHeight: 38,
    headerColumnBorder: false,
    headerColumnResizeHandleColor: "#e5e8eb",
    columnBorder: false,
    rowBorder: { color: "#f2f4f6" },
    rowHeight,
    rowHoverColor: "#f9fafb",
    selectedRowBackgroundColor: "#e8f3ff",
    cellHorizontalPadding: 14,
  });

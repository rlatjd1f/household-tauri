// 엑셀 파일 열기/저장. 앱에서는 Tauri 파일 선택 창, 브라우저 미리보기에서는 파일 입력/다운로드 사용
import { invoke, isTauri } from "@tauri-apps/api/core";

const XLSX_FILTER = [{ name: "Excel Files", extensions: ["xlsx"] }];

export async function pickXlsx(): Promise<{ name: string; bytes: Uint8Array } | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const path = await open({ title: "엑셀 가져오기", multiple: false, directory: false, filters: XLSX_FILTER });
    if (!path) return null;
    const buffer = await invoke<ArrayBuffer>("read_file_bytes", { path });
    return { name: String(path).split(/[\\/]/).pop() ?? "", bytes: new Uint8Array(buffer) };
  }
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement("input"), { type: "file", accept: ".xlsx" });
    input.onchange = async () => {
      const file = input.files?.[0];
      resolve(file ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export async function saveXlsx(defaultName: string, bytes: Uint8Array): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    let path = await save({ title: "엑셀 내보내기", defaultPath: defaultName, filters: XLSX_FILTER });
    if (!path) return false;
    if (!path.toLowerCase().endsWith(".xlsx")) path += ".xlsx";
    await invoke("write_file_bytes", { path, data: Array.from(bytes) });
    return true;
  }
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  Object.assign(document.createElement("a"), { href: url, download: defaultName }).click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return true;
}

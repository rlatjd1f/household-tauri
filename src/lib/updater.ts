// 자동 업데이트: GitHub 최신 릴리즈의 latest.json을 확인해 새 버전이면 묻고 설치
import { isTauri } from "@tauri-apps/api/core";
import { confirmDialog, alertDialog, showNotice } from "$lib/dialogs.svelte";

let checked = false;

/** 앱을 켠 뒤 한 번만 확인 (실패해도 사용에 지장이 없도록 조용히 넘어감) */
export async function checkForUpdate() {
  if (checked || !isTauri() || import.meta.env.DEV) return;
  checked = true;
  const { check } = await import("@tauri-apps/plugin-updater");
  let update;
  try {
    update = await check();
  } catch (e) {
    console.warn("업데이트 확인 실패:", e);
    return;
  }
  if (!update) return;

  const ok = await confirmDialog("업데이트 확인",
    `새 버전 v${update.version}이 있습니다.\n현재 버전: v${update.currentVersion}\n\n` +
    "지금 업데이트할까요?\n설치가 끝나면 프로그램이 다시 시작됩니다.", { okText: "업데이트" });
  if (!ok) return;

  let total = 0, received = 0;
  try {
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") total = event.data.contentLength ?? 0;
      else if (event.event === "Progress") {
        received += event.data.chunkLength;
        const percent = total ? ` (${Math.min(99, Math.floor((received * 100) / total))}%)` : "";
        showNotice(`업데이트 파일을 내려받고 있습니다${percent}`, 60_000);
      } else if (event.event === "Finished") showNotice("업데이트를 설치하고 있습니다. 잠시 후 다시 시작됩니다.", 60_000);
    });
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  } catch (e) {
    showNotice("", 0);
    await alertDialog("오류", `업데이트 중 오류 발생: ${e}`);
  }
}

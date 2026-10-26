// 앱 안에서 띄우는 알림·확인·입력 대화상자 (웹뷰마다 다른 window.alert/confirm/prompt 대신 사용)

export interface DialogState {
  kind: "alert" | "confirm" | "prompt";
  title: string;
  message: string;
  value: string;
  okText: string;
  danger: boolean;
  /** 대화상자를 띄운 바로 그 키 입력(예: 셀 편집을 마친 엔터)이 대화상자를 닫지 않도록, 다음 이벤트부터 키를 받음 */
  armed: boolean;
  resolve: (result: string | boolean | null) => void;
}

export const dialog = $state<{ current: DialogState | null }>({ current: null });

function open(kind: DialogState["kind"], title: string, message: string, opts: Partial<DialogState> = {}) {
  return new Promise<string | boolean | null>((resolve) => {
    dialog.current = {
      kind, title, message, value: "", okText: "확인", danger: false, armed: false, ...opts,
      resolve: (result) => { dialog.current = null; resolve(result); },
    };
    const opened = dialog.current;
    setTimeout(() => { if (dialog.current === opened) opened.armed = true; }, 0);
  });
}

/** 작업을 막지 않는 짧은 안내 (몇 초 뒤 사라짐) */
export const notice = $state<{ text: string; id: number }>({ text: "", id: 0 });
export function showNotice(text: string, ms = 3500) {
  const id = notice.id + 1;
  notice.text = text; notice.id = id;
  setTimeout(() => { if (notice.id === id) notice.text = ""; }, ms);
}

export const alertDialog = async (title: string, message: string) => { await open("alert", title, message); };

export const confirmDialog = async (title: string, message: string, opts: { okText?: string; danger?: boolean } = {}) =>
  (await open("confirm", title, message, opts)) === true;

export const promptDialog = async (title: string, message: string, value = "") => {
  const result = await open("prompt", title, message, { value });
  return typeof result === "string" ? result : null;
};

/**
 * オフライン単体版用の mode 差し替え。
 * 通常ビルドの client/src/api/mode.ts をそのまま置き換える(standalone/vite.config.ts のリマップ)。
 * 単体版はサーバが存在しないので、常にローカルAPI実装を使う。
 */
export function isMockMode(): boolean {
  return true;
}

/** 単体版では切り替え不可(UIのトグルは押しても何も起きない) */
export function setMockMode(_on: boolean): void {
  /* no-op: 単体版はローカル実行のみ */
}

export function reloadWithMock(_on: boolean): void {
  /* no-op */
}

/** 単体版であることを画面側が判別したい場合に使う */
export const IS_STANDALONE = true;

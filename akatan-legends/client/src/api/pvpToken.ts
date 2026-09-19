/**
 * PvP(あいことば対戦)専用のプレイヤートークン。
 * ------------------------------------------------------------
 * サーバは通常の全リクエストを `'local'`固定のプレイヤーとして扱う(_helpers.ts の
 * currentPlayerId)。PvPだけは2人を区別する必要があるため、このブラウザを識別する
 * 永続トークンを生成し、PvP関連リクエストにだけ `X-Akatan-Player` ヘッダとして載せる。
 *
 * 通常の画面(キャラ/編成/ガチャ等)のリクエストにはこのヘッダを付けない。
 * 付けてしまうと、既存の 'local' プレイヤーのセーブ(所持キャラ・ゴールド等)が
 * 見えなくなってしまうため(サーバはヘッダの有無でプレイヤーIDを完全に切り替える)。
 */
const TOKEN_KEY = 'akatan.pvpPlayerToken';

function randomToken(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID().replace(/-/g, '');
    }
  } catch {
    /* crypto.randomUUID が使えない環境向けにフォールバックへ続ける */
  }
  let out = '';
  for (let i = 0; i < 32; i += 1) out += Math.floor(Math.random() * 16).toString(16);
  return out;
}

let cached: string | null = null;

/** このブラウザ(タブ)を識別するPvP用トークンを返す(無ければ生成して保存する) */
export function pvpPlayerToken(): string {
  if (cached) return cached;
  try {
    const existing = window.localStorage.getItem(TOKEN_KEY);
    if (existing && existing.length > 0) {
      cached = existing;
      return existing;
    }
    const created = randomToken();
    window.localStorage.setItem(TOKEN_KEY, created);
    cached = created;
    return created;
  } catch {
    // localStorage が使えない環境(プライベートウィンドウ等)ではタブごとの使い捨てトークンにする
    if (!cached) cached = randomToken();
    return cached;
  }
}

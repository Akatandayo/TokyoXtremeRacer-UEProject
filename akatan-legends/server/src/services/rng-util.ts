/**
 * サーバ側専用の乱数シード生成ヘルパ。
 * ------------------------------------------------------------
 * 設計書§37: ガチャ結果・装備生成・ドロップ抽選の乱数シードは必ずサーバ側で生成する。
 * クライアントからシードや結果を受け取ることは一切ない。
 *
 * `services/battle-service.ts` の `generateSeed()` と同じ手法(時刻+乱数)を使うが、
 * 戦闘用シードとは完全に独立して消費する(戦闘の決定論的リプレイに影響を与えないため)。
 * 循環import を避けるため、battle-service.ts の関数を import せずここに複製している。
 */
export function randomSeed(): number {
  const t = Date.now() % 1_000_000;
  const r = Math.floor(Math.random() * 2048);
  return (t * 2048 + r) % 2_147_483_647;
}

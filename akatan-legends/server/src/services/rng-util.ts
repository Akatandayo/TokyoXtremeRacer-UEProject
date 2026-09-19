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
/**
 * `AKATAN_RNG_SEED` が設定されていると、呼ばれるたびに決定論的な系列を返す。
 * **テスト専用の逃げ道**で、通常の起動では絶対に設定しない。ドロップ・ガチャ・
 * 装備生成が再現可能になり、E2E(tools/smoke.mjs)の結果が実行のたびに揺れなくなる。
 */
let fixedCounter = 0;

export function randomSeed(): number {
  const fixed = process.env.AKATAN_RNG_SEED;
  if (fixed !== undefined && fixed !== '') {
    const base = Number(fixed);
    if (Number.isFinite(base)) {
      // 呼び出しごとに違う値を返しつつ、系列全体は起動ごとに必ず同じになるようにする
      fixedCounter += 1;
      return (Math.abs(Math.floor(base)) * 2654435761 + fixedCounter * 40503) % 2_147_483_647;
    }
  }
  const t = Date.now() % 1_000_000;
  const r = Math.floor(Math.random() * 2048);
  return (t * 2048 + r) % 2_147_483_647;
}

/**
 * 転生(設計書§17〜§20)まわりの表示ヘルパー。
 *
 * §19「同じキャラクターでも転生によって異なる方向へ育成できる」を成立させるのは
 * `RebirthNodeDef.path` の4系統ツリーなので、ここでは
 *   - 系統ごとのラベル/色/アイコン
 *   - ノードの効果を日本語文にする
 *   - 「なぜ取れないか」を文章化する(グレーアウトだけで終わらせない)
 *   - 所持キャラの `rebirthNodes` から「主系統」「系統別投資量」を逆算する
 * を共通化する。§20 の役割分担(転生=長期育成/覚醒=戦闘中の特殊状態)を UI 上でも
 * 一貫させるため、転生関連の文言・色は覚醒(AWAKENING)とは完全に独立させている。
 */
import type {
  RebirthPath, RebirthNodeDef, RebirthEffect, RebirthStatus, RebirthConfig, MaterialStack, MaterialDef,
} from '@akatan/shared';
import { STAT_LABEL, formatNumber } from './labels';

export const REBIRTH_PATH_ORDER: RebirthPath[] = ['ATTACK', 'SPEED', 'ENDURANCE', 'SPECIAL'];

export const REBIRTH_PATH_LABEL: Record<RebirthPath, string> = {
  ATTACK: '攻撃型', SPEED: '速度型', ENDURANCE: '耐久型', SPECIAL: '特殊型',
};

/** カード紋章と同じ「単漢字」の流儀で揃える(ROLE_LABEL 等と同じ見た目のトーン) */
export const REBIRTH_PATH_ICON: Record<RebirthPath, string> = {
  ATTACK: '攻', SPEED: '速', ENDURANCE: '耐', SPECIAL: '特',
};

export const REBIRTH_PATH_DESC: Record<RebirthPath, string> = {
  ATTACK: '火力に振る。攻撃力・会心・スキル威力を伸ばす系統。',
  SPEED: '手数と先手を取る。速度・行動/必殺ゲージ開始値を伸ばす系統。',
  ENDURANCE: '耐える。HP・防御・状態異常耐性を伸ばす系統。',
  SPECIAL: '尖った特性を伸ばす。会心倍率・回復力・スキル威力など個性重視の系統。',
};

export function pathColorVar(path: RebirthPath): string {
  return `var(--path-${path})`;
}

/** 1ランクあたりの効果を日本語文にする。ranks>1 なら「現在のランク合計」を表す文言になる */
export function rebirthEffectText(effect: RebirthEffect, ranks = 1): string {
  const amt = Math.round(effect.value * ranks * 100) / 100;
  const sign = amt >= 0 ? '+' : '';
  const statLabel = effect.stat ? (STAT_LABEL[effect.stat] ?? effect.stat) : '';
  switch (effect.kind) {
    case 'STAT_FLAT':
      return `${statLabel} ${sign}${amt}`;
    case 'STAT_PERCENT':
      return `${statLabel} ${sign}${amt}%`;
    case 'GROWTH_PERCENT':
      return `${statLabel}成長率 ${sign}${amt}%`;
    case 'SKILL_POWER':
      return `スキル威力 ${sign}${amt}%`;
    case 'GAUGE_START':
      return `戦闘開始時 行動ゲージ ${sign}${amt}%`;
    case 'ULT_GAUGE_START':
      return `戦闘開始時 必殺ゲージ ${sign}${amt}%`;
    default:
      return `${effect.kind} ${sign}${amt}`;
  }
}

export interface RebirthNodeState {
  rank: number;
  maxed: boolean;
  /** 解放条件(累計ポイント/転生回数)を満たしていないか */
  locked: boolean;
  /** locked=true の場合、なぜ取れないかの日本語文(複数あり得る) */
  lockReasons: string[];
  /** 次の1ランクに必要な転生ポイント */
  nextCost: number;
  /** 未使用ポイントが足りているか(locked/maxed とは独立) */
  affordable: boolean;
  /** locked でも maxed でもなく、ポイントも足りている = 実際に振れる */
  canAllocateNext: boolean;
}

/** ノード1件の「現在取れるか/取れないなら何故か」を判定する(表示専用。実際の許可はサーバが確定) */
export function nodeStateOf(node: RebirthNodeDef, status: RebirthStatus): RebirthNodeState {
  const rank = status.nodes[node.id] ?? 0;
  const maxed = rank >= node.maxRank;
  const reasons: string[] = [];
  if (node.requiresRebirth !== undefined && status.rebirth < node.requiresRebirth) {
    reasons.push(`転生${node.requiresRebirth}回目から解放(現在${status.rebirth}回)`);
  }
  const pathPts = status.pathPoints[node.path] ?? 0;
  if (node.requiresPathPoints !== undefined && pathPts < node.requiresPathPoints) {
    reasons.push(`${REBIRTH_PATH_LABEL[node.path]}に累計${node.requiresPathPoints}ポイント必要(現在${pathPts})`);
  }
  const locked = reasons.length > 0;
  const affordable = status.pointsAvailable >= node.cost;
  return {
    rank,
    maxed,
    locked,
    lockReasons: reasons,
    nextCost: node.cost,
    affordable,
    canAllocateNext: !maxed && !locked && affordable,
  };
}

/** 所持キャラの rebirthNodes からノード定義を辿って系統別の累計投資ポイントを逆算する */
export function computePathPoints(
  nodes: Record<string, number> | undefined,
  defs: RebirthNodeDef[] | undefined,
): Record<RebirthPath, number> {
  const totals: Record<RebirthPath, number> = { ATTACK: 0, SPEED: 0, ENDURANCE: 0, SPECIAL: 0 };
  if (!nodes || !defs) return totals;
  for (const def of defs) {
    const rank = nodes[def.id];
    if (rank) totals[def.path] += rank * def.cost;
  }
  return totals;
}

/**
 * 「主系統」判定(§19: 一覧で編成判断に使えるように)。
 * 最も投資している系統を返す。未転生 or 未投資なら null(一覧では非表示にする)。
 */
export function primaryRebirthPath(
  nodes: Record<string, number> | undefined,
  defs: RebirthNodeDef[] | undefined,
): RebirthPath | null {
  const totals = computePathPoints(nodes, defs);
  let best: RebirthPath | null = null;
  let bestVal = 0;
  for (const p of REBIRTH_PATH_ORDER) {
    if (totals[p] > bestVal) {
      bestVal = totals[p];
      best = p;
    }
  }
  return best;
}

/** 素材所持数の解決(所持0件でも 0 を返す) */
export function materialCountOf(materials: MaterialStack[] | undefined, materialId: string): number {
  return materials?.find((m) => m.id === materialId)?.count ?? 0;
}

export function materialNameOf(defs: MaterialDef[] | undefined, materialId: string): string {
  return defs?.find((m) => m.id === materialId)?.name ?? materialId;
}

/** 転生コスト(素材)の充足チェック。表示用(実際の判定はサーバ/モックAPI側) */
export function costFulfillment(
  cost: RebirthConfig['cost'],
  materials: MaterialStack[] | undefined,
): { ok: boolean; rows: { materialId: string; need: number; have: number }[] } {
  const rows = (cost ?? []).map((c) => ({
    materialId: c.materialId,
    need: c.count,
    have: materialCountOf(materials, c.materialId),
  }));
  return { ok: rows.every((r) => r.have >= r.need), rows };
}

export function formatSignedPct(n: number): string {
  const r = Math.round(n * 10) / 10;
  if (r === 0) return '±0%';
  return r > 0 ? `+${r}%` : `${r}%`;
}

export { formatNumber };

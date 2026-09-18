/**
 * デモモード用の転生(設計書§17〜§20)データ + ロジック。
 *
 * サーバ/データ担当の本実装が入るまでの「演出レビュー用」代役。ポイント消費・
 * 解放条件の判定はここで実際に動かす(見た目だけのダミーにしない)。
 *
 * ノード構成は §19「同じキャラクターでも転生によって異なる方向へ育成できる」を
 * 確認できるよう、4系統(攻撃/速度/耐久/特殊)それぞれに
 *   下位(制限なし・広く伸ばす) → 中位(同系統への累計投資が必要) →
 *   上位(さらに投資必要) → 極意(累計投資 + 2回目以降の転生が必要)
 * という「散らすと上位に届かない」構造を持たせている。
 *
 * requiredLevel はデモ用に 20 へ下げている(本番の levelCap は60想定 = §18)。
 * 所持キャラのレベル帯(8〜24)のままでも「転生できる/まだできない」の両方を
 * 確認できるようにするための調整で、バランス上の意味は無い。
 */
import type {
  RebirthNodeDef, RebirthConfig, RebirthStatus, RebirthResponse, ResetRebirthResponse,
  OwnedCharacter, CharacterView,
} from '@akatan/shared';
import { MOCK_CHARACTERS, MOCK_MATERIALS } from './master';
import { mockState, buildView } from './player';
import { removeMaterial } from './equipment';
import { computePathPoints, REBIRTH_PATH_LABEL } from '../utils/rebirth';
import { ApiClientError } from '../api/client';

export const MOCK_REBIRTH_CONFIG: RebirthConfig = {
  requiredLevel: 20,
  pointsPerRebirth: 12,
  growthBonusPercent: 8,
  maxRebirth: 5,
  cost: [{ materialId: 'mat_rebirth_echo', count: 3 }],
  resetCost: [{ materialId: 'mat_rebirth_seal', count: 1 }],
};

export const MOCK_REBIRTH_NODES: RebirthNodeDef[] = [
  // ---------- 攻撃型 ----------
  {
    id: 'rn_atk_1', name: '闘気の型', path: 'ATTACK', cost: 1, maxRank: 5,
    description: '全身に闘気を巡らせ、素の攻撃力を高める。',
    effects: [{ kind: 'STAT_PERCENT', stat: 'attack', value: 2 }],
  },
  {
    id: 'rn_atk_2', name: '会心の理', path: 'ATTACK', cost: 2, maxRank: 3, requiresPathPoints: 6,
    description: '急所を見抜く目を養い、会心率そのものを積む。',
    effects: [{ kind: 'STAT_FLAT', stat: 'critical', value: 1.5 }],
  },
  {
    id: 'rn_atk_3', name: '必殺の重み', path: 'ATTACK', cost: 3, maxRank: 3, requiresPathPoints: 14,
    description: '必殺技そのものの重みを増す。',
    effects: [{ kind: 'SKILL_POWER', value: 4 }],
  },
  {
    id: 'rn_atk_4', name: '破壊の極意', path: 'ATTACK', cost: 5, maxRank: 1, requiresPathPoints: 24, requiresRebirth: 2,
    description: '破壊を極めた者だけが辿り着く境地。2回目の転生を経てようやく会得できる。',
    effects: [
      { kind: 'STAT_PERCENT', stat: 'attack', value: 10 },
      { kind: 'GROWTH_PERCENT', stat: 'attack', value: 10 },
    ],
  },
  // ---------- 速度型 ----------
  {
    id: 'rn_spd_1', name: '疾風の型', path: 'SPEED', cost: 1, maxRank: 5,
    description: '足取りを軽くし、素の速度を高める。',
    effects: [{ kind: 'STAT_PERCENT', stat: 'speed', value: 2 }],
  },
  {
    id: 'rn_spd_2', name: '先陣ゲージ', path: 'SPEED', cost: 2, maxRank: 3, requiresPathPoints: 6,
    description: '戦闘開始と同時に一歩前へ出る。行動ゲージが初めから進んでいる。',
    effects: [{ kind: 'GAUGE_START', value: 8 }],
  },
  {
    id: 'rn_spd_3', name: '必殺の疾走', path: 'SPEED', cost: 3, maxRank: 3, requiresPathPoints: 14,
    description: '必殺ゲージの溜まりを前借りする。',
    effects: [{ kind: 'ULT_GAUGE_START', value: 6 }],
  },
  {
    id: 'rn_spd_4', name: '神速の極意', path: 'SPEED', cost: 5, maxRank: 1, requiresPathPoints: 24, requiresRebirth: 2,
    description: '速さの果て。2回目の転生を経てようやく会得できる。',
    effects: [
      { kind: 'STAT_PERCENT', stat: 'speed', value: 15 },
      { kind: 'GROWTH_PERCENT', stat: 'speed', value: 10 },
    ],
  },
  // ---------- 耐久型 ----------
  {
    id: 'rn_end_1', name: '鉄壁の型', path: 'ENDURANCE', cost: 1, maxRank: 5,
    description: '構えを鍛え、素の防御力を高める。',
    effects: [{ kind: 'STAT_PERCENT', stat: 'defense', value: 2 }],
  },
  {
    id: 'rn_end_2', name: '生命の器', path: 'ENDURANCE', cost: 2, maxRank: 3, requiresPathPoints: 6,
    description: 'HPの器そのものを大きくする。',
    effects: [{ kind: 'STAT_PERCENT', stat: 'hp', value: 3 }],
  },
  {
    id: 'rn_end_3', name: '不屈の心', path: 'ENDURANCE', cost: 3, maxRank: 3, requiresPathPoints: 14,
    description: '状態異常への耐性を積む。',
    effects: [{ kind: 'STAT_FLAT', stat: 'resistance', value: 4 }],
  },
  {
    id: 'rn_end_4', name: '金剛の極意', path: 'ENDURANCE', cost: 5, maxRank: 1, requiresPathPoints: 24, requiresRebirth: 2,
    description: '不壊の境地。2回目の転生を経てようやく会得できる。',
    effects: [
      { kind: 'STAT_PERCENT', stat: 'defense', value: 12 },
      { kind: 'GROWTH_PERCENT', stat: 'hp', value: 10 },
    ],
  },
  // ---------- 特殊型 ----------
  {
    id: 'rn_spc_1', name: '秘術の型', path: 'SPECIAL', cost: 1, maxRank: 5,
    description: '独自の技法を磨き、回復力を高める。',
    effects: [{ kind: 'STAT_PERCENT', stat: 'healing', value: 2 }],
  },
  {
    id: 'rn_spc_2', name: '共鳴の紋', path: 'SPECIAL', cost: 2, maxRank: 3, requiresPathPoints: 6,
    description: 'スキル全般の効きを高める紋様を刻む。',
    effects: [{ kind: 'SKILL_POWER', value: 3 }],
  },
  {
    id: 'rn_spc_3', name: '並行世界の残響', path: 'SPECIAL', cost: 3, maxRank: 3, requiresPathPoints: 14,
    description: '会心時の一撃をさらに重くする。',
    effects: [{ kind: 'STAT_PERCENT', stat: 'criticalDamage', value: 5 }],
  },
  {
    id: 'rn_spc_4', name: '特異点の極意', path: 'SPECIAL', cost: 5, maxRank: 1, requiresPathPoints: 24, requiresRebirth: 2,
    description: '個性の極致。2回目の転生を経てようやく会得できる。',
    effects: [
      { kind: 'GROWTH_PERCENT', stat: 'critical', value: 15 },
      { kind: 'SKILL_POWER', value: 10 },
    ],
  },
];

const NODE_MAP = new Map(MOCK_REBIRTH_NODES.map((n) => [n.id, n]));

function materialName(id: string): string {
  return MOCK_MATERIALS.find((m) => m.id === id)?.name ?? id;
}

function findOwned(uid: string): OwnedCharacter {
  const owned = mockState.owned.find((o) => o.uid === uid);
  if (!owned) throw new ApiClientError('NOT_FOUND', 'キャラクターが見つかりません。');
  return owned;
}

function viewOf(owned: OwnedCharacter): CharacterView {
  const def = MOCK_CHARACTERS.find((d) => d.id === owned.defId);
  if (!def) throw new ApiClientError('NOT_FOUND', 'キャラクター定義が見つかりません。');
  return buildView(def, owned);
}

/** 現在の所持素材で cost を満たせているかの判定 + 不足文言 */
function checkCost(cost: RebirthConfig['cost']): { ok: boolean; reason?: string } {
  if (!cost || cost.length === 0) return { ok: true };
  const lacking = cost.filter((c) => {
    const have = mockState.inventory.materials.find((m) => m.id === c.materialId)?.count ?? 0;
    return have < c.count;
  });
  if (lacking.length === 0) return { ok: true };
  const text = lacking
    .map((c) => {
      const have = mockState.inventory.materials.find((m) => m.id === c.materialId)?.count ?? 0;
      return `${materialName(c.materialId)}×${c.count}(所持${have})`;
    })
    .join(' / ');
  return { ok: false, reason: `素材が足りません(${text})。` };
}

export function buildRebirthStatus(owned: OwnedCharacter): RebirthStatus {
  const cfg = MOCK_REBIRTH_CONFIG;
  const nodes = { ...(owned.rebirthNodes ?? {}) };
  const pathPoints = computePathPoints(nodes, MOCK_REBIRTH_NODES);
  const pointsAvailable = owned.rebirthPointsAvailable ?? 0;
  const growthBonusPercent = owned.rebirth * cfg.growthBonusPercent;

  let canRebirth = true;
  let reason: string | undefined;
  if (owned.rebirth >= cfg.maxRebirth) {
    canRebirth = false;
    reason = `転生回数が上限(${cfg.maxRebirth}回)に達しています。`;
  } else if (owned.level < cfg.requiredLevel) {
    canRebirth = false;
    reason = `レベルが足りません(必要 Lv${cfg.requiredLevel} / 現在 Lv${owned.level})。`;
  } else {
    const costCheck = checkCost(cfg.cost);
    if (!costCheck.ok) {
      canRebirth = false;
      reason = costCheck.reason;
    }
  }

  return { rebirth: owned.rebirth, canRebirth, reason, pointsAvailable, nodes, pathPoints, growthBonusPercent };
}

export function getMockRebirthStatus(uid: string): { character: CharacterView; status: RebirthStatus } {
  const owned = findOwned(uid);
  return { character: viewOf(owned), status: buildRebirthStatus(owned) };
}

export function performMockRebirth(uid: string): RebirthResponse {
  const owned = findOwned(uid);
  const cfg = MOCK_REBIRTH_CONFIG;
  const status = buildRebirthStatus(owned);
  if (!status.canRebirth) {
    throw new ApiClientError('REBIRTH_LOCKED', status.reason ?? 'まだ転生できません。');
  }

  const before = { level: owned.level, rebirth: owned.rebirth, stats: { ...viewOf(owned).stats } };

  if (cfg.cost) {
    for (const c of cfg.cost) removeMaterial(mockState.inventory.materials, c.materialId, c.count);
  }
  owned.level = 1;
  owned.exp = 0;
  owned.rebirth += 1;
  owned.rebirthPointsAvailable = (owned.rebirthPointsAvailable ?? 0) + cfg.pointsPerRebirth;

  const afterView = viewOf(owned);
  const after = { level: owned.level, rebirth: owned.rebirth, stats: { ...afterView.stats } };

  return {
    character: afterView,
    status: buildRebirthStatus(owned),
    player: { ...mockState.player },
    before,
    after,
    inventory: {
      equipment: mockState.inventory.equipment.map((e) => ({ ...e })),
      materials: mockState.inventory.materials.map((m) => ({ ...m })),
      tickets: mockState.inventory.tickets.map((t) => ({ ...t })),
    },
  };
}

export interface MockAllocateResult {
  character: CharacterView;
  status: RebirthStatus;
}

export function allocateMockRebirth(uid: string, nodeId: string, ranks = 1): MockAllocateResult {
  const owned = findOwned(uid);
  const node = NODE_MAP.get(nodeId);
  if (!node) throw new ApiClientError('NOT_FOUND', 'ノードが見つかりません。');
  if (ranks <= 0) throw new ApiClientError('BAD_REQUEST', 'ランク数が不正です。');

  const status = buildRebirthStatus(owned);
  const currentRank = status.nodes[nodeId] ?? 0;

  if (node.requiresRebirth !== undefined && status.rebirth < node.requiresRebirth) {
    throw new ApiClientError('REBIRTH_LOCKED', `転生${node.requiresRebirth}回目から解放されます(現在${status.rebirth}回)。`);
  }
  const pathPts = status.pathPoints[node.path] ?? 0;
  if (node.requiresPathPoints !== undefined && pathPts < node.requiresPathPoints) {
    throw new ApiClientError(
      'REBIRTH_LOCKED',
      `${REBIRTH_PATH_LABEL[node.path]}に累計${node.requiresPathPoints}ポイント必要です(現在${pathPts})。`,
    );
  }
  if (currentRank + ranks > node.maxRank) {
    throw new ApiClientError('BAD_REQUEST', `このノードは最大${node.maxRank}ランクです(現在${currentRank}ランク)。`);
  }
  const totalCost = node.cost * ranks;
  if (totalCost > status.pointsAvailable) {
    throw new ApiClientError(
      'NOT_ENOUGH_POINTS',
      `転生ポイントが足りません(必要${totalCost} / 未使用${status.pointsAvailable})。`,
    );
  }

  owned.rebirthNodes = { ...(owned.rebirthNodes ?? {}), [nodeId]: currentRank + ranks };
  owned.rebirthPointsAvailable = status.pointsAvailable - totalCost;

  return { character: viewOf(owned), status: buildRebirthStatus(owned) };
}

export function resetMockRebirth(uid: string): ResetRebirthResponse {
  const owned = findOwned(uid);
  const cfg = MOCK_REBIRTH_CONFIG;
  if (!cfg.resetCost) {
    throw new ApiClientError('BAD_REQUEST', '振り直しは設定されていません。');
  }
  const costCheck = checkCost(cfg.resetCost);
  if (!costCheck.ok) {
    throw new ApiClientError('NOT_ENOUGH_CURRENCY', costCheck.reason ?? '素材が足りません。');
  }
  for (const c of cfg.resetCost) removeMaterial(mockState.inventory.materials, c.materialId, c.count);

  const status = buildRebirthStatus(owned);
  const refund = Object.entries(status.nodes).reduce((sum, [nodeId, rank]) => {
    const node = NODE_MAP.get(nodeId);
    return node ? sum + node.cost * rank : sum;
  }, 0);
  owned.rebirthNodes = {};
  owned.rebirthPointsAvailable = (owned.rebirthPointsAvailable ?? 0) + refund;

  return {
    character: viewOf(owned),
    status: buildRebirthStatus(owned),
    inventory: {
      equipment: mockState.inventory.equipment.map((e) => ({ ...e })),
      materials: mockState.inventory.materials.map((m) => ({ ...m })),
      tickets: mockState.inventory.tickets.map((t) => ({ ...t })),
    },
  };
}

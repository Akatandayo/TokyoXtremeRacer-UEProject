/**
 * デモモード用のレイド実装(設計書§28〜§29)。
 *
 * 実戦闘そのものは既存の `generateMockBattle` をそのまま使い、1回の挑戦(=通常の戦闘)で
 * 与えたダメージの合計を、レイドボスが持つ「共有HPプール」から減らす。
 * バランス数値に意味は無い(演出・画面レビュー用)。
 */
import type {
  RaidBossDef, RaidState, RaidAttemptResult, RaidListResponse, RaidAttackResponse,
  StageDef, CharacterView, CharacterDropResult, DropResult,
} from '@akatan/shared';
import { MOCK_CHARACTER_MAP } from './master';
import { mockState, mockCharacterViews, expToNext } from './player';
import { generateMockBattle, buildRewards } from './battle';
import { rollMockDrops, generateEquipment, rollRarityForDrop, addMaterial } from './equipment';
import { ApiClientError } from '../api/client';

export const MOCK_RAID_BOSSES: RaidBossDef[] = [
  {
    id: 'raid_vald_reborn',
    name: '深淵のヴァルド',
    title: 'レイド:虚無の顕現',
    enemyId: 'en_raid_hollow',
    level: 22,
    totalHp: 60000,
    description: '第2章ボス・虚王ヴァルドが廃サーバの奥で再構成された姿。1回の挑戦では削りきれない共有HPを持ち、何度も挑んで少しずつ削っていくレイド入門級。HPが減るほど攻撃的になる。',
    gimmicks: [
      { hpBelow: 66, name: '虚無の加速', description: 'HP66%以下で速度と攻撃力が上昇する。', statBonus: { speed: 15, attack: 10 } },
      { hpBelow: 33, name: '崩壊の号令', description: 'HP33%以下で攻撃力と会心ダメージが大きく上昇する。', statBonus: { attack: 25, criticalDamage: 20 } },
    ],
    weakElements: ['LIGHT'],
    immuneStatuses: ['SILENCE'],
    dropTable: 'dt_raid_vald_defeat',
    attemptDropTable: 'dt_raid_vald_attempt',
    art: { primary: '#2a1b33', secondary: '#0c0710', accent: '#e85dff', sigil: '深', pattern: 'void' },
  },
  {
    id: 'raid_null_awakened',
    name: '覚醒ヌル・デーモン',
    title: 'レイド:終端の残響',
    enemyId: 'en_raid_null',
    level: 28,
    totalHp: 110000,
    description: '第2章最終ボス・ヌル・デーモンが自己修復の限界を超えて肥大化した姿。段階的に防御と攻撃を固めてくる、レイド上級。独の物語の行き着く先でもある。',
    gimmicks: [
      { hpBelow: 70, name: 'ファイアウォール再起動', description: 'HP70%以下で防御力が上昇する。', statBonus: { defense: 25 } },
      { hpBelow: 40, name: 'コア暴走', description: 'HP40%以下で攻撃力と速度が上昇する。', statBonus: { attack: 20, speed: 15 } },
      { hpBelow: 15, name: '最終防壁', description: 'HP15%以下で防御力と会心ダメージがさらに上昇する。', statBonus: { defense: 20, criticalDamage: 25 } },
    ],
    weakElements: ['FIRE'],
    immuneStatuses: ['POISON', 'SILENCE'],
    dropTable: 'dt_raid_null_defeat',
    attemptDropTable: 'dt_raid_null_attempt',
    art: { primary: '#1a1730', secondary: '#070610', accent: '#00e5ff', sigil: '終', pattern: 'circuit' },
  },
];

const RAID_DROP_CHARACTER_ID = 'ch_hitori_stand';

function freshState(boss: RaidBossDef): RaidState {
  return {
    bossId: boss.id,
    remainingHp: boss.totalHp,
    totalHp: boss.totalHp,
    attempts: 0,
    totalDamage: 0,
    defeated: false,
    clears: 0,
    triggeredGimmicks: [],
    updatedAt: new Date().toISOString(),
  };
}

/** デモ用の可変ステート。プロセス生存中(=ページを開いている間)だけ保持される。 */
const raidStates = new Map<string, RaidState>(MOCK_RAID_BOSSES.map((b) => [b.id, freshState(b)]));

export function getMockRaidList(): RaidListResponse {
  const states: Record<string, RaidState> = {};
  for (const [id, s] of raidStates) states[id] = { ...s, triggeredGimmicks: [...s.triggeredGimmicks] };
  return { bosses: MOCK_RAID_BOSSES, states };
}

let dupUidSeq = 1;
function nextOwnUid(): string {
  dupUidSeq += 1;
  return `own_raid_${Date.now().toString(36)}${dupUidSeq.toString(36)}`;
}

/** 撃破時にだけ抽選する、レイド限定キャラのドロップ(デモなので確率は高め)。 */
function rollRaidCharacterDrop(): CharacterDropResult | null {
  if (Math.random() >= 0.55) return null;
  const def = MOCK_CHARACTER_MAP.get(RAID_DROP_CHARACTER_ID);
  if (!def) return null;
  const already = mockState.owned.some((o) => o.defId === RAID_DROP_CHARACTER_ID);
  if (already) {
    const matId = 'mat_dup_ssr';
    const count = 3;
    const matDef = { id: matId, count };
    const stack = mockState.inventory.materials.find((m) => m.id === matId);
    if (stack) stack.count += count;
    else mockState.inventory.materials.push({ ...matDef });
    return { defId: RAID_DROP_CHARACTER_ID, name: def.name, rarity: def.rarity, duplicate: true, converted: matDef };
  }
  const uid = nextOwnUid();
  mockState.owned.push({ uid, defId: RAID_DROP_CHARACTER_ID, level: 1, exp: 0, rebirth: 0, obtainedAt: new Date().toISOString() });
  return { defId: RAID_DROP_CHARACTER_ID, name: def.name, rarity: def.rarity, duplicate: false, uid };
}

function mergeDrops(base: DropResult | null, extraChar: CharacterDropResult | null, extraGold: number): DropResult | null {
  if (!extraChar && extraGold <= 0) return base;
  const out: DropResult = base ? { ...base, characters: [...base.characters] } : { gold: 0, equipment: [], materials: [], characters: [], tickets: [] };
  out.gold += extraGold;
  if (extraChar) out.characters.push(extraChar);
  return out;
}

export function performMockRaidAttack(bossId: string, members?: (string | null)[]): RaidAttackResponse {
  const boss = MOCK_RAID_BOSSES.find((b) => b.id === bossId);
  if (!boss) throw new ApiClientError('NOT_FOUND', 'レイドボスが見つかりません。');

  const state = raidStates.get(bossId) ?? freshState(boss);
  if (state.defeated) {
    throw new ApiClientError('RAID_DEFEATED', 'このレイドボスはすでに撃破されています。');
  }

  const uids = (members ?? mockState.party.members).filter((m): m is string => !!m);
  const views = mockCharacterViews();
  const party = uids
    .map((uid) => views.find((v) => v.owned.uid === uid))
    .filter((v): v is CharacterView => !!v);
  if (party.length === 0) {
    throw new ApiClientError('PARTY_EMPTY', 'パーティが空です。');
  }

  const stage: StageDef = {
    id: `raid_${boss.id}`,
    name: `${boss.name}${boss.title ? ` — ${boss.title}` : ''}`,
    description: boss.description,
    boss: true,
    enemies: [{ enemyId: boss.enemyId, level: boss.level }],
    rewards: { exp: Math.round(60 + boss.level * 14), gold: Math.round(140 + boss.level * 40) },
  };

  const log = generateMockBattle(party, stage);
  const allyStats = log.result.stats.filter((s) => s.side === 'ALLY');
  const damage = allyStats.reduce((sum, s) => sum + s.damageDealt, 0);

  const hpBefore = state.remainingHp;
  const hpAfter = Math.max(0, hpBefore - damage);
  const defeatedNow = hpAfter <= 0 && !state.defeated;

  const newGimmicks = (boss.gimmicks ?? []).filter((g) => {
    if (state.triggeredGimmicks.includes(g.name)) return false;
    const pct = (hpAfter / state.totalHp) * 100;
    return pct <= g.hpBelow;
  });

  const mvpStat = allyStats.slice().sort((a, b) => b.damageDealt - a.damageDealt)[0];
  const mvp = mvpStat && mvpStat.damageDealt > 0 ? { id: mvpStat.id, name: mvpStat.name, damage: mvpStat.damageDealt } : undefined;

  // 周回可能なボス(既定)は撃破したらHPをリセットして何度でも挑める
  const killed = hpAfter <= 0;
  const repeatable = boss.repeatable !== false;
  const didReset = killed && repeatable;
  const clears = (state.clears ?? 0) + (killed ? 1 : 0);

  const nextState: RaidState = {
    bossId: boss.id,
    remainingHp: didReset ? state.totalHp : hpAfter,
    totalHp: state.totalHp,
    attempts: state.attempts + 1,
    totalDamage: state.totalDamage + damage,
    defeated: killed && !repeatable,
    clears,
    triggeredGimmicks: didReset ? [] : [...state.triggeredGimmicks, ...newGimmicks.map((g) => g.name)],
    updatedAt: new Date().toISOString(),
  };
  raidStates.set(boss.id, nextState);

  const raid: RaidAttemptResult = {
    damage, hpBefore, hpAfter, defeated: defeatedNow, clears, reset: didReset, newGimmicks, mvp,
  };

  // 報酬(参加報酬): 通常戦闘と同様、勝敗に関わらず基礎報酬 + 勝利時ドロップ
  const rewards = log.result.victory ? buildRewards(party, stage) : null;
  if (rewards) {
    mockState.player = { ...mockState.player, gold: mockState.player.gold + rewards.gold };
    for (const uid of uids) {
      const o = mockState.owned.find((x) => x.uid === uid);
      if (!o) continue;
      o.exp += rewards.exp;
      while (o.exp >= expToNext(o.level) && o.level < 99) {
        o.exp -= expToNext(o.level);
        o.level += 1;
      }
    }
  }

  let drops = rollMockDrops(stage, log.result.victory);
  if (defeatedNow) {
    // 撃破ボーナス: 追加ゴールド + レイド限定キャラの抽選
    const bonusGold = Math.round(400 + boss.level * 30);
    const charDrop = rollRaidCharacterDrop();
    drops = mergeDrops(drops, charDrop, bonusGold);
    if (drops) mockState.player = { ...mockState.player, gold: mockState.player.gold + bonusGold };
    // 撃破記念の高レア装備を1つ追加
    const bonusEq = generateEquipment(rollRarityForDrop(boss.level, true), boss.level);
    mockState.inventory.equipment.push(bonusEq);
    drops = drops
      ? { ...drops, equipment: [...drops.equipment, bonusEq] }
      : { gold: 0, equipment: [bonusEq], materials: [], characters: [], tickets: [] };
    addMaterial(mockState.inventory.materials, 'mat_rebirth_seal', 1);
  }

  return {
    log,
    raid,
    state: nextState,
    player: { ...mockState.player },
    characters: mockCharacterViews(),
    rewards,
    drops,
    inventory: {
      equipment: mockState.inventory.equipment.map((e) => ({ ...e })),
      materials: mockState.inventory.materials.map((m) => ({ ...m })),
      tickets: mockState.inventory.tickets.map((t) => ({ ...t })),
    },
  };
}

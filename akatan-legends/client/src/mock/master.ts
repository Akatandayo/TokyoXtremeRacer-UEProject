/**
 * デモモード用のマスターデータ(クライアント内蔵)。
 * サーバ / data 担当の本実装が入るまでの「演出レビュー用」ダミー。
 * 数値バランスに意味は無く、見た目と再生の確認だけが目的。
 */
import type {
  CharacterDef, EnemyDef, Skill, AiProfile, ChapterDef, Stats, Rarity,
  Element, Role, CharacterArt, ComboDef, PlannedCharacterDef, MaterialDef,
} from '@akatan/shared';

function st(
  hp: number, attack: number, defense: number, speed: number,
  critical = 8, criticalDamage = 150, resistance = 10, healing = 100,
): Stats {
  return { hp, attack, defense, speed, critical, criticalDamage, resistance, healing };
}

function art(
  primary: string, secondary: string, accent: string, sigil: string,
  pattern: CharacterArt['pattern'], portrait?: string,
): CharacterArt {
  return { primary, secondary, accent, sigil, pattern, portrait };
}

/* ---------------- スキル ---------------- */

export const MOCK_SKILLS: Skill[] = [
  // 通常攻撃
  { id: 'sk_slash', name: '斬撃', kind: 'NORMAL', description: '敵単体に攻撃力100%の物理ダメージ。', cooldown: 0, target: { side: 'ENEMY', pattern: 'SINGLE' }, effects: [{ type: 'DAMAGE', power: 1.0 }], fx: 'slash' },
  { id: 'sk_shot', name: '狙撃', kind: 'NORMAL', description: '敵単体に攻撃力95%のダメージ。会心率+10%。', cooldown: 0, target: { side: 'ENEMY', pattern: 'SINGLE' }, effects: [{ type: 'DAMAGE', power: 0.95 }], fx: 'pierce' },
  { id: 'sk_bash', name: '打撃', kind: 'NORMAL', description: '敵単体に攻撃力105%のダメージ。', cooldown: 0, target: { side: 'ENEMY', pattern: 'SINGLE' }, effects: [{ type: 'DAMAGE', power: 1.05 }], fx: 'impact' },
  { id: 'sk_hex', name: '呪言', kind: 'NORMAL', description: '敵単体に攻撃力90%の闇ダメージ。', cooldown: 0, target: { side: 'ENEMY', pattern: 'SINGLE' }, effects: [{ type: 'DAMAGE', power: 0.9 }], fx: 'dark_bolt' },
  { id: 'sk_droplet', name: '水撃', kind: 'NORMAL', description: '敵単体に攻撃力90%の水ダメージ。', cooldown: 0, target: { side: 'ENEMY', pattern: 'SINGLE' }, effects: [{ type: 'DAMAGE', power: 0.9 }], fx: 'aqua_shot' },
  { id: 'sk_ping', name: 'PING', kind: 'NORMAL', description: '敵単体に攻撃力85%の無属性ダメージ。', cooldown: 0, target: { side: 'ENEMY', pattern: 'SINGLE' }, effects: [{ type: 'DAMAGE', power: 0.85 }], fx: 'glitch' },

  // アクティブ
  { id: 'sk_flame_edge', name: '灯火一閃', kind: 'ACTIVE', description: '敵単体に攻撃力180%の炎ダメージ。60%で火傷(3ターン)。', cooldown: 2, target: { side: 'ENEMY', pattern: 'SINGLE' }, effects: [{ type: 'DAMAGE', power: 1.8 }, { type: 'STATUS', status: 'BURN', duration: 3, chance: 60 }], fx: 'flame_burst', tags: ['fire', 'single'] },
  { id: 'sk_ember_rain', name: '緋の雨', kind: 'ACTIVE', description: '敵全体に攻撃力95%の炎ダメージ。', cooldown: 3, target: { side: 'ENEMY', pattern: 'ALL' }, effects: [{ type: 'DAMAGE', power: 0.95 }], fx: 'flame_rain', tags: ['fire', 'aoe'] },
  { id: 'sk_shadow_bind', name: '影縛り', kind: 'ACTIVE', description: '敵単体に攻撃力140%の闇ダメージ。50%で気絶(1ターン)。', cooldown: 3, target: { side: 'ENEMY', pattern: 'SINGLE' }, effects: [{ type: 'DAMAGE', power: 1.4 }, { type: 'STATUS', status: 'STUN', duration: 1, chance: 50 }], fx: 'shadow_chain', tags: ['dark', 'control'] },
  { id: 'sk_curse_mark', name: '呪印', kind: 'ACTIVE', description: '敵全体の防御を25%低下(3ターン)。', cooldown: 4, target: { side: 'ENEMY', pattern: 'ALL' }, effects: [{ type: 'STATUS', status: 'DEF_DOWN', duration: 3, potency: 25 }], fx: 'hex_ring', tags: ['debuff'] },
  { id: 'sk_tide_heal', name: '潮癒の詠唱', kind: 'ACTIVE', description: 'HP最少の味方を最大HP28%回復し、再生(2ターン)を付与。', cooldown: 2, target: { side: 'ALLY', pattern: 'LOWEST_HP' }, effects: [{ type: 'HEAL', power: 0.28, scaling: 'hp' }, { type: 'STATUS', status: 'REGEN', duration: 2, potency: 8 }], fx: 'heal_wave', tags: ['heal'] },
  { id: 'sk_purify', name: '清めの水', kind: 'ACTIVE', description: '味方全体の状態異常を1つ解除し、HPを12%回復。', cooldown: 4, target: { side: 'ALLY', pattern: 'ALL' }, effects: [{ type: 'CLEANSE' }, { type: 'HEAL', power: 0.12, scaling: 'hp' }], fx: 'cleanse_ring', tags: ['heal', 'cleanse'] },
  { id: 'sk_aria_buff', name: '戦奏アリア', kind: 'ACTIVE', description: '味方全体の攻撃力を22%上昇(3ターン)。', cooldown: 3, target: { side: 'ALLY', pattern: 'ALL' }, effects: [{ type: 'STATUS', status: 'ATK_UP', duration: 3, potency: 22 }], fx: 'buff_aria', tags: ['buff'] },
  { id: 'sk_tempo', name: '加速の律動', kind: 'ACTIVE', description: '味方全体の行動ゲージを25%進める。', cooldown: 4, target: { side: 'ALLY', pattern: 'ALL' }, effects: [{ type: 'GAUGE', amount: 25 }], fx: 'tempo_pulse', tags: ['support'] },
  { id: 'sk_iron_wall', name: '鉄壁構え', kind: 'ACTIVE', description: '自身に障壁と挑発(2ターン)を付与。', cooldown: 3, target: { side: 'SELF', pattern: 'SELF' }, effects: [{ type: 'STATUS', status: 'SHIELD', duration: 2, potency: 30 }, { type: 'STATUS', status: 'TAUNT', duration: 2 }], fx: 'guard_up', tags: ['tank'] },
  { id: 'sk_quake', name: '地割り', kind: 'ACTIVE', description: '敵全体に攻撃力110%の地ダメージ。40%で鈍足。', cooldown: 3, target: { side: 'ENEMY', pattern: 'ALL' }, effects: [{ type: 'DAMAGE', power: 1.1 }, { type: 'STATUS', status: 'SLOW', duration: 2, chance: 40 }], fx: 'earth_crack', tags: ['earth', 'aoe'] },
  { id: 'sk_gale_step', name: '疾風三段', kind: 'ACTIVE', description: '敵単体に攻撃力70%×3回の風ダメージ。', cooldown: 2, target: { side: 'ENEMY', pattern: 'SINGLE' }, effects: [{ type: 'DAMAGE', power: 0.7, hits: 3 }], fx: 'gale_slash', tags: ['wind'] },
  { id: 'sk_overclock', name: 'オーバークロック', kind: 'ACTIVE', description: '自身の速度を35%上昇(3ターン)、必殺ゲージ+30%。', cooldown: 4, target: { side: 'SELF', pattern: 'SELF' }, effects: [{ type: 'STATUS', status: 'SPD_UP', duration: 3, potency: 35 }, { type: 'ULT_GAUGE', amount: 30 }], fx: 'circuit_surge', tags: ['self'] },
  { id: 'sk_null_hack', name: 'ヌルハック', kind: 'ACTIVE', description: '敵単体に攻撃力130%の虚ダメージ。55%で沈黙(2ターン)。', cooldown: 3, target: { side: 'ENEMY', pattern: 'SINGLE' }, effects: [{ type: 'DAMAGE', power: 1.3 }, { type: 'STATUS', status: 'SILENCE', duration: 2, chance: 55 }], fx: 'glitch', tags: ['void'] },
  { id: 'sk_first_aid', name: '応急手当', kind: 'ACTIVE', description: '味方単体のHPを18%回復。', cooldown: 2, target: { side: 'ALLY', pattern: 'LOWEST_HP' }, effects: [{ type: 'HEAL', power: 0.18, scaling: 'hp' }], fx: 'heal_wave', tags: ['heal'] },
  { id: 'sk_kc_normal', name: '刻の乱撃', kind: 'NORMAL', description: '敵単体に攻撃力60%の虚ダメージを3回。', cooldown: 0, target: { side: 'ENEMY', pattern: 'SINGLE' }, effects: [{ type: 'DAMAGE', power: 0.6, hits: 3 }], fx: 'void_bolt', tags: ['void'] },
  { id: 'sk_kc_fold', name: '時飛ばし', kind: 'ACTIVE', description: '敵単体に攻撃力78%の虚ダメージ。相手の行動ゲージを50%削り、35%で気絶(1ターン)を付与して手番そのものを奪う。', cooldown: 4, target: { side: 'ENEMY', pattern: 'SINGLE' }, effects: [{ type: 'DAMAGE', power: 0.78 }, { type: 'GAUGE', amount: -50 }, { type: 'STATUS', status: 'STUN', duration: 1, chance: 35 }], fx: 'void_fold', tags: ['void', 'control'] },
  { id: 'sk_kc_paradox', name: 'エピタフ', kind: 'ACTIVE', description: '数秒先を視て、自身に障壁(最大HP34%, 3ターン)を張る。', cooldown: 4, target: { side: 'SELF', pattern: 'SELF' }, effects: [{ type: 'STATUS', status: 'SHIELD', duration: 3, potency: 34 }], fx: 'void_bolt', tags: ['void', 'shield'] },

  // 必殺技
  { id: 'ult_hinomoto', name: '炎天焦土・緋ノ大灯', kind: 'ULTIMATE', description: '敵全体に攻撃力260%の炎ダメージ。火傷(3ターン)を必ず付与。', cooldown: 0, ultCost: 100, target: { side: 'ENEMY', pattern: 'ALL' }, effects: [{ type: 'DAMAGE', power: 2.6 }, { type: 'STATUS', status: 'BURN', duration: 3 }], fx: 'ult_flame', tags: ['ult'] },
  { id: 'ult_kurohane', name: '黒羽演舞・終焉ノ帳', kind: 'ULTIMATE', description: '敵単体に攻撃力420%の闇ダメージ。対象が瀕死なら威力+50%。', cooldown: 0, ultCost: 100, target: { side: 'ENEMY', pattern: 'SINGLE' }, effects: [{ type: 'DAMAGE', power: 4.2 }], fx: 'ult_void', tags: ['ult'] },
  { id: 'ult_mizuse', name: '深淵の慈雨', kind: 'ULTIMATE', description: '味方全体を最大HP45%回復し、状態異常を全解除。', cooldown: 0, ultCost: 100, target: { side: 'ALLY', pattern: 'ALL' }, effects: [{ type: 'HEAL', power: 0.45, scaling: 'hp' }, { type: 'CLEANSE' }], fx: 'ult_heal', tags: ['ult', 'heal'] },
  { id: 'ult_kanade', name: '終楽章・祝祭のファンファーレ', kind: 'ULTIMATE', description: '味方全体に攻撃UP/防御UP(3ターン)と行動ゲージ50%を付与。', cooldown: 0, ultCost: 100, target: { side: 'ALLY', pattern: 'ALL' }, effects: [{ type: 'STATUS', status: 'ATK_UP', duration: 3, potency: 30 }, { type: 'STATUS', status: 'DEF_UP', duration: 3, potency: 30 }, { type: 'GAUGE', amount: 50 }], fx: 'ult_fanfare', tags: ['ult', 'buff'] },
  { id: 'ult_gouki', name: '不動明王・岩穿ち', kind: 'ULTIMATE', description: '敵全体に防御力380%の地ダメージ。自身に障壁。', cooldown: 0, ultCost: 100, target: { side: 'ENEMY', pattern: 'ALL' }, effects: [{ type: 'DAMAGE', power: 3.8, scaling: 'defense' }, { type: 'STATUS', status: 'SHIELD', duration: 2, potency: 40, target: { side: 'SELF', pattern: 'SELF' } }], fx: 'ult_quake', tags: ['ult'] },
  { id: 'ult_hazuki', name: '葉隠・千裂颶風', kind: 'ULTIMATE', description: 'ランダムな敵に攻撃力110%×5回の風ダメージ。', cooldown: 0, ultCost: 100, target: { side: 'ENEMY', pattern: 'RANDOM', count: 5 }, effects: [{ type: 'DAMAGE', power: 1.1, hits: 5 }], fx: 'ult_gale', tags: ['ult'] },
  { id: 'ult_zero', name: 'SYSTEM::PURGE', kind: 'ULTIMATE', description: '敵全体に攻撃力230%の虚ダメージ。バフを全て剥がす。', cooldown: 0, ultCost: 100, target: { side: 'ENEMY', pattern: 'ALL' }, effects: [{ type: 'DAMAGE', power: 2.3 }], fx: 'ult_glitch', tags: ['ult'] },
  { id: 'ult_nanase', name: '灯し火の祈り', kind: 'ULTIMATE', description: '味方全体を最大HP25%回復し、攻撃UP(2ターン)。', cooldown: 0, ultCost: 100, target: { side: 'ALLY', pattern: 'ALL' }, effects: [{ type: 'HEAL', power: 0.25, scaling: 'hp' }, { type: 'STATUS', status: 'ATK_UP', duration: 2, potency: 15 }], fx: 'ult_heal', tags: ['ult'] },
  { id: 'ult_kc_collapse', name: '幽波紋・世界収束', kind: 'ULTIMATE', description: '敵全体に攻撃力310%の虚ダメージ。必ず沈黙(2ターン)を付与し、自身のクリティカル率+25%(3ターン)。', cooldown: 0, ultCost: 100, target: { side: 'ENEMY', pattern: 'ALL' }, effects: [{ type: 'DAMAGE', power: 3.1 }, { type: 'STATUS', status: 'SILENCE', duration: 2 }, { type: 'STATUS', status: 'ATK_UP', duration: 3, potency: 25, target: { side: 'SELF', pattern: 'SELF' } }], fx: 'ult_void', tags: ['ult', 'void'] },

  // 敵スキル
  { id: 'sk_enemy_claw', name: '爪撃', kind: 'NORMAL', description: '敵単体に攻撃力100%のダメージ。', cooldown: 0, target: { side: 'ENEMY', pattern: 'SINGLE' }, effects: [{ type: 'DAMAGE', power: 1.0 }], fx: 'slash' },
  { id: 'sk_enemy_spit', name: '腐食液', kind: 'ACTIVE', description: '敵単体に攻撃力120%のダメージ。毒を付与。', cooldown: 2, target: { side: 'ENEMY', pattern: 'SINGLE' }, effects: [{ type: 'DAMAGE', power: 1.2 }, { type: 'STATUS', status: 'POISON', duration: 3, potency: 6 }], fx: 'acid_spray' },
  { id: 'sk_enemy_beam', name: '制圧レーザー', kind: 'ACTIVE', description: '敵全体に攻撃力85%の光ダメージ。', cooldown: 3, target: { side: 'ENEMY', pattern: 'ALL' }, effects: [{ type: 'DAMAGE', power: 0.85 }], fx: 'laser_sweep' },
  { id: 'sk_enemy_howl', name: '威嚇咆哮', kind: 'ACTIVE', description: '敵全体の攻撃力を20%低下(2ターン)。', cooldown: 3, target: { side: 'ENEMY', pattern: 'ALL' }, effects: [{ type: 'STATUS', status: 'ATK_DOWN', duration: 2, potency: 20 }], fx: 'roar' },
  { id: 'ult_enemy_kirin', name: '雷帝顕現', kind: 'ULTIMATE', description: '敵全体に攻撃力300%の風ダメージ。気絶を付与。', cooldown: 0, ultCost: 100, target: { side: 'ENEMY', pattern: 'ALL' }, effects: [{ type: 'DAMAGE', power: 3.0 }, { type: 'STATUS', status: 'STUN', duration: 1, chance: 40 }], fx: 'ult_thunder' },
  { id: 'ult_enemy_void', name: '虚無回帰', kind: 'ULTIMATE', description: '敵全体に攻撃力280%の虚ダメージ。', cooldown: 0, ultCost: 100, target: { side: 'ENEMY', pattern: 'ALL' }, effects: [{ type: 'DAMAGE', power: 2.8 }], fx: 'ult_void' },

  // レイドボス専用スキル (P5)
  { id: 'sk_raid_hollow_slash', name: '虚断ち', kind: 'ACTIVE', description: '敵単体に攻撃力150%の闇ダメージ。防御力を20%低下(2ターン)。', cooldown: 2, target: { side: 'ENEMY', pattern: 'HIGHEST_ATK' }, effects: [{ type: 'DAMAGE', power: 1.5 }, { type: 'STATUS', status: 'DEF_DOWN', duration: 2, potency: 20 }], fx: 'dark_bolt' },
  { id: 'ult_raid_hollow', name: '虚王降臨', kind: 'ULTIMATE', description: '敵全体に攻撃力260%の闇ダメージ。', cooldown: 0, ultCost: 100, target: { side: 'ENEMY', pattern: 'ALL' }, effects: [{ type: 'DAMAGE', power: 2.6 }], fx: 'ult_void' },
  { id: 'sk_raid_null_firewall', name: 'ファイアウォール展開', kind: 'ACTIVE', description: '自身の防御力を30%上昇(3ターン)。', cooldown: 3, target: { side: 'SELF', pattern: 'SELF' }, effects: [{ type: 'STATUS', status: 'DEF_UP', duration: 3, potency: 30 }], fx: 'guard_up' },
  { id: 'ult_raid_null', name: 'SYSTEM::ZERO', kind: 'ULTIMATE', description: '敵全体に攻撃力300%の虚ダメージ。沈黙を付与。', cooldown: 0, ultCost: 100, target: { side: 'ENEMY', pattern: 'ALL' }, effects: [{ type: 'DAMAGE', power: 3.0 }, { type: 'STATUS', status: 'SILENCE', duration: 2, chance: 50 }], fx: 'ult_glitch' },
];

/* ---------------- AIプロファイル ---------------- */

export const MOCK_AI_PROFILES: AiProfile[] = [
  {
    id: 'ai_balanced', name: 'バランス',
    description: 'スキルが使えるなら使い、それ以外は通常攻撃。堅実な立ち回り。',
    rules: [
      { priority: 1, condition: { type: 'ULT_READY' }, skill: 'ULTIMATE' },
      { priority: 2, condition: { type: 'ALWAYS' }, skill: 'SKILL' },
      { priority: 3, condition: { type: 'ALWAYS' }, skill: 'NORMAL' },
    ],
  },
  {
    id: 'ai_aggressive', name: '猛攻',
    description: '常に最大火力。HP管理は度外視で敵を削り切る。',
    rules: [
      { priority: 1, condition: { type: 'ENEMY_HP_BELOW', value: 40 }, skill: 'ULTIMATE' },
      { priority: 2, condition: { type: 'ALWAYS' }, skill: 'SKILL' },
    ],
  },
  {
    id: 'ai_defensive', name: '防衛',
    description: '味方のHPが減ったら守りを優先。長期戦向け。',
    rules: [
      { priority: 1, condition: { type: 'SELF_HP_BELOW', value: 55 }, skill: 'SKILL' },
      { priority: 2, condition: { type: 'ALWAYS' }, skill: 'NORMAL' },
    ],
  },
  {
    id: 'ai_support', name: '支援優先',
    description: '回復・バフを最優先。味方が健在なら攻撃に回る。',
    rules: [
      { priority: 1, condition: { type: 'ALLY_HP_BELOW', value: 70 }, skill: 'SKILL' },
      { priority: 2, condition: { type: 'ULT_READY' }, skill: 'ULTIMATE' },
      { priority: 3, condition: { type: 'ALWAYS' }, skill: 'NORMAL' },
    ],
  },
  {
    id: 'ai_ult_first', name: '必殺優先',
    description: '必殺ゲージが溜まり次第即座に撃つ。爆発力重視。',
    rules: [
      { priority: 1, condition: { type: 'ULT_READY' }, skill: 'ULTIMATE' },
      { priority: 2, condition: { type: 'ALWAYS' }, skill: 'NORMAL' },
    ],
  },
];

/* ---------------- キャラクター ---------------- */

export const MOCK_CHARACTERS: CharacterDef[] = [
  {
    id: 'ch_akane', name: '灯守 あかね', title: 'Akane / 緋灯の探索者', rarity: 'UR',
    element: 'FIRE', roles: ['ATTACKER'],
    baseStats: st(1180, 168, 76, 108, 16, 175, 12, 100),
    growth: { hp: 62, attack: 12.5, defense: 4.2, speed: 1.1, critical: 0.18 },
    normalAttack: 'sk_slash', skills: ['sk_flame_edge', 'sk_ember_rain'], ultimate: 'ult_hinomoto',
    awakening: {
      id: 'aw_akane', name: '緋天覚醒',
      condition: { hpBelow: 45 },
      statBonus: { attack: 35, speed: 15, critical: 12 },
      grant: [{ status: 'ATK_UP', duration: 99, potency: 30 }],
      description: 'HPが45%以下になると緋い炎を纏い、攻撃力+35% / 速度+15% / 会心+12%。',
      fx: 'awaken_flame',
    },
    combos: ['cb_akane_shiki', 'cb_akane_noa'],
    defaultAi: 'ai_aggressive',
    description: '燃える街を駆け抜けた探索者。刀身に宿る灯が消えるまで、彼女は止まらない。',
    tags: ['刀', '前衛', '灯'],
    trpg: { source: '卓「ネオン東京奇譚」', player: 'あかたん', investigator: '灯守あかね', affiliation: '灯火商会', visibility: 'PUBLIC', note: 'SAN値直葬から生還した唯一の探索者。愛刀の名は「緋灯」。' },
    art: art('#ff4d2e', '#3a0d18', '#ffd76a', '灯', 'burst'),
  },
  {
    id: 'ch_shiki', name: '黒羽 シキ', title: 'Shiki / 黒羽の暗殺者', rarity: 'SSR',
    element: 'DARK', roles: ['ATTACKER', 'CONTROL'],
    baseStats: st(960, 154, 64, 124, 22, 190, 8, 100),
    growth: { hp: 48, attack: 11.4, defense: 3.4, speed: 1.4, critical: 0.24 },
    normalAttack: 'sk_hex', skills: ['sk_shadow_bind', 'sk_curse_mark'], ultimate: 'ult_kurohane',
    awakening: {
      id: 'aw_shiki', name: '終焉の羽衣',
      condition: { enemyDefeated: 2 },
      statBonus: { critical: 20, criticalDamage: 40 },
      description: '敵を2体撃破すると羽衣が展開し、会心率+20% / 会心倍率+40%。',
      fx: 'awaken_void',
    },
    combos: ['cb_akane_shiki'],
    defaultAi: 'ai_ult_first',
    description: '影から影へ。名を捨てた元神官は、依頼のためだけに刃を振るう。',
    tags: ['暗殺', '闇', '高速'],
    trpg: { source: '卓「ネオン東京奇譚」', player: 'クロ', investigator: '黒羽シキ', affiliation: '無所属', visibility: 'FRIENDS', note: '正体は封印儀式の失敗作。背中の刺青が疼くと本人は嫌がる。' },
    art: art('#7a3cff', '#0a0714', '#ff5ad4', '羽', 'void'),
  },
  {
    id: 'ch_inori', name: '水瀬 いのり', title: 'Inori / 祈祷の水巫女', rarity: 'SSR',
    element: 'WATER', roles: ['HEALER', 'SUPPORT'],
    baseStats: st(1090, 96, 88, 96, 6, 150, 22, 135),
    growth: { hp: 58, attack: 6.2, defense: 5.0, speed: 0.9, healing: 1.2 },
    normalAttack: 'sk_droplet', skills: ['sk_tide_heal', 'sk_purify'], ultimate: 'ult_mizuse',
    awakening: {
      id: 'aw_inori', name: '深淵詠唱',
      condition: { allyDefeated: 1 },
      statBonus: { healing: 40, speed: 12 },
      description: '味方が1体倒れると詠唱が加速し、回復力+40% / 速度+12%。',
      fx: 'awaken_heal',
    },
    defaultAi: 'ai_support',
    description: '沈んだ神社の最後の巫女。祈りは水となり、傷を洗い流す。',
    tags: ['回復', '浄化'],
    trpg: { source: '卓「水底の社」', player: 'いの', investigator: '水瀬いのり', affiliation: '沈守神社', visibility: 'PUBLIC', note: '毎セッション必ず1回は溺れる。' },
    art: art('#2f9bff', '#07203a', '#9ef4ff', '祈', 'wave'),
  },
  {
    id: 'ch_noa', name: '奏 ノア', title: 'Noa / 電子聖歌隊', rarity: 'SR',
    element: 'LIGHT', roles: ['SUPPORT'],
    baseStats: st(980, 108, 78, 104, 9, 155, 15, 115),
    growth: { hp: 50, attack: 7.4, defense: 4.4, speed: 1.05 },
    normalAttack: 'sk_shot', skills: ['sk_aria_buff', 'sk_tempo'], ultimate: 'ult_kanade',
    awakening: {
      id: 'aw_noa', name: '祝祭の指揮',
      condition: { turnAtLeast: 6 },
      statBonus: { attack: 20, speed: 20 },
      description: '6ターン経過で指揮が最高潮に。攻撃力+20% / 速度+20%。',
      fx: 'awaken_light',
    },
    combos: ['cb_akane_noa'],
    defaultAi: 'ai_support',
    description: '電脳聖堂で歌い続けるAI聖歌隊の一体。音は加速であり、祝福である。',
    tags: ['バフ', '加速'],
    trpg: { source: '卓「電子聖堂」', player: 'なな', investigator: 'NOA-07', affiliation: '第七聖歌隊', visibility: 'PUBLIC' },
    art: art('#ffd86b', '#2a2109', '#fff6c9', '奏', 'petal'),
  },
  {
    id: 'ch_tetsu', name: '剛毅 テツ', title: 'Tetsu / 不動の壁', rarity: 'SR',
    element: 'EARTH', roles: ['TANK'],
    baseStats: st(1720, 96, 148, 74, 4, 145, 28, 100),
    growth: { hp: 96, attack: 5.8, defense: 8.4, speed: 0.6 },
    normalAttack: 'sk_bash', skills: ['sk_iron_wall', 'sk_quake'], ultimate: 'ult_gouki',
    awakening: {
      id: 'aw_tetsu', name: '不動明王',
      condition: { hpBelow: 35 },
      statBonus: { defense: 45, hp: 10 },
      description: 'HP35%以下で構えを固め、防御力+45%。',
      fx: 'awaken_earth',
    },
    defaultAi: 'ai_defensive',
    description: '瓦礫の街で仲間を守り続けた元レスキュー隊員。盾は拾い物の道路標識。',
    tags: ['壁', '挑発'],
    trpg: { source: '卓「瓦礫の街」', player: 'てつ', investigator: '剛毅テツ', affiliation: '第3救助班', visibility: 'PUBLIC', note: '筋力18。ダイスは振らずに壁を殴る。' },
    art: art('#c98b3f', '#241606', '#ffd9a0', '壁', 'grid'),
  },
  {
    id: 'ch_rin', name: '葉月 リン', title: 'Rin / 疾風の走り屋', rarity: 'R',
    element: 'WIND', roles: ['ATTACKER'],
    baseStats: st(840, 132, 58, 136, 14, 165, 10, 100),
    growth: { hp: 42, attack: 9.6, defense: 3.0, speed: 1.6, critical: 0.16 },
    normalAttack: 'sk_slash', skills: ['sk_gale_step'], ultimate: 'ult_hazuki',
    awakening: {
      id: 'aw_rin', name: '風纏い',
      condition: { skillUsed: { skill: 'sk_gale_step', count: 3 } },
      statBonus: { speed: 30, critical: 10 },
      description: '疾風三段を3回使うと風を纏い、速度+30% / 会心+10%。',
      fx: 'awaken_wind',
    },
    defaultAi: 'ai_aggressive',
    description: '首都高を駆けるバイク乗り。刃より速度が武器だと信じている。',
    tags: ['多段', '高速'],
    trpg: { source: '卓「ネオン東京奇譚」', player: 'りん', investigator: '葉月リン', affiliation: 'チーム暁', visibility: 'PUBLIC' },
    art: art('#4ef0b2', '#062a20', '#c8fff0', '疾', 'wave'),
  },
  {
    id: 'ch_zero', name: 'ZER0', title: 'ZER0 / 存在しない探索者', rarity: 'R',
    element: 'VOID', roles: ['SPECIALIST', 'CONTROL'],
    baseStats: st(880, 124, 66, 112, 12, 160, 18, 100),
    growth: { hp: 44, attack: 9.0, defense: 3.6, speed: 1.2 },
    normalAttack: 'sk_ping', skills: ['sk_null_hack', 'sk_overclock'], ultimate: 'ult_zero',
    awakening: {
      id: 'aw_zero', name: 'NULL_OVERRIDE',
      condition: { turnAtLeast: 4 },
      statBonus: { attack: 25, resistance: 30 },
      description: '4ターン経過で自己書き換えを実行、攻撃力+25% / 耐性+30%。',
      fx: 'awaken_glitch',
    },
    defaultAi: 'ai_balanced',
    description: '記録上は死亡している探索者。だが毎回セッションに現れる。',
    tags: ['沈黙', '電脳'],
    trpg: { source: '卓「電子聖堂」', player: '???', investigator: '(記録抹消)', affiliation: '不明', visibility: 'PRIVATE', note: 'キャラシートが毎回文字化けする。' },
    art: art('#ff4fd8', '#120620', '#66fff0', '0', 'circuit'),
  },
  {
    id: 'ch_yuu', name: '七瀬 ユウ', title: 'Yuu / 新米調査員', rarity: 'N',
    element: 'WATER', roles: ['SUPPORT'],
    baseStats: st(900, 88, 72, 92, 5, 145, 12, 110),
    growth: { hp: 44, attack: 5.4, defense: 3.8, speed: 0.8 },
    normalAttack: 'sk_droplet', skills: ['sk_first_aid'], ultimate: 'ult_nanase',
    awakening: {
      id: 'aw_yuu', name: '覚悟の一歩',
      condition: { allyDefeated: 2 },
      statBonus: { attack: 20, defense: 20 },
      description: '味方が2体倒れると腹を括る。攻撃/防御+20%。',
      fx: 'awaken_light',
    },
    defaultAi: 'ai_support',
    description: '配属3日目の新人。マニュアル片手に今日も現場へ。',
    tags: ['新人'],
    trpg: { source: '卓「新人研修」', player: 'ゆう', investigator: '七瀬ユウ', affiliation: '調査局 研修課', visibility: 'PUBLIC' },
    art: art('#66c9ff', '#0b1f33', '#d8f4ff', '七', 'grid'),
  },
  {
    id: 'ch_mikoto', name: '森羅 ミコト', title: 'Mikoto / 未実装', rarity: 'SSR',
    element: 'EARTH', roles: ['SPECIALIST'],
    baseStats: st(1150, 140, 110, 98, 10, 160, 20, 100),
    growth: { hp: 60, attack: 9.8, defense: 6.0, speed: 0.9 },
    normalAttack: 'sk_bash', skills: ['sk_quake'], ultimate: 'ult_gouki',
    awakening: {
      id: 'aw_mikoto', name: '森羅万象',
      condition: { turnAtLeast: 8 },
      description: '8ターン経過で森羅万象を掌握する。',
      fx: 'awaken_earth',
    },
    defaultAi: 'ai_balanced',
    description: '(図鑑用: 未入手キャラのシルエット表示確認サンプル)',
    trpg: { source: '卓「森羅」', player: 'みこと', visibility: 'PUBLIC' },
    art: art('#7bd67a', '#10240f', '#d6ffcf', '森', 'petal'),
  },
  {
    id: 'ch_momiji_kc', name: '孤月 紅葉', title: 'Momiji / 幽波紋の探索者', rarity: 'UR',
    element: 'VOID', roles: ['CONTROL', 'SPECIALIST'],
    baseStats: st(1080, 150, 82, 116, 14, 178, 22, 100),
    growth: { hp: 56, attack: 11.8, defense: 4.6, speed: 1.3, critical: 0.16 },
    normalAttack: 'sk_kc_normal', skills: ['sk_kc_fold', 'sk_kc_paradox'], ultimate: 'ult_kc_collapse',
    awakening: {
      id: 'aw_momiji_kc', name: '幽波紋・臨界',
      condition: { turnAtLeast: 5 },
      statBonus: { attack: 22, resistance: 25, critical: 10 },
      description: '5ターン経過で図形が臨界に達し、攻撃力+22% / 耐性+25% / 会心+10%。',
      fx: 'awaken_glitch',
    },
    combos: ['cb_momiji_kc_hitori'],
    defaultAi: 'ai_balanced',
    description: 'ありえない幾何を視た探索者。世界の折り目を数える癖が抜けない。「幽波紋」は彼女自身が名付けた、その視えるものの呼び名。',
    tags: ['幽波紋', '虚', '沈黙'],
    trpg: {
      source: '卓「幽波紋」', player: 'あかたん', investigator: '孤月紅葉',
      affiliation: '無所属', visibility: 'PUBLIC',
      note: 'もう一人の「紅葉」とは無関係。同名の別探索者(SR/炎)が別に実在する。',
    },
    art: art('#c94fff', '#120a20', '#7dffe6', '紋', 'void', 'momiji_kc'),
  },
  {
    // P5-3: レイド限定ドロップキャラ。既存の SSR/VOID「電子 独」(id: hitori, 別キャラ) とは
    // 別物であることを id/名前/属性/レアリティすべてで明確に区別する。
    id: 'ch_hitori_stand', name: '電子 独(幽波紋)', title: 'Hitori Stand / もう一人の観測者', rarity: 'UR',
    element: 'DARK', roles: ['CONTROL', 'SPECIALIST'],
    baseStats: st(1020, 158, 90, 120, 18, 182, 26, 100),
    growth: { hp: 54, attack: 12.0, defense: 5.0, speed: 1.4, critical: 0.2 },
    normalAttack: 'sk_ping', skills: ['sk_null_hack', 'sk_shadow_bind'], ultimate: 'ult_zero',
    awakening: {
      id: 'aw_hitori_stand', name: '【天国】接続',
      condition: { turnAtLeast: 5 },
      statBonus: { attack: 24, critical: 14, resistance: 20 },
      description: '5ターン経過で電子の世界の向こう側と繋がり、攻撃力+24% / 会心+14% / 耐性+20%。',
      fx: 'awaken_glitch',
    },
    combos: ['cb_momiji_kc_hitori'],
    defaultAi: 'ai_balanced',
    description: 'もう一人の「独」。孤月紅葉(幽波紋)が視る図形の、向こう側の観測者。電子の世界の裏側から現れ、紅葉が時を刈り取った刹那にだけ呼応する。データ担当により実装中の探索者。',
    tags: ['幽波紋', 'Network', 'レイド限定'],
    trpg: {
      source: '卓「幽波紋」', player: 'あかたん', investigator: '独(幽波紋)',
      affiliation: '無所属', visibility: 'PUBLIC',
      note: '身内CoCの「電子 独」(SSR/VOID)とは同名の別探索者。混同注意。',
    },
    art: art('#7a3cff', '#0c0818', '#4df0ff', '独', 'circuit', 'hitori_stand'),
  },
  {
    id: 'ch_sora', name: '天沢 ソラ', title: 'Sora / 未実装', rarity: 'SR',
    element: 'WIND', roles: ['HEALER'],
    baseStats: st(1000, 92, 80, 110, 6, 150, 18, 128),
    growth: { hp: 52, attack: 6.0, defense: 4.2, speed: 1.1 },
    normalAttack: 'sk_shot', skills: ['sk_first_aid'], ultimate: 'ult_nanase',
    awakening: {
      id: 'aw_sora', name: '蒼穹の風',
      condition: { hpBelow: 50 },
      description: 'HP50%以下で蒼穹の風を呼ぶ。',
      fx: 'awaken_wind',
    },
    defaultAi: 'ai_support',
    description: '(図鑑用: 未入手キャラのシルエット表示確認サンプル)',
    trpg: { source: '卓「蒼穹」', player: 'そら', visibility: 'PUBLIC' },
    art: art('#8fd8ff', '#0d2030', '#eaffff', '天', 'wave'),
  },
];

/*
 * 第6ラウンド補足: 新キャラ「加那星蒼太」「月島風花」の確認は、データ担当の実データ
 * (data/characters/{sota,fuuka}.json, data/gacha/banners.json の
 * `banner_pickup_sota_fuuka`, data/combos/combos.json の `kachou_fuugetsu_bond`)が
 * 投入され次第、そちらを実サーバ経由で直接確認する方針に切り替えた
 * (モックに別IDの仮キャラを重複投入すると名前が競合して紛らわしいため)。
 */

/* ---------------- 敵 ---------------- */

export const MOCK_ENEMIES: EnemyDef[] = [
  {
    id: 'en_noise', name: 'ノイズスライム', element: 'VOID', roles: ['SPECIALIST'],
    baseStats: st(620, 78, 44, 72, 4, 140, 6, 100),
    growth: { hp: 36, attack: 5.2, defense: 2.6, speed: 0.5 },
    normalAttack: 'sk_enemy_claw', skills: ['sk_enemy_spit'], defaultAi: 'ai_balanced',
    description: '電子の澱が形を持ったもの。触れると記録が壊れる。',
    art: art('#c94fff', '#180a24', '#7dffe6', '噪', 'void'),
  },
  {
    id: 'en_oni', name: '火喰い鬼', element: 'FIRE', roles: ['ATTACKER'],
    baseStats: st(880, 104, 58, 88, 10, 160, 8, 100),
    growth: { hp: 44, attack: 7.0, defense: 3.2, speed: 0.7 },
    normalAttack: 'sk_enemy_claw', skills: ['sk_enemy_howl'], defaultAi: 'ai_aggressive',
    description: '炎を喰らって育つ鬼。路地裏の火事はだいたいコイツのせい。',
    art: art('#ff6a2e', '#2a0c06', '#ffca6a', '鬼', 'burst'),
  },
  {
    id: 'en_drone', name: '警邏ドローン', element: 'LIGHT', roles: ['CONTROL'],
    baseStats: st(700, 88, 70, 106, 6, 150, 14, 100),
    growth: { hp: 38, attack: 6.0, defense: 4.0, speed: 1.0 },
    normalAttack: 'sk_ping', skills: ['sk_enemy_beam'], defaultAi: 'ai_balanced',
    description: '旧治安維持システムの残骸。今も止まらず巡回している。',
    art: art('#ffe98a', '#2b2508', '#ffffff', '巡', 'circuit'),
  },
  {
    id: 'en_ghost', name: '路地裏の亡霊', element: 'DARK', roles: ['CONTROL'],
    baseStats: st(760, 96, 50, 94, 8, 155, 20, 100),
    growth: { hp: 40, attack: 6.6, defense: 2.8, speed: 0.8 },
    normalAttack: 'sk_hex', skills: ['sk_enemy_howl'], defaultAi: 'ai_balanced',
    description: '帰る場所を忘れた誰か。名前を呼ぶと着いてくる。',
    art: art('#8f6bff', '#0c0818', '#c9b6ff', '霊', 'void'),
  },
  {
    id: 'en_golem', name: '瓦礫ゴーレム', element: 'EARTH', roles: ['TANK'],
    baseStats: st(1480, 92, 130, 58, 2, 140, 26, 100),
    growth: { hp: 82, attack: 5.6, defense: 7.2, speed: 0.4 },
    normalAttack: 'sk_bash', skills: ['sk_quake'], defaultAi: 'ai_defensive',
    description: '崩れたビルが自ら立ち上がったもの。重い。',
    art: art('#9a8266', '#1b150e', '#e0d2b8', '礫', 'grid'),
  },
  {
    id: 'en_kirin', name: '電子麒麟・雷伯', element: 'WIND', roles: ['ATTACKER', 'SPECIALIST'],
    baseStats: st(3200, 158, 118, 126, 14, 180, 24, 100),
    growth: { hp: 150, attack: 11.0, defense: 6.4, speed: 1.2 },
    normalAttack: 'sk_slash', skills: ['sk_enemy_beam', 'sk_enemy_howl'], ultimate: 'ult_enemy_kirin',
    defaultAi: 'ai_ult_first', boss: true,
    description: '首都高の電磁嵐に棲むもの。角から雷を落とす。',
    art: art('#5ef0ff', '#07202a', '#eaffff', '麒', 'circuit'),
  },
  {
    id: 'en_void_priestess', name: '虚無の巫女', element: 'VOID', roles: ['CONTROL', 'SPECIALIST'],
    baseStats: st(3800, 172, 122, 118, 12, 185, 30, 100),
    growth: { hp: 168, attack: 12.2, defense: 6.8, speed: 1.1 },
    normalAttack: 'sk_hex', skills: ['sk_curse_mark', 'sk_enemy_spit'], ultimate: 'ult_enemy_void',
    defaultAi: 'ai_ult_first', boss: true,
    description: '世界の穴を開け続ける者。顔は誰にも思い出せない。',
    art: art('#ff4fd8', '#100420', '#78fff2', '虚', 'void'),
  },

  // ---- レイドボス (P5): 設計書§28〜§29。RaidBossDef.enemyId から参照される ----
  {
    id: 'en_raid_hollow', name: '虚王ヴァルド(再構成)', element: 'DARK', roles: ['ATTACKER'],
    baseStats: st(2600, 150, 90, 118, 15, 168, 40, 100),
    growth: { hp: 130, attack: 9.0, defense: 5.5, speed: 1.0 },
    normalAttack: 'sk_hex', skills: ['sk_raid_hollow_slash', 'sk_curse_mark'], ultimate: 'ult_raid_hollow',
    defaultAi: 'ai_ult_first', boss: true,
    description: '第2章ボス・虚王ヴァルドが廃サーバの奥で再構成された姿。共有HPを持ち、何度も挑んで少しずつ削るレイド入門級。',
    tags: ['Boss', 'Raid'],
    art: art('#2a1b33', '#0c0710', '#e85dff', '深', 'void'),
  },
  {
    id: 'en_raid_null', name: 'ヌル・デーモン(肥大化)', element: 'VOID', roles: ['SPECIALIST'],
    baseStats: st(3600, 180, 130, 128, 18, 175, 50, 100),
    growth: { hp: 160, attack: 11.0, defense: 6.8, speed: 1.2 },
    normalAttack: 'sk_ping', skills: ['sk_raid_null_firewall', 'sk_null_hack'], ultimate: 'ult_raid_null',
    defaultAi: 'ai_ult_first', boss: true,
    description: '第2章最終ボス・ヌル・デーモンが自己修復の限界を超えて肥大化した姿。段階的に硬くなるレイド上級。',
    tags: ['Boss', 'Raid', 'Final'],
    art: art('#1a1730', '#070610', '#00e5ff', '終', 'circuit'),
  },
];

/* ---------------- ダンジョン ---------------- */

export const MOCK_CHAPTERS: ChapterDef[] = [
  {
    id: 'ch1', name: '第一章 ネオン東京・序章',
    description: '雨の降る歓楽街。異常の発生源を辿る。',
    stages: [
      { id: 'ch1-1', name: '1-1 濡れた路地', recommendedLevel: 900, enemies: [{ enemyId: 'en_noise', level: 3 }, { enemyId: 'en_noise', level: 3 }], rewards: { exp: 120, gold: 300 }, description: 'ノイズが湧いている。掃除から始めよう。' },
      { id: 'ch1-2', name: '1-2 赤提灯の通り', recommendedLevel: 1200, enemies: [{ enemyId: 'en_noise', level: 4 }, { enemyId: 'en_oni', level: 5 }], rewards: { exp: 180, gold: 420 }, description: '火の匂いがする。' },
      { id: 'ch1-3', name: '1-3 高架下', recommendedLevel: 1600, enemies: [{ enemyId: 'en_ghost', level: 6 }, { enemyId: 'en_drone', level: 6 }, { enemyId: 'en_noise', level: 5 }], rewards: { exp: 240, gold: 560 }, description: '誰かが呼んでいる。' },
      { id: 'ch1-4', name: '1-4 首都高・電磁嵐', recommendedLevel: 2400, boss: true, enemies: [{ enemyId: 'en_kirin', level: 10 }, { enemyId: 'en_drone', level: 8 }], rewards: { exp: 520, gold: 1400 }, description: 'BOSS: 電子麒麟・雷伯' },
    ],
  },
  {
    id: 'ch2', name: '第二章 電脳霊域',
    description: '崩れた神社のサーバルームへ。虚無が漏れている。',
    stages: [
      { id: 'ch2-1', name: '2-1 沈んだ参道', recommendedLevel: 2800, enemies: [{ enemyId: 'en_ghost', level: 11 }, { enemyId: 'en_ghost', level: 11 }, { enemyId: 'en_golem', level: 12 }], rewards: { exp: 600, gold: 1600 } },
      { id: 'ch2-2', name: '2-2 瓦礫の社', recommendedLevel: 3200, enemies: [{ enemyId: 'en_golem', level: 13 }, { enemyId: 'en_oni', level: 13 }, { enemyId: 'en_drone', level: 12 }], rewards: { exp: 720, gold: 1900 } },
      { id: 'ch2-3', name: '2-3 断絶回廊', recommendedLevel: 3800, enemies: [{ enemyId: 'en_drone', level: 15 }, { enemyId: 'en_noise', level: 15 }, { enemyId: 'en_ghost', level: 15 }, { enemyId: 'en_oni', level: 14 }], rewards: { exp: 880, gold: 2300 } },
      { id: 'ch2-4', name: '2-4 虚無の祭壇', recommendedLevel: 5000, boss: true, enemies: [{ enemyId: 'en_void_priestess', level: 20 }, { enemyId: 'en_ghost', level: 17 }, { enemyId: 'en_ghost', level: 17 }], rewards: { exp: 1600, gold: 5200 }, description: 'BOSS: 虚無の巫女' },
    ],
  },
];

export const MOCK_SKILL_MAP = new Map(MOCK_SKILLS.map((s) => [s.id, s]));
export const MOCK_CHARACTER_MAP = new Map(MOCK_CHARACTERS.map((c) => [c.id, c]));

/* ---------------- コンボ (P0-4) ----------------
 * `?mock=1` デモモード専用。サーバ無しで PARTY 画面の発動コンボ表示と
 * BATTLE 画面の COMBO カットインを一通り確認できるようにするためのダミー定義。
 * デフォルト編成(あかね/シキ/いのり/テツ/ノア)で PAIR が2件 ACTIVE、
 * PAIR/TRIO/TAG がそれぞれ1件 ALMOST(あと1人)になるよう組んでいる。
 */
export const MOCK_COMBOS: ComboDef[] = [
  {
    id: 'cb_akane_shiki',
    name: '紅刃連鎖',
    kind: 'PAIR',
    description: 'あかねが「灯火一閃」を放った直後、シキが影から追撃する。息が合った時だけ成立する連続攻撃。',
    members: ['ch_akane', 'ch_shiki'],
    trigger: { type: 'ON_SKILL_USE', actor: 'ch_akane', skill: 'sk_flame_edge' },
    effects: [{ performer: 'ch_shiki', skill: 'sk_shadow_bind' }],
    fx: 'combo_ember_shadow',
  },
  {
    id: 'cb_akane_noa',
    name: '祝祭の刃',
    kind: 'PAIR',
    description: 'ノアの歌に合わせて刃が輝く。バフの直後、あかねの攻撃力がさらに跳ね上がる。',
    members: ['ch_akane', 'ch_noa'],
    trigger: { type: 'ON_SKILL_USE', actor: 'ch_noa', skill: 'sk_aria_buff' },
    effects: [{ performer: 'ch_akane', effect: { type: 'STATUS', status: 'ATK_UP', duration: 2, potency: 15 } }],
    fx: 'combo_fanfare_blade',
  },
  {
    id: 'cb_shiki_zero',
    name: '断絶ハック',
    kind: 'PAIR',
    description: 'シキが意識を刈り取った隙に、ZER0が防御を書き換える。暗殺と電脳の連携。',
    members: ['ch_shiki', 'ch_zero'],
    trigger: { type: 'ON_SKILL_USE', actor: 'ch_shiki', skill: 'sk_shadow_bind' },
    effects: [{ performer: 'ch_zero', skill: 'sk_null_hack' }],
    fx: 'combo_void_glitch',
  },
  {
    id: 'cb_trio_dawn',
    name: '暁光三重奏',
    kind: 'TRIO',
    description: 'あかね・ノア・ZER0が揃うと、開戦と共に灯火の意思が同期する。',
    members: ['ch_akane', 'ch_noa', 'ch_zero'],
    trigger: { type: 'ON_BATTLE_START' },
    effects: [{ effect: { type: 'STATUS', status: 'ATK_UP', duration: 2, potency: 10 } }],
    fx: 'combo_dawn_trio',
  },
  {
    id: 'cb_speed_tag',
    name: '疾風連携',
    kind: 'TAG',
    description: '「高速」タグを持つキャラが2体以上揃うと、開戦時に全員の速度が上がる。',
    requireTag: { tag: '高速', count: 2 },
    trigger: { type: 'ON_BATTLE_START' },
    effects: [{ effect: { type: 'STATUS', status: 'SPD_UP', duration: 3, potency: 15 } }],
    fx: 'combo_speed_link',
  },
  {
    id: 'cb_party_light',
    name: '聖歌隊全開',
    kind: 'PARTY',
    description: '編成5人全員が光属性で揃うと、聖歌隊のフルコーラスが発動する。',
    requireAllElement: 'LIGHT',
    trigger: { type: 'ON_BATTLE_START' },
    effects: [{ effect: { type: 'HEAL', power: 0.2, scaling: 'hp' } }],
    fx: 'combo_choir_light',
  },
  {
    // P5-3: 実装完了。孤月紅葉(幽波紋) × 電子 独(幽波紋) のペアコンボ「引き合う引力」相当。
    id: 'cb_momiji_kc_hitori',
    name: '引き合う引力',
    kind: 'PAIR',
    description: '紅葉が「時飛ばし」で戦場ごと時を刈り取った刹那、独(幽波紋)が電子の世界の向こう側から呼応する。パラレルの紅葉が、それでも執念で見つけ出した独と噛み合った瞬間だけ成立する連携。',
    members: ['ch_momiji_kc', 'ch_hitori_stand'],
    trigger: { type: 'ON_SKILL_USE', actor: 'ch_momiji_kc', skill: 'sk_kc_fold' },
    effects: [{ performer: 'ch_hitori_stand', skill: 'sk_null_hack' }],
    fx: 'combo_void_glitch',
  },
];

/* ---------------- 未実装キャラ (plannedCharacters) ----------------
 * コンボ定義が参照するが、まだキャラとして実装されていないID。
 * UI はこれを使って「IDを生で出さず名前(実装予定)で表示する」。
 */
export const MOCK_PLANNED_CHARACTERS: PlannedCharacterDef[] = [
  { id: 'ch_mikoto', name: '森羅 ミコト', note: '図鑑用シルエットのみ先行公開中。' },
];

/* ---------------- 素材 (ドロップ/図鑑用) ---------------- */
export const MOCK_MATERIALS: MaterialDef[] = [
  { id: 'mat_scrap', name: '瓦礫の欠片', rarity: 'COMMON', description: 'どこにでも落ちている金属片。強化の基礎素材。', usage: '装備強化', icon: '欠' },
  { id: 'mat_circuit', name: '焼けた基盤', rarity: 'UNCOMMON', description: 'ノイズ生物の内部から採れる回路片。', usage: '装備強化', icon: '基' },
  { id: 'mat_ember_core', name: '灯火の残り火', rarity: 'RARE', description: '炎属性の敵が稀に落とす、消えない火種。', usage: '装備強化 / 重複キャラ変換', icon: '炎' },
  { id: 'mat_void_shard', name: '虚無の欠片', rarity: 'EPIC', description: '存在そのものが薄い破片。長く持つと輪郭が滲む。', usage: '装備強化 / 重複キャラ変換', icon: '虚' },
  { id: 'mat_prism_dust', name: '虹晶の粉', rarity: 'LEGENDARY', description: 'UR装備の強化に必要な稀少素材。', usage: '装備強化(高レア)', icon: '晶' },
  { id: 'mat_dup_n', name: '探索者の記憶片・小', rarity: 'COMMON', description: '重複したN〜Rキャラが変換される素材。', usage: '限界突破', icon: '片' },
  { id: 'mat_dup_ssr', name: '探索者の記憶片・大', rarity: 'EPIC', description: '重複したSSR/URキャラが変換される、濃い記憶の断片。', usage: '限界突破', icon: '片' },
  // P4-1: 転生(設計書§17〜§20)用素材。data/items/materials.json の本実装と同じID/名称に揃えている。
  { id: 'mat_rebirth_echo', name: '転生の残響', rarity: 'EPIC', description: '同じ探索者が、別の育ち方をやり直すための残響。', usage: 'キャラクター転生', icon: '転' },
  { id: 'mat_rebirth_seal', name: '転生の刻印', rarity: 'LEGENDARY', description: '選んだ育ち方そのものを、もう一度選び直すための刻印。転生の残響より遥かに稀。', usage: '転生ノードの振り直し', icon: '刻' },
];
export const MOCK_MATERIAL_MAP = new Map(MOCK_MATERIALS.map((m) => [m.id, m]));

/**
 * `BattleEvent.fx` キー → 画面演出のマッピング。
 * サーバ/データ担当が自由に fx キーを増やせるよう、未知のキーは
 * イベント種別と属性から「汎用演出」にフォールバックする。
 */
import type { BattleEventType, Element } from '@akatan/shared';

export type FxFamily =
  | 'slash' | 'pierce' | 'impact'
  | 'flame' | 'frost' | 'thunder' | 'aqua' | 'gale' | 'earth' | 'holy' | 'dark' | 'void'
  | 'glitch' | 'acid' | 'laser' | 'roar'
  | 'heal' | 'cleanse' | 'buff' | 'debuff' | 'gauge'
  | 'ult' | 'awaken' | 'combo' | 'defeat' | 'resist' | 'stun'
  | 'generic';

export interface FxSpec {
  family: FxFamily;
  /** 主色 (CSS color) */
  color: string;
  /** 破片/粒子の数 */
  shards: number;
  /** 画面全体への影響 */
  screen: 'none' | 'flash' | 'shake' | 'heavy';
  /** 演出の想定尺(ms, 1x基準) */
  duration: number;
}

const ELEMENT_COLOR: Record<Element, string> = {
  FIRE: '#ff6a3d', WATER: '#46b6ff', EARTH: '#c99a5b', WIND: '#5ff0b5',
  LIGHT: '#ffe08a', DARK: '#a56bff', VOID: '#ff5ad4',
};

const FAMILY_COLOR: Record<FxFamily, string> = {
  slash: '#dff3ff', pierce: '#bfe6ff', impact: '#ffd9a0',
  flame: '#ff6a3d', frost: '#8fe8ff', thunder: '#ffe98a', aqua: '#46b6ff',
  gale: '#5ff0b5', earth: '#c99a5b', holy: '#fff3c4', dark: '#a56bff', void: '#ff5ad4',
  glitch: '#66fff0', acid: '#9dff5a', laser: '#ffe08a', roar: '#ffb05a',
  heal: '#56f0a8', cleanse: '#9ef4ff', buff: '#ffd166', debuff: '#c07bff', gauge: '#35e6ff',
  ult: '#ff3ea5', awaken: '#ffcc57', combo: '#ff8fb1', defeat: '#ff5f6d',
  resist: '#9aa8cc', stun: '#ffd166', generic: '#dfe8ff',
};

/** fxキーの部分一致ルール(上から順に評価) */
const RULES: [RegExp, FxFamily][] = [
  // 覚醒 / コンボ は属性より優先
  [/awaken|awake|覚醒/i, 'awaken'],
  [/combo|link|chain_combo/i, 'combo'],
  // 必殺技でも「属性が分かる」キー(ult_flame_burst 等)は属性演出を優先する。
  // 必殺技としての扱い(カットイン・画面揺れ)は isUltimateFx() が別途判定する。
  [/heal|cure|regen|medic/i, 'heal'],
  [/cleanse|purify|dispel/i, 'cleanse'],
  [/buff|aria|guard_up|up$/i, 'buff'],
  [/debuff|hex|curse|down$/i, 'debuff'],
  [/gauge|tempo|charge|pulse/i, 'gauge'],
  [/flame|fire|burn|ember|blaze/i, 'flame'],
  [/frost|ice|freeze|blizzard/i, 'frost'],
  [/thunder|volt|spark|lightning|shock/i, 'thunder'],
  [/aqua|water|tide|wave|rain/i, 'aqua'],
  [/gale|wind|storm|breeze/i, 'gale'],
  [/earth|quake|rock|stone|crack/i, 'earth'],
  [/holy|light|radiant|bless/i, 'holy'],
  [/shadow|dark|night|gloom/i, 'dark'],
  [/void|null|abyss/i, 'void'],
  [/glitch|hack|circuit|digital|noise/i, 'glitch'],
  [/acid|poison|venom|toxic/i, 'acid'],
  [/laser|beam|ray/i, 'laser'],
  [/roar|howl|shout/i, 'roar'],
  [/(^|_)ult|ultimate|finisher/i, 'ult'],
  [/slash|blade|cut|sword|edge/i, 'slash'],
  [/pierce|stab|arrow|shot|snipe/i, 'pierce'],
  [/impact|bash|smash|blunt|hammer/i, 'impact'],
  [/defeat|down|dead/i, 'defeat'],
  [/resist|block|immune/i, 'resist'],
  [/stun|freeze_lock|paralyze/i, 'stun'],
];

const TYPE_FALLBACK: Partial<Record<BattleEventType, FxFamily>> = {
  DAMAGE: 'generic',
  HEAL: 'heal',
  STATUS_APPLY: 'debuff',
  STATUS_TICK: 'acid',
  STATUS_EXPIRE: 'cleanse',
  STATUS_RESIST: 'resist',
  GAUGE_CHANGE: 'gauge',
  ULT_READY: 'gauge',
  AWAKEN: 'awaken',
  COMBO: 'combo',
  DEFEAT: 'defeat',
  SKILL_USE: 'generic',
};

const SCREEN_BY_FAMILY: Partial<Record<FxFamily, FxSpec['screen']>> = {
  ult: 'heavy',
  awaken: 'heavy',
  combo: 'flash',
  defeat: 'shake',
  earth: 'shake',
  impact: 'shake',
  thunder: 'flash',
  holy: 'flash',
};

const DURATION_BY_FAMILY: Partial<Record<FxFamily, number>> = {
  ult: 1100, awaken: 1400, combo: 1000, defeat: 800, heal: 700,
};

/** 覚醒 / コンボは属性トークンより常に優先する */
const PRIORITY_RULES: [RegExp, FxFamily][] = [
  [/awaken|awake|覚醒/i, 'awaken'],
  [/combo|link|chain_combo/i, 'combo'],
];

function matchRule(text: string): FxFamily | undefined {
  if (!text) return undefined;
  for (const [re, f] of RULES) {
    if (re.test(text)) return f;
  }
  return undefined;
}

export function resolveFx(
  fxKey: string | undefined,
  element: Element | undefined,
  type: BattleEventType,
): FxSpec {
  let family: FxFamily | undefined;
  if (fxKey) {
    // 1) 先頭トークンを最優先で見る (dark_wave が「波」ではなく「闇」になるように)。
    //    ult_ / awaken_ などの接頭辞は剥がしてから判定する。
    const priority = PRIORITY_RULES.find(([re]) => re.test(fxKey))?.[1];
    const head = fxKey.replace(/^(ult|ultimate|finisher)_/i, '').split('_')[0] ?? '';
    family = priority ?? matchRule(head) ?? matchRule(fxKey);
  }
  if (!family) family = TYPE_FALLBACK[type] ?? 'generic';

  const useElementColor =
    element !== undefined &&
    (family === 'generic' || family === 'slash' || family === 'pierce' || family === 'impact' || family === 'ult');

  // 必殺技キーは属性演出でも「大きく」する
  const grand = isUltimateFx(fxKey);
  const baseShards = family === 'ult' || family === 'awaken' ? 14 : family === 'generic' ? 8 : 10;

  return {
    family,
    color: useElementColor ? ELEMENT_COLOR[element] : FAMILY_COLOR[family],
    shards: grand ? baseShards + 4 : baseShards,
    screen: grand ? (SCREEN_BY_FAMILY[family] ?? 'flash') : (SCREEN_BY_FAMILY[family] ?? 'none'),
    duration: grand ? Math.max(900, DURATION_BY_FAMILY[family] ?? 620) : (DURATION_BY_FAMILY[family] ?? 620),
  };
}

/** 必殺技かどうか(カットインを全画面にするか)の判定 */
export function isUltimateFx(fxKey?: string, skillId?: string): boolean {
  return /(^|_)ult/i.test(fxKey ?? '') || /(^|_)ult/i.test(skillId ?? '');
}

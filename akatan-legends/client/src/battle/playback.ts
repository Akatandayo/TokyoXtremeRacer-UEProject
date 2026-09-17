/**
 * BattleLog タイムライン再生エンジン(クライアント側)。
 *
 * 原則:
 *  - 計算は一切しない。サーバが確定させた `events[]` を seq 順に再生するだけ。
 *  - `snapshot` を持つイベントでは、全ユニットの HP/ゲージ/状態をその値へ即座に上書きする。
 *    (演出の途中経過がどうズレても、snapshot が唯一の正解)
 *  - 演出は「見た目」だけを担当し、ゲーム状態には影響しない。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ActiveStatus, BattleEvent, BattleEventType, BattleLog, BattleUnit,
} from '@akatan/shared';
import { resolveFx, isUltimateFx, type FxSpec } from './fx';
import type { EffectPolicy } from '../state/settings';

export type Speed = 1 | 2 | 4;

export interface UnitRuntime {
  base: BattleUnit;
  hp: number;
  maxHp: number;
  gauge: number;
  ultGauge: number;
  alive: boolean;
  awakened: boolean;
  statuses: ActiveStatus[];
  /** 被弾アニメーションのトリガ(値が変わるたび再生) */
  hitKey: number;
  /** 直近の演出色 */
  auraColor: string | null;
}

export interface Popup {
  id: number;
  unitId: string;
  kind: 'damage' | 'crit' | 'heal' | 'tick' | 'resist' | 'status' | 'defeat' | 'gauge';
  value?: number;
  text?: string;
  affinity: 'weak' | 'resist' | 'normal';
  color: string;
  offset: number;
  expires: number;
}

export interface FxInstance {
  id: number;
  unitId: string;
  spec: FxSpec;
  expires: number;
}

export interface CutIn {
  id: number;
  unitId: string;
  unitName: string;
  title: string;
  kind: 'ult' | 'awaken' | 'combo' | 'skill';
  color: string;
  expires: number;
}

export interface Banner {
  id: number;
  text: string;
  kind: 'start' | 'turn' | 'end';
  expires: number;
}

export type LogHighlight = 'crit' | 'defeat' | 'awaken' | 'combo';

export interface LogLine {
  id: number;
  seq: number;
  type: BattleEventType;
  text: string;
  critical?: boolean;
  /** 同一行動内でまとめられた件数(2以上でログに "他n人" を追記表示する) */
  count: number;
  /** まとめ判定用の内部キー(表示しない) */
  groupKey: string;
  /** DEFEAT/AWAKEN/COMBO/会心DAMAGE を強調するための種別 */
  highlight?: LogHighlight;
}

export interface PlaybackState {
  cursor: number;
  units: Record<string, UnitRuntime>;
  order: string[];
  popups: Popup[];
  fx: FxInstance[];
  cutIn: CutIn | null;
  banner: Banner | null;
  logs: LogLine[];
  activeId: string | null;
  turn: number;
  screenFx: { id: number; kind: FxSpec['screen']; color: string; expires: number } | null;
  finished: boolean;
}

/** イベント種別ごとの「間(ため)」(ms, 1x基準) */
const DELAY: Record<BattleEventType, number> = {
  BATTLE_START: 1000,
  TURN_START: 420,
  ACTION_START: 230,
  SKILL_USE: 480,
  DAMAGE: 380,
  HEAL: 400,
  STATUS_APPLY: 300,
  STATUS_EXPIRE: 170,
  STATUS_TICK: 300,
  STATUS_RESIST: 260,
  GAUGE_CHANGE: 180,
  ULT_READY: 420,
  AWAKEN: 1500,
  COMBO: 1000,
  DEFEAT: 780,
  ACTION_END: 140,
  BATTLE_END: 1100,
};

function delayFor(ev: BattleEvent, policy: EffectPolicy): number {
  let d = DELAY[ev.type] ?? 260;
  if (!policy.cutIn && (ev.type === 'AWAKEN' || ev.type === 'COMBO')) d = 420;
  if (!policy.cutIn && ev.type === 'SKILL_USE') d = 260;
  return d;
}

function initUnits(log: BattleLog): Record<string, UnitRuntime> {
  const out: Record<string, UnitRuntime> = {};
  for (const u of log.units) {
    out[u.id] = {
      base: u,
      hp: u.hp,
      maxHp: u.maxHp,
      gauge: u.gauge,
      ultGauge: u.ultGauge,
      alive: u.alive,
      awakened: u.awakened,
      statuses: u.statuses ?? [],
      hitKey: 0,
      auraColor: null,
    };
  }
  return out;
}

export function initialState(log: BattleLog): PlaybackState {
  return {
    cursor: 0,
    units: initUnits(log),
    order: log.units.map((u) => u.id),
    popups: [],
    fx: [],
    cutIn: null,
    banner: null,
    logs: [],
    activeId: null,
    turn: 1,
    screenFx: null,
    finished: false,
  };
}

let idc = 1;
const nextId = () => idc++;

function applySnapshot(units: Record<string, UnitRuntime>, ev: BattleEvent): Record<string, UnitRuntime> {
  if (!ev.snapshot) return units;
  const next = { ...units };
  for (const s of ev.snapshot) {
    const cur = next[s.id];
    if (!cur) continue;
    next[s.id] = {
      ...cur,
      hp: s.hp,
      gauge: s.gauge,
      ultGauge: s.ultGauge,
      alive: s.alive,
      awakened: s.awakened,
      statuses: s.statuses ?? [],
    };
  }
  return next;
}

function fallbackText(ev: BattleEvent, units: Record<string, UnitRuntime>): string {
  const n = (id?: string) => (id ? units[id]?.base.name ?? id : '');
  switch (ev.type) {
    case 'BATTLE_START': return '戦闘開始';
    case 'TURN_START': return `ターン ${ev.value ?? ''}`;
    case 'SKILL_USE': return `${n(ev.sourceId)} は「${ev.skillName ?? ev.skillId ?? '技'}」を使用`;
    case 'DAMAGE': return `${n(ev.targetId)} に ${ev.value ?? 0} ダメージ`;
    case 'HEAL': return `${n(ev.targetId)} が ${ev.value ?? 0} 回復`;
    case 'STATUS_APPLY': return `${n(ev.targetId)} に ${ev.status ?? '状態'} 付与`;
    case 'STATUS_EXPIRE': return `${n(ev.targetId)} の ${ev.status ?? '状態'} が解除`;
    case 'STATUS_TICK': return `${n(ev.targetId)} が ${ev.status ?? '状態'} の効果を受けた`;
    case 'STATUS_RESIST': return `${n(ev.targetId)} は抵抗した`;
    case 'ULT_READY': return `${n(ev.sourceId)} の必殺技が準備完了`;
    case 'AWAKEN': return `${n(ev.sourceId)} が覚醒!`;
    case 'COMBO': return `コンボ発動!`;
    case 'DEFEAT': return `${n(ev.targetId)} 撃破`;
    case 'BATTLE_END': return ev.value ? '勝利!' : '敗北…';
    default: return '';
  }
}

interface ApplyOpts {
  policy: EffectPolicy;
  speed: Speed;
  logLines: number;
  /** true: 演出を出さずに状態だけ進める(スキップ用) */
  silent?: boolean;
}

export function applyEvent(state: PlaybackState, ev: BattleEvent, opts: ApplyOpts): PlaybackState {
  const { policy, speed, logLines, silent } = opts;
  const now = Date.now();
  const ttl = (ms: number) => now + ms / speed;

  let units = applySnapshot(state.units, ev);
  let popups = state.popups;
  let fx = state.fx;
  let cutIn = state.cutIn;
  let banner = state.banner;
  let screenFx = state.screenFx;
  let activeId = state.activeId;
  let turn = state.turn;

  const spec = resolveFx(ev.fx, ev.element ?? units[ev.sourceId ?? '']?.base.element, ev.type);

  const addPopup = (p: {
    unitId: string;
    kind: Popup['kind'];
    value?: number;
    text?: string;
    color: string;
    affinity?: Popup['affinity'];
    offset?: number;
  }) => {
    if (silent || !policy.damageNumbers) return;
    popups = [
      ...popups,
      {
        id: nextId(),
        expires: ttl(1000),
        offset: p.offset ?? (popups.length % 3) * 14 - 14,
        unitId: p.unitId,
        kind: p.kind,
        value: p.value,
        text: p.text,
        color: p.color,
        affinity: p.affinity ?? 'normal',
      },
    ];
  };

  const addFx = (unitId?: string) => {
    if (silent || !unitId) return;
    fx = [...fx, { id: nextId(), unitId, spec, expires: ttl(spec.duration) }];
  };

  const hit = (unitId?: string) => {
    if (!unitId || !units[unitId]) return;
    units = { ...units, [unitId]: { ...units[unitId]!, hitKey: units[unitId]!.hitKey + 1 } };
  };

  const setScreen = (kind: FxSpec['screen']) => {
    if (silent || kind === 'none' || !policy.shake) return;
    screenFx = { id: nextId(), kind, color: spec.color, expires: ttl(kind === 'heavy' ? 900 : 420) };
  };

  switch (ev.type) {
    case 'BATTLE_START':
      if (!silent) banner = { id: nextId(), text: ev.text ?? '戦闘開始', kind: 'start', expires: ttl(1100) };
      break;

    case 'TURN_START':
      turn = ev.value ?? turn + 1;
      if (!silent) banner = { id: nextId(), text: `TURN ${turn}`, kind: 'turn', expires: ttl(700) };
      break;

    case 'ACTION_START':
      activeId = ev.sourceId ?? null;
      break;

    case 'ACTION_END':
      activeId = null;
      if (ev.status && !silent) {
        addPopup({ unitId: ev.sourceId ?? '', kind: 'status', text: ev.status === 'STUN' ? '気絶' : '行動不能', color: '#ffd166', affinity: 'normal' });
      }
      break;

    case 'SKILL_USE': {
      const ult = isUltimateFx(ev.fx, ev.skillId);
      if (!silent && policy.cutIn) {
        cutIn = {
          id: nextId(),
          unitId: ev.sourceId ?? '',
          unitName: units[ev.sourceId ?? '']?.base.name ?? '',
          title: ev.skillName ?? ev.skillId ?? '技',
          kind: ult ? 'ult' : 'skill',
          color: spec.color,
          expires: ttl(ult ? 1200 : 700),
        };
      }
      if (ult) setScreen('heavy');
      addFx(ev.sourceId);
      break;
    }

    case 'DAMAGE': {
      addFx(ev.targetId);
      hit(ev.targetId);
      addPopup({
        unitId: ev.targetId ?? '',
        kind: ev.critical ? 'crit' : 'damage',
        value: ev.value,
        color: spec.color,
        affinity: ev.affinity === undefined ? 'normal' : ev.affinity > 1.01 ? 'weak' : ev.affinity < 0.99 ? 'resist' : 'normal',
      });
      if (ev.critical) setScreen('flash');
      else setScreen(spec.screen);
      break;
    }

    case 'HEAL':
      addFx(ev.targetId);
      // 値0の回復(実質無効果)はポップアップを出さない(「0回復」の意味の無い表示を避ける)
      if (ev.value) {
        addPopup({ unitId: ev.targetId ?? '', kind: 'heal', value: ev.value, color: '#56f0a8', affinity: 'normal' });
      }
      break;

    case 'STATUS_APPLY':
      addFx(ev.targetId);
      addPopup({
        unitId: ev.targetId ?? '',
        kind: 'status',
        text: ev.status ?? '',
        color: spec.color,
        affinity: 'normal',
      });
      break;

    case 'STATUS_TICK':
      addFx(ev.targetId);
      if (ev.value) hit(ev.targetId);
      // 値0のティック(実質無効果)はポップアップを出さない
      if (ev.value) {
        addPopup({ unitId: ev.targetId ?? '', kind: 'tick', value: ev.value, color: spec.color, affinity: 'normal' });
      }
      break;

    case 'STATUS_RESIST':
      addPopup({ unitId: ev.targetId ?? '', kind: 'resist', text: 'RESIST', color: '#9aa8cc', affinity: 'normal' });
      break;

    case 'STATUS_EXPIRE':
      break;

    case 'GAUGE_CHANGE':
      addPopup({
        unitId: ev.targetId ?? '',
        kind: 'gauge',
        text: `${(ev.value ?? 0) >= 0 ? '+' : ''}${ev.value ?? 0}%`,
        color: '#35e6ff',
        affinity: 'normal',
      });
      break;

    case 'ULT_READY':
      addFx(ev.sourceId);
      addPopup({ unitId: ev.sourceId ?? '', kind: 'status', text: '必殺 READY', color: '#ff3ea5', affinity: 'normal' });
      break;

    case 'AWAKEN':
      if (!silent && policy.cutIn) {
        cutIn = {
          id: nextId(),
          unitId: ev.sourceId ?? '',
          unitName: units[ev.sourceId ?? '']?.base.name ?? '',
          title: ev.skillName ?? '覚醒',
          kind: 'awaken',
          color: spec.color,
          expires: ttl(1400),
        };
      }
      addFx(ev.sourceId);
      setScreen('heavy');
      if (ev.sourceId && units[ev.sourceId]) {
        units = { ...units, [ev.sourceId]: { ...units[ev.sourceId]!, awakened: true } };
      }
      break;

    case 'COMBO':
      if (!silent && policy.cutIn) {
        cutIn = {
          id: nextId(),
          unitId: ev.sourceId ?? '',
          unitName: [units[ev.sourceId ?? '']?.base.name, units[ev.targetId ?? '']?.base.name]
            .filter(Boolean).join(' × '),
          title: ev.skillName ?? 'COMBO',
          kind: 'combo',
          color: spec.color,
          expires: ttl(1000),
        };
      }
      addFx(ev.sourceId);
      addFx(ev.targetId);
      setScreen('flash');
      break;

    case 'DEFEAT':
      addFx(ev.targetId);
      addPopup({ unitId: ev.targetId ?? '', kind: 'defeat', text: '撃破', color: '#ff5f6d', affinity: 'normal' });
      setScreen('shake');
      break;

    case 'BATTLE_END':
      if (!silent) {
        banner = {
          id: nextId(),
          text: ev.value ? 'VICTORY' : 'DEFEAT',
          kind: 'end',
          expires: ttl(1400),
        };
      }
      break;
  }

  const text = ev.text ?? fallbackText(ev, units);
  // 値0のHEAL/STATUS_TICKは「0回復」等の意味の無い行になるためログにも出さない
  const zeroNoise = (ev.type === 'HEAL' || ev.type === 'STATUS_TICK') && ev.value === 0;
  let logs = state.logs;
  if (text && ev.type !== 'ACTION_END' && !zeroNoise) {
    // P0-3: grouped イベント(同一行動内で同じスキル・同じ効果が複数対象に連続適用された
    // 2件目以降)はログに新しい行を作らず、直前の行へ「他n人」としてまとめる。
    const groupKey = `${ev.type}:${ev.skillId ?? ''}:${ev.sourceId ?? ''}:${ev.status ?? ''}`;
    const last = state.logs[state.logs.length - 1];
    if (ev.grouped && last && last.groupKey === groupKey) {
      logs = [...state.logs.slice(0, -1), { ...last, count: last.count + 1 }];
    } else {
      const highlight: LogHighlight | undefined =
        ev.type === 'DEFEAT' ? 'defeat'
          : ev.type === 'AWAKEN' ? 'awaken'
            : ev.type === 'COMBO' ? 'combo'
              : ev.type === 'DAMAGE' && ev.critical ? 'crit'
                : undefined;
      logs = [
        ...state.logs,
        { id: nextId(), seq: ev.seq, type: ev.type, text, critical: ev.critical, count: 1, groupKey, highlight },
      ].slice(-Math.max(10, logLines));
    }
  }

  return {
    ...state,
    cursor: state.cursor,
    units,
    popups,
    fx,
    cutIn,
    banner,
    screenFx,
    activeId,
    turn,
    logs,
  };
}

function prune(state: PlaybackState, now: number): PlaybackState {
  const popups = state.popups.filter((p) => p.expires > now);
  const fx = state.fx.filter((f) => f.expires > now);
  const cutIn = state.cutIn && state.cutIn.expires > now ? state.cutIn : null;
  const banner = state.banner && state.banner.expires > now ? state.banner : null;
  const screenFx = state.screenFx && state.screenFx.expires > now ? state.screenFx : null;
  if (
    popups.length === state.popups.length &&
    fx.length === state.fx.length &&
    cutIn === state.cutIn &&
    banner === state.banner &&
    screenFx === state.screenFx
  ) {
    return state;
  }
  return { ...state, popups, fx, cutIn, banner, screenFx };
}

export interface PlaybackOptions {
  policy: EffectPolicy;
  logLines: number;
  initialSpeed: Speed;
  onFinish?: () => void;
}

export interface PlaybackApi {
  state: PlaybackState;
  speed: Speed;
  setSpeed: (s: Speed) => void;
  paused: boolean;
  setPaused: (p: boolean) => void;
  togglePause: () => void;
  skip: () => void;
  restart: () => void;
  progress: number;
  total: number;
}

export function useBattlePlayback(log: BattleLog, opts: PlaybackOptions): PlaybackApi {
  const { policy, logLines, initialSpeed, onFinish } = opts;
  const [state, setState] = useState<PlaybackState>(() => initialState(log));
  const [speed, setSpeed] = useState<Speed>(initialSpeed);
  const [paused, setPaused] = useState(false);
  const appliedRef = useRef<number>(-1);
  const finishedRef = useRef(false);
  const events = log.events;

  const optsRef = useRef({ policy, speed, logLines });
  optsRef.current = { policy, speed, logLines };
  // onFinish の identity 変化で再生タイマーが再スケジュールされないよう ref に逃がす
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  // ログが差し替わったらリセット
  useEffect(() => {
    appliedRef.current = -1;
    finishedRef.current = false;
    setState(initialState(log));
    setPaused(false);
  }, [log]);

  // 1) カーソル位置のイベントを適用する
  useEffect(() => {
    if (state.cursor >= events.length) return;
    if (appliedRef.current >= state.cursor) return;
    appliedRef.current = state.cursor;
    const ev = events[state.cursor]!;
    setState((s) => applyEvent(s, ev, optsRef.current));
  }, [state.cursor, events]);

  // 2) 次のイベントへ進める(種類ごとの「間」を取る)
  useEffect(() => {
    if (paused || state.finished) return;
    if (state.cursor >= events.length) {
      if (!finishedRef.current) {
        finishedRef.current = true;
        setState((s) => ({ ...s, finished: true }));
        onFinishRef.current?.();
      }
      return;
    }
    const ev = events[state.cursor]!;
    const wait = delayFor(ev, policy) / speed;
    const t = window.setTimeout(() => {
      setState((s) => (s.cursor === state.cursor ? { ...s, cursor: s.cursor + 1 } : s));
    }, wait);
    return () => window.clearTimeout(t);
  }, [state.cursor, state.finished, paused, speed, events, policy]);

  // 3) 期限切れの演出を掃除する
  useEffect(() => {
    const iv = window.setInterval(() => {
      setState((s) => prune(s, Date.now()));
    }, 120);
    return () => window.clearInterval(iv);
  }, []);

  const skip = useCallback(() => {
    setState((s) => {
      let next = s;
      for (let i = s.cursor; i < events.length; i++) {
        next = applyEvent(next, events[i]!, { ...optsRef.current, silent: true });
      }
      appliedRef.current = events.length;
      return {
        ...next,
        cursor: events.length,
        popups: [],
        fx: [],
        cutIn: null,
        banner: null,
        screenFx: null,
        finished: true,
      };
    });
    if (!finishedRef.current) {
      finishedRef.current = true;
      onFinishRef.current?.();
    }
  }, [events]);

  const restart = useCallback(() => {
    appliedRef.current = -1;
    finishedRef.current = false;
    setState(initialState(log));
    setPaused(false);
  }, [log]);

  const togglePause = useCallback(() => setPaused((p) => !p), []);

  return useMemo(
    () => ({
      state,
      speed,
      setSpeed,
      paused,
      setPaused,
      togglePause,
      skip,
      restart,
      progress: Math.min(state.cursor, events.length),
      total: events.length,
    }),
    [state, speed, paused, togglePause, skip, restart, events.length],
  );
}

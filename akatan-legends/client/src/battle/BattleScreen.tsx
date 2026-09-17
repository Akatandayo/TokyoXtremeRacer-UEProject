/**
 * BATTLE 画面。
 * サーバが確定させた BattleLog を「再生」することに専念する。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  BattleStartResponse, BattleUnitStat, ActiveStatus, BattleLog,
} from '@akatan/shared';
import { useStore } from '../state/store';
import { effectPolicy } from '../state/settings';
import { useBattlePlayback, type PlaybackState, type Speed, type UnitRuntime, type FxInstance, type Popup } from './playback';
import { CharacterArtView } from '../components/CharacterArt';
import { STATUS_ICON, STATUS_LABEL, isBuff, formatNumber } from '../utils/labels';

/** 再生対象が無いときの空ログ。毎レンダで新しいオブジェクトを作らないようモジュール定数にする。 */
const EMPTY_LOG: BattleLog = {
  id: 'empty', seed: 0, createdAt: '', units: [], events: [],
  result: { victory: false, ticks: 0, turns: 0, stats: [] },
};

/* ---------- アニメーション補助 (再マウントせずに再生する) ---------- */

function usePulse<T extends HTMLElement>(
  dep: number,
  frames: Keyframe[],
  options: KeyframeAnimationOptions,
): React.RefObject<T> {
  const ref = useRef<T>(null);
  const framesRef = useRef(frames);
  const optRef = useRef(options);
  framesRef.current = frames;
  optRef.current = options;
  useEffect(() => {
    if (dep <= 0) return;
    const el = ref.current;
    if (!el || typeof el.animate !== 'function') return;
    const anim = el.animate(framesRef.current, optRef.current);
    return () => {
      try { anim.cancel(); } catch { /* noop */ }
    };
  }, [dep]);
  return ref;
}

/* ---------- FX ---------- */

function FxBurst({ fx }: { fx: FxInstance }): JSX.Element {
  const n = fx.spec.shards;
  return (
    <div
      className={`fx fx-${fx.spec.family}`}
      style={{ ['--c' as string]: fx.spec.color, ['--n' as string]: n }}
      aria-hidden
    >
      <div className="fx-ring" />
      <div className="fx-core" />
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className="fx-shard" style={{ ['--i' as string]: i }} />
      ))}
    </div>
  );
}

/* ---------- ダメージポップアップ ---------- */

function PopupView({ p }: { p: Popup }): JSX.Element {
  const affClass = p.affinity === 'weak' ? 'a-weak' : p.affinity === 'resist' ? 'a-resist' : '';
  return (
    <div
      className={`dmg-popup k-${p.kind} ${affClass}`}
      style={{ marginLeft: p.offset, color: p.kind === 'damage' ? undefined : p.color }}
    >
      {p.value !== undefined ? formatNumber(p.value) : p.text}
      {p.affinity === 'weak' && <span className="aff">弱点</span>}
      {p.affinity === 'resist' && <span className="aff">耐性</span>}
      {p.kind === 'crit' && <span className="aff">CRITICAL</span>}
    </div>
  );
}

/* ---------- 状態異常 ---------- */

function StatusStrip({ statuses }: { statuses: ActiveStatus[] }): JSX.Element {
  return (
    <div className="status-strip">
      {statuses.slice(0, 6).map((s, i) => (
        <span
          key={`${s.type}-${i}`}
          className={`status-chip ${isBuff(s.type) ? 'buff' : 'debuff'}`}
          title={`${STATUS_LABEL[s.type]} 残り${s.duration}ターン`}
        >
          {STATUS_ICON[s.type]}
          <i className="dur">{s.duration}</i>
        </span>
      ))}
    </div>
  );
}

/* ---------- ユニット ---------- */

function UnitView({
  rt, active, popups, fxs,
}: {
  rt: UnitRuntime;
  active: boolean;
  popups: Popup[];
  fxs: FxInstance[];
}): JSX.Element {
  const u = rt.base;
  const pct = rt.maxHp > 0 ? Math.max(0, (rt.hp / rt.maxHp) * 100) : 0;
  const [ghost, setGhost] = useState(pct);
  const ghostRef = useRef(pct);
  ghostRef.current = ghost;

  useEffect(() => {
    if (pct < ghostRef.current) {
      const t = window.setTimeout(() => setGhost(pct), 440);
      return () => window.clearTimeout(t);
    }
    setGhost(pct);
    return undefined;
  }, [pct]);

  const hitRef = usePulse<HTMLDivElement>(
    rt.hitKey,
    [
      { transform: 'translate(0,0)', filter: 'brightness(1)' },
      { transform: 'translate(-7px,2px)', filter: 'brightness(2.4) saturate(0.4)', offset: 0.2 },
      { transform: 'translate(5px,-2px)', filter: 'brightness(1)', offset: 0.45 },
      { transform: 'translate(-3px,1px)', offset: 0.7 },
      { transform: 'translate(0,0)' },
    ],
    { duration: 320, easing: 'ease-out' },
  );

  const hpClass = pct <= 25 ? 'low' : pct <= 55 ? 'mid' : '';

  return (
    <div
      ref={hitRef}
      className={[
        'bunit',
        u.side === 'ENEMY' ? 'is-enemy' : 'is-ally',
        active ? 'is-active' : '',
        rt.alive ? '' : 'is-dead',
        rt.awakened ? 'is-awakened' : '',
      ].filter(Boolean).join(' ')}
    >
      <div className="bunit-art">
        <CharacterArtView
          art={u.art}
          name={u.name}
          element={u.element}
          rarity={u.rarity}
          awakened={rt.awakened}
          ratio="square"
          sigilScale={0.7}
        />
        <div className="fx-layer">
          {fxs.map((f) => <FxBurst key={f.id} fx={f} />)}
        </div>
      </div>

      <div className="bunit-name">
        <span>{u.name}</span>
        <span className="lv">Lv{u.level}</span>
      </div>

      <div className={`hpbar ${hpClass}`}>
        <span className="ghost" style={{ width: `${ghost}%` }} />
        <span className="fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="hp-text">
        <span>{formatNumber(rt.hp)}</span>
        <span className="muted">/{formatNumber(rt.maxHp)}</span>
      </div>

      <div className="gauge act" title="行動ゲージ">
        <span style={{ width: `${Math.min(100, rt.gauge)}%` }} />
      </div>
      <div className={`gauge ult ${rt.ultGauge >= 100 ? 'ready' : ''}`} title="必殺ゲージ">
        <span style={{ width: `${Math.min(100, rt.ultGauge)}%` }} />
      </div>

      <StatusStrip statuses={rt.statuses} />

      <div className="popup-layer">
        {popups.map((p) => <PopupView key={p.id} p={p} />)}
      </div>
    </div>
  );
}

/* ---------- カットイン ---------- */

function CutInView({ state }: { state: PlaybackState }): JSX.Element | null {
  const c = state.cutIn;
  if (!c) return null;
  const unit = state.units[c.unitId]?.base;
  const kindLabel =
    c.kind === 'ult' ? 'ULTIMATE' : c.kind === 'awaken' ? 'AWAKENING' : c.kind === 'combo' ? 'COMBO' : 'SKILL';
  return (
    <div className={`cutin k-${c.kind}`} style={{ ['--cc' as string]: c.color }} key={c.id}>
      {(c.kind === 'ult' || c.kind === 'awaken') && <div className="cutin-rays" />}
      <div className="cutin-band">
        {unit && (
          <div className="cutin-portrait">
            <CharacterArtView
              art={unit.art}
              name={unit.name}
              element={unit.element}
              rarity={unit.rarity}
              ratio="square"
              sigilScale={0.8}
            />
          </div>
        )}
        <div className="cutin-text">
          <div className="cutin-kind">{kindLabel}</div>
          <div className="cutin-title">{c.title}</div>
          <div className="cutin-name">{c.unitName}</div>
        </div>
      </div>
    </div>
  );
}

/* ---------- リザルト ---------- */

function ResultOverlay({
  data, onBack, onRetry,
}: { data: BattleStartResponse; onBack: () => void; onRetry: () => void }): JSX.Element {
  const { log, rewards, stage } = data;
  const victory = log.result.victory;
  const allyStats = log.result.stats.filter((s) => s.side === 'ALLY');
  const mvp = allyStats.slice().sort((a, b) => b.damageDealt - a.damageDealt)[0];
  const mvpUnit = mvp ? log.units.find((u) => u.id === mvp.id) : undefined;
  const levelUps = rewards?.levelUps ?? [];

  return (
    <div className="result-overlay" role="dialog" aria-modal="true" aria-label="戦闘結果">
      <div className="result-card">
        <div className={`result-title ${victory ? 'win' : 'lose'}`}>
          {victory ? 'VICTORY' : 'DEFEAT'}
        </div>
        <div style={{ textAlign: 'center' }} className="muted">
          {stage?.name ?? ''} / {log.result.turns}ターン ({log.result.ticks}tick)
        </div>

        {rewards && (
          <div className="reward-grid">
            <div className="reward-box exp">
              <div className="k">獲得EXP</div>
              <div className="v">+{formatNumber(rewards.exp)}</div>
            </div>
            <div className="reward-box gold">
              <div className="k">獲得ゴールド</div>
              <div className="v">+{formatNumber(rewards.gold)}</div>
            </div>
          </div>
        )}

        {levelUps.length > 0 && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="section-title" style={{ marginBottom: 0 }}>
              LEVEL UP<span className="jp">レベルアップ</span>
            </div>
            {levelUps.map((l, i) => (
              <div className="levelup-row" key={l.uid} style={{ animationDelay: `${0.12 * i + 0.3}s` }}>
                <div className="lv">
                  <span className="tabular">{l.fromLevel}</span>
                  <span className="arrow">▶</span>
                  <span className="tabular">{l.toLevel}</span>
                </div>
                <div>
                  <div style={{ fontWeight: 700 }}>{l.name}</div>
                  <div className="gains">
                    {Object.entries(l.statGain).map(([k, v]) =>
                      v ? <span key={k}>{k.toUpperCase()} +{formatNumber(v as number)}</span> : null,
                    )}
                  </div>
                </div>
                <div className="muted tabular" style={{ fontSize: 11 }}>+{formatNumber(l.expGained)} EXP</div>
              </div>
            ))}
          </div>
        )}

        {mvp && (
          <div className="mvp-box">
            <div>
              {mvpUnit && (
                <CharacterArtView
                  art={mvpUnit.art}
                  name={mvpUnit.name}
                  element={mvpUnit.element}
                  rarity={mvpUnit.rarity}
                  ratio="square"
                  sigilScale={0.8}
                />
              )}
            </div>
            <div>
              <div className="mvp-label">MVP</div>
              <div className="mvp-name">{mvp.name}</div>
              <div className="muted" style={{ fontSize: 12 }}>
                与ダメージ <b className="tabular" style={{ color: 'var(--gold)' }}>{formatNumber(mvp.damageDealt)}</b>
                {mvp.kills > 0 && <> / 撃破 {mvp.kills}</>}
                {mvp.healing > 0 && <> / 回復 {formatNumber(mvp.healing)}</>}
              </div>
            </div>
          </div>
        )}

        <details>
          <summary className="muted" style={{ cursor: 'pointer', fontSize: 12 }}>全ユニットの戦績を見る</summary>
          <table className="stat-table" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>ユニット</th><th>与ダメ</th><th>被ダメ</th><th>回復</th><th>撃破</th><th>生存</th>
              </tr>
            </thead>
            <tbody>
              {log.result.stats.map((s: BattleUnitStat) => (
                <tr key={s.id} className={s.side === 'ENEMY' ? 'enemy' : ''}>
                  <td>{s.name}</td>
                  <td>{formatNumber(s.damageDealt)}</td>
                  <td>{formatNumber(s.damageTaken)}</td>
                  <td>{formatNumber(s.healing)}</td>
                  <td>{s.kills}</td>
                  <td>{s.survived ? '○' : '×'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>

        <div className="row" style={{ justifyContent: 'center', marginTop: 4 }}>
          <button className="btn" onClick={onBack}>ダンジョンへ戻る</button>
          <button className="btn btn-primary" onClick={onRetry}>もう一度戦う</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- 本体 ---------- */

export function BattleScreen(): JSX.Element {
  const store = useStore();
  const data = store.battle;
  const policy = useMemo(() => effectPolicy(store.settings), [store.settings]);
  const [showResult, setShowResult] = useState(false);
  const finishedOnce = useRef(false);
  const arenaRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const [retrying, setRetrying] = useState(false);

  const onFinish = useCallback(() => {
    if (finishedOnce.current) return;
    finishedOnce.current = true;
    if (!data) return;
    const allyStats = data.log.result.stats.filter((s) => s.side === 'ALLY');
    const mvp = allyStats.slice().sort((a, b) => b.damageDealt - a.damageDealt)[0];
    store.finishBattle({
      id: data.log.id,
      stageId: data.stage?.id ?? data.log.stageId ?? '',
      stageName: data.stage?.name ?? '',
      victory: data.log.result.victory,
      exp: data.rewards?.exp ?? 0,
      gold: data.rewards?.gold ?? 0,
      mvpName: mvp?.name ?? '-',
      mvpDamage: mvp?.damageDealt ?? 0,
      turns: data.log.result.turns,
      at: new Date().toISOString(),
    });
    setShowResult(true);
  }, [data, store]);

  const log = data?.log;
  const playback = useBattlePlayback(
    log ?? EMPTY_LOG,
    {
      policy,
      logLines: store.settings.logLines,
      initialSpeed: store.settings.speed as Speed,
      onFinish,
    },
  );

  const { state } = playback;

  // 画面揺れ (再マウントせずに再生)
  const shakeId = state.screenFx?.id ?? 0;
  useEffect(() => {
    const el = arenaRef.current;
    const kind = state.screenFx?.kind;
    if (!el || !kind || kind === 'none' || typeof el.animate !== 'function') return;
    const frames: Keyframe[] =
      kind === 'heavy'
        ? [
            { transform: 'translate(0,0) scale(1)' },
            { transform: 'translate(-11px,6px) scale(1.012)', offset: 0.12 },
            { transform: 'translate(9px,-7px) scale(1.016)', offset: 0.3 },
            { transform: 'translate(-6px,4px) scale(1.008)', offset: 0.5 },
            { transform: 'translate(4px,-2px)', offset: 0.72 },
            { transform: 'translate(0,0) scale(1)' },
          ]
        : [
            { transform: 'translate(0,0)' },
            { transform: 'translate(-6px,3px)', offset: 0.25 },
            { transform: 'translate(5px,-4px)', offset: 0.5 },
            { transform: 'translate(-3px,2px)', offset: 0.75 },
            { transform: 'translate(0,0)' },
          ];
    const a = el.animate(frames, { duration: kind === 'heavy' ? 640 : 320, easing: 'ease-out' });
    return () => {
      try { a.cancel(); } catch { /* noop */ }
    };
  }, [shakeId, state.screenFx?.kind]);

  // ログの自動スクロール
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.logs.length]);

  // 戦闘終了後、自動でリザルトを開く設定
  useEffect(() => {
    if (state.finished && store.settings.autoResult) setShowResult(true);
  }, [state.finished, store.settings.autoResult]);

  const handleRetry = useCallback(async () => {
    if (!data?.stage) return;
    setRetrying(true);
    try {
      finishedOnce.current = false;
      setShowResult(false);
      await store.startBattle(data.stage.id);
    } catch {
      setShowResult(true);
    } finally {
      setRetrying(false);
    }
  }, [data, store]);

  const handleBack = useCallback(() => {
    store.clearBattle();
    store.navigate('DUNGEON');
  }, [store]);

  if (!data || !log) {
    return (
      <div className="state-box">
        <div className="muted">再生する戦闘がありません。</div>
        <button className="btn btn-primary" onClick={() => store.navigate('DUNGEON')}>
          ダンジョンへ
        </button>
      </div>
    );
  }

  const allies = state.order
    .map((id) => state.units[id])
    .filter((u): u is UnitRuntime => !!u && u.base.side === 'ALLY')
    .sort((a, b) => a.base.slot - b.base.slot);
  const enemies = state.order
    .map((id) => state.units[id])
    .filter((u): u is UnitRuntime => !!u && u.base.side === 'ENEMY')
    .sort((a, b) => a.base.slot - b.base.slot);

  const popupsFor = (id: string) => state.popups.filter((p) => p.unitId === id);
  const fxFor = (id: string) => state.fx.filter((f) => f.unitId === id);

  const renderUnit = (rt: UnitRuntime) => (
    <UnitView
      key={rt.base.id}
      rt={rt}
      active={state.activeId === rt.base.id}
      popups={popupsFor(rt.base.id)}
      fxs={fxFor(rt.base.id)}
    />
  );

  const flash = state.screenFx?.kind === 'flash' ? state.screenFx : null;

  return (
    <div className="battle-root">
      <div className="battle-bar">
        <span className="stage-name">{data.stage?.name ?? '戦闘'}</span>
        <span className="turn-badge">TURN {state.turn}</span>
        <div className="battle-progress" aria-hidden>
          <span style={{ width: `${playback.total ? (playback.progress / playback.total) * 100 : 0}%` }} />
        </div>
        <div className="speed-ctrl">
          <div className="seg" role="group" aria-label="再生速度">
            {([1, 2, 4] as Speed[]).map((s) => (
              <button
                key={s}
                className={playback.speed === s ? 'is-on' : ''}
                onClick={() => playback.setSpeed(s)}
              >
                {s}x
              </button>
            ))}
          </div>
          <button className="btn btn-sm btn-ghost" onClick={playback.togglePause} disabled={state.finished}>
            {playback.paused ? '▶ 再開' : '❚❚ 一時停止'}
          </button>
          <button className="btn btn-sm" onClick={playback.skip} disabled={state.finished}>
            ⏭ スキップ
          </button>
          {state.finished && (
            <button className="btn btn-sm btn-ghost" onClick={() => { finishedOnce.current = true; playback.restart(); setShowResult(false); }}>
              ↺ 再生し直す
            </button>
          )}
          {state.finished && !showResult && (
            <button className="btn btn-sm btn-primary" onClick={() => setShowResult(true)}>
              結果を見る
            </button>
          )}
        </div>
      </div>

      <div className="battle-main">
        <div className="arena" ref={arenaRef}>
          {flash && (
            <div
              key={flash.id}
              className="arena-flash"
              style={{
                position: 'absolute',
                inset: 0,
                background: flash.color,
                opacity: 0.2,
                zIndex: 5,
                pointerEvents: 'none',
                animation: 'flash-out 0.34s ease-out forwards',
              }}
            />
          )}

          <div className="side-row enemies">
            <span className="side-label">ENEMY</span>
            {enemies.map(renderUnit)}
          </div>

          <div className="side-row allies">
            <span className="side-label">PARTY</span>
            {allies.map(renderUnit)}
          </div>

          <CutInView state={state} />

          {state.banner && (
            <div className={`battle-banner k-${state.banner.kind}`} key={state.banner.id}>
              <span className="txt">{state.banner.text}</span>
            </div>
          )}
        </div>

        <aside className="battle-log">
          <h3>BATTLE LOG</h3>
          <div className="log-list" ref={logRef}>
            {state.logs.map((l) => (
              <div key={l.id} className={`log-line t-${l.type} ${l.critical ? 'is-crit' : ''}`}>
                {l.text}
              </div>
            ))}
          </div>
        </aside>
      </div>

      {showResult && (
        <ResultOverlay
          data={data}
          onBack={handleBack}
          onRetry={retrying ? () => undefined : handleRetry}
        />
      )}
    </div>
  );
}

export default BattleScreen;

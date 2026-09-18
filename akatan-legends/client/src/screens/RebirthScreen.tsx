/**
 * REBIRTH: 転生画面(設計書§17〜§20)。
 * `GET /api/characters/:uid/rebirth` で状態取得、
 * `POST .../rebirth`(実行) / `.../rebirth/allocate`(ポイント割り振り) /
 * `.../rebirth/reset`(振り直し)で操作する。
 *
 * 転生 = 長期的な育成、覚醒 = 戦闘中だけの特殊状態(§20)。この画面のUIでも
 * その違いが伝わるよう、「レベルが1に戻る」という不可逆な意思決定を実行前に
 * 必ず確認させ、実行後は「育て直せば前より強くなる」ことを演出で見せる。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  RebirthNodeDef, RebirthPath, RebirthStatus, RebirthResponse, RebirthConfig,
  MaterialStack, MaterialDef, CharacterView,
} from '@akatan/shared';
import { useStore } from '../state/store';
import { api, describeError } from '../api/client';
import { effectPolicy } from '../state/settings';
import { Panel } from '../components/common';
import { CharacterArtView } from '../components/CharacterArt';
import {
  REBIRTH_PATH_ORDER, REBIRTH_PATH_LABEL, REBIRTH_PATH_ICON, REBIRTH_PATH_DESC,
  pathColorVar, rebirthEffectText, nodeStateOf, costFulfillment, materialNameOf,
  formatNumber, formatSignedPct,
} from '../utils/rebirth';

/* ---------------- ツリー: ノード1件 ---------------- */

function NodeCard({
  node, status, busy, onAllocate,
}: {
  node: RebirthNodeDef; status: RebirthStatus; busy: boolean; onAllocate: (nodeId: string) => void;
}): JSX.Element {
  const st = nodeStateOf(node, status);
  const currentEffectText = st.rank > 0
    ? node.effects.map((e) => rebirthEffectText(e, st.rank)).join(' / ')
    : null;

  return (
    <div
      className={`rn-node ${st.locked ? 'is-locked' : ''} ${st.maxed ? 'is-maxed' : ''}`}
      style={{ ['--path-color' as string]: pathColorVar(node.path) }}
    >
      <div className="rn-node-head">
        <span className="rn-node-name">{node.name}</span>
        <span className="rn-node-rank">{st.rank}/{node.maxRank}</span>
      </div>
      <div className="rn-node-desc">{node.description}</div>
      <div className="rn-node-effects">
        {node.effects.map((e, i) => (
          <span key={i} className="rn-node-effect">{rebirthEffectText(e, 1)} / ランク</span>
        ))}
      </div>
      {currentEffectText && (
        <div className="rn-node-current">現在の効果: <b>{currentEffectText}</b></div>
      )}

      {st.locked && (
        <div className="rn-node-lock">
          {st.lockReasons.map((r, i) => <div key={i} className="rn-node-lock-row">・{r}</div>)}
        </div>
      )}

      {st.maxed ? (
        <div className="rn-node-maxed-tag">MAX</div>
      ) : (
        <>
          <button
            type="button"
            className="btn btn-sm btn-primary rn-node-btn"
            disabled={busy || st.locked || !st.affordable}
            onClick={() => onAllocate(node.id)}
          >
            +1 振る(消費 {node.cost}pt)
          </button>
          {!st.locked && !st.affordable && (
            <div className="rn-node-afford-warn">
              ポイント不足(必要{node.cost} / 未使用{status.pointsAvailable})
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------------- ツリー: 系統1カラム ---------------- */

function PathColumn({
  path, nodes, status, busy, onAllocate,
}: {
  path: RebirthPath; nodes: RebirthNodeDef[]; status: RebirthStatus; busy: boolean;
  onAllocate: (nodeId: string) => void;
}): JSX.Element {
  const total = status.pathPoints[path] ?? 0;
  const ofPath = nodes.filter((n) => n.path === path);
  return (
    <div className="rn-path-col" style={{ ['--path-color' as string]: pathColorVar(path) }}>
      <div className="rn-path-head">
        <span className="rn-path-ic" aria-hidden>{REBIRTH_PATH_ICON[path]}</span>
        <div>
          <div className="rn-path-name">{REBIRTH_PATH_LABEL[path]}</div>
          <div className="rn-path-total">累計投資 <b>{total}</b>pt</div>
        </div>
      </div>
      <div className="rn-path-desc muted">{REBIRTH_PATH_DESC[path]}</div>
      <div className="stack" style={{ gap: 8 }}>
        {ofPath.map((n) => (
          <NodeCard key={n.id} node={n} status={status} busy={busy} onAllocate={onAllocate} />
        ))}
      </div>
    </div>
  );
}

/* ---------------- 実行パネル ---------------- */

function RebirthActionPanel({
  view, status, config, materials, materialDefs, busy, onOpenConfirm,
}: {
  view: CharacterView; status: RebirthStatus; config: RebirthConfig | undefined;
  materials: MaterialStack[] | undefined; materialDefs: MaterialDef[] | undefined;
  busy: boolean; onOpenConfirm: () => void;
}): JSX.Element {
  const { rows } = costFulfillment(config?.cost, materials);
  const nextGrowthTotal = status.growthBonusPercent + (config?.growthBonusPercent ?? 0);

  return (
    <div className="rn-action">
      <div className="row" style={{ gap: 22, flexWrap: 'wrap' }}>
        <div>
          <div className="muted rn-mini-label">現在</div>
          <div className="rn-big-stat">
            Lv{view.owned.level} <span style={{ color: 'var(--gold)' }}>★{status.rebirth}</span>
          </div>
        </div>
        <div>
          <div className="muted rn-mini-label">次の転生で得られるもの</div>
          <div className="rn-gain-line">
            転生ポイント <b style={{ color: 'var(--cyan)' }}>+{config?.pointsPerRebirth ?? 0}</b>
            <span className="muted"> / </span>
            成長率 <b style={{ color: 'var(--ok)' }}>+{config?.growthBonusPercent ?? 0}%</b>
            <span className="muted"> (累計 {nextGrowthTotal}%)</span>
          </div>
        </div>
        {config && (
          <div>
            <div className="muted rn-mini-label">転生できるレベル</div>
            <div className="rn-gain-line">Lv{config.requiredLevel} 以上 / 上限{config.maxRebirth}回</div>
          </div>
        )}
      </div>

      <div className="rn-warn">
        転生すると<b>レベルが1に戻ります</b>。振り分け済みの転生ポイントはそのまま残り、
        成長率の上昇も恒久的なので、<b>育て直せば以前より強くなります</b>。
      </div>

      {rows.length > 0 && (
        <div className="rn-cost-rows">
          <div className="muted rn-mini-label">必要な素材</div>
          {rows.map((r) => (
            <div key={r.materialId} className={`rn-cost-row ${r.have >= r.need ? 'is-ok' : 'is-bad'}`}>
              {materialNameOf(materialDefs, r.materialId)} × {r.need}
              <span className="muted"> (所持 {formatNumber(r.have)})</span>
            </div>
          ))}
        </div>
      )}

      {!status.canRebirth && status.reason && (
        <div className="rn-reason">{status.reason}</div>
      )}

      <button className="btn btn-primary" disabled={!status.canRebirth || busy} onClick={onOpenConfirm}>
        転生する
      </button>
    </div>
  );
}

/* ---------------- 演出: 転生の瞬間 ---------------- */

function RebirthReveal({
  result, config, onClose,
}: { result: RebirthResponse; config: RebirthConfig | undefined; onClose: () => void }): JSX.Element {
  const gained = config?.growthBonusPercent ?? 0;
  const afterTotal = result.status.growthBonusPercent;
  const beforeTotal = Math.max(0, afterTotal - gained);
  const barMax = config ? Math.max(1, config.maxRebirth * config.growthBonusPercent) : Math.max(afterTotal, 1);

  return (
    <div className="rn-reveal">
      <div className="section-title" style={{ justifyContent: 'center' }}>
        REBIRTH COMPLETE<span className="jp">転生 完了</span>
      </div>
      <div className="rn-reveal-art">
        <CharacterArtView
          art={result.character.def.art}
          name={result.character.def.name}
          element={result.character.def.element}
          rarity={result.character.def.rarity}
          ratio="square"
          sigilScale={1.3}
          hideBadges
        />
      </div>
      <div className="rn-reveal-name">{result.character.def.name}</div>

      <div className="rn-reveal-rows">
        <div className="rn-reveal-row">
          <span className="k">レベル</span>
          <span className="before">Lv{result.before.level}</span>
          <span className="arrow">▶</span>
          <span className="after">Lv{result.after.level}</span>
        </div>
        <div className="rn-reveal-row">
          <span className="k">転生回数</span>
          <span className="before">★{result.before.rebirth}</span>
          <span className="arrow">▶</span>
          <span className="after gold">★{result.after.rebirth}</span>
        </div>
      </div>

      <div className="rn-reveal-growth">
        <div className="rn-mini-label muted">成長率(恒久・以後のレベルアップすべてに効く)</div>
        <div className="rn-reveal-growth-bar">
          <span className="old" style={{ width: `${Math.min(100, (beforeTotal / barMax) * 100)}%` }} />
          <span
            className="added"
            style={{
              left: `${Math.min(100, (beforeTotal / barMax) * 100)}%`,
              width: `${Math.min(100 - (beforeTotal / barMax) * 100, (gained / barMax) * 100)}%`,
            }}
          />
        </div>
        <div className="rn-reveal-growth-value">
          {beforeTotal}% <span className="arrow">▶</span> <b style={{ color: 'var(--gold)' }}>{afterTotal}%</b>
          <span className="muted"> ({formatSignedPct(gained)})</span>
        </div>
      </div>

      <div className="rn-reveal-msg">
        レベルは1に戻りましたが、成長率は永続的に上がりました。同じレベルまで育てても、
        これまでより大きくステータスが伸びます。<b>育て直せば、転生前より強くなります。</b>
      </div>

      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn btn-primary" onClick={onClose}>ポイントを振り分ける</button>
      </div>
    </div>
  );
}

/* ---------------- 画面本体 ---------------- */

type CutStage = 'charge' | 'reveal';

export function RebirthScreen(): JSX.Element {
  const store = useStore();
  const uid = store.route.charUid;
  const policy = useMemo(() => effectPolicy(store.settings), [store.settings]);
  const view = useMemo(() => store.characters.find((c) => c.owned.uid === uid), [store.characters, uid]);

  const [status, setStatus] = useState<RebirthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<unknown>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [cutStage, setCutStage] = useState<CutStage | null>(null);
  const [cutResult, setCutResult] = useState<RebirthResponse | null>(null);

  const load = useCallback(() => {
    if (!uid) return;
    setLoading(true);
    setLoadErr(null);
    api().getRebirthStatus(uid)
      .then((res) => {
        setStatus(res.status);
        store.applyCharacterView(res.character);
      })
      .catch((e) => setLoadErr(e))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!store.inventory) void store.refreshInventory().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (cutStage !== 'charge') return undefined;
    const t = window.setTimeout(() => setCutStage('reveal'), 900);
    return () => window.clearTimeout(t);
  }, [cutStage]);

  const nodes = store.master?.rebirthNodes;
  const config = store.master?.rebirthConfig;

  const doAllocate = async (nodeId: string) => {
    if (!uid) return;
    setBusy(true);
    setActionErr(null);
    setActionMsg(null);
    try {
      const res = await api().allocateRebirth(uid, nodeId, 1);
      setStatus(res.status);
      store.applyCharacterView(res.character);
    } catch (e) {
      setActionErr(e);
    } finally {
      setBusy(false);
    }
  };

  const doReset = async () => {
    if (!uid) return;
    setBusy(true);
    setActionErr(null);
    setActionMsg(null);
    try {
      const res = await api().resetRebirth(uid);
      setStatus(res.status);
      store.applyCharacterView(res.character);
      if (res.inventory) store.applyInventory(res.inventory);
      setActionMsg('転生ポイントをすべて振り直しました。');
      setResetConfirm(false);
    } catch (e) {
      setActionErr(e);
    } finally {
      setBusy(false);
    }
  };

  const doRebirth = async () => {
    if (!uid) return;
    setBusy(true);
    setActionErr(null);
    try {
      const res = await api().rebirth(uid);
      store.applyCharacterView(res.character);
      store.applyPlayer(res.player);
      if (res.inventory) store.applyInventory(res.inventory);
      setStatus(res.status);
      setCutResult(res);
      setCutStage(policy.cutIn ? 'charge' : 'reveal');
    } catch (e) {
      setActionErr(e);
    } finally {
      setBusy(false);
    }
  };

  const closeCutscene = () => {
    setCutStage(null);
    setCutResult(null);
  };

  if (!uid || !view) {
    return (
      <div className="state-box">
        <div className="muted">キャラクターが見つかりませんでした。</div>
        <button className="btn" onClick={() => store.navigate('CHARACTERS')}>一覧へ戻る</button>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row">
        <button className="btn btn-sm btn-ghost" onClick={() => store.navigate('CHARACTER_DETAIL', uid)}>
          ← キャラ詳細へ
        </button>
        <span className="muted" style={{ fontSize: 11 }}>{view.def.name} の転生 — 長期育成(§17〜§20)</span>
      </div>

      <Panel title="REBIRTH" jp={`${view.def.name} — 転生でビルドを分岐させる`}>
        {loading && <div className="muted" style={{ padding: 20, textAlign: 'center' }}>転生データを取得しています…</div>}
        {loadErr !== null && (
          <div className="error-box">
            <h3>{describeError(loadErr).title}</h3>
            <div className="muted">{describeError(loadErr).detail}</div>
            <div className="muted" style={{ fontSize: 11 }}>
              サーバの転生APIが未対応の場合は、モックモード(URLに ?mock=1 を付ける)で確認できます。
            </div>
            <button className="btn btn-primary" onClick={load}>再試行する</button>
          </div>
        )}
        {!loading && !loadErr && status && (
          <RebirthActionPanel
            view={view}
            status={status}
            config={config}
            materials={store.inventory?.materials}
            materialDefs={store.master?.materials}
            busy={busy}
            onOpenConfirm={() => setConfirmOpen(true)}
          />
        )}
        {actionErr !== null && (
          <div className="error-box" style={{ marginTop: 10 }}>
            <h3>{describeError(actionErr).title}</h3>
            <div className="muted">{describeError(actionErr).detail}</div>
          </div>
        )}
        {actionMsg && <div className="muted" style={{ color: 'var(--ok)', fontSize: 12, marginTop: 8 }}>{actionMsg}</div>}
      </Panel>

      {!loading && !loadErr && status && (!nodes || nodes.length === 0 || !config) && (
        <Panel title="POINT ALLOCATION" jp="転生ポイントの割り振り">
          <div className="muted" style={{ padding: 20, textAlign: 'center' }}>
            転生ノード/設定データがまだ配信されていません(データ担当の対応待ち)。
            配信されると、この画面に4系統の割り振りツリーが表示されます。
          </div>
        </Panel>
      )}

      {!loading && !loadErr && status && nodes && nodes.length > 0 && config && (
        <Panel
          title="POINT ALLOCATION"
          jp="転生ポイントの割り振り — 系統ごとに投資してビルドを分ける"
          right={
            <span className={`rn-unused ${status.pointsAvailable > 0 ? 'is-hot' : ''}`}>
              未使用ポイント <b>{status.pointsAvailable}</b>
            </span>
          }
        >
          <div className="rn-tree">
            {REBIRTH_PATH_ORDER.map((p) => (
              <PathColumn key={p} path={p} nodes={nodes} status={status} busy={busy} onAllocate={(id) => void doAllocate(id)} />
            ))}
          </div>

          <div className="rn-reset-bar">
            <div>
              <div style={{ fontWeight: 700, fontSize: 12.5 }}>振り直し</div>
              <div className="muted" style={{ fontSize: 11 }}>
                {config.resetCost && config.resetCost.length > 0
                  ? `全ノードのランクを0に戻し、消費したポイントを未使用分へ戻します。消費素材: ${config.resetCost
                    .map((c) => `${materialNameOf(store.master?.materials, c.materialId)}×${c.count}`)
                    .join(' / ')}`
                  : 'このキャラクターは振り直しに対応していません。'}
              </div>
            </div>
            <button
              className="btn btn-danger"
              disabled={busy || !config.resetCost || Object.keys(status.nodes).length === 0}
              onClick={() => setResetConfirm(true)}
            >
              振り直す
            </button>
          </div>
        </Panel>
      )}

      {confirmOpen && status && (
        <div className="rn-modal-overlay" role="dialog" aria-modal="true" aria-label="転生の確認">
          <div className="rn-modal">
            <div className="section-title">転生の確認<span className="jp">よく確認してください</span></div>
            <p style={{ fontSize: 13 }}>{view.def.name} を転生させます。</p>
            <ul className="rn-modal-list">
              <li><b>レベルが1に戻ります</b>(現在 Lv{view.owned.level})</li>
              <li>転生回数 ★{status.rebirth} → ★{status.rebirth + 1}</li>
              <li>転生ポイント <b style={{ color: 'var(--cyan)' }}>+{config?.pointsPerRebirth ?? 0}</b></li>
              <li>成長率 <b style={{ color: 'var(--ok)' }}>+{config?.growthBonusPercent ?? 0}%</b>(累計 {status.growthBonusPercent + (config?.growthBonusPercent ?? 0)}%)</li>
              {config?.cost && config.cost.length > 0 && (
                <li>消費素材: {config.cost.map((c) => `${materialNameOf(store.master?.materials, c.materialId)}×${c.count}`).join(' / ')}</li>
              )}
            </ul>
            <p className="muted" style={{ fontSize: 11 }}>
              振り分け済みの転生ポイントはリセットされません。取り消せない操作です。
            </p>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setConfirmOpen(false)}>キャンセル</button>
              <button
                className="btn btn-primary"
                disabled={busy}
                onClick={() => { setConfirmOpen(false); void doRebirth(); }}
              >
                {busy ? '転生中…' : '転生する(確定)'}
              </button>
            </div>
          </div>
        </div>
      )}

      {resetConfirm && status && config?.resetCost && (
        <div className="rn-modal-overlay" role="dialog" aria-modal="true" aria-label="振り直しの確認">
          <div className="rn-modal">
            <div className="section-title">振り直しの確認</div>
            <p style={{ fontSize: 13 }}>
              すべての転生ノードのランクが0に戻り、使用していたポイント({Object.entries(status.nodes)
                .reduce((n, [, r]) => n + r, 0)}ランク分)は未使用ポイントへ戻ります。
            </p>
            <p className="muted" style={{ fontSize: 11 }}>
              消費素材: {config.resetCost.map((c) => `${materialNameOf(store.master?.materials, c.materialId)}×${c.count}`).join(' / ')}
            </p>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <button className="btn btn-ghost" onClick={() => setResetConfirm(false)}>キャンセル</button>
              <button className="btn btn-danger" disabled={busy} onClick={() => void doReset()}>
                {busy ? '処理中…' : '振り直す'}
              </button>
            </div>
          </div>
        </div>
      )}

      {cutStage && cutResult && (
        <div className="rn-cut-overlay" role="dialog" aria-modal="true" aria-label="転生の演出">
          <div className="rn-cut-stage">
            {cutStage === 'charge' && (
              <div className="rn-charge">
                <div className="rn-charge-ring" aria-hidden />
                <div className="rn-charge-ring2" aria-hidden />
                <div className="rn-charge-core" aria-hidden />
                <div className="rn-charge-kanji">転生</div>
                <button className="btn btn-sm btn-ghost rn-charge-skip" onClick={() => setCutStage('reveal')}>スキップ</button>
              </div>
            )}
            {cutStage === 'reveal' && (
              <RebirthReveal result={cutResult} config={config} onClose={closeCutscene} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default RebirthScreen;

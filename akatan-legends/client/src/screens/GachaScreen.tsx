/**
 * SUMMON (ガチャ) 画面。設計書§26〜§27。
 * `GET /api/gacha` / `POST /api/gacha/pull`
 *
 * 演出は「ためる → レアリティ確定 → 結果表示」の3段階。レアリティで演出の格を
 * 明確に変え、10連は順番開示 or 一括表示を選べる。排出率は必ず表示する(誠実さ)。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  GachaBannerDef, GachaPullResult, GachaTicketExchangeDef, PlayerProfile, MaterialStack, Rarity, ItemRarity,
  CharacterArt as ArtDef, CharacterDef,
} from '@akatan/shared';
import { useStore } from '../state/store';
import { Panel } from '../components/common';
import { CharacterArtView } from '../components/CharacterArt';
import { api, describeError } from '../api/client';
import { effectPolicy } from '../state/settings';
import {
  anyRarityLabel, anyRarityColorVar, anyRarityTier, ITEM_RARITY_LABEL,
  EQUIPMENT_SLOT_LABEL, EQUIPMENT_SLOT_ICON, formatNumber,
} from '../utils/labels';

type Stage = 'select' | 'charging' | 'revealing' | 'summary';

const TIER_REVEAL_MS = [420, 480, 620, 900, 1500]; // N/COMMON域 〜 UR/MYTHIC域

function tierOf(r: Rarity | ItemRarity): number {
  return anyRarityTier(r);
}

function currencyLabel(cost: GachaBannerDef['cost'], tickets: MaterialStack[]): string {
  if (cost.currency === 'GOLD') return `${formatNumber(cost.amount)} GOLD`;
  const stack = tickets.find((t) => t.id === (cost.ticketId ?? 'ticket_standard'));
  return `召喚チケット ×${cost.amount}(所持 ${stack?.count ?? 0}枚)`;
}

function canAfford(cost: GachaBannerDef['cost'], player: PlayerProfile | null, tickets: MaterialStack[]): { ok: boolean; reason?: string } {
  if (!player) return { ok: false, reason: 'プレイヤー情報を取得できません' };
  if (cost.currency === 'GOLD') {
    if (player.gold < cost.amount) return { ok: false, reason: `GOLDが足りません(必要 ${formatNumber(cost.amount)} / 所持 ${formatNumber(player.gold)})` };
    return { ok: true };
  }
  const stack = tickets.find((t) => t.id === (cost.ticketId ?? 'ticket_standard'));
  if (!stack || stack.count < cost.amount) {
    return { ok: false, reason: `チケットが足りません(必要 ${cost.amount} / 所持 ${stack?.count ?? 0})` };
  }
  return { ok: true };
}

function RateTable({ banner, characters }: { banner: GachaBannerDef; characters?: CharacterDef[] }): JSX.Element {
  const entries = Object.entries(banner.rates.rarity ?? {}) as [Rarity, number][];
  entries.sort((a, b) => tierOf(b[0]) - tierOf(a[0]));
  // pool 明示バナーは「そのキャラ1体あたり」の実排出率まで開示する(UR枠のみ)。
  const perChar = useMemo(() => {
    if (!banner.pool || !characters) return [];
    const urPct = banner.rates.rarity?.UR ?? 0;
    if (urPct <= 0) return [];
    const urDefs = banner.pool
      .map((id) => characters.find((c) => c.id === id))
      .filter((c): c is CharacterDef => !!c && c.rarity === 'UR');
    if (urDefs.length === 0) return [];
    const pickups = (banner.pickup ?? []).filter((x) => urDefs.some((d) => d.id === x.defId));
    const pickedShare = pickups.reduce((a, x) => a + x.rate, 0);
    const rest = urDefs.filter((d) => !pickups.some((x) => x.defId === d.id));
    return urDefs.map((def) => {
      const pu = pickups.find((x) => x.defId === def.id);
      const rate = pu
        ? (urPct * pu.rate) / 100
        : rest.length === 0
          ? 0
          : (urPct * (100 - pickedShare)) / 100 / rest.length;
      return { def, rate };
    });
  }, [banner, characters]);

  return (
    <div className="rate-table">
      <div className="rate-table-title">排出率</div>
      {entries.map(([r, pct]) => (
        <div className="rate-row" key={r}>
          <span className="rk" style={{ color: anyRarityColorVar(r) }}>{r}</span>
          <span className="rbar"><span style={{ width: `${Math.min(100, (pct ?? 0) * 3)}%`, background: anyRarityColorVar(r) }} /></span>
          <span className="rv">{pct}%</span>
        </div>
      ))}
      {perChar.length > 0 && (
        <div className="rate-perchar">
          {perChar.map(({ def, rate }) => (
            <div className="rate-perchar-row" key={def.id}>
              <span style={{ color: anyRarityColorVar(def.rarity) }}>{def.rarity}</span>
              <span className="rpc-name">{def.name}</span>
              <span className="rpc-rate">{Number(rate.toFixed(3))}%</span>
            </div>
          ))}
        </div>
      )}
      {banner.equipment && (
        <div className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>
          ※ 装備バナーの表記は排出の「格」です。実際の装備レアリティ(コモン〜ミシック)は結果画面で確定表示します。
        </div>
      )}
    </div>
  );
}

/** 演出ステージ: ためる(charging) */
function ChargingStage({ tierHint, skip }: { tierHint: number; skip: boolean }): JSX.Element {
  return (
    <div className={`gacha-charge tier-${tierHint} ${skip ? 'is-fast' : ''}`}>
      <div className="charge-rings" aria-hidden>
        <i /><i /><i />
      </div>
      <div className="charge-core" aria-hidden />
      <div className="charge-text">召喚しています…</div>
    </div>
  );
}

function CharacterResultArt({ name, art, rarity }: { name: string; art?: ArtDef; rarity?: Rarity }): JSX.Element {
  return (
    <CharacterArtView art={art} name={name} rarity={rarity} ratio="square" hideBadges />
  );
}

function GachaResultCard({
  result, masterArtOf, materialNameOf, big,
}: {
  result: GachaPullResult;
  masterArtOf: (defId: string) => ArtDef | undefined;
  materialNameOf: (id: string) => string;
  big?: boolean;
}): JSX.Element {
  const tier = tierOf(result.rarity);
  const isChar = !!result.character;
  const isEquip = !!result.equipment;

  return (
    <div className={`gacha-result-card tier-${tier} ${big ? 'is-big' : ''} ${isChar ? 'k-char' : 'k-equip'}`}>
      {tier >= 3 && <div className="result-burst" aria-hidden />}
      <div className="result-rarity-tag">{anyRarityLabel(result.rarity)}</div>
      {result.byPity && <div className="result-pity-tag">天井到達</div>}

      {isChar && result.character && (
        <>
          <div className="result-art">
            <CharacterResultArt name={result.character.name} art={masterArtOf(result.character.defId)} rarity={result.character.rarity} />
          </div>
          <div className="result-name">{result.character.name}</div>
          {result.character.duplicate ? (
            <div className="result-dup">
              重複 → 素材に変換
              {result.character.converted && (
                <span className="dup-mat"> 「{materialNameOf(result.character.converted.id)}」×{result.character.converted.count}</span>
              )}
            </div>
          ) : (
            <div className="result-new">NEW</div>
          )}
        </>
      )}

      {isEquip && result.equipment && (
        <>
          <div className="result-art result-art-equip">
            <span className="slot-ic-big">{EQUIPMENT_SLOT_ICON[result.equipment.slot]}</span>
          </div>
          <div className="result-name">{result.equipment.name}</div>
          <div className="muted" style={{ fontSize: 10.5 }}>
            {EQUIPMENT_SLOT_LABEL[result.equipment.slot]} / Lv{result.equipment.itemLevel} / {ITEM_RARITY_LABEL[result.equipment.rarity as ItemRarity]}
          </div>
          {big && (
            <div className="item-stats" style={{ marginTop: 6, justifyContent: 'center' }}>
              {Object.entries(result.equipment.stats).filter(([, v]) => !!v).map(([k, v]) => (
                <span key={k} className="item-stat">{k} +{formatNumber(v as number)}</span>
              ))}
            </div>
          )}
          {big && result.equipment.special && (
            <div className="special-tag" style={{ marginTop: 6 }}>{result.equipment.special.name}</div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * チケット交換の1レート分の行。
 * 交換の成否・枚数計算は必ずサーバ(/オフライン版)側で行う(設計書§37)。
 * ここは「何回分交換したいか」という意図を組み立てて渡すだけで、
 * 表示している「交換後の枚数」はあくまで交換前のプレビューでしかない。
 */
function TicketExchangeRow({
  exchange, tickets, materialNameOf, busy, onExchange,
}: {
  exchange: GachaTicketExchangeDef;
  tickets: MaterialStack[];
  materialNameOf: (id: string) => string;
  busy: boolean;
  onExchange: (exchangeId: string, times: number) => void;
}): JSX.Element {
  const fromName = materialNameOf(exchange.fromTicketId);
  const toName = materialNameOf(exchange.toTicketId);
  const fromOwned = tickets.find((t) => t.id === exchange.fromTicketId)?.count ?? 0;
  const toOwned = tickets.find((t) => t.id === exchange.toTicketId)?.count ?? 0;
  const maxTimes = Math.max(1, Math.floor(fromOwned / Math.max(1, exchange.fromCount)));

  const [times, setTimes] = useState(1);
  useEffect(() => {
    setTimes((t) => Math.min(Math.max(1, t), maxTimes));
  }, [maxTimes]);

  const needed = exchange.fromCount * times;
  const gained = exchange.toCount * times;
  const affordable = fromOwned >= needed;

  return (
    <div className="ticket-exchange-row">
      <div className="tex-rate">
        <span className="tex-from">{fromName} ×{exchange.fromCount}</span>
        <span className="tex-arrow" aria-hidden>→</span>
        <span className="tex-to">{toName} ×{exchange.toCount}</span>
      </div>
      {exchange.description && <div className="muted tex-note">{exchange.description}</div>}
      <div className="tex-owned muted">
        所持: {fromName} {formatNumber(fromOwned)}枚 / {toName} {formatNumber(toOwned)}枚
      </div>

      <div className="tex-controls">
        <div className="tex-stepper">
          <button
            type="button"
            className="btn btn-sm"
            disabled={times <= 1}
            onClick={() => setTimes((t) => Math.max(1, t - 1))}
          >−</button>
          <span className="tex-times">{times}回分</span>
          <button
            type="button"
            className="btn btn-sm"
            disabled={times >= maxTimes}
            onClick={() => setTimes((t) => Math.min(maxTimes, t + 1))}
          >＋</button>
        </div>

        <div className="tex-preview">
          <span>{formatNumber(needed)}枚 消費 → {formatNumber(gained)}枚 獲得</span>
          <span className="muted">
            交換後: {fromName} {formatNumber(Math.max(0, fromOwned - needed))}枚 / {toName} {formatNumber(toOwned + gained)}枚
          </span>
        </div>

        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={!affordable || busy || fromOwned === 0}
          onClick={() => onExchange(exchange.id, times)}
        >
          交換する
        </button>
        {!affordable && (
          <div className="afford-reason">
            {fromName}が足りません(必要 {formatNumber(needed)} / 所持 {formatNumber(fromOwned)})
          </div>
        )}
      </div>
    </div>
  );
}

function TicketExchangePanel({
  exchanges, tickets, materialNameOf, onExchange,
}: {
  exchanges: GachaTicketExchangeDef[];
  tickets: MaterialStack[];
  materialNameOf: (id: string) => string;
  onExchange: (exchangeId: string, times: number) => Promise<void>;
}): JSX.Element | null {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);

  if (exchanges.length === 0) return null;

  const handle = async (exchangeId: string, times: number) => {
    setErr(null);
    setBusyId(exchangeId);
    try {
      await onExchange(exchangeId, times);
    } catch (e) {
      setErr(e);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Panel title="EXCHANGE" jp="チケット交換 — 通常ピックアップ → 限定ピックアップ">
      <div className="ticket-exchange-list">
        {exchanges.map((ex) => (
          <TicketExchangeRow
            key={ex.id}
            exchange={ex}
            tickets={tickets}
            materialNameOf={materialNameOf}
            busy={busyId === ex.id}
            onExchange={(id, times) => void handle(id, times)}
          />
        ))}
      </div>
      {err !== null && (
        <div className="afford-reason" style={{ color: 'var(--danger)', marginTop: 8 }}>
          {describeError(err).detail}
        </div>
      )}
    </Panel>
  );
}

export function GachaScreen(): JSX.Element {
  const store = useStore();
  const policy = useMemo(() => effectPolicy(store.settings), [store.settings]);

  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<unknown>(null);
  const [banners, setBanners] = useState<GachaBannerDef[]>([]);
  const [player, setPlayer] = useState<PlayerProfile | null>(null);
  const [pityCounters, setPityCounters] = useState<Record<string, number>>({});
  const [tickets, setTickets] = useState<MaterialStack[]>([]);
  const [exchanges, setExchanges] = useState<GachaTicketExchangeDef[]>([]);
  const [bannerId, setBannerId] = useState<string | null>(null);

  const [stage, setStage] = useState<Stage>('select');
  const [results, setResults] = useState<GachaPullResult[]>([]);
  const [revealIndex, setRevealIndex] = useState(0);
  const [pullErr, setPullErr] = useState<unknown>(null);
  const [pulling, setPulling] = useState(false);
  const timerRef = useRef<number | null>(null);

  const loadGacha = useCallback(() => {
    setLoading(true);
    setLoadErr(null);
    api().getGacha()
      .then((res) => {
        setBanners(res.banners);
        setPlayer(res.player);
        setPityCounters(res.pityCounters);
        setTickets(res.tickets);
        setExchanges(res.exchanges ?? []);
        setBannerId((cur) => cur ?? res.banners[0]?.id ?? null);
      })
      .catch((e) => setLoadErr(e))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadGacha(); }, [loadGacha]);
  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);

  const masterArtOf = useCallback(
    (defId: string) => store.master?.characters.find((c) => c.id === defId)?.art,
    [store.master],
  );
  const materialNameOf = useCallback(
    (id: string) => store.master?.materials?.find((m) => m.id === id)?.name ?? id,
    [store.master],
  );

  const banner = useMemo(() => banners.find((b) => b.id === bannerId) ?? null, [banners, bannerId]);
  const pityRemain = banner?.pity ? Math.max(0, banner.pity.count - (pityCounters[banner.id] ?? 0)) : null;

  const startPull = async (count: 1 | 10) => {
    if (!banner || pulling) return;
    setPulling(true);
    setPullErr(null);
    try {
      const res = await api().gachaPull(banner.id, count);
      store.applyPlayer(res.player);
      store.mergeCharacters(res.characters);
      store.applyInventory(res.inventory);
      setPlayer(res.player);
      setPityCounters((prev) => ({ ...prev, [banner.id]: res.pityCounter }));
      setTickets(res.inventory.tickets);
      setResults(res.results);
      setRevealIndex(0);

      if (!policy.cutIn) {
        // 軽量モード/reduced-motion: 演出を飛ばして即サマリー表示
        setStage('summary');
      } else {
        setStage('charging');
        const bestTier = Math.max(...res.results.map((r) => tierOf(r.rarity)));
        const chargeMs = 500 + bestTier * 220;
        timerRef.current = window.setTimeout(() => {
          setStage('revealing');
        }, chargeMs);
      }
    } catch (e) {
      setPullErr(e);
    } finally {
      setPulling(false);
    }
  };

  const handleExchange = async (exchangeId: string, times: number) => {
    const res = await api().exchangeGachaTickets(exchangeId, times);
    store.applyPlayer(res.player);
    if (store.inventory) store.applyInventory({ ...store.inventory, tickets: res.tickets });
    setPlayer(res.player);
    setTickets(res.tickets);
  };

  // 順番開示の自動進行
  useEffect(() => {
    if (stage !== 'revealing') return undefined;
    if (revealIndex >= results.length) {
      setStage('summary');
      return undefined;
    }
    const tier = tierOf(results[revealIndex]!.rarity);
    const ms = TIER_REVEAL_MS[tier] ?? 500;
    timerRef.current = window.setTimeout(() => setRevealIndex((i) => i + 1), ms);
    return () => { if (timerRef.current) window.clearTimeout(timerRef.current); };
  }, [stage, revealIndex, results]);

  const skipToSummary = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setRevealIndex(results.length);
    setStage('summary');
  };

  const closeResult = () => {
    setStage('select');
    setResults([]);
    setRevealIndex(0);
  };

  if (loading) return <div className="state-box"><div className="spinner" /><div className="muted">召喚情報を取得しています…</div></div>;
  if (loadErr) {
    return (
      <div className="error-box">
        <h3>{describeError(loadErr).title}</h3>
        <div className="muted">{describeError(loadErr).detail}</div>
        <button className="btn btn-primary" onClick={loadGacha}>再試行する</button>
      </div>
    );
  }

  const single = banner ? canAfford(banner.cost, player, tickets) : { ok: false };
  const ten = banner?.cost10 ? canAfford(banner.cost10, player, tickets) : (banner ? canAfford({ ...banner.cost, amount: banner.cost.amount * 10 }, player, tickets) : { ok: false });

  return (
    <div className="stack">
      <Panel title="SUMMON" jp="召喚 — 排出率は常に公開します">
        <div className="gacha-banner-tabs">
          {banners.map((b) => (
            <button
              key={b.id}
              className={`gacha-banner-tab ${bannerId === b.id ? 'is-on' : ''}`}
              style={{ ['--bp' as string]: b.art?.primary ?? 'var(--cyan)', ['--ba' as string]: b.art?.accent ?? 'var(--magenta)' }}
              onClick={() => setBannerId(b.id)}
            >
              {b.name}
              {b.pickup && b.pickup.length > 0 && <span className="pu-mark">PICKUP</span>}
            </button>
          ))}
        </div>

        {banner && (
          <div className="gacha-banner-body" style={{ ['--bp' as string]: banner.art?.primary ?? 'var(--cyan)', ['--ba' as string]: banner.art?.accent ?? 'var(--magenta)' }}>
            <div className="gacha-banner-info">
              <div className="gb-name">{banner.name}</div>
              <div className="gb-desc muted">{banner.description}</div>
              {banner.pickup && banner.pickup.length > 0 && (
                <div className="gb-pickup">
                  {banner.pickup.map((p) => {
                    const def = store.master?.characters.find((c) => c.id === p.defId);
                    return (
                      <span key={p.defId} className="pickup-chip">
                        ★ ピックアップ: {def?.name ?? p.defId}(同レアリティ内 {p.rate}%)
                      </span>
                    );
                  })}
                </div>
              )}
              {banner.pity && (
                <div className="gb-pity">
                  天井: {banner.pity.count}連で{banner.pity.rarity}以上を確定
                  {pityRemain !== null && <> / <b>あと{pityRemain}連</b></>}
                </div>
              )}
              {banner.guarantee10 && (
                <div className="gb-pity muted">10連は{banner.guarantee10}以上を1枠確定保証</div>
              )}
              <RateTable banner={banner} characters={store.master?.characters} />
            </div>

            <div className="gacha-actions">
              <button className="btn btn-primary gacha-pull-btn" disabled={!single.ok || pulling} onClick={() => void startPull(1)}>
                単発召喚
                <small>{currencyLabel(banner.cost, tickets)}</small>
              </button>
              {!single.ok && <div className="afford-reason">{single.reason}</div>}
              <button className="btn btn-primary gacha-pull-btn" disabled={!ten.ok || pulling} onClick={() => void startPull(10)}>
                10連召喚
                <small>{currencyLabel(banner.cost10 ?? { ...banner.cost, amount: banner.cost.amount * 10 }, tickets)}</small>
              </button>
              {!ten.ok && <div className="afford-reason">{ten.reason}</div>}
              {pullErr !== null && (
                <div className="afford-reason" style={{ color: 'var(--danger)' }}>
                  {describeError(pullErr).detail}
                </div>
              )}
            </div>
          </div>
        )}
      </Panel>

      <TicketExchangePanel
        exchanges={exchanges}
        tickets={tickets}
        materialNameOf={materialNameOf}
        onExchange={handleExchange}
      />

      {stage !== 'select' && (
        <div className="gacha-overlay" role="dialog" aria-modal="true" aria-label="召喚結果">
          <div className="gacha-stage">
            {stage === 'charging' && (
              <ChargingStage tierHint={Math.max(...results.map((r) => tierOf(r.rarity)), 0)} skip={!policy.cutIn} />
            )}

            {stage === 'revealing' && revealIndex < results.length && (
              <div className="gacha-reveal-wrap">
                <div className="gacha-reveal-progress">{revealIndex + 1} / {results.length}</div>
                <GachaResultCard
                  key={revealIndex}
                  result={results[revealIndex]!}
                  masterArtOf={masterArtOf}
                  materialNameOf={materialNameOf}
                  big
                />
                <div className="row" style={{ justifyContent: 'center', marginTop: 14, gap: 8 }}>
                  <button className="btn btn-sm btn-ghost" onClick={skipToSummary}>一括表示</button>
                  {results.length > 1 && (
                    <button className="btn btn-sm" onClick={() => setRevealIndex((i) => Math.min(results.length, i + 1))}>
                      次へ ▶
                    </button>
                  )}
                </div>
              </div>
            )}

            {stage === 'summary' && (
              <div className="gacha-summary">
                <div className="section-title" style={{ justifyContent: 'center' }}>SUMMON RESULT<span className="jp">召喚結果</span></div>
                <div className="gacha-summary-grid">
                  {results.map((r, i) => <GachaResultCard key={i} result={r} masterArtOf={masterArtOf} materialNameOf={materialNameOf} />)}
                </div>
                <div className="gacha-summary-foot">
                  {results.some((r) => r.byPity) && <span className="result-pity-tag" style={{ position: 'static' }}>天井到達あり</span>}
                  <button className="btn btn-primary" onClick={closeResult}>閉じる</button>
                  {banner && (
                    <button
                      className="btn"
                      disabled={pulling}
                      onClick={() => { closeResult(); void startPull(results.length === 10 ? 10 : 1); }}
                    >
                      同じ条件でもう一度
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default GachaScreen;

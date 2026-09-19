/**
 * EQUIPMENT: 所持装備の一覧・装着/解除・売却。
 * `GET /api/inventory` / `POST /api/equipment/{equip,unequip,sell}`
 */
import React, { useEffect, useMemo, useState } from 'react';
import type { EquipmentInstance, EquipmentSlot, ItemRarity, CharacterView } from '@akatan/shared';
import { ITEM_RARITIES } from '@akatan/shared';
import { useStore } from '../state/store';
import { Panel, ElementChip, RarityBadge } from '../components/common';
import { CharacterArtView } from '../components/CharacterArt';
import { describeError } from '../api/client';
import { api } from '../api/client';
import {
  ITEM_RARITY_LABEL, ITEM_RARITY_ORDER, EQUIPMENT_SLOT_LABEL, EQUIPMENT_SLOT_ICON,
  STAT_LABEL, formatNumber,
} from '../utils/labels';
import {
  equipmentOf, equippedItemsOf, combinedDelta, formatSigned, statDeltasOf, estimateBulkSell,
} from '../utils/equipment';

const SLOTS: EquipmentSlot[] = ['WEAPON', 'ARMOR', 'ACCESSORY'];
const RARITIES: ItemRarity[] = ['MYTHIC', 'LEGENDARY', 'EPIC', 'RARE', 'UNCOMMON', 'COMMON'];
type SortKey = 'itemLevel' | 'rarity' | 'name' | 'slot';

/** 装備が数百件になっても一覧描画が重くならないよう、一度に描画する件数を制限する */
const PAGE_SIZE = 60;

/** 一括売却の「◯Lv未満のみ」プルダウンの選択肢 */
const BULK_LEVEL_OPTIONS = [10, 20, 30, 40, 60];

function ItemName({ item }: { item: EquipmentInstance }): JSX.Element {
  return (
    <span className="item-name">
      {item.prefixId && <span className="affix">{item.prefixId}</span>}
      <span className="base">{item.name.replace(item.prefixId ?? '', '').replace(item.suffixId ?? '', '')}</span>
      {item.suffixId && <span className="affix">{item.suffixId}</span>}
    </span>
  );
}

function ItemStatsList({ item }: { item: EquipmentInstance }): JSX.Element {
  const flat = Object.entries(item.stats).filter(([, v]) => !!v);
  const pct = Object.entries(item.statsPercent ?? {}).filter(([, v]) => !!v);
  return (
    <div className="item-stats">
      {flat.map(([k, v]) => (
        <span key={k} className="item-stat">{STAT_LABEL[k as keyof typeof STAT_LABEL]} +{formatNumber(v as number)}</span>
      ))}
      {pct.map(([k, v]) => (
        <span key={k} className="item-stat">{STAT_LABEL[k as keyof typeof STAT_LABEL]} +{v}%</span>
      ))}
    </div>
  );
}

/**
 * お気に入りのトグルボタン。ネイティブ<button>を入れ子にできない場所
 * (equip-card自体がクリック領域を持つ場合)向けに、押下イベントを必ず
 * `stopPropagation`/`preventDefault`してカード本体のクリック・売却チェックボックスの
 * トグルへ波及しないようにする。
 */
function FavoriteButton({
  favorite, busy, onToggle, name,
}: { favorite: boolean; busy: boolean; onToggle: () => void; name: string }): JSX.Element {
  return (
    <button
      type="button"
      className={`fav-btn ${favorite ? 'is-on' : ''}`}
      disabled={busy}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      aria-pressed={favorite}
      aria-label={favorite ? `${name} のお気に入りを解除` : `${name} をお気に入りに登録(一括売却・売却から保護)`}
      title={favorite ? 'お気に入り解除' : 'お気に入りに登録(売却から保護)'}
    >
      {favorite ? '★' : '☆'}
    </button>
  );
}

function EquipCard({
  item, selected, onClick, onToggleFavorite, favBusy,
}: {
  item: EquipmentInstance; selected: boolean; onClick: () => void;
  onToggleFavorite: () => void; favBusy: boolean;
}): JSX.Element {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`equip-card irar-${item.rarity} ${selected ? 'is-selected' : ''} ${item.equippedBy ? 'is-equipped' : ''} ${item.favorite ? 'is-favorite' : ''}`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }
      }}
    >
      <div className="equip-card-head">
        <FavoriteButton favorite={!!item.favorite} busy={favBusy} onToggle={onToggleFavorite} name={item.name} />
        <span className="slot-ic" title={EQUIPMENT_SLOT_LABEL[item.slot]}>{EQUIPMENT_SLOT_ICON[item.slot]}</span>
        <span className="irar-tag">{ITEM_RARITY_LABEL[item.rarity]}</span>
        <span className="ilv">Lv{item.itemLevel}</span>
      </div>
      <ItemName item={item} />
      <ItemStatsList item={item} />
      {item.special && <div className="special-tag">{item.special.name}</div>}
      {item.equippedBy && <div className="equipped-tag">装着中</div>}
      {item.favorite && <div className="favorite-tag">★ お気に入り(売却から保護)</div>}
    </div>
  );
}

function CompareRow({ k, before, after }: { k: string; before: number; after: number }): JSX.Element {
  const delta = after - before;
  const cls = delta > 0 ? 'up' : delta < 0 ? 'down' : '';
  return (
    <div className={`compare-row ${cls}`}>
      <span className="k">{STAT_LABEL[k as keyof typeof STAT_LABEL] ?? k}</span>
      <span className="before">{formatNumber(before)}</span>
      <span className="arrow">▶</span>
      <span className="after">{formatNumber(after)}</span>
      <span className="delta">{delta !== 0 ? formatSigned(delta) : ''}</span>
    </div>
  );
}

export function EquipmentScreen(): JSX.Element {
  const store = useStore();
  const [loading, setLoading] = useState(false);
  const [loadErr, setLoadErr] = useState<unknown>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [targetCharUid, setTargetCharUid] = useState<string>(store.route.equipCharUid ?? '');
  const [slotFilter, setSlotFilter] = useState<EquipmentSlot | null>(null);
  const [rarityFilter, setRarityFilter] = useState<ItemRarity | null>(null);
  const [minLevel, setMinLevel] = useState(0);
  const [favOnly, setFavOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>('itemLevel');
  const [sellMode, setSellMode] = useState(false);
  const [sellSet, setSellSet] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<unknown>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [favBusy, setFavBusy] = useState<Set<string>>(new Set());

  // 一覧の表示件数(装備が数百件になっても一気に描画しないためのページング)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // 一括売却(レアリティ一式)
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkMaxRarity, setBulkMaxRarity] = useState<ItemRarity>('LEGENDARY');
  const [bulkBelowLevel, setBulkBelowLevel] = useState<number | ''>('');
  const [bulkConfirming, setBulkConfirming] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkErr, setBulkErr] = useState<unknown>(null);
  const [bulkResult, setBulkResult] = useState<{ count: number; gold: number; skipped: number } | null>(null);

  useEffect(() => {
    if (store.inventory) return;
    setLoading(true);
    store.refreshInventory().catch((e) => setLoadErr(e)).finally(() => setLoading(false));
  }, [store]);

  const inv = store.inventory;

  const list = useMemo(() => {
    const items = inv?.equipment ?? [];
    const filtered = items.filter((it) => {
      if (slotFilter && it.slot !== slotFilter) return false;
      if (rarityFilter && it.rarity !== rarityFilter) return false;
      if (it.itemLevel < minLevel) return false;
      if (favOnly && !it.favorite) return false;
      return true;
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'rarity': return ITEM_RARITY_ORDER[b.rarity] - ITEM_RARITY_ORDER[a.rarity];
        case 'name': return a.name.localeCompare(b.name, 'ja');
        case 'slot': return a.slot.localeCompare(b.slot);
        default: return b.itemLevel - a.itemLevel;
      }
    });
    return sorted;
  }, [inv, slotFilter, rarityFilter, minLevel, favOnly, sort]);

  // フィルタ/並び替えが変わったら表示件数をリセットする(「もっと見る」の積み上げが
  // 別の絞り込み結果に引き継がれて大量描画になるのを防ぐ)
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [slotFilter, rarityFilter, minLevel, favOnly, sort, sellMode]);

  const visibleList = useMemo(() => list.slice(0, visibleCount), [list, visibleCount]);
  const hasMore = list.length > visibleList.length;

  const bulkPreview = useMemo(
    () => estimateBulkSell(inv?.equipment ?? [], bulkMaxRarity, bulkBelowLevel === '' ? undefined : bulkBelowLevel),
    [inv, bulkMaxRarity, bulkBelowLevel],
  );

  const selected = useMemo(() => (selectedUid ? equipmentOf(inv, selectedUid) : undefined), [inv, selectedUid]);

  const targetView = useMemo(
    () => store.characters.find((c) => c.owned.uid === targetCharUid),
    [store.characters, targetCharUid],
  );
  const prevItemInSlot = useMemo(() => {
    if (!selected || !targetView) return undefined;
    const uid = targetView.owned.equipment?.[selected.slot];
    return uid ? equipmentOf(inv, uid) : undefined;
  }, [selected, targetView, inv]);

  const doEquip = async () => {
    if (!selected || !targetView) return;
    setBusy(true);
    setActionErr(null);
    setActionMsg(null);
    try {
      const res = await api().equip(selected.uid, targetView.owned.uid);
      store.applyCharacterView(res.character);
      store.applyInventory(res.inventory);
      setActionMsg(`${targetView.def.name} に ${selected.name} を装着しました。`);
    } catch (e) {
      setActionErr(e);
    } finally {
      setBusy(false);
    }
  };

  const doUnequip = async (view: CharacterView, slot: EquipmentSlot) => {
    setBusy(true);
    setActionErr(null);
    setActionMsg(null);
    try {
      const res = await api().unequip(view.owned.uid, slot);
      store.applyCharacterView(res.character);
      store.applyInventory(res.inventory);
      setActionMsg(`${view.def.name} の${EQUIPMENT_SLOT_LABEL[slot]}を外しました。`);
    } catch (e) {
      setActionErr(e);
    } finally {
      setBusy(false);
    }
  };

  const toggleSell = (uid: string) => {
    setSellSet((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const doSell = async () => {
    if (sellSet.size === 0) return;
    setBusy(true);
    setActionErr(null);
    setActionMsg(null);
    try {
      const res = await api().sellEquipment([...sellSet]);
      store.applyPlayer(res.player);
      store.applyInventory(res.inventory);
      setActionMsg(`装備を売却し、${formatNumber(res.gold)} GOLD を入手しました。`);
      setSellSet(new Set());
      setSellMode(false);
      if (selectedUid && sellSet.has(selectedUid)) setSelectedUid(null);
    } catch (e) {
      setActionErr(e);
    } finally {
      setBusy(false);
    }
  };

  /**
   * お気に入りの登録/解除。売却で誤って失わないための保険機能なので、
   * サーバ応答をそのまま反映して確実に整合させる(楽観更新はしない)。
   */
  const toggleFavorite = async (item: EquipmentInstance) => {
    if (favBusy.has(item.uid)) return;
    setFavBusy((prev) => new Set(prev).add(item.uid));
    setActionErr(null);
    try {
      const res = await api().favoriteEquipment([item.uid], !item.favorite);
      store.applyInventory(res.inventory);
    } catch (e) {
      setActionErr(e);
    } finally {
      setFavBusy((prev) => {
        const next = new Set(prev);
        next.delete(item.uid);
        return next;
      });
    }
  };

  /**
   * レアリティ一式の一括売却(第6ラウンド)。装備が余りすぎてラグの原因になるのを
   * 防ぐための整理機能。取り返しがつかない操作なので、必ず対象件数・獲得予定GOLD・
   * 除外件数(装着中/お気に入り)を見せてから、明示的な確認クリックを挟んで実行する。
   */
  const doBulkSell = async () => {
    setBulkBusy(true);
    setBulkErr(null);
    try {
      const res = await api().sellEquipmentBulk(bulkMaxRarity, bulkBelowLevel === '' ? undefined : bulkBelowLevel);
      store.applyPlayer(res.player);
      store.applyInventory(res.inventory);
      setBulkResult({ count: res.count, gold: res.gold, skipped: res.skipped });
      setBulkConfirming(false);
    } catch (e) {
      setBulkErr(e);
    } finally {
      setBulkBusy(false);
    }
  };

  if (loading) {
    return <div className="state-box"><div className="spinner" /><div className="muted">所持装備を取得しています…</div></div>;
  }
  if (loadErr) {
    return (
      <div className="error-box">
        <h3>{describeError(loadErr).title}</h3>
        <div className="muted">{describeError(loadErr).detail}</div>
        <button className="btn btn-primary" onClick={() => { setLoadErr(null); setLoading(true); store.refreshInventory().catch(setLoadErr).finally(() => setLoading(false)); }}>
          再試行する
        </button>
      </div>
    );
  }

  const eligibleTargets = selected ? store.characters : [];

  return (
    <div className="stack">
      <Panel
        title="EQUIPMENT"
        jp={`所持装備 ${inv?.equipment.length ?? 0}件 — スロット/レアリティ/アイテムレベル/お気に入りで絞り込み`}
        right={
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="並び替え">
              <option value="itemLevel">アイテムLv順</option>
              <option value="rarity">レアリティ順</option>
              <option value="slot">スロット順</option>
              <option value="name">名前順</option>
            </select>
            <button
              className={`btn btn-sm ${bulkOpen ? 'btn-danger' : 'btn-ghost'}`}
              onClick={() => { setBulkOpen((v) => !v); setBulkConfirming(false); setBulkErr(null); }}
            >
              {bulkOpen ? '一括売却を閉じる' : 'レアリティで一括売却'}
            </button>
            <button
              className={`btn btn-sm ${sellMode ? 'btn-danger' : 'btn-ghost'}`}
              onClick={() => { setSellMode((v) => !v); setSellSet(new Set()); }}
            >
              {sellMode ? '売却選択を終了' : '選択して売却'}
            </button>
          </div>
        }
      >
        <div className="filter-bar">
          <button className={`chip-toggle ${slotFilter === null ? 'is-on' : ''}`} onClick={() => setSlotFilter(null)}>全スロット</button>
          {SLOTS.map((s) => (
            <button key={s} className={`chip-toggle ${slotFilter === s ? 'is-on' : ''}`} onClick={() => setSlotFilter(slotFilter === s ? null : s)}>
              {EQUIPMENT_SLOT_LABEL[s]}
            </button>
          ))}
          <span style={{ width: 12 }} />
          <select value={minLevel} onChange={(e) => setMinLevel(Number(e.target.value))} aria-label="アイテムレベルで絞り込み">
            <option value={0}>Lv すべて</option>
            <option value={10}>Lv10 以上</option>
            <option value={20}>Lv20 以上</option>
            <option value={30}>Lv30 以上</option>
            <option value={40}>Lv40 以上</option>
          </select>
          <span style={{ width: 12 }} />
          <button
            type="button"
            className={`chip-toggle fav-chip ${favOnly ? 'is-on' : ''}`}
            onClick={() => setFavOnly((v) => !v)}
            aria-pressed={favOnly}
          >
            ★ お気に入りのみ
          </button>
        </div>
        <div className="filter-bar">
          <button className={`chip-toggle ${rarityFilter === null ? 'is-on' : ''}`} onClick={() => setRarityFilter(null)}>全レアリティ</button>
          {RARITIES.map((r) => (
            <button
              key={r}
              className={`chip-toggle ${rarityFilter === r ? 'is-on' : ''}`}
              style={{ ['--chip-color' as string]: `var(--irar-${r})` }}
              onClick={() => setRarityFilter(rarityFilter === r ? null : r)}
            >
              {ITEM_RARITY_LABEL[r]}
            </button>
          ))}
        </div>

        {bulkOpen && (
          <div className="bulk-sell-panel">
            <div className="bulk-sell-title">
              レアリティ一式の一括売却
              <span className="jp">装着中・お気に入りの装備は必ず除外されます</span>
            </div>
            <div className="bulk-sell-row">
              <label className="bulk-sell-field">
                <span className="k">対象レアリティ</span>
                <select
                  value={bulkMaxRarity}
                  onChange={(e) => { setBulkMaxRarity(e.target.value as ItemRarity); setBulkConfirming(false); setBulkErr(null); }}
                >
                  {ITEM_RARITIES.map((r) => (
                    <option key={r} value={r}>{ITEM_RARITY_LABEL[r]}以下をまとめて売却</option>
                  ))}
                </select>
              </label>
              <label className="bulk-sell-field">
                <span className="k">アイテムLv条件</span>
                <select
                  value={bulkBelowLevel}
                  onChange={(e) => {
                    const v = e.target.value;
                    setBulkBelowLevel(v === '' ? '' : Number(v));
                    setBulkConfirming(false);
                    setBulkErr(null);
                  }}
                >
                  <option value="">指定なし(レアリティのみで判定)</option>
                  {BULK_LEVEL_OPTIONS.map((lv) => (
                    <option key={lv} value={lv}>Lv{lv} 未満のみ</option>
                  ))}
                </select>
              </label>
            </div>

            {bulkErr !== null && (
              <div className="error-box" style={{ marginTop: 8 }}>
                <h3>{describeError(bulkErr).title}</h3>
                <div className="muted">{describeError(bulkErr).detail}</div>
              </div>
            )}

            {!bulkConfirming ? (
              <button
                type="button"
                className="btn btn-sm btn-danger"
                disabled={bulkBusy}
                onClick={() => { setBulkErr(null); setBulkConfirming(true); }}
              >
                対象を確認する
              </button>
            ) : (
              <div className="bulk-sell-confirm">
                <div className="bulk-sell-confirm-text">
                  <b>{ITEM_RARITY_LABEL[bulkMaxRarity]}以下</b>
                  {bulkBelowLevel !== '' && <>・<b>Lv{bulkBelowLevel}未満</b></>}
                  の装備のうち、
                  <b className="num">{bulkPreview.toSell.length}件</b> を売却して
                  <b className="num gold">{formatNumber(bulkPreview.gold)} GOLD</b> を獲得します。
                  {bulkPreview.skipped > 0 && (
                    <> 装着中・お気に入りの <b className="num">{bulkPreview.skipped}件</b> は売却されず保護されます。</>
                  )}
                  {bulkPreview.toSell.length === 0 && (
                    <div className="muted" style={{ marginTop: 4 }}>該当する売却対象がありません。</div>
                  )}
                </div>
                <div className="row" style={{ gap: 8, marginTop: 8 }}>
                  <button type="button" className="btn btn-sm btn-ghost" disabled={bulkBusy} onClick={() => setBulkConfirming(false)}>
                    キャンセル
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-danger"
                    disabled={bulkBusy || bulkPreview.toSell.length === 0}
                    onClick={() => void doBulkSell()}
                  >
                    {bulkBusy ? '処理中…' : `本当に売却する (${bulkPreview.toSell.length}件)`}
                  </button>
                </div>
              </div>
            )}

            {bulkResult && (
              <div className="muted" style={{ color: 'var(--ok)', fontSize: 12, marginTop: 8 }}>
                一括売却が完了しました: {bulkResult.count}件を売却して {formatNumber(bulkResult.gold)} GOLD を入手
                (装着中・お気に入りの {bulkResult.skipped}件 は保護されました)。
              </div>
            )}
          </div>
        )}

        {sellMode && (
          <div className="sell-bar">
            <span className="muted" style={{ fontSize: 12 }}>
              売却する装備を選択してください(装着中・お気に入りの装備は選択できません)。選択中: {sellSet.size}件
            </span>
            <button className="btn btn-sm btn-primary" disabled={sellSet.size === 0 || busy} onClick={() => void doSell()}>
              {busy ? '処理中…' : `売却する (${sellSet.size}件)`}
            </button>
          </div>
        )}
        {actionMsg && <div className="muted" style={{ color: 'var(--ok)', fontSize: 12, marginBottom: 8 }}>{actionMsg}</div>}
        {actionErr !== null && (
          <div className="error-box" style={{ marginBottom: 10 }}>
            <h3>{describeError(actionErr).title}</h3>
            <div className="muted">{describeError(actionErr).detail}</div>
          </div>
        )}

        {list.length === 0 ? (
          <div className="muted" style={{ padding: 24, textAlign: 'center' }}>条件に合う装備がありません。</div>
        ) : (
          <div className="equip-grid">
            {visibleList.map((it) => (
              sellMode ? (
                <label
                  key={it.uid}
                  className={`equip-card irar-${it.rarity} ${it.equippedBy || it.favorite ? 'is-equipped is-disabled' : ''} ${sellSet.has(it.uid) ? 'is-selected' : ''} ${it.favorite ? 'is-favorite' : ''}`}
                >
                  <input
                    type="checkbox"
                    style={{ position: 'absolute', top: 8, right: 8 }}
                    disabled={!!it.equippedBy || !!it.favorite}
                    checked={sellSet.has(it.uid)}
                    onChange={() => toggleSell(it.uid)}
                    aria-label={`${it.name} を売却選択`}
                  />
                  <div className="equip-card-head">
                    <FavoriteButton
                      favorite={!!it.favorite}
                      busy={favBusy.has(it.uid)}
                      onToggle={() => void toggleFavorite(it)}
                      name={it.name}
                    />
                    <span className="slot-ic">{EQUIPMENT_SLOT_ICON[it.slot]}</span>
                    <span className="irar-tag">{ITEM_RARITY_LABEL[it.rarity]}</span>
                    <span className="ilv">Lv{it.itemLevel}</span>
                  </div>
                  <ItemName item={it} />
                  <ItemStatsList item={it} />
                  {it.equippedBy && <div className="equipped-tag">装着中(売却不可)</div>}
                  {!it.equippedBy && it.favorite && <div className="favorite-tag">★ お気に入り(売却不可)</div>}
                </label>
              ) : (
                <EquipCard
                  key={it.uid}
                  item={it}
                  selected={selectedUid === it.uid}
                  onClick={() => setSelectedUid(selectedUid === it.uid ? null : it.uid)}
                  onToggleFavorite={() => void toggleFavorite(it)}
                  favBusy={favBusy.has(it.uid)}
                />
              )
            ))}
          </div>
        )}
        {hasMore && (
          <div className="load-more-row">
            <button type="button" className="btn btn-ghost" onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}>
              もっと見る(残り {list.length - visibleList.length}件 / 全{list.length}件)
            </button>
          </div>
        )}
      </Panel>

      {selected && !sellMode && (
        <Panel title="DETAIL" jp="装備の詳細 / 装着プレビュー" right={<button className="btn btn-sm btn-ghost" onClick={() => setSelectedUid(null)}>閉じる</button>}>
          <div className="equip-detail-grid">
            <div className={`equip-detail-card irar-${selected.rarity}`}>
              <div className="equip-card-head">
                <span className="slot-ic">{EQUIPMENT_SLOT_ICON[selected.slot]}</span>
                <span className="irar-tag">{ITEM_RARITY_LABEL[selected.rarity]}</span>
                <span className="ilv">アイテムLv {selected.itemLevel}</span>
              </div>
              <div style={{ fontSize: 17, fontWeight: 800, marginTop: 6 }}><ItemName item={selected} /></div>
              <div className="muted" style={{ fontSize: 11, marginTop: 2 }}>{EQUIPMENT_SLOT_LABEL[selected.slot]}</div>
              <ItemStatsList item={selected} />
              {selected.special ? (
                <div className="special-box">
                  <div className="t">{selected.special.name}</div>
                  <div className="d">{selected.special.description}</div>
                </div>
              ) : (
                <div className="muted" style={{ fontSize: 11, marginTop: 8 }}>特殊効果なし</div>
              )}
              {selected.equippedBy && (
                <div className="equipped-tag" style={{ marginTop: 10 }}>
                  装着中: {store.characters.find((c) => c.owned.uid === selected.equippedBy)?.def.name ?? selected.equippedBy}
                </div>
              )}
            </div>

            <div className="stack" style={{ gap: 10 }}>
              <div>
                <div className="label" style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>装着させるキャラクター</div>
                <select value={targetCharUid} onChange={(e) => setTargetCharUid(e.target.value)} style={{ width: '100%' }} aria-label="装着先キャラクター">
                  <option value="">選択してください</option>
                  {eligibleTargets.map((c) => (
                    <option key={c.owned.uid} value={c.owned.uid}>
                      {c.def.name}(Lv{c.owned.level}){c.owned.equipment?.[selected.slot] === selected.uid ? ' ・装着中' : ''}
                    </option>
                  ))}
                </select>
              </div>

              {targetView && (
                <div className="compare-box">
                  <div className="section-title" style={{ marginBottom: 8 }}>
                    装着前後の変化<span className="jp">{targetView.def.name}</span>
                  </div>
                  {prevItemInSlot && prevItemInSlot.uid !== selected.uid && (
                    <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
                      既存の{EQUIPMENT_SLOT_LABEL[selected.slot]}「{prevItemInSlot.name}」と入れ替わります。
                    </div>
                  )}
                  {selected.equippedBy === targetView.owned.uid ? (
                    <div className="muted" style={{ fontSize: 12 }}>このキャラクターはすでにこの装備を装着しています。</div>
                  ) : (
                    <>
                      {[...combinedDelta(targetView.stats, selected, prevItemInSlot?.uid === selected.uid ? undefined : prevItemInSlot).entries()]
                        .filter(([, v]) => Math.abs(v) > 0.001)
                        .map(([k, v]) => (
                          <CompareRow key={k} k={k} before={targetView.stats[k] ?? 0} after={(targetView.stats[k] ?? 0) + v} />
                        ))}
                      {combinedDelta(targetView.stats, selected, prevItemInSlot).size === 0 && statDeltasOf(selected, targetView.stats).length === 0 && (
                        <div className="muted" style={{ fontSize: 12 }}>この装備には数値ステータスの変化はありません。</div>
                      )}
                      <button className="btn btn-primary" style={{ marginTop: 10 }} disabled={busy} onClick={() => void doEquip()}>
                        {busy ? '装着中…' : `${targetView.def.name} に装着する`}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </Panel>
      )}

      <Panel title="EQUIPPED" jp="キャラクター別の装着状況">
        <div className="stack" style={{ gap: 8 }}>
          {store.characters.map((c) => {
            const items = equippedItemsOf(c, inv);
            if (items.length === 0) return null;
            return (
              <div key={c.owned.uid} className="equipped-row">
                <div className="equipped-row-char">
                  <CharacterArtView art={c.def.art} name={c.def.name} element={c.def.element} rarity={c.def.rarity} ratio="square" sigilScale={0.6} hideBadges />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 12.5 }}>{c.def.name}</div>
                    <ElementChip element={c.def.element} />
                    <RarityBadge rarity={c.def.rarity} />
                  </div>
                </div>
                <div className="equipped-row-items">
                  {SLOTS.map((s) => {
                    const uid = c.owned.equipment?.[s];
                    const item = uid ? equipmentOf(inv, uid) : undefined;
                    return (
                      <div key={s} className={`equipped-slot ${item ? `irar-${item.rarity}` : 'is-empty'}`}>
                        <span className="slot-ic">{EQUIPMENT_SLOT_ICON[s]}</span>
                        {item ? (
                          <>
                            <span className="nm">{item.name}</span>
                            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => void doUnequip(c, s)}>外す</button>
                          </>
                        ) : (
                          <span className="muted">未装着</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {store.characters.every((c) => equippedItemsOf(c, inv).length === 0) && (
            <div className="muted" style={{ fontSize: 12 }}>まだ誰も装備を装着していません。上の一覧から装備を選んで装着しましょう。</div>
          )}
        </div>
      </Panel>
    </div>
  );
}

export default EquipmentScreen;

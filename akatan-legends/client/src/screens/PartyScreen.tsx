/**
 * PARTY: 5枠の編成。
 * ドラッグ&ドロップ対応 + タッチ非対応環境向けのクリック選択フォールバック。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { CharacterDef, CharacterView, Element, Role } from '@akatan/shared';
import { useStore } from '../state/store';
import { CharacterCard, Panel, ElementChip, RarityBadge } from '../components/common';
import { CharacterArtView } from '../components/CharacterArt';
import {
  ELEMENT_LABEL, ROLE_FULL, COMBO_KIND_LABEL, statPower, formatNumber,
} from '../utils/labels';
import { combosOf, evaluateCombos, buildPlannedMap, comboMemberName } from '../utils/combo';

const PARTY_SIZE = 5;

export function PartyScreen(): JSX.Element {
  const store = useStore();
  const [members, setMembers] = useState<(string | null)[]>(
    () => normalize(store.party?.members ?? []),
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [overSlot, setOverSlot] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  useEffect(() => {
    setMembers(normalize(store.party?.members ?? []));
  }, [store.party]);

  const byUid = useMemo(() => {
    const m = new Map<string, CharacterView>();
    for (const c of store.characters) m.set(c.owned.uid, c);
    return m;
  }, [store.characters]);

  const dirty = useMemo(
    () => JSON.stringify(members) !== JSON.stringify(normalize(store.party?.members ?? [])),
    [members, store.party],
  );

  const place = useCallback((uid: string, slot: number) => {
    setMembers((prev) => {
      const next = [...prev];
      const from = next.indexOf(uid);
      const occupant = next[slot] ?? null;
      next[slot] = uid;
      if (from >= 0 && from !== slot) next[from] = occupant;
      return next;
    });
    setSelected(null);
  }, []);

  const removeAt = useCallback((slot: number) => {
    setMembers((prev) => {
      const next = [...prev];
      next[slot] = null;
      return next;
    });
  }, []);

  const onSlotClick = (slot: number) => {
    if (selected) {
      place(selected, slot);
      return;
    }
    const cur = members[slot];
    if (cur) setSelected(cur);
  };

  const save = async () => {
    setSaving(true);
    setSaveErr(null);
    setSaveMsg(null);
    try {
      await store.saveParty(members);
      setSaveMsg('編成を保存しました');
      window.setTimeout(() => setSaveMsg(null), 2600);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const chosen = members
    .map((uid) => (uid ? byUid.get(uid) : undefined))
    .filter((c): c is CharacterView => !!c);

  const totalPower = chosen.reduce((n, c) => n + statPower(c.stats), 0);

  const elementCount = new Map<Element, number>();
  const roleCount = new Map<Role, number>();
  for (const c of chosen) {
    elementCount.set(c.def.element, (elementCount.get(c.def.element) ?? 0) + 1);
    for (const r of c.def.roles) roleCount.set(r, (roleCount.get(r) ?? 0) + 1);
  }

  // P0-4(a): 発動コンボ欄。編成のdefIdをコンボ定義に照らして成立/惜しいを判定する。
  const charDefById = useMemo(() => {
    const m = new Map<string, CharacterDef>();
    for (const d of store.master?.characters ?? []) m.set(d.id, d);
    return m;
  }, [store.master]);
  const comboDefs = combosOf(store.master);
  const partyDefIds = chosen.map((c) => c.def.id);
  const plannedById = useMemo(() => buildPlannedMap(store.master), [store.master]);
  const comboMatches = evaluateCombos(comboDefs, partyDefIds, charDefById, plannedById);

  return (
    <div className="stack">
      <Panel
        title="PARTY"
        jp="5枠の編成 — ドラッグ&ドロップ、またはクリックで選択→枠をクリック"
        right={
          <div className="row" style={{ gap: 8 }}>
            {saveMsg && <span style={{ color: 'var(--ok)', fontSize: 11 }}>{saveMsg}</span>}
            {saveErr && <span style={{ color: 'var(--danger)', fontSize: 11 }}>保存失敗: {saveErr}</span>}
            <button className="btn btn-sm btn-ghost" onClick={() => setMembers(normalize(store.party?.members ?? []))} disabled={!dirty || saving}>
              元に戻す
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => void save()} disabled={!dirty || saving}>
              {saving ? '保存中…' : '編成を保存'}
            </button>
          </div>
        }
      >
        <div className="party-slots">
          {Array.from({ length: PARTY_SIZE }, (_, i) => {
            const uid = members[i] ?? null;
            const c = uid ? byUid.get(uid) : undefined;
            return (
              <div
                key={i}
                className={[
                  'party-slot',
                  overSlot === i ? 'is-over' : '',
                  selected ? 'is-target' : '',
                ].filter(Boolean).join(' ')}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOverSlot(i);
                }}
                onDragLeave={() => setOverSlot((s) => (s === i ? null : s))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOverSlot(null);
                  const id = e.dataTransfer.getData('text/plain');
                  if (id) place(id, i);
                }}
                onClick={() => onSlotClick(i)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSlotClick(i);
                  }
                }}
                aria-label={`編成枠 ${i + 1}: ${c ? c.def.name : '空き'}`}
              >
                <div className="slot-head">
                  <span className="slot-no">SLOT {i + 1}</span>
                  {c && (
                    <span className="slot-head-right">
                      <ElementChip element={c.def.element} />
                      <RarityBadge rarity={c.def.rarity} />
                      <button
                        className="remove"
                        onClick={(e) => { e.stopPropagation(); removeAt(i); }}
                        aria-label={`${c.def.name} を編成から外す`}
                      >
                        ×
                      </button>
                    </span>
                  )}
                </div>
                {c ? (
                  <div
                    className="slot-body"
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('text/plain', c.owned.uid)}
                  >
                    <CharacterArtView
                      art={c.def.art}
                      name={c.def.name}
                      element={c.def.element}
                      rarity={c.def.rarity}
                      ratio="square"
                      sigilScale={0.9}
                      hideBadges
                    />
                    <div style={{ padding: '5px 6px 7px' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.def.name}
                      </div>
                      <div className="muted" style={{ fontSize: 10 }}>
                        Lv{c.owned.level} / 戦力{formatNumber(statPower(c.stats))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <span className="empty-label">{selected ? 'ここに配置' : '空き枠'}</span>
                )}
              </div>
            );
          })}
        </div>

        <div className="home-grid" style={{ marginTop: 14 }}>
          <div className="panel" style={{ padding: 13 }}>
            <div className="section-title" style={{ marginBottom: 9 }}>構成<span className="jp">属性 / ロール</span></div>
            <div className="comp-bars">
              {[...elementCount.entries()].map(([e, n]) => (
                <div className="comp-line" key={e}>
                  <ElementChip element={e} />
                  <span style={{ width: 34 }}>{ELEMENT_LABEL[e]}</span>
                  <span className="bar"><span style={{ width: `${(n / PARTY_SIZE) * 100}%`, background: `var(--el-${e})` }} /></span>
                  <span className="tabular">{n}</span>
                </div>
              ))}
              {elementCount.size === 0 && <div className="muted" style={{ fontSize: 12 }}>キャラを配置してください。</div>}
            </div>
            <div className="comp-bars" style={{ marginTop: 10 }}>
              {[...roleCount.entries()].map(([r, n]) => (
                <div className="comp-line" key={r}>
                  <span style={{ width: 92 }}>{ROLE_FULL[r]}</span>
                  <span className="bar"><span style={{ width: `${(n / PARTY_SIZE) * 100}%` }} /></span>
                  <span className="tabular">{n}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="panel" style={{ padding: 13, display: 'grid', placeContent: 'center', textAlign: 'center' }}>
            <div className="muted" style={{ fontSize: 10, letterSpacing: '0.3em' }}>TOTAL POWER</div>
            <div style={{ fontSize: 40, fontWeight: 900, color: 'var(--gold)' }} className="tabular">
              {formatNumber(totalPower)}
            </div>
            <div className="muted" style={{ fontSize: 11 }}>
              編成 {chosen.length} / {PARTY_SIZE} 人
            </div>
          </div>
        </div>
      </Panel>

      <Panel
        title="COMBO"
        jp="発動コンボ — 誰と組ませるかで戦況が変わる (設計書§13/§40)"
      >
        {comboDefs.length === 0 ? (
          <div className="muted" style={{ fontSize: 12 }}>
            コンボデータを準備中です。まだ表示できるコンボがありません。
          </div>
        ) : comboMatches.length === 0 ? (
          <div className="muted" style={{ fontSize: 12 }}>
            現在の編成では発動するコンボがありません。組み合わせを変えて研究してみましょう。
          </div>
        ) : (
          <div className="combo-grid">
            {comboMatches.map((m) => (
              <div key={m.def.id} className={`combo-card is-${m.state}`}>
                <div className="combo-card-head">
                  <span className="combo-kind">{COMBO_KIND_LABEL[m.def.kind]}</span>
                  <span className={`combo-tag ${m.state}`}>
                    {m.state === 'active' ? '発動中' : 'もう少し'}
                  </span>
                </div>
                <div className="combo-name">{m.def.name}</div>
                <div className="combo-desc muted">{m.def.description}</div>
                {m.state === 'active' ? (
                  <div className="combo-members">
                    {m.memberDefIds.map((id) => (
                      <span key={id} className="combo-member">{charDefById.get(id)?.name ?? id}</span>
                    ))}
                  </div>
                ) : (
                  <div className="combo-missing">{m.missingNote}</div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="OWNED"
        jp={selected ? '配置先の枠をクリックしてください' : 'カードをドラッグ、またはクリックして選択'}
        right={selected && <button className="btn btn-sm btn-ghost" onClick={() => setSelected(null)}>選択解除</button>}
      >
        <div className="grid-auto">
          {store.characters.map((c) => (
            <CharacterCard
              key={c.owned.uid}
              view={c}
              selected={selected === c.owned.uid}
              dimmed={members.includes(c.owned.uid)}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/plain', c.owned.uid)}
              onClick={() => setSelected(selected === c.owned.uid ? null : c.owned.uid)}
            />
          ))}
        </div>
      </Panel>
    </div>
  );
}

function normalize(members: (string | null)[]): (string | null)[] {
  const out: (string | null)[] = [];
  for (let i = 0; i < PARTY_SIZE; i++) out.push(members[i] ?? null);
  return out;
}

export default PartyScreen;

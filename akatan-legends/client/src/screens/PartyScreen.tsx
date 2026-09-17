/**
 * PARTY: 5枠の編成。
 * ドラッグ&ドロップ対応 + タッチ非対応環境向けのクリック選択フォールバック。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { CharacterView, Element, Role } from '@akatan/shared';
import { useStore } from '../state/store';
import { CharacterCard, Panel, ElementChip } from '../components/common';
import { CharacterArtView } from '../components/CharacterArt';
import {
  ELEMENT_LABEL, ROLE_FULL, statPower, formatNumber,
} from '../utils/labels';

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
                <span className="slot-no">SLOT {i + 1}</span>
                {c ? (
                  <>
                    <button
                      className="remove"
                      onClick={(e) => { e.stopPropagation(); removeAt(i); }}
                      aria-label={`${c.def.name} を編成から外す`}
                    >
                      ×
                    </button>
                    <div
                      style={{ width: '100%' }}
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
                  </>
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

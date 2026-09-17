/** COLLECTION: 図鑑。未入手はシルエット表示。 */
import React, { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { Panel, ElementChip, RoleChips } from '../components/common';
import { CharacterArtView } from '../components/CharacterArt';
import { RARITY_ORDER, ELEMENT_LABEL, formatNumber } from '../utils/labels';

type Tab = 'CHARACTERS' | 'ENEMIES';

export function CollectionScreen(): JSX.Element {
  const store = useStore();
  const [tab, setTab] = useState<Tab>('CHARACTERS');

  const ownedDefIds = useMemo(
    () => new Set(store.characters.map((c) => c.def.id)),
    [store.characters],
  );

  const chars = useMemo(() => {
    const list = [...(store.master?.characters ?? [])];
    list.sort((a, b) => RARITY_ORDER[b.rarity] - RARITY_ORDER[a.rarity] || a.name.localeCompare(b.name, 'ja'));
    return list;
  }, [store.master]);

  const enemies = store.master?.enemies ?? [];
  const ownedCount = chars.filter((c) => ownedDefIds.has(c.id)).length;

  if (!store.master) {
    return (
      <Panel title="COLLECTION" jp="図鑑">
        <div className="muted" style={{ padding: 20, textAlign: 'center' }}>
          マスターデータを取得できませんでした。
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      title="COLLECTION"
      jp={tab === 'CHARACTERS' ? `キャラ ${ownedCount} / ${chars.length}` : `敵 ${enemies.length}種`}
      right={
        <div className="seg">
          <button className={tab === 'CHARACTERS' ? 'is-on' : ''} onClick={() => setTab('CHARACTERS')}>キャラ</button>
          <button className={tab === 'ENEMIES' ? 'is-on' : ''} onClick={() => setTab('ENEMIES')}>敵</button>
        </div>
      }
    >
      {tab === 'CHARACTERS' ? (
        <div className="grid-auto">
          {chars.map((def) => {
            const owned = ownedDefIds.has(def.id);
            return (
              <div key={def.id} className={`char-card rar-${def.rarity}`} style={{ cursor: 'default' }}>
                <CharacterArtView
                  art={def.art}
                  name={def.name}
                  element={def.element}
                  rarity={def.rarity}
                  silhouette={!owned}
                  ratio="portrait"
                />
                <div className="char-card-body">
                  <div className="char-card-name">{owned ? def.name : '???'}</div>
                  <div className="char-card-meta">
                    {owned ? (
                      <>
                        <ElementChip element={def.element} />
                        <RoleChips roles={def.roles} />
                      </>
                    ) : (
                      <span className="muted">未入手</span>
                    )}
                  </div>
                  {owned && (
                    <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.4, maxHeight: 44, overflow: 'hidden' }}>
                      {def.description}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid-auto">
          {enemies.map((e) => (
            <div key={e.id} className={`char-card ${e.boss ? 'rar-SSR' : 'rar-R'}`} style={{ cursor: 'default' }}>
              <CharacterArtView
                art={e.art}
                name={e.name}
                element={e.element}
                ratio="portrait"
              />
              <div className="char-card-body">
                <div className="char-card-name">
                  {e.name}
                  {e.boss && <span className="tag" style={{ color: 'var(--shu)', marginLeft: 6 }}>BOSS</span>}
                </div>
                <div className="char-card-meta">
                  <ElementChip element={e.element} />
                  <RoleChips roles={e.roles} />
                  <span style={{ marginLeft: 'auto' }}>{ELEMENT_LABEL[e.element]}</span>
                </div>
                <div className="muted" style={{ fontSize: 10.5 }}>
                  基礎HP {formatNumber(e.baseStats.hp)} / ATK {formatNumber(e.baseStats.attack)}
                </div>
                {e.description && (
                  <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.4 }}>{e.description}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export default CollectionScreen;

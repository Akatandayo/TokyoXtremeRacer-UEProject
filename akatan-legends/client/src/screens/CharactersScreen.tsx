/** CHARACTERS: 所持キャラのカードグリッド */
import React, { useMemo, useState } from 'react';
import type { Element, Role, Rarity } from '@akatan/shared';
import { useStore } from '../state/store';
import { CharacterCard, Panel } from '../components/common';
import {
  ELEMENT_LABEL, ROLE_FULL, RARITY_ORDER, statPower, formatNumber,
} from '../utils/labels';

const ELEMENTS: Element[] = ['FIRE', 'WATER', 'EARTH', 'WIND', 'LIGHT', 'DARK', 'VOID'];
const ROLES: Role[] = ['TANK', 'ATTACKER', 'SUPPORT', 'HEALER', 'CONTROL', 'SPECIALIST'];
const RARITIES: Rarity[] = ['UR', 'SSR', 'SR', 'R', 'N'];

type SortKey = 'power' | 'level' | 'rarity' | 'name';

export function CharactersScreen(): JSX.Element {
  const store = useStore();
  const [el, setEl] = useState<Element | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [rar, setRar] = useState<Rarity | null>(null);
  const [sort, setSort] = useState<SortKey>('power');

  const list = useMemo(() => {
    const filtered = store.characters.filter((c) => {
      if (el && c.def.element !== el) return false;
      if (role && !c.def.roles.includes(role)) return false;
      if (rar && c.def.rarity !== rar) return false;
      return true;
    });
    const sorted = [...filtered];
    sorted.sort((a, b) => {
      switch (sort) {
        case 'level': return b.owned.level - a.owned.level;
        case 'rarity': return RARITY_ORDER[b.def.rarity] - RARITY_ORDER[a.def.rarity];
        case 'name': return a.def.name.localeCompare(b.def.name, 'ja');
        default: return statPower(b.stats) - statPower(a.stats);
      }
    });
    return sorted;
  }, [store.characters, el, role, rar, sort]);

  const totalPower = useMemo(
    () => store.characters.reduce((n, c) => n + statPower(c.stats), 0),
    [store.characters],
  );

  return (
    <Panel
      title="CHARACTERS"
      jp={`所持 ${store.characters.length}人 / 総戦力 ${formatNumber(totalPower)}`}
      right={
        <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} aria-label="並び替え">
          <option value="power">戦力順</option>
          <option value="level">レベル順</option>
          <option value="rarity">レアリティ順</option>
          <option value="name">名前順</option>
        </select>
      }
    >
      <div className="filter-bar">
        <button className={`chip-toggle ${el === null ? 'is-on' : ''}`} onClick={() => setEl(null)}>全属性</button>
        {ELEMENTS.map((e) => (
          <button
            key={e}
            className={`chip-toggle ${el === e ? 'is-on' : ''}`}
            style={{ ['--chip-color' as string]: `var(--el-${e})` }}
            onClick={() => setEl(el === e ? null : e)}
          >
            {ELEMENT_LABEL[e]}
          </button>
        ))}
      </div>
      <div className="filter-bar">
        <button className={`chip-toggle ${role === null ? 'is-on' : ''}`} onClick={() => setRole(null)}>全ロール</button>
        {ROLES.map((r) => (
          <button
            key={r}
            className={`chip-toggle ${role === r ? 'is-on' : ''}`}
            onClick={() => setRole(role === r ? null : r)}
          >
            {ROLE_FULL[r]}
          </button>
        ))}
        <span style={{ width: 12 }} />
        {RARITIES.map((r) => (
          <button
            key={r}
            className={`chip-toggle ${rar === r ? 'is-on' : ''}`}
            style={{ ['--chip-color' as string]: `var(--rar-${r})` }}
            onClick={() => setRar(rar === r ? null : r)}
          >
            {r}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="muted" style={{ padding: 24, textAlign: 'center' }}>
          条件に合うキャラクターがいません。
        </div>
      ) : (
        <div className="grid-auto">
          {list.map((c) => (
            <CharacterCard
              key={c.owned.uid}
              view={c}
              onClick={() => store.navigate('CHARACTER_DETAIL', c.owned.uid)}
            />
          ))}
        </div>
      )}
    </Panel>
  );
}

export default CharactersScreen;

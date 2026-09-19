/**
 * 回帰テスト: 転生の戦闘補正 (SKILL_POWER / GAUGE_START / ULT_GAUGE_START) が
 * toAllyCombatant から CombatantInput.rebirthMods として実際に渡ること。
 *
 * 背景: contract.ts に rebirthMods が追加される前の名残で、battle-service では
 * 補正を計算だけして渡しておらず、該当する転生ノード9件がサーバ側でのみ
 * 無効になっていた(オフライン版は接続済みで、結果が食い違っていた)。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CharacterDef, OwnedCharacter, RebirthNodeDef } from '@akatan/shared';
import { toAllyCombatant } from './battle-service.js';

const def = {
  id: 'test_char', name: 'テスト', rarity: 'SR', element: 'FIRE', roles: ['ATTACKER'],
  baseStats: { hp: 500, attack: 100, defense: 40, speed: 100, criticalRate: 5, criticalDamage: 150 },
  growth: { hp: 30, attack: 8, defense: 3, speed: 2 },
  normalAttack: 'sk_x', skills: [], defaultAi: 'ai_x',
} as unknown as CharacterDef;

const owned = {
  uid: 'u1', defId: 'test_char', level: 10, exp: 0, equipment: {},
  rebirthCount: 1, rebirthPoints: 0, rebirthNodes: { rb_power: 2, rb_gauge: 1 },
} as unknown as OwnedCharacter;

const nodeDefs = new Map<string, RebirthNodeDef>([
  ['rb_power', { id: 'rb_power', effects: [{ kind: 'SKILL_POWER', value: 10 }] } as unknown as RebirthNodeDef],
  ['rb_gauge', { id: 'rb_gauge', effects: [{ kind: 'GAUGE_START', value: 25 }] } as unknown as RebirthNodeDef],
]);

test('転生の戦闘補正が CombatantInput.rebirthMods として渡る', () => {
  const c = toAllyCombatant(owned, def, 0, new Map(), nodeDefs, 0);
  assert.ok(c.rebirthMods, 'rebirthMods が渡っていない(未接続のまま)');
  assert.equal(c.rebirthMods?.skillPowerPercent, 20, 'SKILL_POWER value10 × rank2 = 20 のはず');
  assert.equal(c.rebirthMods?.gaugeStart, 25, "GAUGE_START value25 × rank1 = 25 のはず");
});

test('転生していないキャラには rebirthMods を付けない(ログ互換のため)', () => {
  const plain = { ...owned, rebirthNodes: {} } as unknown as OwnedCharacter;
  const c = toAllyCombatant(plain, def, 0, new Map(), nodeDefs, 0);
  assert.equal(c.rebirthMods, undefined, '補正が空ならフィールド自体を付けないこと');
});

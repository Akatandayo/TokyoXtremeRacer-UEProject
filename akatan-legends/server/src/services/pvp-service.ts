/**
 * PvPサービス(あいことば対戦)
 * ------------------------------------------------------------
 * 設計上の要点:
 *
 * 1. **信頼境界(設計書§37からの意図的な逸脱)**: 通常の戦闘(battle-service.ts)は
 *    「サーバが所持キャラのレベル/ステータスをDBとマスタから再計算する」が、PvPは
 *    クライアントが申告した編成スナップショット(defId・レベル・AI・計算済みステータス)を
 *    受け取り、それを**検証**してから使う。このゲームは単体HTML(オフライン)でも遊ばれ、
 *    セーブはブラウザのlocalStorageにあるため、サーバはプレイヤーの所持キャラを必ずしも
 *    把握していない。詳細な理由と対策は docs/API.md の「PvP」節を参照。
 *    検証内容: defId/aiProfileの実在確認、levelの範囲確認、statsの上限確認
 *    (validatePartySnapshot / statCap)。name/element/roles/skills/art など
 *    「見た目・技」に関わる値は一切信用せず、必ずマスタ(defId)から引き直す。
 *
 * 2. **決定論**: シードは `あいことば + 両者の編成` から `derivePvpSeed` で導出する
 *    (node:crypto の sha256。Date.now()/Math.random() は一切使わない)。
 *    同じ入力(あいことば・両者のスナップショット)なら常に同じシードになり、
 *    runBattle 自体の決定論(contract.ts)と合わせて「同じ入力 => 同じログ」が成立する。
 *
 * 3. **部屋の寿命**: WAITING(相手待ち)は PVP_ROOM_WAIT_TTL_MS、READY(決着後)は
 *    PVP_ROOM_RESULT_TTL_MS で失効する。`purgeExpiredPvpRooms` を各APIの入口で呼び、
 *    古い部屋が残り続けないようにする。
 */
import { randomUUID, createHash } from 'node:crypto';
import type {
  BattleLog, CharacterDef, PvpMemberSnapshot, PvpPartySnapshot, PvpRoomView, Side, Stats, StatKey,
} from '@akatan/shared';
import { PVP_PARTY_SIZE, PVP_PASSPHRASE_MAX_LENGTH, PVP_ROOM_WAIT_TTL_MS, PVP_ROOM_RESULT_TTL_MS } from '@akatan/shared';
import type { BattleContext, CombatantInput } from '../battle/contract.js';
import * as repo from '../db/repository.js';
import { getGameData, type GameData } from '../data/loader.js';
import { badRequest, notFound, partyEmpty, partyInvalid } from './app-error.js';
import { getBattleEngine } from './battle-engine.js';
import { computeStats, STAT_KEYS } from './progression.js';

/* ============================================================
 * ステータス上限(クライアント申告statsの検証)
 * ------------------------------------------------------------
 * 「そのキャラをそのレベルで作れる上限を大きく超えていないか」を判定するための
 * 妥当な係数。docs/API.md に算出根拠(転生ノードの最大%合計・装備ベースの
 * 最大フラット値など、実データから調べた具体的な数値)を明記している。
 * naked = 装備・転生なしの素のステータス(computeStats(def.baseStats, def.growth, level))。
 * cap = naked * MULTIPLIER + BUFFER。
 *   - MULTIPLIER: 転生の%系ボーナス(最大でも攻撃57.8%・防御83.4%程度)や装備の%オプションを
 *     safety margin込みで許容する倍率。
 *   - BUFFER: 装備のフラット加算(武器の主ステータス等、Lv60でも数十〜百数十程度)を
 *     素の値が小さいステータス(critical等)でも許容できるようにする下駄。
 * ========================================================== */
const STAT_CAP_MULTIPLIER: Record<StatKey, number> = {
  hp: 3, attack: 3, defense: 3, speed: 3,
  critical: 2, criticalDamage: 2, resistance: 2, healing: 2,
};
const STAT_CAP_BUFFER: Record<StatKey, number> = {
  hp: 600, attack: 220, defense: 220, speed: 90,
  critical: 60, criticalDamage: 180, resistance: 90, healing: 180,
};

function statCap(naked: number, key: StatKey): number {
  return naked * STAT_CAP_MULTIPLIER[key] + STAT_CAP_BUFFER[key];
}

/* ============================================================
 * 検証: 編成スナップショット
 * ========================================================== */

function resolveAiProfile(id: string, def: CharacterDef, data: GameData, index: number): string {
  if (data.aiProfiles.size === 0) return id; // データ未ロード時は素通し(loader.ts と同じ寛容方針)
  const profile = data.aiProfiles.get(id);
  if (!profile) throw partyInvalid(`party.members[${index}].aiProfile: 存在しないAIプロファイルです: ${id}`);
  // P1-3(characters.ts)と同じ移行期ルール: playerSelectable を誰も持っていない間は全許可。
  const anyFlagged = [...data.aiProfiles.values()].some((p) => typeof p.playerSelectable === 'boolean');
  if (anyFlagged && profile.playerSelectable !== true) {
    throw partyInvalid(`party.members[${index}].aiProfile: このAIプロファイルはPvPで選択できません(敵/ボス専用): ${id}`);
  }
  return id;
}

function validateStats(raw: unknown, def: CharacterDef, level: number, index: number): Stats {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw partyInvalid(`party.members[${index}].stats が不正です`);
  }
  const naked = computeStats(def.baseStats, def.growth, level);
  const src = raw as Record<string, unknown>;
  const out = {} as Stats;
  for (const key of STAT_KEYS) {
    const v = src[key];
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw partyInvalid(`party.members[${index}].stats.${key} が不正です`);
    }
    const cap = statCap(naked[key], key);
    if (v > cap) {
      throw partyInvalid(
        `party.members[${index}] (${def.name}) の ${key} が上限を超えています `
        + `(申告値 ${v} > 上限 ${Math.round(cap)}。素のLv${level}時ステータス ${naked[key]} を基準に算出)`,
      );
    }
    out[key] = v;
  }
  return out;
}

/**
 * クライアント申告の編成スナップショットを検証する。
 * - defId / aiProfile はマスタに実在すること(無ければ拒否)
 * - level は 1〜levelCap の範囲であること
 * - stats は「そのキャラをそのレベルで作れる上限」を大きく超えていないこと
 * - 人数は 1〜PVP_PARTY_SIZE
 * name/element/roles/skills/art/tags など「見た目・技」に関する値は受け取らない
 * (サーバが defId からマスタを引いて必ず自前で組み立てる。buildPvpCombatant 参照)。
 */
export function validatePartySnapshot(raw: unknown, data: GameData = getGameData()): PvpPartySnapshot {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw badRequest('party は JSON オブジェクトである必要があります');
  }
  const membersRaw = (raw as Record<string, unknown>).members;
  if (!Array.isArray(membersRaw)) {
    throw badRequest('party.members は配列である必要があります');
  }
  if (membersRaw.length === 0) throw partyEmpty('PvPの編成が空です');
  if (membersRaw.length > PVP_PARTY_SIZE) {
    throw partyInvalid(`PvPの編成は最大 ${PVP_PARTY_SIZE} 体までです(受信: ${membersRaw.length})`);
  }

  const levelCap = data.progression.levelCap > 0 ? data.progression.levelCap : 60;
  const members: PvpMemberSnapshot[] = membersRaw.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw partyInvalid(`party.members[${index}] が不正です`);
    }
    const m = entry as Record<string, unknown>;

    const defId = m.defId;
    if (typeof defId !== 'string' || defId.length === 0 || defId.length > 128) {
      throw partyInvalid(`party.members[${index}].defId が不正です`);
    }
    const def = data.characters.get(defId);
    if (!def) throw partyInvalid(`party.members[${index}]: 存在しないキャラクターです: ${defId}`);

    const levelRaw = m.level;
    if (typeof levelRaw !== 'number' || !Number.isFinite(levelRaw) || !Number.isInteger(levelRaw)) {
      throw partyInvalid(`party.members[${index}].level が不正です`);
    }
    if (levelRaw < 1 || levelRaw > levelCap) {
      throw partyInvalid(`party.members[${index}]: レベルは 1〜${levelCap} の範囲である必要があります (${defId} Lv${levelRaw})`);
    }
    const level = Math.floor(levelRaw);

    let aiProfile = def.defaultAi;
    if (m.aiProfile !== undefined && m.aiProfile !== null) {
      if (typeof m.aiProfile !== 'string' || m.aiProfile.length === 0 || m.aiProfile.length > 128) {
        throw partyInvalid(`party.members[${index}].aiProfile が不正です`);
      }
      aiProfile = resolveAiProfile(m.aiProfile, def, data, index);
    }

    const stats = validateStats(m.stats, def, level, index);

    const snapshot: PvpMemberSnapshot = { defId, level, aiProfile, stats };
    return snapshot;
  });

  return { members };
}

/* ============================================================
 * シード導出(決定論)
 * ========================================================== */

function snapshotFingerprint(party: PvpPartySnapshot): string {
  // メンバー順(=編成順)は意味を持つため並べ替えない。キー順を明示的に固定した
  // 文字列を組み立てることで、JSON.stringify のキー順に依存しない決定論を保証する。
  return party.members
    .map((m) => [m.defId, m.level, m.aiProfile ?? '', ...STAT_KEYS.map((k) => m.stats[k])].join('|'))
    .join(';');
}

/**
 * あいことば + 両陣営の編成スナップショットから決定論的にシードを導出する。
 * Date.now() / Math.random() は一切使わない(同じ入力なら常に同じ値を返す)。
 */
export function derivePvpSeed(passphrase: string, hostParty: PvpPartySnapshot, guestParty: PvpPartySnapshot): number {
  const material = `akatan-pvp:${passphrase}::${snapshotFingerprint(hostParty)}::${snapshotFingerprint(guestParty)}`;
  const digest = createHash('sha256').update(material, 'utf8').digest();
  // BattleLog.seed は number(2^31未満)として扱われる想定(battle-service.ts の generateSeed 参照)。
  return digest.readUInt32BE(0) % 2_147_483_647;
}

/* ============================================================
 * CombatantInput への変換
 * ========================================================== */

/**
 * 検証済みスナップショット -> CombatantInput。
 * name/element/roles/skills/ultimate/passives/art/rarity/tags は**必ずサーバのマスタ
 * (defId から引いた CharacterDef)から取る**。クライアントはこれらを送ってこない
 * (信用しないのではなく、そもそも受け取らない設計)。
 * 装備の特殊効果(specials)や転生の戦闘補正(rebirthMods)はPvPでは適用しない
 * (statsの最終値だけを信頼する設計上、その内訳=装備/転生の詳細をサーバは知らないため。
 * docs/API.md「妥協した点」参照)。
 */
export function buildPvpCombatant(
  member: PvpMemberSnapshot,
  data: GameData,
  side: Side,
  slot: number,
  idPrefix: string,
): CombatantInput {
  const def = data.characters.get(member.defId);
  if (!def) throw partyInvalid(`存在しないキャラクターです: ${member.defId}`);
  return {
    id: `${idPrefix}_${slot}_${def.id}`,
    side,
    slot,
    name: def.name,
    defId: def.id,
    element: def.element,
    roles: def.roles ?? [],
    level: member.level,
    stats: member.stats,
    normalAttack: def.normalAttack,
    skills: def.skills ?? [],
    ultimate: def.ultimate,
    passives: def.passives,
    aiProfile: member.aiProfile ?? def.defaultAi,
    awakening: def.awakening,
    art: def.art,
    rarity: def.rarity,
    tags: def.tags,
  };
}

/**
 * 検証済みの両陣営スナップショットから戦闘ログを1回分だけ生成する(純粋関数)。
 * 同じ hostParty/guestParty/data/seed なら必ず同じログになる(決定論のテスト対象)。
 */
export function runPvpBattle(
  hostParty: PvpPartySnapshot,
  guestParty: PvpPartySnapshot,
  data: GameData,
  seed: number,
): BattleLog {
  const allies = hostParty.members.map((m, i) => buildPvpCombatant(m, data, 'ALLY', i, 'pvp_host'));
  const enemies = guestParty.members.map((m, i) => buildPvpCombatant(m, data, 'ENEMY', i, 'pvp_guest'));

  const ctx: BattleContext = {
    skills: data.skills,
    aiProfiles: data.aiProfiles,
    affinity: data.affinity,
    config: data.progression.battle,
    seed,
    combos: data.combos,
    // createdAt の時刻付与はAPI層の責務(battle-service.ts と同じ方針)。
    // イベント列・result には影響しないため決定論は壊れない。
    now: new Date().toISOString(),
  };

  const runBattle = getBattleEngine();
  const log = runBattle(allies, enemies, ctx);

  if (!log.id) log.id = `btl_pvp_${randomUUID()}`;
  if (typeof log.seed !== 'number') log.seed = seed;
  if (!log.createdAt) log.createdAt = ctx.now ?? '';
  return log;
}

/* ============================================================
 * あいことば / 部屋管理
 * ========================================================== */

function normalizePassphrase(raw: unknown): string {
  if (typeof raw !== 'string') throw badRequest('passphrase は必須の文字列です');
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) throw badRequest('あいことばを入力してください');
  if (trimmed.length > PVP_PASSPHRASE_MAX_LENGTH) {
    throw badRequest(`あいことばが長すぎます(最大 ${PVP_PASSPHRASE_MAX_LENGTH} 文字)`);
  }
  return trimmed;
}

export interface JoinPvpParams {
  playerId: string;
  passphrase: unknown;
  party: unknown;
}

/**
 * あいことばで部屋に入る。
 * - 部屋が無い/失効している -> 新規作成して WAITING で返る(自分が host)。
 * - 同じトークンが既に host の部屋に入り直した -> 編成だけ更新して WAITING のまま
 *   (P0: 同一プレイヤーが自分自身と対戦することはできない)。
 * - 別トークンが WAITING の部屋に入った -> このリクエストが guest になり、
 *   その場で runBattle を1回だけ実行して READY にする(両者が同じログを見る)。
 */
export function joinPvp(params: JoinPvpParams, data: GameData = getGameData()): PvpRoomView {
  const passphrase = normalizePassphrase(params.passphrase);
  const party = validatePartySnapshot(params.party, data);
  const now = new Date();
  const nowIso = now.toISOString();

  return repo.inTransaction(() => {
    repo.purgeExpiredPvpRooms(nowIso);
    const existing = repo.findWaitingPvpRoomByPassphrase(passphrase, nowIso);

    if (!existing) {
      const roomId = `pvp_${randomUUID()}`;
      const expiresAt = new Date(now.getTime() + PVP_ROOM_WAIT_TTL_MS).toISOString();
      repo.insertPvpRoom({
        id: roomId, passphrase, hostPlayerId: params.playerId, hostParty: party,
        createdAt: nowIso, expiresAt,
      });
      return {
        roomId, status: 'WAITING', opponentJoined: false, createdAt: nowIso, expiresAt,
      };
    }

    if (existing.hostPlayerId === params.playerId) {
      repo.updatePvpRoomHostParty(existing.id, party, nowIso);
      return {
        roomId: existing.id, status: 'WAITING', opponentJoined: false,
        createdAt: existing.createdAt, expiresAt: existing.expiresAt,
      };
    }

    const seed = derivePvpSeed(passphrase, existing.hostParty, party);
    const log = runPvpBattle(existing.hostParty, party, data, seed);
    const expiresAt = new Date(now.getTime() + PVP_ROOM_RESULT_TTL_MS).toISOString();
    repo.resolvePvpRoom(existing.id, {
      guestPlayerId: params.playerId, guestParty: party, seed, log, updatedAt: nowIso, expiresAt,
    });
    return {
      roomId: existing.id, status: 'READY', side: 'ENEMY', log, opponentJoined: true,
      createdAt: existing.createdAt, expiresAt,
    };
  });
}

/**
 * 部屋の現在状態を取得する(host側のポーリング用、および再取得全般)。
 * その部屋の host/guest 以外からの参照は NOT_FOUND として扱う(他プレイヤーの
 * 編成ステータスをroomIdの推測だけで覗けないようにするため)。
 */
export function getPvpRoomView(playerId: string, roomIdRaw: unknown): PvpRoomView {
  if (typeof roomIdRaw !== 'string' || roomIdRaw.length === 0 || roomIdRaw.length > 128) {
    throw badRequest('roomId が不正です');
  }
  const nowIso = new Date().toISOString();
  repo.purgeExpiredPvpRooms(nowIso);
  const room = repo.findPvpRoomById(roomIdRaw);
  if (!room || (room.hostPlayerId !== playerId && room.guestPlayerId !== playerId)) {
    throw notFound('PvPの部屋が見つかりません(相手が来ないまま失効した可能性があります)');
  }

  if (room.status === 'WAITING') {
    return {
      roomId: room.id, status: 'WAITING', opponentJoined: false,
      createdAt: room.createdAt, expiresAt: room.expiresAt,
    };
  }

  const side: Side = room.hostPlayerId === playerId ? 'ALLY' : 'ENEMY';
  return {
    roomId: room.id, status: 'READY', side, log: room.log ?? undefined, opponentJoined: true,
    createdAt: room.createdAt, expiresAt: room.expiresAt,
  };
}

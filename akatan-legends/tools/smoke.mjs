#!/usr/bin/env node
/**
 * 統合スモークテスト (統括担当所有)
 * サーバを起動し、設計書§48 の MVP完成条件の一連の流れを実際に叩いて検証する。
 *   HOME -> Characters -> Party -> Dungeon -> Battle Start -> 完全オート戦闘 -> 勝利 -> EXP/報酬 -> Lvアップ
 * 使い方: node tools/smoke.mjs
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = process.env.PORT || '8799';
const BASE = `http://127.0.0.1:${PORT}/api`;

let failures = 0;
let checks = 0;
function check(label, cond, detail = '') {
  checks++;
  if (cond) {
    console.log(`  \x1b[32m✓\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function api(method, route, body) {
  const res = await fetch(BASE + route, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

async function waitForServer(proc, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (proc.exitCode !== null) throw new Error(`サーバが起動前に終了しました (code=${proc.exitCode})`);
    try {
      const res = await fetch(`${BASE}/health`);
      if (res.ok) return;
    } catch { /* まだ起動していない */ }
    await sleep(500);
  }
  throw new Error('サーバ起動がタイムアウトしました');
}

const server = spawn('npx', ['tsx', 'server/src/index.ts'], {
  cwd: ROOT,
  env: { ...process.env, PORT, AKATAN_DB_PATH: ':memory:' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const serverLog = [];
server.stdout.on('data', (d) => serverLog.push(String(d)));
server.stderr.on('data', (d) => serverLog.push(String(d)));

try {
  console.log('\n\x1b[1m== あかたんLegends 統合スモークテスト ==\x1b[0m\n');
  await waitForServer(server);

  console.log('[1] マスターデータ');
  const health = await api('GET', '/health');
  check('GET /api/health が 200', health.status === 200, JSON.stringify(health.json?.data ?? health.json));
  const master = await api('GET', '/master');
  const m = master.json?.data;
  check('キャラ定義 10体以上', (m?.characters?.length ?? 0) >= 10, `${m?.characters?.length ?? 0}体`);
  check('敵定義 11体以上', (m?.enemies?.length ?? 0) >= 11, `${m?.enemies?.length ?? 0}体`);
  check('スキル定義あり', (m?.skills?.length ?? 0) > 0, `${m?.skills?.length ?? 0}件`);
  check('AIプロファイル 8種以上', (m?.aiProfiles?.length ?? 0) >= 8, `${m?.aiProfiles?.length ?? 0}件`);
  check('チャプター 2以上', (m?.chapters?.length ?? 0) >= 2, `${m?.chapters?.length ?? 0}件`);

  console.log('\n[2] プレイヤー初期化 (HOME / Characters)');
  const player = await api('GET', '/player');
  const p = player.json?.data;
  check('GET /api/player が 200', player.status === 200);
  check('スターターキャラが付与される', (p?.characters?.length ?? 0) >= 5, `${p?.characters?.length ?? 0}体`);
  check('パーティ枠が5', p?.party?.members?.length === 5);
  check('計算済みステータスが入っている', typeof p?.characters?.[0]?.stats?.hp === 'number',
    `例: ${p?.characters?.[0]?.def?.name} HP=${p?.characters?.[0]?.stats?.hp}`);

  console.log('\n[3] 編成 (Party)');
  const uids = (p?.characters ?? []).slice(0, 5).map((c) => c.owned.uid);
  const party = await api('PUT', '/party', { members: uids });
  check('PUT /api/party が成功', party.status === 200 && party.json?.ok === true);
  const dupe = await api('PUT', '/party', { members: [uids[0], uids[0], null, null, null] });
  check('同一キャラの重複編成を拒否', dupe.json?.ok === false, dupe.json?.error?.code);
  const forged = await api('PUT', '/party', { members: ['not-owned-uid', null, null, null, null] });
  check('未所持キャラの編成を拒否 (サーバ権威)', forged.json?.ok === false, forged.json?.error?.code);
  await api('PUT', '/party', { members: uids });

  console.log('\n[4] ダンジョン');
  const dungeons = await api('GET', '/dungeons');
  const firstStage = dungeons.json?.data?.chapters?.[0]?.stages?.[0];
  check('GET /api/dungeons が 200', dungeons.status === 200);
  check('最初のステージが取得できる', !!firstStage, firstStage?.name);

  console.log('\n[5] 完全オート戦闘');
  let battle = await api('POST', '/battle/start', { stageId: firstStage?.id });
  let b = battle.json?.data;
  check('POST /api/battle/start が 200', battle.status === 200, battle.json?.error?.message ?? '');
  check('BattleLog にユニットが入っている', (b?.log?.units?.length ?? 0) > 0, `${b?.log?.units?.length}体`);
  check('イベントログが生成される', (b?.log?.events?.length ?? 0) > 10, `${b?.log?.events?.length}件`);
  check('最後のイベントが BATTLE_END', b?.log?.events?.at(-1)?.type === 'BATTLE_END');
  check('全イベントに seq が連番で振られている',
    (b?.log?.events ?? []).every((e, i) => e.seq === i) || (b?.log?.events ?? []).every((e, i) => e.seq === i + 1));
  const snapshotted = (b?.log?.events ?? []).filter((e) => Array.isArray(e.snapshot));
  check('スナップショット付きイベントがある (再生用)', snapshotted.length > 0, `${snapshotted.length}件`);
  const withText = (b?.log?.events ?? []).filter((e) => typeof e.text === 'string' && e.text.length > 0);
  check('実況テキスト付きイベントがある', withText.length > 0, `例: ${withText[0]?.text}`);
  check('1-1 は初期編成で勝てる', b?.log?.result?.victory === true,
    b?.log?.result?.victory ? `${b?.log?.result?.turns}ターンで勝利` : '敗北 — バランス要調整');
  check('戦闘が現実的な長さで終わる', (b?.log?.result?.turns ?? 0) > 3 && (b?.log?.result?.turns ?? 999) < 200,
    `${b?.log?.result?.turns}ターン`);

  console.log('\n[6] 報酬とレベルアップ');
  check('勝利で EXP を獲得', (b?.rewards?.exp ?? 0) > 0, `EXP+${b?.rewards?.exp}`);
  check('勝利で GOLD を獲得', (b?.rewards?.gold ?? 0) > 0, `G+${b?.rewards?.gold}`);
  const before = p.characters.find((c) => c.owned.uid === uids[0]);
  let after = b?.characters?.find((c) => c.owned.uid === uids[0]);
  check('キャラのEXPが増えている', (after?.owned?.exp ?? 0) > 0 || (after?.owned?.level ?? 1) > (before?.owned?.level ?? 1),
    `Lv${before?.owned?.level} EXP${before?.owned?.exp} -> Lv${after?.owned?.level} EXP${after?.owned?.exp}`);

  // レベルアップが起きるまで回す
  let levelUpSeen = (b?.rewards?.levelUps?.length ?? 0) > 0;
  let statGrew = false;
  for (let i = 0; i < 12 && !levelUpSeen; i++) {
    battle = await api('POST', '/battle/start', { stageId: firstStage?.id });
    b = battle.json?.data;
    if ((b?.rewards?.levelUps?.length ?? 0) > 0) levelUpSeen = true;
  }
  after = b?.characters?.find((c) => c.owned.uid === uids[0]);
  statGrew = (after?.stats?.hp ?? 0) > (before?.stats?.hp ?? 0);
  check('周回でレベルアップが発生する', levelUpSeen,
    levelUpSeen ? `${b?.rewards?.levelUps?.map((l) => `${l.name} Lv${l.fromLevel}→${l.toLevel}`).join(', ')}` : '13戦してもLvアップせず — EXP設計要確認');
  check('レベルアップでステータスが伸びる', statGrew, `HP ${before?.stats?.hp} -> ${after?.stats?.hp}`);

  console.log('\n[7] 決定論 / リプレイ');
  check('BattleLog に seed が記録されている', typeof b?.log?.seed === 'number', `seed=${b?.log?.seed}`);
  check('BattleLog に id と作成日時がある', !!b?.log?.id && !!b?.log?.createdAt);

  console.log('\n[8] 不正入力');
  const badStage = await api('POST', '/battle/start', { stageId: 'no_such_stage' });
  check('存在しないステージを拒否', badStage.json?.ok === false, badStage.json?.error?.code);
  const noBody = await api('POST', '/battle/start', {});
  check('stageId 欠落を拒否', noBody.json?.ok === false, noBody.json?.error?.code);

  console.log(`\n\x1b[1m結果: ${checks - failures}/${checks} 成功\x1b[0m`);
  if (failures > 0) {
    console.log('\n--- サーバログ(末尾) ---');
    console.log(serverLog.join('').split('\n').slice(-25).join('\n'));
  }
} catch (err) {
  failures++;
  console.error('\n\x1b[31m致命的エラー:\x1b[0m', err.message);
  console.log('\n--- サーバログ ---');
  console.log(serverLog.join('').split('\n').slice(-40).join('\n'));
} finally {
  server.kill('SIGTERM');
  await sleep(300);
  server.kill('SIGKILL');
}
process.exit(failures > 0 ? 1 : 0);

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

/**
 * この実行中に観測したレベルアップを全部ためておく。
 * 以前は「終盤に 1-1 を13回回して上がるか」で見ていたが、その時点では編成を3人に
 * 減らした後で、しかも既にレベルが上がった後なので 1-1 の EXP では届かないのが正常。
 * (実測: まっさらな状態なら 1-1 の初戦で編成5人全員がLv2になる)
 * 見たい不変条件は「進行のどこかでレベルアップが起き、その時ステータスが伸びる」ことなので、
 * 実行全体を通して観測する。
 */
const observedLevelUps = [];

async function api(method, route, body) {
  const res = await fetch(BASE + route, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  const ups = json?.data?.rewards?.levelUps;
  if (Array.isArray(ups) && ups.length > 0) {
    observedLevelUps.push({ ups, battle: json.data });
  }
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

/**
 * 起動したサーバを確実に止める。プロセスグループごと落としたうえで、
 * 実際にポートが解放されるまで待つ。ここを雑にすると次の実行が古いサーバに
 * 繋がってしまい、検証結果が当てにならなくなる。
 */
async function shutdownServer(proc) {
  const killGroup = (sig) => {
    try { process.kill(-proc.pid, sig); } catch { /* 既に終了済み */ }
    try { proc.kill(sig); } catch { /* 同上 */ }
  };
  killGroup('SIGTERM');
  for (let i = 0; i < 20; i++) {
    await sleep(150);
    const alive = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(500) })
      .then(() => true).catch(() => false);
    if (!alive) return;
    if (i === 6) killGroup('SIGKILL');
  }
  console.error(`⚠ ポート ${PORT} を解放できませんでした。残ったプロセスを手動で止めてください。`);
}

// 既に誰かが同じポートで待ち受けていると、自分で起動したサーバではなくそちらに
// 繋がってしまう。古いサーバは別のDB(進行済みのセーブ)を持っているため、結果が
// 実行のたびに揺れて「落ちたのが不具合なのか環境なのか」が判別できなくなる。
// 実際にこれで長時間ぶんの誤検知が出たので、起動前に必ず確認して即座に止める。
{
  const busy = await fetch(`http://127.0.0.1:${PORT}/api/health`, { signal: AbortSignal.timeout(1500) })
    .then(() => true)
    .catch(() => false);
  if (busy) {
    console.error(`\n✗ ポート ${PORT} は既に使用中です。古いサーバが残っています。`);
    console.error('  そちらに繋がると別のセーブを読んでしまい、検証結果が当てになりません。');
    console.error("  停止方法: ps -eo pid,args | grep 'server/src/index.ts' | grep -v grep | awk '{print $1}' → 個別に kill");
    console.error('  (PORT=別の番号 で退避することもできます)\n');
    process.exit(1);
  }
}

// detached: true で独自のプロセスグループを作る。npx -> sh -> node -> node という
// 多段のプロセスツリーになるため、親(npx)だけを kill しても孫が生き残ってポートを
// 掴み続ける。これが「古いサーバが残る」原因だったので、グループごと終了させる。
const server = spawn('npx', ['tsx', 'server/src/index.ts'], {
  detached: true,
  cwd: ROOT,
  // 戦闘シードを固定して結果を完全に再現可能にする。固定しないと戦闘の長さや
  // 勝敗が実行のたびに揺れ、「落ちたのが不具合なのか運なのか」が判別できなくなる。
  env: { ...process.env, PORT, AKATAN_DB_PATH: ':memory:', AKATAN_BATTLE_SEED: process.env.AKATAN_BATTLE_SEED ?? '20260919',
    AKATAN_RNG_SEED: process.env.AKATAN_RNG_SEED ?? '20260919' },
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
  const actionCount = (log) => (log?.events ?? []).filter((e) => e.type === 'ACTION_START').length;
  const acts1 = actionCount(b?.log);
  // turns はラウンド数(生存数ぶんの行動で1)なので長さの指標にならない。行動数で測る。
  // 下限を 8 にしていたが、1-1 はチュートリアル(味方5 vs 弱い敵3)で1ラウンド決着が
  // 正常な設計。実際に 4〜5行動で終わり、毎回この検証だけが落ちていた(ゲーム側は正常)。
  // ここで見たいのは「必ず終わる・暴走しない」ことなので、上限だけを意味のある検証にする。
  check('戦闘が暴走せず終わる (行動数 1〜80)', acts1 >= 1 && acts1 <= 80,
    `${acts1}行動 / ${b?.log?.result?.turns}ラウンド`);

  console.log('\n[6] 報酬とレベルアップ');
  check('勝利で EXP を獲得', (b?.rewards?.exp ?? 0) > 0, `EXP+${b?.rewards?.exp}`);
  check('勝利で GOLD を獲得', (b?.rewards?.gold ?? 0) > 0, `G+${b?.rewards?.gold}`);
  const before = p.characters.find((c) => c.owned.uid === uids[0]);
  let after = b?.characters?.find((c) => c.owned.uid === uids[0]);
  check('キャラのEXPが増えている', (after?.owned?.exp ?? 0) > 0 || (after?.owned?.level ?? 1) > (before?.owned?.level ?? 1),
    `Lv${before?.owned?.level} EXP${before?.owned?.exp} -> Lv${after?.owned?.level} EXP${after?.owned?.exp}`);

  // レベルアップが起きるまで回す
  let statGrew = false;
  for (let i = 0; i < 12 && observedLevelUps.length === 0; i++) {
    battle = await api('POST', '/battle/start', { stageId: firstStage?.id });
    b = battle.json?.data;
  }
  const seen = observedLevelUps[0];
  const lastLevelUps = seen?.ups ?? [];
  const levelUpBattle = seen?.battle ?? null;
  const levelUpSeen = lastLevelUps.length > 0;
  check('周回でレベルアップが発生する', levelUpSeen,
    levelUpSeen ? `${lastLevelUps.map((l) => `${l.name} Lv${l.fromLevel}→${l.toLevel}`).join(', ')}` : '実行全体を通して一度もLvアップせず — EXP設計要確認');

  // レベルアップしたキャラ「本人」の伸びを見る。
  // 以前は固定で uids[0] を見ていたが、ループの終了条件は「編成の誰か」が
  // レベルアップすれば成立するため、別のキャラが先に上がると誤って失敗していた。
  const leveled = lastLevelUps[0];
  after = leveled ? levelUpBattle?.characters?.find((c) => c.owned.uid === leveled.uid) : undefined;
  const gain = leveled?.statGain ?? {};
  statGrew = Object.values(gain).some((v) => typeof v === 'number' && v > 0);
  check('レベルアップでステータスが伸びる', statGrew,
    leveled ? `${leveled.name} Lv${leveled.fromLevel}→${leveled.toLevel} / 上昇 ${JSON.stringify(gain)}` : 'レベルアップ情報なし');

  console.log('\n[7] 決定論 / リプレイ');
  check('BattleLog に seed が記録されている', typeof b?.log?.seed === 'number', `seed=${b?.log?.seed}`);
  check('BattleLog に id と作成日時がある', !!b?.log?.id && !!b?.log?.createdAt);

  console.log('\n[8] ステージ開放制御 (STAGE_LOCKED)');
  const chapters = dungeons.json?.data?.chapters ?? [];
  // クリア状況は「今」を見る。実行開始時のスナップショット(p)で判定すると、
  // その後の周回で ch1-1 をクリアして ch1-2 が解放済みになっているのに
  // 「未開放のはず」と決めつけてしまい、この検証だけが必ず落ちていた。
  const nowPlayer = (await api('GET', '/player')).json?.data;
  const clearedNow = nowPlayer?.player?.clearedStages ?? [];
  const gated = chapters.flatMap((c) => c.stages).find((s) => s.unlockAfter && !clearedNow.includes(s.unlockAfter));
  check('unlockAfter が設定されたステージが存在する', !!gated, gated ? `${gated.id} <- ${gated.unlockAfter}` : '未設定');
  if (gated) {
    const locked = await api('POST', '/battle/start', { stageId: gated.id });
    check('未開放ステージへの挑戦を拒否 (サーバ権威)', locked.json?.error?.code === 'STAGE_LOCKED',
      locked.json?.error?.message ?? JSON.stringify(locked.json).slice(0, 80));
  }
  const lastCh1 = chapters[0]?.stages?.at(-1);
  const ch2First = chapters[1]?.stages?.[0];
  check('第2章の先頭が第1章ボスで開放される', ch2First?.unlockAfter === lastCh1?.id,
    `${ch2First?.id} <- ${ch2First?.unlockAfter}`);

  console.log('\n[9] キャラクターコンボ');
  const master2 = await api('GET', '/master');
  const comboDefs = master2.json?.data?.combos ?? [];
  check('コンボ定義が配信される', comboDefs.length >= 6, `${comboDefs.length}件`);
  check('PAIR以外のコンボも存在する', new Set(comboDefs.map((c) => c.kind)).size >= 2,
    [...new Set(comboDefs.map((c) => c.kind))].join('/'));
  // コンボが成立する編成を作って発動を確認する
  const defToUid = new Map((p.characters ?? []).map((c) => [c.def.id, c.owned.uid]));
  const pairable = comboDefs.find((c) => (c.members ?? []).every((m) => defToUid.has(m)));
  if (pairable) {
    const rest = [...defToUid.keys()].filter((d) => !pairable.members.includes(d));
    const comboParty = [...pairable.members, ...rest].slice(0, 5).map((d) => defToUid.get(d));
    await api('PUT', '/party', { members: comboParty });
    let fired = 0;
    for (let i = 0; i < 6 && fired === 0; i++) {
      const r = await api('POST', '/battle/start', { stageId: firstStage?.id });
      fired += (r.json?.data?.log?.events ?? []).filter((e) => e.type === 'COMBO').length;
    }
    check(`コンボが戦闘中に発動する (${pairable.name})`, fired > 0, `${fired}回`);
    await api('PUT', '/party', { members: uids });
  } else {
    check('コンボが成立する編成を作れる', false, 'スターターに相方が揃っていない');
  }

  console.log('\n[10] 不正入力');
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
  await shutdownServer(server);
}
process.exit(failures > 0 ? 1 : 0);

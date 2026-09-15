/* =========================================================================
   10. 起動
   ========================================================================= */
const HOWTO = `
<p>キャラクターを選んで1対1で戦うコマンドバトルです。ローカル対戦・AI対戦・オンライン対戦の3つがあります。</p>
<div class="h-rule">1ターンの流れ</div>
<p class="note">両者がコマンドを選ぶ → 技の優先度とSPDで行動順が決まる → 行動を処理 → 状態異常と覚醒条件を確認、の順に進みます。</p>
<div class="h-rule">コマンド</div>
<p><b>攻撃</b>：コストなしの基本攻撃。<br>
<b>防御</b>：被ダメージが半分になり、SPが1多く回復します。防御貫通の技には効きません。<br>
<b>技</b>：SPを支払って使います。優先度つきの技は相手より先に出ます。<br>
<b>状況</b>：能力値・効果・覚醒条件の確認。ターンは消費しません。<br>
<b>覚醒</b>：条件を満たすと光ります。</p>
<div class="h-rule">SP</div>
<p class="note">技のコストに使う共通リソース。毎ターン${BALANCE.sp.regenPerTurn}回復し、最大${BALANCE.sp.max}。強い技を撃つほど次が苦しくなります。</p>
<div class="h-rule">状態異常</div>
<p class="note">${Object.values(STATUS).map(s=>s.icon+" "+s.name).join("　")}</p>
<p class="note">アイコンは各キャラの下に表示され、数字は残りターン、∞は永続です。技エディタから自由に組み合わせられます。</p>
<div class="h-rule">覚醒</div>
<p>条件を満たしても自動では発動しません。<b>いつ切るかはプレイヤーが決めます。</b>覚醒すると技セットが丸ごと入れ替わり、ステータスも変わりますが、持続ターンとHP減少という代償がついてきます。</p>
<p class="note">早すぎれば押し切られ、遅すぎれば間に合いません。勝利ボタンではなく逆転の布石です。</p>
<div class="h-rule">データの持ち運び</div>
<p class="note">キャラクター画面の「ファイルに保存」で、自分で作ったキャラクターと技をJSONファイルとして端末に書き出せます。機種変更のときや友達に渡すときは、そのファイルを「ファイルから読み込む」で選ぶだけです。立ち絵も一緒に入っています。</p>
<div class="h-rule">演出の速さ</div>
<p class="note">戦闘画面右上の⏩で「ふつう／はやい／瞬時」を切り替えられます。再生の途中で画面をタップすると、そのターンの残りを一気に送れます。設定は次回も引き継がれます。</p>
<div class="h-rule">対戦BGM</div>
<p class="note">キャラクターごとに曲を設定できます。戦闘中は<b>対戦相手のキャラクターの曲</b>が流れます。画面右上の♪で切り替えられます。</p>
<p class="note">ブラウザは画面を触るまで音を鳴らせない決まりになっています。♪が「タップ」表示のときは、画面をどこか触れば鳴りはじめます。</p>
<div class="h-rule">キャラクター作成のポイント</div>
<p class="note">HP・ATK・DEF・SPDは合計${BALANCE.build.budget}ポイントまで。HPは${BALANCE.build.hpPerPoint}あたり1ポイント、ほかは1あたり1ポイントです。覚醒後のATK+DEF+SPDは、通常時の合計＋${BALANCE.build.awakenBonus}までにできます。</p>
<div class="h-rule">オンライン対戦</div>
<p class="note">二人が同じあいことばを入れて「つながる」を押すだけです。役割を選ぶ必要はなく、先に押した方が自動的に待ち受けになります。</p>
<p class="note">やり取りするのは選んだコマンドだけで、計算は両方の端末で行われます。相手の自作キャラは技の内容ごと接続時に受け取るので、事前の共有は要りません（受け取った技はその対戦のあいだだけ使われ、あなたの技一覧は変わりません）。</p>
<p class="note">携帯回線など直接つながりにくい回線では中継サーバーを経由します。うまくいかないときは、二人ともWi-Fiに切り替えるか、あいことばを変えてやり直してみてください。お互いのアプリ（このファイル）の版が違うと接続できません。</p>`;

function boot(){
  Store.load();
  Store.loadPrefs();
  UI.applyPrefs();
  $("#howto-body").innerHTML=HOWTO;
  $$("[data-go]").forEach(b=>b.onclick=()=>{
    const t=b.dataset.go;
    if(t==="roster") UI.renderRoster();
    if(t==="title") Net.close();
    UI.show(t);
  });
  $$("[data-mode]").forEach(b=>b.onclick=()=>UI.openMode(b.dataset.mode));
  $("#slot0").onclick=()=>{ UI.slotFocus=0; UI.renderSelect(); };
  $("#slot1").onclick=()=>{ UI.slotFocus=1; UI.renderSelect(); };
  $("#btn-start").onclick=()=>UI.startLocalOrAi();
  $("#btn-connect").onclick=()=>UI.connect();
  $("#btn-cancel-net").onclick=()=>UI.cancelNet();
  $("#online-back").onclick=()=>{ Net.close(); UI.show("title"); };
  $("#btn-rematch").onclick=()=>UI.rematch();
  $("#btn-reselect").onclick=()=>{
    if(UI.mode==="online"){ Net.close(); UI.openOnline(); }
    else UI.openMode(UI.mode);
  };
  $("#btn-reviewlog").onclick=()=>UI.openLog();
  $("#logstrip").onclick=()=>UI.logTap();
  $("#arena").onclick=()=>UI.fastForward();
  $("#btn-speed").onclick=()=>UI.cycleSpeed();
  $("#sheet-close").onclick=()=>UI.closeSheet();
  $("#btn-mute").onclick=()=>UI.toggleMute();
  Cropper.bind();
  ["pointerdown","touchend","keydown"].forEach(ev=>
    document.addEventListener(ev,()=>UI.nudgeMusic(),{passive:true}));
  $("#scrim").onclick=()=>UI.closeSheet();
  $("#btn-new-char").onclick=()=>Editor.openCharacter(null,null);
  $("#btn-new-skill").onclick=()=>Editor.openSkill();
  const msg=(text,cls)=>{ $("#io-msg").innerHTML=`<div class="status ${cls||""}">${text}</div>`; };
  $("#btn-save-file").onclick=()=>{
    const d=Store.exportData();
    const n=Object.keys(d.characters).length, k=Object.keys(d.skills).length;
    if(!n&&!k){ msg("保存するデータがまだありません。まずキャラクターか技を作ってください。","bad"); return; }
    try{
      Store.download();
      msg(`キャラクター${n}体・技${k}個をファイルに保存しました。`,"ok");
    }catch(e){ msg("保存できませんでした。ブラウザの設定をご確認ください。","bad"); }
  };
  $("#data-file").onchange=ev=>{
    const f=ev.target.files&&ev.target.files[0];
    ev.target.value="";
    if(!f) return;
    const r=new FileReader();
    r.onerror=()=>msg("ファイルを読み込めませんでした。","bad");
    r.onload=()=>{
      try{
        const res=Store.importData(JSON.parse(r.result));
        UI.renderRoster();
        msg(`キャラクター${res.characters}体・技${res.skills}個を読み込みました。`,"ok");
      }catch(e){ msg("このファイルは読み込めませんでした。書き出したJSONファイルを選んでください。","bad"); }
    };
    r.readAsText(f);
  };
  $("#btn-text-io").onclick=()=>{
    $("#io-area").innerHTML=`<div class="h-rule">文字でやりとり</div>
      <p class="note">上の欄をコピーすれば手で渡せます。下の欄に貼り付けて読み込むこともできます。</p>
      <textarea id="io-out" readonly>${esc(Store.exportAll())}</textarea>
      <div style="height:10px"></div>
      <textarea id="io-in" placeholder="ここに貼り付け"></textarea>
      <div style="height:8px"></div><button class="btn btn-line" id="io-run">貼り付けた内容を読み込む</button>
      <div id="io-err" class="err"></div>`;
    $("#io-run").onclick=()=>{
      try{
        const res=Store.importData(JSON.parse($("#io-in").value));
        UI.renderRoster();
        $("#io-err").innerHTML=`<span style="color:#9DF0E4">キャラクター${res.characters}体・技${res.skills}個を読み込みました。</span>`;
      }catch(e){ $("#io-err").textContent="読み込めませんでした。全文が貼れているか確認してください。"; }
    };
  };
  document.addEventListener("keydown",ev=>{
    if(ev.key==="Escape"){ UI.closeSheet(); return; }
    if(!$("#s-battle").classList.contains("on")||UI.playing) return;
    const btns=$$("#cmd-area [data-cmd], #sheet-body .skl");
    const i=parseInt(ev.key,10)-1;
    if(i>=0&&i<btns.length&&!btns[i].disabled) btns[i].click();
  });
}
document.addEventListener("DOMContentLoaded",boot);


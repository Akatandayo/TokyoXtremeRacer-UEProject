/* =========================================================================
   10. 起動
   ========================================================================= */
const STATUS_CHIPS = Object.values(STATUS)
  .map(s=>`<span class="chip">${s.icon} ${esc(s.name)}</span>`).join("");

const HOWTO = `
<div class="howto-lead">
  <div class="hl">技も、キャラクターも、自分で作る。</div>
  <p><b>覚醒</b>は、あなたが組み立てたキャラクターを1対1で戦わせるゲームです。
  最初から入っている3体は<b>作り方の見本</b>。本番は、あなたが作った技とキャラクターで戦うところからです。</p>
</div>

<!-- まず全体像。ここだけ読めば何をするゲームか分かる -->
<ol class="steps">
  <li><span class="st-i" aria-hidden="true">✧</span>
    <b>技をつくる</b><span>威力・命中・SP・優先度、毒や麻痺といった効果まで自分で決めます。</span></li>
  <li><span class="st-i" aria-hidden="true">❖</span>
    <b>キャラクターをつくる</b><span>${BALANCE.build.budget}ポイントを能力値に配り、作った技を持たせ、追い詰められたときの<b>覚醒</b>の姿を決めます。</span></li>
  <li><span class="st-i" aria-hidden="true">⚔</span>
    <b>戦わせる</b><span>AI・同じ端末の友達・オンラインの相手に、その1体をぶつけます。</span></li>
</ol>
<div class="howto-cta"><button class="btn btn-gold" id="howto-make">キャラクターを作りはじめる</button>
  <p class="note">見本の3体をそのまま戦わせて、雰囲気を確かめてからでも大丈夫です。</p></div>

<div class="h-rule">戦いかた</div>
<p class="note" style="margin-bottom:var(--sp-3)">勝負を決めるのは能力値ではなく、<b>切り札を切る一瞬の判断</b>です。</p>
<ol class="flow">
  <li><b>両者がコマンドを選ぶ</b><span>相手には見えません。同じ端末で遊ぶときは、目隠しをはさんで渡します。</span></li>
  <li><b>行動順が決まる</b><span>まず技の優先度、同じならSPDの高いほうが先に動きます。</span></li>
  <li><b>行動を処理する</b><span>ダメージ・回復・状態異常を順に適用します。</span></li>
  <li><b>ターンの終わりを確かめる</b><span>継続ダメージやSPの回復、そして覚醒条件をここで判定します。</span></li>
</ol>

<div class="h-rule">くわしく</div>

<details class="acc" open>
  <summary><span class="aic">✎</span>技をつくる</summary>
  <div class="acb">
    <p>キャラクター画面の<b>「技をつくる」</b>から作ります。決めるのはこれだけです。</p>
    <div class="deflist">
      <div class="dr"><div class="dk">種別</div><div class="dv">攻撃・防御・特殊・補助。戦闘中の並びと色が変わります。</div></div>
      <div class="dr"><div class="dk">威力</div><div class="dv">高いほど痛い代わりに、SPか命中で釣り合いを取ることになります。</div></div>
      <div class="dr"><div class="dk">命中</div><div class="dv">${BALANCE.accuracyMin}〜${BALANCE.accuracyMax}%。外れる技は強くできます。</div></div>
      <div class="dr"><div class="dk">SP</div><div class="dv">撃つのに払う量。毎ターン${BALANCE.sp.regenPerTurn}しか戻らないので、重い技は続けて撃てません。</div></div>
      <div class="dr"><div class="dk">優先度</div><div class="dv">上げると相手より先に出ます。回復や妨害を通したいときの生命線です。</div></div>
      <div class="dr"><div class="dk">効果</div><div class="dv">毒・麻痺・沈黙・反撃・盾・能力の上下げなどを、確率と持続ターンつきで足せます。</div></div>
    </div>
    <p class="note">作った技はあなたの技一覧に残り、どのキャラクターにも持たせられます。</p>
  </div>
</details>

<details class="acc">
  <summary><span class="aic">❖</span>キャラクターをつくる</summary>
  <div class="acb">
    <p>5つの段（姿 → 能力 → 技 → 覚醒 → 確認）を順に進むだけです。途中でやめても<b>下書きが残ります</b>。</p>
    <p>HP・ATK・DEF・SPDは合計<b>${BALANCE.build.budget}ポイント</b>まで。
    HPは${BALANCE.build.hpPerPoint}あたり1ポイント、ほかは1あたり1ポイントです。
    どこかを尖らせれば、どこかが凹みます。</p>
    <p>覚醒後のATK+DEF+SPDは、通常時の合計＋${BALANCE.build.awakenBonus}まで。
    立ち絵の画像とテーマ曲も設定できます。</p>
    <p class="note">技の構成は作りながら助言が出ます。SP${BALANCE.sp.regenPerTurn}以下の技が1つもない、守りが無い、といった穴はその場で教えてくれます。</p>
  </div>
</details>

<details class="acc">
  <summary><span class="aic">✦</span>覚醒</summary>
  <div class="acb">
    <p>このゲームの背骨です。条件を満たしても<b>自動では発動しません。いつ切るかはプレイヤーが決めます。</b></p>
    <p>覚醒すると技セットが丸ごと入れ替わり、能力値も変わります。ただし<b>持続ターンと代償</b>がついてきます。
    多くは毎ターンHPが減り、戦闘中に一度きりです。</p>
    <p class="note">早すぎれば持続が切れたあとに押し切られ、遅すぎれば間に合いません。
    勝利ボタンではなく、逆転の布石です。条件も代償も、作るときに自分で決められます。</p>
  </div>
</details>

<details class="acc">
  <summary><span class="aic">⚔</span>コマンド</summary>
  <div class="acb">
    <div class="deflist">
      <div class="dr"><div class="dk">攻撃</div><div class="dv">コストなしの基本攻撃。SPが尽きても撃てます。</div></div>
      <div class="dr"><div class="dk">防御</div><div class="dv">被ダメージが半分になり、SPが${BALANCE.sp.defendBonus}多く回復します。防御貫通の技には効きません。</div></div>
      <div class="dr"><div class="dk">技</div><div class="dv">SPを払って使います。優先度つきの技は相手より先に出ます。</div></div>
      <div class="dr"><div class="dk">状況</div><div class="dv">能力値・かかっている効果・覚醒条件の確認。ターンは消費しません。</div></div>
      <div class="dr"><div class="dk">覚醒</div><div class="dv">条件を満たすとボタンが光ります。押すかどうかは自分で決めます。</div></div>
    </div>
    <p class="note">パソコンのキーボードでは数字キーでも選べます。</p>
  </div>
</details>

<details class="acc">
  <summary><span class="aic">◇</span>SP（技のコスト）</summary>
  <div class="acb">
    <p>技に使う共通リソースです。毎ターン<b>${BALANCE.sp.regenPerTurn}</b>回復し、上限は<b>${BALANCE.sp.max}</b>。
    開始時は${BALANCE.sp.start}です。</p>
    <p class="note">強い技を続けて撃つほど次のターンが苦しくなります。防御を選ぶと+${BALANCE.sp.defendBonus}多く回復するので、
    ためる番として使えます。</p>
  </div>
</details>

<details class="acc">
  <summary><span class="aic">✹</span>状態異常</summary>
  <div class="acb">
    <div class="chipgrid">${STATUS_CHIPS}</div>
    <p class="note">アイコンは各キャラクターの下に並びます。数字は残りターン、∞は永続です。
    技をつくるときに自由に組み合わせられます。</p>
  </div>
</details>

<details class="acc">
  <summary><span class="aic">⇄</span>誰と戦うか</summary>
  <div class="acb">
    <div class="deflist">
      <div class="dr"><div class="dk">AI</div><div class="dv">強さを4段階から選べます。「本気」は倒しきれる手を逃さず、覚醒のタイミングも計算してきます。</div></div>
      <div class="dr"><div class="dk">ローカル</div><div class="dv">1台を2人で回します。交代のたびに目隠しをはさむので、手の内は見えません。</div></div>
      <div class="dr"><div class="dk">オンライン</div><div class="dv">二人が同じ<b>あいことば</b>を入れて押すだけ。役割を選ぶ必要はありません。</div></div>
    </div>
    <p class="note">オンラインでは、相手の自作キャラクターを技の内容ごと接続時に受け取ります。事前の共有は要りません
    （受け取った技はその対戦のあいだだけ使われ、あなたの技一覧は変わりません）。
    うまくつながらないときは、二人ともWi-Fiに切り替えるか、あいことばを変えてやり直してください。</p>
  </div>
</details>

<details class="acc">
  <summary><span class="aic">⤓</span>作ったものを持ち運ぶ</summary>
  <div class="acb">
    <p>作ったデータは<b>この端末のブラウザの中だけ</b>に残ります。履歴の消去で消えることがあります。</p>
    <p>キャラクター画面の「ファイルに保存」で、自作のキャラクターと技をJSONファイルとして書き出せます。
    機種変更のときや友達に渡すときは、そのファイルを「ファイルから読み込む」で選ぶだけです。立ち絵も一緒に入っています。</p>
    <p class="note">大事なキャラクターができたら、早めにファイルへ書き出しておいてください。</p>
  </div>
</details>

<details class="acc">
  <summary><span class="aic">♪</span>演出と音</summary>
  <div class="acb">
    <p>タイトル右上の歯車から、<b>戦闘の再生速度</b>（ふつう／はやい／瞬時）、動きを減らす設定、音、触覚を切り替えられます。
    設定は次回起動でも引き継がれます。</p>
    <p>再生の途中で画面をタップすると、そのターンの残りを一気に送れます。</p>
    <p class="note">曲はキャラクターごとに設定でき、戦闘中は<b>対戦相手の曲</b>が流れます。
    ブラウザは画面を触るまで音を鳴らせない決まりなので、♪が「タップ」表示のときはどこか触れば鳴りはじめます。</p>
  </div>
</details>

<div class="howto-foot">
  <button class="btn btn-line" id="howto-make2"><span class="ic" aria-hidden="true">✎</span>キャラクターを作る</button>
</div>`;

/* -------------------------------------------------------------------------
   ボトムシート — 指で引いて閉じる／背面のスクロールを止める
   ------------------------------------------------------------------------- */
function bindSheet(){
  const sheet=$("#sheet"), inner=$("#sheet-in"), grip=$("#sheet-grip");
  if(!sheet||!inner) return;
  let dragging=false, startY=0, dy=0, t0=0, fromGrip=false, locked=false, lockY=0;

  const setY=y=>{ sheet.style.transform=y>0?`translate3d(0,${y}px,0)`:""; };
  const pointY=e=>e.touches?e.touches[0].clientY:e.clientY;

  const start=e=>{
    if(!sheet.classList.contains("on")||dragging) return;
    fromGrip=!!(grip&&grip.contains(e.target));
    if(!fromGrip&&inner.scrollTop>0) return;   // 中身を読んでいる途中は引かない
    dragging=true; startY=pointY(e); dy=0; t0=Date.now();
    sheet.classList.add("dragging");
  };
  const move=e=>{
    if(!dragging) return;
    const raw=pointY(e)-startY;
    if(raw<0){ dy=raw*0.18; setY(0); return; }   // 上へはほとんど動かさない
    if(!fromGrip&&inner.scrollTop>0){ dragging=false; sheet.classList.remove("dragging"); setY(0); return; }
    dy=raw;
    setY(dy);
    if(e.cancelable) e.preventDefault();
  };
  const end=()=>{
    if(!dragging) return;
    dragging=false;
    sheet.classList.remove("dragging");
    const v=dy/Math.max(1,Date.now()-t0);       // px/ms
    setY(0);
    if(dy>96||v>0.55){ UI.haptic(12); if(UI.closeSheet) UI.closeSheet(); }
  };

  sheet.addEventListener("touchstart",start,{passive:true});
  sheet.addEventListener("touchmove",move,{passive:false});
  sheet.addEventListener("touchend",end,{passive:true});
  sheet.addEventListener("touchcancel",end,{passive:true});
  if(grip){
    grip.addEventListener("pointerdown",e=>{ if(e.pointerType==="touch") return; start(e); });
    window.addEventListener("pointermove",e=>{ if(e.pointerType==="touch") return; move(e); });
    window.addEventListener("pointerup",e=>{ if(e.pointerType==="touch") return; end(e); });
  }

  /* 開閉に合わせて背面を固定する。開け閉めは他の担当のコードが行うので、
     クラスの変化を見て追従する（呼び出し側に手を入れない）。 */
  const lock=()=>{ lockY=window.scrollY||window.pageYOffset||0;
    document.body.style.top=(-lockY)+"px"; document.body.classList.add("locked"); };
  const unlock=()=>{ document.body.classList.remove("locked"); document.body.style.top="";
    window.scrollTo(0,lockY); };

  /* 開いているあいだ、キーボード操作が背面へ抜けないようにする */
  const FOCUSABLE="button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),"+
    "textarea:not(:disabled),summary,[tabindex]:not([tabindex='-1'])";
  const items=()=>Array.from(sheet.querySelectorAll(FOCUSABLE)).filter(el=>el.offsetParent!==null);
  /* 閉じているあいだは支援技術からもタブ移動からも外す */
  const setHidden=hide=>{
    try{ sheet.inert=hide; }catch(e){}
    sheet.setAttribute("aria-hidden",hide?"true":"false");
  };
  let prevFocus=null;
  const focusIn=()=>{
    prevFocus=document.activeElement;
    const list=items();
    const first=list.find(el=>el.id!=="sheet-close")||list[0];
    if(first) setTimeout(()=>{ try{ first.focus({preventScroll:true}); }catch(e){} },60);
  };
  const focusOut=()=>{
    const p=prevFocus; prevFocus=null;
    if(p&&document.contains(p)){ try{ p.focus({preventScroll:true}); }catch(e){} }
  };
  document.addEventListener("keydown",e=>{
    if(e.key!=="Tab"||!sheet.classList.contains("on")) return;
    const list=items();
    if(!list.length) return;
    const first=list[0], last=list[list.length-1];
    if(!sheet.contains(document.activeElement)){ e.preventDefault(); first.focus(); return; }
    if(e.shiftKey&&document.activeElement===first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey&&document.activeElement===last){ e.preventDefault(); first.focus(); }
  });

  new MutationObserver(()=>{
    const on=sheet.classList.contains("on");
    if(on&&!locked){ locked=true; lock(); focusIn(); }
    else if(!on&&locked){ locked=false; setY(0); unlock(); focusOut(); }
    setHidden(!on);
  }).observe(sheet,{attributes:true,attributeFilter:["class"]});
  setHidden(true);
}

/* 起動スプラッシュを畳む */
function hideSplash(){
  const sp=$("#splash");
  if(!sp) return;
  sp.classList.add("gone");
  setTimeout(()=>{ if(sp.parentNode) sp.parentNode.removeChild(sp); },600);
}

function boot(){
  Store.load();
  Store.loadPrefs();
  UI.initNav();
  UI.applyShellPrefs();
  UI.applyPrefs();
  UI.bindTouchFeel();
  bindSheet();
  $("#howto-body").innerHTML=HOWTO;
  /* 遊び方から、そのまま作りはじめられるようにする */
  ["#howto-make","#howto-make2"].forEach(sel=>{
    const b=$(sel);
    if(b) b.onclick=()=>{ UI.renderRoster(); UI.show("roster"); };
  });
  const ver=$("#title-ver");
  if(ver) ver.textContent="v"+APP_VERSION;

  $$("[data-go]").forEach(b=>b.onclick=()=>{
    const t=b.dataset.go;
    if(t==="roster") UI.renderRoster();
    UI.show(t);
  });
  $$("[data-mode]").forEach(b=>b.onclick=()=>UI.openMode(b.dataset.mode));
  $("#btn-settings").onclick=()=>UI.openSettings();
  $("#slot0").onclick=()=>UI.focusSlot(0);
  $("#slot1").onclick=()=>UI.focusSlot(1);
  $("#btn-random").onclick=()=>UI.randomPick();
  $("#btn-start").onclick=()=>UI.startLocalOrAi();
  $("#btn-connect").onclick=()=>UI.connect();
  $("#btn-cancel-net").onclick=()=>UI.cancelNet();
  $("#online-back").onclick=()=>UI.show("title");
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
    if(ev.key==="Escape"){
      if($("#sheet").classList.contains("on")) UI.closeSheet();
      else UI.goBack();
      return;
    }
    if(!$("#s-battle").classList.contains("on")||UI.playing) return;
    const btns=$$("#cmd-area [data-cmd], #sheet-body .skl");
    const i=parseInt(ev.key,10)-1;
    if(i>=0&&i<btns.length&&!btns[i].disabled) btns[i].click();
  });

  /* 書体が届くまでロゴがちらつかないよう、少しだけ待ってからスプラッシュを畳む */
  const ready=(document.fonts&&document.fonts.ready)?document.fonts.ready:Promise.resolve();
  Promise.race([ready,new Promise(r=>setTimeout(r,260))])
    .then(()=>requestAnimationFrame(hideSplash))
    .catch(()=>hideSplash());
}
document.addEventListener("DOMContentLoaded",boot);

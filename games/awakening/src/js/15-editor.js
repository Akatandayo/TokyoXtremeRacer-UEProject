/* =========================================================================
   09b. Editor — キャラクタークリエイト（ウィザード）と技づくり。
        ・下書きは触るたびに保存されるので、途中で閉じても消えない
        ・ポイントは指で配る。上限に当たると手応えが返る
        ・技は保存する前に「実戦でどう振る舞うか」をエンジンに聞いて見せる
        ・技と状態異常の選択肢は 02-skills.js / 03-status.js から自動生成する
   ========================================================================= */
const Editor = {
  draft:null, editingId:null, effects:[], step:0, visited:{},
  skill:null, skillEditId:null, returnTo:"roster", lastPhoto:null, dirty:false,

  STEPS:[
    {key:"look",   label:"姿",   icon:"❖", hint:"名前と見た目を決めます"},
    {key:"stats",  label:"能力", icon:"◈", hint:"ポイントを指で配ります"},
    {key:"skills", label:"技",   icon:"✧", hint:"通常形態で使う技を選びます"},
    {key:"awaken", label:"覚醒", icon:"❁", hint:"追い詰められたときの姿"},
    {key:"check",  label:"確認", icon:"✓", hint:"できあがりを見て保存します"}
  ],

  /* ---------- ポイント計算 ---------- */
  pointsOf(stats){
    const B=BALANCE.build;
    return Math.round(stats.hp/B.hpPerPoint + stats.atk + stats.def + stats.spd);
  },
  awakenPoints(form){ return Math.round((form.atk||0)+(form.def||0)+(form.spd||0)); },
  /* 指で動かせる上限。STAT_MAX を超えない範囲で、残ポイントぶんだけ伸ばせる */
  capOf(k,stats){
    const B=BALANCE.build, per=(k==="hp"?B.hpPerPoint:1);
    const rest=B.budget-this.pointsOf(stats);
    return Math.min(STAT_MAX[k], stats[k]+Math.max(0,rest)*per);
  },
  minOf(k){ return k==="hp"?BALANCE.build.minHp:BALANCE.build.minStat; },

  /* 目安の強さ。攻撃指数と耐久指数の相乗平均を、最初から入っているキャラの平均と比べる */
  powerScore(st){
    const off=st.atk*(1+st.spd/200);
    const tank=st.hp*(1+st.def/200);
    return Math.sqrt(off*tank);
  },
  baselineScore(){
    if(this._base!=null) return this._base;
    const list=Object.values(CHARACTERS).filter(c=>!c.custom&&c.stats);
    const v=list.length?list.reduce((a,c)=>a+this.powerScore(c.stats),0)/list.length:1;
    this._base=v||1;
    return this._base;
  },
  /* 一番近い既存キャラを探して「◯◯くらい」と言えるようにする */
  nearestChar(st){
    const keys=["hp","atk","def","spd"];
    let best=null,bd=Infinity;
    Object.values(CHARACTERS).forEach(c=>{
      if(c.custom||!c.stats||c.id===this.editingId) return;
      const d=keys.reduce((a,k)=>a+Math.pow((c.stats[k]-st[k])/STAT_MAX[k],2),0);
      if(d<bd){ bd=d; best=c; }
    });
    return best;
  },

  /* 4つの能力を一目で見せる。幅ではなく形で強さを伝える。 */
  RADAR_KEYS:["atk","spd","def","hp"],
  radar(st,vs,size){
    const S=size||132, c=S/2, r=c-17, K=this.RADAR_KEYS;
    const at=(i,f)=>{
      const a=-Math.PI/2+i*Math.PI/2, rr=r*f;
      return [(c+Math.cos(a)*rr),(c+Math.sin(a)*rr)];
    };
    const pt=(i,v)=>at(i,Math.max(.06,Math.min(1,v))).map(n=>n.toFixed(1)).join(",");
    const poly=o=>K.map((k,i)=>pt(i,(o[k]||0)/STAT_MAX[k])).join(" ");
    const rings=[1,.66,.33].map(f=>`<polygon points="${K.map((k,i)=>at(i,f).map(n=>n.toFixed(1)).join(",")).join(" ")}" class="rr"/>`).join("");
    const axes=K.map((k,i)=>{ const p=at(i,1); return `<line x1="${c}" y1="${c}" x2="${p[0].toFixed(1)}" y2="${p[1].toFixed(1)}" class="ra"/>`; }).join("");
    const labels=K.map((k,i)=>{ const p=at(i,1.21);
      return `<text x="${p[0].toFixed(1)}" y="${(p[1]+3.5).toFixed(1)}" class="rt">${STAT_LABEL[k]}</text>`; }).join("");
    return `<svg class="radar" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img"
      aria-label="\u80fd\u529b\u306e\u5f62">${rings}${axes}
      ${vs?`<polygon points="${poly(vs)}" class="rv"/>`:""}
      <polygon points="${poly(st)}" class="rp"/>${labels}</svg>`;
  },
  /* 強さのランク。数字より記号のほうが一目で伝わる。 */
  rankOf(st){
    const r=this.powerScore(st)/this.baselineScore();
    if(r>=1.2)  return {k:"SS",note:"\u65e2\u5b58\u306e\u3069\u306e\u30ad\u30e3\u30e9\u3088\u308a\u5f37\u3044"};
    if(r>=1.08) return {k:"S", note:"\u62bc\u3057\u5207\u308c\u308b\u5f37\u3055"};
    if(r>=0.96) return {k:"A", note:"\u65e2\u5b58\u30ad\u30e3\u30e9\u3068\u6e21\u308a\u5408\u3048\u308b"};
    if(r>=0.85) return {k:"B", note:"\u6280\u3067\u304a\u304e\u306a\u3046\u5f62"};
    return {k:"C", note:"\u30dd\u30a4\u30f3\u30c8\u304c\u4f59\u3063\u3066\u3044\u306a\u3044\u304b\u78ba\u304b\u3081\u3066"};
  },
  /* 二つ名。尖っているところ二つから名づける。 */
  archetype(st){
    const n={hp:st.hp/STAT_MAX.hp,atk:st.atk/STAT_MAX.atk,def:st.def/STAT_MAX.def,spd:st.spd/STAT_MAX.spd};
    const top=Object.keys(n).sort((a,b)=>n[b]-n[a]);
    const HEAD={hp:"\u4e0d\u5012",atk:"\u525b\u6483",def:"\u9244\u58c1",spd:"\u75be\u98a8"};
    const TAIL={hp:"\u306e\u5de8\u8eaf",atk:"\u306e\u62c5\u3044\u624b",def:"\u306e\u5b88\u308a",spd:"\u306e\u8ffd\u3044\u624b"};
    return HEAD[top[0]]+TAIL[top[1]];
  },

  readFile(file, onDone, onError, maxMB){
    if(!file){ onError&&onError("ファイルが選ばれていません。"); return; }
    if(maxMB&&file.size>maxMB*1024*1024){
      onError&&onError(`ファイルが大きすぎます（${maxMB}MBまで／選んだのは${(file.size/1048576).toFixed(1)}MB）。`); return;
    }
    const r=new FileReader();
    r.onerror=()=>onError&&onError("ファイルを読み込めませんでした。別の画像でお試しください。");
    r.onload=()=>onDone(r.result);
    r.readAsDataURL(file);
  },

  blankChar(){
    return {id:null,name:"",portrait:"◆",portraitImage:null,description:"",custom:true,bgm:"tension",
      stats:{hp:1200,atk:130,def:85,spd:100},
      skills:[], passives:[],
      awakening:{enabled:true,name:"覚醒形態",conditionMode:"ANY",
        conditions:[{type:"HP_BELOW",value:0.4,label:"HPが40%以下になる"}],
        form:{stats:{atk:190,def:95,spd:125},skills:[],effects:[],portraitImage:null,portrait:""},
        duration:4,oneTime:true,cost:{hpPerTurn:50,label:""},afterEffects:[]}};
  },

  /* ---------- 開く ---------- */
  openCharacter(id, copyFrom, opts){
    opts=opts||{};
    if(id){ this.editingId=id; this.draft=JSON.parse(JSON.stringify(CHARACTERS[id])); }
    else if(copyFrom){ this.editingId=null; this.draft=JSON.parse(JSON.stringify(copyFrom));
      this.draft.id=null; this.draft.custom=true; this.draft.name=(copyFrom.name||"")+"の写し"; }
    else { this.editingId=null; this.draft=this.blankChar(); }
    this.normalize();
    this.step=opts.step||0; this.visited={0:true}; this.dirty=false; this.lastPhoto=null;
    this.renderShell();
    UI.show("edit");
  },
  /* 下書きの取りこぼしを埋める。古い形のキャラを開いても落ちないように */
  normalize(){
    const d=this.draft, blank=this.blankChar();
    if(!d.stats) d.stats={...blank.stats};
    ["hp","atk","def","spd"].forEach(k=>{ if(!(d.stats[k]>0)) d.stats[k]=blank.stats[k]; });
    if(!Array.isArray(d.skills)) d.skills=[];
    d.skills=d.skills.filter(id=>SKILLS[id]&&id!=="basic_attack");
    if(!d.awakening) d.awakening=blank.awakening;
    const a=d.awakening;
    if(!a.form) a.form={stats:{...d.stats},skills:[],effects:[]};
    if(!a.form.stats) a.form.stats={...d.stats};
    ["atk","def","spd"].forEach(k=>{ if(!(a.form.stats[k]>0)) a.form.stats[k]=d.stats[k]; });
    if(!Array.isArray(a.form.skills)) a.form.skills=[];
    /* 覚醒形態の立ち絵。未設定なら通常の立ち絵をそのまま使う（後方互換） */
    if(a.form.portraitImage===undefined) a.form.portraitImage=null;
    if(typeof a.form.portrait!=="string") a.form.portrait="";
    a.form.skills=a.form.skills.filter(id=>SKILLS[id]&&id!=="basic_attack");
    if(!Array.isArray(a.conditions)||!a.conditions.length) a.conditions=blank.awakening.conditions;
    if(!a.cost) a.cost={hpPerTurn:0,label:""};
    if(!(a.duration>0)) a.duration=4;
    if(!d.bgm||!BGM[d.bgm]) d.bgm=Object.keys(BGM)[0];
  },
  resumeDraft(saved){
    this.draft=saved.draft; this.editingId=saved.editingId||null;
    this.normalize();
    this.step=Math.min(this.STEPS.length-1,saved.step||0);
    this.visited={}; for(let i=0;i<=this.step;i++) this.visited[i]=true;
    this.dirty=true; this.lastPhoto=null;
    this.renderShell();
    UI.show("edit");
  },
  touch(){
    this.dirty=true;
    const r=Store.saveDraft({draft:this.draft,editingId:this.editingId,step:this.step});
    const dot=$("#e-draft");
    if(dot) dot.textContent=r.ok?"下書き保存済み":"下書きを端末に保存できません";
    if(dot) dot.classList.toggle("bad",!r.ok);
  },

  /* ---------- ウィザードの枠 ---------- */
  /* 画面上部・下部の常設ボタンを結ぶ。描き直すたびに繋ぎ直しても害はない。 */
  bindChrome(){
    const leave=$("#e-leave"); if(leave) leave.onclick=()=>this.leave();
    const disc=$("#e-discard"); if(disc) disc.onclick=()=>this.discard();
    const kl=$("#k-leave"); if(kl) kl.onclick=()=>this.closeSkill();
  },
  renderShell(){
    this.bindChrome();
    $("#edit-title").textContent=this.editingId?"キャラクター編集":"キャラクター作成";
    const steps=$("#e-steps");
    steps.innerHTML=this.STEPS.map((s,i)=>{
      const state=i===this.step?"cur":(this.visited[i]?"done":"todo");
      return `<button class="wstep ${state}" data-step="${i}" aria-current="${i===this.step}">
        <span class="wsi">${s.icon}</span><span class="wsl">${s.label}</span></button>`;
    }).join("");
    steps.querySelectorAll("[data-step]").forEach(b=>b.onclick=()=>this.goStep(+b.dataset.step));
    $("#e-prog").style.transform=`scaleX(${(this.step+1)/this.STEPS.length})`;
    this.renderStep();
  },
  goStep(i){
    if(i===this.step) return;
    if(i>this.step){
      const bad=this.stepProblem(this.step);
      if(bad){ Kit.toast(bad,{tone:"bad"}); return; }
    }
    this.step=Math.max(0,Math.min(this.STEPS.length-1,i));
    this.visited[this.step]=true;
    this.touch();
    const body=$("#edit-body");
    body.classList.remove("slide"); void body.offsetWidth; body.classList.add("slide");
    this.renderShell();
    window.scrollTo({top:0,behavior:Kit.reduced()?"auto":"smooth"});
    Kit.buzz(6);
  },
  /* その段階で先へ進めない理由（無ければ null） */
  stepProblem(i){
    const d=this.draft;
    if(i===0&&!String(d.name||"").trim()) return "名前を入れてください。";
    if(i===1){
      const B=BALANCE.build, used=this.pointsOf(d.stats);
      if(used>B.budget) return `ポイントが${used-B.budget}超過しています。`;
      if(d.stats.hp<B.minHp) return `HPは${B.minHp}以上にしてください。`;
      for(const k of ["atk","def","spd"]) if(d.stats[k]<B.minStat) return `${k.toUpperCase()}は${B.minStat}以上にしてください。`;
    }
    if(i===2&&!d.skills.length) return "技を1つ以上選んでください。";
    if(i===3&&d.awakening.enabled){
      const cap=d.stats.atk+d.stats.def+d.stats.spd+BALANCE.build.awakenBonus;
      const sum=this.awakenPoints(d.awakening.form.stats);
      if(sum>cap) return `覚醒後の合計が${sum-cap}超過しています。`;
    }
    return null;
  },
  renderStep(){
    const key=this.STEPS[this.step].key;
    const body=$("#edit-body");
    body.innerHTML=this["step_"+key]();
    this["bind_"+key]();
    this.renderFoot();
    /* 入力欄がキーボードに隠れないよう、触れたら真ん中まで寄せる */
    body.querySelectorAll("input,textarea,select").forEach(el=>{
      el.addEventListener("focus",()=>setTimeout(()=>{
        try{ el.scrollIntoView({block:"center",behavior:Kit.reduced()?"auto":"smooth"}); }catch(e){}
      },220));
    });
  },
  renderFoot(){
    const last=this.step===this.STEPS.length-1;
    const foot=$("#e-foot");
    foot.innerHTML=`
      <button class="btn btn-line" id="e-prev" ${this.step===0?"disabled":""}>戻る</button>
      <button class="btn btn-gold" id="e-next">${last?'<span class="ic">\u2694</span>\u4fdd\u5b58\u3057\u3066\u6226\u3046':"\u6b21\u3078"}</button>`;
    $("#e-prev").onclick=()=>this.goStep(this.step-1);
    $("#e-next").onclick=()=>{ if(last) this.saveCharacter({fight:true}); else this.goStep(this.step+1); };
  },
  async leave(){
    if(!this.dirty){ Store.clearDraft(); UI.renderRoster(); UI.show("roster"); return; }
    const ok=await Kit.confirm({title:"作成をやめますか",
      body:"ここまでの内容は下書きとして残ります。一覧から続きを作れます。",
      ok:"下書きにして戻る",cancel:"作成を続ける"});
    if(!ok) return;
    this.touch();
    UI.renderRoster(); UI.show("roster");
  },
  async discard(){
    const ok=await Kit.confirm({title:"下書きを捨てますか",body:"この作りかけは元に戻せません。",
      ok:"捨てる",cancel:"やめる",danger:true});
    if(!ok) return;
    Store.clearDraft(); this.dirty=false; this.draft=null;
    Kit.toast("下書きを捨てました。");
    UI.renderRoster(); UI.show("roster");
  },

  /* ================= 1. 姿 ================= */
  step_look(){
    const d=this.draft;
    return `
      <div class="glass preview livecard"><div class="pv-head">
        ${UI.avatar(d,"84")}
        <div style="min-width:0"><div class="pv-name">${esc(d.name||"名もなき者")}</div>
        <div class="pv-desc">${esc(d.description||"ひとことで言うと、どんな者ですか")}</div></div></div></div>
      <p class="steplead">${this.STEPS[0].hint}</p>
      <div class="fld"><label for="e-name">名前</label>
        <input type="text" id="e-name" maxlength="14" enterkeyhint="next" autocomplete="off"
          placeholder="例：斬鉄丸" value="${esc(d.name)}"></div>
      <div class="fld"><label for="e-desc">ひとこと説明</label>
        <input type="text" id="e-desc" maxlength="40" enterkeyhint="done" autocomplete="off"
          placeholder="例：追い詰められてから本気を出す前衛。" value="${esc(d.description||"")}"></div>

      <div class="h-rule">立ち絵</div>
      <div class="portrow">
        <div class="portprev">${UI.avatar(d,"72")}</div>
        <div class="portacts">
          <label class="btn btn-line filebtn" for="e-file"><span class="ic">▣</span>${d.portraitImage?"画像を選び直す":"画像を選ぶ"}
            <input type="file" id="e-file" accept="image/*" style="display:none"></label>
          ${d.portraitImage?`<button class="btn btn-line" id="e-file-edit">切り抜き直す</button>
            <button class="btn btn-ghost" id="e-file-clear">画像を外す</button>`:""}
        </div>
      </div>
      <p class="note">選んだあと、指でずらして・つまんで拡大して切り抜けます。大きすぎる画像は自動で軽くします。</p>
      ${d.portraitImage?"":`<div class="fld" style="margin-top:10px"><label for="e-portrait">画像がないときの一文字</label>
        <input type="text" id="e-portrait" maxlength="2" inputmode="text" value="${esc(d.portrait||"")}" placeholder="◆">
        <div class="emojirow">${["⚔","✦","☾","❁","☠","⛨","➶","✹","❄","⚡","◐","☯"].map(e=>
          `<button type="button" class="emo${d.portrait===e?" on":""}" data-emo="${e}">${e}</button>`).join("")}</div></div>`}
      <div id="e-file-err" class="err"></div>

      <div class="h-rule">対戦BGM</div>
      <p class="note">ここで設定した曲は、あなたと戦う相手の画面で流れます。</p>
      <div class="bgmrow">
        <div class="fld" style="flex:1"><label for="e-bgm">曲</label><select id="e-bgm">
          ${Object.keys(BGM).map(k=>`<option value="${k}" ${d.bgm===k?"selected":""}>${BGM[k].name}</option>`).join("")}
        </select></div>
        <button class="btn btn-line" id="e-bgm-test" aria-label="試聴">▶ 試聴</button>
      </div>
      <div class="upload" style="margin-top:9px">
        <label class="btn btn-line filebtn" for="e-audio"><span class="ic">♪</span>音楽ファイルを使う
          <input type="file" id="e-audio" accept="audio/*" style="display:none"></label>
        ${d.bgmAudio?`<button class="btn btn-ghost" id="e-audio-clear" style="width:auto">外す</button>
          <span class="hint">${esc(d.bgmAudioName||"設定済み")}</span>`:`<span class="hint">端末内に保存されます。曲まるごとでも入ります。</span>`}
      </div>`;
  },
  bind_look(){
    const d=this.draft;
    const live=()=>{
      const card=$("#edit-body .livecard");
      if(!card) return;
      card.querySelector(".pv-name").textContent=d.name||"名もなき者";
      card.querySelector(".pv-desc").textContent=d.description||"ひとことで言うと、どんな者ですか";
    };
    $("#e-name").oninput=e=>{ d.name=e.target.value; live(); this.touch(); };
    $("#e-desc").oninput=e=>{ d.description=e.target.value; live(); this.touch(); };
    const p=$("#e-portrait");
    if(p){
      p.oninput=e=>{ d.portrait=e.target.value||"◆"; this.touch();
        $$("#edit-body .emo").forEach(b=>b.classList.toggle("on",b.dataset.emo===d.portrait));
        const av=$("#edit-body .livecard .av"); if(av&&!d.portraitImage) av.textContent=d.portrait; };
      $$("#edit-body .emo").forEach(b=>b.onclick=()=>{ d.portrait=b.dataset.emo; this.touch(); this.renderStep(); });
    }
    $("#e-file").onchange=ev=>{
      const f=ev.target.files&&ev.target.files[0];
      ev.target.value="";
      this.readFile(f,url=>{
        this.lastPhoto=url;
        Cropper.open(url,cropped=>{ d.portraitImage=cropped; this.touch(); this.renderStep(); });
      },msg=>{ $("#e-file-err").textContent=msg; Kit.toast(msg,{tone:"bad"}); },48);
    };
    const ed=$("#e-file-edit");
    if(ed) ed.onclick=()=>Cropper.open(this.lastPhoto||d.portraitImage,c=>{ d.portraitImage=c; this.touch(); this.renderStep(); });
    const clr=$("#e-file-clear");
    if(clr) clr.onclick=async()=>{
      if(!await Kit.confirm({title:"画像を外しますか",body:"切り抜いた立ち絵は消えます。",ok:"外す",cancel:"やめる",danger:true})) return;
      d.portraitImage=null; this.touch(); this.renderStep();
    };
    $("#e-bgm").onchange=e=>{ d.bgm=e.target.value; this.touch(); };
    $("#e-bgm-test").onclick=()=>{ Music.preview($("#e-bgm").value); Kit.toast("8秒だけ流します。"); };
    $("#e-audio").onchange=ev=>{
      const f=ev.target.files&&ev.target.files[0];
      ev.target.value="";
      this.readFile(f,url=>{ d.bgmAudio=url; d.bgmAudioName=f.name; this.touch(); this.renderStep();
        Kit.toast("この曲を使います。"); },
        msg=>{ $("#e-file-err").textContent=msg; Kit.toast(msg,{tone:"bad"}); },64);
    };
    const ac=$("#e-audio-clear");
    if(ac) ac.onclick=()=>{ d.bgmAudio=null; d.bgmAudioName=null; this.touch(); this.renderStep(); };
  },

  /* ================= 2. 能力 ================= */
  PRESETS:[
    {key:"balance",label:"均衡",  stats:{hp:1300,atk:130,def:90,spd:110}, note:"どこも尖らない基準の形"},
    {key:"power",  label:"一撃",  stats:{hp:1100,atk:200,def:70,spd:100}, note:"殴り勝つ。打たれ弱い"},
    {key:"tank",   label:"耐久",  stats:{hp:1700,atk:105,def:130,spd:85}, note:"耐えて削る。決め手に欠ける"},
    {key:"speed",  label:"速攻",  stats:{hp:1150,atk:150,def:75,spd:150}, note:"先手を取り続ける"}
  ],
  statRow(k){
    const d=this.draft, st=d.stats;
    const min=this.minOf(k), max=STAT_MAX[k], cap=this.capOf(k,st), v=st[k];
    const pct=(v-min)/(max-min)*100, cpct=(cap-min)/(max-min)*100;
    const LBL={hp:"HP",atk:"ATK",def:"DEF",spd:"SPD"};
    const DESC={hp:"倒れるまでの余裕",atk:"与えるダメージ",def:"受けるダメージの軽さ",spd:"先に動ける度合い"};
    const step=k==="hp"?BALANCE.build.hpPerPoint:1;
    return `<div class="statrow" data-k="${k}">
      <div class="srhead"><span class="srl">${LBL[k]}<em>${DESC[k]}</em></span>
        <span class="srv" id="sv-${k}">${v}</span></div>
      <div class="srctl">
        <button class="stepbtn" data-d="-1" aria-label="${LBL[k]}を下げる">−</button>
        <div class="srtrack" id="st-${k}" role="slider" tabindex="0"
             aria-label="${LBL[k]}" aria-valuemin="${min}" aria-valuemax="${cap}" aria-valuenow="${v}">
          <div class="srcap" style="transform:scaleX(${(cpct/100).toFixed(4)})"></div>
          <div class="srfill" style="transform:scaleX(${(Math.max(0,pct)/100).toFixed(4)})"></div>
          <div class="srknob" style="left:${Math.max(0,Math.min(100,pct))}%"></div>
        </div>
        <button class="stepbtn" data-d="1" aria-label="${LBL[k]}を上げる">＋</button>
      </div>
      <div class="srfoot"><span>最低 ${min}</span><span>いま使える上限 ${cap}${cap<max?"（残ポイント）":""}</span></div>
    </div>`.replace("__step__",step);
  },
  step_stats(){
    const d=this.draft, B=BALANCE.build;
    return `<p class="steplead">${this.STEPS[1].hint}　合計${B.budget}ポイント。HPは${B.hpPerPoint}で1ポイントです。</p>
      <div class="budget" id="e-budget"></div>
      <div class="presetrow">${this.PRESETS.map(p=>
        `<button class="preset" data-p="${p.key}"><b>${p.label}</b><span>${p.note}</span></button>`).join("")}</div>
      <div class="sliders" id="e-sliders">${["hp","atk","def","spd"].map(k=>this.statRow(k)).join("")}</div>
      <div class="h-rule">ほかのキャラと比べる</div>
      <div id="e-compare"></div>`;
  },
  bind_stats(){
    this.bindSliders("#e-sliders",()=>this.draft.stats,(k,v)=>{ this.draft.stats[k]=v; },()=>{
      /* 指を動かすたびに作り直すと重いので、1フレームに1回だけまとめる */
      if(this._cmpRaf) return;
      this._cmpRaf=requestAnimationFrame(()=>{ this._cmpRaf=0; this.updateBudget(); this.renderCompare(); });
    });
    $$("#edit-body .preset").forEach(b=>b.onclick=()=>{
      const p=this.PRESETS.find(x=>x.key===b.dataset.p);
      Object.assign(this.draft.stats,p.stats);
      this.touch(); Kit.buzz(12);
      this.renderStep();
      Kit.toast(`「${p.label}」の配分にしました。ここから微調整できます。`);
    });
    this.updateBudget(); this.renderCompare();
  },
  /* スライダー群の共通配線。getStats は今の値、setStat は書き戻し。 */
  bindSliders(sel,getStats,setStat,after){
    const host=$(sel);
    host.querySelectorAll(".statrow").forEach(row=>{
      const k=row.dataset.k;
      const step=k==="hp"?BALANCE.build.hpPerPoint:1;
      const apply=v=>{
        const st=getStats();
        v=Math.round(v/step)*step;
        if(v===st[k]) return;
        setStat(k,v);
        this.paintRow(row,k,getStats());
        this.touch();
        after&&after();
      };
      const track=row.querySelector(".srtrack");
      const st=getStats();
      const sl=Kit.slider({host:track,value:st[k],min:this.minOf(k),max:STAT_MAX[k],
        cap:this.capOf(k,st),step,onInput:apply});
      row._sl=sl;
      row.querySelectorAll(".stepbtn").forEach(b=>{
        const d=+b.dataset.d;
        const bump=()=>{
          const s=getStats(), cap=this.capOf(k,s), next=s[k]+d*step;
          if(next>cap||next<this.minOf(k)){ Kit.buzz(18); track.classList.add("wall");
            setTimeout(()=>track.classList.remove("wall"),220); return; }
          Kit.buzz(5); apply(next);
        };
        b.onclick=bump;
      });
    });
  },
  paintRow(row,k,stats){
    const min=this.minOf(k), max=STAT_MAX[k], cap=this.capOf(k,stats), v=stats[k];
    const pct=Math.max(0,Math.min(100,(v-min)/(max-min)*100));
    const cpct=Math.max(0,Math.min(100,(cap-min)/(max-min)*100));
    row.querySelector(".srv").textContent=v;
    row.querySelector(".srfill").style.transform=`scaleX(${(pct/100).toFixed(4)})`;
    row.querySelector(".srknob").style.left=pct+"%";
    row.querySelector(".srcap").style.transform=`scaleX(${(cpct/100).toFixed(4)})`;
    const tr=row.querySelector(".srtrack");
    tr.setAttribute("aria-valuenow",v); tr.setAttribute("aria-valuemax",cap);
    row.querySelector(".srfoot").lastElementChild.textContent=
      `いま使える上限 ${cap}${cap<max?"（残ポイント）":""}`;
    if(row._sl) row._sl.update({value:v,cap});
    /* ほかの行の上限も残ポイントで動くので描き直す */
    row.parentElement.querySelectorAll(".statrow").forEach(o=>{
      if(o===row) return;
      const ok=o.dataset.k, ocap=this.capOf(ok,stats), omax=STAT_MAX[ok], omin=this.minOf(ok);
      o.querySelector(".srcap").style.transform=`scaleX(${(Math.max(0,Math.min(100,(ocap-omin)/(omax-omin)*100))/100).toFixed(4)})`;
      o.querySelector(".srfoot").lastElementChild.textContent=
        `いま使える上限 ${ocap}${ocap<omax?"（残ポイント）":""}`;
      if(o._sl) o._sl.update({cap:ocap});
    });
  },
  updateBudget(){
    const B=BALANCE.build, st=this.draft.stats;
    const used=this.pointsOf(st), rest=B.budget-used;
    const pct=Math.max(0,Math.min(100,used/B.budget*100));
    const rank=this.rankOf(st);
    $("#e-budget").innerHTML=`
      <div class="bg-top"><span>残りポイント</span>
        <span class="bg-rest ${rest<0?"over":rest===0?"zero":""}">${rest}</span></div>
      <div class="bg-track"><div class="bg-fill ${rest<0?"over":""}" style="transform:scaleX(${(pct/100).toFixed(4)})"></div></div>
      <div class="bg-sub"><span>${used} / ${B.budget} 使用${rest<0?`　<b class="warn">${-rest}超過しています</b>`:rest===0?"　<b class='ok'>ぴったり使い切りました</b>":""}</span>
        <span class="bg-rank r-${rank.k}">${rank.k}<em>${esc(this.archetype(st))}</em></span></div>`;
  },
  renderCompare(){
    const st=this.draft.stats;
    const score=this.powerScore(st), base=this.baselineScore();
    const ratio=score/base;
    const pct=Math.round(ratio*100);
    const near=this.nearestChar(st);
    const rank=this.rankOf(st);
    let verdict, tone;
    if(ratio>1.18){ verdict="強すぎる寄り。対戦相手が嫌がる形です。"; tone="hot"; }
    else if(ratio>1.05){ verdict="やや強め。押し切れる形です。"; tone="ok"; }
    else if(ratio>=0.92){ verdict="ちょうど良い。既存キャラと渡り合えます。"; tone="ok"; }
    else if(ratio>=0.8){ verdict="やや控えめ。技でおぎなう形です。"; tone="warn"; }
    else { verdict="弱め。ポイントが余っていないか確かめてください。"; tone="bad"; }
    const off=Math.round(st.atk*(1+st.spd/200)), tank=Math.round(st.hp*(1+st.def/200));
    const bars=["hp","atk","def","spd"].map(k=>{
      const mine=st[k], theirs=near?near.stats[k]:mine;
      const mp=Math.min(100,mine/STAT_MAX[k]*100), tp=Math.min(100,theirs/STAT_MAX[k]*100);
      return `<div class="cmp"><span class="cl">${k.toUpperCase()}</span>
        <span class="ct"><span class="cf" style="transform:scaleX(${(mp/100).toFixed(3)})"></span>
        <span class="cmark" style="left:${tp}%"></span></span>
        <span class="cv">${mine}<em>${theirs}</em></span></div>`;
    }).join("");
    $("#e-compare").innerHTML=`
      <div class="shapebox t-${tone}">
        ${this.radar(st,near?near.stats:null,146)}
        <div class="sb-side">
          <div class="rankbadge r-${rank.k}"><b>${rank.k}</b></div>
          <div class="sb-title">${esc(this.archetype(st))}</div>
          <div class="sb-note">${esc(verdict)}</div>
          <div class="sb-kv"><span>目安の強さ <b>${pct}%</b></span>
            <span>攻め ${off}</span><span>守り ${tank}</span></div>
        </div>
      </div>
      <div class="cmpbox">${bars}</div>
      <p class="note">${near?`白い線と薄い形が「${esc(near.name)}」の値です。`:""}100%が既存キャラの平均です。</p>`;
  },

  /* ================= 3. 技 ================= */
  skillCard(s,checked,group){
    const eff=(s.effects||[]).map(e=>`${e.icon||effIcon(e)}${esc(e.name||"")}`).join(" ");
    const meta=[];
    if(s.power>0) meta.push("威力"+s.power);
    if(s.hits>1) meta.push(s.hits+"回");
    if(s.priority>0) meta.push("先制"+s.priority);
    if(s.guardBreak) meta.push("防御貫通");
    if(s.healPercent) meta.push("回復"+s.healPercent+"%");
    if(s.drain) meta.push("吸収"+Math.round(s.drain*100)+"%");
    if(s.costMax) meta.push("SP"+s.cost+"〜"+s.costMax);
    if(s.uses) meta.push("残"+s.uses+"回");
    return `<label class="skcard t-${s.type}${checked?" on":""}">
      <input type="checkbox" data-group="${group}" value="${s.id}" ${checked?"checked":""}>
      <span class="skc-body">
        <span class="skc-top"><b>${esc(s.name)}</b>
          <span class="cost">SP${s.cost}${s.costMax?"〜"+s.costMax:""}</span></span>
        <span class="skc-d">${esc(s.description||"")}</span>
        <span class="skc-meta">${[TYPE_LABEL[s.type]||"技"].concat(meta).map(m=>`<span class="mchip">${esc(m)}</span>`).join("")}
          ${eff?`<span class="mchip hot">${eff}</span>`:""}
          ${s.custom?`<span class="mchip">自作</span>`:""}</span>
      </span></label>`;
  },
  skillPickerHtml(selected,group,filterId){
    const list=Object.values(SKILLS).filter(s=>s.id!=="basic_attack");
    const types=[["all","すべて"],["ATTACK","攻撃"],["SPECIAL","特殊"],["DEFENSE","防御"],["SUPPORT","補助"],["custom","自作"]];
    return `<div class="filterrow" id="${filterId}">${types.map((t,i)=>
        `<button class="fchip${i===0?" on":""}" data-f="${t[0]}">${t[1]}</button>`).join("")}</div>
      <div class="skgrid" data-group="${group}">${list.map(s=>this.skillCard(s,selected.includes(s.id),group)).join("")}</div>`;
  },
  bindSkillPicker(group,filterId,onChange){
    const grid=$(`#edit-body .skgrid[data-group="${group}"]`);
    grid.querySelectorAll("input[type=checkbox]").forEach(cb=>{
      cb.onchange=()=>{
        cb.closest(".skcard").classList.toggle("on",cb.checked);
        Kit.buzz(5);
        onChange($$(`#edit-body .skgrid[data-group="${group}"] input:checked`).map(x=>x.value));
      };
    });
    $$("#"+filterId+" .fchip").forEach(b=>b.onclick=()=>{
      $$("#"+filterId+" .fchip").forEach(o=>o.classList.remove("on"));
      b.classList.add("on");
      const f=b.dataset.f;
      grid.querySelectorAll(".skcard").forEach(card=>{
        const s=SKILLS[card.querySelector("input").value];
        const hit=f==="all"||(f==="custom"?!!s.custom:s.type===f);
        card.style.display=hit?"":"none";
      });
    });
  },
  step_skills(){
    const d=this.draft;
    return `<p class="steplead">${this.STEPS[2].hint}　選んだ技はそのまま戦闘のコマンドになります。</p>
      <div id="e-sk-sum"></div>
      <button class="btn btn-line" id="e-mkskill" style="margin:12px 0"><span class="ic">✚</span>足りない技を自分で作る</button>
      ${this.skillPickerHtml(d.skills,"normal","e-skfilter")}`;
  },
  bind_skills(){
    this.bindSkillPicker("normal","e-skfilter",ids=>{ this.draft.skills=ids; this.touch(); this.skillSummary(); });
    $("#e-mkskill").onclick=()=>{ this.touch(); this.returnTo="edit"; this.openSkill(); };
    this.skillSummary();
  },
  skillSummary(){
    const ids=this.draft.skills, sp=BALANCE.sp;
    const list=ids.map(id=>SKILLS[id]).filter(Boolean);
    if(!list.length){
      $("#e-sk-sum").innerHTML=`<div class="status bad">まだ技を選んでいません。1つ以上選ぶと先へ進めます。</div>`;
      return;
    }
    const cheap=list.filter(s=>s.cost<=sp.regenPerTurn).length;
    const heavy=list.filter(s=>s.cost>=5).length;
    const kinds=new Set(list.map(s=>s.type));
    const tips=[];
    if(!cheap) tips.push(`毎ターン回復するSPは${sp.regenPerTurn}です。SP${sp.regenPerTurn}以下の技が1つもないと手が止まります。`);
    if(!kinds.has("DEFENSE")&&!kinds.has("SUPPORT")) tips.push("攻め手だけの構成です。守りや補助を1つ入れると粘れます。");
    if(heavy>=3) tips.push("重い技が多めです。SPが足りず撃てない場面が増えます。");
    if(list.length>6) tips.push("技が多すぎると戦闘中に選びにくくなります。4〜5個が目安です。");
    $("#e-sk-sum").innerHTML=`
      <div class="sumcard">
        <div class="sum-top"><b>${list.length}個</b>の技を選んでいます</div>
        <div class="sum-chips">${list.map(s=>`<span class="mchip">${esc(s.name)} SP${s.cost}</span>`).join("")}</div>
        ${tips.length?`<div class="sum-tips">${tips.map(t=>`<div>・${esc(t)}</div>`).join("")}</div>`
          :`<div class="sum-tips ok">・軽い技と重い技のバランスが取れています。</div>`}
      </div>`;
  },

  /* ================= 4. 覚醒 ================= */
  CONDS:{
    HP_BELOW:{label:"HPが減ったら",unit:"%",min:10,max:90,step:5,hint:"追い詰められてから開く形"},
    DAMAGE_TAKEN:{label:"累計ダメージを受けたら",unit:"ダメージ",min:100,max:2000,step:50,hint:"殴られた量で開く形"},
    SKILL_USED:{label:"特定の技を使ったら",unit:"回",min:1,max:9,step:1,hint:"積み重ねて開く形"},
    TURN_REACHED:{label:"ターンが経ったら",unit:"ターン",min:1,max:20,step:1,hint:"長期戦で開く形"}
  },
  condValue(){
    const c=this.draft.awakening.conditions[0];
    return c.type==="HP_BELOW"?Math.round((c.value||0.4)*100):Math.round(c.value||1);
  },
  condLabel(){
    const a=this.draft.awakening, c=a.conditions[0], v=this.condValue();
    if(c.type==="HP_BELOW") return `HPが${v}%以下になる`;
    if(c.type==="DAMAGE_TAKEN") return `累計${v}ダメージを受ける`;
    if(c.type==="SKILL_USED") return `「${(SKILLS[c.skillId]||{}).name||"技"}」を${v}回使う`;
    return `${v}ターン経過する`;
  },
  step_awaken(){
    const d=this.draft, a=d.awakening;
    if(!a.enabled){
      return `<p class="steplead">${this.STEPS[3].hint}</p>
        <label class="bigtoggle"><input type="checkbox" id="e-awk">
          <span class="bt-body"><b>覚醒を使えるようにする</b>
          <span>条件を満たすと技セットとステータスが丸ごと入れ替わります。代償つき。</span></span></label>
        <div class="status" style="margin-top:12px">覚醒なしでも戦えます。あとから付け足すこともできます。</div>`;
    }
    const cap=d.stats.atk+d.stats.def+d.stats.spd+BALANCE.build.awakenBonus;
    const cd=this.CONDS[a.conditions[0].type]||this.CONDS.HP_BELOW;
    const v=this.condValue();
    return `<p class="steplead">${this.STEPS[3].hint}</p>
      <label class="bigtoggle on"><input type="checkbox" id="e-awk" checked>
        <span class="bt-body"><b>覚醒を使えるようにする</b>
        <span>条件を満たすと光ります。切るタイミングはプレイヤーが決めます。</span></span></label>
      <div class="fld" style="margin-top:12px"><label for="e-awkname">覚醒形態の名前</label>
        <input type="text" id="e-awkname" maxlength="16" value="${esc(a.name||"")}" placeholder="例：鬼神・開眼"></div>

      <div class="h-rule">覚醒時の立ち絵</div>
      <p class="note">覚醒した瞬間、この絵に切り替わります。決めなければ通常の立ち絵のままです。</p>
      ${this.awakenPortraitHtml()}
      <div id="e-awkimg-err" class="err"></div>

      <div class="h-rule">開く条件</div>
      <div class="condgrid">${Object.keys(this.CONDS).map(k=>
        `<button class="condbtn${a.conditions[0].type===k?" on":""}" data-c="${k}">
          <b>${this.CONDS[k].label}</b><span>${this.CONDS[k].hint}</span></button>`).join("")}</div>
      <div class="fld" style="margin-top:10px"><label for="e-condval">条件の値（${cd.unit}）</label>
        <div class="numrow">
          <button class="stepbtn" id="e-cv-m" aria-label="減らす">−</button>
          <input type="number" id="e-condval" inputmode="numeric" pattern="[0-9]*"
            min="${cd.min}" max="${cd.max}" step="${cd.step}" value="${v}">
          <button class="stepbtn" id="e-cv-p" aria-label="増やす">＋</button>
        </div></div>
      ${a.conditions[0].type==="SKILL_USED"?`<div class="fld"><label for="e-condskill">対象の技</label>
        <select id="e-condskill">${Object.values(SKILLS).filter(s=>s.id!=="basic_attack").map(s=>
          `<option value="${s.id}" ${a.conditions[0].skillId===s.id?"selected":""}>${esc(s.name)}</option>`).join("")}</select></div>`:""}
      <div class="status ok" id="e-condview">開く条件：${esc(this.condLabel())}</div>

      <div class="h-rule">覚醒後のステータス</div>
      <div class="budget" id="e-abudget"></div>
      <div class="sliders" id="e-asliders">${["atk","def","spd"].map(k=>this.awakenRow(k,cap)).join("")}</div>

      <div class="h-rule">代償</div>
      <div class="grid2">
        <div class="fld"><label for="e-adur">持続ターン</label>
          <input type="number" id="e-adur" inputmode="numeric" pattern="[0-9]*" min="1" max="20" value="${a.duration}"></div>
        <div class="fld"><label for="e-acost">毎ターンのHP減少</label>
          <input type="number" id="e-acost" inputmode="numeric" pattern="[0-9]*" min="0" max="300" step="5" value="${(a.cost&&a.cost.hpPerTurn)||0}"></div>
      </div>
      <label class="pickrow" style="margin-top:9px"><input type="checkbox" id="e-aonce" ${a.oneTime?"checked":""}>
        <span class="pn">戦闘中1回だけにする</span></label>
      <div class="status" id="e-costview" style="margin-top:10px"></div>

      <div class="h-rule">覚醒形態の技</div>
      <p class="note">選ばなければ通常形態と同じ技になります。</p>
      ${this.skillPickerHtml(a.form.skills,"awake","e-akfilter")}`;
  },
  /* 覚醒形態の姿。未設定なら通常の姿をそのまま見せる。 */
  awakenFace(){
    const d=this.draft, f=d.awakening.form;
    return {portraitImage:f.portraitImage||d.portraitImage||null,
      portrait:f.portrait||d.portrait||"◆"};
  },
  awakenPortraitHtml(){
    const f=this.draft.awakening.form;
    const set=!!f.portraitImage;
    return `<div class="portrow">
      <div class="portprev">${UI.avatar(this.awakenFace(),"72","awkface")}
        ${set?"":`<span class="portsame">通常と同じ</span>`}</div>
      <div class="portacts">
        <label class="btn btn-line filebtn" for="e-awkfile"><span class="ic">▣</span>${set?"画像を選び直す":"覚醒用の画像を選ぶ"}
          <input type="file" id="e-awkfile" accept="image/*" style="display:none"></label>
        ${set?`<button class="btn btn-line" id="e-awkfile-edit">切り抜き直す</button>
          <button class="btn btn-ghost" id="e-awkfile-clear">通常の絵に戻す</button>`:""}
      </div>
    </div>
    ${set?"":`<div class="fld" style="margin-top:10px"><label for="e-awkportrait">画像がないときの一文字</label>
      <input type="text" id="e-awkportrait" maxlength="2" value="${esc(f.portrait||"")}" placeholder="通常と同じ">
      <div class="emojirow">${["⚔","✦","☾","❁","☠","⛨","➶","✹","❄","⚡","◐","☯"].map(e=>
        `<button type="button" class="emo${f.portrait===e?" on":""}" data-aemo="${e}">${e}</button>`).join("")}</div></div>`}`;
  },
  bindAwakenPortrait(){
    const f=this.draft.awakening.form;
    const err=m=>{ const b=$("#e-awkimg-err"); if(b) b.textContent=m||""; };
    const file=$("#e-awkfile");
    if(file) file.onchange=ev=>{
      const x=ev.target.files&&ev.target.files[0];
      ev.target.value="";
      err("");
      this.readFile(x,url=>{
        this.lastAwkPhoto=url;
        Cropper.open(url,cropped=>{ f.portraitImage=cropped; this.touch(); this.renderStep();
          Kit.toast("覚醒したらこの絵に変わります。",{tone:"ok"}); });
      },msg=>{ err(msg); Kit.toast(msg,{tone:"bad"}); },12);
    };
    const ed=$("#e-awkfile-edit");
    if(ed) ed.onclick=()=>Cropper.open(this.lastAwkPhoto||f.portraitImage,
      c=>{ f.portraitImage=c; this.touch(); this.renderStep(); });
    const clr=$("#e-awkfile-clear");
    if(clr) clr.onclick=async()=>{
      if(!await Kit.confirm({title:"覚醒用の絵を外しますか",
        body:"覚醒しても通常の立ち絵のままになります。",ok:"外す",cancel:"やめる",danger:true})) return;
      f.portraitImage=null; this.touch(); this.renderStep();
    };
    const t=$("#e-awkportrait");
    if(t) t.oninput=e=>{ f.portrait=e.target.value; this.touch();
      $$("#edit-body .emo[data-aemo]").forEach(b=>b.classList.toggle("on",b.dataset.aemo===f.portrait));
      const av=$("#edit-body .awkface"); if(av&&!f.portraitImage) av.textContent=f.portrait||this.draft.portrait||"◆"; };
    $$("#edit-body .emo[data-aemo]").forEach(b=>b.onclick=()=>{
      f.portrait=(f.portrait===b.dataset.aemo)?"":b.dataset.aemo; this.touch(); this.renderStep();
    });
  },
  awakenRow(k,cap){
    const a=this.draft.awakening, st=a.form.stats;
    const min=BALANCE.build.minStat, max=STAT_MAX[k];
    const rest=cap-this.awakenPoints(st);
    const lim=Math.min(max,st[k]+Math.max(0,rest));
    const v=st[k], pct=(v-min)/(max-min)*100, cpct=(lim-min)/(max-min)*100;
    const LBL={atk:"ATK",def:"DEF",spd:"SPD"};
    const before=this.draft.stats[k];
    const diff=v-before;
    return `<div class="statrow" data-k="${k}">
      <div class="srhead"><span class="srl">${LBL[k]}<em>通常時 ${before}</em></span>
        <span class="srv" id="sv-a${k}">${v}<i class="${diff>=0?"up":"dn"}">${diff>=0?"+":""}${diff}</i></span></div>
      <div class="srctl">
        <button class="stepbtn" data-d="-1" aria-label="${LBL[k]}を下げる">−</button>
        <div class="srtrack" role="slider" tabindex="0" aria-label="覚醒後の${LBL[k]}"
             aria-valuemin="${min}" aria-valuemax="${lim}" aria-valuenow="${v}">
          <div class="srcap" style="transform:scaleX(${(cpct/100).toFixed(4)})"></div>
          <div class="srfill" style="transform:scaleX(${(Math.max(0,pct)/100).toFixed(4)})"></div>
          <div class="srknob" style="left:${Math.max(0,Math.min(100,pct))}%"></div>
        </div>
        <button class="stepbtn" data-d="1" aria-label="${LBL[k]}を上げる">＋</button>
      </div>
      <div class="srfoot"><span>最低 ${min}</span><span>いま使える上限 ${lim}</span></div>
    </div>`;
  },
  bind_awaken(){
    const d=this.draft, a=d.awakening;
    $("#e-awk").onchange=e=>{ a.enabled=e.target.checked; this.touch(); this.renderStep(); };
    if(!a.enabled) return;
    $("#e-awkname").oninput=e=>{ a.name=e.target.value; this.touch(); };
    this.bindAwakenPortrait();
    $$("#edit-body .condbtn").forEach(b=>b.onclick=()=>{
      const t=b.dataset.c, cd=this.CONDS[t];
      a.conditions[0]={type:t,value:t==="HP_BELOW"?0.4:cd.min,skillId:a.conditions[0].skillId||Object.keys(SKILLS)[1]};
      this.touch(); this.renderStep();
    });
    const cd=this.CONDS[a.conditions[0].type];
    const cv=$("#e-condval");
    const setCv=n=>{
      n=Math.max(cd.min,Math.min(cd.max,Math.round(n/cd.step)*cd.step));
      cv.value=n;
      a.conditions[0].value=a.conditions[0].type==="HP_BELOW"?n/100:n;
      a.conditions[0].label=this.condLabel();
      $("#e-condview").textContent="開く条件："+this.condLabel();
      this.touch();
    };
    cv.oninput=()=>{ const n=Number(cv.value); if(!isNaN(n)) { a.conditions[0].value=a.conditions[0].type==="HP_BELOW"?n/100:n;
      a.conditions[0].label=this.condLabel(); $("#e-condview").textContent="開く条件："+this.condLabel(); this.touch(); } };
    cv.onblur=()=>setCv(Number(cv.value)||cd.min);
    $("#e-cv-m").onclick=()=>{ Kit.buzz(5); setCv((Number(cv.value)||cd.min)-cd.step); };
    $("#e-cv-p").onclick=()=>{ Kit.buzz(5); setCv((Number(cv.value)||cd.min)+cd.step); };
    const cs=$("#e-condskill");
    if(cs) cs.onchange=()=>{ a.conditions[0].skillId=cs.value; a.conditions[0].label=this.condLabel();
      $("#e-condview").textContent="開く条件："+this.condLabel(); this.touch(); };

    const cap=()=>d.stats.atk+d.stats.def+d.stats.spd+BALANCE.build.awakenBonus;
    const host=$("#e-asliders");
    host.querySelectorAll(".statrow").forEach(row=>{
      const k=row.dataset.k;
      const limOf=()=>Math.min(STAT_MAX[k],a.form.stats[k]+Math.max(0,cap()-this.awakenPoints(a.form.stats)));
      const paint=()=>{
        const min=BALANCE.build.minStat,max=STAT_MAX[k],v=a.form.stats[k],lim=limOf();
        const pct=Math.max(0,Math.min(100,(v-min)/(max-min)*100));
        row.querySelector(".srv").innerHTML=`${v}<i class="${v-d.stats[k]>=0?"up":"dn"}">${v-d.stats[k]>=0?"+":""}${v-d.stats[k]}</i>`;
        row.querySelector(".srfill").style.transform=`scaleX(${(pct/100).toFixed(4)})`;
        row.querySelector(".srknob").style.left=pct+"%";
        host.querySelectorAll(".statrow").forEach(o=>{
          const ok=o.dataset.k, ol=Math.min(STAT_MAX[ok],a.form.stats[ok]+Math.max(0,cap()-this.awakenPoints(a.form.stats)));
          o.querySelector(".srcap").style.transform=
            `scaleX(${(Math.max(0,Math.min(100,(ol-BALANCE.build.minStat)/(STAT_MAX[ok]-BALANCE.build.minStat)*100))/100).toFixed(4)})`;
          o.querySelector(".srfoot").lastElementChild.textContent=`いま使える上限 ${ol}`;
          if(o._sl) o._sl.update({cap:ol});
        });
        if(row._sl) row._sl.update({value:v,cap:lim});
        this.updateAwakenBudget();
      };
      const apply=v=>{
        v=Math.round(v);
        if(v===a.form.stats[k]) return;
        a.form.stats[k]=v; paint(); this.touch();
      };
      const track=row.querySelector(".srtrack");
      row._sl=Kit.slider({host:track,value:a.form.stats[k],min:BALANCE.build.minStat,max:STAT_MAX[k],
        cap:limOf(),step:1,onInput:apply});
      row.querySelectorAll(".stepbtn").forEach(b=>{
        const dd=+b.dataset.d;
        b.onclick=()=>{
          const next=a.form.stats[k]+dd;
          if(next>limOf()||next<BALANCE.build.minStat){ Kit.buzz(18); track.classList.add("wall");
            setTimeout(()=>track.classList.remove("wall"),220); return; }
          Kit.buzz(5); apply(next);
        };
      });
    });
    const costView=()=>{
      const dur=Number($("#e-adur").value)||1, hp=Number($("#e-acost").value)||0;
      const total=dur*hp;
      $("#e-costview").innerHTML=`${dur}ターン持続${hp?`／毎ターンHP-${hp}`:""}${$("#e-aonce").checked?"／戦闘中1回だけ":""}
        ${total?`<br><span class="note">覚醒しきると合計 ${total} のHPを支払います（最大HPの${Math.round(total/d.stats.hp*100)}%）。</span>`:""}`;
    };
    $("#e-adur").oninput=()=>{ a.duration=Math.max(1,Math.min(20,Number($("#e-adur").value)||1)); costView(); this.touch(); };
    $("#e-acost").oninput=()=>{ a.cost.hpPerTurn=Math.max(0,Number($("#e-acost").value)||0); costView(); this.touch(); };
    $("#e-aonce").onchange=()=>{ a.oneTime=$("#e-aonce").checked; costView(); this.touch(); };
    costView();
    this.bindSkillPicker("awake","e-akfilter",ids=>{ a.form.skills=ids; this.touch(); });
    this.updateAwakenBudget();
  },
  updateAwakenBudget(){
    const d=this.draft, a=d.awakening;
    const cap=d.stats.atk+d.stats.def+d.stats.spd+BALANCE.build.awakenBonus;
    const used=this.awakenPoints(a.form.stats), rest=cap-used;
    const pct=Math.max(0,Math.min(100,used/cap*100));
    $("#e-abudget").innerHTML=`
      <div class="bg-top"><span>覚醒に残る伸びしろ</span>
        <span class="bg-rest ${rest<0?"over":rest===0?"zero":""}">${rest}</span></div>
      <div class="bg-track"><div class="bg-fill ${rest<0?"over":""}" style="transform:scaleX(${(pct/100).toFixed(4)})"></div></div>
      <div class="bg-sub">ATK+DEF+SPD ${used} / ${cap}（通常時の合計＋${BALANCE.build.awakenBonus}まで）</div>`;
  },

  /* ================= 5. 確認 ================= */
  /* 覚醒したあとの姿も1枚で見せる。ここで「作った」という実感が決まる。 */
  finaleHtml(){
    const d=this.draft, a=d.awakening;
    const near=this.nearestChar(d.stats);
    const rank=this.rankOf(d.stats);
    const skills=d.skills.map(id=>SKILLS[id]).filter(Boolean);
    const awkStats=a.enabled?a.form.stats:null;
    const nums=["hp","atk","def","spd"].map(k=>{
      const up=awkStats&&k!=="hp"?awkStats[k]-d.stats[k]:0;
      return `<div class="fn"><span>${STAT_LABEL[k]}</span><b>${d.stats[k]}</b>
        ${up?`<em class="${up>0?"up":"dn"}">${up>0?"+":""}${up}</em>`:""}</div>`;
    }).join("");
    const awkSkills=a.enabled?(a.form.skills.length?a.form.skills:d.skills).map(id=>SKILLS[id]).filter(Boolean):[];
    return `<div class="finale r-${rank.k}" id="e-finale">
      <i class="fin-sweep" aria-hidden="true"></i>
      <div class="fin-top">
        <div class="fin-port">${UI.avatar(d,"96")}</div>
        <div class="fin-id">
          <div class="rankbadge r-${rank.k}"><b>${rank.k}</b><i>${esc(rank.note)}</i></div>
          <div class="fin-name">${esc(d.name||"名もなき者")}</div>
          <div class="fin-title">${esc(this.archetype(d.stats))}</div>
        </div>
      </div>
      <div class="fin-desc">${esc(d.description||"ひとことの説明はありません。")}</div>
      <div class="fin-mid">${this.radar(d.stats,near?near.stats:null,140)}
        <div class="fin-nums">${nums}</div></div>
      <div class="fin-sec"><span class="fs-k">技</span>
        <span class="fs-v">${skills.map(x=>
          `<span class="mchip t-${x.type}">${esc(x.name)}<em>SP${x.cost}</em></span>`).join("")||"なし"}</span></div>
      ${a.enabled?`<div class="fin-awk">
        <div class="fa-h"><span class="fa-k">覚醒</span><b>${esc(a.name||"覚醒形態")}</b></div>
        <div class="fa-r"><span>開く条件</span><span>${esc(this.condLabel())}</span></div>
        <div class="fa-r"><span>代償</span><span>${esc(this.costLabel())}</span></div>
        <div class="fa-r"><span>覚醒中の技</span><span>${awkSkills.map(x=>esc(x.name)).join("・")||"通常と同じ"}</span></div>
        ${a.form.portraitImage||a.form.portrait?`<div class="fa-face">${UI.avatar(this.awakenFace(),"56")}
          <span>覚醒するとこの姿になります</span></div>`:""}
      </div>`:`<div class="fin-sec"><span class="fs-k">覚醒</span><span class="fs-v">なし</span></div>`}
    </div>`;
  },
  step_check(){
    const d=this.draft, B=BALANCE.build;
    const checks=[
      {ok:!!String(d.name||"").trim(),t:"名前をつけた",step:0},
      {ok:this.pointsOf(d.stats)<=B.budget,t:`ポイントが${B.budget}以内`,step:1},
      {ok:d.stats.hp>=B.minHp&&["atk","def","spd"].every(k=>d.stats[k]>=B.minStat),t:"最低値を満たしている",step:1},
      {ok:d.skills.length>0,t:"技を選んだ",step:2},
      {ok:!d.awakening.enabled||this.awakenPoints(d.awakening.form.stats)<=d.stats.atk+d.stats.def+d.stats.spd+B.awakenBonus,
        t:"覚醒後の伸びしろが範囲内",step:3}
    ];
    const ng=checks.filter(c=>!c.ok).length;
    return `<p class="steplead">${this.STEPS[4].hint}</p>
      ${this.finaleHtml()}
      <div class="h-rule">できているか</div>
      <div class="checks">${checks.map(c=>
        `<button class="chk ${c.ok?"ok":"ng"}" data-jump="${c.step}">
          <span class="ci">${c.ok?"✓":"！"}</span><span>${esc(c.t)}</span>
          ${c.ok?"":`<em>直す</em>`}</button>`).join("")}</div>
      <div id="edit-err" class="err"></div>
      ${ng?"":`<p class="note" style="margin-top:10px">下の「保存して戦う」で、このキャラのまま試し斬りが始まります。</p>`}
      <button class="btn btn-line" id="e-saveonly" style="margin-top:10px">保存だけして一覧に戻る</button>`;
  },
  bind_check(){
    $$("#edit-body .chk").forEach(b=>b.onclick=()=>this.goStep(+b.dataset.jump));
    $("#e-saveonly").onclick=()=>this.saveCharacter();
    /* 完成の一枚は毎回きちんと「立ち上がる」 */
    const fin=$("#e-finale");
    if(fin&&!Kit.reduced()){
      fin.classList.remove("reveal"); void fin.offsetWidth; fin.classList.add("reveal");
      Kit.buzz([8,60,14]);
    }
  },
  costLabel(){
    const a=this.draft.awakening, hp=(a.cost&&a.cost.hpPerTurn)||0;
    const pc=(a.cost||{}).hpPercentPerTurn;
    return `${a.duration}ターン持続${pc?`／毎ターン最大HPの${pc.minPercent}〜${pc.maxPercent}%`:(hp?`／毎ターンHP-${hp}`:"")}${a.oneTime?"／戦闘中1回だけ":""}`;
  },

  /* ---------- 保存 ---------- */
  saveCharacter(opt){
    opt=opt||{};
    const d=this.draft, B=BALANCE.build, err=[];
    d.name=String(d.name||"").trim();
    if(!d.name) err.push("名前を入力してください。");
    if(d.stats.hp<B.minHp) err.push(`HPは${B.minHp}以上にしてください。`);
    ["atk","def","spd"].forEach(k=>{ if(d.stats[k]<B.minStat) err.push(`${k.toUpperCase()}は${B.minStat}以上にしてください。`); });
    const used=this.pointsOf(d.stats);
    if(used>B.budget) err.push(`ポイントが${used-B.budget}超過しています。`);
    if(!d.skills.length) err.push("技を1つ以上選んでください。");
    const a=d.awakening;
    if(a.enabled){
      const cap=d.stats.atk+d.stats.def+d.stats.spd+B.awakenBonus;
      if(this.awakenPoints(a.form.stats)>cap) err.push(`覚醒後の合計が${this.awakenPoints(a.form.stats)-cap}超過しています。`);
    }
    if(err.length){
      const box=$("#edit-err"); if(box) box.textContent=err.join(" ");
      Kit.toast(err[0],{tone:"bad"});
      return;
    }
    d.portrait=String(d.portrait||"◆").slice(0,2)||"◆";
    d.custom=true;
    a.conditions=[{type:a.conditions[0].type,value:a.conditions[0].value,
      skillId:a.conditions[0].skillId,label:this.condLabel()}];
    a.conditionMode="ANY";
    a.name=String(a.name||"").trim()||"覚醒形態";
    a.form.portrait=String(a.form.portrait||"").slice(0,2);
    if(!a.form.portraitImage) a.form.portraitImage=null;
    a.form.skills=a.form.skills.length?a.form.skills:d.skills.slice();
    const pc=(a.cost||{}).hpPercentPerTurn;
    a.cost={hpPerTurn:(a.cost&&a.cost.hpPerTurn)||0,label:this.costLabel()};
    if(pc) a.cost.hpPercentPerTurn=pc;

    const id=this.editingId||("c_"+Date.now().toString(36));
    d.id=id;
    const prev=CHARACTERS[id];
    CHARACTERS[id]=d;
    const res=Store.save();
    if(!res.ok){
      if(prev) CHARACTERS[id]=prev; else delete CHARACTERS[id];
      this.reportSaveFail(res,d);
      return;
    }
    Store.clearDraft();
    this.dirty=false;
    UI.renderRoster();
    if(opt.fight){ UI.startWith(id); return; }
    UI.show("roster");
    Kit.toast(`「${d.name}」を保存しました。`,{tone:"ok"});
    Kit.buzz([10,40,16]);
  },
  /* 保存に失敗したら必ず理由と逃げ道を出す。黙って消えるのが一番まずい。 */
  reportSaveFail(res,d){
    const heavy=d&&d.portraitImage;
    if(res.reason==="quota"){
      Kit.confirm({title:"端末の空きが足りません",
        body:heavy?"立ち絵を外すと入ることがあります。外して保存し直しますか？（ファイルに書き出せば立ち絵ごと残せます）"
                  :"ほかのキャラクターを整理するか、ファイルに書き出してから消してください。",
        ok:heavy?"立ち絵を外して保存":"わかった",cancel:"やめる",danger:true}).then(ok=>{
        if(ok&&heavy){ this.draft.portraitImage=null; this.saveCharacter(); }
      });
    }else if(res.reason==="unavailable"){
      Kit.toast("この環境では端末に保存できません。アプリを閉じるまでは残ります。ファイルに書き出してください。",{tone:"bad",ms:6000});
    }else{
      Kit.toast("保存できませんでした。ファイルに書き出して残してください。",{tone:"bad",ms:6000});
    }
  },

  /* =========================================================================
     技づくり。プリセットから始めて、直した結果を実戦で確かめられるようにする。
     ========================================================================= */
  blankSkill(){
    return {id:null,name:"",description:"",type:"ATTACK",power:40,accuracy:95,cost:1,priority:0,
      hits:1,formula:"standard",guardBreak:false,buffPierce:false,cleanse:false,
      costMax:0,powerPerSp:0,durationPerSp:0,varyPercent:0,healPercent:0,drain:0,uses:0,
      sfxId:null,custom:true};
  },
  skillPresets(){
    /* プリセットは技カタログから拾う。D が技を足せばここも自動で増える。 */
    const want=["sw_slash","mg_flame","sw_read","mg_ward","as_poison","mk_heal"];
    const picked=want.map(id=>SKILLS[id]).filter(Boolean);
    const rest=Object.values(SKILLS).filter(s=>s.id!=="basic_attack"&&!s.custom&&picked.indexOf(s)<0);
    const byType={};
    rest.forEach(s=>{ if(!byType[s.type]) byType[s.type]=s; });
    return picked.concat(Object.values(byType)).slice(0,6);
  },
  openSkill(editId){
    this.skillEditId=editId||null;
    if(editId&&SKILLS[editId]){
      this.skill=JSON.parse(JSON.stringify(SKILLS[editId]));
      this.effects=(this.skill.effects||[]).map(e=>this.effectToDraft(e));
    }else{
      this.skill=this.blankSkill();
      this.effects=[];
    }
    this.sfxInfo=null;
    this.bindChrome();
    this.renderSkill();
    UI.show("skill");
  },
  /* 保存済みの効果をエディタの持ち方に戻す */
  effectToDraft(e){
    let key=Object.keys(STATUS).find(k=>STATUS[k].name===e.name&&STATUS[k].kind===e.kind);
    if(!key) key=Object.keys(STATUS).find(k=>STATUS[k].kind===e.kind&&(!e.stat||STATUS[k].stat===e.stat));
    if(!key) key=Object.keys(STATUS)[0];
    const st=STATUS[key];
    let amount=null;
    if(st.kind==="STAT") amount=e.mult;
    else if(st.percent!=null) amount=e.percent;
    else if(st.kind==="COUNTER") amount=e.ratio;
    else if(st.value!=null) amount=e.value;
    return {key,target:e.target||"enemy",chance:e.chance!=null?Math.round(e.chance*100):100,
      duration:e.duration!=null?e.duration:null,amount:amount!=null?amount:null};
  },
  renderSkill(){
    const s=this.skill;
    $("#skill-title").textContent=this.skillEditId?"技を直す":"技をつくる";
    $("#skill-body").innerHTML=`
      <div class="h-rule">もとにする技</div>
      <div class="presetscroll">${this.skillPresets().map(p=>
        `<button class="presetcard" data-preset="${p.id}">
          <b>${esc(p.name)}</b><span>${esc((p.description||"").slice(0,22))}</span>
          <em>${TYPE_LABEL[p.type]||"技"}・SP${p.cost}</em></button>`).join("")}
        <button class="presetcard blank" data-preset=""><b>まっさらから</b><span>ぜんぶ自分で決める</span><em>自由</em></button>
      </div>

      <div id="k-forge" class="forgecard"></div>
      <div class="fld"><label for="k-name">技名</label>
        <input type="text" id="k-name" maxlength="14" value="${esc(s.name)}" placeholder="例：雷撃"></div>
      <div class="fld"><label for="k-desc">説明</label>
        <input type="text" id="k-desc" maxlength="40" value="${esc(s.description||"")}" placeholder="戦闘中に表示される一文"></div>
      <div class="grid2">
        <div class="fld"><label for="k-type">タイプ</label><select id="k-type">
          ${Object.keys(TYPE_LABEL).map(t=>`<option value="${t}" ${s.type===t?"selected":""}>${TYPE_LABEL[t]}</option>`).join("")}
        </select></div>
        <div class="fld"><label for="k-formula">ダメージ計算</label><select id="k-formula">
          ${[["standard","通常（ATK＋威力－DEF）"],["ignoreDef","防御無視"],["fixed","固定ダメージ"],
             ["maxHpRatio","最大HP割合（威力＝%）"],["currentHpRatio","現在HP割合（威力＝%）"],["spdBased","SPD依存"]]
            .map(f=>`<option value="${f[0]}" ${s.formula===f[0]?"selected":""}>${f[1]}</option>`).join("")}
        </select></div>
      </div>
      <div class="grid4">
        ${[["k-power","威力",s.power,0,300],["k-acc","命中",s.accuracy,25,100],
           ["k-cost","SP",s.cost,0,BALANCE.sp.max],["k-prio","優先度",s.priority,0,5]].map(f=>
          `<div class="fld"><label for="${f[0]}">${f[1]}</label>
            <input type="number" id="${f[0]}" class="ksim" inputmode="numeric" pattern="[0-9]*"
              min="${f[3]}" max="${f[4]}" value="${f[2]}"></div>`).join("")}
      </div>

      <details class="adv"><summary>もっと細かく決める</summary>
        <div class="h-rule">SPの注ぎ込み</div>
        <p class="note">最大SPを基本SPより大きくすると、使うたびに「いくら注ぎ込むか」を選べる技になります。</p>
        <div class="grid3" style="margin-top:8px">
          ${[["k-costmax","最大SP",s.costMax||0],["k-perpow","SP1ごとの威力",s.powerPerSp||0],
             ["k-perdur","SP1ごとの持続T",s.durationPerSp||0]].map(f=>
            `<div class="fld"><label for="${f[0]}">${f[1]}</label>
              <input type="number" id="${f[0]}" class="ksim" inputmode="numeric" pattern="[0-9]*" min="0" value="${f[2]}"></div>`).join("")}
        </div>
        <div class="grid4" style="margin-top:8px">
          ${[["k-hits","攻撃回数",s.hits||1],["k-vary","ばらつき%",s.varyPercent||0],
             ["k-heal","回復%",s.healPercent||0],["k-drain","吸収%",Math.round((s.drain||0)*100)]].map(f=>
            `<div class="fld"><label for="${f[0]}">${f[1]}</label>
              <input type="number" id="${f[0]}" class="ksim" inputmode="numeric" pattern="[0-9]*" min="0" value="${f[2]}"></div>`).join("")}
        </div>
        <div class="fld" style="margin-top:8px"><label for="k-uses">使用回数（0=無制限）</label>
          <input type="number" id="k-uses" class="ksim" inputmode="numeric" pattern="[0-9]*" min="0" value="${s.uses||0}"></div>
        <div class="grid2" style="margin-top:8px">
          <label class="pickrow"><input type="checkbox" id="k-gb" class="ksim" ${s.guardBreak?"checked":""}><span class="pn">防御貫通</span></label>
          <label class="pickrow"><input type="checkbox" id="k-bp" class="ksim" ${s.buffPierce?"checked":""}><span class="pn">バフ貫通</span></label>
        </div>
        <label class="pickrow" style="margin-top:8px"><input type="checkbox" id="k-cleanse" class="ksim" ${s.cleanse?"checked":""}>
          <span class="pn">自分の効果を全解除</span></label>
      </details>

      <div class="h-rule">効果音</div>
      <p class="note">この技を撃ったときに鳴らす音です。${Math.round(Media.MAX_BYTES/1024)}KB・${(Media.MAX_MS/1000).toFixed(0)}秒までの
        ${Media.EXT.join("／")}が使えます。音は端末の中だけに残ります。</p>
      <div id="k-sfx"></div>
      <div id="k-sfx-err" class="err"></div>

      <div class="h-rule">状態異常・効果</div>
      <p class="note">好きなだけ組み合わせられます。成功率を100%未満にすると運要素のある技になります。</p>
      <div class="stack" id="k-efflist"></div>
      <button class="btn btn-line" id="k-addeff"><span class="ic">✚</span>カタログから効果を足す</button>

      <div class="h-rule">実戦での振る舞い</div>
      <div id="k-sim" class="simbox"><div class="note">数値を入れると、ここで実際に戦わせて結果を出します。</div></div>
      <div id="skill-err" class="err"></div>`;

    $("#skill-foot").innerHTML=`
      <button class="btn btn-line" id="k-cancel">やめる</button>
      <button class="btn btn-gold" id="k-save">${this.skillEditId?"上書き保存":"技を保存する"}</button>`;

    $$("#skill-body [data-preset]").forEach(b=>b.onclick=()=>this.applyPreset(b.dataset.preset));
    $("#k-addeff").onclick=()=>this.openEffectPicker(null);
    $("#k-save").onclick=()=>this.saveSkill();
    $("#k-cancel").onclick=()=>this.closeSkill();
    $$("#skill-body .ksim").forEach(el=>{
      el.addEventListener("input",()=>this.queueSim());
      el.addEventListener("change",()=>this.queueSim());
    });
    $("#k-type").onchange=()=>this.simulate();
    $("#k-formula").onchange=()=>this.simulate();
    ["k-name","k-desc"].forEach(id=>{
      const el=$("#"+id);
      if(el) el.oninput=()=>this.paintForge(this.collectSkill());
    });
    $("#skill-body").querySelectorAll("input,textarea,select").forEach(el=>{
      el.addEventListener("focus",()=>setTimeout(()=>{
        try{ el.scrollIntoView({block:"center",behavior:Kit.reduced()?"auto":"smooth"}); }catch(e){}
      },220));
    });
    this.renderEffects();
    this.renderSfx();
    this.simulate();
  },

  /* ---------- 技の効果音 ----------
     実体は IndexedDB（Media）に置き、技には参照IDだけ持たせる。
     鳴らすのは担当Bの Music.previewSfx。無ければ試聴ボタンを出さない。 */
  canPreviewSfx(){ return typeof Music!=="undefined"&&typeof Music.previewSfx==="function"; },
  renderSfx(){
    const box=$("#k-sfx");
    if(!box) return;
    if(!Media.supported()){
      box.innerHTML=`<div class="status bad">${esc(Media.reason())}</div>`;
      return;
    }
    const id=this.skill.sfxId;
    if(!id){
      box.innerHTML=`<div class="upload">
        <label class="btn btn-line filebtn" for="k-sfxfile"><span class="ic">♪</span>音を選ぶ
          <input type="file" id="k-sfxfile" accept="audio/*,.mp3,.m4a,.ogg,.wav" style="display:none"></label>
        <span class="hint">選ばなければ、いつもの音のまま鳴ります。</span></div>`;
      this.bindSfxFile();
      return;
    }
    const info=this.sfxInfo&&this.sfxInfo.id===id?this.sfxInfo:null;
    box.innerHTML=`<div class="sfxrow">
        <span class="sx-i">♪</span>
        <span class="sx-t"><b>${esc(info?info.name:"設定済み")}</b>
          <span>${info?`${(info.bytes/1024).toFixed(0)}KB${info.durationMs?" ／ "+(info.durationMs/1000).toFixed(1)+"秒":""}`:"読み込み中…"}</span></span>
        ${this.canPreviewSfx()?`<button class="btn btn-line" id="k-sfxplay">▶ 試聴</button>`:""}
      </div>
      <div class="upload" style="margin-top:8px">
        <label class="btn btn-line filebtn" for="k-sfxfile"><span class="ic">▣</span>選び直す
          <input type="file" id="k-sfxfile" accept="audio/*,.mp3,.m4a,.ogg,.wav" style="display:none"></label>
        <button class="btn btn-ghost" id="k-sfxclear" style="width:auto">音を外す</button>
        ${this.canPreviewSfx()?"":`<span class="hint">この版では試聴できません。戦闘中には鳴ります。</span>`}
      </div>`;
    this.bindSfxFile();
    const play=$("#k-sfxplay");
    if(play) play.onclick=()=>{
      try{ Music.previewSfx(id); }
      catch(e){ Kit.toast("音を鳴らせませんでした。",{tone:"bad"}); }
    };
    const clr=$("#k-sfxclear");
    if(clr) clr.onclick=()=>{
      const old=this.skill.sfxId;
      this.skill.sfxId=null; this.sfxInfo=null; this.renderSfx(); this.paintForge(this.collectSkill());
      Kit.toast("効果音を外しました。",{action:{label:"取り消す",fn:()=>{
        this.skill.sfxId=old; this.renderSfx(); this.loadSfxInfo(); this.paintForge(this.collectSkill()); }}});
    };
    if(!info) this.loadSfxInfo();
  },
  loadSfxInfo(){
    const id=this.skill.sfxId;
    if(!id) return;
    Media.info(id).then(info=>{
      if(this.skill.sfxId!==id) return;
      if(!info){
        this.skill.sfxId=null; this.sfxInfo=null; this.renderSfx();
        Kit.toast("設定されていた音が端末に見つかりませんでした。選び直してください。",{tone:"bad",ms:5000});
        return;
      }
      this.sfxInfo=info; this.renderSfx();
    }).catch(()=>{});
  },
  bindSfxFile(){
    const el=$("#k-sfxfile");
    if(!el) return;
    el.onchange=ev=>{
      const f=ev.target.files&&ev.target.files[0];
      ev.target.value="";
      const err=$("#k-sfx-err");
      if(err) err.textContent="";
      if(!f) return;
      const box=$("#k-sfx");
      if(box) box.innerHTML=`<div class="status">音を読み込んでいます…</div>`;
      const prev=this.skill.sfxId;
      Media.putFile(f).then(info=>{
        this.skill.sfxId=info.id;
        this.sfxInfo=info;
        this.renderSfx();
        this.paintForge(this.collectSkill());
        Kit.buzz(12);
        Kit.toast(`「${info.name}」を鳴らします。`,{tone:"ok"});
        if(prev&&prev!==info.id) this.releaseSfx(prev);
      }).catch(e=>{
        this.renderSfx();
        const msg=(e&&e.message)||"音を保存できませんでした。";
        if(err) err.textContent=msg;
        Kit.toast(msg,{tone:"bad",ms:5500});
      });
    };
  },
  /* どの技からも参照されなくなった音は消す */
  releaseSfx(id){
    if(!id) return;
    const used=Object.keys(SKILLS).some(k=>SKILLS[k]&&SKILLS[k].sfxId===id);
    if(!used) Media.remove(id);
  },

  applyPreset(id){
    const base=id?SKILLS[id]:null;
    if(base){
      const c=JSON.parse(JSON.stringify(base));
      const sfx=this.skill.sfxId;
      this.skill=Object.assign(this.blankSkill(),c,{id:this.skill.id,custom:true,sfxId:sfx||c.sfxId||null,
        name:(this.skill.name||"").trim()||c.name+"・改"});
      this.effects=(c.effects||[]).map(e=>this.effectToDraft(e));
      Kit.toast(`「${base.name}」をもとにしました。ここから好きに変えられます。`);
    }else{
      const keep=this.skill.name, sfx=this.skill.sfxId;
      this.skill=this.blankSkill(); this.skill.name=keep; this.skill.sfxId=sfx||null;
      this.effects=[];
      Kit.toast("まっさらに戻しました。");
    }
    Kit.buzz(8);
    this.renderSkill();
  },
  closeSkill(){
    const back=this.returnTo;
    this.returnTo="roster";
    if(back==="edit"&&this.draft){ this.renderShell(); UI.show("edit"); }
    else { UI.renderRoster(); UI.show("roster"); }
  },
  newEffect(key){
    const st=STATUS[key];
    return {key, target:(st.tone==="good"?"self":"enemy"),
      chance:st.chance!=null?Math.round(st.chance*100):100, duration:null, amount:null};
  },
  amountField(st){
    if(st.kind==="STAT") return {label:"倍率",step:"0.05",def:st.mult};
    if(st.percent!=null) return {label:"最大HP%",step:"1",def:st.percent};
    if(st.kind==="COUNTER") return {label:"返す割合",step:"0.1",def:st.ratio};
    if(st.value!=null) return {label:"数値",step:"1",def:st.value};
    return null;
  },

  /* ---------- 効果カタログ ----------
     並びは 03-status.js から自動で作る。行を足せばここにも勝手に出る。 */
  EFF_GROUPS:[
    {label:"じわじわ削る", note:"ターンをまたいで効く",   kinds:["DOT"]},
    {label:"守りと粘り",   note:"倒れにくくする",         kinds:["SHIELD","REGEN","ENDURE","NEGATE","COUNTER"]},
    {label:"動きを止める", note:"相手のターンを奪う",     kinds:["STUN","SLEEP","PETRIFY","PARALYZE","TIMESTOP","CONFUSE","SILENCE"]},
    {label:"能力をいじる", note:"殴り合いの土俵を変える", kinds:["STAT","ACC","CRIT"]},
    {label:"理を曲げる",   note:"ルールそのものを崩す",   kinds:["PIERCE","HEALBLOCK","TIMESKIP","EXTRA","INVERT"]}
  ],
  effGroups(){
    const out=this.EFF_GROUPS.map(g=>({label:g.label,note:g.note,keys:[]}));
    const used={};
    Object.keys(STATUS).forEach(k=>{
      const i=this.EFF_GROUPS.findIndex(g=>g.kinds.indexOf(STATUS[k].kind)>=0);
      if(i>=0){ out[i].keys.push(k); used[k]=1; }
    });
    const rest=Object.keys(STATUS).filter(k=>!used[k]);
    if(rest.length) out.push({label:"そのほか",note:"",keys:rest});
    return out.filter(g=>g.keys.length);
  },
  openEffectPicker(replaceIndex){
    const groups=this.effGroups();
    const card=k=>{
      const st=STATUS[k];
      return `<button class="effpick t-${st.tone}" data-key="${k}" data-q="${esc(st.name+" "+statusNote(st))}">
        <span class="ep-i">${st.icon}</span>
        <span class="ep-t"><b>${esc(st.name)}</b><span>${esc(statusNote(st))}</span></span>
        <span class="ep-side">${st.tone==="good"?"自分に":"相手に"}</span></button>`;
    };
    const html=`<div class="effsearch"><input type="search" id="ep-q" placeholder="効果を探す（毒・止める…）"
        aria-label="効果を探す" autocomplete="off"></div>
      <div id="ep-list">${groups.map(g=>`<div class="epgrp">
        <div class="epg-h">${esc(g.label)}${g.note?`<em>${esc(g.note)}</em>`:""}</div>
        <div class="epg-b">${g.keys.map(card).join("")}</div></div>`).join("")}</div>
      <p class="note" id="ep-empty" style="display:none">見つかりませんでした。別の言葉でお試しください。</p>`;
    const sheet=Kit.sheet({title:replaceIndex!=null?"効果を差し替える":"効果を足す",
      sub:"組み合わせるほど、技の個性が立ちます",html,
      onMount:(body,close)=>{
        body.querySelectorAll(".effpick").forEach(b=>b.onclick=()=>{
          const ef=this.newEffect(b.dataset.key);
          if(replaceIndex!=null) this.effects[replaceIndex]=ef; else this.effects.push(ef);
          close();
          Kit.buzz(12);
          this.renderEffects();
          this.simulate();
          Kit.toast(`「${STATUS[b.dataset.key].name}」を入れました。数値はこのあと変えられます。`);
        });
        const q=body.querySelector("#ep-q");
        q.oninput=()=>{
          const t=q.value.trim().toLowerCase();
          let hit=0;
          body.querySelectorAll(".effpick").forEach(b=>{
            const ok=!t||b.dataset.q.toLowerCase().indexOf(t)>=0;
            b.style.display=ok?"":"none";
            if(ok) hit++;
          });
          body.querySelectorAll(".epgrp").forEach(g=>{
            g.style.display=Array.from(g.querySelectorAll(".effpick")).some(b=>b.style.display!=="none")?"":"none";
          });
          body.querySelector("#ep-empty").style.display=hit?"none":"";
        };
      }});
    return sheet;
  },
  /* いま設定されている効果を、数字込みの日本語1行にする */
  effLine(ef){
    const st=STATUS[ef.key];
    if(!st) return "";
    const who=ef.target==="self"?"自分":"相手";
    const instant=INSTANT_KINDS.indexOf(st.kind)>=0;
    const dur=instant?0:(ef.duration!=null?ef.duration:(st.duration||1));
    const amt=ef.amount!=null?ef.amount:null;
    const HP=1300;                                   // 試算に使う仮のHP
    let core;
    if(st.kind==="DOT"||st.kind==="REGEN"){
      const per=st.percent!=null
        ? Math.round(HP*(amt!=null?amt:st.percent)/100)
        : Math.round(amt!=null?amt:st.value);
      const verb=st.kind==="DOT"?"ダメージ":"回復";
      core=`毎ターン約${per}${verb}／${dur}ターンで合計およそ${per*dur}`;
    }else if(st.kind==="STAT"){
      const m=amt!=null?amt:st.mult;
      core=`${STAT_LABEL[st.stat]||""}が${m}倍のまま${dur}ターン`;
    }else if(st.kind==="SHIELD"){
      core=`${Math.round(amt!=null?amt:st.value)}ダメージを肩代わり（${dur}ターン）`;
    }else if(st.kind==="COUNTER"){
      core=`受けたダメージの${amt!=null?amt:st.ratio}倍を返す（${dur}ターン）`;
    }else{
      core=statusNote(st)+(dur?`（${dur}ターン）`:"");
    }
    const ch=ef.chance<100?`${ef.chance}%の確率で`:"";
    return `${ch}${who}に「${st.name}」：${core}`;
  },
  renderEffects(){
    const box=$("#k-efflist");
    if(!this.effects.length){
      box.innerHTML=`<button class="effadd" id="k-addeff-empty">
        <span class="ea-i">✧</span>
        <span class="ea-t"><b>効果はまだありません</b>
        <span>毒・障壁・スタン・能力変化などを組み合わせられます。</span></span></button>`;
      const b=$("#k-addeff-empty");
      if(b) b.onclick=()=>this.openEffectPicker(null);
      return;
    }
    box.innerHTML=this.effects.map((ef,i)=>{
      const st=STATUS[ef.key];
      const amt=this.amountField(st);
      const instant=INSTANT_KINDS.indexOf(st.kind)>=0;
      const dur=ef.duration!=null?ef.duration:(st.duration||1);
      return `<div class="effrow t-${st.tone}">
        <div class="eh"><span class="ei">${st.icon}</span><b>${esc(st.name)}</b>
          <button class="btn btn-ghost effswap" data-swap="${i}">別の効果に</button>
          <button class="btn btn-ghost effdel" data-del="${i}" aria-label="${esc(st.name)}を削除">削除</button></div>
        <div class="ed" id="efl-${i}">${esc(this.effLine(ef))}</div>
        <div class="eseg" role="group" aria-label="効果をかける相手">
          <button class="${ef.target==="enemy"?"on":""}" data-t="enemy" data-i="${i}">相手にかける</button>
          <button class="${ef.target==="self"?"on":""}" data-t="self" data-i="${i}">自分にかける</button>
        </div>
        <div class="grid3" style="margin-top:8px">
          <div class="fld"><label>成功率%</label>
            <input type="number" inputmode="numeric" pattern="[0-9]*" min="1" max="100" data-k="chance" data-i="${i}" value="${ef.chance}"></div>
          ${instant?`<div class="fld"><label>持続T</label><input type="number" value="0" disabled aria-disabled="true"></div>`
            :`<div class="fld"><label>持続T</label>
              <input type="number" inputmode="numeric" pattern="[0-9]*" min="1" max="99" data-k="duration" data-i="${i}" value="${dur}"></div>`}
          ${amt?`<div class="fld"><label>${amt.label}</label>
            <input type="number" inputmode="decimal" step="${amt.step}" data-k="amount" data-i="${i}" value="${ef.amount!=null?ef.amount:amt.def}"></div>`:`<div></div>`}
        </div></div>`;
    }).join("");
    box.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{
      const st=STATUS[this.effects[+b.dataset.del].key];
      this.effects.splice(+b.dataset.del,1); Kit.buzz(8); this.renderEffects(); this.simulate();
      Kit.toast(`「${st?st.name:"効果"}」を外しました。`);
    });
    box.querySelectorAll("[data-swap]").forEach(b=>b.onclick=()=>this.openEffectPicker(+b.dataset.swap));
    box.querySelectorAll(".eseg button").forEach(b=>b.onclick=()=>{
      const i=+b.dataset.i;
      this.effects[i].target=b.dataset.t;
      b.parentElement.querySelectorAll("button").forEach(o=>o.classList.toggle("on",o===b));
      Kit.buzz(5);
      const line=$("#efl-"+i); if(line) line.textContent=this.effLine(this.effects[i]);
      this.simulate();
    });
    box.querySelectorAll("[data-k]").forEach(el=>{
      const live=()=>{
        const i=+el.dataset.i, k=el.dataset.k;
        const v=Number(el.value);
        if(!isNaN(v)) this.effects[i][k]=v;
        const line=$("#efl-"+i); if(line) line.textContent=this.effLine(this.effects[i]);
      };
      el.oninput=()=>{ live(); this.queueSim(); };
      el.onchange=()=>{ live(); this.simulate(); };
    });
  },
  buildEffects(){
    return this.effects.map(ef=>{
      const st=STATUS[ef.key];
      const instant=INSTANT_KINDS.indexOf(st.kind)>=0;
      const e={target:ef.target,kind:st.kind,name:st.name,icon:st.icon,tone:st.tone,
        duration:instant?0:(ef.duration!=null?ef.duration:(st.duration||1))};
      if(st.stat) e.stat=st.stat;
      const amt=ef.amount;
      if(st.kind==="STAT") e.mult=amt!=null?amt:st.mult;
      else if(st.percent!=null) e.percent=amt!=null?amt:st.percent;
      else if(st.kind==="COUNTER") e.ratio=amt!=null?amt:st.ratio;
      else if(st.value!=null) e.value=amt!=null?amt:st.value;
      if(ef.chance<100) e.chance=Math.max(0,Math.min(1,ef.chance/100));
      return e;
    });
  },
  /* 画面の入力を技オブジェクトにまとめる（保存とシミュレーションで共用） */
  collectSkill(){
    const v=id=>($("#"+id)?$("#"+id).value.trim():""), n=id=>($("#"+id)?Number($("#"+id).value)||0:0),
      b=id=>($("#"+id)?$("#"+id).checked:false);
    const cost=Math.max(0,Math.min(BALANCE.sp.max,n("k-cost"))), cmax=n("k-costmax");
    const s={id:this.skillEditId||this.skill.id,name:v("k-name"),description:v("k-desc"),
      type:$("#k-type").value,power:n("k-power"),
      accuracy:Math.max(BALANCE.accuracyMin,Math.min(BALANCE.accuracyMax,n("k-acc")||95)),
      cost,priority:n("k-prio"),hits:Math.max(1,n("k-hits")),formula:$("#k-formula").value,
      guardBreak:b("k-gb"),buffPierce:b("k-bp"),cleanse:b("k-cleanse"),
      effects:this.buildEffects(),custom:true};
    if(this.skill&&this.skill.sfxId) s.sfxId=this.skill.sfxId;
    if(cmax>cost){ s.costMax=cmax; s.powerPerSp=n("k-perpow"); s.durationPerSp=n("k-perdur"); }
    if(n("k-vary")>0) s.varyPercent=Math.min(60,n("k-vary"));
    if(n("k-heal")>0) s.healPercent=n("k-heal");
    if(n("k-drain")>0) s.drain=n("k-drain")/100;
    if(n("k-uses")>0) s.uses=n("k-uses");
    return s;
  },

  /* ---------- 実戦シミュレーション ----------
     UI では計算しない。エンジンに実際に戦わせて、その結果を読む。
     SPは満タンから始める（そうしないと重い技が「SP不足で不発」になり、試算が嘘になる）。 */
  DUMMY:{soft:{def:55,label:"柔らかい相手"},mid:{def:88,label:"ふつうの相手"},hard:{def:140,label:"堅い相手"}},
  SIM_HP:1300,
  dummyChar(name,def){
    return {id:"__sim_"+name,name,portrait:"◆",description:"",bgm:"tension",
      stats:{hp:this.SIM_HP,atk:130,def,spd:100},skills:[],passives:[]};
  },
  /* turns ターンぶん戦わせる。1ターン目に技、あとは防御して継続ダメージの効きも見る。 */
  runSim(skill,def,runs,turns){
    turns=turns||1;
    const me=this.dummyChar("試",88);
    const id=skill.id||"__sim_skill";
    const sk=Object.assign({},skill,{id});
    me.skills=[id];
    let dmg=0, hits=0, myHeal=0, myLoss=0, first=0;
    for(let i=0;i<runs;i++){
      let eng;
      try{
        eng=new BattleEngine(me,this.dummyChar("的",def),
          {skills:{[id]:sk},seed:i*7919+13,startSp:[BALANCE.sp.max,BALANCE.sp.max]});
      }catch(e){ return null; }
      const foe0=eng.fighters[1].hp, me0=eng.fighters[0].hp;
      for(let t=0;t<turns;t++){
        if(eng.over) break;
        eng.submit(0,t===0?{type:"SKILL",skillId:id,spend:sk.cost}:{type:"DEFEND"});
        eng.submit(1,{type:"DEFEND"});
        try{ eng.resolveTurn(); }catch(e){ return null; }
        if(t===0) first+=Math.max(0,foe0-eng.fighters[1].hp);
      }
      const d=foe0-eng.fighters[1].hp;
      if(d>0) hits++;
      dmg+=Math.max(0,d);
      const mine=eng.fighters[0].hp-me0;
      if(mine>0) myHeal+=mine; else myLoss+=-mine;
    }
    return {avg:dmg/runs, first:first/runs, hitRate:hits/runs, heal:myHeal/runs, loss:myLoss/runs};
  },
  /* 既存の技と比べるための物差し。一度だけ測って覚えておく。 */
  reference(){
    if(this._ref) return this._ref;
    const list=Object.values(SKILLS).filter(s=>!s.custom&&s.id!=="basic_attack"&&(s.type==="ATTACK"||s.type==="SPECIAL"));
    const vals=list.map(s=>{
      const r=this.runSim(s,this.DUMMY.mid.def,8,3);
      return r?{name:s.name,per:r.avg/Math.max(1,s.cost||1),avg:r.avg,cost:s.cost}:null;
    }).filter(Boolean);
    const basic=this.runSim(SKILLS.basic_attack,this.DUMMY.mid.def,8,1);
    vals.sort((a,b)=>a.per-b.per);
    this._ref={list:vals, median:vals.length?vals[Math.floor(vals.length/2)].per:1,
      top:vals.length?vals[vals.length-1].per:1, basic:basic?basic.avg:45};
    return this._ref;
  },
  queueSim(){
    clearTimeout(this._simT);
    this._simT=setTimeout(()=>this.simulate(),200);
  },
  /* SPあたりの効き目を既存の技と比べて段位にする。強そうに見えることが大事。 */
  simRank(per,ref){
    if(per>=ref.top*1.1)     return {k:"SS",t:"hot", w:"既存のどの技より効率が良い。強すぎます。"};
    if(per>=ref.top*0.9)     return {k:"S", t:"hot", w:"最上位の技と同じ効率です。"};
    if(per>=ref.median*1.15) return {k:"A", t:"ok",  w:"既存の技より少し上の効率です。"};
    if(per>=ref.median*0.8)  return {k:"B", t:"ok",  w:"既存の技と同じくらいの効率です。"};
    if(per>=ref.median*0.5)  return {k:"C", t:"warn",w:"効率は控えめ。SPを下げるか威力を上げると使われます。"};
    return {k:"D",t:"bad", w:"このSPでは割に合いません。数値を見直してください。"};
  },
  simulate(){
    const box=$("#k-sim");
    if(!box) return;
    const s=this.collectSkill();
    this.paintForge(s);
    const TURNS=3;                                        // 継続ダメージの効きまで見る
    const mid=this.runSim(s,this.DUMMY.mid.def,24,TURNS);
    if(!mid){ box.innerHTML=`<div class="status bad">この設定では戦わせられませんでした。数値を見直してください。</div>`; return; }
    const soft=this.runSim(s,this.DUMMY.soft.def,14,TURNS), hard=this.runSim(s,this.DUMMY.hard.def,14,TURNS);
    const ref=this.reference();
    const cost=Math.max(1,s.cost||1);
    const per=mid.avg/cost;
    const hp=this.SIM_HP;
    const rank=mid.avg>=1?this.simRank(per,ref):{k:"—",t:"bad",w:"相手には何も起きません。威力か効果を足してください。"};
    this.paintForgeResult(rank,mid.avg,TURNS);
    const words=[rank.w];
    let tone=rank.t;
    if(mid.avg>=1){
      const turns=Math.ceil(hp/Math.max(1,mid.avg));
      words.push(`この一手だけで相手のHPの約${Math.round(mid.avg/hp*100)}%。撃ち続ければ${turns}回で倒しきります。`);
      const after=mid.avg-mid.first;
      if(after>=8) words.push(`打った直後は${Math.round(mid.first)}、そのあと${TURNS-1}ターンでさらに${Math.round(after)}削ります。効き目が後から来る技です。`);
      if(soft&&hard){
        const r=hard.avg/Math.max(1,soft.avg);
        if(r>0.92) words.push("相手の防御にほとんど左右されません。堅い相手にこそ刺さります。");
        else if(r<0.55) words.push("堅い相手には通りません。柔らかい相手を叩く技です。");
        else words.push("相手の堅さなりに通ります。素直な一手です。");
      }
    }
    if(s.accuracy<85) words.push(`${100-s.accuracy}%の確率で外れます。決め手には向きません。`);
    if(s.cost>BALANCE.sp.regenPerTurn)
      words.push(`SP${s.cost}は毎ターンの回復（${BALANCE.sp.regenPerTurn}）を超えます。${Math.ceil(s.cost/BALANCE.sp.regenPerTurn)}ターンに1回が目安です。`);
    else if(s.cost<=BALANCE.sp.regenPerTurn) words.push("毎ターン撃ち続けられるコストです。");
    if(s.priority>0) words.push(`優先度${s.priority}。相手より速さで劣っていても先に届きます。`);
    if(s.uses) words.push(`戦闘中${s.uses}回まで。切りどころを選ぶ技です。`);
    if(mid.heal>0) words.push(`自分のHPが平均${Math.round(mid.heal)}戻ります。`);
    if(mid.loss>0) words.push(`使うたびに自分も平均${Math.round(mid.loss)}失います。`);
    this.effects.forEach(ef=>words.push(this.effLine(ef)));
    const bars=[["soft",soft],["mid",mid],["hard",hard]].map(([k,r])=>{
      const d=this.DUMMY[k];
      const w=Math.min(100,(r?r.avg:0)/Math.max(1,hp*0.5)*100);
      return `<div class="simbar"><span class="sbl">${d.label}</span>
        <span class="sbt"><span class="sbf" style="transform:scaleX(${(w/100).toFixed(3)})"></span></span>
        <span class="sbv">${Math.round(r?r.avg:0)}</span></div>`;
    }).join("");
    box.innerHTML=`
      <div class="simhead t-${tone}">
        <div class="simrank r-${rank.k}"><b>${rank.k}</b><span>効率</span></div>
        <div class="sh-main"><b>${Math.round(mid.avg)}</b><span>${TURNS}ターンで与える</span></div>
        <div class="sh-kv">
          <div><b>${Math.round(mid.hitRate*100)}%</b><span>当たる</span></div>
          <div><b>${Math.round(per)}</b><span>SP1あたり</span></div>
          <div><b>${(mid.avg/Math.max(1,ref.basic)).toFixed(1)}倍</b><span>通常攻撃比</span></div>
        </div></div>
      <div class="simbars">${bars}</div>
      <div class="simwords">${words.map(w=>`<div>・${esc(w)}</div>`).join("")}</div>
      <p class="note">HP${hp}・ATK130の相手に何度も戦わせた平均です（${TURNS}ターン観測）。</p>`;
  },
  /* 作りかけの技が戦闘でどう並ぶかを、その場に出しておく */
  paintForge(s){
    const box=$("#k-forge");
    if(!box) return;
    const meta=[];
    if(s.power>0) meta.push("威力"+s.power);
    if(s.hits>1) meta.push(s.hits+"回");
    if(s.priority>0) meta.push("先制"+s.priority);
    if(s.guardBreak) meta.push("防御貫通");
    if(s.buffPierce) meta.push("バフ貫通");
    if(s.healPercent) meta.push("回復"+s.healPercent+"%");
    if(s.uses) meta.push("残"+s.uses+"回");
    const res=box.querySelector("#k-forge-res");
    const keep=res?res.outerHTML:`<div id="k-forge-res" class="fg-res"></div>`;
    box.className="forgecard t-"+s.type;
    box.innerHTML=`<div class="fg-top"><b>${esc(s.name||"名もなき技")}</b>
        <span class="cost">SP${s.cost}${s.costMax?"〜"+s.costMax:""}</span></div>
      <div class="fg-d">${esc(s.description||"説明はまだありません。")}</div>
      <div class="fg-m">${[TYPE_LABEL[s.type]||"技","命中"+s.accuracy+"%"].concat(meta)
        .map(m=>`<span class="mchip">${esc(m)}</span>`).join("")}
        ${this.effects.map(ef=>{ const st=STATUS[ef.key];
          return `<span class="mchip ${st.tone==="good"?"good":"hot"}">${st.icon}${esc(st.name)}</span>`; }).join("")}
        ${s.sfxId?`<span class="mchip good">♪ 効果音</span>`:""}</div>
      ${keep}`;
  },
  /* 貼り付いた一枚の中に、いまの試算を一行で出す */
  paintForgeResult(rank,avg,turns){
    const el=$("#k-forge-res");
    if(!el) return;
    el.className="fg-res t-"+rank.t;
    el.innerHTML=`<span class="fr-r r-${rank.k}">${rank.k}</span>
      <span class="fr-n"><b>${Math.round(avg)}</b>ダメージ<em>${turns}ターンで</em></span>
      <span class="fr-w">${esc(rank.w)}</span>`;
  },
  saveSkill(){
    const s=this.collectSkill();
    const err=[];
    if(!s.name) err.push("技名を入力してください。");
    if(s.costMax&&s.costMax<s.cost) err.push("最大SPは基本SP以上にしてください。");
    if(s.power<=0&&!s.effects.length&&!s.healPercent&&!s.cleanse)
      err.push("威力か効果のどちらかは必要です。");
    if(err.length){ $("#skill-err").textContent=err.join(" "); Kit.toast(err[0],{tone:"bad"}); return; }
    const id=this.skillEditId||("s_"+Date.now().toString(36));
    s.id=id;
    const prev=SKILLS[id];
    SKILLS[id]=s;
    const res=Store.save();
    if(!res.ok){
      if(prev) SKILLS[id]=prev; else delete SKILLS[id];
      this.reportSaveFail(res,null);
      return;
    }
    this._ref=null;
    Kit.toast(`「${s.name}」を保存しました。技一覧から選べます。`,{tone:"ok"});
    Kit.buzz([10,40,16]);
    if(this.returnTo==="edit"&&this.draft){
      this.draft.skills=this.draft.skills.concat([id]);
      this.returnTo="roster";
      this.touch();
      this.renderShell(); UI.show("edit");
      return;
    }
    UI.renderRoster(); UI.show("roster");
  }
};

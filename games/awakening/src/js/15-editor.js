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
        form:{stats:{atk:190,def:95,spd:125},skills:[],effects:[]},
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
  renderShell(){
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
      <button class="btn btn-gold" id="e-next">${last?"保存して完成":"次へ"}</button>`;
    $("#e-prev").onclick=()=>this.goStep(this.step-1);
    $("#e-next").onclick=()=>{ if(last) this.saveCharacter(); else this.goStep(this.step+1); };
  },
  async leave(){
    if(!this.dirty){ Store.clearDraft(); UI.show(this.returnTo==="edit"?"roster":"roster"); UI.renderRoster(); return; }
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
          <span class="hint">${esc(d.bgmAudioName||"設定済み")}</span>`:`<span class="hint">3MBまで。端末内に保存されます。</span>`}
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
      },msg=>{ $("#e-file-err").textContent=msg; Kit.toast(msg,{tone:"bad"}); },12);
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
        msg=>{ $("#e-file-err").textContent=msg; Kit.toast(msg,{tone:"bad"}); },3);
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
      this.updateBudget(); this.renderCompare();
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
    $("#e-budget").innerHTML=`
      <div class="bg-top"><span>残りポイント</span>
        <span class="bg-rest ${rest<0?"over":rest===0?"zero":""}">${rest}</span></div>
      <div class="bg-track"><div class="bg-fill ${rest<0?"over":""}" style="transform:scaleX(${(pct/100).toFixed(4)})"></div></div>
      <div class="bg-sub">${used} / ${B.budget} 使用${rest<0?`　<b class="warn">${-rest}超過しています</b>`:rest===0?"　<b class='ok'>ぴったり使い切りました</b>":""}</div>`;
  },
  renderCompare(){
    const st=this.draft.stats;
    const score=this.powerScore(st), base=this.baselineScore();
    const ratio=score/base;
    const pct=Math.round(ratio*100);
    const near=this.nearestChar(st);
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
      <div class="scorecard t-${tone}">
        <div class="sc-top"><span>目安の強さ</span><b>${pct}%</b></div>
        <div class="sc-note">${esc(verdict)}</div>
        <div class="sc-kv"><span>攻め ${off}</span><span>守り ${tank}</span>
          ${near?`<span>近いのは「${esc(near.name)}」</span>`:""}</div>
      </div>
      <div class="cmpbox">${bars}</div>
      <p class="note">白い線が${near?`「${esc(near.name)}」`:"比較対象"}の値です。100%が既存キャラの平均。</p>`;
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
    const view=Object.assign({},d,{awakening:Object.assign({},d.awakening,
      {conditions:[Object.assign({},d.awakening.conditions[0],{label:this.condLabel()})],
       cost:Object.assign({},d.awakening.cost,{label:this.costLabel()})})});
    const skills=d.skills.map(id=>SKILLS[id]).filter(Boolean);
    return `<p class="steplead">${this.STEPS[4].hint}</p>
      <div class="glass preview">${UI.previewCard(view)}</div>
      <div class="h-rule">技</div>
      <div class="sum-chips big">${skills.map(s=>
        `<span class="mchip">${esc(s.name)}<em>SP${s.cost}</em></span>`).join("")||"<span class='note'>なし</span>"}</div>
      <div class="h-rule">できているか</div>
      <div class="checks">${checks.map(c=>
        `<button class="chk ${c.ok?"ok":"ng"}" data-jump="${c.step}">
          <span class="ci">${c.ok?"✓":"！"}</span><span>${esc(c.t)}</span>
          ${c.ok?"":`<em>直す</em>`}</button>`).join("")}</div>
      <div id="edit-err" class="err"></div>
      <div class="h-rule">仕上げ</div>
      <button class="btn btn-line" id="e-tryfight"><span class="ic">⚔</span>保存してすぐ戦ってみる</button>`;
  },
  bind_check(){
    $$("#edit-body .chk").forEach(b=>b.onclick=()=>this.goStep(+b.dataset.jump));
    $("#e-tryfight").onclick=()=>this.saveCharacter({fight:true});
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
      costMax:0,powerPerSp:0,durationPerSp:0,varyPercent:0,healPercent:0,drain:0,uses:0,custom:true};
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

      <div class="h-rule">状態異常・効果</div>
      <p class="note">好きなだけ組み合わせられます。成功率を100%未満にすると運要素のある技になります。</p>
      <div class="stack" id="k-efflist"></div>
      <button class="btn btn-line" id="k-addeff"><span class="ic">✚</span>効果を追加</button>

      <div class="h-rule">実戦での振る舞い</div>
      <div id="k-sim" class="simbox"><div class="note">数値を入れると、ここで実際に戦わせて結果を出します。</div></div>
      <div id="skill-err" class="err"></div>`;

    $("#skill-foot").innerHTML=`
      <button class="btn btn-line" id="k-cancel">やめる</button>
      <button class="btn btn-gold" id="k-save">${this.skillEditId?"上書き保存":"技を保存する"}</button>`;

    $$("#skill-body [data-preset]").forEach(b=>b.onclick=()=>this.applyPreset(b.dataset.preset));
    $("#k-addeff").onclick=()=>{ this.effects.push(this.newEffect(Object.keys(STATUS)[0])); this.renderEffects(); this.simulate(); };
    $("#k-save").onclick=()=>this.saveSkill();
    $("#k-cancel").onclick=()=>this.closeSkill();
    $$("#skill-body .ksim").forEach(el=>{
      el.addEventListener("input",()=>this.queueSim());
      el.addEventListener("change",()=>this.queueSim());
    });
    $("#k-type").onchange=()=>this.queueSim();
    $("#k-formula").onchange=()=>this.queueSim();
    $("#skill-body").querySelectorAll("input,textarea,select").forEach(el=>{
      el.addEventListener("focus",()=>setTimeout(()=>{
        try{ el.scrollIntoView({block:"center",behavior:Kit.reduced()?"auto":"smooth"}); }catch(e){}
      },220));
    });
    this.renderEffects();
    this.simulate();
  },
  applyPreset(id){
    const base=id?SKILLS[id]:null;
    if(base){
      const c=JSON.parse(JSON.stringify(base));
      this.skill=Object.assign(this.blankSkill(),c,{id:this.skill.id,custom:true,
        name:(this.skill.name||"").trim()||c.name+"・改"});
      this.effects=(c.effects||[]).map(e=>this.effectToDraft(e));
      Kit.toast(`「${base.name}」をもとにしました。ここから好きに変えられます。`);
    }else{
      const keep=this.skill.name;
      this.skill=this.blankSkill(); this.skill.name=keep;
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
  renderEffects(){
    const box=$("#k-efflist");
    if(!this.effects.length){
      box.innerHTML=`<p class="note">まだ効果はありません。毒・障壁・能力変化などを足せます。</p>`; return;
    }
    box.innerHTML=this.effects.map((ef,i)=>{
      const st=STATUS[ef.key];
      const amt=this.amountField(st);
      const instant=INSTANT_KINDS.indexOf(st.kind)>=0;
      const dur=ef.duration!=null?ef.duration:(st.duration||1);
      return `<div class="effrow">
        <div class="eh"><span>${st.icon} ${esc(st.name)}</span>
          <button class="btn btn-ghost effdel" data-del="${i}" aria-label="${esc(st.name)}を削除">削除</button></div>
        <div class="ed">${esc(statusNote(st))}</div>
        <div class="grid2" style="margin-top:9px">
          <div class="fld"><label>種類</label><select data-k="key" data-i="${i}">
            ${Object.keys(STATUS).map(k=>`<option value="${k}" ${ef.key===k?"selected":""}>${STATUS[k].icon} ${STATUS[k].name}</option>`).join("")}
          </select></div>
          <div class="fld"><label>対象</label><select data-k="target" data-i="${i}">
            <option value="enemy" ${ef.target==="enemy"?"selected":""}>相手</option>
            <option value="self" ${ef.target==="self"?"selected":""}>自分</option></select></div>
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
      this.effects.splice(+b.dataset.del,1); Kit.buzz(8); this.renderEffects(); this.simulate();
    });
    box.querySelectorAll("[data-k]").forEach(el=>{
      const commit=()=>{
        const i=+el.dataset.i, k=el.dataset.k;
        if(k==="key") this.effects[i]=this.newEffect(el.value);
        else if(k==="target") this.effects[i].target=el.value;
        else this.effects[i][k]=Number(el.value);
        if(k==="key") this.renderEffects();
        this.simulate();
      };
      el.onchange=commit;
      if(el.tagName==="INPUT") el.oninput=()=>this.queueSim();
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
    if(cmax>cost){ s.costMax=cmax; s.powerPerSp=n("k-perpow"); s.durationPerSp=n("k-perdur"); }
    if(n("k-vary")>0) s.varyPercent=Math.min(60,n("k-vary"));
    if(n("k-heal")>0) s.healPercent=n("k-heal");
    if(n("k-drain")>0) s.drain=n("k-drain")/100;
    if(n("k-uses")>0) s.uses=n("k-uses");
    return s;
  },

  /* ---------- 実戦シミュレーション ----------
     UI では計算しない。エンジンに実際に戦わせて、その結果を読む。 */
  DUMMY:{soft:{def:55,label:"柔らかい相手"},mid:{def:88,label:"ふつうの相手"},hard:{def:140,label:"堅い相手"}},
  dummyChar(name,def){
    return {id:"__sim_"+name,name,portrait:"◆",description:"",bgm:"tension",
      stats:{hp:1300,atk:130,def,spd:100},skills:[],passives:[]};
  },
  runSim(skill,def,runs){
    const me=this.dummyChar("試",88);
    const id=skill.id||"__sim_skill";
    const sk=Object.assign({},skill,{id});
    me.skills=[id];
    let dmg=0, hits=0, myHeal=0;
    for(let i=0;i<runs;i++){
      let eng;
      try{ eng=new BattleEngine(me,this.dummyChar("的",def),{skills:{[id]:sk},seed:i*7919+13}); }
      catch(e){ return null; }
      const foeBefore=eng.fighters[1].hp, meBefore=eng.fighters[0].hp;
      eng.submit(0,{type:"SKILL",skillId:id,spend:sk.cost});
      eng.submit(1,{type:"ATTACK"});
      try{ eng.resolveTurn(); }catch(e){ return null; }
      const d=foeBefore-eng.fighters[1].hp;
      if(d>0) hits++;
      dmg+=Math.max(0,d);
      myHeal+=Math.max(0,eng.fighters[0].hp-meBefore);
    }
    return {avg:dmg/runs, hitRate:hits/runs, heal:myHeal/runs};
  },
  /* 既存の技と比べるための物差し。一度だけ測って覚えておく。 */
  reference(){
    if(this._ref) return this._ref;
    const list=Object.values(SKILLS).filter(s=>!s.custom&&s.id!=="basic_attack"&&(s.type==="ATTACK"||s.type==="SPECIAL"));
    const vals=list.map(s=>{
      const r=this.runSim(s,this.DUMMY.mid.def,8);
      return r?{name:s.name,per:r.avg/Math.max(1,s.cost||1),avg:r.avg,cost:s.cost}:null;
    }).filter(Boolean);
    const basic=this.runSim(SKILLS.basic_attack,this.DUMMY.mid.def,8);
    vals.sort((a,b)=>a.per-b.per);
    this._ref={list:vals, median:vals.length?vals[Math.floor(vals.length/2)].per:1,
      top:vals.length?vals[vals.length-1].per:1, basic:basic?basic.avg:45};
    return this._ref;
  },
  queueSim(){
    clearTimeout(this._simT);
    this._simT=setTimeout(()=>this.simulate(),200);
  },
  simulate(){
    const box=$("#k-sim");
    if(!box) return;
    const s=this.collectSkill();
    const mid=this.runSim(s,this.DUMMY.mid.def,36);
    if(!mid){ box.innerHTML=`<div class="status bad">この設定では戦わせられませんでした。数値を見直してください。</div>`; return; }
    const soft=this.runSim(s,this.DUMMY.soft.def,20), hard=this.runSim(s,this.DUMMY.hard.def,20);
    const ref=this.reference();
    const cost=Math.max(1,s.cost||1);
    const per=mid.avg/cost;
    const hp=1300;
    const words=[];
    let tone="ok";
    if(mid.avg<1&&!s.effects.length&&!s.healPercent){
      words.push("相手には何も起きません。威力か効果を足してください。"); tone="bad";
    }else if(mid.avg>=1){
      const turns=Math.ceil(hp/Math.max(1,mid.avg));
      words.push(`ふつうの相手を倒すのに約${turns}ターン。`);
      if(per>=ref.top*1.15){ words.push("SPあたりの威力が既存のどの技より高く、強すぎます。"); tone="hot"; }
      else if(per>=ref.median*1.25) words.push("SPあたりの威力は既存の技より高めです。");
      else if(per<=ref.median*0.6){ words.push("SPあたりの威力が低めです。SPを下げるか威力を上げると使われます。"); tone="warn"; }
      else words.push("SPあたりの威力は既存の技と同じくらいです。");
      if(soft&&hard){
        const r=hard.avg/Math.max(1,soft.avg);
        if(r>0.92) words.push("相手の防御にほとんど左右されません。堅い相手にこそ刺さります。");
        else if(r<0.55) words.push("堅い相手には通りません。柔らかい相手を叩く技です。");
      }
    }
    if(s.accuracy<85) words.push(`${100-s.accuracy}%の確率で外れます。決め手には向きません。`);
    if(s.cost>BALANCE.sp.regenPerTurn) words.push(`SP${s.cost}は毎ターンの回復（${BALANCE.sp.regenPerTurn}）を超えるので、連発はできません。`);
    if(s.healPercent||mid.heal>0) words.push(`自分のHPが平均${Math.round(mid.heal||0)}戻ります。`);
    this.effects.forEach(ef=>{
      const st=STATUS[ef.key];
      const t=ef.target==="self"?"自分":"相手";
      const ch=ef.chance<100?`${ef.chance}%で`:"";
      words.push(`${ch}${t}に「${st.name}」（${statusNote(st)}）。`);
    });
    const bars=[["soft",soft],["mid",mid],["hard",hard]].map(([k,r])=>{
      const d=this.DUMMY[k];
      const w=Math.min(100,(r?r.avg:0)/Math.max(1,hp*0.35)*100);
      return `<div class="simbar"><span class="sbl">${d.label}</span>
        <span class="sbt"><span class="sbf" style="transform:scaleX(${(w/100).toFixed(3)})"></span></span>
        <span class="sbv">${Math.round(r?r.avg:0)}</span></div>`;
    }).join("");
    box.innerHTML=`
      <div class="simhead t-${tone}">
        <div class="sh-main"><b>${Math.round(mid.avg)}</b><span>平均ダメージ</span></div>
        <div class="sh-kv">
          <div><b>${Math.round(mid.hitRate*100)}%</b><span>当たる</span></div>
          <div><b>${Math.round(per)}</b><span>SP1あたり</span></div>
          <div><b>${(mid.avg/Math.max(1,ref.basic)).toFixed(1)}倍</b><span>通常攻撃比</span></div>
        </div></div>
      <div class="simbars">${bars}</div>
      <div class="simwords">${words.map(w=>`<div>・${esc(w)}</div>`).join("")}</div>
      <p class="note">HP1300・ATK130の相手に${36}回戦わせた平均です。</p>`;
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

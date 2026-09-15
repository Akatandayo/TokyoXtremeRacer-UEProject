/* =========================================================================
   09b. Editor — キャラクター登録・技登録
   ========================================================================= */
const Editor = {
  draft:null, editingId:null, effects:[],

  /* ---- ポイント計算 ---- */
  pointsOf(stats){
    const B=BALANCE.build;
    return Math.round(stats.hp/B.hpPerPoint + stats.atk + stats.def + stats.spd);
  },
  awakenPoints(form){ return Math.round((form.atk||0)+(form.def||0)+(form.spd||0)); },

  readFile(file, onDone, onError, maxMB){
    if(!file){ onError&&onError("ファイルが選ばれていません。"); return; }
    if(maxMB&&file.size>maxMB*1024*1024){ onError&&onError(`ファイルが大きすぎます（${maxMB}MBまで）。`); return; }
    const r=new FileReader();
    r.onerror=()=>onError&&onError("ファイルを読み込めませんでした。");
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
  openCharacter(id, copyFrom){
    if(id){ this.editingId=id; this.draft=JSON.parse(JSON.stringify(CHARACTERS[id])); }
    else if(copyFrom){ this.editingId=null; this.draft=JSON.parse(JSON.stringify(copyFrom));
      this.draft.id=null; this.draft.custom=true; this.draft.name=copyFrom.name+"（写し）"; }
    else { this.editingId=null; this.draft=this.blankChar(); }
    $("#edit-title").textContent=this.editingId?"キャラクター編集":"キャラクター作成";
    this.renderCharacter();
    UI.show("edit");
  },
  skillBoxes(selected,group){
    return Object.values(SKILLS).filter(s=>s.id!=="basic_attack").map(s=>
      `<label class="pickrow"><input type="checkbox" data-group="${group}" value="${s.id}" ${selected.includes(s.id)?"checked":""}>
        <span class="pn">${esc(s.name)} <span class="mchip">${TYPE_LABEL[s.type]||"技"}</span></span>
        <span class="pc">SP${s.cost}${s.costMax?"〜"+s.costMax:""}${s.power>0?" / 威力"+s.power:""}</span></label>`).join("");
  },
  renderCharacter(){
    const d=this.draft, a=d.awakening, B=BALANCE.build;
    $("#edit-body").innerHTML=`
      <div class="glass preview" style="margin-bottom:0"><div class="pv-head">
        ${UI.avatar(d,"84")}
        <div><div class="pv-name">${esc(d.name||"名もなき者")}</div>
        <div class="pv-desc">${esc(d.description||"")}</div></div></div></div>
      <div class="fld"><label>名前</label><input type="text" id="e-name" value="${esc(d.name)}"></div>
      <div class="grid2">
        <div class="fld"><label>アイコン（画像がないとき）</label><input type="text" id="e-portrait" maxlength="2" value="${esc(d.portrait||"")}"></div>
        <div class="fld"><label>説明</label><input type="text" id="e-desc" value="${esc(d.description||"")}"></div>
      </div>
      <div class="h-rule">立ち絵</div>
      <div class="upload">
        <label class="btn btn-line filebtn" for="e-file"><span class="ic">▣</span>画像を選ぶ
          <input type="file" id="e-file" accept="image/*" style="display:none"></label>
        ${d.portraitImage?`<button class="btn btn-line" id="e-file-edit" style="width:auto">切り抜き直す</button>
          <button class="btn btn-ghost" id="e-file-clear" style="width:auto">外す</button>`:""}
      </div>
      <p class="note" style="margin-top:6px">選んだあと、指でずらして拡大率を決めて切り抜けます。</p>
      <div id="e-file-err" class="err"></div>

      <div class="h-rule">対戦BGM</div>
      <p class="note">ここで設定した曲は、あなたと戦う相手の画面で流れます。</p>
      <div class="grid2" style="margin-top:8px">
        <div class="fld"><label>曲</label><select id="e-bgm">
          ${Object.keys(BGM).map(k=>`<option value="${k}" ${d.bgm===k?"selected":""}>${BGM[k].name}</option>`).join("")}
        </select></div>
        <div class="fld" style="justify-content:flex-end">
          <button class="btn btn-line" id="e-bgm-test" style="padding:11px">▶ 試聴（8秒）</button></div>
      </div>
      <div class="upload" style="margin-top:9px">
        <label class="btn btn-line filebtn" for="e-audio"><span class="ic">♪</span>音楽ファイルを使う
          <input type="file" id="e-audio" accept="audio/*" style="display:none"></label>
        ${d.bgmAudio?`<button class="btn btn-ghost" id="e-audio-clear" style="width:auto">外す</button>
          <span class="hint">${esc(d.bgmAudioName||"設定済み")}</span>`:`<span class="hint">3MBまで。端末内に保存されます。</span>`}
      </div>

      <div class="h-rule">基本ステータス</div>
      <div id="e-meter"></div>
      <div class="grid4" style="margin-top:10px">
        ${["hp","atk","def","spd"].map(k=>`<div class="fld"><label>${k.toUpperCase()}</label>
          <input type="number" class="pt" id="e-${k}" value="${d.stats[k]}"></div>`).join("")}
      </div>
      <p class="note">HPは${B.hpPerPoint}あたり1ポイント、ATK・DEF・SPDは1あたり1ポイントです。</p>

      <div class="h-rule">通常形態の技</div>
      <div class="stack">${this.skillBoxes(d.skills,"normal")}</div>

      <div class="h-rule">覚醒</div>
      <label class="pickrow"><input type="checkbox" id="e-awk" ${a.enabled?"checked":""}><span class="pn">覚醒を使えるようにする</span></label>
      <div class="fld"><label>覚醒形態の名前</label><input type="text" id="e-awkname" value="${esc(a.name||"")}"></div>
      <p class="note">覚醒条件は1つだけ設定できます（複数条件はJSONの読み込みで扱えます）。</p>
      <div class="fld"><label>覚醒条件</label>
        <select id="e-cond">
          <option value="HP_BELOW" ${a.conditions[0].type==="HP_BELOW"?"selected":""}>HPが一定割合以下になる</option>
          <option value="DAMAGE_TAKEN" ${a.conditions[0].type==="DAMAGE_TAKEN"?"selected":""}>累計ダメージを受ける</option>
          <option value="SKILL_USED" ${a.conditions[0].type==="SKILL_USED"?"selected":""}>特定の技を指定回数使う</option>
          <option value="TURN_REACHED" ${a.conditions[0].type==="TURN_REACHED"?"selected":""}>指定ターン数が経過する</option>
        </select></div>
      <div class="grid2">
        <div class="fld"><label>条件の値（割合は 0.4 のように）</label>
          <input type="number" step="0.05" id="e-condval" value="${a.conditions[0].value}"></div>
        <div class="fld"><label>対象の技（技使用条件のとき）</label>
          <select id="e-condskill">${Object.values(SKILLS).filter(s=>s.id!=="basic_attack").map(s=>
            `<option value="${s.id}" ${a.conditions[0].skillId===s.id?"selected":""}>${esc(s.name)}</option>`).join("")}</select></div>
      </div>
      <div class="h-rule">覚醒後のステータス</div>
      <div id="e-ameter"></div>
      <div class="grid4" style="margin-top:10px">
        ${["atk","def","spd"].map(k=>`<div class="fld"><label>${k.toUpperCase()}</label>
          <input type="number" class="pt" id="e-a${k}" value="${a.form.stats[k]!=null?a.form.stats[k]:d.stats[k]}"></div>`).join("")}
        <div class="fld"><label>持続T</label><input type="number" id="e-adur" value="${a.duration}"></div>
      </div>
      <div class="grid2">
        <div class="fld"><label>毎ターンのHP減少</label><input type="number" id="e-acost" value="${(a.cost&&a.cost.hpPerTurn)||0}"></div>
        <div class="fld" style="justify-content:flex-end">
          <label class="pickrow"><input type="checkbox" id="e-aonce" ${a.oneTime?"checked":""}><span class="pn">戦闘中1回だけ</span></label></div>
      </div>
      <div class="h-rule">覚醒形態の技</div>
      <div class="stack">${this.skillBoxes(a.form.skills,"awake")}</div>
      <div id="edit-err" class="err"></div>
      <div class="rowbtns" style="margin-top:6px">
        <button class="btn btn-gold" id="e-save">保存する</button>
        <button class="btn btn-line" id="e-cancel">やめる</button>
      </div>`;

    $$("#edit-body .pt").forEach(el=>el.oninput=()=>this.updateMeters());
    this.updateMeters();
    $("#e-save").onclick=()=>this.saveCharacter();
    $("#e-cancel").onclick=()=>UI.show("roster");
    $("#e-file").onchange=ev=>{
      const f=ev.target.files&&ev.target.files[0];
      this.stashForm();
      this.readFile(f,url=>{
        this.lastPhoto=url;
        Cropper.open(url,cropped=>{ this.draft.portraitImage=cropped; this.renderCharacter(); });
      },msg=>{ $("#e-file-err").textContent=msg; },8);
    };
    const ed=$("#e-file-edit");
    if(ed) ed.onclick=()=>{ this.stashForm();
      Cropper.open(this.lastPhoto||this.draft.portraitImage,c=>{ this.draft.portraitImage=c; this.renderCharacter(); }); };
    const clr=$("#e-file-clear");
    if(clr) clr.onclick=()=>{ this.stashForm(); this.draft.portraitImage=null; this.renderCharacter(); };
    $("#e-bgm").onchange=e=>{ this.draft.bgm=e.target.value; };
    $("#e-bgm-test").onclick=()=>Music.preview($("#e-bgm").value);
    $("#e-audio").onchange=ev=>{
      const f=ev.target.files&&ev.target.files[0];
      this.stashForm();
      this.readFile(f,url=>{ this.draft.bgmAudio=url; this.draft.bgmAudioName=f.name; this.renderCharacter(); },
        msg=>{ $("#e-file-err").textContent=msg; },3);
    };
    const ac=$("#e-audio-clear");
    if(ac) ac.onclick=()=>{ this.stashForm(); this.draft.bgmAudio=null; this.draft.bgmAudioName=null; this.renderCharacter(); };
  },
  meterHtml(used,budget,label){
    const pct=Math.min(100,used/budget*100);
    const over=used>budget;
    return `<div class="meter${over?" over":""}">
      <div class="mrow"><span>${label}</span><span><b>${used}</b> / ${budget}${over?"（超過）":""}</span></div>
      <div class="mtrack"><div class="mfill" style="width:${pct}%"></div></div></div>`;
  },
  updateMeters(){
    const B=BALANCE.build, n=id=>Number($("#"+id).value)||0;
    const st={hp:n("e-hp"),atk:n("e-atk"),def:n("e-def"),spd:n("e-spd")};
    $("#e-meter").innerHTML=this.meterHtml(this.pointsOf(st),B.budget,"使用ポイント");
    const baseSum=st.atk+st.def+st.spd;
    const aSum=n("e-aatk")+n("e-adef")+n("e-aspd");
    $("#e-ameter").innerHTML=this.meterHtml(aSum,baseSum+B.awakenBonus,"覚醒後のATK+DEF+SPD");
  },
  /* 画面を組み直す前に、入力途中の内容を下書きへ退避する */
  stashForm(){
    const d=this.draft; if(!$("#e-name")) return;
    const v=id=>$("#"+id)?$("#"+id).value.trim():"", n=id=>$("#"+id)?Number($("#"+id).value):0;
    d.name=v("e-name"); d.portrait=v("e-portrait")||d.portrait; d.description=v("e-desc");
    ["hp","atk","def","spd"].forEach(k=>{ if(n("e-"+k)>0) d.stats[k]=n("e-"+k); });
    if($("#e-bgm")) d.bgm=$("#e-bgm").value;
    d.skills=$$('#edit-body input[data-group="normal"]:checked').map(x=>x.value);
    const picked=$$('#edit-body input[data-group="awake"]:checked').map(x=>x.value);
    if(picked.length) d.awakening.form.skills=picked;
    if($("#e-awkname")) d.awakening.name=v("e-awkname");
    ["atk","def","spd"].forEach(k=>{ if(n("e-a"+k)>0) d.awakening.form.stats[k]=n("e-a"+k); });
  },
  saveCharacter(){
    const v=id=>$("#"+id).value.trim(), n=id=>Number($("#"+id).value);
    const picked=g=>$$(`#edit-body input[data-group="${g}"]:checked`).map(x=>x.value);
    const B=BALANCE.build, err=[];
    if(!v("e-name")) err.push("名前を入力してください。");
    const st={hp:n("e-hp"),atk:n("e-atk"),def:n("e-def"),spd:n("e-spd")};
    if(st.hp<B.minHp) err.push(`HPは${B.minHp}以上にしてください。`);
    ["atk","def","spd"].forEach(k=>{ if(st[k]<B.minStat) err.push(`${k.toUpperCase()}は${B.minStat}以上にしてください。`); });
    const used=this.pointsOf(st);
    if(used>B.budget) err.push(`ポイントが${used-B.budget}超過しています。`);
    const aSum=n("e-aatk")+n("e-adef")+n("e-aspd"), cap=st.atk+st.def+st.spd+B.awakenBonus;
    if($("#e-awk").checked&&aSum>cap) err.push(`覚醒後の合計が${aSum-cap}超過しています。`);
    const normal=picked("normal");
    if(!normal.length) err.push("通常形態の技を1つ以上選んでください。");
    if(err.length){ $("#edit-err").textContent=err.join(" "); return; }

    const d=this.draft;
    d.name=v("e-name"); d.portrait=v("e-portrait")||"◆"; d.description=v("e-desc");
    d.bgm=$("#e-bgm").value;
    d.stats=st; d.skills=normal; d.custom=true;
    const a=d.awakening;
    a.enabled=$("#e-awk").checked;
    a.name=v("e-awkname")||"覚醒形態";
    const ct=$("#e-cond").value, cv=n("e-condval");
    const labels={HP_BELOW:`HPが${Math.round(cv*100)}%以下になる`,DAMAGE_TAKEN:`累計${cv}ダメージを受ける`,
      SKILL_USED:`「${SKILLS[$("#e-condskill").value].name}」を${cv}回使う`,TURN_REACHED:`${cv}ターン経過する`};
    a.conditions=[{type:ct,value:cv,skillId:$("#e-condskill").value,label:labels[ct]}];
    a.conditionMode="ANY";
    a.form.stats={atk:n("e-aatk"),def:n("e-adef"),spd:n("e-aspd")};
    a.form.skills=picked("awake").length?picked("awake"):normal;
    a.duration=n("e-adur");
    a.oneTime=$("#e-aonce").checked;
    const hpc=n("e-acost");
    const pc=(a.cost||{}).hpPercentPerTurn;
    a.cost={hpPerTurn:hpc,
      label:`${a.duration}ターン持続${pc?`／毎ターン最大HPの${pc.minPercent}〜${pc.maxPercent}%`:(hpc?`／毎ターンHP-${hpc}`:"")}${a.oneTime?"／戦闘中1回だけ":""}`};
    if(pc) a.cost.hpPercentPerTurn=pc;

    const id=this.editingId||("c_"+Date.now().toString(36));
    d.id=id; CHARACTERS[id]=d; Store.save();
    UI.renderRoster(); UI.show("roster");
  },

  /* ---------- 技エディタ ---------- */
  openSkill(){
    this.effects=[];
    $("#skill-body").innerHTML=`
      <div class="fld"><label>技名</label><input type="text" id="k-name" placeholder="例：雷撃"></div>
      <div class="fld"><label>説明</label><input type="text" id="k-desc" placeholder="戦闘中に表示される一文"></div>
      <div class="grid2">
        <div class="fld"><label>タイプ</label><select id="k-type">
          <option value="ATTACK">攻撃</option><option value="SPECIAL">特殊</option>
          <option value="DEFENSE">防御</option><option value="SUPPORT">補助</option></select></div>
        <div class="fld"><label>ダメージ計算</label><select id="k-formula">
          <option value="standard">通常（ATK＋威力－DEF）</option>
          <option value="ignoreDef">防御無視</option>
          <option value="fixed">固定ダメージ</option>
          <option value="maxHpRatio">最大HP割合（威力＝%）</option>
          <option value="currentHpRatio">現在HP割合（威力＝%）</option>
          <option value="spdBased">SPD依存</option></select></div>
      </div>
      <div class="grid4">
        <div class="fld"><label>威力</label><input type="number" id="k-power" value="40"></div>
        <div class="fld"><label>命中</label><input type="number" id="k-acc" value="95"></div>
        <div class="fld"><label>SP</label><input type="number" id="k-cost" value="1"></div>
        <div class="fld"><label>優先度</label><input type="number" id="k-prio" value="0"></div>
      </div>
      <div class="h-rule">SPの注ぎ込み</div>
      <p class="note">最大SPを基本SPより大きくすると、使うたびに「いくら注ぎ込むか」を選べる技になります。</p>
      <div class="grid3" style="margin-top:8px">
        <div class="fld"><label>最大SP</label><input type="number" id="k-costmax" value="0" placeholder="0=固定"></div>
        <div class="fld"><label>SP1ごとの威力</label><input type="number" id="k-perpow" value="0"></div>
        <div class="fld"><label>SP1ごとの持続T</label><input type="number" id="k-perdur" value="0"></div>
      </div>
      <div class="grid4" style="margin-top:8px">
        <div class="fld"><label>攻撃回数</label><input type="number" id="k-hits" value="1"></div>
        <div class="fld"><label>ばらつき%</label><input type="number" id="k-vary" value="0"></div>
        <div class="fld"><label>回復%</label><input type="number" id="k-heal" value="0"></div>
        <div class="fld"><label>吸収%</label><input type="number" id="k-drain" value="0"></div>
      </div>
      <div class="grid2" style="margin-top:8px">
        <div class="fld"><label>使用回数（0=無制限）</label><input type="number" id="k-uses" value="0"></div>
        <div class="fld" style="gap:8px;justify-content:flex-end">
          <label class="pickrow"><input type="checkbox" id="k-gb"><span class="pn">防御貫通</span></label></div>
      </div>
      <div class="grid2">
        <label class="pickrow"><input type="checkbox" id="k-bp"><span class="pn">バフ貫通</span></label>
        <label class="pickrow"><input type="checkbox" id="k-cleanse"><span class="pn">自分の効果を全解除</span></label>
      </div>
      <div class="h-rule">状態異常・効果</div>
      <p class="note">好きなだけ組み合わせられます。成功率を100%未満にすると運要素のある技になります。</p>
      <div class="stack" id="k-efflist"></div>
      <button class="btn btn-line" id="k-addeff"><span class="ic">✚</span>効果を追加</button>
      <div id="skill-err" class="err"></div>
      <div class="rowbtns" style="margin-top:6px">
        <button class="btn btn-gold" id="k-save">技を保存する</button>
        <button class="btn btn-line" id="k-cancel">やめる</button>
      </div>`;
    $("#k-addeff").onclick=()=>{ this.effects.push(this.newEffect("poison")); this.renderEffects(); };
    $("#k-save").onclick=()=>this.saveSkill();
    $("#k-cancel").onclick=()=>UI.show("roster");
    this.renderEffects();
    UI.show("skill");
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
    if(!this.effects.length){ box.innerHTML=`<p class="note">まだ効果はありません。</p>`; return; }
    box.innerHTML=this.effects.map((ef,i)=>{
      const st=STATUS[ef.key];
      const amt=this.amountField(st);
      const instant=INSTANT_KINDS.indexOf(st.kind)>=0;
      const dur=ef.duration!=null?ef.duration:(st.duration||1);
      return `<div class="effrow">
        <div class="eh"><span>${st.icon} ${esc(st.name)}</span>
          <button class="btn btn-ghost" data-del="${i}" style="width:auto;padding:2px 8px;font-size:12px">削除</button></div>
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
          <div class="fld"><label>成功率%</label><input type="number" data-k="chance" data-i="${i}" value="${ef.chance}"></div>
          ${instant?`<div class="fld"><label>持続T</label><input type="number" value="0" disabled></div>`
            :`<div class="fld"><label>持続T</label><input type="number" data-k="duration" data-i="${i}" value="${dur}"></div>`}
          ${amt?`<div class="fld"><label>${amt.label}</label>
            <input type="number" step="${amt.step}" data-k="amount" data-i="${i}" value="${ef.amount!=null?ef.amount:amt.def}"></div>`:`<div></div>`}
        </div></div>`;
    }).join("");
    box.querySelectorAll("[data-del]").forEach(b=>b.onclick=()=>{
      this.effects.splice(+b.dataset.del,1); this.renderEffects();
    });
    box.querySelectorAll("[data-k]").forEach(el=>{
      el.onchange=()=>{
        const i=+el.dataset.i, k=el.dataset.k;
        if(k==="key") this.effects[i]=this.newEffect(el.value);
        else if(k==="target") this.effects[i].target=el.value;
        else this.effects[i][k]=Number(el.value);
        this.renderEffects();
      };
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
  saveSkill(){
    const v=id=>$("#"+id).value.trim(), n=id=>Number($("#"+id).value);
    if(!v("k-name")){ $("#skill-err").textContent="技名を入力してください。"; return; }
    const cost=n("k-cost"), cmax=n("k-costmax");
    if(cmax&&cmax<cost){ $("#skill-err").textContent="最大SPは基本SP以上にしてください。"; return; }
    const id="s_"+Date.now().toString(36);
    const s={id,name:v("k-name"),description:v("k-desc"),type:$("#k-type").value,
      power:n("k-power"),accuracy:n("k-acc"),cost,priority:n("k-prio"),
      hits:Math.max(1,n("k-hits")),formula:$("#k-formula").value,
      guardBreak:$("#k-gb").checked,buffPierce:$("#k-bp").checked,cleanse:$("#k-cleanse").checked,
      effects:this.buildEffects(),custom:true};
    if(cmax>cost){ s.costMax=cmax; s.powerPerSp=n("k-perpow"); s.durationPerSp=n("k-perdur"); }
    if(n("k-vary")>0) s.varyPercent=Math.min(60,n("k-vary"));
    if(n("k-heal")>0) s.healPercent=n("k-heal");
    if(n("k-drain")>0) s.drain=n("k-drain")/100;
    if(n("k-uses")>0) s.uses=n("k-uses");
    SKILLS[id]=s; Store.save();
    UI.show("roster");
  }
};


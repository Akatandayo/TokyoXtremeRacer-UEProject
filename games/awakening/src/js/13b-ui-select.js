/* ===== UI：モード選択・キャラクター選択（編成） ===== */
Object.assign(UI, {
  /* ---------- モード別の準備画面 ---------- */
  openMode(mode){
    this.mode=mode;
    if(mode==="online"){ this.openOnline(); return; }
    this.mySide=0; this.slotFocus=0;
    $("#select-title").textContent = mode==="ai" ? "AI対戦の準備" : "キャラクター選択";
    $("#who0").textContent = mode==="ai" ? "あなた" : "プレイヤー1";
    $("#who1").textContent = mode==="ai" ? "AI" : "プレイヤー2";
    this.renderSelect();
    this.show("select");
  },

  /* ---------- 枠（どちらのキャラを選んでいるか） ---------- */
  renderSlots(){
    [0,1].forEach(i=>{
      const el=$("#slot"+i), c=this.pick[i]?CHARACTERS[this.pick[i]]:null;
      const active=this.slotFocus===i;
      el.classList.toggle("active",active);
      el.setAttribute("aria-pressed",String(active));
      const av=$("#sav"+i);
      av.innerHTML=this.avatarMini(c);
      const pick=el.querySelector(".pick");
      pick.textContent=c?c.name:"未選択";
      pick.classList.toggle("empty",!c);
    });
  },

  renderSelect(){
    const list=Object.values(CHARACTERS);
    const cur=this.pick[this.slotFocus];
    const other=this.pick[1-this.slotFocus];
    const shown=cur||this.lastTapped;   // 枠が空でも直前に触ったキャラを見せておく
    $("#preview").innerHTML=this.previewCard(
      shown?CHARACTERS[shown]:null,
      {vs:other?CHARACTERS[other]:null});

    const tray=$("#select-tray");
    tray.innerHTML=this.trayHtml(list,cur);
    tray.querySelectorAll(".thumb").forEach(b=>b.onclick=()=>{
      this.lastTapped=b.dataset.id;
      this.pick[this.slotFocus]=b.dataset.id;
      if(this.pick[1]===null) this.slotFocus=1;   // 片方が空なら自動で次の枠へ
      this.haptic(12);
      this.renderSelect();
    });
    this.renderSlots();

    const opt=$("#select-options");
    if(this.mode==="ai"){
      opt.innerHTML=`<div class="h-rule">AIの強さ</div><div class="seg" role="group" aria-label="AIの強さ">`+
        Object.keys(AI.LEVELS).map(k=>`<button data-lv="${k}" class="${this.aiLevel===k?"on":""}"
          aria-pressed="${this.aiLevel===k}">${AI.LEVELS[k].label}</button>`).join("")+
        `</div><p class="note" style="margin-top:8px">「本気」は倒しきれる手を逃さず、覚醒のタイミングも計算してきます。</p>`;
      opt.querySelectorAll("[data-lv]").forEach(b=>b.onclick=()=>{ this.aiLevel=b.dataset.lv; this.renderSelect(); });
    }else{
      opt.innerHTML=`<div class="h-rule">対戦設定</div>
        <label class="switchrow" for="opt-blind">
          <span class="sw-tx"><span class="sw-tl">コマンド入力を相手に見せない</span>
            <span class="sw-ts">交代のたびに目隠しをはさみます</span></span>
          <input class="switch" type="checkbox" id="opt-blind" ${this.blind?"checked":""}></label>`;
      $("#opt-blind").onchange=e=>{ this.blind=e.target.checked; };
    }

    /* 下部の主要操作。何が足りないかをボタンの上に出す */
    const both=this.pick[0]&&this.pick[1];
    const hint=$("#cta-hint");
    if(hint){
      hint.textContent = both
        ? `${CHARACTERS[this.pick[0]].name}　VS　${CHARACTERS[this.pick[1]].name}`
        : (this.pick[0]||this.pick[1] ? "もう一方の枠を選んでください" : "上の枠を切り替えて、2人ぶん選びます");
    }
    $("#btn-start").disabled=!both;
  },

  /* 迷ったとき用。空いている枠をその場で埋める */
  randomPick(){
    const ids=Object.keys(CHARACTERS);
    if(!ids.length) return;
    const rnd=()=>ids[Math.floor(Math.random()*ids.length)];
    this.pick[this.slotFocus]=rnd();
    if(!this.pick[1-this.slotFocus]) this.pick[1-this.slotFocus]=rnd();
    this.lastTapped=this.pick[this.slotFocus];
    this.haptic(16);
    this.renderSelect();
  },
});

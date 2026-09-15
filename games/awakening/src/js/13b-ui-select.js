/* ===== UI：モード選択・キャラクター選択 ===== */
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
  renderSelect(){
    const list=Object.values(CHARACTERS);
    const cur=this.pick[this.slotFocus];
    const shown=cur||this.lastTapped;   // 枠が空でも直前に触ったキャラを見せておく
    $("#preview").innerHTML=this.previewCard(shown?CHARACTERS[shown]:null);
    const tray=$("#select-tray");
    tray.innerHTML=this.trayHtml(list,cur);
    tray.querySelectorAll(".thumb").forEach(b=>b.onclick=()=>{
      this.lastTapped=b.dataset.id;
      this.pick[this.slotFocus]=b.dataset.id;
      if(this.pick[1]===null) this.slotFocus=1;
      this.renderSelect();
    });
    [0,1].forEach(i=>{
      const el=$("#slot"+i);
      el.classList.toggle("active",this.slotFocus===i);
      el.querySelector(".pick").textContent=this.pick[i]?CHARACTERS[this.pick[i]].name:"未選択";
    });
    const opt=$("#select-options");
    if(this.mode==="ai"){
      opt.innerHTML=`<div class="h-rule">AIの強さ</div><div class="seg">`+
        Object.keys(AI.LEVELS).map(k=>`<button data-lv="${k}" class="${this.aiLevel===k?"on":""}">${AI.LEVELS[k].label}</button>`).join("")+
        `</div><p class="note" style="margin-top:8px">「本気」は倒しきれる手を逃さず、覚醒のタイミングも計算してきます。</p>`;
      opt.querySelectorAll("[data-lv]").forEach(b=>b.onclick=()=>{ this.aiLevel=b.dataset.lv; this.renderSelect(); });
    }else{
      opt.innerHTML=`<div class="h-rule">対戦設定</div>
        <label class="pickrow"><input type="checkbox" id="opt-blind" ${this.blind?"checked":""}>
        <span class="pn">コマンド入力を相手に見せない</span></label>`;
      $("#opt-blind").onchange=e=>{ this.blind=e.target.checked; };
    }
    $("#btn-start").disabled=!(this.pick[0]&&this.pick[1]);
  },
});

/* =========================================================================
   09c. Kit — 作成まわりの共通部品。
        confirm / alert はアプリらしくないので使わず、ここのトーストと
        確認ダイアログに寄せる。要素は起動時ではなく初回利用時に作る。
   ========================================================================= */
const Kit = {
  _layer:null, _toastTimer:null, _dlg:null, _dlgResolve:null, _lastFocus:null,

  reduced(){ try{ return matchMedia("(prefers-reduced-motion:reduce)").matches; }catch(e){ return false; } },
  buzz(pattern){
    if(this.reduced()) return;
    try{ navigator.vibrate&&navigator.vibrate(pattern); }catch(e){}
  },

  layer(){
    if(this._layer&&document.body.contains(this._layer)) return this._layer;
    const el=document.createElement("div");
    el.className="kit-layer"; el.id="kit-layer";
    document.body.appendChild(el);
    this._layer=el;
    return el;
  },

  /* ---------- トースト（取り消し付きにもできる） ---------- */
  toast(text,opt){
    opt=opt||{};
    const host=this.layer();
    const old=host.querySelector(".kit-toast");
    if(old) old.remove();
    clearTimeout(this._toastTimer);
    const el=document.createElement("div");
    el.className="kit-toast"+(opt.tone?" t-"+opt.tone:"");
    el.setAttribute("role","status");
    el.setAttribute("aria-live","polite");
    el.innerHTML=`<span class="kt-msg">${esc(text)}</span>`;
    if(opt.action){
      const b=document.createElement("button");
      b.className="kt-act"; b.type="button"; b.textContent=opt.action.label;
      b.onclick=()=>{ el.remove(); opt.action.fn&&opt.action.fn(); };
      el.appendChild(b);
    }
    host.appendChild(el);
    requestAnimationFrame(()=>el.classList.add("on"));
    const ms=opt.ms||(opt.action?6000:2800);
    this._toastTimer=setTimeout(()=>{
      el.classList.remove("on");
      setTimeout(()=>el.remove(),260);
    },ms);
    if(opt.tone==="bad") this.buzz([14,50,14]);
    return el;
  },

  /* ---------- 確認ダイアログ（Promise<boolean>） ---------- */
  confirm(opt){
    opt=opt||{};
    return new Promise(resolve=>{
      this.closeDialog(false);
      this._lastFocus=document.activeElement;
      const host=this.layer();
      const wrap=document.createElement("div");
      wrap.className="kit-dlg-wrap";
      wrap.innerHTML=`<div class="kit-dlg-scrim"></div>
        <div class="kit-dlg" role="dialog" aria-modal="true" aria-labelledby="kit-dlg-t">
          <div class="kd-title" id="kit-dlg-t">${esc(opt.title||"確認")}</div>
          ${opt.body?`<div class="kd-body">${esc(opt.body)}</div>`:""}
          <div class="kd-btns">
            <button class="btn ${opt.danger?"btn-danger":"btn-gold"}" data-kd="ok">${esc(opt.ok||"はい")}</button>
            <button class="btn btn-line" data-kd="ng">${esc(opt.cancel||"やめる")}</button>
          </div></div>`;
      host.appendChild(wrap);
      this._dlg=wrap; this._dlgResolve=resolve;
      requestAnimationFrame(()=>wrap.classList.add("on"));
      wrap.querySelector('[data-kd="ok"]').onclick=()=>this.closeDialog(true);
      wrap.querySelector('[data-kd="ng"]').onclick=()=>this.closeDialog(false);
      wrap.querySelector(".kit-dlg-scrim").onclick=()=>this.closeDialog(false);
      const onKey=ev=>{
        if(ev.key==="Escape"){ ev.stopPropagation(); this.closeDialog(false); }
        if(ev.key==="Tab"){
          const f=Array.from(wrap.querySelectorAll("button"));
          if(!f.length) return;
          const i=f.indexOf(document.activeElement);
          ev.preventDefault();
          f[(i+(ev.shiftKey?-1:1)+f.length)%f.length].focus();
        }
      };
      wrap._onKey=onKey;
      document.addEventListener("keydown",onKey,true);
      setTimeout(()=>{ const b=wrap.querySelector('[data-kd="ok"]'); b&&b.focus(); },60);
      this.buzz(8);
    });
  },
  closeDialog(result){
    const wrap=this._dlg;
    if(!wrap) return;
    this._dlg=null;
    if(wrap._onKey) document.removeEventListener("keydown",wrap._onKey,true);
    wrap.classList.remove("on");
    setTimeout(()=>wrap.remove(),240);
    const r=this._dlgResolve; this._dlgResolve=null;
    if(this._lastFocus&&this._lastFocus.focus) try{ this._lastFocus.focus(); }catch(e){}
    r&&r(!!result);
  },
  dialogOpen(){ return !!this._dlg; },

  /* ---------- 指で配るスライダー ----------
     引数: {host, value, min, max, cap, step, onInput}
     cap は「残りポイントで届く上限」。max までは動かせるがそこで壁を感じさせる。 */
  slider(cfg){
    const track=cfg.host;
    const S={...cfg};
    const clampCap=v=>Math.min(S.cap!=null?S.cap:S.max,Math.max(S.min,v));
    const snap=v=>Math.round(v/S.step)*S.step;
    let wall=null;
    const setFromX=(clientX)=>{
      const r=track.getBoundingClientRect();
      const t=Math.min(1,Math.max(0,(clientX-r.left)/Math.max(1,r.width)));
      const raw=snap(S.min+t*(S.max-S.min));
      const v=clampCap(raw);
      if(raw>v&&wall!=="hi"){ wall="hi"; Kit.buzz(18); track.classList.add("wall"); setTimeout(()=>track.classList.remove("wall"),220); }
      else if(raw<=v&&raw>S.min) wall=null;
      if(raw<=S.min&&wall!=="lo"){ wall="lo"; Kit.buzz(18); }
      S.onInput(v);
    };
    let dragging=false;
    const down=ev=>{
      dragging=true; wall=null;
      track.setPointerCapture&&track.setPointerCapture(ev.pointerId);
      track.classList.add("grabbing");
      Kit.buzz(6);
      setFromX(ev.clientX);
      ev.preventDefault();
    };
    const move=ev=>{ if(dragging){ setFromX(ev.clientX); ev.preventDefault(); } };
    const up=()=>{ dragging=false; wall=null; track.classList.remove("grabbing"); };
    track.addEventListener("pointerdown",down);
    track.addEventListener("pointermove",move);
    track.addEventListener("pointerup",up);
    track.addEventListener("pointercancel",up);
    track.addEventListener("keydown",ev=>{
      const d=ev.key==="ArrowRight"||ev.key==="ArrowUp"?1:(ev.key==="ArrowLeft"||ev.key==="ArrowDown"?-1:0);
      if(!d) return;
      ev.preventDefault();
      S.onInput(clampCap(S.value+d*S.step));
    });
    return { update(next){ Object.assign(S,next); } };
  }
};

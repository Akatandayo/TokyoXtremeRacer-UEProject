/* =========================================================================
   09a. Cropper — 立ち絵の切り抜き。指でずらし、つまんで拡大する。
        大きな画像はそのまま扱うと端末が固まるので、先に縮めてから載せる。
        失敗は alert ではなくトーストで伝える。
   ========================================================================= */
const Cropper = {
  V:280, OUT:768, MAXPX:3000,        // 取り込み時の最大辺。これを超えたら縮める
  /* OUT は書き出す立ち絵の一辺。実体は IndexedDB に置くので、高解像度の端末でも
     ぼやけない大きさを取れる（以前は localStorage の都合で 256 に抑えていた）。 */
  img:null, scale:1, zoom:1, tx:0, ty:0, done:null, drag:null, pointers:null, pinch:null,
  lastTap:0, busy:false,

  open(dataUrl, onDone){
    if(!dataUrl){ Kit.toast("画像がありません。",{tone:"bad"}); return; }
    this.done=onDone;
    this.busy=true;
    this.setBusy(true,"画像を読み込んでいます…");
    $("#cropper").classList.add("on");
    document.body.classList.add("noscroll");
    const probe=new Image();
    probe.onload=()=>{
      let src=dataUrl;
      const w=probe.naturalWidth||1, h=probe.naturalHeight||1;
      if(Math.max(w,h)>this.MAXPX){
        const r=this.MAXPX/Math.max(w,h);
        const cv=document.createElement("canvas");
        cv.width=Math.max(1,Math.round(w*r)); cv.height=Math.max(1,Math.round(h*r));
        try{
          cv.getContext("2d").drawImage(probe,0,0,cv.width,cv.height);
          src=cv.toDataURL("image/jpeg",0.9);
        }catch(e){ /* 縮められなければ元のまま使う */ }
      }
      const el=$("#crop-img");
      el.onload=()=>{
        this.zoom=1; this.tx=null; this.ty=null;
        this.V=Math.max(160,Math.round($("#crop-box").clientWidth||280));
        this.fit();
        this.setBusy(false);
        this.busy=false;
        this.updateSize();
        $("#crop-zoom").value=100;
      };
      el.onerror=()=>this.fail("画像を表示できませんでした。別の画像でお試しください。");
      el.src=src;
    };
    probe.onerror=()=>this.fail("画像を読み込めませんでした。JPEGかPNGをお選びください。");
    probe.src=dataUrl;
  },
  fail(msg){
    this.busy=false;
    this.close();
    Kit.toast(msg,{tone:"bad",ms:5000});
  },
  setBusy(on,msg){
    const b=$("#crop-busy");
    if(!b) return;
    b.textContent=msg||"";
    b.classList.toggle("on",!!on);
    const ok=$("#crop-ok"); if(ok) ok.disabled=!!on;
  },
  close(){
    $("#cropper").classList.remove("on");
    document.body.classList.remove("noscroll");
    this.done=null; this.drag=null; this.pinch=null;
    if(this.pointers) this.pointers.clear();
    const el=$("#crop-img"); if(el){ el.removeAttribute("src"); }
  },
  base(){
    const el=$("#crop-img");
    const w=el.naturalWidth||1, h=el.naturalHeight||1;
    return this.V/Math.min(w,h);
  },
  fit(){
    const el=$("#crop-img");
    const s=this.base()*this.zoom;
    const w=(el.naturalWidth||1)*s, h=(el.naturalHeight||1)*s;
    // はみ出しすぎないよう位置を制限する
    this.tx=Math.min(0,Math.max(this.V-w,this.tx==null?(this.V-w)/2:this.tx));
    this.ty=Math.min(0,Math.max(this.V-h,this.ty==null?(this.V-h)/2:this.ty));
    this.scale=s;
    el.style.width=w+"px"; el.style.height=h+"px";
    el.style.transform=`translate3d(${this.tx}px,${this.ty}px,0)`;
  },
  move(dx,dy){ this.tx+=dx; this.ty+=dy; this.fit(); },
  setZoom(z,cx,cy){
    z=Math.max(1,Math.min(4,z));
    const px=cx==null?this.V/2:cx, py=cy==null?this.V/2:cy;
    const ax=(px-this.tx)/this.scale, ay=(py-this.ty)/this.scale;
    this.zoom=z;
    const s=this.base()*this.zoom;
    this.tx=px-ax*s; this.ty=py-ay*s;
    this.scale=s; this.fit();
    const sl=$("#crop-zoom");
    if(sl&&Math.abs(Number(sl.value)-z*100)>1) sl.value=Math.round(z*100);
  },
  reset(){ this.zoom=1; this.tx=null; this.ty=null; this.fit(); $("#crop-zoom").value=100; Kit.buzz(10); },
  /* 書き出したときの重さを先に見せておく（容量超過の予告） */
  updateSize(){
    const note=$("#crop-size");
    if(!note) return;
    try{
      const url=this.render();
      const kb=Math.round(url.length*0.75/1024);
      note.textContent=`書き出しの目安 約${kb}KB`;
      note.classList.toggle("warn",kb>120);
    }catch(e){ note.textContent=""; }
  },
  render(){
    const el=$("#crop-img"), S=this.OUT;
    const cv=document.createElement("canvas");
    cv.width=S; cv.height=S;
    const ctx=cv.getContext("2d");
    ctx.fillStyle="#0B0813"; ctx.fillRect(0,0,S,S);
    const sx=-this.tx/this.scale, sy=-this.ty/this.scale, sw=this.V/this.scale;
    ctx.drawImage(el,sx,sy,sw,sw,0,0,S,S);
    return cv.toDataURL("image/jpeg",0.85);
  },
  confirm(){
    if(this.busy) return;
    try{
      const url=this.render();
      const cb=this.done;
      this.close();
      Kit.buzz(12);
      if(cb) cb(url);
    }catch(e){
      this.fail("画像を変換できませんでした。別の画像でお試しください。");
    }
  },
  bind(){
    const box=$("#crop-box");
    this.pointers=new Map();
    const dist=()=>{
      const p=Array.from(this.pointers.values());
      return Math.hypot(p[0].x-p[1].x,p[0].y-p[1].y);
    };
    const mid=()=>{
      const p=Array.from(this.pointers.values());
      const r=box.getBoundingClientRect();
      return {x:(p[0].x+p[1].x)/2-r.left,y:(p[0].y+p[1].y)/2-r.top};
    };
    box.addEventListener("pointerdown",e=>{
      e.preventDefault();
      box.setPointerCapture&&box.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(this.pointers.size===2){ this.pinch={d:dist(),z:this.zoom}; this.drag=null; }
      else{
        this.drag={x:e.clientX,y:e.clientY};
        const now=Date.now();
        if(now-this.lastTap<300) this.reset();
        this.lastTap=now;
      }
    });
    box.addEventListener("pointermove",e=>{
      if(!this.pointers.has(e.pointerId)) return;
      e.preventDefault();
      this.pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(this.pointers.size>=2&&this.pinch){
        const d=dist();
        if(this.pinch.d>0){ const m=mid(); this.setZoom(this.pinch.z*d/this.pinch.d,m.x,m.y); }
      }else if(this.drag){
        this.move(e.clientX-this.drag.x,e.clientY-this.drag.y);
        this.drag={x:e.clientX,y:e.clientY};
      }
    });
    const up=e=>{
      this.pointers.delete(e.pointerId);
      if(this.pointers.size<2) this.pinch=null;
      if(!this.pointers.size){ this.drag=null; this.updateSize(); }
      else{ const p=Array.from(this.pointers.values())[0]; this.drag={x:p.x,y:p.y}; }
    };
    box.addEventListener("pointerup",up);
    box.addEventListener("pointercancel",up);
    box.addEventListener("wheel",e=>{ e.preventDefault(); this.setZoom(this.zoom*(e.deltaY<0?1.1:0.9)); },{passive:false});
    $("#crop-zoom").oninput=e=>this.setZoom(Number(e.target.value)/100);
    $("#crop-zoom").onchange=()=>this.updateSize();
    $("#crop-reset").onclick=()=>{ this.reset(); this.updateSize(); };
    $("#crop-ok").onclick=()=>this.confirm();
    $("#crop-cancel").onclick=()=>this.close();
    document.addEventListener("keydown",e=>{
      if(e.key==="Escape"&&$("#cropper").classList.contains("on")){ e.stopPropagation(); this.close(); }
    },true);
  }
};

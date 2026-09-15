/* =========================================================================
   09a. Cropper — 立ち絵の切り抜き。指でずらして拡大率を決める。
   ========================================================================= */
const Cropper = {
  V:280, img:null, scale:1, zoom:1, tx:0, ty:0, done:null, drag:null,

  open(dataUrl, onDone){
    this.done=onDone;
    const el=$("#crop-img");
    el.onload=()=>{ this.zoom=1; this.fit(); $("#cropper").classList.add("on"); };
    el.onerror=()=>{ this.close(); alert("画像を読み込めませんでした。"); };
    el.src=dataUrl;
  },
  close(){ $("#cropper").classList.remove("on"); this.done=null; },
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
    this.tx=Math.min(0,Math.max(this.V-w,this.tx||(this.V-w)/2));
    this.ty=Math.min(0,Math.max(this.V-h,this.ty||(this.V-h)/2));
    this.scale=s;
    el.style.width=w+"px"; el.style.height=h+"px";
    el.style.left=this.tx+"px"; el.style.top=this.ty+"px";
  },
  move(dx,dy){ this.tx+=dx; this.ty+=dy; this.fit(); },
  setZoom(z){
    const el=$("#crop-img");
    const cx=(this.V/2-this.tx)/this.scale, cy=(this.V/2-this.ty)/this.scale;
    this.zoom=z;
    const s=this.base()*this.zoom;
    this.tx=this.V/2-cx*s; this.ty=this.V/2-cy*s;
    this.scale=s; this.fit();
  },
  confirm(){
    const el=$("#crop-img"), S=256;
    try{
      const cv=document.createElement("canvas");
      cv.width=S; cv.height=S;
      const ctx=cv.getContext("2d");
      const sx=-this.tx/this.scale, sy=-this.ty/this.scale, sw=this.V/this.scale;
      ctx.drawImage(el,sx,sy,sw,sw,0,0,S,S);
      const url=cv.toDataURL("image/jpeg",0.85);
      const cb=this.done; this.close();
      if(cb) cb(url);
    }catch(e){ this.close(); alert("画像を変換できませんでした。"); }
  },
  bind(){
    const box=$("#crop-box");
    const start=(x,y)=>{ this.drag={x,y}; };
    const move=(x,y)=>{
      if(!this.drag) return;
      this.move(x-this.drag.x,y-this.drag.y);
      this.drag={x,y};
    };
    const end=()=>{ this.drag=null; };
    box.addEventListener("mousedown",e=>{ e.preventDefault(); start(e.clientX,e.clientY); });
    window.addEventListener("mousemove",e=>move(e.clientX,e.clientY));
    window.addEventListener("mouseup",end);
    box.addEventListener("touchstart",e=>{ const t=e.touches[0]; start(t.clientX,t.clientY); },{passive:true});
    box.addEventListener("touchmove",e=>{ const t=e.touches[0]; e.preventDefault(); move(t.clientX,t.clientY); },{passive:false});
    box.addEventListener("touchend",end);
    $("#crop-zoom").oninput=e=>this.setZoom(Number(e.target.value)/100);
    $("#crop-ok").onclick=()=>this.confirm();
    $("#crop-cancel").onclick=()=>this.close();
  }
};


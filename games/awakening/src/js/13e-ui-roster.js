/* ===== UI：キャラクター一覧 ===== */
Object.assign(UI, {
  /* ---------- キャラクター一覧 ---------- */
  renderRoster(){
    const wrap=$("#edit-roster"); wrap.innerHTML="";
    Object.values(CHARACTERS).forEach(c=>{
      const row=document.createElement("div");
      row.className="editcard";
      row.innerHTML=`${this.avatar(c,"44")}
        <div style="flex:1;min-width:0">
          <div style="font-family:var(--serif);font-size:16px">${esc(c.name)}</div>
          <div class="note" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(c.description||"")}</div>
        </div>
        <div style="display:flex;gap:4px;flex:0 0 auto">
          <button class="btn btn-line" data-act="edit" style="width:auto;padding:8px 12px;font-size:12px">${c.custom?"編集":"複製"}</button>
          ${c.custom?`<button class="btn btn-ghost" data-act="del" style="width:auto;padding:8px 10px;font-size:12px">削除</button>`:""}
        </div>`;
      row.querySelector('[data-act="edit"]').onclick=()=>Editor.openCharacter(c.custom?c.id:null,c.custom?null:c);
      const del=row.querySelector('[data-act="del"]');
      if(del) del.onclick=()=>{ if(confirm(`${c.name}を削除しますか？`)){ delete CHARACTERS[c.id]; Store.save(); this.renderRoster(); } };
      wrap.appendChild(row);
    });
  }
});

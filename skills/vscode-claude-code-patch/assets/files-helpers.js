// Session snapshot and local-path panel; all initialisation is lazy.
// Labels per language with the same keys; the part puts the configured language in place of __CC_LANG__.
function __ccFilesLabels(){
  return{
    en:{title:"Files in this chat",image:"Images",folder:"Folders",file:"Files",empty:"No paths or images in this chat yet",unreadable:"Could not read this chat"},
    ru:{title:"\u0424\u0430\u0439\u043b\u044b \u044d\u0442\u043e\u0433\u043e \u0447\u0430\u0442\u0430",image:"\u041a\u0430\u0440\u0442\u0438\u043d\u043a\u0438",folder:"\u041f\u0430\u043f\u043a\u0438",file:"\u0424\u0430\u0439\u043b\u044b",empty:"\u0412 \u044d\u0442\u043e\u043c \u0447\u0430\u0442\u0435 \u043f\u043e\u043a\u0430 \u043d\u0435\u0442 \u043f\u0443\u0442\u0435\u0439 \u0438 \u043a\u0430\u0440\u0442\u0438\u043d\u043e\u043a",unreadable:"\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u0442\u044c \u0447\u0430\u0442"}
  }.__CC_LANG__;
}
// Consume fences and inline code as whole tokens, preserving text order.
function __ccFilesText(text){
  if(typeof text!=="string")return[];
  const paths=[],re=/^[^\S\r\n]*(`{3,}|~{3,})[^\r\n]*(?:\r?\n|$)|(`+)[\s\S]*?\2(?!`)|\]\(\s*(<[^>\r\n]+>(?:[ \t]+"[^"\r\n]*")?|(?:[^()\r\n]|\([^()\r\n]*\))+)\s*\)/gm;
  let m;
  while((m=re.exec(text))){
    let p=null;
    if(m[1]){
      const end=new RegExp("^[^\\S\\r\\n]*"+m[1][0]+"{"+m[1].length+",}[^\\S\\r\\n]*\\r?$","gm");
      end.lastIndex=re.lastIndex;const close=end.exec(text);
      p=__ccPathOf(text.slice(re.lastIndex,close?close.index:text.length));
      re.lastIndex=close?close.index+close[0].length:text.length;
    }else if(!m[2]){
      let href=m[3].trim().replace(/\s+"[^"\r\n]*"\s*$/,"");
      if(href.startsWith("<")&&href.endsWith(">"))href=href.slice(1,-1);
      p=__ccDecodeHref(href);
    }
    if(p)paths.push(p);
  }
  return paths;
}
function __ccFilesHasParent(row){
  try{return!!(row&&(row.parentToolUseId||row.sdkParentToolUseId))}catch(x){return false}
}
function __ccFilesCollect(rows){
  try{
    if(!Array.isArray(rows))return null;
    if(rows.length&&!rows.some(function(r){try{return r&&Array.isArray(r.content)}catch(x){return false}}))return null;
    const found=new Map();
    const add=function(p,imageOnly){
      if(!p)return;const kind=__ccKind(p);if(imageOnly&&kind!=="image")return;
      const key=p.toLowerCase();found.delete(key);found.set(key,{path:p,kind:kind});
    };
    for(const [index,row] of rows.entries()){
      try{
        if(!row||row.type!=="assistant"||row.parentToolUseId!=null||row.sdkParentToolUseId!=null||!Array.isArray(row.content))continue;
        for(const wrap of row.content){
          try{
            if(!wrap||typeof wrap!=="object"||!wrap.content)continue;
            const b=wrap.content;
            if(b.type==="text")__ccFilesText(b.text).forEach(function(p){add(p,false)});
            if(b.type==="tool_use"){
              // Coalescing drops ownership; inspect the original immediate neighbours.
              if(b.name==="ReadCoalesced"&&(__ccFilesHasParent(rows[index-1])||__ccFilesHasParent(rows[index+1])))continue;
              const inputs=b.name==="Read"?[b.input]:b.name==="ReadCoalesced"&&b.input&&Array.isArray(b.input.fileReads)?b.input.fileReads:[];
              inputs.forEach(function(i){if(i&&typeof i.file_path==="string")add(__ccPathOf(i.file_path),true)});
            }
          }catch(x){}
        }
      }catch(x){}
    }
    return Array.from(found.values()).reverse();
  }catch(x){return null}
}
function __ccFilesRows(){
  try{return __ccFilesCollect(globalThis.__ccSessions.activeSession.value.messages.value)}catch(x){return null}
}
function __ccFilesBoot(){
  try{
    if(window.IS_SESSION_LIST_ONLY||typeof __ccViewer!=="function"||typeof __ccLoadImage!=="function")return;
    const d=document,id="cc-files-button",topOffset=4,rightOffset=4;
    if(d.getElementById(id))return;
    const b=d.createElement("button"),ns="http://www.w3.org/2000/svg",svg=d.createElementNS(ns,"svg"),p=d.createElementNS(ns,"path");
    b.id=id;b.type="button";b.title=__ccFilesLabels().title;b.setAttribute("aria-label",b.title);
    b.style.cssText="position:fixed;z-index:9999;width:22px;height:22px;padding:2px;border:0;border-radius:3px;cursor:pointer;background:var(--vscode-editor-background);color:var(--vscode-foreground)";
    b.style.top=topOffset+"px";b.style.right=rightOffset+"px";
    svg.setAttribute("viewBox","0 0 20 20");svg.setAttribute("width","18");svg.setAttribute("height","18");svg.setAttribute("aria-hidden","true");
    p.setAttribute("d","M2 5h6l2 2h8v9H2z");p.setAttribute("fill","none");p.setAttribute("stroke","currentColor");p.setAttribute("stroke-width","1.5");
    svg.appendChild(p);b.appendChild(svg);b.addEventListener("click",__ccFilesOpen);d.body.appendChild(b);
  }catch(x){}
}
function __ccFilesClick(item,tile,say){
  try{
    if(!item)return Promise.resolve();
    if(item.kind==="image"){__ccViewer(item.path,"",tile);return Promise.resolve()}
    const cx=globalThis.__ccFilesCtx,fallback=globalThis.__ccCtx,opener=(cx&&cx.fileOpener)||(fallback&&fallback.fileOpener)||null;
    return __ccCaps().then(function(c){
      const keys=__ccButtons(item.kind,c,!!opener,null).filter(function(k){return item.kind!=="file"||k==="open"});
      if(keys.length)return __ccAct(keys[0],item.path,opener).then(function(t){if(t&&typeof say==="function")say(t)});
    }).catch(function(){});
  }catch(x){return Promise.resolve()}
}
function __ccFilesOpen(){
  try{
    const d=document,s=__ccState(),T=__ccFilesLabels();
    if(s.panel)s.panel();
    const rows=__ccFilesRows(),items=rows?rows.slice(0,500):null,ov=d.createElement("div"),panel=d.createElement("div"),head=d.createElement("div"),body=d.createElement("div"),note=d.createElement("div"),closeButton=d.createElement("button");
    let observer=null,timer=null,closed=false;
    ov.style.cssText="position:fixed;inset:0;z-index:10000;background:#00000066;display:flex;justify-content:flex-end;padding:32px 8px 8px;box-sizing:border-box";
    panel.style.cssText="display:flex;flex-direction:column;width:min(480px,100%);max-height:100%;background:var(--vscode-editor-background);color:var(--vscode-foreground);border:1px solid var(--vscode-widget-border);border-radius:6px;box-shadow:0 4px 20px #0006";
    head.style.cssText="display:flex;justify-content:space-between;align-items:center;padding:10px;font-weight:600";
    body.style.cssText="overflow:auto;padding:0 10px 10px;flex:1";
    note.style.cssText="padding:4px 10px;color:var(--vscode-errorForeground);font-size:12px";
    head.textContent=T.title+" ("+(items?items.length:0)+")";
    closeButton.type="button";closeButton.textContent="\u00d7";closeButton.title=__ccTxt().close;Object.assign(closeButton.style,__ccCss("button"));
    const close=function(){
      if(closed)return;closed=true;if(observer)observer.disconnect();if(timer!==null)clearTimeout(timer);
      d.removeEventListener("keydown",key,true);ov.remove();if(s.panel===close)s.panel=null;
      try{const b=d.getElementById("cc-files-button");if(b)b.focus()}catch(x){}
    };
    const key=function(ev){try{if(ev.key==="Escape"&&!__ccState().viewer){ev.preventDefault();ev.stopPropagation();close()}}catch(x){}};
    const say=function(t){
      try{if(closed)return;note.textContent=t;if(timer!==null)clearTimeout(timer);timer=setTimeout(function(){note.textContent=""},4000)}catch(x){}
    };
    const load=function(tile){
      try{
        __ccCaps().then(function(c){if(!closed&&c.includes("read_image"))return __ccLoadImage(tile.__ccPath)}).then(function(e){
          if(closed||!e||!e.thumb)return;const im=d.createElement("img");im.src=e.thumb;im.alt="";im.style.cssText="width:100%;height:72px;object-fit:contain";tile.insertBefore(im,tile.firstChild);
        }).catch(function(){});
      }catch(x){}
    };
    if(typeof IntersectionObserver==="function")observer=new IntersectionObserver(function(entries){
      try{for(const e of entries)if(e.isIntersecting){observer.unobserve(e.target);load(e.target)}}catch(x){}
    },{root:body});
    if(!items||!items.length)body.textContent=items?T.empty:T.unreadable;
    for(const group of ["image","folder","file"]){
      const list=(items||[]).filter(function(i){return(i.kind==="image"?"image":i.kind==="folder"?"folder":"file")===group});
      if(!list.length)continue;
      const title=d.createElement("h3"),section=d.createElement("div");title.textContent=T[group];title.style.cssText="font-size:13px;margin:10px 0 6px";
      section.style.cssText=group==="image"?"display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:6px":"display:flex;flex-direction:column;gap:4px";
      for(const item of list){
        const tile=d.createElement("button"),caption=d.createElement("span"),p=item.path.replace(/[\\/]+$/,""),at=Math.max(p.lastIndexOf("\\"),p.lastIndexOf("/"));
        tile.type="button";tile.title=item.path;Object.assign(tile.style,__ccCss("button"),{minWidth:"0",textAlign:"left",overflow:"hidden"});
        caption.textContent=p.slice(at+1)||item.path;caption.style.cssText="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";tile.appendChild(caption);
        if(group!=="image"){
          const folder=d.createElement("span");folder.textContent=p.slice(0,at+1);folder.style.cssText="display:block;color:var(--vscode-descriptionForeground);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";tile.appendChild(folder);
        }
        tile.addEventListener("click",function(){__ccFilesClick(item,tile,say)});section.appendChild(tile);
        if(group==="image"){tile.__ccPath=item.path;if(observer)observer.observe(tile)}
      }
      body.appendChild(title);body.appendChild(section);
    }
    closeButton.addEventListener("click",function(){try{close()}catch(x){}});head.appendChild(closeButton);
    panel.appendChild(head);panel.appendChild(body);panel.appendChild(note);ov.appendChild(panel);d.body.appendChild(ov);
    d.addEventListener("keydown",key,true);s.panel=close;
  }catch(x){}
}

// Contents of the chat (experimental): a button under the files button opens a
// quiet list of every line of the agent's that starts with a question, a
// look-at-this or a warning marker, in chat order; a click scrolls to the line.
// Nothing is counted, ticked off or announced: the list is there to look at.
// Labels per language with the same keys; the part puts the configured language in place of __CC_LANG__.
function __ccAttnLabels(){
  return{
    en:{title:"Marked lines in this chat",empty:"No lines marked \u2753, \ud83d\udc40 or \u26a0\ufe0f in this chat yet",unreadable:"Could not read this chat",lost:"That message is not on screen",close:"Close (Esc)"},
    ru:{title:"\u041e\u0442\u043c\u0435\u0447\u0435\u043d\u043d\u044b\u0435 \u0441\u0442\u0440\u043e\u043a\u0438 \u0447\u0430\u0442\u0430",empty:"\u0412 \u044d\u0442\u043e\u043c \u0447\u0430\u0442\u0435 \u043f\u043e\u043a\u0430 \u043d\u0435\u0442 \u0441\u0442\u0440\u043e\u043a \u0441 \u2753, \ud83d\udc40 \u0438\u043b\u0438 \u26a0\ufe0f",unreadable:"\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u0442\u044c \u0447\u0430\u0442",lost:"\u042d\u0442\u043e\u0433\u043e \u0441\u043e\u043e\u0431\u0449\u0435\u043d\u0438\u044f \u043d\u0435\u0442 \u043d\u0430 \u044d\u043a\u0440\u0430\u043d\u0435",close:"\u0417\u0430\u043a\u0440\u044b\u0442\u044c (Esc)"}
  }.__CC_LANG__;
}
// The marker of each kind, as the list shows it.
function __ccAttnIcon(kind){
  return kind==="ask"?"\u2753":kind==="look"?"\ud83d\udc40":"\u26a0\ufe0f";
}
function __ccAttnClean(s){
  return String(s).replace(/\u2753|\ud83d\udc40|\u26a0|\ufe0f/g,"").replace(/\[([^\]]*)\]\([^)]*\)/g,"$1").replace(/\*\*|__|`/g,"").replace(/^[\s>#*+-]+/,"").replace(/\s+/g," ").trim();
}
// Marked lines of one text, fenced code skipped: [{kind, line}].
function __ccAttnLines(text){
  if(typeof text!=="string")return[];
  const out=[],lines=text.split(/\r?\n/);let fence=null;
  for(const s of lines){
    const f=/^\s*(`{3,}|~{3,})/.exec(s);
    if(f){if(!fence)fence=f[1];else if(f[1][0]===fence[0]&&f[1].length>=fence.length&&/^\s*[`~]+\s*$/.test(s))fence=null;continue}
    if(fence)continue;
    const m=/^[\s>]*(?:[-*+]\s+|\d+[.)]\s+)?(?:\*\*|__)?\s*(\u2753|\ud83d\udc40|\u26a0)/.exec(s);
    if(m)out.push({kind:m[1]==="\u2753"?"ask":m[1]==="\u26a0"?"warn":"look",line:__ccAttnClean(s.slice(m.index+m[0].length))});
  }
  return out;
}
// Every marked line of the main agent's answers, in chat order. null: not window rows.
function __ccAttnCollect(rows){
  try{
    if(!Array.isArray(rows))return null;
    if(rows.length&&!rows.some(function(r){try{return r&&Array.isArray(r.content)}catch(x){return false}}))return null;
    const items=[];
    for(let i=0;i<rows.length;i++){
      const row=rows[i];
      try{
        if(!row||row.type!=="assistant"||row.parentToolUseId!=null||row.sdkParentToolUseId!=null||!Array.isArray(row.content))continue;
        let n=0;
        for(const wrap of row.content){
          const b=wrap&&wrap.content;
          if(!b||b.type!=="text")continue;
          for(const l of __ccAttnLines(b.text)){
            items.push({key:(row.uuid||"row"+i)+":"+n,uuid:row.uuid||null,n:n,kind:l.kind,line:l.line});
            n++;
          }
        }
      }catch(x){}
    }
    return items;
  }catch(x){return null}
}
function __ccAttnRows(){
  try{return __ccAttnCollect(globalThis.__ccSessions.activeSession.value.messages.value)}catch(x){return null}
}
// The rendered element of the item's line inside its message: by its text, else the n-th marked one.
function __ccAttnFind(host,it){
  const marker=it.kind==="ask"?"\u2753":it.kind==="look"?"\ud83d\udc40":"\u26a0",probe=__ccAttnClean(it.line).slice(0,24),seen=[];
  const w=document.createTreeWalker(host,NodeFilter.SHOW_TEXT);let t;
  while((t=w.nextNode())){
    if(t.nodeValue.indexOf(marker)<0||!t.parentElement)continue;
    const el=t.parentElement.closest("p,li,h1,h2,h3,h4,h5,h6,blockquote,td")||t.parentElement;
    if(seen.indexOf(el)<0)seen.push(el);
    if(probe&&__ccAttnClean(el.textContent||"").indexOf(probe)>=0)return el;
  }
  return seen[it.n]||seen[0]||null;
}
// Scrolls the item's line to the middle and outlines it for 1.6 s; false when its message is not on screen.
function __ccAttnJump(it){
  try{
    let host=null;
    if(it.uuid)try{host=document.querySelector('[data-bookmark-uuid="'+CSS.escape(it.uuid)+'"]')}catch(x){}
    const el=host?(__ccAttnFind(host,it)||host):null;
    if(!el)return false;
    el.scrollIntoView({block:"center",behavior:"smooth"});
    const outline=el.style.outline,offset=el.style.outlineOffset;
    el.style.outline="2px solid var(--vscode-focusBorder)";el.style.outlineOffset="2px";
    setTimeout(function(){el.style.outline=outline;el.style.outlineOffset=offset},1600);
    return true;
  }catch(x){return false}
}
// The list body: one button per item; the same items keep the same body.
function __ccAttnFill(body,items,say){
  const d=document,T=__ccAttnLabels(),sig=items?items.map(function(i){return i.key+"="+i.kind+"="+i.line}).join("\n"):"\u0000";
  if(body.__ccSig===sig)return false;
  body.__ccSig=sig;body.textContent="";
  if(!items||!items.length){
    const e=d.createElement("div");e.textContent=items?T.empty:T.unreadable;e.style.cssText="padding:6px 2px;color:var(--vscode-descriptionForeground)";body.appendChild(e);
    return true;
  }
  for(const it of items){
    const b=d.createElement("button");
    b.type="button";b.textContent=__ccAttnIcon(it.kind)+" "+it.line;b.title=it.line;
    b.style.cssText="all:unset;box-sizing:border-box;display:block;width:100%;cursor:pointer;padding:3px 6px;border-radius:4px;line-height:18px;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word";
    b.addEventListener("mouseenter",function(){b.style.background="var(--vscode-list-hoverBackground)"});
    b.addEventListener("mouseleave",function(){b.style.background=""});
    b.addEventListener("click",function(){if(!__ccAttnJump(it))say(T.lost)});
    body.appendChild(b);
  }
  return true;
}
// Opens the list, or closes it when it is open. It stays open until the button,
// the close button or Esc closes it, and follows the chat while open.
function __ccAttnToggle(){
  try{
    const d=document,old=globalThis.__ccAttnPanel;
    if(old){old();return}
    const T=__ccAttnLabels(),panel=d.createElement("div"),head=d.createElement("div"),title=d.createElement("span"),x=d.createElement("button"),body=d.createElement("div"),note=d.createElement("div");
    let timer=null,noteTimer=null,closed=false;
    panel.id="cc-attn-panel";panel.setAttribute("role","region");panel.setAttribute("aria-label",T.title);
    panel.style.cssText="position:fixed;top:4px;right:30px;z-index:9998;display:flex;flex-direction:column;width:min(420px,calc(100vw - 40px));max-height:calc(100vh - 160px);box-sizing:border-box;font-size:12px;background:var(--vscode-editorWidget-background,var(--vscode-editor-background));color:var(--vscode-foreground);border:1px solid var(--vscode-widget-border,#8884);border-radius:6px;box-shadow:0 4px 16px #0005";
    head.style.cssText="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 8px;font-weight:600";
    title.textContent=T.title;
    x.type="button";x.textContent="\u00d7";x.title=T.close;x.setAttribute("aria-label",T.close);
    x.style.cssText="all:unset;cursor:pointer;padding:0 6px;font-size:14px;line-height:18px;border-radius:4px";
    body.style.cssText="overflow:auto;padding:0 4px 6px;flex:1";
    note.style.cssText="padding:0 8px;color:var(--vscode-descriptionForeground)";
    const say=function(t){try{note.textContent=t;note.style.padding="4px 8px";if(noteTimer!==null)clearTimeout(noteTimer);noteTimer=setTimeout(function(){note.textContent="";note.style.padding="0 8px"},4000)}catch(e){}};
    const key=function(ev){try{if(ev.key==="Escape"&&!(globalThis.__ccMedia&&globalThis.__ccMedia.viewer)){ev.preventDefault();ev.stopPropagation();close()}}catch(e){}};
    const close=function(){
      if(closed)return;closed=true;
      if(timer!==null)clearInterval(timer);if(noteTimer!==null)clearTimeout(noteTimer);
      d.removeEventListener("keydown",key,true);panel.remove();
      if(globalThis.__ccAttnPanel===close)globalThis.__ccAttnPanel=null;
    };
    const refresh=function(){
      try{
        const atEnd=body.scrollHeight-body.scrollTop-body.clientHeight<4;
        if(__ccAttnFill(body,__ccAttnRows(),say)&&atEnd)body.scrollTop=body.scrollHeight;
      }catch(e){}
    };
    x.addEventListener("click",close);
    head.appendChild(title);head.appendChild(x);panel.appendChild(head);panel.appendChild(body);panel.appendChild(note);d.body.appendChild(panel);
    __ccAttnFill(body,__ccAttnRows(),say);body.scrollTop=body.scrollHeight;
    timer=setInterval(refresh,1000);
    d.addEventListener("keydown",key,true);
    globalThis.__ccAttnPanel=close;
  }catch(x){}
}
// The button: under the files button, same size, a list outline.
function __ccAttnBoot(){
  try{
    const d=document;
    if(window.IS_SESSION_LIST_ONLY||d.getElementById("cc-attn-button"))return;
    if(!d.body){d.addEventListener("DOMContentLoaded",__ccAttnBoot,{once:true});return}
    const T=__ccAttnLabels(),b=d.createElement("button"),ns="http://www.w3.org/2000/svg",svg=d.createElementNS(ns,"svg"),p=d.createElementNS(ns,"path");
    b.id="cc-attn-button";b.type="button";b.title=T.title;b.setAttribute("aria-label",T.title);
    b.style.cssText="position:fixed;z-index:9999;top:30px;right:4px;width:22px;height:22px;padding:2px;border:0;border-radius:3px;cursor:pointer;background:var(--vscode-editor-background);color:var(--vscode-foreground)";
    svg.setAttribute("viewBox","0 0 20 20");svg.setAttribute("width","18");svg.setAttribute("height","18");svg.setAttribute("aria-hidden","true");
    p.setAttribute("d","M3 5h1.5M3 10h1.5M3 15h1.5M7 5h10M7 10h10M7 15h7");p.setAttribute("fill","none");p.setAttribute("stroke","currentColor");p.setAttribute("stroke-width","1.6");p.setAttribute("stroke-linecap","round");
    svg.appendChild(p);b.appendChild(svg);b.addEventListener("click",__ccAttnToggle);d.body.appendChild(b);
  }catch(x){}
}
try{__ccAttnBoot()}catch(__ccE){}

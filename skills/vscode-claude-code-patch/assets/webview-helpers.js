// CC-HELP: the helper functions the chat-media part inserts at the top level of
// the chat webview bundle, right before the code block component.
//
// Rules this file keeps:
// - the top level holds only function declarations: nothing runs while the bundle
//   loads, and bundle names may not be initialised yet at that moment;
// - bundle names are reached only through __ccB(); the placeholders __CC_*__
//   stand only in its body and the part fills them with the derived names; the
//   one exception is __CC_LANG__ in __ccTxt, filled with the configured language;
// - functions the bundle calls (__ccUrl, __ccCodeBar, __ccImg, __ccLink) never
//   throw and call no hooks; __ccCard calls its hooks first and unconditionally;
// - all state lives in globalThis.__ccMedia, created on first use: a card is
//   re-created on every render of the markdown component and owns nothing;
// - strict-mode clean, non-ASCII text only as \u escapes;
// - comments only as full lines starting with // (the part drops them).

function __ccB(){return{jsx:__CC_JSX__,jsxs:__CC_JSXS__,useRef:__CC_USEREF__,useEffect:__CC_USEEFFECT__,useState:__CC_USESTATE__,useCallback:__CC_USECALLBACK__,urlFilter:__CC_URLFILTER__}}

// Interface texts, one table per language with the same keys; the part puts the
// configured language in place of __CC_LANG__. "photos" opens the file in the
// app Windows has for its extension.
function __ccTxt(){
  return{
    en:{
      open:"Open",
      reveal:"Show in folder",
      folder:"Open folder",
      photoshop:"Photoshop",
      photos:"Default app",
      loading:"loading\u2026",
      missing:"file not found",
      bigHead:"too large to preview (",
      bigTail:" MB)",
      unavailable:"preview unavailable",
      failed:"could not open: ",
      close:"Close (Esc)"
    },
    ru:{
      open:"\u041e\u0442\u043a\u0440\u044b\u0442\u044c",
      reveal:"\u0412 \u043f\u0430\u043f\u043a\u0435",
      folder:"\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u043f\u0430\u043f\u043a\u0443",
      photoshop:"Photoshop",
      photos:"\u0424\u043e\u0442\u043e\u0433\u0440\u0430\u0444\u0438\u0438",
      loading:"\u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0430\u2026",
      missing:"\u0444\u0430\u0439\u043b \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d",
      bigHead:"\u0444\u0430\u0439\u043b \u0431\u043e\u043b\u044c\u0448\u043e\u0439 (",
      bigTail:" \u041c\u0411), \u043f\u043e\u044d\u0442\u043e\u043c\u0443 \u043f\u043e\u043a\u0430 \u0431\u0435\u0437 \u043a\u0430\u0440\u0442\u0438\u043d\u043a\u0438",
      unavailable:"\u043f\u0440\u0435\u0432\u044c\u044e \u043d\u0435\u0434\u043e\u0441\u0442\u0443\u043f\u043d\u043e",
      failed:"\u043d\u0435 \u043e\u0442\u043a\u0440\u044b\u043b\u043e\u0441\u044c: ",
      close:"\u0417\u0430\u043a\u0440\u044b\u0442\u044c (Esc)"
    }
  }.__CC_LANG__;
}

// Window-wide state: capabilities, preview cache, queue, failure lines, viewer.
function __ccState(){
  let s=globalThis.__ccMedia;
  if(!s){
    s={caps:null,capsWait:null,capsTimer:null,capsTry:0,cache:new Map(),inflight:new Map(),queue:[],active:0,notes:new Map(),subs:new Set(),viewer:null};
    globalThis.__ccMedia=s;
  }
  return s;
}

// Tells mounted cards that path p (or, with null, the capabilities) changed.
function __ccNotify(p){
  for(const f of Array.from(__ccState().subs)){try{f(p)}catch(e){}}
}

// One request to the host over the window's own connection.
// Resolves with the host's answer or with {ok:false,error,why}; never rejects.
// why: noconn (nothing sent), timeout, closed (connection closed), host (the
// host answered {type:"error"}), throw.
function __ccReq(req,ms){
  return new Promise(function(done){
    let over=false,timer=null;
    const fin=function(r){if(over)return;over=true;if(timer!==null)clearTimeout(timer);done(r)};
    try{
      const cx=globalThis.__ccCtx,c=cx&&cx.comms&&cx.comms.connection&&cx.comms.connection.value;
      if(!c){fin({ok:false,error:"no connection",why:"noconn"});return}
      timer=setTimeout(function(){fin({ok:false,error:"timeout",why:"timeout"})},ms);
      c.sendRequest(req).then(function(r){
        fin(r&&typeof r==="object"?r:{ok:false,error:"empty answer",why:"host"});
      },function(e){
        const m=String(e&&e.message||e);
        fin({ok:false,error:m,why:m==="Connection closed"?"closed":"host"});
      });
    }catch(e){fin({ok:false,error:String(e&&e.message||e),why:"throw"})}
  });
}

// Host capabilities. Remembered for the window only when the host answered (its
// list, or [] after {type:"error"} from an unpatched host); a timeout or a lost
// connection is asked again: by the next call, and by __ccCapsLater while cards
// are mounted; one request in flight. again: the call is a re-ask of the
// schedule; any other call that sends starts a new schedule.
function __ccCaps(again){
  const s=__ccState();
  if(s.caps)return Promise.resolve(s.caps);
  if(!s.capsWait){
    if(s.capsTimer!==null){clearTimeout(s.capsTimer);s.capsTimer=null}
    if(!again)s.capsTry=0;
    s.capsWait=__ccReq({type:"cc_host_caps"},5000).then(function(r){
      s.capsWait=null;
      if(r.why&&r.why!=="host"){__ccCapsLater(s);return[]}
      s.caps=Array.isArray(r.caps)?r.caps.filter(function(x){return typeof x==="string"}):[];
      __ccNotify(null);
      return s.caps;
    });
  }
  return s.capsWait;
}

// After a failure that is not the host's answer, while a card is subscribed:
// one timer asks again 5 s, 15 s, then 60 s after each failure; after the
// third re-ask fails there is none until a call starts a new schedule.
function __ccCapsLater(s){
  if(s.capsTry>=3||!s.subs.size)return;
  s.capsTimer=setTimeout(function(){s.capsTimer=null;if(s.subs.size)__ccCaps(true)},[5000,15000,60000][s.capsTry++]);
}

// A drive-letter path alone on one line, with / turned into \; else null.
function __ccPathOf(t){
  if(typeof t!=="string")return null;
  const p=t.trim();
  if(!/^[A-Za-z]:[\\/][^\r\n<>"|?*]*$/.test(p))return null;
  return p.replace(/\//g,"\\");
}

// image | psd | folder | noeditor | file, by the extension of the last segment;
// a segment starting with a dot has no extension, like path.extname.
function __ccKind(p){
  if(/[\\/]$/.test(p))return"folder";
  const seg=p.split(/[\\/]/).pop(),dot=seg.lastIndexOf(".");
  const ext=dot>0?seg.slice(dot+1).toLowerCase():"";
  if(!ext)return"folder";
  if(/^(png|jpg|jpeg|webp|gif|bmp)$/.test(ext))return"image";
  if(/^(psd|psb)$/.test(ext))return"psd";
  if(/^(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|7z|rar|exe|dll|msi|tif|tiff|heic|heif|mp3|wav)$/.test(ext))return"noeditor";
  return"file";
}

// The one gate for link and image addresses. They arrive already
// re-encoded by the bundle (C:%5Cx): the W3 regex, file:///X: to X:, then
// decodeURIComponent (the raw string if it fails) and __ccPathOf.
function __ccDecodeHref(u){
  if(typeof u!=="string"||!/^(?:[A-Za-z]:(?:[\\/]|%5[Cc])|file:)/.test(u))return null;
  let s=u.replace(/^file:\/\/\/(?=[A-Za-z]:)/,"");
  try{s=decodeURIComponent(s)}catch(e){}
  return __ccPathOf(s);
}

// W3: react-markdown's urlTransform. A drive path passes as it is; everything
// else goes to the stock filter exactly as before.
function __ccUrl(u,key,node){
  try{if(__ccDecodeHref(u)!==null)return u}catch(e){}
  return __ccB().urlFilter(u,key,node);
}

// Buttons of a path kind, in order: each only with its host
// capability; "open" also needs the stock fileOpener. The card state never
// removes a button: a large image keeps all three.
function __ccButtons(kind,caps,hasOpener,state){
  const c=Array.isArray(caps)?caps:[],out=[];
  const add=function(key,cap,ok){if(ok&&(cap===null||c.indexOf(cap)>=0))out.push(key)};
  if(kind==="image"){add("open","open",hasOpener);add("photos","photos",true);add("reveal","reveal",true)}
  else if(kind==="psd"){add("photoshop","photoshop",true);add("reveal","reveal",true)}
  else if(kind==="folder")add("folder","reveal",true);
  else if(kind==="noeditor")add("reveal","reveal",true);
  else{add("open",null,hasOpener);add("reveal","reveal",true)}
  return out;
}

// Runs one button for path p; resolves with the failure line to show, or null.
function __ccAct(key,p,opener){
  try{
    if(key==="open"){if(opener&&typeof opener.open==="function")opener.open(p);return Promise.resolve(null)}
    const r={reveal:{type:"cc_reveal_in_os",mode:"select"},folder:{type:"cc_reveal_in_os",mode:"open"},photos:{type:"cc_open_in_photos"},photoshop:{type:"cc_open_in_photoshop"}}[key];
    if(!r)return Promise.resolve(null);
    r.path=p;
    return __ccReq(r,15000).then(function(a){return a&&a.ok===true?null:__ccFailText(a)});
  }catch(e){return Promise.resolve(null)}
}

// The failure line of a refused action.
function __ccFailText(a){
  const e=String(a&&a.error||"");
  return/^ENOENT/.test(e)?__ccTxt().missing:__ccTxt().failed+e;
}

// Megabytes of the "large file" caption, rounded up (1 MB = 1048576 bytes).
function __ccMb(size){return Math.ceil(Number(size)/1048576)}

// A read_image answer without a picture as a card state.
function __ccStateOf(r){
  if(r&&r.ok===false&&r.error==="too large")return{state:"large",size:r.size};
  if(r&&r.ok===false&&/^ENOENT/.test(String(r.error)))return{state:"missing"};
  return{state:"unavailable"};
}

// The caption of a card state; null when the preview itself is shown.
function __ccStatus(e){
  const t=__ccTxt();
  if(!e)return t.loading;
  if(e.state==="ok")return null;
  if(e.state==="large")return t.bigHead+__ccMb(e.size)+t.bigTail;
  if(e.state==="missing")return t.missing;
  return t.unavailable;
}

// Preview of path p: one request per path in flight, shared by all
// its cards; at most two card requests in flight per window, the rest queued in
// order; a path answered less than 1 s ago is not asked again; knownMtimeMs lets
// the host answer notModified. Resolves with the path's cache entry.
function __ccLoadImage(p){
  const s=__ccState();
  if(s.inflight.has(p))return s.inflight.get(p);
  const prev=s.cache.get(p);
  if(prev){s.cache.delete(p);s.cache.set(p,prev);if(Date.now()-prev.at<1000)return Promise.resolve(prev)}
  const req={type:"cc_read_image",path:p};
  if(prev&&typeof prev.mtimeMs==="number")req.knownMtimeMs=prev.mtimeMs;
  const job=new Promise(function(res){s.queue.push({req:req,res:res});__ccPump()})
  .then(function(r){return __ccStore(p,r,prev)})
  .catch(function(){return __ccPut(p,{state:"unavailable"})})
  .then(function(e){s.inflight.delete(p);__ccNotify(p);return e});
  s.inflight.set(p,job);
  return job;
}

// Sends queued card requests while fewer than two are in flight.
function __ccPump(){
  const s=__ccState();
  while(s.active<2&&s.queue.length){
    const j=s.queue.shift();
    s.active++;
    __ccReq(j.req,15000).then(function(r){s.active--;j.res(r);__ccPump()});
  }
}

// Stores a read_image answer as the path's cache entry: a thumbnail, never the file.
function __ccStore(p,r,prev){
  if(r&&r.ok===true&&r.notModified&&prev&&prev.state==="ok")return __ccPut(p,{state:"ok",thumb:prev.thumb,size:r.size,mtimeMs:r.mtimeMs});
  if(!(r&&r.ok===true&&typeof r.dataUrl==="string"))return __ccPut(p,__ccStateOf(r));
  return Promise.resolve(__ccThumb(r.dataUrl)).then(function(t){
    return __ccPut(p,t?{state:"ok",thumb:t,size:r.size,mtimeMs:r.mtimeMs}:{state:"unavailable"});
  },function(){return __ccPut(p,{state:"unavailable"})});
}

// The cache keeps at most 200 paths; the least recently used goes first.
function __ccPut(p,e){
  const s=__ccState();
  e.at=Date.now();
  s.cache.delete(p);
  s.cache.set(p,e);
  while(s.cache.size>200)s.cache.delete(s.cache.keys().next().value);
  return e;
}

// Thumbnail of a data: URL, at most 400 px on the longer side, as webp.
function __ccThumb(u){
  return new Promise(function(res){
    try{
      const im=new Image();
      im.onload=function(){
        try{
          const k=Math.min(1,400/Math.max(im.naturalWidth,im.naturalHeight,1)),c=document.createElement("canvas");
          c.width=Math.max(1,Math.round(im.naturalWidth*k));
          c.height=Math.max(1,Math.round(im.naturalHeight*k));
          c.getContext("2d").drawImage(im,0,0,c.width,c.height);
          res(c.toDataURL("image/webp"));
        }catch(e){res(null)}
      };
      im.onerror=function(){res(null)};
      im.src=u;
    }catch(e){res(null)}
  });
}

// String children of the code element, joined recursively.
function __ccText(n){
  if(typeof n==="string"||typeof n==="number")return String(n);
  if(Array.isArray(n))return n.map(__ccText).join("");
  if(n&&typeof n==="object"&&n.props)return __ccText(n.props.children);
  return"";
}

// W6: a card under a fenced block that holds one path; otherwise nothing.
function __ccCodeBar(children){
  try{
    const p=__ccPathOf(__ccText(children));
    return p===null?null:__ccB().jsx(__ccCard,{path:p,kind:__ccKind(p)});
  }catch(e){return null}
}

// W5: a markdown image with a drive path gets the same card; else the stock [Image].
function __ccImg(src,alt){
  try{
    const p=__ccDecodeHref(src);
    return p===null?null:__ccB().jsx(__ccCard,{path:p,kind:__ccKind(p),alt:typeof alt==="string"?alt:""});
  }catch(e){return null}
}

// W4: a click on a link to a drive path is always taken over, synchronously (the
// stock handler cannot open such an address); the first button of its kind runs
// once the capabilities are known. Any other link returns false: stock handling.
function __ccLink(e,href,opener){
  let p=null;
  try{p=__ccDecodeHref(href)}catch(x){}
  if(p===null)return false;
  try{e.preventDefault();e.stopPropagation()}catch(x){}
  try{
    const cx=globalThis.__ccCtx,o=opener||(cx&&cx.fileOpener)||null,kind=__ccKind(p);
    __ccCaps().then(function(c){
      const keys=__ccButtons(kind,c,!!o,null).filter(function(k){return kind!=="file"||k==="open"});
      if(keys.length)return __ccAct(keys[0],p,o);
    }).catch(function(){});
  }catch(x){}
  return true;
}

// Runs a card button; a failure shows under the buttons for 4 s.
function __ccDo(key,p,opener){
  try{__ccAct(key,p,opener).then(function(t){if(t)__ccSay(p,t)}).catch(function(){})}catch(e){}
}

function __ccSay(p,text){
  const s=__ccState();
  s.notes.set(p,{text:text,until:Date.now()+4000});
  __ccNotify(p);
  setTimeout(function(){try{const n=s.notes.get(p);if(n&&n.until<=Date.now()){s.notes.delete(p);__ccNotify(p)}}catch(e){}},4010);
}

// Inline styles; colours come from the VS Code theme.
function __ccCss(k){
  const S={
    card:{display:"inline-block",verticalAlign:"top",maxWidth:"100%",margin:"4px 0"},
    row:{display:"flex",flexWrap:"wrap",gap:"4px",marginTop:"4px"},
    button:{font:"inherit",fontSize:"12px",lineHeight:"18px",padding:"1px 8px",borderRadius:"4px",cursor:"pointer",border:"1px solid var(--vscode-button-border, transparent)",background:"var(--vscode-button-secondaryBackground)",color:"var(--vscode-button-secondaryForeground)"},
    thumb:{display:"block",padding:"0",margin:"0",lineHeight:"0",cursor:"zoom-in",background:"transparent",border:"1px solid var(--vscode-widget-border, transparent)"},
    img:{display:"block",maxWidth:"200px",maxHeight:"200px",objectFit:"contain"},
    note:{display:"block",fontSize:"12px",marginTop:"2px",color:"var(--vscode-descriptionForeground)"}
  };
  return S[k];
}

// On a notification: a card that has been visible (only an image card's observer
// marks it) loads its preview once the capabilities allow it and its path has
// no preview yet; __ccLoadImage shares, queues and keeps the 1 s freshness.
function __ccWake(p,seen){
  try{
    const s=__ccState(),c=s.caps,e=s.cache.get(p);
    if(seen&&c&&c.indexOf("read_image")>=0&&!(e&&e.state==="ok"))__ccLoadImage(p);
  }catch(x){}
}

// A path card: preview or caption, the buttons, a failure line. Inline elements
// only: a markdown image sits inside <p>. The root swallows clicks, since the
// card may sit inside a link that the window would otherwise open.
function __ccCard(props){
  const B=__ccB(),tick=B.useState(0),ref=B.useRef(null),seen=B.useRef(false);
  B.useEffect(function(){
    let live=true;
    const s=__ccState(),f=function(p){if(live&&(p===null||p===props.path)){tick[1](function(n){return n+1});__ccWake(props.path,seen.current)}};
    try{s.subs.add(f)}catch(e){}
    return function(){live=false;try{s.subs.delete(f)}catch(e){}};
  },[props.path]);
  B.useEffect(function(){
    let io=null;
    try{
      __ccCaps();
      const el=ref.current;
      if(props.kind==="image"&&el&&typeof IntersectionObserver==="function"){
        io=new IntersectionObserver(function(list){
          try{
            if(!list.some(function(x){return x.isIntersecting}))return;
            seen.current=true;
            io.disconnect();
            io=null;
            __ccCaps().then(function(c){if(c.indexOf("read_image")>=0)return __ccLoadImage(props.path)}).catch(function(){});
          }catch(e){}
        });
        io.observe(el);
      }
    }catch(e){}
    return function(){try{if(io)io.disconnect()}catch(e){}};
  },[props.path,props.kind]);
  try{
    const s=__ccState(),T=__ccTxt(),J=B.jsx,p=props.path,kind=props.kind,caps=s.caps;
    const cx=globalThis.__ccCtx,opener=props.opener||(cx&&cx.fileOpener)||null;
    const e=s.cache.get(p)||null,kids=[],tooLarge=!!(e&&e.state==="large");
    if(kind==="image"&&!(caps&&caps.indexOf("read_image")<0)){
      if(e&&e.state==="ok"&&e.thumb){
        kids.push(J("button",{type:"button",title:p,style:__ccCss("thumb"),onClick:function(ev){__ccViewer(p,props.alt||"",ev.currentTarget)},children:J("img",{src:e.thumb,alt:props.alt||"",style:__ccCss("img")})},"preview"));
      }else kids.push(J("span",{style:__ccCss("note"),children:__ccStatus(e)},"status"));
    }
    const row=caps?__ccButtons(kind,caps,!!opener,e&&e.state).map(function(k){
        return J("button",{type:"button",style:__ccCss("button"),onClick:function(){__ccDo(k,p,opener)},children:T[k]},k);
      }):[];
    try{const more=typeof __ccMarkButtons==="function"?__ccMarkButtons(props.path,kind,tooLarge,caps):null;if(more)row.push(...more)}catch(x){}
    if(row.length)kids.push(B.jsxs("span",{style:__ccCss("row"),children:row},"buttons"));
    const n=s.notes.get(p);
    if(n&&n.until>Date.now())kids.push(J("span",{style:__ccCss("note"),children:n.text},"note"));
    return B.jsxs("span",{ref:ref,"data-cc-card":kind,style:__ccCss("card"),onClick:function(ev){try{ev.preventDefault();ev.stopPropagation()}catch(x){}},children:kids});
  }catch(x){return null}
}

// "Fit": centred, never enlarged beyond 100%.
function __ccFit(W,H,nw,nh){
  if(!(nw>0&&nh>0))return{s:1,tx:0,ty:0};
  const s=Math.min(1,W/nw,H/nh);
  return{s:s,tx:(W-nw*s)/2,ty:(H-nh*s)/2};
}

// Wheel zoom about the cursor (cx, cy) for view v {s,tx,ty,fit}: the scale is
// clamped to [0.5*fit, 16] and the point under the cursor stays under it.
function __ccZoom(v,cx,cy,deltaY){
  const s=Math.min(16,Math.max(0.5*v.fit,v.s*Math.exp(-deltaY*0.0015))),k=s/v.s;
  return{s:s,tx:cx-(cx-v.tx)*k,ty:cy-(cy-v.ty)*k};
}

// The viewer: plain DOM outside React, one per window, closed only by
// Esc, a click on the backdrop or the close button; it loads the file itself.
function __ccPanBtn(b){return b===0||b===1}
function __ccViewer(p,alt,from,opts){
  try{
    const s=__ccState(),T=__ccTxt(),d=document,v={s:1,tx:0,ty:0,fit:1,drag:null,moved:false,downBg:false,closed:false,off:[]};
    if(s.viewer)s.viewer();
    const ov=d.createElement("div"),img=d.createElement("img"),note=d.createElement("div"),bar=d.createElement("div"),pct=d.createElement("span"),msg=d.createElement("span");
    ov.style.cssText="position:fixed;inset:0;z-index:10000;background:#000000d9;overflow:hidden;touch-action:none;user-select:none";
    img.draggable=false;
    img.alt=alt||"";
    img.style.cssText="position:absolute;left:0;top:0;transform-origin:0 0;max-width:none;max-height:none;visibility:hidden";
    note.style.cssText="position:absolute;left:0;right:0;top:45%;text-align:center;color:#fff;font-size:13px";
    bar.style.cssText="position:absolute;top:0;left:0;right:0;display:flex;align-items:center;justify-content:flex-end;gap:6px;padding:6px;color:#fff;font-size:12px";
    note.textContent=T.loading;
    const on=function(t,type,f,o){
      const g=function(ev){try{f(ev)}catch(x){}};
      t.addEventListener(type,g,o);
      v.off.push(function(){t.removeEventListener(type,g,o)});
    };
    const draw=function(){img.style.transform="translate("+v.tx+"px,"+v.ty+"px) scale("+v.s+")";pct.textContent=Math.round(v.s*100)+"%"};
    const fit=function(){const r=ov.getBoundingClientRect(),f=__ccFit(r.width,r.height,img.naturalWidth,img.naturalHeight);v.s=f.s;v.tx=f.tx;v.ty=f.ty;v.fit=f.s;draw()};
    const close=function(){
      if(v.closed)return;
      v.closed=true;
      for(const f of v.off){try{f()}catch(x){}}
      try{img.removeAttribute("src");ov.remove()}catch(x){}
      if(s.viewer===close)s.viewer=null;
      try{if(from&&from.isConnected)from.focus()}catch(x){}
    };
    s.viewer=close;
    const button=function(label,title,run){
      const b=d.createElement("button");
      b.type="button";
      b.textContent=label;
      if(title)b.title=title;
      b.style.cssText="font:inherit;font-size:12px;padding:2px 8px;border-radius:4px;cursor:pointer;border:1px solid #ffffff55;background:#00000080;color:#fff";
      on(b,"click",function(ev){ev.stopPropagation();run()});
      bar.appendChild(b);
    };
    const act=function(k){__ccAct(k,p,null).then(function(t){if(!t||v.closed)return;msg.textContent=t;setTimeout(function(){if(msg.textContent===t)msg.textContent=""},4000)}).catch(function(){})};
    const caps=s.caps||[];
    bar.appendChild(msg);
    bar.appendChild(pct);
    if(p&&caps.indexOf("photos")>=0&&__ccKind(p)==="image")button(T.photos,"",function(){act("photos")});
    if(p&&caps.indexOf("reveal")>=0)button(T.reveal,"",function(){act("reveal")});
    button("\u00d7",T.close,close);
    on(ov,"wheel",function(ev){
      ev.preventDefault();
      if(!img.naturalWidth)return;
      const r=ov.getBoundingClientRect(),z=__ccZoom(v,ev.clientX-r.left,ev.clientY-r.top,ev.deltaY);
      v.s=z.s;v.tx=z.tx;v.ty=z.ty;draw();
    },{passive:false});
    on(ov,"pointerdown",function(ev){
      if(!__ccPanBtn(ev.button)||bar.contains(ev.target))return;if(ev.button===1)ev.preventDefault();
      v.drag={x:ev.clientX,y:ev.clientY,tx:v.tx,ty:v.ty};
      v.moved=false;
      v.downBg=ev.target===ov;
      try{ov.setPointerCapture(ev.pointerId)}catch(x){}
    });
    on(ov,"pointermove",function(ev){
      if(!v.drag)return;
      const dx=ev.clientX-v.drag.x,dy=ev.clientY-v.drag.y;
      if(Math.abs(dx)>3||Math.abs(dy)>3)v.moved=true;
      v.tx=v.drag.tx+dx;v.ty=v.drag.ty+dy;draw();
    });
    on(ov,"pointerup",function(){v.drag=null});
    on(ov,"pointercancel",function(){v.drag=null});
    on(ov,"click",function(ev){
      if(v.moved){v.moved=false;return}
      if(ev.target===ev.currentTarget&&v.downBg)close();
    });
    on(ov,"dblclick",function(ev){if(!bar.contains(ev.target))fit()});
    on(d,"keydown",function(ev){if(ev.key==="Escape"){ev.preventDefault();ev.stopPropagation();ev.stopImmediatePropagation();close()}},true);
    on(img,"load",function(){note.textContent="";img.style.visibility="visible";fit();if(typeof __ccMarkViewer==="function")try{__ccMarkViewer({path:p,overlay:ov,bar:bar,img:img,close:close,draw:!!(opts&&opts.draw)})}catch(x){}});
    on(img,"error",function(){note.textContent=T.unavailable});
    ov.appendChild(img);
    ov.appendChild(note);
    ov.appendChild(bar);
    d.body.appendChild(ov);
    __ccReq({type:"cc_read_image",path:p},15000).then(function(r){
      if(v.closed)return;
      if(r&&r.ok===true&&typeof r.dataUrl==="string")img.src=r.dataUrl;
      else note.textContent=__ccStatus(__ccStateOf(r));
    });
  }catch(e){}
}

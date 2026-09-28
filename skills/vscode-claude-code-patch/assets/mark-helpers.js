// Plain-text insertion and source-pixel rectangles; no work at bundle load.
// Labels per language with the same keys; the part puts the configured language in
// place of __CC_LANG__. "regions" heads the text Done puts into the prompt.
function __ccMarkLabels(){
  return{
    en:{select:"Insert path",mark:"Mark",undo:"Undo",clear:"Clear",done:"Done",
      selectTip:"Insert the file path into the prompt",markTip:"Draw boxes around areas of the image",undoTip:"Remove the last box",
      regions:"regions [x1,y1,x2,y2] in source image pixels:"},
    ru:{select:"\u0412\u044b\u0431\u0440\u0430\u0442\u044c",mark:"\u041e\u0431\u0432\u0435\u0441\u0442\u0438",undo:"\u041e\u0442\u043c\u0435\u043d\u0438\u0442\u044c",clear:"\u041e\u0447\u0438\u0441\u0442\u0438\u0442\u044c",done:"\u0413\u043e\u0442\u043e\u0432\u043e",
      selectTip:"\u0412\u0441\u0442\u0430\u0432\u0438\u0442\u044c \u043f\u0443\u0442\u044c \u0432 \u043f\u043e\u043b\u0435 \u0432\u0432\u043e\u0434\u0430",markTip:"\u041e\u0431\u0432\u0435\u0441\u0442\u0438 \u043e\u0431\u043b\u0430\u0441\u0442\u0438 \u043f\u0440\u044f\u043c\u043e\u0443\u0433\u043e\u043b\u044c\u043d\u0438\u043a\u0430\u043c\u0438",undoTip:"\u041e\u0442\u043c\u0435\u043d\u0438\u0442\u044c \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u044e\u044e \u0440\u0430\u043c\u043a\u0443",
      regions:"\u043e\u0431\u043b\u0430\u0441\u0442\u0438 [x1,y1,x2,y2] \u0432 \u043f\u0438\u043a\u0441\u0435\u043b\u044f\u0445 \u0438\u0441\u0445\u043e\u0434\u043d\u0438\u043a\u0430:"}
  }.__CC_LANG__;
}
function __ccMarkEmitter(){
  try{const c=globalThis.__ccCtx,e=c&&c.atMentionEvents;return e&&typeof e.emit==="function"?e:null}catch(x){return null}
}
function __ccMarkPathText(path){return typeof path==="string"&&path.includes(" ")?'"'+path+'"':path}
function __ccMarkInsert(text){
  try{
    const e=__ccMarkEmitter();if(!e)return false;
    try{const panel=__ccState().panel;if(typeof panel==="function")panel()}catch(x){}
    e.emit(text);return true;
  }catch(x){return false}
}
function __ccMarkInsertLines(text){
  try{
    const lines=text.split("\n");let inserted=__ccMarkInsert(lines[0]);
    for(let i=1;i<lines.length;i++){
      if(!inserted)return false;
      const active=document.activeElement;
      if(!active||active.nodeType!==1||active.isContentEditable!==true)return false;
      document.execCommand("insertLineBreak");inserted=__ccMarkInsert(lines[i]);
    }
    return inserted;
  }catch(x){return false}
}
function __ccMarkButtons(path,kind,tooLarge,caps){
  try{
    if(kind!=="image"||!__ccMarkEmitter())return null;
    const B=__ccB(),T=__ccMarkLabels(),keys=["select"];
    if(Array.isArray(caps)&&caps.includes("read_image")&&!tooLarge)keys.push("mark");
    return keys.map(function(k){return B.jsx("button",{type:"button",style:__ccCss("button"),title:T[k+"Tip"],children:T[k],
      onPointerDown:function(e){try{e.preventDefault()}catch(x){}},
      onClick:function(e){try{if(k==="select")__ccMarkInsert(__ccMarkPathText(path));else __ccViewer(path,"",e.currentTarget,{draw:true})}catch(x){}}},k)});
  }catch(x){return null}
}
function __ccMarkTakes(button,drawing){return button===0&&drawing===true}
function __ccMarkBox(p1,p2,r,nw,nh){
  if(!p1||!p2||!r||!(r.width>0&&r.height>0&&nw>0&&nh>0))return null;
  if(Math.abs(p2.x-p1.x)<4||Math.abs(p2.y-p1.y)<4)return null;
  const x=function(p){return Math.max(0,Math.min(nw,(p.x-r.left)/r.width*nw))};
  const y=function(p){return Math.max(0,Math.min(nh,(p.y-r.top)/r.height*nh))};
  const x1=Math.floor(Math.min(x(p1),x(p2))),x2=Math.ceil(Math.max(x(p1),x(p2)));
  const y1=Math.floor(Math.min(y(p1),y(p2))),y2=Math.ceil(Math.max(y(p1),y(p2)));
  return x1<x2&&y1<y2?[x1,y1,x2,y2]:null;
}
function __ccMarkScreen(box,r,nw,nh){
  return{left:r.left+box[0]/nw*r.width,top:r.top+box[1]/nh*r.height,width:(box[2]-box[0])/nw*r.width,height:(box[3]-box[1])/nh*r.height};
}
function __ccMarkText(path,nw,nh,boxes){
  const joiner="\n";
  const head=__ccMarkPathText(path)+" ("+nw+"x"+nh+"), "+__ccMarkLabels().regions;
  return[head].concat(boxes.map(function(b,i){return(i+1)+" ["+b.join(",")+"]: "})).join(joiner);
}
// The reducer is pure; the store keeps each path's latest immutable array.
function __ccMarkUpdate(boxes,action,box){
  if(action==="add"&&box)return boxes.concat([box.slice()]);
  if(action==="undo")return boxes.slice(0,-1);
  if(action==="clear")return[];
  return boxes;
}
function __ccMarkBoxes(path,action,box){
  const s=__ccState();if(!s.marks)s.marks=new Map();
  const key=path.toLowerCase(),boxes=__ccMarkUpdate(s.marks.get(key)||[],action,box);s.marks.set(key,boxes);return boxes;
}
function __ccMarkDone(path,nw,nh,close){
  try{const boxes=__ccMarkBoxes(path);if(!boxes.length)return false;const t=__ccMarkText(path,nw,nh,boxes);close();return __ccMarkInsertLines(t)}catch(x){return false}
}
function __ccMarkViewer(o){
  try{
    if(!__ccMarkEmitter()||!o||o.overlay.__ccMarked)return;
    const path=o.path,overlay=o.overlay,bar=o.bar,img=o.img,d=overlay.ownerDocument,T=__ccMarkLabels();
    bar.style.flexWrap="wrap";
    overlay.__ccMarked=true;
    let drawing=!!o.draw,drag=null,live=null,swallow=false,observer=null;
    const boxesLayer=d.createElement("div"),input=d.createElement("div"),mode=d.createElement("span"),first=bar.querySelector("button");
    boxesLayer.style.cssText="position:absolute;inset:0;pointer-events:none";
    input.style.cssText="position:absolute;inset:0;touch-action:none";
    mode.style.cssText="display:inline-flex;gap:6px";
    overlay.insertBefore(boxesLayer,bar);overlay.insertBefore(input,bar);
    const on=function(el,type,fn){el.addEventListener(type,function(ev){try{fn(ev)}catch(x){}})};
    const button=function(k,parent){
      const b=d.createElement("button");b.type="button";b.textContent=T[k];b.title=T[k+"Tip"]||T[k];
      b.style.cssText="font:inherit;font-size:12px;padding:2px 8px;border-radius:4px;cursor:pointer;border:1px solid #ffffff55;background:#00000080;color:#fff";
      on(b,"pointerdown",function(ev){ev.preventDefault()});
      if(parent===bar)bar.insertBefore(b,first);else parent.appendChild(b);return b;
    };
    const select=button("select",bar),mark=button("mark",bar),undo=button("undo",mode),clear=button("clear",mode),done=button("done",mode);
    bar.insertBefore(mode,first);
    const alive=function(){
      if(overlay.isConnected)return true;
      window.removeEventListener("resize",refresh);if(observer)observer.disconnect();return false;
    };
    const refresh=function(){
      try{
        if(!alive())return;
        const boxes=__ccMarkBoxes(path),r=img.getBoundingClientRect(),origin=overlay.getBoundingClientRect();
        boxesLayer.replaceChildren();
        boxes.concat(live?[live]:[]).forEach(function(b,i){
          const rect=__ccMarkScreen(b,r,img.naturalWidth,img.naturalHeight),el=d.createElement("div"),num=d.createElement("span");
          el.style.cssText="position:absolute;box-sizing:border-box;border:2px solid #ff3b30;box-shadow:0 0 0 1px white";
          Object.assign(el.style,{left:rect.left-origin.left+"px",top:rect.top-origin.top+"px",width:rect.width+"px",height:rect.height+"px"});
          num.textContent=String(i+1);num.style.cssText="position:absolute;left:-2px;top:-2px;width:20px;height:20px;border-radius:50%;background:#ff3b30;color:white;box-shadow:0 0 0 1px white;text-align:center;font:12px/20px sans-serif";
          el.appendChild(num);boxesLayer.appendChild(el);
        });
        input.style.pointerEvents=drawing?"auto":"none";input.style.cursor=drawing?"crosshair":"";
        mode.style.display=drawing?"inline-flex":"none";mark.setAttribute("aria-pressed",String(drawing));mark.style.background=drawing?"#9e2922":"#00000080";
        done.disabled=!boxes.length;done.style.opacity=boxes.length?"1":"0.4";undo.disabled=clear.disabled=!boxes.length;
      }catch(x){}
    };
    on(select,"click",function(ev){ev.stopPropagation();__ccMarkInsert(__ccMarkPathText(path))});
    on(mark,"click",function(ev){ev.stopPropagation();drawing=!drawing;drag=null;live=null;refresh()});
    on(undo,"click",function(ev){ev.stopPropagation();__ccMarkBoxes(path,"undo");refresh()});
    on(clear,"click",function(ev){ev.stopPropagation();__ccMarkBoxes(path,"clear");refresh()});
    on(done,"click",function(ev){ev.stopPropagation();__ccMarkDone(path,img.naturalWidth,img.naturalHeight,o.close)});
    on(input,"pointerdown",function(ev){
      if(!__ccMarkTakes(ev.button,drawing)||drag)return;
      ev.stopPropagation();ev.preventDefault();input.setPointerCapture(ev.pointerId);
      drag={id:ev.pointerId,p:{x:ev.clientX,y:ev.clientY}};swallow=true;
    });
    const move=function(ev,finish,cancel){
      if(!drag||ev.pointerId!==drag.id)return;
      ev.stopPropagation();
      live=cancel?null:__ccMarkBox(drag.p,{x:ev.clientX,y:ev.clientY},img.getBoundingClientRect(),img.naturalWidth,img.naturalHeight);
      if(finish){if(live)__ccMarkBoxes(path,"add",live);const id=drag.id;drag=null;live=null;try{input.releasePointerCapture(id)}catch(x){}}
      refresh();
    };
    on(input,"pointermove",function(ev){move(ev,false,false)});
    on(input,"pointerup",function(ev){move(ev,true,false)});
    on(input,"pointercancel",function(ev){move(ev,true,true)});
    on(input,"lostpointercapture",function(ev){move(ev,true,true)});
    on(input,"click",function(ev){if(swallow){ev.stopPropagation();swallow=false}});
    window.addEventListener("resize",refresh);
    if(typeof MutationObserver==="function"){
      observer=new MutationObserver(refresh);observer.observe(img,{attributes:true,attributeFilter:["style"]});
      if(overlay.parentNode)observer.observe(overlay.parentNode,{childList:true});
    }
    refresh();
  }catch(x){}
}

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { loadFixtures } from "./lib/fixtures.mjs";
import { loadPart, runPlan, planError, contractProblems, markerCounts, build, parseWebview, editOnce, toolbarOf } from "./lib/b-harness.mjs";
import { makeCtx } from "../lib/layout.mjs";
import { helpersText as mediaText } from "../parts/chat-media.mjs";
import { helpersText, LANGUAGES } from "../parts/chat-mark.mjs";

// The fixture of CCP_FIXTURES plus the known versions stored beside it; a known
// version that is not there is skipped with the reason.
function fixtureSet(known) {
  const fx = loadFixtures();
  if (!fx) return known.map((version) => ({ version, skip: "no fixtures (CCP_ALLOW_NO_FIXTURES=1): suite incomplete" }));
  return [...new Set([...known, fx.version])].map((version) => {
    if (version === fx.version) return { version, webview: fx.read("index.js.orig") };
    const dir = path.join(path.dirname(fx.dir), version);
    if (!fs.existsSync(path.join(dir, "manifest.json"))) return { version, skip: `no fixture ${version} beside ${fx.dir}: author-only material` };
    return { version, webview: loadFixtures({ CCP_FIXTURES: dir }).read("index.js.orig") };
  });
}
const sources = fixtureSet(["2.1.280", "2.1.281", "2.1.282", "2.1.283"]);
const mark = await loadPart("chat-mark"), media = await loadPart("chat-media");
const M1 = /function ([\w$]+)\(([\w$]+)\)\{if\(!\2\.startsWith\("@"\)\|\|\2==="@"\)return \2;/;
const names = { jsx: "__tJsx", jsxs: "__tJsxs", useRef: "__tUseRef", useEffect: "__tUseEffect", useState: "__tUseState", useCallback: "__tUseCallback", urlFilter: "__tUrlFilter" };
const HELP = mediaText(names), MARK = helpersText(), plain = (v) => JSON.parse(JSON.stringify(v));
// Labels as the viewer shows them and the head of the text Done inserts, per language; en by default.
const LABELS = {
  en: { select: "Insert path", mark: "Mark", regions: "regions [x1,y1,x2,y2] in source image pixels:" },
  ru: { select: "\u0412\u0441\u0442\u0430\u0432\u0438\u0442\u044c \u043f\u0443\u0442\u044c", mark: "\u041e\u0431\u0432\u0435\u0441\u0442\u0438",
    regions: "\u043e\u0431\u043b\u0430\u0441\u0442\u0438 [x1,y1,x2,y2] \u0432 \u043f\u0438\u043a\u0441\u0435\u043b\u044f\u0445 \u0438\u0441\u0445\u043e\u0434\u043d\u0438\u043a\u0430:" },
};
const SELECT = LABELS.en.select, DRAW = LABELS.en.mark, HEAD = (size, language = "en") => `"C:\\a b.png" (${size}), ${LABELS[language].regions}`;
function newWindow(withMark = true, language = "en") {
  const calls = [], commands = [], sb = vm.createContext({
    __tJsx: (type, props, key) => ({ type, props, key }), __tJsxs: (type, props, key) => ({ type, props, key }),
    __tUseRef: (v) => ({ current: v }), __tUseEffect: () => {}, __tUseState: (v) => [v, () => {}], __tUseCallback: (f) => f, __tUrlFilter: (u) => u,
    __ccCtx: { atMentionEvents: { emit(t) { calls.push(t); } }, fileOpener: { open() {} } },
    document: { activeElement: { nodeType: 1, isContentEditable: true }, execCommand(command) { commands.push(command);return true; } },
  });
  const [help, marks] = language === "en" ? [HELP, MARK] : [mediaText(names, language), helpersText(language)];
  vm.runInContext('"use strict";'+help+(withMark ? marks : ""), sb);
  return { sb, calls, commands };
}
const children = (v) => v == null ? [] : Array.isArray(v) ? Array.from(v).flatMap(children) : [v];
const buttons = (card) => children(card.props.children).filter((e) => e.key === "buttons").flatMap((e) => children(e.props.children));

for (const src of sources) {
  test(`T-K1 ${src.version}: guards, append, contract and derived M1 name`, { skip: src.skip }, (t) => {
    const p = runPlan(mark, "webview", src), name = M1.exec(src.webview)[1];
    assert.deepEqual(contractProblems("chat-mark", "webview", src.webview, p), []);
    assert.equal(p.edits.length, 1);assert.equal(p.edits[0].at, src.webview.length);
    assert.ok(p.edits[0].text.startsWith("\n/*CC-MARK*/"));assert.ok(!p.edits[0].text.includes("__CC_"));
    assert.deepEqual(markerCounts(p.edits[0].text), { "CC-MARK": 1 });
    assert.equal(p.symbols.mention, name);t.diagnostic(`${src.version} M1=${name}`);
  });
  test(`T-K2 ${src.version}: media + mark compile plain and strict`, { skip: src.skip }, () => {
    parseWebview(build(src.webview, [...runPlan(media, "webview", src).edits, ...runPlan(mark, "webview", src).edits]));
  });
  test(`T-K3 ${src.version}: removed, doubled and mismatched guards`, { skip: src.skip }, () => {
    const s = src.webview, m1 = M1.exec(s)[0], m2 = ".atMentionEvents.add(", name = M1.exec(s)[1];
    const re = new RegExp(`insertAtMention:\\(([\\w$]+),([\\w$]+)\\)=>\\{let [\\w$]+=${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\(\\1\\)`), m3 = re.exec(s)[0];
    for (const [guard, changed] of [
      ["M1", editOnce(s, m1, "")], ["M1", s+m1], ["M2", editOnce(s, m2, "")], ["M2", s+m2],
      ["M3", editOnce(s, m3, "")], ["M3", s+m3], ["M3", editOnce(s, m3, m3.replace("="+name+"(", "=otherMention("))], ["M4", s+"__cc"],
    ]) {
      const e = planError(mark, "webview", { ...src, webview: changed });assert.equal(e.name, "LayoutError");assert.ok(e.message.startsWith(guard), e.message);
    }
  });
}

test("T-K4: path quoting, coordinates, inverse, threshold and button predicates", () => {
  const { sb: w } = newWindow();
  assert.equal(w.__ccMarkPathText("C:\\a.png"), "C:\\a.png");assert.equal(w.__ccMarkPathText("C:\\a b.png"), '"C:\\a b.png"');
  for (const scale of [1, 0.5, 3]) {
    const r = { left: 17, top: 29, width: 120*scale, height: 80*scale }, p = (x, y) => ({ x: r.left+x*scale, y: r.top+y*scale });
    const a=p(10,20),b=p(46,58),expect=[10,20,46,58];
    assert.deepEqual(plain(w.__ccMarkBox(a,b,r,120,80)),expect);
    assert.deepEqual(plain(w.__ccMarkBox(b,a,r,120,80)),expect);
    assert.deepEqual(plain(w.__ccMarkBox(p(46,20),p(10,58),r,120,80)),expect);
    assert.deepEqual(plain(w.__ccMarkBox(p(-20,-30),p(150,100),r,120,80)),[0,0,120,80]);
    assert.equal(w.__ccMarkBox(p(-30,0),p(-10,40),r,120,80),null);
    assert.equal(w.__ccMarkBox(p(0,90),p(60,100),r,120,80),null);
    for (const [dx,dy] of [[3,20],[20,3]]) assert.equal(w.__ccMarkBox(a,{x:a.x+dx,y:a.y+dy},r,120,80),null);
    assert.deepEqual(plain(w.__ccMarkBox(p(0,0),{x:r.left+4,y:r.top+4},r,120,80)),[0,0,Math.ceil(4/scale),Math.ceil(4/scale)]);
    const exact=w.__ccMarkScreen(w.__ccMarkBox(a,b,r,120,80),r,120,80);
    assert.deepEqual(plain(exact),{left:a.x,top:a.y,width:b.x-a.x,height:b.y-a.y});
    const a2=p(10.25,20.75),b2=p(46.2,58.1),rounded=w.__ccMarkScreen(w.__ccMarkBox(a2,b2,r,120,80),r,120,80);
    assert.ok(Math.abs(rounded.left-a2.x)<=scale&&Math.abs(rounded.top-a2.y)<=scale);
    assert.ok(Math.abs(rounded.left+rounded.width-b2.x)<=scale&&Math.abs(rounded.top+rounded.height-b2.y)<=scale);
  }
  for (const b of [-1,0,1,2,3,null,undefined,"0"]) {
    for (const mode of [true,false,null,1]) assert.equal(w.__ccMarkTakes(b,mode),b===0&&mode===true);
    assert.equal(w.__ccPanBtn(b),b===0||b===1);
  }
});
test("T-K4: frozen text for zero, one and three boxes in each language; emit success and failures", () => {
  for (const language of LANGUAGES) {
    const { sb:w, calls }=newWindow(true, language), p="C:\\a b.png", boxes=[[1,2,30,40],[8,9,10,11],[0,0,120,80]];
    const header=HEAD("120x80", language);
    assert.equal(w.__ccMarkText(p,120,80,[]),header);
    assert.equal(w.__ccMarkText(p,120,80,boxes.slice(0,1)),header+"\n1 [1,2,30,40]: ");
    const text=header+"\n1 [1,2,30,40]: \n2 [8,9,10,11]: \n3 [0,0,120,80]: ";
    assert.equal(w.__ccMarkText(p,120,80,boxes),text);assert.equal(w.__ccMarkInsert(text),true);assert.deepEqual(calls,[text]);
    for(const ctx of [undefined,{}, {atMentionEvents:{}}, {atMentionEvents:{emit(){throw Error("refused");}}}]) {
      w.__ccCtx=ctx;assert.equal(w.__ccMarkInsert(text),false);
    }
  }
});
test("T-K labels: en and ru carry the same keys; card and viewer show the language they were built with", () => {
  const keys={};
  for (const language of LANGUAGES) {
    const { sb:w }=newWindow(true, language), T={...w.__ccMarkLabels()}, L=LABELS[language];keys[language]=Object.keys(T);
    for (const v of Object.values(T)) assert.ok(typeof v==="string"&&v.length>0,language);
    assert.deepEqual([T.select,T.mark,T.regions],[L.select,L.mark,L.regions]);
    assert.deepEqual(Array.from(w.__ccMarkButtons("C:\\a.png","image",false,["read_image"]),e=>[e.props.children,e.props.title]),[[T.select,T.selectTip],[T.mark,T.markTip]]);
    const a=dom(w);w.__ccMarkViewer({path:"C:\\a.png",...a,close(){},draw:true});
    assert.deepEqual(a.bar.children.slice(0,2).map(b=>b.textContent),[L.select,L.mark]);
    assert.deepEqual(a.bar.children[2].children.map(b=>[b.textContent,b.title]),[[T.undo,T.undoTip],[T.clear,T.clear],[T.done,T.done]]);
  }
  assert.deepEqual(keys.en,keys.ru);assert.equal(helpersText(),helpersText("en"));
  assert.equal(/[^\x20-\x7e]/.test(Object.values(newWindow().sb.__ccMarkLabels()).join("")),false,"English labels are plain ASCII");
  for (const bad of ["de","",null]) assert.throws(()=>helpersText(bad),/unknown language/);
});
test("T-K plan(): the configured language reaches CC-MARK; none means en, an unknown one is refused", { skip: sources.some((s) => !s.skip) ? false : sources[0].skip }, () => {
  const src=sources.find((s)=>!s.skip),{toolbar,toolbarError}=toolbarOf(src.webview);
  const ctx=makeCtx({version:src.version,target:"webview",src:src.webview,toolbar,toolbarError});
  const text=(options)=>mark.plan("webview",src.webview,options===undefined?ctx:Object.freeze({...ctx,options})).edits[0].text;
  const opts=(language)=>Object.freeze({language,buttons:Object.freeze([])});
  assert.equal(text(undefined),"\n/*CC-MARK*/"+helpersText("en"));assert.equal(text(opts("en")),"\n/*CC-MARK*/"+helpersText("en"));
  assert.equal(text(opts("ru")),"\n/*CC-MARK*/"+helpersText("ru"));assert.notEqual(helpersText("ru"),helpersText("en"));
  parseWebview(build(src.webview,[...runPlan(media,"webview",src).edits,{at:src.webview.length,text:text(opts("ru"))}]));
  for (const bad of ["de",""]) assert.throws(()=>text(opts(bad)),(e)=>e.name==="LayoutError"&&/unknown language/.test(e.message));
});
test("T-K5: buttons require an image and emitter, Mark requires a readable size and capability", () => {
  const { sb:w,calls }=newWindow(), p="C:\\a b.png", labels=(caps,large=false)=>Array.from(w.__ccMarkButtons(p,"image",large,caps),e=>e.props.children);
  assert.equal(w.__ccMarkButtons(p,"file",false,["read_image"]),null);
  for(const caps of [null,[],["open"],{},7]) assert.deepEqual(labels(caps),[SELECT]);
  assert.deepEqual(labels(["read_image"],true),[SELECT]);assert.deepEqual(labels(["read_image"]),[SELECT,DRAW]);
  const b=w.__ccMarkButtons(p,"image",false,["read_image"]);let prevented=0;
  b[0].props.onPointerDown({preventDefault(){prevented++;}});b[0].props.onClick({});
  assert.equal(prevented,1);assert.deepEqual(calls,['"C:\\a b.png"']);assert.equal(b[0].type,"button");assert.deepEqual(plain(b[0].props.style),plain(w.__ccCss("button")));
  const viewed=[];w.__ccViewer=(...args)=>viewed.push(args);const target={};b[1].props.onClick({currentTarget:target});
  assert.equal(viewed.length,1);assert.equal(viewed[0][0],p);assert.equal(viewed[0][2],target);assert.deepEqual(plain(viewed[0][3]),{draw:true});
  for(const args of [[],[null,null,null,null],[{},"file",false,{}]]) assert.doesNotThrow(()=>w.__ccMarkButtons(...args));
  delete w.__ccCtx;assert.equal(w.__ccMarkButtons(p,"image",false,["read_image"]),null);
});
test("T-K6: immutable reducer, per-path store, Undo, Clear and Done/reopen", () => {
  const { sb:w,calls }=newWindow(), p="C:\\one.png",q="C:\\two.png",a=[1,2,30,40],b=[10,12,20,25],c=[2,3,8,9];
  const empty=[],one=w.__ccMarkUpdate(empty,"add",a);assert.deepEqual(empty,[]);assert.deepEqual(plain(one),[a]);
  w.__ccMarkBoxes(p,"add",a);w.__ccMarkBoxes(p,"add",b);w.__ccMarkBoxes(q,"add",c);
  assert.deepEqual(plain(w.__ccMarkBoxes(p,"undo")),[a]);assert.deepEqual(plain(w.__ccMarkBoxes(q)),[c]);
  w.__ccMarkBoxes(p,"add",b);const before=plain(w.__ccMarkBoxes(p));let closed=false;
  w.__ccCtx.atMentionEvents.emit=(t)=>{assert.equal(closed,true,"close before insertion");calls.push(t);};
  assert.equal(w.__ccMarkDone(p,100,80,()=>{closed=true;}),true);
  assert.deepEqual(calls,w.__ccMarkText(p,100,80,before).split("\n"));assert.deepEqual(plain(w.__ccMarkBoxes(p)),before,"reopen after Done keeps boxes");
  assert.deepEqual(plain(w.__ccMarkBoxes(p,"clear")),[]);assert.deepEqual(plain(w.__ccMarkBoxes(q)),[c]);
  let emptyClosed=0;const emitted=calls.length;
  assert.equal(w.__ccMarkDone(p,100,80,()=>{emptyClosed++;}),false);
  assert.equal(emptyClosed,0);assert.equal(calls.length,emitted);
});
test("T-K7: card keeps stage-1 buttons without the hook and after a throwing hook", () => {
  const { sb:w }=newWindow(false), p="C:\\a.png", props={path:p,kind:"image"};
  w.__ccState().caps=["open","photos","reveal","read_image"];
  const stage=buttons(w.__ccCard(props));assert.deepEqual(stage.map(e=>e.key),["open","photos","reveal"]);
  w.__ccMarkButtons=()=>{throw Error("broken hook");};
  assert.deepEqual(buttons(w.__ccCard(props)).map(e=>e.key),stage.map(e=>e.key));
  vm.runInContext(MARK,w);assert.deepEqual(buttons(w.__ccCard(props)).map(e=>e.key),["open","photos","reveal","select","mark"]);
  w.__ccState().caps=null;assert.deepEqual(buttons(w.__ccCard(props)).map(e=>e.props.children),[SELECT]);
  w.__ccState().cache.set(p,{state:"large"});let got;
  w.__ccMarkButtons=(...args)=>{got=args;return null;};w.__ccCard(props);assert.deepEqual(got,[p,"image",true,null]);
  assert.match(HELP,/if\(typeof __ccMarkViewer==="function"\)try\{__ccMarkViewer\(\{path:p,overlay:ov,bar:bar,img:img,close:close,draw:!!\(opts&&opts\.draw\)\}\)\}catch\(x\)\{\}/);
  assert.match(HELP,/on\(ov,"pointerdown",function\(ev\)\{\s*if\(!__ccPanBtn\(ev\.button\)/);
  assert.match(HELP,/if\(ev\.button===1\)ev\.preventDefault\(\)/);
});

// A small DOM for pointer routing, persisted display and observer cleanup.
function dom(w) {
  const listeners=new Map(),observers=[];
  class El {
    constructor(tag){this.tagName=tag;this.style={};this.children=[];this.events={};this.attrs={};this.isConnected=true;this.ownerDocument=d;}
    appendChild(e){this.children.push(e);e.parentNode=this;return e;}
    insertBefore(e,b){const i=this.children.indexOf(b);if(i<0)return this.appendChild(e);this.children.splice(i,0,e);e.parentNode=this;return e;}
    querySelector(){return this.children.find(e=>e.tagName==="button")||null;}
    addEventListener(k,f){this.events[k]=f;}setAttribute(k,v){this.attrs[k]=v;}
    replaceChildren(){this.children=[];}getBoundingClientRect(){return this.rect||{left:7,top:9,width:100,height:80};}
    setPointerCapture(id){this.captured=id;}releasePointerCapture(id){assert.equal(id,this.captured);this.captured=null;}
  }
  const d={createElement:(tag)=>new El(tag)};
  w.window={addEventListener:(k,f)=>listeners.set(k,f),removeEventListener:(k,f)=>{if(listeners.get(k)===f)listeners.delete(k);}};
  w.MutationObserver=class {constructor(f){this.f=f;this.live=true;observers.push(this);}observe(){}disconnect(){this.live=false;}};
  const overlay=d.createElement("div"),bar=d.createElement("div"),img=d.createElement("img");
  img.naturalWidth=100;img.naturalHeight=80;img.rect={left:17,top:29,width:100,height:80};overlay.appendChild(bar);bar.appendChild(d.createElement("button"));
  return {overlay,bar,img,listeners,observers};
}
test("T-K6 viewer: pointerId capture, live boxes, bar ordering, passthrough and cleanup", () => {
  const {sb:w}=newWindow(),a=dom(w),p="C:\\a.png";let closed=0;
  w.__ccMarkViewer({path:p,...a,close(){closed++;a.overlay.isConnected=false;},draw:true});
  assert.deepEqual(a.bar.children.slice(0,2).map(b=>b.textContent),[SELECT,DRAW]);
  const [layer,input]=a.overlay.children,mode=a.bar.children[2],send=(type,extra={})=>{
    const e={button:0,pointerId:7,clientX:27,clientY:49,stop:0,stopPropagation(){this.stop++;},preventDefault(){},...extra};
    input.events[type]?.(e);return e;
  };
  assert.equal(input.style.pointerEvents,"auto");assert.equal(send("pointerdown",{button:1}).stop,0);
  assert.equal(send("pointerdown").stop,1);assert.equal(input.captured,7);
  assert.equal(send("pointermove",{pointerId:8,button:-1}).stop,0);
  assert.equal(send("pointermove",{button:-1,clientX:67,clientY:79}).stop,1);assert.equal(layer.children.length,1);
  assert.equal(send("pointerup",{button:-1,clientX:67,clientY:79}).stop,1);
  assert.deepEqual(plain(w.__ccMarkBoxes(p)),[[10,20,50,50]]);assert.equal(send("click").stop,1);
  assert.ok(!input.events.wheel&&!input.events.dblclick);assert.equal(closed,0);
  assert.equal(layer.children[0].style.left,"20px");assert.equal(layer.children[0].style.top,"40px");
  a.img.rect.left+=30;a.observers[0].f();assert.equal(layer.children[0].style.left,"50px");
  mode.children[2].events.click({stopPropagation(){}});assert.equal(closed,1);assert.equal(w.__ccMarkBoxes(p).length,1);
  a.listeners.get("resize")();assert.equal(a.listeners.size,0);assert.equal(a.observers[0].live,false);
  const b=dom(w);w.__ccMarkViewer({path:p,...b,close(){},draw:false});assert.equal(b.overlay.children[0].children.length,1);
  assert.equal(b.overlay.children[1].style.pointerEvents,"none");assert.equal(b.bar.children[2].style.display,"none");
});
function viewerRuntime(path="C:\\a b.png",draw=false){
  const {sb:w,calls}=newWindow(),a=dom(w);let closed=0;
  a.bar.style.justifyContent="flex-end";
  w.__ccMarkViewer({path,...a,draw,close(){closed++;a.overlay.isConnected=false;}});
  const [layer,input]=a.overlay.children,[select,mark,mode]=a.bar.children;
  const send=(type,extra={})=>{const ev={button:0,pointerId:7,clientX:27,clientY:49,stopPropagation(){},preventDefault(){},...extra};input.events[type]?.(ev);};
  const click=b=>b.events.click({stopPropagation(){}});
  return {w,calls,a,layer,input,select,mark,mode,send,click,path,closed:()=>closed};
}
test("F-1: viewer bar wraps and remains right-aligned",()=>{
  const v=viewerRuntime();assert.equal(v.a.bar.style.flexWrap,"wrap");assert.equal(v.a.bar.style.justifyContent,"flex-end");
});
test("F-2: viewer Undo, Clear, Select and Done are wired to the current path",()=>{
  const v=viewerRuntime(undefined,true),{w,path,mode,click,calls}=v,other="C:\\other.png",a=[1,2,30,40],b=[10,12,20,25];
  w.__ccMarkBoxes(path,"add",a);w.__ccMarkBoxes(path,"add",b);w.__ccMarkBoxes(other,"add",b);v.a.listeners.get("resize")();
  assert.deepEqual(v.layer.children.map(el=>el.children[0].textContent),["1","2"]);
  click(mode.children[0]);assert.deepEqual(plain(w.__ccMarkBoxes(path)),[a]);assert.deepEqual(plain(w.__ccMarkBoxes(other)),[b]);
  click(v.select);assert.deepEqual(calls,['"C:\\a b.png"']);assert.equal(v.closed(),0);
  click(mode.children[2]);assert.equal(v.closed(),1);
  assert.deepEqual(calls.slice(1),[HEAD("100x80"),"1 [1,2,30,40]: "]);
  assert.deepEqual(plain(w.__ccMarkBoxes(path)),[a]);
  w.__ccMarkBoxes(path,"add",b);const second=dom(w);w.__ccMarkViewer({path,...second,draw:true,close(){}});click(second.bar.children[2].children[1]);
  assert.deepEqual(plain(w.__ccMarkBoxes(path)),[]);assert.deepEqual(plain(w.__ccMarkBoxes(other)),[b]);
});
test("F-2: viewer Mark toggles both input routing and pressed appearance",()=>{
  const v=viewerRuntime(),check=(on)=>{
    assert.equal(v.input.style.pointerEvents,on?"auto":"none");assert.equal(v.mark.attrs["aria-pressed"],String(on));
    assert.equal(v.mode.style.display,on?"inline-flex":"none");
  };
  check(false);const off=v.mark.style.background;v.click(v.mark);check(true);assert.notEqual(v.mark.style.background,off);
  v.click(v.mark);check(false);assert.equal(v.mark.style.background,off);
});
test("F-2/F-3: empty Done is disabled-looking and has no close or insert side effect",()=>{
  const v=viewerRuntime(undefined,true),done=v.mode.children[2];
  assert.equal(done.disabled,true);assert.equal(done.style.opacity,"0.4");v.click(done);
  assert.equal(v.closed(),0);assert.deepEqual(v.calls,[]);
});
test("F-3: zero-box Done records side effects outside the swallowed callback",()=>{
  const {sb:w,calls,commands}=newWindow();let closed=0;
  assert.equal(w.__ccMarkDone("C:\\empty.png",120,80,()=>{closed++;}),false);
  assert.equal(closed,0);assert.deepEqual(calls,[]);assert.deepEqual(commands,[]);
});
test("F-5: lostpointercapture cancels only its drag and permits the next one",()=>{
  const v=viewerRuntime(undefined,true);
  v.send("pointerdown");v.send("pointermove",{button:-1,clientX:67,clientY:79});assert.equal(v.layer.children.length,1);
  v.send("lostpointercapture",{pointerId:8});assert.equal(v.layer.children.length,1);
  v.send("lostpointercapture");assert.equal(v.layer.children.length,0);assert.deepEqual(plain(v.w.__ccMarkBoxes(v.path)),[]);
  v.send("pointerup",{clientX:67,clientY:79});assert.deepEqual(plain(v.w.__ccMarkBoxes(v.path)),[]);
  v.send("pointerdown",{pointerId:9});v.send("pointerup",{pointerId:9,clientX:67,clientY:79});
  assert.deepEqual(plain(v.w.__ccMarkBoxes(v.path)),[[10,20,50,50]]);
});
test("D1: path casing shares marks but exported text preserves its input spelling",()=>{
  const {sb:w}=newWindow(),p="C:\\A\\x.png",q="c:\\a\\X.PNG",a=[1,2,30,40],b=[5,6,10,11];
  w.__ccMarkBoxes(p,"add",a);assert.deepEqual(plain(w.__ccMarkBoxes(q)),[a]);w.__ccMarkBoxes(q,"add",b);
  assert.deepEqual(plain(w.__ccMarkBoxes(p,"undo")),[a]);assert.deepEqual(Array.from(w.__ccState().marks.keys()),[p.toLowerCase()]);
  assert.ok(w.__ccMarkText(q,100,80,[a]).startsWith(q+" (100x80)"));w.__ccMarkBoxes(q,"clear");assert.deepEqual(plain(w.__ccMarkBoxes(p)),[]);
});
test("D2: panel closes before emit and a throwing close cannot suppress insertion",()=>{
  const {sb:w,calls}=newWindow(),order=[];
  w.__ccState().panel=()=>{order.push("close");};w.__ccCtx.atMentionEvents.emit=t=>{order.push("emit");calls.push(t);};
  assert.equal(w.__ccMarkInsert("path"),true);assert.deepEqual(order,["close","emit"]);assert.deepEqual(calls,["path"]);
  w.__ccState().panel=()=>{throw Error("close failed");};assert.equal(w.__ccMarkInsert("again"),true);assert.deepEqual(calls,["path","again"]);
});
test("T-K8 lines: Done closes first, closes the panel once and alternates three regions with real breaks",()=>{
  const {sb:w}=newWindow(),p="C:\\a b.png",boxes=[[1,2,30,40],[8,9,10,11],[0,0,120,80]],events=[],order=[];
  const header=HEAD("120x80");
  for(const b of boxes)w.__ccMarkBoxes(p,"add",b);
  w.__ccState().panel=()=>{order.push("panel");w.__ccState().panel=null;};
  w.__ccCtx.atMentionEvents.emit=t=>{order.push("emit");events.push(["emit",t]);};
  w.document.execCommand=(...args)=>{events.push(["execCommand",...args]);return true;};
  assert.equal(w.__ccMarkDone(p,120,80,()=>{order.push("viewer");}),true);
  assert.deepEqual(order,["viewer","panel","emit","emit","emit","emit"]);
  assert.deepEqual(events,[["emit",header],["execCommand","insertLineBreak"],["emit","1 [1,2,30,40]: "],
    ["execCommand","insertLineBreak"],["emit","2 [8,9,10,11]: "],["execCommand","insertLineBreak"],["emit","3 [0,0,120,80]: "]]);
  assert.deepEqual(plain(w.__ccMarkBoxes(p)),boxes);assert.equal(w.__ccState().panel,null);
});
test("T-K8 lines: permission focus stops after the header and keeps the boxes",()=>{
  for(const useDone of [false,true]){
    const {sb:w,calls,commands}=newWindow(),p="C:\\a.png",box=[1,2,30,40];let closed=0;
    w.__ccMarkBoxes(p,"add",box);const text=w.__ccMarkText(p,120,80,[box]);
    w.__ccCtx.atMentionEvents.emit=t=>{calls.push(t);w.document.activeElement={nodeType:1,isContentEditable:false};};
    assert.equal(useDone?w.__ccMarkDone(p,120,80,()=>{closed++;}):w.__ccMarkInsertLines(text),false);
    assert.deepEqual(calls,[text.split("\n")[0]]);assert.deepEqual(commands,[]);assert.equal(closed,useDone?1:0);
    assert.deepEqual(plain(w.__ccMarkBoxes(p)),[box]);
  }
});
test("T-K8 lines: a failed second emit stops before another break or region",()=>{
  const {sb:w,calls}=newWindow(),events=[];
  w.__ccCtx.atMentionEvents.emit=t=>{events.push(["emit",t]);calls.push(t);if(calls.length===2)throw Error("refused");};
  w.document.execCommand=(...args)=>{events.push(["execCommand",...args]);return true;};
  let result;assert.doesNotThrow(()=>{result=w.__ccMarkInsertLines("header\n1 [1,2,30,40]: \n2 [8,9,10,11]: ");});
  assert.equal(result,false);assert.deepEqual(events,[["emit","header"],["execCommand","insertLineBreak"],["emit","1 [1,2,30,40]: "]]);
});
test("T-K8 lines: recheck the editable element after every emit",()=>{
  for(const active of [null,{}, {nodeType:1,isContentEditable:"true"},{nodeType:3,isContentEditable:true}]){
    const {sb:w,calls,commands}=newWindow();
    w.__ccCtx.atMentionEvents.emit=t=>{calls.push(t);if(calls.length===2)w.document.activeElement=active;};
    assert.equal(w.__ccMarkInsertLines("header\nfirst\nsecond"),false);
    assert.deepEqual(calls,["header","first"]);assert.deepEqual(commands,["insertLineBreak"]);
  }
});
test("T-K8 lines: single line needs no document and insertion failures never throw",()=>{
  const {sb:w,calls,commands}=newWindow();delete w.document;
  assert.equal(w.__ccMarkInsertLines("path"),true);assert.deepEqual(calls,["path"]);
  assert.equal(w.__ccMarkInsertLines("header\nregion"),false);assert.deepEqual(calls,["path","header"]);
  w.document={activeElement:{nodeType:1,isContentEditable:true},execCommand(){commands.push("break");throw Error("unavailable");}};
  assert.equal(w.__ccMarkInsertLines("header\nregion"),false);assert.deepEqual(commands,["break"]);assert.equal(calls.at(-1),"header");
  delete w.__ccCtx;const before=calls.length;assert.equal(w.__ccMarkInsertLines("header\nregion"),false);assert.equal(calls.length,before);
  assert.deepEqual(commands,["break"]);assert.equal(w.__ccMarkInsertLines(null),false);
});
test("T-K helpers: ASCII, executable-line caps, function-only load and strict parse", () => {
  for(const [name,cap] of [["../assets/mark-helpers.js",260],["../parts/chat-mark.mjs",60],["../assets/webview-helpers.js",500],["./mark.test.mjs",600]]) {
    const raw=fs.readFileSync(new URL(name,import.meta.url),"utf8");assert.ok(!/[^\x00-\x7f]/.test(raw),name);
    assert.ok(raw.split(/\r?\n/).filter(s=>s.trim()&&!/^\s*\/\//.test(s)).length<=cap,name);
  }
  const w=vm.createContext({});vm.runInContext('"use strict";'+MARK,w);
  for(const [key,value] of Object.entries(w)){assert.match(key,/^__cc/);assert.equal(typeof value,"function");}
  assert.ok(!MARK.includes("/*"));assert.ok(!MARK.includes("__CC_"));
});

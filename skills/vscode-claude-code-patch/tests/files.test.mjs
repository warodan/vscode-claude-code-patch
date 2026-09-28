import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import os from "node:os";
import { createHash } from "node:crypto";
import { loadFixtures } from "./lib/fixtures.mjs";
import { loadPart, runPlan, planError, contractProblems, markerCounts, editOnce, build, parseWebview, toolbarOf } from "./lib/b-harness.mjs";
import { makeCtx } from "../lib/layout.mjs";
import { helpersText as mediaText } from "../parts/chat-media.mjs";
import { helpersText, ANCHOR, LANGUAGES } from "../parts/chat-files.mjs";
import { helpersText as markText } from "../parts/chat-mark.mjs";

// Manager class names pinned per known version; any other version is checked by what plan() derives.
const table = { "2.1.280":"y61", "2.1.281":"C61", "2.1.282":"r61", "2.1.283":"n61" };
// The fixture of CCP_FIXTURES plus the known versions stored beside it; a known
// version that is not there is skipped with the reason.
function fixtureSet(known) {
  const fx=loadFixtures();
  if(!fx)return known.map(version=>({version,skip:"no fixtures (CCP_ALLOW_NO_FIXTURES=1): suite incomplete"}));
  return [...new Set([...known,fx.version])].map(version=>{
    if(version===fx.version)return {version,webview:fx.read("index.js.orig"),root:path.dirname(fx.dir)};
    const dir=path.join(path.dirname(fx.dir),version);
    if(!fs.existsSync(path.join(dir,"manifest.json")))return {version,skip:`no fixture ${version} beside ${fx.dir}: author-only material`};
    return {version,webview:loadFixtures({CCP_FIXTURES:dir}).read("index.js.orig")};
  });
}
const sources=fixtureSet(Object.keys(table)),root=sources.find(s=>s.root)?.root;
const files=await loadPart("chat-files"),media=await loadPart("chat-media"),mark=await loadPart("chat-mark");
const NAMES={jsx:"__tJsx",jsxs:"__tJsxs",useRef:"__tUseRef",useEffect:"__tUseEffect",useState:"__tUseState",useCallback:"__tUseCallback",urlFilter:"__tUrlFilter"};
const HELP=mediaText(NAMES),FILES=helpersText(),plain=v=>JSON.parse(JSON.stringify(v));
const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
// Panel labels per language; the helpers default to en.
const LABELS={
  en:{title:"Files in this chat",image:"Images",folder:"Folders",file:"Files",empty:"No paths or images in this chat yet",unreadable:"Could not read this chat"},
  ru:{title:"\u0424\u0430\u0439\u043b\u044b \u044d\u0442\u043e\u0433\u043e \u0447\u0430\u0442\u0430",image:"\u041a\u0430\u0440\u0442\u0438\u043d\u043a\u0438",folder:"\u041f\u0430\u043f\u043a\u0438",file:"\u0424\u0430\u0439\u043b\u044b",
    empty:"\u0412 \u044d\u0442\u043e\u043c \u0447\u0430\u0442\u0435 \u043f\u043e\u043a\u0430 \u043d\u0435\u0442 \u043f\u0443\u0442\u0435\u0439 \u0438 \u043a\u0430\u0440\u0442\u0438\u043d\u043e\u043a",unreadable:"\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043f\u0440\u043e\u0447\u0438\u0442\u0430\u0442\u044c \u0447\u0430\u0442"},
};
const TXT=LABELS.en;
function readMessages(dir){
  const manifest=JSON.parse(fs.readFileSync(path.join(dir,"manifest.json"),"utf8"));
  const bytes=["rows.json","expected.json"].map(name=>{
    const data=fs.readFileSync(path.join(dir,name));
    assert.equal(createHash("sha1").update(data).digest("hex"),manifest.files[name].sha1,`SHA1 mismatch: ${name}`);
    return [name,data];
  });
  return Object.fromEntries(bytes.map(([name,data])=>[name,JSON.parse(data.toString("utf8"))]));
}
function newWindow(language="en"){
  const sent=[],timers=[],sb=vm.createContext({__ccCtx:{},setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimeout:()=>{}});
  vm.runInContext('"use strict";'+(language==="en"?HELP+FILES:mediaText(NAMES,language)+helpersText(language)),sb);
  sb.__ccReq=async req=>{sent.push(plain(req));return {ok:true};};
  return {sb,sent,timers};
}
const row=(...blocks)=>({type:"assistant",content:blocks.map(content=>({content}))});
const text=text=>({type:"text",text});
const read=file_path=>({type:"tool_use",name:"Read",input:{file_path}});
const fence=p=>"```\n"+p+"\n```";

for(const src of sources){
  test(`T-F1 ${src.version}: anchor, derived names, exact F1/F2 and combined parse`,{skip:src.skip},(t)=>{
    const p=runPlan(files,"webview",src),{manager:q,managerClass:cls,context:u}=p.symbols,at=src.webview.indexOf(ANCHOR)+ANCHOR.length;
    const stmt=table[src.version]?`q=new ${table[src.version]}(G,U);`:/^[\w$]+=new [\w$]+\([\w$]+,[\w$]+\);/.exec(src.webview.slice(at))[0];
    assert.equal(src.webview.split(ANCHOR).length-1,1);assert.equal(src.webview.slice(at,at+stmt.length),stmt);
    if(table[src.version])assert.deepEqual(p.symbols,{manager:"q",managerClass:table[src.version],context:"U"});else t.diagnostic(`${src.version}: ${stmt}`);
    assert.ok(stmt.startsWith(`${q}=new ${cls}(`)&&stmt.endsWith(`,${u});`),stmt);
    assert.deepEqual(p.edits[0],{at:at+stmt.length,text:`/*CC-SESS*/globalThis.__ccSessions=${q};globalThis.__ccFilesCtx=${u};try{__ccFilesBoot()}catch(__ccE){}`});
    assert.equal(p.edits[1].at,src.webview.length);assert.equal(p.edits[1].text,"\n/*CC-FILES*/"+FILES);
    assert.deepEqual(contractProblems("chat-files","webview",src.webview,p),[]);assert.deepEqual(markerCounts(p.edits.map(e=>e.text).join("")),{"CC-SESS":1,"CC-FILES":1});
    const built=build(src.webview,[...runPlan(media,"webview",src).edits,...runPlan(mark,"webview",src).edits,...p.edits]);
    parseWebview(built);assert.ok(built.indexOf("/*CC-MARK*/")<built.indexOf("/*CC-FILES*/"));
  });
  test(`T-F2 ${src.version}: renamed manager and context are derived`,{skip:src.skip},()=>{
    const s=src.webview,at=s.indexOf(ANCHOR),start=s.lastIndexOf("function ",at),end=s.indexOf("try{",at),{manager:q,context:u}=runPlan(files,"webview",src).symbols;
    assert.ok(start>=0&&end>at);
    const id=n=>new RegExp(`(?<![\\w$])${esc(n)}(?![\\w$])`,"g");
    const renamed=s.slice(0,start)+s.slice(start,end).replace(id(q),"Q9").replace(id(u),"U9")+s.slice(end);
    const p=runPlan(files,"webview",{...src,webview:renamed});
    assert.equal(p.edits[0].text,"/*CC-SESS*/globalThis.__ccSessions=Q9;globalThis.__ccFilesCtx=U9;try{__ccFilesBoot()}catch(__ccE){}");
  });
  test(`T-F3 ${src.version}: every guard rejects changed layout`,{skip:src.skip},()=>{
    const s=src.webview,at=s.indexOf(ANCHOR),after=at+ANCHOR.length,stmt=/^[\w$]+=new [\w$]+\([\w$]+,[\w$]+\);/.exec(s.slice(after))[0];
    const {manager:q,managerClass:name,context:u}=runPlan(files,"webview",src).symbols;
    const cls=s.indexOf(`class ${name}{`),body=cls+`class ${name}{`.length;
    const rowClass=/class [\w$]+\{type;content;parentToolUseId;sdkParentToolUseId;/.exec(s)[0];
    const changeBefore=(from,to)=>s.slice(0,at-300)+editOnce(s.slice(at-300,at),from,to)+s.slice(at);
    for(const [guard,changed] of [
      ["F-anchor",editOnce(s,ANCHOR,"")],["F-anchor",s+ANCHOR],
      ["F-manager",editOnce(s,ANCHOR+stmt,ANCHOR+"unexpected();")],
      ["F-binding",changeBefore(`,${q}=void 0,`,`,${q}=null,`)],["F-context",changeBefore(`,${u}=new `,`,${u}=old `)],
      ["F-activeSession",s.slice(0,body)+s.slice(body,body+3000).replaceAll("activeSession=","removedSession=")+s.slice(body+3000)],
      ["F-row",editOnce(s,rowClass,"")],["F-row",s+rowClass],
      ["F-ReadCoalesced",s.replaceAll('"ReadCoalesced"','"ReadOther"')],
      ["F-fileReads",editOnce(s,"input:{fileReads:","input:{otherReads:")],["F-fileReads",s+"input:{fileReads:"],["F-pristine",s+"__cc"],
    ]){
      const e=planError(files,"webview",{...src,webview:changed});assert.equal(e.name,"LayoutError");assert.ok(e.message.startsWith(guard),e.message);
    }
  });
}
// Real chat rows (fixtures/messages beside the version folders) are private and optional.
const MESSAGES=root?path.join(root,"messages"):null;
const noMessages=!MESSAGES?"no fixtures (CCP_ALLOW_NO_FIXTURES=1): suite incomplete"
  :fs.existsSync(path.join(MESSAGES,"manifest.json"))?false:`no messages fixture in ${MESSAGES} (real chat rows, not shipped): author-only material`;
test("T-F4: window-rows fixture agrees exactly with expected paths and absent list",{skip:noMessages},()=>{
  const fixture=readMessages(MESSAGES),rows=fixture["rows.json"],expected=fixture["expected.json"],{sb:w}=newWindow();
  const got=plain(w.__ccFilesCollect(rows));assert.ok(Array.isArray(got));
  assert.deepEqual(got,expected.paths.map(p=>({path:p,kind:w.__ccKind(p)})));
  const keys=new Set(got.map(i=>i.path.toLowerCase()));for(const p of expected.absent)assert.ok(!keys.has(p.toLowerCase()),p);
});
test("T-F4: window wrappers, main assistant only, merged reads, last spelling and newest first",()=>{
  const {sb:w}=newWindow(),rows=[
    row(text(fence("C:\\A\\x.png"))),
    {...row(text(fence("C:\\sub-sdk.png"))),sdkParentToolUseId:"tool"},
    {...row(text(fence("C:\\sub-parent.png"))),parentToolUseId:"tool"},
    {...row(read("C:\\user.png"),text(fence("C:\\user.txt"))),type:"user"},
    row(read("C:\\not-image.txt"),{type:"tool_use",name:"ReadCoalesced",input:{fileReads:[null,{}, {file_path:"C:\\read.png"},{file_path:"C:\\not-read.pdf"},{file_path:"C:/last.jpg"}]}}),
    row(text(fence("c:\\a\\X.PNG"))),
    row(text("[file](C:/after.txt)")),
  ];
  assert.deepEqual(plain(w.__ccFilesCollect(rows)),[{path:"C:\\after.txt",kind:"file"},{path:"c:\\a\\X.PNG",kind:"image"},{path:"C:\\last.jpg",kind:"image"},{path:"C:\\read.png",kind:"image"}]);
  assert.deepEqual(plain(w.__ccFilesCollect([row(read("C:\\single.png"))])),[{path:"C:\\single.png",kind:"image"}]);
  for(const garbage of [null,{},42,"text"])assert.equal(w.__ccFilesCollect(garbage),null);
  assert.equal(w.__ccFilesCollect([{type:"assistant",message:{content:[read("C:\\sdk.png")]}}]),null);
  assert.deepEqual(plain(w.__ccFilesCollect([])),[]);
  const garb=[null,7,{},row(null,{},read(null),{type:"tool_use",name:"ReadCoalesced",input:{fileReads:7}}),{type:"assistant",content:[null,7,{},read("C:\\unwrapped.png")]}];
  assert.doesNotThrow(()=>w.__ccFilesCollect(garb));assert.deepEqual(plain(w.__ccFilesCollect(garb)),[]);
  assert.equal(w.__ccFilesRows(),null);w.__ccSessions={activeSession:{value:{messages:{value:rows}}}};assert.equal(w.__ccFilesRows().length,4);
  for(const bad of [{},{activeSession:{}},{activeSession:{value:{}}},{activeSession:{value:{messages:{}}}}]){w.__ccSessions=bad;assert.equal(w.__ccFilesRows(),null);}
});
test("T-F4: ReadCoalesced requires unmarked immediate neighbours; plain Read is unchanged",()=>{
  const {sb:w}=newWindow(),p="C:\\merged.png",single="C:\\single.png";
  const merged=row({type:"tool_use",name:"ReadCoalesced",input:{fileReads:[{file_path:p}]}});
  const main=()=>row(text("No path here"));
  for(const field of ["parentToolUseId","sdkParentToolUseId"]){
    const sub=()=>({...main(),[field]:"subagent-tool"});
    for(const [label,previous,next,taken] of [
      ["both",sub(),sub(),false],["next only",main(),sub(),false],
      ["previous only",sub(),main(),false],["neither",main(),main(),true],
    ]){
      assert.deepEqual(plain(w.__ccFilesCollect([previous,merged,next])),taken?[{path:p,kind:"image"}]:[],`${field}: ${label}`);
      assert.deepEqual(plain(w.__ccFilesCollect([previous,row(read(single)),next])),[{path:single,kind:"image"}],`${field}: plain Read ${label}`);
    }
    assert.deepEqual(plain(w.__ccFilesCollect([sub(),main(),merged,main(),sub()])),[{path:p,kind:"image"}],`${field}: immediate neighbours only`);
  }
  for(const adjacent of [null,undefined,{},7,{parentToolUseId:null,sdkParentToolUseId:undefined},{parentToolUseId:"",sdkParentToolUseId:""}]){
    assert.deepEqual(plain(w.__ccFilesCollect([adjacent,merged,adjacent])),[{path:p,kind:"image"}],"empty or garbage neighbours");
  }
  for(const rows of [[merged],[merged,main()],[main(),merged]])assert.deepEqual(plain(w.__ccFilesCollect(rows)),[{path:p,kind:"image"}],"array boundaries");
});
test("T-F5: fences and links in position order; inline, multiline, web and relative paths excluded",()=>{
  const {sb:w}=newWindow(),t=[fence("C:\\one.png"),"[x](<C:\\a b\\c.png>)",fence("C:\\bad.png\nC:\\bad2.png"),
    "[x](http://example.com/a.png) [x](relative.png)","~~~txt\nC:/tilde.txt\n~~~","`C:\\inline.png`", "`[x](C:\\inline-link.png)`",
    "[x](file:///C:/encoded%20name.jpg)","![image](C:%5Cimage.png)","[x](C:/a(1).png)"].join("\n");
  assert.deepEqual(plain(w.__ccFilesCollect([row(text(t))])),[
    {path:"C:\\a(1).png",kind:"image"},{path:"C:\\image.png",kind:"image"},{path:"C:\\encoded name.jpg",kind:"image"},
    {path:"C:\\tilde.txt",kind:"file"},{path:"C:\\a b\\c.png",kind:"image"},{path:"C:\\one.png",kind:"image"},
  ]);
  assert.deepEqual(plain(w.__ccFilesCollect([row(text("~~~\nC:\\no.png\nC:\\no2.png\n~~~"))])),[]);
});

function fakeDocument(w){
  const events=new Map(),eventOptions=new Map(),observers=[];
  class El{
    constructor(tag){this.tagName=tag;this.children=[];this.style={};this.attrs={};this.events={};this.isConnected=true;this.textContent="";}
    appendChild(el){this.children.push(el);el.parentNode=this;return el;}
    insertBefore(el,b){const i=this.children.indexOf(b);if(i<0)return this.appendChild(el);this.children.splice(i,0,el);el.parentNode=this;return el;}
    get firstChild(){return this.children[0]||null;}setAttribute(k,v){this.attrs[k]=v;}
    addEventListener(k,f){this.events[k]=f;}remove(){const a=this.parentNode.children;a.splice(a.indexOf(this),1);this.isConnected=false;}focus(){}
  }
  const body=new El("body"),all=(e)=>[e,...e.children.flatMap(all)];
  w.document={body,createElement:tag=>new El(tag),createElementNS:(_,tag)=>new El(tag),getElementById:id=>all(body).find(e=>e.id===id),
    addEventListener:(k,f,c)=>{events.set(k,f);eventOptions.set(k,!!c);},removeEventListener:(k,f,c)=>{if(events.get(k)===f&&eventOptions.get(k)===!!c){events.delete(k);eventOptions.delete(k);}}};
  w.window={};w.IntersectionObserver=class{constructor(cb,opts){this.cb=cb;this.opts=opts;this.tiles=[];observers.push(this);}observe(el){this.tiles.push(el);}unobserve(el){this.tiles=this.tiles.filter(e=>e!==el);}disconnect(){this.tiles=[];}};
  return {body,all,events,eventOptions,observers};
}
test("T-F6: boot suppression, dependencies, idempotence and SVG/theme/offset contract",()=>{
  const {sb:w}=newWindow(),d=fakeDocument(w),viewer=w.__ccViewer,loader=w.__ccLoadImage;
  w.window.IS_SESSION_LIST_ONLY=true;w.__ccFilesBoot();assert.equal(d.body.children.length,0);
  w.window.IS_SESSION_LIST_ONLY=false;w.__ccViewer=undefined;w.__ccFilesBoot();assert.equal(d.body.children.length,0);
  w.__ccViewer=viewer;w.__ccLoadImage=undefined;w.__ccFilesBoot();assert.equal(d.body.children.length,0);w.__ccLoadImage=loader;
  w.__ccFilesBoot();w.__ccFilesBoot();assert.equal(d.body.children.length,1);
  const b=d.body.children[0];assert.equal(b.tagName,"button");assert.equal(b.style.top,"4px");assert.equal(b.style.right,"4px");
  assert.match(b.style.cssText,/z-index:9999/);assert.match(b.style.cssText,/width:22px;height:22px/);assert.match(b.style.cssText,/var\(--vscode-foreground\)/);
  assert.equal(b.title,TXT.title);assert.equal(b.attrs["aria-label"],TXT.title);assert.equal(b.children[0].tagName,"svg");assert.equal(b.children[0].children[0].attrs.stroke,"currentColor");
});
test("T-F7: image viewer, folder/open, pdf/reveal, file/opener, failure and absent capabilities",async()=>{
  const {sb:w,sent}=newWindow(),viewed=[],opened=[],notes=[],tile={};
  w.__ccViewer=(...args)=>viewed.push(args);w.__ccState().caps=["read_image","reveal","open"];
  w.__ccFilesCtx={fileOpener:{open:p=>opened.push(p)}};w.__ccCtx={};
  await w.__ccFilesClick({path:"C:\\a.png",kind:"image"},tile);
  assert.deepEqual(viewed,[["C:\\a.png","",tile]]);
  await w.__ccFilesClick({path:"C:\\dir",kind:"folder"});await w.__ccFilesClick({path:"C:\\a.pdf",kind:"noeditor"});
  await w.__ccFilesClick({path:"C:\\a.txt",kind:"file"});
  assert.deepEqual(sent,[{type:"cc_reveal_in_os",mode:"open",path:"C:\\dir"},{type:"cc_reveal_in_os",mode:"select",path:"C:\\a.pdf"}]);assert.deepEqual(opened,["C:\\a.txt"]);
  w.__ccCtx.fileOpener={open:p=>opened.push(p)};w.__ccFilesCtx={};await w.__ccFilesClick({path:"C:\\fallback.txt",kind:"file"});assert.equal(opened.at(-1),"C:\\fallback.txt");
  w.__ccReq=async()=>({ok:false,error:"ENOENT: missing"});await w.__ccFilesClick({path:"C:\\missing.pdf",kind:"noeditor"},null,t=>notes.push(t));assert.deepEqual(notes,[w.__ccTxt().missing]);
  w.__ccState().caps=[];
  for(const kind of ["folder","noeditor","file"])await w.__ccFilesClick({path:"C:\\nothing.txt",kind});
  assert.equal(sent.length,2);assert.deepEqual(opened,["C:\\a.txt","C:\\fallback.txt","C:\\nothing.txt"]);
  w.__ccCaps=()=>{throw Error("no context");};await w.__ccFilesClick({path:"C:\\a",kind:"folder"});await w.__ccFilesClick(null);
});
test("T-F panel: snapshot, limit, groups, lazy thumbnails, viewer Esc ownership and failure timer",async()=>{
  const {sb:w,timers}=newWindow(),d=fakeDocument(w),rows=[row(text(fence("C:\\folder")),text("[f](C:/doc.pdf)"),read("C:\\a.png"))];
  w.__ccSessions={activeSession:{value:{messages:{value:rows}}}};w.__ccFilesBoot();w.__ccFilesOpen();
  const panel=d.body.children[1].children[0],[head,body,note]=panel.children;
  assert.equal(head.textContent,TXT.title+" (3)");assert.deepEqual(body.children.filter(e=>e.tagName==="h3").map(e=>e.textContent),[TXT.image,TXT.folder,TXT.file]);
  const io=d.observers[0],loaded=[];w.__ccCaps=async()=>["read_image"];w.__ccLoadImage=async p=>{loaded.push(p);return{thumb:"test-thumb"};};
  assert.deepEqual(loaded,[]);const tile=io.tiles[0];io.cb([{target:tile,isIntersecting:false}]);assert.deepEqual(loaded,[]);
  io.cb([{target:tile,isIntersecting:true}]);for(let i=0;i<5;i++)await Promise.resolve();assert.deepEqual(loaded,["C:\\a.png"]);assert.equal(tile.children[0].src,"test-thumb");
  const key={key:"Escape",preventDefault(){},stopPropagation(){}};w.__ccState().viewer=()=>{};d.events.get("keydown")(key);assert.equal(d.body.children.length,2);
  w.__ccState().viewer=null;
  w.__ccCaps=async()=>["reveal"];w.__ccAct=async()=>"failed";d.all(body).find(e=>e.title==="C:\\doc.pdf").events.click();for(let i=0;i<5;i++)await Promise.resolve();
  assert.equal(note.textContent,"failed");assert.equal(timers.at(-1).ms,4000);timers.at(-1).fn();assert.equal(note.textContent,"");
  d.events.get("keydown")(key);assert.equal(d.body.children.length,1);assert.equal(io.tiles.length,0);
  w.__ccSessions.activeSession.value.messages.value=[];w.__ccFilesOpen();assert.equal(d.body.children[1].children[0].children[1].textContent,TXT.empty);
  delete w.__ccSessions;w.__ccFilesOpen();assert.equal(d.body.children[1].children[0].children[1].textContent,TXT.unreadable);
  w.__ccSessions={activeSession:{value:{messages:{value:Array.from({length:505},(_,i)=>row(text(`[f](C:/${i}.txt)`)))}}}};w.__ccFilesOpen();
  const last=d.body.children[1].children[0];assert.equal(last.children[0].textContent,TXT.title+" (500)");
  assert.deepEqual(d.all(last.children[1]).filter(e=>e.tagName==="button").map(e=>e.title),Array.from({length:500},(_,i)=>`C:\\${504-i}.txt`));
});
test("T-F labels: en and ru carry the same keys; button, panel, groups and empty states show the built language",()=>{
  const keys={};
  for(const language of LANGUAGES){
    const {sb:w}=newWindow(language),d=fakeDocument(w),L=LABELS[language],T={...w.__ccFilesLabels()};keys[language]=Object.keys(T);
    assert.deepEqual(T,L);
    w.__ccFilesBoot();assert.equal(d.body.children[0].title,L.title);
    w.__ccSessions={activeSession:{value:{messages:{value:[row(text(fence("C:\\folder")),text("[f](C:/doc.pdf)"),read("C:\\a.png"))]}}}};w.__ccFilesOpen();
    const [head,body]=d.body.children[1].children[0].children;
    assert.equal(head.textContent,L.title+" (3)");assert.equal(head.children[0].title,w.__ccTxt().close);
    assert.deepEqual(body.children.filter(e=>e.tagName==="h3").map(e=>e.textContent),[L.image,L.folder,L.file]);
    w.__ccSessions.activeSession.value.messages.value=[];w.__ccFilesOpen();assert.equal(d.body.children[1].children[0].children[1].textContent,L.empty);
    delete w.__ccSessions;w.__ccFilesOpen();assert.equal(d.body.children[1].children[0].children[1].textContent,L.unreadable);
  }
  assert.deepEqual(keys.en,keys.ru);assert.equal(helpersText(),helpersText("en"));
  for(const bad of ["de","",null])assert.throws(()=>helpersText(bad),/unknown language/);
});
test("T-F plan(): the configured language reaches CC-FILES; none means en, an unknown one is refused",{skip:sources.some(s=>!s.skip)?false:sources[0].skip},()=>{
  const src=sources.find(s=>!s.skip),{toolbar,toolbarError}=toolbarOf(src.webview);
  const ctx=makeCtx({version:src.version,target:"webview",src:src.webview,toolbar,toolbarError});
  const plan=options=>files.plan("webview",src.webview,options===undefined?ctx:Object.freeze({...ctx,options}));
  const opts=language=>Object.freeze({language,buttons:Object.freeze([])});
  assert.equal(plan(undefined).edits[1].text,"\n/*CC-FILES*/"+helpersText("en"));assert.equal(plan(opts("en")).edits[1].text,"\n/*CC-FILES*/"+helpersText("en"));
  const ru=plan(opts("ru"));assert.equal(ru.edits[1].text,"\n/*CC-FILES*/"+helpersText("ru"));assert.deepEqual(ru.edits[0],plan(undefined).edits[0]);
  for(const bad of ["de",""])assert.throws(()=>plan(opts(bad)),e=>e.name==="LayoutError"&&/unknown language/.test(e.message));
});
test("F-4: fences accept arbitrary indentation, including spaces and Cyrillic in paths",()=>{
  const {sb:w}=newWindow(),p="C:\\a b\\\u0442\u0435\u0441\u0442.png";
  for(const prefix of ["    ","\t\t", " \t \u00a0"]){
    assert.deepEqual(plain(w.__ccFilesCollect([row(text(prefix+"```text\n"+prefix+p+"\n"+prefix+"```"))])),[{path:p,kind:"image"}]);
  }
  assert.deepEqual(plain(w.__ccFilesCollect([row(text("[x](<"+p+">)"))])),[{path:p,kind:"image"}]);
});
test("F-4: closing fences use the opening character and at least its length",()=>{
  const {sb:w}=newWindow(),p="C:\\long.png",q="C:\\after.txt";
  for(const ch of ["`","~"]){
    const t=ch.repeat(3)+"\n"+p+"\n"+ch.repeat(5)+"\n[x]("+q+")";
    assert.deepEqual(plain(w.__ccFilesCollect([row(text(t))])),[{path:q,kind:"file"},{path:p,kind:"image"}]);
    const other=ch==="`"?"~":"`";
    for(const invalid of [ch.repeat(2),other.repeat(3)])assert.deepEqual(plain(w.__ccFilesCollect([row(text(ch.repeat(3)+"\n"+p+"\n"+invalid+"\n[x]("+q+")"))])),[]);
  }
});
test("F-4: a fence left open consumes to EOF without exposing links inside",()=>{
  const {sb:w}=newWindow(),p="C:\\open.png";
  for(const ch of ["```","~~~"]){
    assert.deepEqual(plain(w.__ccFilesCollect([row(text(ch+"\n"+p))])),[{path:p,kind:"image"}]);
    assert.deepEqual(plain(w.__ccFilesCollect([row(text(ch+"\n[x]("+p+")"))])),[]);
  }
});
test("F-4: link and image titles are stripped before decoding the target",()=>{
  const {sb:w}=newWindow(),p="C:\\a b\\\u0442\u0435\u0441\u0442.png";
  for(const target of ["C:/a.png", "<"+p+">", "file:///C:/a%20b.png"]){
    for(const prefix of ["[x]","![x]"]){
      const expected=target.startsWith("<")?p:target.startsWith("file:")?"C:\\a b.png":"C:\\a.png";
      assert.deepEqual(plain(w.__ccFilesCollect([row(text(prefix+'('+target+' "a title")'))])),[{path:expected,kind:"image"}]);
    }
  }
});
test("D2: panel close lives in state.panel and insertion closes the actual panel before emit",()=>{
  const {sb:w}=newWindow(),d=fakeDocument(w),observed=[];
  vm.runInContext(markText(),w);w.__ccSessions={activeSession:{value:{messages:{value:[]}}}};w.__ccFilesOpen();
  assert.equal(d.body.children.length,1);assert.equal(typeof w.__ccState().panel,"function");
  w.__ccCtx.atMentionEvents={emit:t=>observed.push({t,panel:w.__ccState().panel,visible:d.body.children.length===0})};
  assert.equal(w.__ccMarkInsert("C:\\a.png"),true);assert.deepEqual(observed,[{t:"C:\\a.png",panel:null,visible:true}]);
  w.__ccFilesOpen();const old=w.__ccState().panel;w.__ccFilesOpen();assert.equal(d.body.children.length,1);old();assert.equal(typeof w.__ccState().panel,"function");
  w.__ccState().panel();assert.equal(w.__ccState().panel,null);assert.equal(d.events.size,0);
});
test("D3: panel Escape listener uses capture, yields to the viewer, and removes capture on close",()=>{
  const {sb:w}=newWindow(),d=fakeDocument(w);w.__ccFilesOpen();
  assert.equal(d.eventOptions.get("keydown"),true);const key=d.events.get("keydown");let prevented=0,stopped=0;
  const ev={key:"Escape",preventDefault(){prevented++;},stopPropagation(){stopped++;}};
  w.__ccState().viewer=()=>{};key(ev);assert.equal(d.body.children.length,1);assert.equal(prevented,0);assert.equal(stopped,0);
  w.__ccState().viewer=null;key(ev);assert.equal(d.body.children.length,0);assert.equal(prevented,1);assert.equal(stopped,1);
  assert.equal(d.events.size,0);assert.equal(d.eventOptions.size,0);
});
test("D4/F-7: empty caps still open plain files with FilesCtx opener taking precedence",async()=>{
  const {sb:w,sent}=newWindow(),opened=[];w.__ccState().caps=[];
  w.__ccFilesCtx={fileOpener:{open:p=>opened.push(["files",p])}};w.__ccCtx.fileOpener={open:p=>opened.push(["fallback",p])};
  await w.__ccFilesClick({path:"C:\\a.txt",kind:"file"});assert.deepEqual(opened,[["files","C:\\a.txt"]]);assert.deepEqual(sent,[]);
  w.__ccFilesCtx={};await w.__ccFilesClick({path:"C:\\b.txt",kind:"file"});assert.deepEqual(opened,[["files","C:\\a.txt"],["fallback","C:\\b.txt"]]);
  delete w.__ccCtx.fileOpener;await w.__ccFilesClick({path:"C:\\c.txt",kind:"file"});assert.equal(opened.length,2);
});
test("F-7: messages fixture rejects tampered bytes using manifest SHA1 before JSON parsing",t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"ccp-messages-integrity-")),files={};
  t.after(()=>{assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
  for(const [name,data] of [["rows.json","[]"],["expected.json",'{"paths":[],"absent":[]}']]){
    fs.writeFileSync(path.join(dir,name),data);files[name]={sha1:createHash("sha1").update(data).digest("hex")};
  }
  fs.writeFileSync(path.join(dir,"manifest.json"),JSON.stringify({files}));assert.deepEqual(readMessages(dir)["rows.json"],[]);
  for(const name of ["rows.json","expected.json"]){
    const file=path.join(dir,name),original=fs.readFileSync(file);fs.writeFileSync(file,"invalid JSON");
    assert.throws(()=>readMessages(dir),/SHA1 mismatch/);fs.writeFileSync(file,original);
  }
});
test("T-F helpers: ASCII, line caps, strict, no eager code or placeholders",()=>{
  for(const [name,cap] of [["../assets/files-helpers.js",260],["../parts/chat-files.mjs",100],["./files.test.mjs",600]]){
    const raw=fs.readFileSync(new URL(name,import.meta.url),"utf8");assert.ok(!/[^\x00-\x7f]/.test(raw),name);assert.ok(raw.split(/\r?\n/).filter(s=>s.trim()&&!/^\s*\/\//.test(s)).length<=cap,name);
  }
  const w=vm.createContext({});vm.runInContext('"use strict";'+FILES,w);for(const [k,v]of Object.entries(w)){assert.match(k,/^__cc/);assert.equal(typeof v,"function");}
  assert.ok(!FILES.includes("/*"));assert.ok(!FILES.includes("__CC_"));
});

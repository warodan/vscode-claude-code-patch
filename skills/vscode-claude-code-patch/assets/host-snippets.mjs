// Host-side snippets of the chat-media part: six inserts into the extension host
// bundle (extension.js), in two places.
//
// What they keep: a 100 MB read ceiling answered as "too large" with the size,
// notModified by mtime, a drive-letter check instead of isAbsolute, a timeout on
// `reg`, the __cc prefix on every name a snippet declares itself, and "Photos"
// always going through explorer.exe with one quoted argument. The capabilities
// name "photos" and "photoshop" only where they can work: Windows, and for
// Photoshop an exe that was found.
//
// Every branch answers a typed {type:"cc_*_response",ok:false,error} and never
// throws: an exception here reaches every chat of the window.
// Snippets call require() directly: the host bundle is CommonJS.

/** Insertion order of the five snippets at the start of processRequest (H2). */
export const H2_ORDER = Object.freeze(["caps", "reveal", "readimg", "photos", "ps"]);

// A path the host acts on must start with a drive letter and a separator, since
// isAbsolute also passes \\server\share and \foo, and hold no other colon: one
// after the drive names an NTFS alternate data stream (C:\x\a.txt:s.png).
const DRIVE = String.raw`/^[A-Za-z]:[\\/][^:]*$/`;

const failWith = (type) =>
  String.raw`catch(__ccE){return{type:"${type}",ok:!1,error:String(__ccE&&__ccE.message||__ccE)}}}`;

// Photoshop.exe into a new __ccE: the remembered exe or CC_PHOTOSHOP_EXE, else the
// App Paths key read by `reg` (hidden, `ms` timeout); one that does not exist gives
// way to the newest Program Files\Adobe\Adobe Photoshop* folder, release before
// beta. __ccE ends undefined or an existing file. Needs __ccF, __ccN, __ccC in scope.
const psLookup = (ms) =>
  String.raw`let __ccE=globalThis.__ccPsExe||process.env.CC_PHOTOSHOP_EXE;if(!__ccE){` +
  String.raw`let __ccO=await new Promise((__ccR)=>__ccC.execFile("reg",["query",` +
  String.raw`"HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Photoshop.exe","/ve"],` +
  String.raw`{windowsHide:!0,timeout:${ms}},(__ccX,__ccSo)=>__ccR(__ccX?"":String(__ccSo))));` +
  String.raw`let __ccM=__ccO.match(/REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/m);` +
  String.raw`if(__ccM)__ccE=__ccM[1].replace(/%([^%]+)%/g,(__ccT,__ccK)=>process.env[__ccK]||__ccT)}` +
  String.raw`if(!__ccE||!__ccF.existsSync(__ccE)){` +
  String.raw`let __ccB=__ccN.join(process.env.ProgramW6432||process.env.ProgramFiles||"C:\\Program Files","Adobe");` +
  String.raw`__ccE=(__ccF.existsSync(__ccB)?__ccF.readdirSync(__ccB):[])` +
  String.raw`.filter((__ccD)=>/^Adobe Photoshop/i.test(__ccD))` +
  String.raw`.sort((__ccX,__ccY)=>(/beta/i.test(__ccX)-/beta/i.test(__ccY))||__ccY.localeCompare(__ccX))` +
  String.raw`.map((__ccD)=>__ccN.join(__ccB,__ccD,"Photoshop.exe")).find((__ccX)=>__ccF.existsSync(__ccX))}`;

/**
 * The six snippet texts, each carrying its one marker.
 * @param {{req: string, uri: string, path: string, exists?: string}} names derived from the bundle:
 *   req    - request parameter of processRequest (H2, "$" on 2.1.280)
 *   uri    - vscode.Uri of openFile's folder branch (H1, "W")
 *   path   - file path of openFile (H1, "z")
 *   exists - from 2.1.284, openFile's flag that the path could be stat'ed (H1, "G");
 *            CC-OPEN then leaves a missing file to the stock code, which warns.
 *            Without it (up to 2.1.283) CC-OPEN is the same text as before.
 */
export function hostSnippets({ req, uri, path, exists }) {
  const P = req;
  const gate = exists === undefined ? "" : `${exists}&&`;
  const open =
    String.raw`/*CC-OPEN*/if(${gate}/\.(png|jpe?g|gif|webp|bmp|ico|avif|mp4|webm|md|markdown)$/i.test(${path})){` +
    String.raw`try{require("vscode").commands.executeCommand("vscode.open",${uri}).then(void 0,()=>{})}catch{}return}`;

  // The same Photoshop lookup as a click, with a shorter `reg` timeout: the
  // webview waits 5 s for the capabilities.
  const caps =
    String.raw`/*CC-CAPS*/if(${P}.request.type==="cc_host_caps"){let __ccL=["open","reveal","read_image"];` +
    String.raw`if(process.platform==="win32"){__ccL.push("photos");try{let __ccF=require("fs"),` +
    String.raw`__ccN=require("path"),__ccC=require("child_process");` + psLookup(1500) +
    String.raw`if(__ccE){globalThis.__ccPsExe=__ccE;__ccL.push("photoshop")}}catch{}}` +
    String.raw`return{type:"cc_host_caps_response",v:1,caps:__ccL}}`;

  const reveal =
    String.raw`/*CC-REVEAL*/if(${P}.request.type==="cc_reveal_in_os"){try{let __ccV=require("vscode"),` +
    String.raw`__ccN=require("path"),__ccP=String(${P}.request.path||"");` +
    String.raw`if(!${DRIVE}.test(__ccP))throw Error("path must be absolute");` +
    String.raw`let __ccD=(await require("fs").promises.stat(__ccP)).isDirectory();` +
    String.raw`if(${P}.request.mode==="open"&&__ccD){if(process.platform==="win32"){` +
    String.raw`let __ccQ=__ccN.resolve(__ccP).replace(/\\+$/,"");if(/^[A-Za-z]:$/.test(__ccQ))__ccQ+="\\.";` +
    String.raw`require("child_process").spawn("explorer.exe",['"'+__ccQ+'"'],` +
    String.raw`{detached:!0,stdio:"ignore",windowsVerbatimArguments:!0}).on("error",()=>{}).unref()}` +
    String.raw`else await __ccV.env.openExternal(__ccV.Uri.file(__ccP))}` +
    String.raw`else await __ccV.commands.executeCommand("revealFileInOS",__ccV.Uri.file(__ccP));` +
    String.raw`return{type:"cc_reveal_in_os_response",ok:!0}}` +
    failWith("cc_reveal_in_os_response");

  const readimg =
    String.raw`/*CC-READIMG*/if(${P}.request.type==="cc_read_image"){try{let __ccF=require("fs"),` +
    String.raw`__ccN=require("path"),__ccP=String(${P}.request.path||""),` +
    String.raw`__ccM={".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".jfif":"image/jpeg",` +
    String.raw`".gif":"image/gif",".webp":"image/webp",".svg":"image/svg+xml",".bmp":"image/bmp",` +
    String.raw`".ico":"image/x-icon",".avif":"image/avif"}[__ccN.extname(__ccP).toLowerCase()];` +
    String.raw`if(!__ccM||!${DRIVE}.test(__ccP))throw Error("unsupported path");` +
    String.raw`let __ccS=await __ccF.promises.stat(__ccP);if(!__ccS.isFile())throw Error("not a file");` +
    String.raw`if(__ccS.size>104857600)return{type:"cc_read_image_response",ok:!1,error:"too large",size:__ccS.size};` +
    String.raw`if(typeof ${P}.request.knownMtimeMs==="number"&&${P}.request.knownMtimeMs===__ccS.mtimeMs)` +
    String.raw`return{type:"cc_read_image_response",ok:!0,notModified:!0,size:__ccS.size,mtimeMs:__ccS.mtimeMs};` +
    String.raw`return{type:"cc_read_image_response",ok:!0,dataUrl:"data:"+__ccM+";base64,"+` +
    String.raw`(await __ccF.promises.readFile(__ccP)).toString("base64"),size:__ccS.size,mtimeMs:__ccS.mtimeMs}}` +
    failWith("cc_read_image_response");

  const photos =
    String.raw`/*CC-PHOTOS*/if(${P}.request.type==="cc_open_in_photos"){try{let __ccN=require("path"),` +
    String.raw`__ccP=String(${P}.request.path||"");if(process.platform!=="win32")throw Error("Windows only");` +
    String.raw`if(!${DRIVE}.test(__ccP)||!/\.(png|jpe?g|jfif|gif|webp|bmp|tiff?|heic|heif|avif|ico|jxl)$/i.test(__ccP))` +
    String.raw`throw Error("unsupported path");` +
    String.raw`if(!(await require("fs").promises.stat(__ccP)).isFile())throw Error("not a file");` +
    String.raw`require("child_process").spawn("explorer.exe",['"'+__ccP+'"'],` +
    String.raw`{detached:!0,stdio:"ignore",windowsVerbatimArguments:!0}).on("error",()=>{}).unref();` +
    String.raw`return{type:"cc_open_in_photos_response",ok:!0}}` +
    failWith("cc_open_in_photos_response");

  const ps =
    String.raw`/*CC-PS*/if(${P}.request.type==="cc_open_in_photoshop"){try{let __ccF=require("fs"),` +
    String.raw`__ccN=require("path"),__ccC=require("child_process"),__ccP=String(${P}.request.path||"");` +
    String.raw`if(process.platform!=="win32")throw Error("Windows only");` +
    String.raw`if(!${DRIVE}.test(__ccP)||!/\.(psd|psb|png|jpe?g|tiff?|webp|gif|bmp)$/i.test(__ccP))` +
    String.raw`throw Error("unsupported path");` +
    String.raw`if(!(await __ccF.promises.stat(__ccP)).isFile())throw Error("not a file");` + psLookup(5000) +
    String.raw`if(!__ccE)throw Error("Photoshop.exe not found");globalThis.__ccPsExe=__ccE;` +
    String.raw`__ccC.spawn(__ccE,[__ccP],{detached:!0,stdio:"ignore"})` +
    String.raw`.on("error",()=>{globalThis.__ccPsExe=void 0}).unref();` +
    String.raw`return{type:"cc_open_in_photoshop_response",ok:!0,exe:__ccE}}` +
    failWith("cc_open_in_photoshop_response");

  return { open, caps, reveal, readimg, photos, ps };
}

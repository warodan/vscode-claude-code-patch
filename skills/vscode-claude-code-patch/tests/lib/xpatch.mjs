// A stand-in for an independent second patcher of the same bundle (T-N1..T-N3, T-N9):
// its own backup `<bundle>.media.bak`, a whole-file revert, the marker /*CC-MEDIA*/
// (in our namespace, not in the engine's table), plus two modes without any CC marker.
//
//   xpatch(bundle, "patch-end")        append `;/*CC-MEDIA*/void 0;`
//   xpatch(bundle, "patch-toolbar")    a button with /*CC-MEDIA*/ at the start of the panel children
//   xpatch(bundle, "toolbar-nomark")   the same button without any marker (T-N3)
//   xpatch(bundle, "katex")            a KaTeX-like append without any marker (T-N9)
//   xpatch(bundle, "revert")           copy its own backup back over the whole file

import fs from "node:fs";

export const XMARK = "/*CC-MEDIA*/";
const ANCHOR = 'title:"Show command menu (/)"';

export function xpatch(bundle, mode) {
  const bak = `${bundle}.media.bak`;
  if (mode === "revert") {
    if (!fs.existsSync(bak)) return "no backup";
    fs.copyFileSync(bak, bundle);
    fs.unlinkSync(bak);
    return "restored its own backup (whole file)";
  }
  let src = fs.readFileSync(bundle, "utf8");
  if (src.includes(XMARK)) return "already patched";
  if (!fs.existsSync(bak)) fs.copyFileSync(bundle, bak);
  const button = 'F("button",{type:"button",className:M7.menuButton,title:"cc media",children:F("span",{children:"i"})}),';
  if (mode === "patch-end") src += `;${XMARK}void 0;`;
  else if (mode === "katex") src += "\n;globalThis.__katexLike=1;\n";
  else if (mode === "patch-toolbar" || mode === "toolbar-nomark") {
    const a = src.indexOf(ANCHOR);
    const at = src.lastIndexOf("children:[", a) + "children:[".length;
    src = src.slice(0, at) + (mode === "patch-toolbar" ? XMARK : "") + button + src.slice(at);
  } else throw new Error(`xpatch: unknown mode ${mode}`);
  fs.writeFileSync(bundle, src, "utf8");
  return `patched (${mode})`;
}

// Foreign patchers and the move from v1: T-N1..T-N4, T-N8, T-N9, T-N11.
// The foreign patcher is tests/lib/xpatch.mjs; every case runs in a sandbox.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadFixtures, skipWithoutV1 } from "./lib/fixtures.mjs";
import { withSandbox } from "./lib/sandbox.mjs";
import { xpatch } from "./lib/xpatch.mjs";
import { sysMsg } from "./lib/ensure.mjs";

const fx = loadFixtures();
const PRISTINE = { webview: fx.read("index.js.orig"), host: fx.read("extension.js") };
const sha12 = (text) => crypto.createHash("sha1").update(text, "utf8").digest("hex").slice(0, 12);
const ext = (sb) => Object.fromEntries(Object.entries(sb.snapshot()).filter(([k]) => k.startsWith(".vscode")));
const has = (text, marker) => text.includes(`/*${marker}*/`);

test("T-N1 a foreign patcher first (CC-MEDIA, no .orig): the engine refuses and writes nothing", async () => {
  for (const mode of ["patch-end", "patch-toolbar"]) {
    await withSandbox({ fx, set: "two" }, async (sb) => {
      xpatch(sb.path("webview"), mode);
      const before = ext(sb);
      const r = await sb.run();
      assert.equal(r.code, 1);
      assert.match(r.out, /REFUSED webview: foreign CC markers CC-MEDIA/);
      assert.deepEqual(ext(sb), before);
      assert.equal(sb.orig("webview"), null);
    });
  }
});

test("T-N2 a foreign patcher second: --ensure sees CC-MEDIA and writes nothing; --status names it", () =>
  withSandbox({ fx, set: "two" }, async (sb) => {
    assert.equal((await sb.run()).code, 0);
    xpatch(sb.path("webview"), "patch-toolbar");
    const before = ext(sb);
    const e = await sb.run(["--ensure"]);
    assert.match(sysMsg(e), /Not applied \(UNSAFE\): .*Details: REFUSED webview: foreign CC markers CC-MEDIA/);
    assert.deepEqual(ext(sb), before);
    assert.match((await sb.run(["--status"])).out, /CC-MEDIA \(FOREIGN\)/);
  }));

test("T-N2 host: --disable does not restore a target that carries a foreign marker (a foreign marker blocks the restore too)", () =>
  withSandbox({ fx, set: "two" }, async (sb) => {
    assert.equal((await sb.run()).code, 0);
    xpatch(sb.path("host"), "patch-end");
    const host = sb.read("host");
    const r = await sb.run(["--disable", "chat-media"]);
    assert.equal(r.code, 1);
    assert.match(r.out, /REFUSED host: foreign CC markers CC-MEDIA/);
    assert.equal(sb.read("host"), host);
    assert.notEqual(sb.orig("host"), null);
  }));

test("T-N3 foreign code without CC markers in the panel of the current file: plan() reads the pristine copy", () =>
  withSandbox({ fx, set: "two", enabled: ["context-meter"] }, async (sb) => {
    assert.equal((await sb.run()).code, 0);
    const built = sb.read("webview");
    xpatch(sb.path("webview"), "toolbar-nomark");
    const v = await sb.run(["--verify"]);
    assert.equal(v.code, 0, v.out);
    if (fx.isReference) assert.match(v.out, /layout: jsx=F, jsxs=R, css=M7/);
    assert.equal((await sb.run()).code, 0);
    assert.equal(sb.read("webview"), built);
  }));

test("T-N4 an already patched bundle lying as .orig: (a) with CC markers, (b) without, sha1 off the ledger -> UNSAFE", async () => {
  let patched;
  await withSandbox({ fx, set: "two" }, async (sb) => {
    assert.equal((await sb.run()).code, 0);
    patched = sb.read("webview");
  });
  const katex = `${PRISTINE.webview}\n;globalThis.__katexLike=1;\n`;
  const ledger = { [fx.version]: { targets: { webview: { sha1_pristine: sha12(PRISTINE.webview) } } } };
  for (const [orig, options, reason] of [[patched, {}, /carries CC markers/], [katex, { ledger }, /the ledger says/]]) {
    await withSandbox({ fx, set: "two", ...options }, async (sb) => {
      sb.writeOrig("webview", orig);
      const before = ext(sb);
      const r = await sb.run();
      assert.equal(r.code, 1);
      assert.match(r.out, new RegExp(`UNSAFE: context-meter/webview: .*${reason.source}`));
      assert.deepEqual(ext(sb), before);
    });
  }
});

test("T-N8 moving in from v1: index.v1.js on disk, clean .orig, a v1 ledger entry, v1 state files -> rebuilt, v1 files untouched",
  { skip: skipWithoutV1(fx) }, () => {
    const v1Entry = {
      date: "2026-09-22", symbols: { jsx: "F" }, buttons: ["context:/context:usage"], side: "slash",
      sha1_pristine: sha12(PRISTINE.webview), targets: { host: { sha1_pristine: sha12(PRISTINE.host) } },
    };
    return withSandbox({ fx, set: "two", ledger: { [fx.version]: v1Entry } }, async (sb) => {
      sb.write("webview", fx.read("index.v1.js"));
      sb.writeOrig("webview", PRISTINE.webview);
      const v1Files = ["vscode-claude-chat-context-meter.local.json", "vscode-claude-chat-context-meter.ledger.json",
        "vscode-claude-chat-context-meter.runtime", "settings.json.ccm.bak"];
      for (const f of v1Files) fs.writeFileSync(path.join(sb.state, f), `v1 ${f}\n`);
      const v1Before = Object.fromEntries(Object.entries(sb.snapshot()).filter(([k]) => v1Files.includes(path.basename(k))));
      const r = await sb.run();
      assert.equal(r.code, 0, r.out);
      const w = sb.read("webview");
      assert.equal(w.split("/*CC-BTN:context*/").length - 1, 1);
      assert.ok(has(w, "CC-CTX") && has(w, "CC-SEND") && has(sb.read("host"), "CC-OPEN"));
      const v1After = Object.fromEntries(Object.entries(sb.snapshot()).filter(([k]) => v1Files.includes(path.basename(k))));
      assert.equal(Object.keys(v1After).length, v1Files.length);
      assert.deepEqual(v1After, v1Before);
    });
  });

test("T-N9 a KaTeX-like foreign patch without markers after the engine: --ensure rebuilds and throws it away", () =>
  withSandbox({ fx, set: "two" }, async (sb) => {
    assert.equal((await sb.run()).code, 0);
    const built = sb.read("webview");
    xpatch(sb.path("webview"), "katex");
    assert.notEqual(sb.read("webview"), built);
    assert.equal((await sb.run(["--ensure"])).code, 0);
    assert.equal(sb.read("webview"), built);
  }));

test("T-N11 CC-ICON:<any id> belongs to chat-icons (an older build's icons are taken over); v1's CC-BTN:<id> buttons stay foreign", async () => {
  for (const id of ["handoff", "finish", "my-button"]) {
    await withSandbox({ fx, set: "two" }, async (sb) => {
      sb.writeOrig("webview", PRISTINE.webview);
      sb.write("webview", `${PRISTINE.webview}\n/*CC-SEND*/0;/*CC-ICON:${id}*/0;\n`);
      assert.match((await sb.run(["--status"])).out, new RegExp(`CC-ICON:${id} \\(chat-icons\\)`));
      const r = await sb.run();
      assert.equal(r.code, 0, r.out);
      assert.doesNotMatch(r.out, /REFUSED|UNSAFE|FOREIGN/);
      assert.ok(!sb.read("webview").includes(`/*CC-ICON:${id}*/`), "rebuilt from .orig: the old icon is gone");
    });
  }
  for (const marker of ["CC-BTN:usage", "CC-BTN:my-button"]) {
    await withSandbox({ fx, set: "two" }, async (sb) => {
      sb.writeOrig("webview", PRISTINE.webview);
      sb.write("webview", `${PRISTINE.webview}\n/*CC-RUN*/0;/*${marker}*/0;\n`);
      const before = ext(sb);
      const r = await sb.run();
      assert.equal(r.code, 1);
      assert.match(r.out, new RegExp(`REFUSED webview: foreign CC markers ${marker}`));
      assert.deepEqual(ext(sb), before);
      assert.match((await sb.run(["--status"])).out, new RegExp(`${marker} \\(FOREIGN\\)`));
    });
  }
});

// T-E20: lib/layout.mjs alone, without the engine - panel points and names on the
// fixture, the panel anchor renamed or duplicated, the insertion order at one point -
// plus the helpers of ctx and the fixture loader.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import {
  ANCHOR, Layout, LayoutError, readToolbar, makeCtx, applyEdits,
  once, count, lastBefore, firstAfter, matchBracket, escapeRe,
} from "../lib/layout.mjs";
import { loadFixtures, loadSibling, skipWithoutFixtures, skipUnlessReference, skipWithoutV1 } from "./lib/fixtures.mjs";

const fx = loadFixtures(); // throws loudly on missing or altered fixtures
const webview = () => fx.read("index.js.orig");

// Offsets on 2.1.280, and the names v1 recorded in its ledger for 2.1.280 ("symbols").
const OFFSETS_2_1_280 = { signatureEnd: 5151926, callPropsAt: 5198124, afterSlashAt: 5155012 };
const LEDGER_2_1_280 = { jsx: "F", jsxs: "R", css: "M7", insert: "V", toolbar: "wB0", ctx: "X", session: "$" };
const CTX_KEYS = ["version", "target", "LayoutError", "toolbar", "toolbarError", "options", "once", "count", "lastBefore", "firstAfter",
  "matchBracket", "escapeRe"];

describe("T-E20 panel layout on the fixture", () => {
  test("points and names equal the 2.1.280 offsets and the v1 ledger for 2.1.280", { skip: skipUnlessReference(fx) }, () => {
    const lay = new Layout(webview());
    assert.deepEqual(
      { signatureEnd: lay.signatureEnd, callPropsAt: lay.callPropsAt, afterSlashAt: lay.afterSlashAt }, OFFSETS_2_1_280);
    assert.deepEqual(lay.symbols(), LEDGER_2_1_280);
    assert.equal(lay.hasUsage, true);
    assert.equal(lay.usageReserve, 13000);
  });

  test("the four ring points are exactly where v1 inserted in index.v1.js", { skip: skipUnlessReference(fx) || skipWithoutV1(fx) }, () => {
    const src = webview();
    const v1 = fx.read("index.v1.js");
    const lay = new Layout(src);
    const points = [lay.signatureEnd, lay.afterSlashAt, lay.callPropsAt, lay.pieOffAt].sort((a, b) => a - b);
    assert.equal(new Set(points).size, 4);
    let at = 0;
    let prev = 0;
    for (const p of [...points, src.length]) {
      const segment = src.slice(prev, p);
      assert.equal(v1.slice(at, at + segment.length), segment, `pristine text before ${p} differs in index.v1.js`);
      at += segment.length;
      if (p === src.length) break;
      const next = v1.indexOf(src.slice(p, p + 200), at);
      assert.ok(next >= at && next - at <= 2000, `v1 insert at ${p} not found`);
      assert.match(v1.slice(at, next), /\/\*CC-(?:BTN:context|RUN|PIE)\*\//, `no v1 insert at ${p}`);
      at = next;
      prev = p;
    }
    assert.equal(at, v1.length);
  });

  test("any fixture version: panel found, every name derived, points on their tokens", { skip: skipWithoutFixtures(fx) }, () => {
    const src = webview();
    const { toolbar, toolbarError } = readToolbar(src);
    assert.equal(toolbarError, null);
    assert.ok(Object.values(toolbar.symbols()).every((v) => v !== "-"), toolbar.describe());
    assert.equal(src.slice(toolbar.signatureEnd, toolbar.signatureEnd + 3), "}){");
    assert.ok(src.slice(0, toolbar.callPropsAt).endsWith(`(${toolbar.toolbar},{`));
    assert.equal(src[toolbar.afterSlashAt - 1], ",");
    assert.ok(Object.isFrozen(toolbar));
  });

  test("anchor renamed -> toolbar null, the reason names the anchor", { skip: skipWithoutFixtures(fx) }, () => {
    const res = readToolbar(webview().replace(ANCHOR, 'title:"Show command menu (//)"'));
    assert.equal(res.toolbar, null);
    assert.ok(res.toolbarError.includes(ANCHOR) && res.toolbarError.includes("0 times"), res.toolbarError);
  });

  test("anchor duplicated -> toolbar null, the reason names the anchor", { skip: skipWithoutFixtures(fx) }, () => {
    for (const src of [`${webview()}\n/*${ANCHOR}*/`, `/*${ANCHOR}*/\n${webview()}`]) {
      const res = readToolbar(src);
      assert.equal(res.toolbar, null);
      assert.ok(res.toolbarError.includes(ANCHOR) && res.toolbarError.includes("2 times"), res.toolbarError);
    }
  });

  test("makeCtx: exactly the contract's fields, helpers bound to the target's own source, options frozen", { skip: skipWithoutFixtures(fx) }, () => {
    const { toolbar, toolbarError } = readToolbar(webview());
    const host = fx.read("extension.js");
    const ctx = makeCtx({ version: fx.version, target: "host", src: host, toolbar, toolbarError });
    assert.deepEqual(Object.keys(ctx).sort(), [...CTX_KEYS].sort());
    assert.ok(Object.isFrozen(ctx));
    assert.deepEqual(ctx.options, { language: "en", buttons: [] }, "no options given: English, no buttons");
    assert.ok(Object.isFrozen(ctx.options) && Object.isFrozen(ctx.options.buttons));
    const given = makeCtx({ version: "x", target: "webview", src: "", toolbar: null, toolbarError: "why", options: { language: "ru", buttons: [] } });
    assert.equal(given.options.language, "ru");
    assert.ok(Object.isFrozen(given.options));
    assert.throws(() => makeCtx({ version: "x", target: "webview", src: "", toolbar: null, toolbarError: "why", options: null }), TypeError);
    assert.equal(ctx.toolbar, toolbar);
    assert.equal(ctx.LayoutError, LayoutError);
    assert.equal(ctx.count(ANCHOR), 0); // the host bundle, not the webview
    assert.throws(() => ctx.once(ANCHOR), LayoutError);
    const broken = makeCtx({ version: "x", target: "webview", src: "", toolbar: null, toolbarError: "why" });
    assert.equal(broken.toolbarError, "why");
    assert.throws(() => makeCtx({ version: "x", target: "webview", src: "", toolbar: null }), TypeError);
  });
});

describe("T-E20 applyEdits: the order at one point", () => {
  const src = "0123456789";
  test("same point inside one part: list order, the first edit leftmost", () => {
    const edits = [{ at: 3, text: "a" }, { at: 7, text: "x" }, { at: 3, text: "b" }, { at: 3, text: "c" }];
    assert.equal(applyEdits(src, edits), "012abc3456x789");
  });

  test("same point across parts: engine, then context-meter, chat-media, chat-icons", () => {
    const engine = [{ at: 5, text: "[run]" }];
    const ring = [{ at: 5, text: "[ring]" }, { at: 0, text: "[pie]" }];
    const media = [{ at: 10, text: "[end]" }];
    const icons = [{ at: 5, text: "[handoff]" }, { at: 5, text: "[finish]" }];
    assert.equal(applyEdits(src, [...engine, ...ring, ...media, ...icons]), "[pie]01234[run][ring][handoff][finish]56789[end]");
  });

  test("no edits returns the source; the edit list is not reordered in place", () => {
    assert.equal(applyEdits(src, []), src);
    const edits = [{ at: 9, text: "z" }, { at: 1, text: "y" }];
    applyEdits(src, edits);
    assert.deepEqual(edits.map((e) => e.at), [9, 1]);
  });

  test("insert-only: at outside [0, length] or not an integer, or text not a string, throws", () => {
    for (const at of [-1, 11, 1.5, NaN, "3", undefined]) assert.throws(() => applyEdits(src, [{ at, text: "x" }]), RangeError, String(at));
    assert.throws(() => applyEdits(src, [{ at: 1, text: 5 }]), TypeError);
  });
});

describe("ctx helpers", () => {
  test("readToolbar never throws: any error becomes toolbarError with its name", () => {
    assert.deepEqual(readToolbar(123).toolbar, null);
    assert.match(readToolbar(123).toolbarError, /^TypeError: /);
    assert.match(readToolbar("no panel here").toolbarError, /^anchor 'title:"Show command menu \(\/\)"' found 0 times/);
  });

  test("once: the offset of the only hit; zero, two or overlapping hits throw LayoutError", () => {
    assert.equal(once("xxabcxx", "abc"), 2);
    assert.throws(() => once("xx", "abc"), /found 0 times/);
    assert.throws(() => once("abc abc", "abc"), /found 2 times/);
    assert.throws(() => once("aaa", "aa"), /found 2 times/);
    assert.throws(() => once("abc", ""), TypeError);
  });

  test("count: string start positions, RegExp matches", () => {
    assert.equal(count("a.a.a", "a"), 3);
    assert.equal(count("aaa", "aa"), 2);
    assert.equal(count("x1 y22 z", /\d+/), 2);
    assert.equal(count("x1 y22 z", /\d+/y), 2);
  });

  test("lastBefore / firstAfter honour the distance limit and keep lookbehind context", () => {
    const s = "f(a) g(b) h(c)";
    assert.equal(lastBefore(s, /\w\(/, 10).index, 5);
    assert.equal(lastBefore(s, /\w\(/, 10, 5).index, 5);
    assert.throws(() => lastBefore(s, /\w\(/, 10, 4), LayoutError);
    assert.equal(firstAfter(s, /\w\(/, 1).index, 5);
    assert.throws(() => firstAfter(s, /\w\(/, 1, 3), LayoutError);
    assert.equal(firstAfter("x.y y", /(?<![.\w])y/, 2).index, 4);
    assert.equal(lastBefore(s, "h(", 99).index, 10);
  });

  test("matchBracket skips string and template literals, escapes included", () => {
    const s = 'F("b",{t:"(\\")",u:`)}`,v:[1,{w:2}]})+1';
    assert.equal(matchBracket(s, 1), s.length - 3);
    assert.equal(matchBracket(s, 6), s.length - 4);
    assert.throws(() => matchBracket(s, 0), LayoutError);
    assert.throws(() => matchBracket("f((x)", 1), LayoutError);
  });

  test("escapeRe makes minified names with $ literal", () => {
    assert.ok(new RegExp(`^${escapeRe("$a.b(c)[d]")}$`).test("$a.b(c)[d]"));
    assert.equal(escapeRe("a$b"), "a\\$b");
  });
});

describe("tests/lib/fixtures.mjs: loud on missing or altered fixtures, optional author-only material", () => {
  let dir;
  before(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), "ccp-fx-"))));
  after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sha1 = (text) => crypto.createHash("sha1").update(text).digest("hex");
  function make(name, version, files, lie = {}) {
    const d = path.join(dir, name);
    fs.mkdirSync(d);
    const listed = {};
    for (const [f, text] of Object.entries(files)) {
      if (text !== null) fs.writeFileSync(path.join(d, f), text);
      listed[f] = { size: Buffer.byteLength(text || ""), sha1: lie[f] || sha1(text || "") };
    }
    fs.writeFileSync(path.join(d, "manifest.json"), JSON.stringify({ version, files: listed }));
    return { CCP_FIXTURES: d };
  }
  const BOTH = { "index.js.orig": "w", "extension.js": "h" };

  test("a complete fixture of another version loads; reference and v1 checks skip with a reason", () => {
    const fx2 = loadFixtures(make("other", "9.9.9", BOTH));
    assert.deepEqual([fx2.version, fx2.isReference, fx2.hasV1, fx2.read("extension.js"), fx2.has("index.v1.js")], ["9.9.9", false, false, "h", false]);
    assert.match(skipUnlessReference(fx2), /not 2\.1\.280/);
    assert.match(skipWithoutV1(fx2), /no index\.v1\.js/);
  });

  test("a user's own 2.1.280 off the pins, without index.v1.js: it loads, the reference checks skip naming the pins", () => {
    const own = loadFixtures(make("own-280", "2.1.280", BOTH));
    assert.deepEqual([own.version, own.isReference, own.hasV1], ["2.1.280", false, false]);
    assert.match(skipUnlessReference(own), /not the pinned reference/);
    const withV1 = loadFixtures(make("own-280-v1", "2.1.280", { ...BOTH, "index.v1.js": "v" }));
    assert.deepEqual([withV1.isReference, withV1.hasV1], [false, false], "an index.v1.js off the reference is not v1's reference build");
    assert.equal(loadFixtures(make("other-v1", "9.9.8", { ...BOTH, "index.v1.js": "v" })).hasV1, false);
  });

  test("siblings: next to CCP_FIXTURES or a skip naming the folder", () => {
    make("1.0.0", "1.0.0", BOTH);
    const env = make("1.0.1", "1.0.1", BOTH);
    const sib = loadSibling("1.0.0", env);
    assert.deepEqual([sib.skip, sib.fx.version], [false, "1.0.0"]);
    const none = loadSibling("7.7.7", env);
    assert.equal(none.fx, null);
    assert.match(none.skip, /no fixture of 7\.7\.7 next to CCP_FIXTURES/);
    assert.match(loadSibling("1.0.0", {}).skip, /CCP_FIXTURES is not set/);
  });

  test("missing file, sha1 off the manifest, CCP_FIXTURES unset -> FixtureError with instructions", () => {
    const bad = [
      {},
      { CCP_FIXTURES: path.join(dir, "absent") },
      make("missing", "9.9.9", { ...BOTH, "extension.js": null }),
      make("altered", "9.9.9", BOTH, { "index.js.orig": "0".repeat(40) }),
      make("unlisted", "9.9.9", { "index.js.orig": "w" }),
    ];
    for (const env of bad) assert.throws(() => loadFixtures(env), (e) => e.name === "FixtureError" && /CCP_ALLOW_NO_FIXTURES=1/.test(e.message), env.CCP_FIXTURES);
  });

  test("CCP_ALLOW_NO_FIXTURES=1 is the only bypass: null with a banner, and skips carry a reason", () => {
    const write = process.stderr.write;
    let banner = "";
    process.stderr.write = (chunk) => ((banner += chunk), true);
    try {
      assert.equal(loadFixtures({ CCP_FIXTURES: path.join(dir, "absent2"), CCP_ALLOW_NO_FIXTURES: "1" }), null);
    } finally {
      process.stderr.write = write;
    }
    assert.match(banner, /SUITE INCOMPLETE/);
    assert.throws(() => loadFixtures({ CCP_FIXTURES: path.join(dir, "absent2"), CCP_ALLOW_NO_FIXTURES: "true" }), /FIXTURES UNUSABLE/);
    assert.match(skipWithoutFixtures(null), /suite incomplete/);
  });
});

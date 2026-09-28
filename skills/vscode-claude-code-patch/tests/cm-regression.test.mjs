// T-E1: with the ring alone - v1's default config - the engine writes webview/index.js
// byte for byte as v1 did, in English. Plus the ring in Russian on any fixture.
//
// The reference is a constant, so this passes with v1 gone from the disk. How it was
// taken: a copy of v1 patch_claude_code_ui.mjs (sha1 aa355bc1b3e7...) on a copy of the
// fixture index.js.orig (sha1 9e9279cb773b...), with USERPROFILE, HOME, APPDATA,
// CCM_STATE_DIR and CCM_EXT_DIR pointed at a sandbox, no other flags:
//     node <copy>\patch_claude_code_ui.mjs --ext-dir <sandbox>\.vscode\extensions
//   -> the written index.js has sha1 cde2d142ef6227378b6b0aea7845acdefedc12b7
//      (= fixture index.v1.js); v1 printed "[+] run plumbing".

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { loadFixtures, skipUnlessReference, skipWithoutV1 } from "./lib/fixtures.mjs";
import { withSandbox } from "./lib/sandbox.mjs";

export const V1_ENGINE_SHA1_12 = "aa355bc1b3e7";
export const V1_COMMAND = String.raw`node <copy>\patch_claude_code_ui.mjs --ext-dir <sandbox>\.vscode\extensions`;
export const V1_OUTPUT_SHA1 = "cde2d142ef6227378b6b0aea7845acdefedc12b7";

const fx = loadFixtures();
const sha1 = (text) => crypto.createHash("sha1").update(text, "utf8").digest("hex");
const count = (text, needle) => text.split(needle).length - 1;

test("T-E1 ring only, real parts/ folder: webview is byte for byte v1's output on its default config",
  { skip: skipUnlessReference(fx) || skipWithoutV1(fx) }, () =>
  withSandbox({ fx, enabled: ["context-meter"] }, async (sb) => {
    const r = await sb.run();
    assert.equal(r.code, 0, `${r.out}\n${r.err}`);
    const webview = sb.read("webview");
    assert.equal(sha1(webview), V1_OUTPUT_SHA1);
    assert.equal(webview, fx.read("index.v1.js"));
    assert.equal(sb.orig("webview"), fx.read("index.js.orig"));
    assert.deepEqual([sb.read("host"), sb.orig("host")], [fx.read("extension.js"), null]);
  }));

test("T-E1 any fixture version: the ring builds with one button, run-plumbing twice, at most one CC-PIE", () =>
  withSandbox({ fx, enabled: ["context-meter"] }, async (sb) => {
    const r = await sb.run(["--verify"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /context-meter: SAFE TO PATCH/);
    assert.equal((await sb.run()).code, 0);
    const webview = sb.read("webview");
    assert.equal(count(webview, "/*CC-BTN:context*/"), 1);
    assert.equal(count(webview, "/*CC-RUN*/"), 2);
    assert.ok(count(webview, "/*CC-PIE*/") <= 1);
  }));

test("T-E1 language ru: the ring's tooltips in Russian as \\u escapes, the same button otherwise", () =>
  withSandbox({ fx, enabled: ["context-meter"], language: "ru" }, async (sb) => {
    assert.equal((await sb.run()).code, 0);
    const ru = sb.read("webview");
    const u = (codes) => codes.map((c) => `${String.fromCharCode(92)}u${c.toString(16).padStart(4, "0")}`).join("");
    const load = u([0x43a, 0x43e, 0x43c, 0x430, 0x43d, 0x434, 0x44b]); // "commands", the loading tooltip
    assert.ok(ru.includes(load), "the loading tooltip is Russian");
    assert.doesNotMatch(ru, /commands still loading|of context used/, "an English tooltip is left");
    assert.equal(count(ru, "/*CC-BTN:context*/"), 1);
    assert.equal(count(ru, "/*CC-RUN*/"), 2);
  }));

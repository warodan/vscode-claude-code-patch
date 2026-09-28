// Stub harness for the parts. It runs the real parts' plan() on the fixtures
// through lib/layout.mjs - the same readToolbar, makeCtx and applyEdits the engine
// uses, one implementation - and checks what plan() returns. It is not the engine
// and does not pretend to be one: no installation, no state files, no ledger, no
// write; the real engine drives the real parts in tests/integration.test.mjs.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readToolbar, makeCtx, applyEdits, matchBracket } from "../../lib/layout.mjs";

/** ANY_MARKER of the engine (the engine's copy is the authority; this one checks plan()). */
export const ANY_MARKER = /\/\*CC-[A-Z]+(?::[\w-]+)?\*\//g;

/**
 * Marker rows of the parts, with the count each target carries. A name ending in `:*` is
 * a family (chat-icons: one CC-ICON:<id> per configured button).
 */
export const MARKERS = Object.freeze({
  "chat-media": {
    webview: { "CC-HELP": 1, "CC-CTX": 1, "CC-URL": 1, "CC-LINK": 1, "CC-MDIMG": 1, "CC-CODE": 1 },
    host: { "CC-OPEN": 1, "CC-CAPS": 1, "CC-REVEAL": 1, "CC-READIMG": 1, "CC-PHOTOS": 1, "CC-PS": 1 },
  },
  "chat-icons": { webview: { "CC-SEND": 2, "CC-ICON:*": 1 } },
  "chat-mark": { webview: { "CC-MARK": 1 } },
  "chat-files": { webview: { "CC-FILES": 1, "CC-SESS": 1 } },
});

export async function loadPart(id) {
  return (await import(`../../parts/${id}.mjs`)).default;
}

// Layout parsing of the 5 MB webview takes ~350 ms: keep the last few.
const toolbars = new Map();
export function toolbarOf(webview) {
  if (!toolbars.has(webview)) {
    if (toolbars.size >= 4) toolbars.delete(toolbars.keys().next().value);
    toolbars.set(webview, readToolbar(webview));
  }
  return toolbars.get(webview);
}

/** plan() of `part` for `target`, with a ctx built the engine's way; `options` = ctx.options (language, buttons). */
export function runPlan(part, target, { webview, host, version = "2.1.280", options }) {
  const src = target === "host" ? host : webview;
  const { toolbar, toolbarError } = toolbarOf(webview);
  return part.plan(target, src, makeCtx({ version, target, src, toolbar, toolbarError, ...(options ? { options } : {}) }));
}

/** The error plan() throws (a test fails if it does not throw). */
export function planError(part, target, sources) {
  try {
    runPlan(part, target, sources);
  } catch (e) {
    return e;
  }
  throw new Error(`plan(${target}) of ${part.id} did not throw`);
}

/** Whether a marker name is on a row, by its exact name or its `:*` family. */
const onRow = (row, name) => name in row || Object.keys(row).some((r) => r.endsWith(":*") && name.startsWith(r.slice(0, -1)));

/** Violations of the part contract in one plan() answer; [] when clean. */
export function contractProblems(partId, target, src, result) {
  const bad = [];
  const row = MARKERS[partId][target];
  if (!result || !Array.isArray(result.edits)) return ["edits is not an array"];
  for (const [i, e] of result.edits.entries()) {
    if (Object.keys(e).sort().join() !== "at,text") bad.push(`edit ${i}: keys ${Object.keys(e)}`);
    if (!Number.isInteger(e.at) || e.at < 0 || e.at > src.length) bad.push(`edit ${i}: at ${e.at}`);
    const marks = typeof e.text === "string" ? e.text.match(ANY_MARKER) || [] : [];
    if (marks.length !== 1) bad.push(`edit ${i}: ${marks.length} markers`);
    else if (!onRow(row, marks[0].slice(2, -2))) bad.push(`edit ${i}: marker ${marks[0]} not in the row of ${partId}`);
  }
  if (!Array.isArray(result.requires) || result.requires.some((r) => r !== "run-plumbing")) bad.push("requires");
  if (!result.symbols || typeof result.symbols !== "object") bad.push("symbols");
  if (!Array.isArray(result.notes)) bad.push("notes");
  return bad;
}

/** Count of each marker in `text`. */
export function markerCounts(text) {
  const out = {};
  for (const m of text.match(ANY_MARKER) || []) out[m.slice(2, -2)] = (out[m.slice(2, -2)] || 0) + 1;
  return out;
}

export function build(src, edits) {
  return applyEdits(src, edits);
}

/**
 * Removes the inserted texts from a build. The order is applyEdits' (ascending
 * `at`, list order at one point); throws if an insert is not where it should be.
 */
export function unbuild(built, edits) {
  const order = edits.map((e, i) => ({ ...e, i })).sort((a, b) => a.at - b.at || a.i - b.i);
  let out = "", from = 0, shift = 0;
  for (const e of order) {
    const start = e.at + shift;
    if (built.slice(start, start + e.text.length) !== e.text) throw new Error(`insert ${e.i} not found at ${start}`);
    out += built.slice(from, start);
    from = start + e.text.length;
    shift += e.text.length;
  }
  return out + built.slice(from);
}

export function sha1(text) {
  return createHash("sha1").update(text, "utf8").digest("hex");
}

/** The engine's parse checks: webview plain and strict, host in the CJS wrapper. */
export function parseWebview(text) {
  new vm.Script(text, { filename: "webview.js" });
  new vm.Script('"use strict";' + text, { filename: "webview.strict.js" });
}
export function parseHost(text) {
  new vm.Script("(function (exports, require, module, __filename, __dirname) {" + text + "\n})", { filename: "extension.js" });
}

/** A fresh folder under the OS temp dir (never under the suite's bait home). */
export function tempDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `ccp-b-${tag}-`));
}

/** `node --check` on `text` as a file; returns spawnSync's status and stderr. */
export function nodeCheck(text, name = "extension.js") {
  const dir = tempDir("check");
  try {
    const file = path.join(dir, name);
    fs.writeFileSync(file, text);
    const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    return { status: r.status, stderr: String(r.stderr || "") };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** `src` with the only occurrence of `from` replaced by `to`. */
export function editOnce(src, from, to) {
  const i = src.indexOf(from);
  if (i === -1 || src.indexOf(from, i + 1) !== -1) throw new Error(`editOnce: ${JSON.stringify(from)} is not unique`);
  return src.slice(0, i) + to + src.slice(i + from.length);
}

/** `src` with every occurrence of `from` inside [start, end) replaced by `to`. */
export function editRange(src, start, end, from, to) {
  return src.slice(0, start) + src.slice(start, end).split(from).join(to) + src.slice(end);
}

/**
 * Source of a top-level definition in a bundle: `function NAME(...){...}` or the
 * initializer of `NAME=` up to the next `,` or `;` outside brackets.
 */
export function definitionOf(src, name) {
  const esc = name.replace(/[$]/g, "\\$");
  const fn = [...src.matchAll(new RegExp(`function ${esc}\\(`, "g"))];
  if (fn.length === 1) {
    const close = matchBracket(src, fn[0].index + fn[0][0].length - 1);
    return src.slice(fn[0].index, matchBracket(src, close + 1) + 1);
  }
  const vars = [...src.matchAll(new RegExp(`(?<![.\\w$])${esc}=`, "g"))];
  if (vars.length !== 1) throw new Error(`definitionOf(${name}): ${fn.length} functions, ${vars.length} assignments`);
  let i = vars[0].index + vars[0][0].length;
  while (i < src.length && !",;".includes(src[i])) i = "([{".includes(src[i]) ? matchBracket(src, i) + 1 : i + 1;
  return `var ${name}=${src.slice(vars[0].index + vars[0][0].length, i)};`;
}

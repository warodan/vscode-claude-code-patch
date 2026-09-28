#!/usr/bin/env node
// Exact mirror of a copy of this skill, for the self-repair protocol (live folder
// -> staging, and the repaired staging back):
//
//   node tools/mirror.mjs <from> <to>
//
// Deletes from <to> everything <from> does not have, copies every file of <from>
// over, then compares both trees by relative path and sha1. Exit 0 = the trees are
// equal; 1 = a difference or an error (each one printed); 2 = usage.
//
// Guards, because it deletes: <from> must hold claude_code_patch.mjs; <to> must be
// missing, empty or hold claude_code_patch.mjs too (another copy of this skill);
// neither may lie inside the other. A link inside <from> is refused, one inside
// <to> is removed as a link (never followed). <to> itself is never removed, so a
// junction there (npx's ~/.claude/skills/<name>) stays a junction.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const MARK = "claude_code_patch.mjs";
const USAGE = "usage: node tools/mirror.mjs <from> <to>   (exact mirror of a copy of this skill, then a sha1 comparison)";

export class MirrorError extends Error {}

const realKey = (p) => {
  let real = path.resolve(p);
  try {
    real = fs.realpathSync(real);
  } catch {}
  return real.toLowerCase();
};
const inside = (a, b) => realKey(a) === realKey(b) || realKey(a).startsWith(realKey(b) + path.sep);

/** Every entry under `root`: relative path (forward slashes) -> "dir" | "file" | "link". */
function listTree(root) {
  const out = new Map();
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      const kind = e.isSymbolicLink() ? "link" : e.isDirectory() ? "dir" : e.isFile() ? "file" : "other";
      out.set(r, kind);
      if (kind === "dir") walk(path.join(dir, e.name), r);
    }
  };
  walk(root, "");
  return out;
}

const sha1Of = (file) => crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex");

/** Differences between two trees: entries only on one side, kinds or contents that differ. */
export function compareTrees(a, b) {
  const [ta, tb] = [listTree(a), listTree(b)];
  const diffs = [];
  for (const [rel, kind] of ta) {
    if (!tb.has(rel)) diffs.push(`only in ${a}: ${rel}`);
    else if (tb.get(rel) !== kind) diffs.push(`${rel}: ${kind} in ${a}, ${tb.get(rel)} in ${b}`);
    else if (kind === "file" && sha1Of(path.join(a, rel)) !== sha1Of(path.join(b, rel))) diffs.push(`${rel}: content differs`);
  }
  for (const rel of tb.keys()) if (!ta.has(rel)) diffs.push(`only in ${b}: ${rel}`);
  return diffs;
}

/** The guards above; throws MirrorError naming the reason. */
function check(from, to) {
  if (!fs.existsSync(path.join(from, MARK))) throw new MirrorError(`${from} holds no ${MARK}: not a copy of this skill`);
  if (inside(from, to) || inside(to, from)) throw new MirrorError(`${from} and ${to} overlap: one lies inside the other`);
  if (fs.existsSync(to)) {
    if (!fs.statSync(to).isDirectory()) throw new MirrorError(`${to} is not a folder`);
    if (fs.readdirSync(to).length && !fs.existsSync(path.join(to, MARK))) {
      throw new MirrorError(`${to} is neither empty nor a copy of this skill (no ${MARK}): refusing to delete anything in it`);
    }
  }
  const links = [...listTree(from)].filter(([, kind]) => kind === "link" || kind === "other").map(([rel]) => rel);
  if (links.length) throw new MirrorError(`${from} holds links or special files (${links.join(", ")}): copy them by hand`);
}

/** Mirror `from` into `to`, then compare; returns { copied, removed, diffs }. */
export function mirror(from, to) {
  from = path.resolve(from);
  to = path.resolve(to);
  check(from, to);
  fs.mkdirSync(to, { recursive: true });
  const src = listTree(from);
  let removed = 0;
  // Deepest first, so a folder is judged after what was inside it.
  const dst = [...listTree(to)].sort(([x], [y]) => y.split("/").length - x.split("/").length);
  for (const [rel, kind] of dst) {
    if (src.get(rel) === kind && kind !== "link") continue;
    fs.rmSync(path.join(to, rel), { recursive: kind === "dir", force: true });
    removed += 1;
  }
  let copied = 0;
  for (const [rel, kind] of src) {
    const target = path.join(to, rel);
    if (kind === "dir") fs.mkdirSync(target, { recursive: true });
    else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(from, rel), target);
      copied += 1;
    }
  }
  return { copied, removed, diffs: compareTrees(from, to) };
}

function main(argv) {
  if (argv.includes("-h") || argv.includes("--help")) {
    console.log(USAGE);
    return 0;
  }
  if (argv.length !== 2 || argv.some((a) => a.startsWith("-"))) {
    console.error(USAGE);
    return 2;
  }
  let r;
  try {
    r = mirror(argv[0], argv[1]);
  } catch (err) {
    console.error(`mirror: ${err instanceof MirrorError ? err.message : (err && err.stack) || err}`);
    return 1;
  }
  console.log(`mirror: ${path.resolve(argv[0])} -> ${path.resolve(argv[1])}: ${r.copied} files copied, ${r.removed} entries removed`);
  if (r.diffs.length) {
    console.error(`mirror: the trees differ after the copy (${r.diffs.length}):\n${r.diffs.map((d) => `  ${d}`).join("\n")}`);
    return 1;
  }
  console.log("mirror: sha1 comparison: the trees are equal");
  return 0;
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && realKey(self) === realKey(process.argv[1])) process.exitCode = main(process.argv.slice(2));

// tools/mirror.mjs: the exact mirror of a copy of this skill that the self-repair
// protocol uses (live folder -> staging and back). Everything happens in a fresh
// folder under the OS temp dir.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mirror, compareTrees, MirrorError } from "../tools/mirror.mjs";

const TOOL = fileURLToPath(new URL("../tools/mirror.mjs", import.meta.url));
let tmp;
before(() => (tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ccp-mirror-"))));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** A folder from { "rel/path": "text" | null (an empty folder) }. */
function tree(name, files) {
  const root = path.join(tmp, name);
  for (const [rel, text] of Object.entries(files)) {
    const p = path.join(root, ...rel.split("/"));
    if (text === null) fs.mkdirSync(p, { recursive: true });
    else {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, text);
    }
  }
  return root;
}

const SKILL = { "claude_code_patch.mjs": "engine", "SKILL.md": "skill", "parts/a.mjs": "a", "assets/deep/b.js": "b", "empty": null };
const cli = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf8" });

test("mirror: into a missing folder, then over a stale copy - extras go, contents match, the trees compare equal", () => {
  const from = tree("from", SKILL);
  const fresh = path.join(tmp, "fresh");
  assert.deepEqual(mirror(from, fresh), { copied: 4, removed: 0, diffs: [] });
  const stale = tree("stale", {
    "claude_code_patch.mjs": "old engine", "parts/a.mjs": "a", "parts/extra.mjs": "x", "gone/deep/c.txt": "c",
    "assets/deep": "a file where a folder belongs", "empty/leftover.txt": "l",
  });
  const r = mirror(from, stale);
  assert.deepEqual(r.diffs, []);
  assert.ok(r.removed >= 5, String(r.removed));
  assert.deepEqual(compareTrees(from, stale), []);
  assert.equal(fs.readFileSync(path.join(stale, "claude_code_patch.mjs"), "utf8"), "engine");
  assert.ok(!fs.existsSync(path.join(stale, "gone")) && fs.statSync(path.join(stale, "assets", "deep")).isDirectory());
  assert.deepEqual(fs.readdirSync(path.join(stale, "empty")), []);
});

test("compareTrees names every difference: only on one side, kind, content", () => {
  const a = tree("cmp-a", { "x.txt": "1", "d/y.txt": "2", "k": "file" });
  const b = tree("cmp-b", { "x.txt": "1!", "d/z.txt": "3", "k/inner.txt": "dir" });
  const diffs = compareTrees(a, b);
  assert.ok(diffs.includes("x.txt: content differs"), diffs.join("\n"));
  assert.ok(diffs.some((d) => d.startsWith(`only in ${a}: d/y.txt`)));
  assert.ok(diffs.some((d) => d.startsWith(`only in ${b}: d/z.txt`)));
  assert.ok(diffs.includes(`k: file in ${a}, dir in ${b}`));
});

test("guards: not a copy of the skill, a foreign non-empty target, overlapping folders, a link inside the source -> refused, nothing deleted", () => {
  const from = tree("g-from", SKILL);
  const foreign = tree("g-foreign", { "precious.txt": "keep me" });
  const notSkill = tree("g-not-skill", { "x.txt": "x" });
  const cases = [
    [notSkill, path.join(tmp, "g-out1"), /holds no claude_code_patch\.mjs/],
    [from, foreign, /neither empty nor a copy of this skill/],
    [from, path.join(from, "parts", "inside"), /overlap/],
    [from, from, /overlap/],
  ];
  for (const [a, b, re] of cases) assert.throws(() => mirror(a, b), (e) => e instanceof MirrorError && re.test(e.message), `${a} -> ${b}`);
  assert.equal(fs.readFileSync(path.join(foreign, "precious.txt"), "utf8"), "keep me");
  const linked = tree("g-linked", SKILL);
  fs.symlinkSync(foreign, path.join(linked, "link"), "junction");
  assert.throws(() => mirror(linked, path.join(tmp, "g-out2")), /holds links or special files \(link\)/);
});

test("links in the target are removed as links, never followed; a junction as the target itself stays one", () => {
  const from = tree("j-from", SKILL);
  const outside = tree("j-outside", { "keep.txt": "outside" });
  const target = tree("j-target", { "claude_code_patch.mjs": "old" });
  fs.symlinkSync(outside, path.join(target, "into-outside"), "junction");
  assert.deepEqual(mirror(from, target).diffs, []);
  assert.ok(!fs.existsSync(path.join(target, "into-outside")));
  assert.equal(fs.readFileSync(path.join(outside, "keep.txt"), "utf8"), "outside", "the link's target is untouched");
  const real = tree("j-real", { "claude_code_patch.mjs": "old" });
  const junction = path.join(tmp, "j-junction");
  fs.symlinkSync(real, junction, "junction");
  assert.deepEqual(mirror(from, junction).diffs, []);
  assert.ok(fs.lstatSync(junction).isSymbolicLink(), "the junction itself is kept");
  assert.deepEqual(compareTrees(from, real), []);
});

test("CLI: 0 with the two lines on success, 1 on a refusal, 2 on bad usage", () => {
  const from = tree("c-from", SKILL);
  const ok = cli(from, path.join(tmp, "c-to"));
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /^mirror: .* -> .*: 4 files copied, 0 entries removed\nmirror: sha1 comparison: the trees are equal\n$/);
  const refused = cli(tree("c-not", { "a.txt": "a" }), path.join(tmp, "c-to2"));
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /^mirror: .* holds no claude_code_patch\.mjs/);
  for (const args of [[], [from], [from, "x", "y"], ["--force", from]]) assert.equal(cli(...args).status, 2, args.join(" "));
  assert.equal(cli("--help").status, 0);
});

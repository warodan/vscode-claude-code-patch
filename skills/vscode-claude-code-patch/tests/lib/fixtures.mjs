// Fixture access for every test file. The bundles are Anthropic code and live
// outside git, the skill folder and any synced folder; tests find them through
// CCP_FIXTURES, which names one version folder (take it from your installed
// extension with the command in references/layout-recovery.md). A missing or
// altered fixture fails loudly; the only bypass is CCP_ALLOW_NO_FIXTURES=1, which
// prints a "suite incomplete" banner and makes loadFixtures() return null.
//
// Some material exists only on the author's machine: the pinned 2.1.280 reference,
// index.v1.js (v1's build of it), sibling version folders next to CCP_FIXTURES and
// recorded chat data. It is optional: the tests that need it skip with the reason,
// and tests/run.mjs counts the skips at the end.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/** The version the byte-for-byte reference tests are about. */
export const REFERENCE_VERSION = "2.1.280";
/** Files a fixture of any version must carry. */
export const REQUIRED_FILES = ["index.js.orig", "extension.js"];
/** The reference fixture: 2.1.280 with exactly these files (index.v1.js is optional). */
export const PINNED = Object.freeze({
  "index.js.orig": { size: 5367323, sha1_12: "9e9279cb773b" },
  "extension.js": { size: 3666092, sha1_12: "b060d4c16eec" },
  "index.v1.js": { sha1_12: "cde2d142ef62" },
});

const HOW_TO = [
  "How to take a fixture: the command in references/layout-recovery.md copies from the installed extension",
  "  <ext>\\webview\\index.js.orig (or index.js when there is no .orig) -> <dir>\\index.js.orig",
  "  <ext>\\extension.js.orig (or extension.js)                        -> <dir>\\extension.js",
  "and writes <dir>\\manifest.json: {\"version\":\"<ver>\",\"files\":{\"<name>\":{\"size\":<bytes>,\"sha1\":\"<40 hex>\"}}}.",
  "Keep the folder outside git, the skill folder and any synced folder (the bundles are Anthropic code),",
  "and point CCP_FIXTURES at it. Bypass, leaving the suite incomplete: CCP_ALLOW_NO_FIXTURES=1.",
].join("\n");

export class FixtureError extends Error {
  constructor(message) {
    super(`FIXTURES UNUSABLE: ${message}\n${HOW_TO}`);
    this.name = "FixtureError";
  }
}

/** Absolute fixture folder of this environment (read at call time); null when CCP_FIXTURES is not set. */
export function fixturesDir(env = process.env) {
  return env.CCP_FIXTURES ? path.resolve(env.CCP_FIXTURES) : null;
}

const verified = new Map(); // dir -> Fixtures, per process

/**
 * Verified fixtures, or null only under CCP_ALLOW_NO_FIXTURES=1.
 * Throws FixtureError (with instructions) when CCP_FIXTURES is not set, a file is
 * missing, or a sha1 or size differs from manifest.json.
 */
export function loadFixtures(env = process.env) {
  const dir = fixturesDir(env);
  if (dir && verified.has(dir)) return verified.get(dir);
  try {
    if (!dir) throw new FixtureError("CCP_FIXTURES is not set");
    const fx = verify(dir);
    verified.set(dir, fx);
    return fx;
  } catch (err) {
    if (env.CCP_ALLOW_NO_FIXTURES !== "1" || !(err instanceof FixtureError)) throw err;
    process.stderr.write(`\n*** SUITE INCOMPLETE: CCP_ALLOW_NO_FIXTURES=1 - fixture tests are skipped ***\n${err.message}\n\n`);
    return null;
  }
}

/**
 * A sibling version folder next to CCP_FIXTURES: { fx, skip }. A missing sibling is
 * { fx: null, skip: <reason> }; a present but broken one throws like loadFixtures.
 */
export function loadSibling(version, env = process.env) {
  const own = fixturesDir(env);
  if (!own) return { fx: null, skip: "CCP_FIXTURES is not set" };
  const dir = path.join(path.dirname(own), version);
  if (!fs.existsSync(path.join(dir, "manifest.json"))) {
    return { fx: null, skip: `no fixture of ${version} next to CCP_FIXTURES (${dir}): author-only material` };
  }
  return { fx: loadFixtures({ CCP_FIXTURES: dir }), skip: false };
}

function sha1(buf) {
  return crypto.createHash("sha1").update(buf).digest("hex");
}

function verify(dir) {
  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) throw new FixtureError(`no manifest.json in ${dir}`);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (err) {
    throw new FixtureError(`manifest.json in ${dir} does not parse: ${err.message}`);
  }
  const files = manifest && manifest.files;
  if (typeof manifest.version !== "string" || !files || typeof files !== "object") {
    throw new FixtureError(`manifest.json in ${dir} lacks "version" or "files"`);
  }
  for (const name of REQUIRED_FILES) {
    if (!files[name]) throw new FixtureError(`manifest.json in ${dir} does not list ${name}`);
  }
  const sums = {};
  for (const [name, want] of Object.entries(files)) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) throw new FixtureError(`${file} is missing`);
    const buf = fs.readFileSync(file);
    const got = sha1(buf);
    if (typeof want.sha1 !== "string" || got !== want.sha1.toLowerCase()) {
      throw new FixtureError(`${file}: sha1 ${got} differs from manifest.json (${want.sha1})`);
    }
    if (want.size !== undefined && buf.length !== want.size) {
      throw new FixtureError(`${file}: ${buf.length} bytes, manifest.json says ${want.size}`);
    }
    sums[name] = { sha1: got, size: buf.length };
  }
  const onPin = (name) => sums[name] && sums[name].sha1.startsWith(PINNED[name].sha1_12) &&
    (PINNED[name].size === undefined || sums[name].size === PINNED[name].size);
  const isReference = manifest.version === REFERENCE_VERSION && REQUIRED_FILES.every(onPin);
  // index.v1.js of the reference is pinned too; other versions may carry their own, which no test compares.
  if (isReference && sums["index.v1.js"] && !onPin("index.v1.js")) {
    throw new FixtureError(`${path.join(dir, "index.v1.js")}: sha1 ${sums["index.v1.js"].sha1.slice(0, 12)}, ` +
      `the pin for v1's build of ${REFERENCE_VERSION} is ${PINNED["index.v1.js"].sha1_12}`);
  }
  const cache = new Map();
  return Object.freeze({
    dir,
    version: manifest.version,
    isReference,
    hasV1: isReference && Boolean(sums["index.v1.js"]),
    manifest,
    has: (name) => Object.prototype.hasOwnProperty.call(files, name),
    path: (name) => path.join(dir, name),
    /** File content as a UTF-8 string, read once per process. */
    read(name) {
      if (!Object.prototype.hasOwnProperty.call(files, name)) throw new FixtureError(`${name} is not in manifest.json of ${dir}`);
      if (!cache.has(name)) cache.set(name, fs.readFileSync(path.join(dir, name), "utf8"));
      return cache.get(name);
    },
  });
}

/** node:test `skip` value: false with fixtures, else the reason (printed by the reporter). */
export function skipWithoutFixtures(fx) {
  return fx ? false : "no fixtures (CCP_ALLOW_NO_FIXTURES=1): suite incomplete";
}

/** node:test `skip` value for byte-for-byte checks against the pinned 2.1.280 reference. */
export function skipUnlessReference(fx) {
  if (!fx) return skipWithoutFixtures(fx);
  if (fx.isReference) return false;
  return fx.version === REFERENCE_VERSION
    ? `fixture ${fx.version} is not the pinned reference (sizes and sha1 in tests/lib/fixtures.mjs): reference comparison skipped`
    : `fixture is ${fx.version}, not ${REFERENCE_VERSION}: reference comparison skipped`;
}

/** node:test `skip` value for checks against v1's build of the reference (index.v1.js, author-only). */
export function skipWithoutV1(fx) {
  if (!fx) return skipWithoutFixtures(fx);
  return fx.hasV1 ? false : "no index.v1.js in the fixture (v1's build of 2.1.280, author-only material): v1 comparison skipped";
}

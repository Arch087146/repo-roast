/*
 * Roast engine tests. Run with: node --test
 */
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const { roastRepo, VERDICTS } = require("../src/roast");

const baseStats = {
  name: "test-repo", files: 20, loc: 5000, langs: { ".js": 5000 },
  todos: 10, deadCode: 3, evals: 0, emptyCatch: 0, tsAny: 0,
  commentLines: 100, largest: { file: "big.js", loc: 200 }, top3Share: 0.4,
  weirdNames: [], deps: null,
  hasTests: true, hasReadme: true, readmeLen: 2000, hasLicense: true,
  hasCI: true, hasGitignore: true, envCommitted: false, nodeModulesCommitted: false,
  lockfileOnly: false,
  commits: 50, authors: 2, avgMsgLen: 40, funnyMsgs: [], revertCount: 0, curseWords: 0,
};

test("clean-ish repo gets roast lines but a mild tier", () => {
  const r = roastRepo(baseStats);
  assert.ok(r.lines.length > 0, "should still find something to roast");
  assert.strictEqual(r.tier, "OK, FINE");
  assert.ok(r.roastability < 10, "clean repo should score low");
});

test("hygiene disasters dominate the roast", () => {
  const r = roastRepo({ ...baseStats, envCommitted: true, nodeModulesCommitted: true });
  assert.ok(r.roastability > 20, `disasters should push the score up, got ${r.roastability}`);
  assert.ok(
    r.lines.some((l) => l.includes(".env")) || r.lines.some((l) => l.includes("node_modules")),
    "disaster evidence should make the cut"
  );
});

test("empty repo still gets roasted (gently)", () => {
  const r = roastRepo({ ...baseStats, files: 0, loc: 0 });
  assert.ok(r.lines.some((l) => l.includes("no code here")));
});

test("same repo name + stats → identical roast (deterministic)", () => {
  const a = roastRepo(baseStats);
  const b = roastRepo(baseStats);
  assert.deepStrictEqual(a, b);
});

test("verdict tiers are ordered and non-overlapping", () => {
  const maxes = VERDICTS.map((v) => v.max);
  for (let i = 1; i < maxes.length; i++) assert.ok(maxes[i - 1] < maxes[i]);
});

test("worst possible repo hits BIOHAZARD", () => {
  const r = roastRepo({
    ...baseStats,
    files: 50, loc: 20000, todos: 120, deadCode: 40, evals: 5, emptyCatch: 3,
    tsAny: 30, largest: { file: "index.js", loc: 2500 }, top3Share: 0.9,
    weirdNames: ["final2.js", "copy of final.js"], envCommitted: true,
    nodeModulesCommitted: true, hasTests: false, hasReadme: false,
    hasLicense: false, hasCI: false, hasGitignore: false,
    commits: 400, authors: 1, avgMsgLen: 6, funnyMsgs: ["wip", "asdf"],
    revertCount: 9, curseWords: 12, deps: { count: 300, kind: "package.json" },
  });
  assert.strictEqual(r.tier, "BIOHAZARD");
  assert.strictEqual(r.roastability, 100);
});

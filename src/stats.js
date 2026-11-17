/*
 * stats.js — deep repo analysis. Reads the working tree and git history,
 * extracts every roastable signal. No dependencies, no judgement (yet).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const SKIP_DIRS = new Set([
  ".git", "node_modules", ".venv", "venv", "__pycache__",
  "dist", "build", ".next", "target", "vendor", ".gradle",
]);
const CODE_EXT = new Set([
  ".js", ".ts", ".jsx", ".tsx", ".mjs", ".cjs", ".py", ".rb", ".go", ".rs",
  ".java", ".c", ".cpp", ".h", ".hpp", ".cs", ".php", ".swift", ".kt",
  ".sh", ".sql", ".vue", ".svelte",
]);
const COMMENT_LINE = /^\s*(\/\/|#|\*|\/\*)/;
const DEAD_CODE_LINE = /^\s*\/\/\s*(const |let |var |function |if |for |while |return |console\.)/;
const TODO_RE = /\b(TODO|FIXME|HACK|XXX|WORKAROUND)\b/;

function walk(dir, base, files = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return files; }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), base, files);
    } else if (e.isFile()) {
      files.push(path.relative(base, path.join(dir, e.name)));
    }
  }
  return files;
}

function gitSummary(root) {
  const s = {
    commits: 0, authors: 0, avgMsgLen: 0, funnyMsgs: [], revertCount: 0,
    curseWords: 0, forcePushes: null,
  };
  try {
    const log = execFileSync("git", ["log", "--pretty=format:%an|%s"], { encoding: "utf8", cwd: root, maxBuffer: 64e6 });
    const rows = log.split("\n").filter(Boolean);
    s.commits = rows.length;
    s.authors = new Set(rows.map((r) => r.split("|")[0])).size;
    const msgs = rows.map((r) => r.split("|").slice(1).join("|") || "");
    s.avgMsgLen = Math.round(msgs.reduce((a, m) => a + m.length, 0) / Math.max(1, msgs.length));
    s.funnyMsgs = msgs
      .filter((m) => /oops|whoops|sorry|hack|quick ?fix|temp|wip|do ?not|don'?t|why|please|finally|actually|revert|panic|yolo|dude|bruh|final(ly)? ?(fix|version)/i.test(m))
      .slice(0, 8);
    s.revertCount = msgs.filter((m) => /^revert/i.test(m)).length;
    s.curseWords = msgs.filter((m) => /\b(wtf|wth|omg|damn|dammit|crap|shit|fuck|fck|argh|ugh)\b/i.test(m)).length;
  } catch { /* not a repo / empty */ }
  return s;
}

function dependencySummary(root, files) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const deps = Object.keys(pkg.dependencies || {}).length;
    const devDeps = Object.keys(pkg.devDependencies || {}).length;
    if (deps + devDeps > 0) return { count: deps + devDeps, kind: "package.json" };
  } catch { /* no package.json */ }
  const req = files.find((f) => f === "requirements.txt");
  if (req) {
    try {
      const lines = fs.readFileSync(path.join(root, req), "utf8").split("\n").filter((l) => l.trim() && !l.startsWith("#"));
      if (lines.length) return { count: lines.length, kind: "requirements.txt" };
    } catch { /* ignore */ }
  }
  return null;
}

function collectStats(root) {
  const stats = {
    name: path.basename(root),
    files: 0, loc: 0, langs: {},
    todos: 0, deadCode: 0, evals: 0, emptyCatch: 0, tsAny: 0,
    commentLines: 0,
    largest: { file: "-", loc: 0 },
    top3Share: 0,
    weirdNames: [],
    deps: null,
    hasTests: false, hasReadme: false, readmeLen: 0, hasLicense: false,
    hasCI: false, hasGitignore: false,
    envCommitted: false, nodeModulesCommitted: false,
    lockfileOnly: false,
    ...gitSummary(root),
  };

  const all = walk(root, root);
  const codeFiles = all.filter((f) => CODE_EXT.has(path.extname(f).toLowerCase()));
  stats.files = codeFiles.length;

  stats.hasTests = all.some((f) => /(^|\/)(tests?|__tests__|spec)\//i.test(f) || /\.test\.|\.spec\./i.test(path.basename(f)));
  stats.hasReadme = all.some((f) => /^readme(\.md|\.txt)?$/i.test(path.basename(f)));
  stats.hasLicense = all.some((f) => /^licen[cs]e/i.test(path.basename(f)));
  stats.hasCI = all.some((f) => f.startsWith(".github/workflows/") || /\.gitlab-ci|\.circleci|jenkins/i.test(f));
  stats.hasGitignore = all.some((f) => f === ".gitignore");
  stats.envCommitted = all.some((f) => /^\.env$|^\.env\./i.test(path.basename(f)));
  stats.nodeModulesCommitted = all.some((f) => f.includes("node_modules"));
  stats.lockfileOnly =
    all.some((f) => /package-lock\.json|yarn\.lock|pnpm-lock/.test(f)) && !fs.existsSync(path.join(root, "package.json"));
  stats.weirdNames = all
    .filter((f) => CODE_EXT.has(path.extname(f).toLowerCase()))
    .filter((f) => /(final|new|old|copy|backup|fix|temp|v\d+)[^/]*\.[a-z]+$/i.test(path.basename(f)) || /copy| \(2\)/.test(path.basename(f)))
    .slice(0, 5);

  if (stats.hasReadme) {
    try { stats.readmeLen = fs.readFileSync(path.join(root, "README.md"), "utf8").length; } catch { /* ok */ }
  }

  const perFile = [];
  for (const f of codeFiles.slice(0, 600)) {
    let text;
    try { text = fs.readFileSync(path.join(root, f), "utf8"); } catch { continue; }
    const lines = text.split("\n");
    const loc = lines.length;
    perFile.push({ file: f, loc });
    stats.loc += loc;
    for (const line of lines) {
      if (TODO_RE.test(line)) stats.todos++;
      if (DEAD_CODE_LINE.test(line)) stats.deadCode++;
      if (COMMENT_LINE.test(line)) stats.commentLines++;
    }
    const evals = text.match(/\beval\s*\(/g);
    if (evals) stats.evals += evals.length;
    if (/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(text)) stats.emptyCatch++;
    const anys = text.match(/:\s*any\b/g);
    if (anys) stats.tsAny += anys.length;
    const ext = path.extname(f).toLowerCase();
    stats.langs[ext] = (stats.langs[ext] || 0) + loc;
  }

  if (perFile.length) {
    perFile.sort((a, b) => b.loc - a.loc);
    stats.largest = perFile[0];
    const top3 = perFile.slice(0, 3).reduce((a, f) => a + f.loc, 0);
    stats.top3Share = stats.loc > 0 ? top3 / stats.loc : 0;
  }

  stats.deps = dependencySummary(root, all);
  return stats;
}

module.exports = { collectStats };

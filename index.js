#!/usr/bin/env node
/*
 * repo-roast — an AI that roasts your repo.
 * Offline mode: brutal, deterministic, heuristic roast seeded by the repo name.
 * Online mode (--smart): sends a summary to an LLM for a personalized roast.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

/* ---------- ANSI ---------- */
const c = (code, s) => `\x1b[${code}m${s}\x1b[0m`;
const bold = (s) => c("1", s);
const dim = (s) => c("2", s);
const red = (s) => c("31", s);
const yellow = (s) => c("33", s);
const magenta = (s) => c("35", s);

/* ---------- repo stats ---------- */
const SKIP_DIRS = new Set([".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next"]);
const CODE_EXT = new Set([".js", ".ts", ".jsx", ".tsx", ".py", ".rb", ".go", ".rs", ".java", ".c", ".cpp", ".h", ".cs", ".php", ".swift", ".kt", ".sh", ".sql", ".vue", ".svelte"]);

function walk(dir, base, files = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), base, files);
    } else if (e.isFile()) {
      files.push(path.relative(base, path.join(dir, e.name)));
    }
  }
  return files;
}

function collectStats(root) {
  const stats = {
    root,
    name: path.basename(root),
    files: 0,
    loc: 0,
    todos: 0,
    langs: {},
    largest: { file: "-", loc: 0 },
    hasTests: false,
    hasReadme: false,
    readmeLen: 0,
    hasLicense: false,
    hasCI: false,
    envCommitted: false,
    nodeModulesCommitted: false,
    todos: 0,
    commits: 0,
    authors: 0,
    avgMsgLen: 0,
    funnyMsgs: [],
  };

  // Working tree
  const all = walk(root, root);
  const codeFiles = all.filter((f) => CODE_EXT.has(path.extname(f).toLowerCase()));
  stats.files = codeFiles.length;
  stats.hasTests = all.some((f) => /(^|\/)(tests?|__tests__|spec)\//i.test(f));
  stats.hasReadme = all.some((f) => /^readme(\.md|\.txt)?$/i.test(path.basename(f)));
  stats.hasLicense = all.some((f) => /^licen[cs]e/i.test(path.basename(f)));
  stats.hasCI = all.some((f) => f.startsWith(".github/workflows/") || /\.gitlab-ci|\.circleci|jenkins/i.test(f));
  stats.envCommitted = all.some((f) => /^\.env$|^\.env\./i.test(path.basename(f)));
  stats.nodeModulesCommitted = all.some((f) => f.includes("node_modules"));

  const TODO_RE = /\b(TODO|FIXME|HACK|XXX|WORKAROUND)\b/;
  const sample = codeFiles.slice(0, 400);
  for (const f of sample) {
    let text;
    try { text = fs.readFileSync(path.join(root, f), "utf8"); } catch { continue; }
    const lines = text.split("\n");
    stats.loc += lines.length;
    for (const line of lines) if (TODO_RE.test(line)) stats.todos++;
    if (lines.length > stats.largest.loc) stats.largest = { file: f, loc: lines.length };
    const ext = path.extname(f).toLowerCase();
    stats.langs[ext] = (stats.langs[ext] || 0) + lines.length;
  }

  // Git history
  try {
    const log = execFileSync("git", ["log", "--pretty=format:%an|%s"], { encoding: "utf8", cwd: root });
    const rows = log.split("\n").filter(Boolean);
    stats.commits = rows.length;
    stats.authors = new Set(rows.map((r) => r.split("|")[0])).size;
    const msgs = rows.map((r) => r.split("|")[1] || "");
    stats.avgMsgLen = Math.round(msgs.reduce((a, m) => a + m.length, 0) / Math.max(1, msgs.length));
    stats.funnyMsgs = msgs
      .filter((m) => /oops|whoops|sorry|hack|quick fix|temp|wip|do not|don'?t|why|please|finally|actually|revert|panic|yolo/i.test(m))
      .slice(0, 6);
  } catch {
    stats.commits = 0;
  }

  return stats;
}

/* ---------- deterministic roast (seeded by repo name) ---------- */
function seeded(seedStr) {
  let s = 0;
  for (const ch of seedStr) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0, (s >>> 8) / 0x1000000);
}

function offlineRoast(st) {
  const rnd = seeded(st.name + st.files);
  const topLang = Object.entries(st.langs).sort((a, b) => b[1] - a[1])[0] || ["suspicious binary", 0];
  const langNames = { ".js": "JavaScript", ".ts": "TypeScript", ".py": "Python", ".rb": "Ruby", ".go": "Go", ".rs": "Rust", ".php": "PHP (my condolences)" };
  const lang = langNames[topLang[0]] || topLang[0].slice(1) + " files";

  const lines = [];

  if (st.files === 0) {
    lines.push("There is no code here. Honestly? Strong start.");
  } else {
    lines.push(`${st.files} files, ${st.loc.toLocaleString()} lines of ${lang}. Bold of you to call this "finished."`);
  }

  if (st.todos > 0) {
    lines.push(`${st.todos} TODO/FIXME/HACK notes — a paper trail of promises made to a future self who has clearly blocked you.`);
  }
  if (st.largest.loc > 300) {
    lines.push(`Your largest file is "${st.largest.file}" at ${st.largest.loc.toLocaleString()} lines. That's not a module, that's a group chat.`);
  }
  if (st.commits > 0 && st.authors === 1) {
    lines.push(`${st.commits} commits, 1 author. No code review, no witnesses, no one to stop you.`);
  }
  if (st.commits > 0 && st.avgMsgLen < 12) {
    lines.push(`Average commit message: ${st.avgMsgLen} characters. Your git log reads like ransom notes.`);
  }
  if (!st.hasTests && st.files > 3) {
    lines.push("No test directory. Every deploy is an act of faith and every release notes says 'should work'.");
  }
  if (st.hasTests) {
    lines.push("You have tests. Congratulations — now delete the parts the tests don't cover. So, most of it.");
  }
  if (st.envCommitted) {
    lines.push("There's a .env file tracked in git. Somewhere, a security engineer just woke up screaming.");
  }
  if (st.nodeModulesCommitted) {
    lines.push("node_modules is committed to the repo. You didn't manage dependencies, you adopted them.");
  }
  if (!st.hasReadme) {
    lines.push("No README. The code speaks for itself, and what it said was 'please don't'.");
  }
  if (!st.hasLicense) {
    lines.push("No LICENSE file. Legally, nobody is allowed to use this. Honestly the right call.");
  }
  if (!st.hasCI && st.files > 10) {
    lines.push("No CI pipeline. You test in production, and production knows.");
  }
  if (st.funnyMsgs.length) {
    lines.push(`Actual commit messages found in the wild: ${st.funnyMsgs.slice(0, 3).map((m) => `"${m}"`).join(", ")}. I rest my case.`);
  }

  // pick 5-6 strongest
  const picked = lines.sort(() => rnd() - 0.5).slice(0, 6);

  // verdict
  let verdict;
  if (st.envCommitted || st.nodeModulesCommitted) verdict = "Verdict: this repo isn't haunted, it's an active crime scene.";
  else if (st.todos > 20) verdict = "Verdict: less a codebase, more a museum of postponed decisions.";
  else if (!st.hasTests && st.files > 3) verdict = "Verdict: works on your machine, and your machine alone.";
  else if (st.files === 0) verdict = "Verdict: unknowable. Terrifying. 10/10.";
  else verdict = "Verdict: it runs. Nobody knows why. Don't touch anything.";

  return { picked, verdict };
}

/* ---------- LLM roast ---------- */
async function smartRoast(st) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.error(yellow("No OPENAI_API_KEY found — falling back to offline roast."));
    return null;
  }
  const summary = {
    repo: st.name, files: st.files, loc: st.loc, todos: st.todos,
    largestFile: st.largest, commits: st.commits, authors: st.authors,
    avgCommitMsgLen: st.avgMsgLen, hasTests: st.hasTests, hasReadme: st.hasReadme,
    hasLicense: st.hasLicense, hasCI: st.hasCI, envCommitted: st.envCommitted,
    suspiciousCommitMessages: st.funnyMsgs,
    languages: st.langs,
  };
  const res = await fetch(`${process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.ROAST_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are a brutal but funny senior engineer roasting a repo. Max 8 short punchy lines, then a one-line verdict. No markdown headers. Be cruel but never advise anything dangerous." },
        { role: "user", content: "Roast this repo:\n" + JSON.stringify(summary, null, 2) },
      ],
      temperature: 1,
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

/* ---------- output ---------- */
function print(roast, st) {
  console.log();
  console.log(bold(magenta(`  🔥 ROASTING "${st.name}" 🔥`)));
  console.log();
  for (const line of roast.picked) console.log(`  ${red("→")} ${line}`);
  console.log();
  console.log(bold(`  ${roast.verdict}`));
  console.log();
}

async function main() {
  const argv = process.argv.slice(2);
  const dirArg = argv.find((a) => !a.startsWith("--"));
  const root = path.resolve(dirArg || process.cwd());

  if (!fs.existsSync(path.join(root, ".git"))) {
    console.error(red(`✗ "${root}" is not a git repository.`));
    process.exit(1);
  }

  const st = collectStats(root);

  if (argv.includes("--smart")) {
    try {
      const text = await smartRoast(st);
      if (text) {
        console.log();
        console.log(bold(magenta(`  🔥 ROASTING "${st.name}" 🔥`)));
        console.log();
        for (const line of text.split("\n")) console.log("  " + line);
        console.log();
        return;
      }
    } catch (e) {
      console.error(yellow(`LLM roast failed (${e.message}) — falling back offline.`));
    }
  }

  print(offlineRoast(st), st);
}

main();

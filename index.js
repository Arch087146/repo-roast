#!/usr/bin/env node
/*
 * repo-roasted — an AI that roasts your repo.
 * Offline mode: brutal, deterministic, evidence-based roast.
 * Online mode (--smart): sends a stats summary to an LLM for a personal roast.
 *
 *   repo-roasted [dir]          roast a repo (default: current)
 *   repo-roasted --smart        LLM-powered roast (needs OPENAI_API_KEY)
 *   repo-roasted --json         machine-readable roast
 *   repo-roasted --md <file>    write ROAST.md for sharing
 *   repo-roasted --help
 */
"use strict";

const fs = require("fs");
const path = require("path");

const { collectStats } = require("./src/stats");
const { roastRepo } = require("./src/roast");
const { smartRoast } = require("./src/ai");
const render = require("./src/render");

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

function help() {
  console.log(`repo-roasted — an AI that roasts your codebase

Usage: repo-roasted [dir] [options]

  dir               repo to roast (default: current directory)
  --smart           LLM-powered roast (requires OPENAI_API_KEY)
  --json            machine-readable output
  --md <file>       also write the roast as markdown (e.g. ROAST.md)
  --help, -h        this`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) return help();

  // The value right after --md is a file path, not the repo to roast.
  const mdIdx = argv.indexOf("--md");
  const mdPath = mdIdx >= 0 && argv[mdIdx + 1] ? path.resolve(argv[mdIdx + 1]) : null;
  const dirArg = argv.find((a, i) => !a.startsWith("--") && i !== mdIdx + 1);
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
        console.log(`\x1b[1m\x1b[35m  🔥 ROASTING "${st.name}" (LLM verified) 🔥\x1b[0m`);
        console.log();
        for (const line of text.split("\n")) console.log("  " + line);
        console.log();
        if (mdPath) { fs.writeFileSync(mdPath, render.markdown(llmToRoast(text), st)); }
        return;
      }
      console.error(yellow("Set OPENAI_API_KEY to enable --smart. Roasting offline instead."));
    } catch (e) {
      console.error(yellow(`LLM roast failed (${e.message}) — falling back offline.`));
    }
  }

  const roast = roastRepo(st);

  if (argv.includes("--json")) render.jsonOut(roast, st);
  else render.terminal(roast, st);

  if (mdPath) {
    fs.writeFileSync(mdPath, render.markdown(roast, st));
    console.log(`\x1b[2m  saved → ${mdPath}\x1b[0m`);
  }
}

function llmToRoast(text) {
  const ls = text.split("\n").filter((l) => l.trim());
  const verdictLine = ls.reverse().find((l) => /^verdict:/i.test(l.trim()));
  const verdict = verdictLine?.trim() || "Verdict: terminal.";
  const body = ls.filter((l) => l !== verdictLine).reverse();
  return { lines: body, verdict, roastability: 0, tier: "LLM CERTIFIED", evidenceCount: body.length };
}

main();

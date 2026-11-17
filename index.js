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
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function help() {
  console.log(`repo-roasted — an AI that roasts your codebase

Usage: repo-roasted [dir] [options]

  dir               repo to roast (default: current directory)
  --smart           LLM-powered roast (OpenRouter or OpenAI)
  --model <id>      pick a model, e.g. "openai/gpt-4o-mini" or
                    "anthropic/claude-haiku-4.5" (default: a free OpenRouter model)
  --json            machine-readable output
  --md <file>       also write the roast as markdown (e.g. ROAST.md)
  --help, -h        this

LLM keys, in priority order:
  1. OPENROUTER_API_KEY env var   (your own key)
  2. bundled hosted key (npm package only) — works out of the box
  3. OPENAI_API_KEY env var       (your own key)
No key? The offline roast is always available.`);
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("--help") || argv.includes("-h")) return help();

  // Values right after --md/--model are file paths/model names, not the repo.
  const mdIdx = argv.indexOf("--md");
  const mdPath = mdIdx >= 0 && argv[mdIdx + 1] ? path.resolve(argv[mdIdx + 1]) : null;
  const modelIdx = argv.indexOf("--model");
  const modelArg = modelIdx >= 0 && argv[modelIdx + 1] ? argv[modelIdx + 1] : null;
  const dirArg = argv.find((a, i) => !a.startsWith("--") && i !== mdIdx + 1 && i !== modelIdx + 1);
  const root = path.resolve(dirArg || process.cwd());

  if (!fs.existsSync(path.join(root, ".git"))) {
    console.error(red(`✗ "${root}" is not a git repository.`));
    process.exit(1);
  }

  const st = collectStats(root);

  if (argv.includes("--smart")) {
    try {
      const result = await smartRoast(st, modelArg);
      if (result) {
        console.log();
        console.log(`\x1b[1m\x1b[35m  🔥 ROASTING "${st.name}" 🔥\x1b[0m`);
        console.log(dim(`   roasted by ${result.provider} · model: ${result.model}`));
        console.log();
        for (const line of result.text.split("\n")) console.log("  " + line);
        console.log();
        if (mdPath) { fs.writeFileSync(mdPath, render.markdown(llmToRoast(result.text), st)); }
        return;
      }
      console.error(yellow("No LLM key found (OPENROUTER_API_KEY or OPENAI_API_KEY). Roasting offline instead."));
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

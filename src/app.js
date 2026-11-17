/*
 * app.js — the interactive TUI application.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const t = require("./tui");
const { collectStats } = require("./stats");
const { roastRepo } = require("./roast");
const { smartRoast, resolveProvider } = require("./ai");
const render = require("./render");

const SCAN_MESSAGES = [
  "reading your commit messages…",
  "counting TODOs…",
  "measuring file shame…",
  "checking for empty catch blocks…",
  "looking for eval()…",
  "analyzing git history…",
  "consulting the elders…",
  "preparing judgement…",
];

const SCAN_MESSAGES_SMART = [
  ...SCAN_MESSAGES.slice(0, -1),
  "waking the AI…",
  "briefing the roast consultant…",
];

function assertRepo(dir) {
  if (!fs.existsSync(path.join(dir, ".git"))) {
    return `"${dir}" is not a git repository`;
  }
  return null;
}

async function typeBlock(roast, st) {
  await t.meter("roastability", roast.roastability / 100);
  t.line();
  for (const l of roast.lines) {
    t.write("  " + t.red("→ ") );
    await t.typewriter(l, 8);
    await t.sleep(60);
  }
  t.line();
  t.write("  ");
  await t.typewriter(t.bold(roast.verdict), 14);
  t.line();
  t.line();
}

/* ---- flows ---- */

async function roastFlow(root, smart, modelOverride) {
  const err = assertRepo(root);
  if (err) { t.line(`  ${t.red("✗ " + err)}`); await t.keypress(); return; }

  const st = await t.withStatus(
    (async () => { await t.sleep(600); return collectStats(root); })(),
    smart ? SCAN_MESSAGES_SMART : SCAN_MESSAGES
  );

  let roast;
  if (smart) {
    const result = await t.withStatus(smartRoast(st, modelOverride), ["reasoning about your choices…", "sharpening knives…", "almost personal enough…"]);
    if (result) {
      t.clear();
      t.line();
      t.line(`  ${t.bold(t.magenta(`🔥 ROASTING "${st.name}" 🔥`))}`);
      t.line(`  ${t.dim(`roasted by ${result.provider} · model: ${result.model}`)}`);
      t.line();
      const roastObj = {
        lines: result.text.split("\n").filter((x) => x.trim()),
        verdict: "",
      };
      // LLM output: last "Verdict:" line becomes the verdict.
      const last = roastObj.lines.reverse().find((x) => /^verdict:/i.test(x.trim()));
      if (last) {
        roastObj.verdict = last.trim().replace(/^verdict:\s*/i, "");
        roastObj.lines = roastObj.lines.filter((x) => x !== last).reverse();
      }
      await t.meter("roastability", roastRepo(st).roastability / 100);
      t.line();
      for (const l of roastObj.lines) {
        t.write("  " + t.red("→ "));
        await t.typewriter(l, 6);
      }
      t.line();
      t.write("  ");
      await t.typewriter(t.bold("Verdict: " + roastObj.verdict), 14);
      t.line();
      await postRoastMenu(st, { ...roastRepo(st), lines: roastObj.lines, verdict: "Verdict: " + roastObj.verdict });
      return;
    }
    t.line(`  ${t.yellow("No LLM key found — roasting offline.")}`);
    await t.sleep(900);
  }

  roast = roastRepo(st);
  t.clear();
  t.line();
  t.line(`  ${t.bold(t.magenta(`🔥 ROASTING "${st.name}" 🔥`))}`);
  t.line(`  ${t.dim(`tier: ${roast.tier} · ${roast.evidenceCount} findings`)}`);
  t.line();
  await typeBlock(roast, st);
  await postRoastMenu(st, roast);
}

async function postRoastMenu(st, roast) {
  for (;;) {
    const sel = await t.menu(`"${st.name}" has been roasted`, [
      "Save as ROAST.md (share it)",
      "Roast another repo",
      "Back to main menu",
    ]);
    if (sel === 0) {
      const file = path.join(process.cwd(), "ROAST.md");
      fs.writeFileSync(file, render.markdown(roast, st));
      t.line(`  ${t.green("✔")} saved → ${file}`);
      await t.sleep(1200);
    } else if (sel === 1) {
      await pickRepoFlow(false);
      return;
    } else return;
  }
}

async function pickRepoFlow(smart) {
  t.clear();
  t.line();
  t.write(`  path to repo: `);
  const dir = await readLine();
  if (!dir.trim()) return;
  await roastFlow(path.resolve(dir.trim()), smart, null);
}

/* Plain line input (raw mode off temporarily). */
function readLine() {
  return new Promise((resolve) => {
    t.exit();
    process.stdout.write(t.SHOW_CURSOR);
    const rl = require("readline").createInterface({ input: process.stdin, output: process.stdout });
    rl.question("", (answer) => { rl.close(); t.enter(); resolve(answer); });
  });
}

/* ---- model picker for smart roasts ---- */

const MODELS = [
  "meta-llama/llama-3.1-8b-instruct:free",
  "openai/gpt-4o-mini",
  "anthropic/claude-haiku-4.5",
  "google/gemini-2.0-flash-001",
  "…type a custom model id",
];

async function pickModel() {
  const sel = await t.menu("Pick a model", MODELS);
  if (sel === null) return null;
  if (sel === MODELS.length - 1) {
    t.clear();
    t.write(`  model id (e.g. qwen/qwen-2.5-72b-instruct): `);
    const id = await readLine();
    return id.trim() || null;
  }
  return MODELS[sel];
}

/* ---- main loop ---- */

async function main() {
  if (!t.isTTY()) {
    console.log("repo-roasted TUI needs a real terminal (TTY). Use flags instead: repo-roasted --help");
    return;
  }
  t.enter();
  try {
    t.clear();
    t.line();
    for (const l of t.BANNER) {
      t.line(t.bold(t.magenta(l)));
      await t.sleep(90);
    }
    t.line();
    t.line(t.dim("  the code reviewer with no manners · v" + require("../package.json").version));
    await t.sleep(700);

    for (;;) {
      t.clear();
      const sel = await t.menu("repo-roasted", [
        `Roast current repo (${path.basename(process.cwd())})`,
        "🔥 Roast with AI (--smart)",
        "🔥 Roast with AI — pick a model",
        "Roast another repo (offline)",
        "Exit",
      ]);
      if (sel === 0) await roastFlow(process.cwd(), false, null);
      else if (sel === 1) await roastFlow(process.cwd(), true, null);
      else if (sel === 2) { const m = await pickModel(); if (m) await roastFlow(process.cwd(), true, m); }
      else if (sel === 3) await pickRepoFlow(false);
      else break;
    }
  } finally {
    t.exit();
  }
}

module.exports = { main };

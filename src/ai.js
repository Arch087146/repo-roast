/*
 * ai.js — optional LLM mode with multi-provider support.
 *
 * Key resolution order:
 *   1. OPENROUTER_API_KEY env        (user's own OpenRouter key)
 *   2. bundled key from src/keys.js  (hosted key, shipped in the npm package)
 *   3. OPENAI_API_KEY env            (user's own OpenAI key)
 *   4. null → caller falls back to the offline roast
 */
"use strict";

const config = require("./config");

let bundledKey = { OPENROUTER_KEY: "" };
try { bundledKey = require("./keys"); } catch { /* not bundled */ }

function resolveProvider(modelOverride) {
  const openrouterKey = process.env.OPENROUTER_API_KEY || bundledKey.OPENROUTER_KEY || "";
  if (openrouterKey) {
    return {
      provider: "OpenRouter",
      key: openrouterKey,
      base: config.OPENROUTER_BASE,
      model: modelOverride || process.env.OPENROUTER_MODEL || config.DEFAULT_OPENROUTER_MODEL,
    };
  }
  const openaiKey = process.env.OPENAI_API_KEY || "";
  if (openaiKey) {
    return {
      provider: "OpenAI",
      key: openaiKey,
      base: config.OPENAI_BASE,
      model: modelOverride || process.env.ROAST_MODEL || "gpt-4o-mini",
    };
  }
  return null;
}

async function callLLM(p, summary) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${p.key}`,
  };
  if (p.provider === "OpenRouter") {
    headers["HTTP-Referer"] = "https://github.com/Arch087146/repo-roast";
    headers["X-Title"] = "repo-roasted";
  }
  const res = await fetch(`${p.base}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: p.model,
      messages: [
        {
          role: "system",
          content:
            "You are a brutal but funny senior engineer roasting a repo. " +
            "Max 8 short punchy lines, then a one-line verdict starting with 'Verdict:'. " +
            "No markdown headers, no bullet symbols. Be cruel but never advise anything dangerous. " +
            "Reference the actual stats and commit messages where you can.",
        },
        { role: "user", content: "Roast this repo:\n" + JSON.stringify(summary, null, 2) },
      ],
      temperature: 1,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${p.provider} ${res.status} ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

/**
 * Returns { text, provider, model } or null if no key is configured.
 * Throws if a key exists but the API call fails.
 */
async function smartRoast(st, modelOverride) {
  const p = resolveProvider(modelOverride);
  if (!p) return null;

  const summary = {
    repo: st.name, files: st.files, loc: st.loc,
    todos: st.todos, deadCode: st.deadCode, evals: st.evals,
    emptyCatch: st.emptyCatch, tsAny: st.tsAny,
    largestFile: st.largest, top3Share: +st.top3Share.toFixed(2),
    commits: st.commits, authors: st.authors, avgCommitMsgLen: st.avgMsgLen,
    revertCount: st.revertCount, curseWordsInCommits: st.curseWords,
    suspiciousCommitMessages: st.funnyMsgs,
    weirdFileNames: st.weirdNames,
    hasTests: st.hasTests, hasReadme: st.hasReadme, hasLicense: st.hasLicense,
    hasCI: st.hasCI, hasGitignore: st.hasGitignore,
    envCommitted: st.envCommitted, nodeModulesCommitted: st.nodeModulesCommitted,
    dependencies: st.deps,
    languages: st.langs,
  };

  const text = await callLLM(p, summary);
  return { text, provider: p.provider, model: p.model };
}

module.exports = { smartRoast, resolveProvider };

/*
 * ai.js — optional LLM mode. Sends the (already collected) stats summary
 * to an OpenAI-compatible endpoint for a personalized roast.
 */
"use strict";

async function smartRoast(st) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

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

  const res = await fetch(`${process.env.OPENAI_BASE_URL || "https://api.openai.com/v1"}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: process.env.ROAST_MODEL || "gpt-4o-mini",
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
  if (!res.ok) throw new Error(`API ${res.status}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

module.exports = { smartRoast };

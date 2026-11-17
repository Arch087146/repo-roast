/*
 * roast.js — the engine. Turns evidence into a weighted indictment.
 * Every finding carries a weight (how roastable it is). The top findings
 * become roast lines; the total decides the verdict tier.
 */
"use strict";

function seeded(seedStr) {
  let s = 0;
  for (const ch of seedStr) s = (s * 31 + ch.charCodeAt(0)) >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0, (s >>> 8) / 0x1000000);
}

const fmt = (n) => n.toLocaleString("en-US");

/* Each finding: { w: weight, text: roast line }. Higher weight = more damning. */
function findings(st) {
  const F = [];

  /* ---- hygiene disasters (weight 10) ---- */
  if (st.envCommitted)
    F.push({ w: 10, text: "There's a .env file tracked in git. Somewhere, a security engineer just woke up screaming." });
  if (st.nodeModulesCommitted)
    F.push({ w: 10, text: "node_modules is committed. You didn't manage dependencies, you adopted them." });

  /* ---- code crimes (weight 8) ---- */
  if (st.evals > 0)
    F.push({ w: 8, text: `${st.evals} call${st.evals > 1 ? "s" : ""} to eval(). You didn't want types or safety, you wanted surprises.` });
  if (st.emptyCatch > 0)
    F.push({ w: 8, text: `${st.emptyCatch} empty catch block${st.emptyCatch > 1 ? "s" : ""}. Errors don't disappear, they just stop being your problem.` });
  if (st.tsAny > 5)
    F.push({ w: 7, text: `${st.tsAny} uses of "any" in TypeScript. Congratulations, you found the expensive way to write JavaScript.` });

  /* ---- structure (weight 5-6) ---- */
  if (st.largest.loc > 500)
    F.push({ w: 6, text: `Your largest file is "${st.largest.file}" at ${fmt(st.largest.loc)} lines. That's not a module, that's a group chat.` });
  else if (st.largest.loc > 300)
    F.push({ w: 4, text: `"${st.largest.file}" is ${fmt(st.largest.loc)} lines. Somewhere in there is a function that misses being split.` });
  if (st.files > 5 && st.top3Share > 0.7)
    F.push({ w: 5, text: `Three files hold ${Math.round(st.top3Share * 100)}% of your code. The other ${st.files - 3} files are basically comments.` });

  /* ---- craft & vibes (weight 3-7) ---- */
  if (st.todos > 30)
    F.push({ w: 5, text: `${st.todos} TODO/FIXME notes — a paper trail of promises made to a future self who has clearly blocked you.` });
  else if (st.todos > 0)
    F.push({ w: 3, text: `${st.todos} TODO${st.todos > 1 ? "s" : ""} left in the code. Each one is a tiny hope that nobody audits.` });
  if (st.deadCode > 5)
    F.push({ w: 4, text: `${st.deadCode} lines of commented-out code. Version control was invented in 2005, but sure, keep a backup inside the file.` });
  if (st.weirdNames.length)
    F.push({ w: 5, text: `Files named like ${st.weirdNames.slice(0, 2).map((f) => `"${f}"`).join(", ")} — the classic naming system of a repo with trust issues.` });

  /* ---- git history (weight 4-6) ---- */
  if (st.commits > 0 && st.authors === 1 && st.commits > 10)
    F.push({ w: 5, text: `${fmt(st.commits)} commits, 1 author. No code review, no witnesses, no one to stop you.` });
  if (st.commits > 0 && st.avgMsgLen > 0 && st.avgMsgLen < 12)
    F.push({ w: 4, text: `Average commit message: ${st.avgMsgLen} characters. Your git log reads like ransom notes.` });
  if (st.revertCount > 2)
    F.push({ w: 6, text: `${st.revertCount} commits are literal reverts of other commits. That's not a history, that's a apology chain.` });
  if (st.curseWords > 0)
    F.push({ w: 4, text: `${st.curseWords} commit messages contain swearing. The compiler can't read your emotions, but your teammates can.` });
  if (st.funnyMsgs.length)
    F.push({ w: 6, text: `Actual commit messages found in the wild: ${st.funnyMsgs.slice(0, 3).map((m) => `"${m}"`).join(", ")}. I rest my case.` });

  /* ---- missing basics (weight 2-7) ---- */
  if (!st.hasTests && st.files > 3)
    F.push({ w: 7, text: "No test directory. Every deploy is an act of faith and every release notes says 'should work'." });
  if (st.hasTests)
    F.push({ w: 2, text: "You have tests. Congratulations — now delete the parts the tests don't cover. So, most of it." });
  if (!st.hasReadme)
    F.push({ w: 3, text: "No README. The code speaks for itself, and what it said was 'please don't'." });
  if (!st.hasLicense)
    F.push({ w: 2, text: "No LICENSE file. Legally, nobody is allowed to use this. Honestly the right call." });
  if (!st.hasCI && st.files > 10)
    F.push({ w: 3, text: "No CI pipeline. You test in production, and production knows." });
  if (!st.hasGitignore)
    F.push({ w: 4, text: "No .gitignore. Every file is sacred, including the ones that shouldn't exist." });
  if (st.lockfileOnly)
    F.push({ w: 3, text: "There's a lockfile but no package.json. You locked the door and threw away the house." });

  /* ---- dependencies (weight 3-4) ---- */
  if (st.deps && st.deps.count > 150)
    F.push({ w: 4, text: `${st.deps.count} dependencies in ${st.deps.kind}. Somewhere in that graph is a package whose entire job is checking if a number is negative.` });
  else if (st.deps && st.deps.count > 60)
    F.push({ w: 3, text: `${st.deps.count} dependencies. Your install script has more moving parts than your app.` });

  /* ---- tiny repo (weight 2) ---- */
  if (st.files === 0)
    F.push({ w: 2, text: "There is no code here. Honestly? Strong start." });
  else if (st.files <= 3 && st.commits > 0)
    F.push({ w: 2, text: `${st.files} files, ${fmt(st.loc)} lines of code. Bold of you to call this "finished."` });

  return F;
}

const VERDICTS = [
  { max: 10,  label: "OK, FINE",   verdict: "This repo is… fine. I'll be back when you add features." },
  { max: 25,  label: "MILDLY CURSED", verdict: "It runs. Nobody knows why. Don't touch anything." },
  { max: 45,  label: "FUNCTIONALLY HAUNTED", verdict: "The bugs aren't lost — they're waiting, politely, in production." },
  { max: 70,  label: "CRIME SCENE", verdict: "This repo isn't haunted, it's an active crime scene." },
  { max: 1e9, label: "BIOHAZARD", verdict: "Delete it. Start over. Tell nobody. We never had this conversation." },
];

function roastRepo(st) {
  const all = findings(st);

  // Deterministic shuffle so the same repo always gets the same roast.
  const rnd = seeded(st.name + "|" + st.files + "|" + st.commits);
  const shuffled = [...all].sort(() => rnd() - 0.5);
  const picked = shuffled
    .sort((a, b) => b.w - a.w)   // most damning first, order preserved
    .slice(0, 7)
    .map((f) => f.text);

  const severity = all.reduce((a, f) => a + f.w, 0);
  const tier = VERDICTS.find((v) => severity < v.max);
  return {
    roastability: Math.min(100, Math.round(severity * 0.9)),
    tier: tier.label,
    verdict: tier.verdict,
    lines: picked,
    evidenceCount: all.length,
  };
}

module.exports = { roastRepo, VERDICTS };

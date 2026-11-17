# repo-roasted 🔥

An AI that roasts your codebase. Two modes:

- **Offline (default):** zero dependencies, fully deterministic — scans your
  files and git history for 20+ roastable signals, then serves a brutal,
  evidence-based roast. Same repo, same roast, every time. Share the screenshot.
- **`--smart`:** set `OPENAI_API_KEY` and it sends your repo's stats to an LLM
  for a personalized, extra-hurtful roast. Falls back to offline mode
  automatically if the API is unreachable.

## Usage

```bash
npx repo-roasted            # roast the current repo (offline)
npx repo-roasted ../other   # roast someone else's repo (their pain, your fun)
npx repo-roasted --smart    # LLM-powered roast (needs OPENAI_API_KEY)
npx repo-roasted --json     # machine-readable roast
npx repo-roasted --md ROAST.md  # write a shareable markdown roast
```

Run tests with `npm test` (uses node's built-in test runner — zero deps, obviously).

## How the roast engine works

Every roastable finding carries a **weight** (how damning it is, 2–10).
Your **roastability score** (0–100) is the weighted evidence sum, which maps
to a tier:

| Tier | Score | Verdict |
|---|---|---|
| OK, FINE | < 10 | "This repo is… fine. I'll be back when you add features." |
| MILDLY CURSED | < 25 | "It runs. Nobody knows why. Don't touch anything." |
| FUNCTIONALLY HAUNTED | < 45 | "The bugs aren't lost — they're waiting, politely, in production." |
| CRIME SCENE | < 70 | "This repo isn't haunted, it's an active crime scene." |
| BIOHAZARD | ≥ 70 | "Delete it. Start over. Tell nobody. We never had this conversation." |

## What it looks for

| Evidence | Example line |
|---|---|
| `.env` / `node_modules` committed | "Somewhere, a security engineer just woke up screaming" |
| `eval()`, empty catch blocks, `any:` spam | "You found the expensive way to write JavaScript" |
| Giant files, 3 files = 70% of all code | "That's not a module, that's a group chat" |
| TODO/FIXME density | "Promises made to a future self who blocked you" |
| Commented-out code | "Version control was invented in 2005, but sure, keep a backup inside the file" |
| Solo-authored history, lazy messages, revert chains, swearing in commits | "Your git log reads like ransom notes" |
| Files named `final2.js`, `copy of final.js` | "The classic naming system of a repo with trust issues" |
| No tests / README / LICENSE / CI / .gitignore | "Every deploy is an act of faith" |
| 300 dependencies | "Somewhere in that graph is a package whose entire job is checking if a number is negative" |
| Suspicious commit messages, quoted verbatim | "I rest my case." |

## Pairs well with

- [`git-regret`](https://github.com/Arch087146/git-regret) — proves your hacks were regrets
- [`repo-sanitizer`](https://github.com/Arch087146/repo-sanitizer) — finds the secrets you're about to leak

MIT

# repo-roast 🔥

An AI that roasts your codebase. Two modes:

- **Offline (default):** zero dependencies, fully deterministic — scans your
  files and git history, then serves a brutal roast built from real evidence.
  Same repo, same roast, every time. Share the screenshot.
- **`--smart`:** set `OPENAI_API_KEY` and it sends your repo's stats to an LLM
  for a personalized, extra-hurtful roast. Falls back to offline mode
  automatically if the API is unreachable.

## Usage

```bash
npx repo-roast           # roast the current repo (offline)
npx repo-roast ../other  # roast someone else's repo (their pain, your fun)
npx repo-roast --smart   # LLM-powered roast (needs OPENAI_API_KEY)
```

## What it looks for

| Evidence | Example line |
|---|---|
| TODO/FIXME/HACK density | "27 TODO notes — promises made to a future self who blocked you" |
| Giant files | "1,900 lines. That's not a module, that's a group chat." |
| Solo-authored history | "No code review, no witnesses, no one to stop you" |
| Lazy commit messages | "Average commit message: 9 characters. Your log reads like ransom notes." |
| Missing tests / README / LICENSE / CI | "Every deploy is an act of faith" |
| `.env` or `node_modules` committed | "Somewhere, a security engineer just woke up screaming" |
| Suspicious commits, quoted verbatim | "Actual messages: 'quick fix lol', 'wip do not look'. I rest my case." |

It ends every roast with a one-line **verdict**. Exit code is always 0 —
roasting is not a crime (yet).

## Pairs well with

- [`git-regret`](https://github.com/Arch087146/git-regret) — proves your hacks were regrets
- [`repo-sanitizer`](https://github.com/Arch087146/repo-sanitizer) — finds the secrets you're about to leak

MIT

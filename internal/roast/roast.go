// Package roast — repo analysis and the roast engine.
package roast

import (
	"fmt"
	"hash/fnv"
	"math/rand"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// SkipDirs are never analyzed.
var SkipDirs = map[string]bool{
	".git": true, "node_modules": true, ".venv": true, "venv": true,
	"__pycache__": true, "dist": true, "build": true, ".next": true,
	"target": true, "vendor": true, ".gradle": true,
}

var codeExt = map[string]bool{
	".js": true, ".ts": true, ".jsx": true, ".tsx": true, ".mjs": true,
	".cjs": true, ".py": true, ".rb": true, ".go": true, ".rs": true,
	".java": true, ".c": true, ".cpp": true, ".h": true, ".hpp": true,
	".cs": true, ".php": true, ".swift": true, ".kt": true, ".sh": true,
	".sql": true, ".vue": true, ".svelte": true,
}

var (
	todoRE       = regexp.MustCompile(`\b(TODO|FIXME|HACK|XXX|WORKAROUND)\b`)
	deadCodeRE   = regexp.MustCompile(`^\s*//\s*(const |let |var |function |if |for |while |return |console\.)`)
	commentRE    = regexp.MustCompile(`^\s*(//|#|\*|/\*)`)
	evalRE       = regexp.MustCompile(`\beval\s*\(`)
	emptyCatchRE = regexp.MustCompile(`catch\s*(\([^)]*\))?\s*\{\s*\}`)
	tsAnyRE      = regexp.MustCompile(`:\s*any\b`)
	weirdNameRE  = regexp.MustCompile(`(?i)(final|new|old|copy|backup|fix|temp|v\d+)[^/\\]*\.[a-z]+$`)
	funnyMsgRE   = regexp.MustCompile(`(?i)oops|whoops|sorry|hack|quick ?fix|temp|wip|do ?not|don'?t|why|please|finally|actually|revert|panic|yolo|dude|bruh|final(ly)? ?(fix|version)`)
	curseRE      = regexp.MustCompile(`(?i)\b(wtf|wth|omg|damn|dammit|crap|shit|fuck|fck|argh|ugh)\b`)
)

// Stats is everything roastable about a repo.
type Stats struct {
	Name string `json:"repo"`

	Files int               `json:"files"`
	Loc   int               `json:"loc"`
	Langs map[string]int    `json:"languages"`
	Todos int               `json:"todos"`
	DeadCode int            `json:"deadCode"`
	Evals int               `json:"evals"`
	EmptyCatch int          `json:"emptyCatch"`
	TsAny int               `json:"tsAny"`
	Largest  FileSize       `json:"largestFile"`
	Top3Share float64      `json:"top3Share"`
	WeirdNames []string     `json:"weirdFileNames"`
	Deps      *Deps         `json:"dependencies"`

	HasTests bool `json:"hasTests"`
	HasReadme bool `json:"hasReadme"`
	HasLicense bool `json:"hasLicense"`
	HasCI bool        `json:"hasCI"`
	HasGitignore bool  `json:"hasGitignore"`
	EnvCommitted bool   `json:"envCommitted"`
	NodeModulesCommitted bool `json:"nodeModulesCommitted"`
	LockfileOnly bool    `json:"lockfileOnly"`
	CommentLines int    `json:"commentLines"`

	Commits int      `json:"commits"`
	Authors int      `json:"authors"`
	AvgMsgLen int    `json:"avgCommitMsgLen"`
	FunnyMsgs []string `json:"suspiciousCommitMessages"`
	RevertCount int  `json:"revertCount"`
	CurseWords int   `json:"curseWordsInCommits"`
}

type FileSize struct {
	File string `json:"file"`
	Loc  int    `json:"lines"`
}

type Deps struct {
	Count int    `json:"count"`
	Kind  string `json:"kind"`
}

func walk(dir string, files *[]string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, e := range entries {
		p := filepath.Join(dir, e.Name())
		if e.IsDir() {
			if !SkipDirs[e.Name()] {
				walk(p, files)
			}
		} else if e.Type().IsRegular() {
			*files = append(*files, p)
		}
	}
}

func rel(root, p string) string {
	r, err := filepath.Rel(root, p)
	if err != nil {
		return p
	}
	return filepath.ToSlash(r)
}

// CollectStats gathers every roastable signal from a repo.
func CollectStats(root string) *Stats {
	st := &Stats{Name: filepath.Base(root), Langs: map[string]int{}}

	var all []string
	walk(root, &all)

	for _, p := range all {
		f := rel(root, p)
		base := strings.ToLower(filepath.Base(f))
		switch {
		case base == "readme.md" || base == "readme.txt" || base == "readme":
			st.HasReadme = true
		case strings.HasPrefix(base, "license"):
			st.HasLicense = true
		case base == ".gitignore":
			st.HasGitignore = true
		case base == ".env" || strings.HasPrefix(base, ".env."):
			st.EnvCommitted = true
		case strings.Contains(f, "node_modules/"):
			st.NodeModulesCommitted = true
		}
		if strings.HasPrefix(f, ".github/workflows/") ||
			regexp.MustCompile(`\.gitlab-ci|\.circleci|jenkins`).MatchString(f) {
			st.HasCI = true
		}
		if codeExt[strings.ToLower(filepath.Ext(f))] {
			st.Files++
			if weirdNameRE.MatchString(base) && len(st.WeirdNames) < 5 {
				st.WeirdNames = append(st.WeirdNames, f)
			}
		}
		if m := regexp.MustCompile(`(^|/)(tests?|__tests__|spec)/|\.test\.|\.spec\.`); m.MatchString(f) {
			st.HasTests = true
		}
		if strings.Contains(f, "package-lock.json") || strings.Contains(f, "yarn.lock") || strings.Contains(f, "pnpm-lock") {
			st.LockfileOnly = true
		}
	}
	// lockfile is only a crime when package.json is missing
	if _, err := os.Stat(filepath.Join(root, "package.json")); err == nil {
		st.LockfileOnly = false
	}

	// content scan (bounded)
	n := 0
	type fs struct{ file string; loc int }
	var sizes []fs
	for _, p := range all {
		if n >= 600 {
			break
		}
		ext := strings.ToLower(filepath.Ext(p))
		if !codeExt[ext] {
			continue
		}
		n++
		data, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		lines := strings.Split(string(data), "\n")
		loc := len(lines)
		st.Loc += loc
		st.Langs[ext] += loc
		sizes = append(sizes, fs{rel(root, p), loc})
		for _, ln := range lines {
			if todoRE.MatchString(ln) {
				st.Todos++
			}
			if deadCodeRE.MatchString(ln) {
				st.DeadCode++
			}
			if commentRE.MatchString(ln) {
				st.CommentLines++
			}
		}
		st.Evals += len(evalRE.FindAllString(string(data), -1))
		if emptyCatchRE.MatchString(string(data)) {
			st.EmptyCatch++
		}
		st.TsAny += len(tsAnyRE.FindAllString(string(data), -1))
	}
	sort.Slice(sizes, func(i, j int) bool { return sizes[i].loc > sizes[j].loc })
	if len(sizes) > 0 {
		st.Largest = FileSize{sizes[0].file, sizes[0].loc}
		top3 := 0
		for i := 0; i < len(sizes) && i < 3; i++ {
			top3 += sizes[i].loc
		}
		if st.Loc > 0 {
			st.Top3Share = float64(top3) / float64(st.Loc)
		}
	}

	// dependencies
	if data, err := os.ReadFile(filepath.Join(root, "package.json")); err == nil {
		count := 0
		for _, key := range []string{`"dependencies"`, `"devDependencies"`} {
			i := strings.Index(string(data), key)
			if i >= 0 {
				seg := string(data)[i:]
				end := strings.Index(seg, "}")
				if end > 0 {
					seg = seg[:end]
					count += strings.Count(seg, "\": \"")
				}
			}
		}
		if count > 0 {
			st.Deps = &Deps{Count: count, Kind: "package.json"}
		}
	}

	// git history
	out, err := gitIn(root, "log", "--pretty=format:%an|%s")
	if err == nil {
		rows := nonEmpty(strings.Split(out, "\n"))
		st.Commits = len(rows)
		authors := map[string]bool{}
		total := 0
		for _, r := range rows {
			parts := strings.SplitN(r, "|", 2)
			authors[parts[0]] = true
			msg := ""
			if len(parts) > 1 {
				msg = parts[1]
			}
			total += len(msg)
			if funnyMsgRE.MatchString(msg) && len(st.FunnyMsgs) < 8 {
				st.FunnyMsgs = append(st.FunnyMsgs, msg)
			}
			if strings.HasPrefix(strings.ToLower(msg), "revert") {
				st.RevertCount++
			}
			if curseRE.MatchString(msg) {
				st.CurseWords++
			}
		}
		st.Authors = len(authors)
		if st.Commits > 0 {
			st.AvgMsgLen = total / st.Commits
		}
	}
	return st
}

func nonEmpty(ss []string) []string {
	var out []string
	for _, s := range ss {
		if strings.TrimSpace(s) != "" {
			out = append(out, s)
		}
	}
	return out
}

func gitIn(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	out, err := cmd.Output()
	return strings.TrimSpace(string(out)), err
}

// ---- roast engine ----

// Finding is one roastable fact. Weight 2-10; higher = more damning.
type Finding struct {
	W    int
	Text string
}

func findings(st *Stats) []Finding {
	F := []Finding{}

	if st.EnvCommitted {
		F = append(F, Finding{10, "There's a .env file tracked in git. Somewhere, a security engineer just woke up screaming."})
	}
	if st.NodeModulesCommitted {
		F = append(F, Finding{10, "node_modules is committed. You didn't manage dependencies, you adopted them."})
	}
	if st.Evals > 0 {
		unit := "call"
		if st.Evals > 1 {
			unit = "calls"
		}
		F = append(F, Finding{8, fmt.Sprintf("%d %s to eval(). You didn't want types or safety, you wanted surprises.", st.Evals, unit)})
	}
	if st.EmptyCatch > 0 {
		unit := "block"
		if st.EmptyCatch > 1 {
			unit = "blocks"
		}
		F = append(F, Finding{8, fmt.Sprintf("%d empty catch %s. Errors don't disappear, they just stop being your problem.", st.EmptyCatch, unit)})
	}
	if st.TsAny > 5 {
		F = append(F, Finding{7, fmt.Sprintf(`%d uses of "any" in TypeScript. Congratulations, you found the expensive way to write JavaScript.`, st.TsAny)})
	}
	if st.Largest.Loc > 500 {
		F = append(F, Finding{6, fmt.Sprintf("Your largest file is %q at %s lines. That's not a module, that's a group chat.", st.Largest.File, comma(st.Largest.Loc))})
	} else if st.Largest.Loc > 300 {
		F = append(F, Finding{4, fmt.Sprintf("%q is %s lines. Somewhere in there is a function that misses being split.", st.Largest.File, comma(st.Largest.Loc))})
	}
	if st.Files > 5 && st.Top3Share > 0.7 {
		F = append(F, Finding{5, fmt.Sprintf("Three files hold %d%% of your code. The other %d files are basically comments.", int(st.Top3Share*100), st.Files-3)})
	}
	if st.Todos > 30 {
		F = append(F, Finding{5, fmt.Sprintf("%d TODO/FIXME notes — a paper trail of promises made to a future self who has clearly blocked you.", st.Todos)})
	} else if st.Todos > 0 {
		F = append(F, Finding{3, fmt.Sprintf("%d TODOs left in the code. Each one is a tiny hope that nobody audits.", st.Todos)})
	}
	if st.DeadCode > 5 {
		F = append(F, Finding{4, fmt.Sprintf("%d lines of commented-out code. Version control was invented in 2005, but sure, keep a backup inside the file.", st.DeadCode)})
	}
	if len(st.WeirdNames) > 0 {
		names := st.WeirdNames
		if len(names) > 2 {
			names = names[:2]
		}
		quoted := make([]string, len(names))
		for i, n := range names {
			quoted[i] = fmt.Sprintf("%q", n)
		}
		F = append(F, Finding{5, "Files named like " + strings.Join(quoted, ", ") + " — the classic naming system of a repo with trust issues."})
	}
	if st.Commits > 10 && st.Authors == 1 {
		F = append(F, Finding{5, fmt.Sprintf("%s commits, 1 author. No code review, no witnesses, no one to stop you.", comma(st.Commits))})
	}
	if st.Commits > 0 && st.AvgMsgLen < 12 {
		F = append(F, Finding{4, fmt.Sprintf("Average commit message: %d characters. Your git log reads like ransom notes.", st.AvgMsgLen)})
	}
	if st.RevertCount > 2 {
		F = append(F, Finding{6, fmt.Sprintf("%d commits are literal reverts of other commits. That's not a history, that's an apology chain.", st.RevertCount)})
	}
	if st.CurseWords > 0 {
		F = append(F, Finding{4, fmt.Sprintf("%d commit messages contain swearing. The compiler can't read your emotions, but your teammates can.", st.CurseWords)})
	}
	if len(st.FunnyMsgs) > 0 {
		msgs := st.FunnyMsgs
		if len(msgs) > 3 {
			msgs = msgs[:3]
		}
		quoted := make([]string, len(msgs))
		for i, m := range msgs {
			quoted[i] = fmt.Sprintf("%q", m)
		}
		F = append(F, Finding{6, "Actual commit messages found in the wild: " + strings.Join(quoted, ", ") + ". I rest my case."})
	}
	if !st.HasTests && st.Files > 3 {
		F = append(F, Finding{7, "No test directory. Every deploy is an act of faith and every release notes says 'should work'."})
	}
	if st.HasTests {
		F = append(F, Finding{2, "You have tests. Congratulations — now delete the parts the tests don't cover. So, most of it."})
	}
	if !st.HasReadme {
		F = append(F, Finding{3, "No README. The code speaks for itself, and what it said was 'please don't'."})
	}
	if !st.HasLicense {
		F = append(F, Finding{2, "No LICENSE file. Legally, nobody is allowed to use this. Honestly the right call."})
	}
	if !st.HasCI && st.Files > 10 {
		F = append(F, Finding{3, "No CI pipeline. You test in production, and production knows."})
	}
	if !st.HasGitignore {
		F = append(F, Finding{4, "No .gitignore. Every file is sacred, including the ones that shouldn't exist."})
	}
	if st.LockfileOnly {
		F = append(F, Finding{3, "There's a lockfile but no package.json. You locked the door and threw away the house."})
	}
	if st.Deps != nil && st.Deps.Count > 150 {
		F = append(F, Finding{4, fmt.Sprintf("%d dependencies in %s. Somewhere in that graph is a package whose entire job is checking if a number is negative.", st.Deps.Count, st.Deps.Kind)})
	} else if st.Deps != nil && st.Deps.Count > 60 {
		F = append(F, Finding{3, fmt.Sprintf("%d dependencies. Your install script has more moving parts than your app.", st.Deps.Count)})
	}
	if st.Files == 0 {
		F = append(F, Finding{2, "There is no code here. Honestly? Strong start."})
	} else if st.Files <= 3 && st.Commits > 0 {
		F = append(F, Finding{2, fmt.Sprintf(`%d files, %s lines of code. Bold of you to call this "finished."`, st.Files, comma(st.Loc))})
	}
	return F
}

type verdict struct {
	Max     int
	Label   string
	Verdict string
}

var verdicts = []verdict{
	{10, "OK, FINE", "This repo is… fine. I'll be back when you add features."},
	{25, "MILDLY CURSED", "It runs. Nobody knows why. Don't touch anything."},
	{45, "FUNCTIONALLY HAUNTED", "The bugs aren't lost — they're waiting, politely, in production."},
	{70, "CRIME SCENE", "This repo isn't haunted, it's an active crime scene."},
	{1 << 30, "BIOHAZARD", "Delete it. Start over. Tell nobody. We never had this conversation."},
}

// Roast is the engine's output.
type Roast struct {
	Roastability  int      `json:"roastability"`
	Tier          string   `json:"tier"`
	Verdict       string   `json:"verdict"`
	Lines         []string `json:"lines"`
	EvidenceCount int      `json:"evidenceCount"`
}

// RoastRepo turns stats into an indictment. Deterministic per repo.
func RoastRepo(st *Stats) Roast {
	all := findings(st)

	// deterministic shuffle, then keep the heaviest evidence
	h := fnv.New32a()
	fmt.Fprintf(h, "%s|%d|%d", st.Name, st.Files, st.Commits)
	rnd := rand.New(rand.NewSource(int64(h.Sum32())))
	shuffled := append([]Finding(nil), all...)
	rnd.Shuffle(len(shuffled), func(i, j int) { shuffled[i], shuffled[j] = shuffled[j], shuffled[i] })
	sort.SliceStable(shuffled, func(i, j int) bool { return shuffled[i].W > shuffled[j].W })

	n := 7
	if len(shuffled) < n {
		n = len(shuffled)
	}
	lines := make([]string, 0, n)
	for _, f := range shuffled[:n] {
		lines = append(lines, f.Text)
	}

	severity := 0
	for _, f := range all {
		severity += f.W
	}
	roastability := severity * 9 / 10
	if roastability > 100 {
		roastability = 100
	}
	for _, v := range verdicts {
		if severity < v.Max {
			return Roast{roastability, v.Label, v.Verdict, lines, len(all)}
		}
	}
	return Roast{roastability, "BIOHAZARD", verdicts[4].Verdict, lines, len(all)}
}

func comma(n int) string {
	s := fmt.Sprintf("%d", n)
	if len(s) <= 3 {
		return s
	}
	return commaLeft(s[:len(s)-3]) + "," + s[len(s)-3:]
}

func commaLeft(s string) string {
	if len(s) <= 3 {
		return s
	}
	return commaLeft(s[:len(s)-3]) + "," + s[len(s)-3:]
}

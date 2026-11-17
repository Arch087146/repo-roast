package main

import (
	"testing"

	"github.com/Arch087146/repo-roast/internal/roast"
)

func baseStats() *roast.Stats {
	return &roast.Stats{
		Name: "test-repo", Files: 20, Loc: 5000, Langs: map[string]int{".js": 5000},
		Todos: 10, DeadCode: 3, Largest: roast.FileSize{File: "big.js", Loc: 200},
		HasTests: true, HasReadme: true, HasLicense: true, HasCI: true, HasGitignore: true,
		Commits: 50, Authors: 2, AvgMsgLen: 40,
	}
}

func TestCleanRepoIsMild(t *testing.T) {
	r := roast.RoastRepo(baseStats())
	if len(r.Lines) == 0 {
		t.Fatal("should always find something to roast")
	}
	if r.Tier != "OK, FINE" || r.Roastability >= 10 {
		t.Fatalf("clean repo should be mild, got tier=%s score=%d", r.Tier, r.Roastability)
	}
}

func TestDeterministic(t *testing.T) {
	a := roast.RoastRepo(baseStats())
	b := roast.RoastRepo(baseStats())
	if a.Roastability != b.Roastability || a.Tier != b.Tier {
		t.Fatal("same stats must produce same roast")
	}
	for i := range a.Lines {
		if a.Lines[i] != b.Lines[i] {
			t.Fatal("lines diverged")
		}
	}
}

func TestWorstRepoIsBiohazard(t *testing.T) {
	st := baseStats()
	st.Files, st.Loc = 50, 20000
	st.Todos, st.DeadCode, st.Evals, st.EmptyCatch, st.TsAny = 120, 40, 5, 3, 30
	st.Largest = roast.FileSize{File: "index.js", Loc: 2500}
	st.Top3Share = 0.9
	st.WeirdNames = []string{"final2.js", "copy of final.js"}
	st.EnvCommitted, st.NodeModulesCommitted = true, true
	st.HasTests, st.HasReadme, st.HasLicense, st.HasCI, st.HasGitignore = false, false, false, false, false
	st.Commits, st.Authors, st.AvgMsgLen = 400, 1, 6
	st.FunnyMsgs = []string{"wip", "asdf"}
	st.RevertCount, st.CurseWords = 9, 12
	st.Deps = &roast.Deps{Count: 300, Kind: "package.json"}

	r := roast.RoastRepo(st)
	if r.Tier != "BIOHAZARD" || r.Roastability != 100 {
		t.Fatalf("expected BIOHAZARD/100, got %s/%d", r.Tier, r.Roastability)
	}
}

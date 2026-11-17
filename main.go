// repo-roasted — an AI that roasts your codebase.
// Compiled Go edition: no runtime, no interpreter, single binary.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/Arch087146/repo-roast/internal/ai"
	"github.com/Arch087146/repo-roast/internal/roast"
	"github.com/Arch087146/repo-roast/internal/ui"
)

const version = "1.0.0"

var valueFlags = map[string]bool{"--author": true, "--since": true, "--md": true, "--model": true, "--dir": true}

var positional []string

func extractPositionals() {
	args := os.Args[1:]
	var rest []string
	for i := 0; i < len(args); i++ {
		a := args[i]
		if strings.HasPrefix(a, "-") && a != "-" {
			rest = append(rest, a)
			if valueFlags[a] && i+1 < len(args) && !strings.HasPrefix(args[i+1], "-") {
				rest = append(rest, args[i+1])
				i++
			}
			continue
		}
		positional = append(positional, a)
	}
	os.Args = append([]string{os.Args[0]}, rest...)
}

func main() {
	extractPositionals()
	smart := flag.Bool("smart", false, "LLM-powered roast (OpenRouter or OpenAI)")
	model := flag.String("model", "", "LLM model id override (e.g. openai/gpt-4o-mini)")
	jsonOut := flag.Bool("json", false, "machine-readable output")
	md := flag.String("md", "", "write markdown roast to file")
	flag.Usage = usage
	flag.Parse()

	root, _ := os.Getwd()
	if len(positional) > 0 {
		root = positional[0]
	}
	root, _ = filepath.Abs(root)

	if _, err := os.Stat(filepath.Join(root, ".git")); err != nil {
		fmt.Fprintf(os.Stderr, "✗ %q is not a git repository\n", root)
		os.Exit(1)
	}

	// no flags, real terminal → interactive TUI
	if !*smart && !*jsonOut && *md == "" && len(positional) == 0 && isTTY() {
		ui.Run(ui.Options{Root: root, Smart: *smart, Model: *model})
		return
	}

	st := roast.CollectStats(root)

	if *smart {
		res, err := ai.SmartRoast(st, *model)
		if err == nil && res != nil {
			if *jsonOut {
				json.NewEncoder(os.Stdout).Encode(map[string]any{
					"repo": st.Name, "provider": res.Provider, "model": res.Model, "roast": res.Text,
				})
			} else {
				fmt.Printf("\n🔥 ROASTING %q (by %s · %s)\n\n%s\n", st.Name, res.Provider, res.Model, res.Text)
			}
			if *md != "" {
				os.WriteFile(*md, []byte(res.Text), 0o644)
			}
			return
		}
		if err != nil {
			fmt.Fprintf(os.Stderr, "LLM roast failed (%v) — roasting offline instead\n", err)
		} else {
			fmt.Fprintln(os.Stderr, "No LLM key (set OPENROUTER_API_KEY or OPENAI_API_KEY) — roasting offline instead")
		}
	}

	r := roast.RoastRepo(st)

	if *jsonOut {
		json.NewEncoder(os.Stdout).Encode(r)
	} else {
		fmt.Printf("\n🔥 ROASTING %q 🔥\n", st.Name)
		fmt.Printf("roastability %d/100 · tier: %s · %d findings\n\n", r.Roastability, r.Tier, r.EvidenceCount)
		for _, l := range r.Lines {
			fmt.Printf("→ %s\n", l)
		}
		fmt.Printf("\n%s\n\n", bold(r.Verdict))
	}

	if *md != "" {
		var b strings.Builder
		fmt.Fprintf(&b, "# 🔥 Roast of %q\n\n> Roastability: **%d/100** · Tier: **%s** · %d findings\n\n",
			st.Name, r.Roastability, r.Tier, r.EvidenceCount)
		for _, l := range r.Lines {
			b.WriteString("- " + l + "\n")
		}
		b.WriteString("\n**" + r.Verdict + "**\n")
		os.WriteFile(*md, []byte(b.String()), 0o644)
	}
}

func bold(s string) string { return "\x1b[1m" + s + "\x1b[0m" }

func isTTY() bool {
	fi, err := os.Stdout.Stat()
	if err != nil {
		return false
	}
	return fi.Mode()&os.ModeCharDevice != 0
}

func usage() {
	fmt.Print(`repo-roasted — an AI that roasts your codebase (Go edition)

Usage: repo-roasted [dir] [flags]

Run with no flags in a terminal → interactive TUI.

  --smart           LLM-powered roast (OpenRouter or OpenAI)
  --model <id>      model override, e.g. openai/gpt-4o-mini
  --json            machine-readable output
  --md <file>       write markdown roast to file
  --help            this
`)
}

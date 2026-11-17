// Package ui — the interactive Bubble Tea application.
package ui

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/Arch087146/repo-roast/internal/ai"
	"github.com/Arch087146/repo-roast/internal/roast"
)

// ANSI helpers.
const (
	reset   = "\x1b[0m"
	bold    = "\x1b[1m"
	dim     = "\x1b[2m"
	red     = "\x1b[31m"
	green   = "\x1b[32m"
	yellow  = "\x1b[33m"
	magenta = "\x1b[35m"
	cyan    = "\x1b[36m"
)

func paint(code, s string) string { return code + s + reset }

var banner = []string{
	"  ╔═╗╦═╗╦═╗╦╦  ╔═╗╦═╗╔═╗╦ ╦╔═╗╦═╗",
	"  ║ ║╠╦╝╠╦╝║║  ║ ║╠╦╝║ ╦║ ║╚═╗╠╦╝",
	"  ╚═╝╩╚═╩╚═╩═╝╚═╝╩╚═╚═╝╚═╝╚═╝╩╚═",
}

const (
	stateSplash = iota
	stateMenu
	statePickRepo
	statePickModel
	stateScanning
	stateResults
)

type Options struct {
	Root  string
	Smart bool
	Model string
}

var scanMsgs = []string{
	"reading your commit messages…",
	"counting TODOs…",
	"measuring file shame…",
	"checking for empty catch blocks…",
	"looking for eval()…",
	"analyzing git history…",
	"consulting the elders…",
	"preparing judgement…",
}

var frames = []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}

type scanResult struct {
	stats *roast.Stats
	r     *roast.Roast
	llm   *ai.Result
	err   error
}

type model struct {
	opts     Options
	state    int
	sel      int
	input    string
	frame    int
	msgIdx   int
	reveal   int
	full     string
	res      scanResult
	scanErr  string
	quitting bool
	splash   int
	saved    string
}

type tickMsg struct{}
type scanDoneMsg scanResult

func tick(d time.Duration) tea.Cmd {
	return tea.Tick(d, func(time.Time) tea.Msg { return tickMsg{} })
}

// Run launches the TUI (blocking).
func Run(opts Options) {
	m := model{opts: opts, state: stateSplash}
	if _, err := tea.NewProgram(m, tea.WithAltScreen()).Run(); err != nil {
		fmt.Fprintln(os.Stderr, "tui error:", err)
		os.Exit(1)
	}
}

func (m model) Init() tea.Cmd { return tick(time.Millisecond * 90) }

func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch msg := msg.(type) {
	case tea.KeyMsg:
		switch msg.String() {
		case "ctrl+c":
			m.quitting = true
			return m, tea.Quit
		}
		switch m.state {
		case stateSplash:
			m.state = stateMenu
		case stateMenu:
			switch msg.String() {
			case "up", "k":
				m.sel = (m.sel + 4) % 5
			case "down", "j":
				m.sel = (m.sel + 1) % 5
			case "enter":
				return m, m.choose()
			case "q", "esc":
				m.quitting = true
				return m, tea.Quit
			}
		case statePickRepo, statePickModel:
			switch msg.String() {
			case "enter":
				return m, m.submitInput()
			case "backspace":
				if len(m.input) > 0 {
					m.input = m.input[:len(m.input)-1]
				}
			case "esc":
				m.state = stateMenu
				m.input = ""
			default:
				if len(msg.String()) == 1 {
					m.input += msg.String()
				}
			}
		case stateResults:
			if m.reveal < len(m.full) {
				m.reveal = len(m.full)
				return m, tick(time.Millisecond * 60)
			}
			switch msg.String() {
			case "s":
				m.saveMD()
				return m, nil
			case "enter", "q", "esc":
				m.state = stateMenu
				m.sel, m.reveal, m.saved = 0, 0, ""
			}
		}
		return m, nil

	case tickMsg:
		var d time.Duration
		switch m.state {
		case stateSplash:
			m.splash++
			if m.splash >= len(banner)+2 {
				m.state = stateMenu
			}
			d = time.Millisecond * 90
		case stateScanning:
			m.frame++
			if m.frame%3 == 0 {
				m.msgIdx++
			}
			d = time.Millisecond * 90
		case stateResults:
			if m.reveal < len(m.full) {
				m.reveal += 3
				d = time.Millisecond * 12
			} else {
				d = time.Millisecond * 200
			}
		default:
			d = time.Millisecond * 200
		}
		return m, tick(d)

	case scanDoneMsg:
		m.res = scanResult(msg)
		if m.res.err != nil {
			m.scanErr = m.res.err.Error()
			m.state = stateMenu
			return m, nil
		}
		m.scanErr = ""
		m.state = stateResults
		m.reveal = 0
		m.full = m.buildFull()
		return m, tick(time.Millisecond * 12)
	}
	return m, nil
}

func (m *model) choose() tea.Cmd {
	switch m.sel {
	case 0:
		return m.startScan(m.opts.Root, false, "")
	case 1:
		return m.startScan(m.opts.Root, true, "")
	case 2:
		m.state = statePickModel
		m.input = ""
	case 3:
		m.state = statePickRepo
		m.input = ""
	case 4:
		m.quitting = true
		return tea.Quit
	}
	return nil
}

func (m *model) submitInput() tea.Cmd {
	val := strings.TrimSpace(m.input)
	m.input = ""
	if m.state == statePickRepo {
		if val == "" {
			m.state = stateMenu
			return nil
		}
		root, _ := filepath.Abs(val)
		return m.startScan(root, false, "")
	}
	if val != "" {
		return m.startScan(m.opts.Root, true, val)
	}
	m.state = stateMenu
	return nil
}

func (m *model) startScan(root string, smart bool, modelOverride string) tea.Cmd {
	if _, err := os.Stat(filepath.Join(root, ".git")); err != nil {
		m.scanErr = fmt.Sprintf("%q is not a git repository", root)
		return nil
	}
	m.scanErr, m.saved = "", ""
	m.state = stateScanning
	m.frame, m.msgIdx = 0, 0
	work := func() tea.Msg {
		st := roast.CollectStats(root)
		if !smart {
			r := roast.RoastRepo(st)
			return scanDoneMsg{stats: st, r: &r}
		}
		res, err := ai.SmartRoast(st, modelOverride)
		if err != nil {
			r := roast.RoastRepo(st)
			return scanDoneMsg{stats: st, r: &r, err: err}
		}
		if res == nil {
			r := roast.RoastRepo(st)
			return scanDoneMsg{stats: st, r: &r, err: fmt.Errorf("no LLM key (set OPENROUTER_API_KEY or OPENAI_API_KEY)")}
		}
		return scanDoneMsg{stats: st, llm: res}
	}
	return tea.Batch(tick(time.Millisecond*90), work)
}

func (m *model) saveMD() {
	name := "repo"
	if m.res.stats != nil {
		name = m.res.stats.Name
	}
	file := filepath.Join(m.opts.Root, "ROAST.md")
	var b strings.Builder
	b.WriteString(fmt.Sprintf("# 🔥 Roast of %q\n\n", name))
	if m.res.llm != nil {
		b.WriteString("> roasted by " + m.res.llm.Provider + " · " + m.res.llm.Model + "\n\n")
		for _, l := range strings.Split(strings.TrimSpace(m.res.llm.Text), "\n") {
			b.WriteString(l + "\n")
		}
	} else if m.res.r != nil {
		b.WriteString(fmt.Sprintf("> Roastability: **%d/100** · Tier: **%s** · %d findings\n\n",
			m.res.r.Roastability, m.res.r.Tier, m.res.r.EvidenceCount))
		for _, l := range m.res.r.Lines {
			b.WriteString("- " + l + "\n")
		}
		b.WriteString("\n**" + m.res.r.Verdict + "**\n")
	}
	b.WriteString("\n<sub>generated by repo-roasted (Go edition)</sub>\n")
	if err := os.WriteFile(file, []byte(b.String()), 0o644); err != nil {
		m.saved = "✗ " + err.Error()
	} else {
		m.saved = "✔ saved → " + file
	}
}

// buildFull assembles the typewriter text for the results screen.
func (m *model) buildFull() string {
	var lines []string
	if m.res.llm != nil {
		lines = append(lines,
			paint(dim, fmt.Sprintf("roasted by %s · model: %s", m.res.llm.Provider, m.res.llm.Model)),
			"")
		for _, l := range strings.Split(strings.TrimSpace(m.res.llm.Text), "\n") {
			lines = append(lines, paint(red, "→ ")+l)
		}
	} else if m.res.r != nil {
		lines = append(lines, paint(dim, fmt.Sprintf("tier: %s · %d findings", m.res.r.Tier, m.res.r.EvidenceCount)))
		lines = append(lines, "")
		lines = append(lines, m.meterLine(m.res.r.Roastability))
		lines = append(lines, "")
		for _, l := range m.res.r.Lines {
			lines = append(lines, paint(red, "→ ")+l)
		}
		lines = append(lines, "")
		lines = append(lines, paint(bold, m.res.r.Verdict))
	}
	return strings.Join(lines, "\n")
}

func (m *model) meterLine(pct int) string {
	w := 30
	filled := pct * w / 100
	bar := strings.Repeat("█", filled) + strings.Repeat("░", w-filled)
	return fmt.Sprintf("roastability          %s %3d%%", paint(red, bar), pct)
}

func (m model) View() string {
	if m.quitting {
		return ""
	}
	var b strings.Builder

	switch m.state {
	case stateSplash:
		b.WriteString("\n\n")
		for i := 0; i < m.splash && i < len(banner); i++ {
			b.WriteString(paint(bold+magenta, banner[i]) + "\n")
		}
	case stateMenu:
		b.WriteString("\n")
		for _, l := range banner {
			b.WriteString(paint(bold+magenta, l) + "\n")
		}
		b.WriteString("\n  " + paint(dim, "the code reviewer with no manners") + "\n\n")
		items := []string{
			fmt.Sprintf("Roast current repo (%s)", filepath.Base(m.opts.Root)),
			"🔥 Roast with AI (--smart)",
			"🔥 Roast with AI — pick a model",
			"Roast another repo",
			"Exit",
		}
		for i, it := range items {
			if i == m.sel {
				b.WriteString(paint(bold+cyan, "  ❯ ")+paint(bold, it)+"\n")
			} else {
				b.WriteString("    " + paint(dim, it) + "\n")
			}
		}
		if m.scanErr != "" {
			b.WriteString("\n  " + paint(red, "✗ "+m.scanErr) + "\n")
		}
		b.WriteString("\n  " + paint(dim, "↑/↓ select · Enter confirm · q quit") + "\n")
	case statePickRepo:
		b.WriteString("\n  path to repo:\n\n  ❯ " + m.input + "▌\n\n  " + paint(dim, "Enter confirm · Esc back") + "\n")
	case statePickModel:
		b.WriteString("\n  model id (e.g. openai/gpt-4o-mini, qwen/qwen-2.5-72b-instruct):\n\n  ❯ " + m.input + "▌\n\n  " + paint(dim, "Enter confirm · Esc back") + "\n")
	case stateScanning:
		f := paint(cyan, frames[m.frame%len(frames)])
		msg := paint(dim, scanMsgs[m.msgIdx%len(scanMsgs)])
		b.WriteString("\n  " + f + " " + msg + "\n")
	case stateResults:
		b.WriteString("\n")
		b.WriteString(paint(bold+magenta, fmt.Sprintf("  🔥 ROASTING %q 🔥", m.res.stats.Name)) + "\n\n")
		b.WriteString(m.full[:min(m.reveal, len(m.full))])
		if m.reveal >= len(m.full) {
			b.WriteString("\n\n  " + paint(dim, "s save ROAST.md · Enter menu · q quit"))
			if m.saved != "" {
				col := green
				if strings.HasPrefix(m.saved, "✗") {
					col = red
				}
				b.WriteString("\n  " + paint(col, m.saved))
			}
		}
	}
	return b.String()
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

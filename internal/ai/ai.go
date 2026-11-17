// Package ai — optional LLM roast via OpenRouter or OpenAI.
package ai

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

	"github.com/Arch087146/repo-roast/internal/roast"
)

const (
	openrouterBase  = "https://openrouter.ai/api/v1"
	defaultModel    = "meta-llama/llama-3.1-8b-instruct:free"
	openAIBaseEnv   = "OPENAI_BASE_URL"
	defaultAIModel  = "gpt-4o-mini"
)

type provider struct {
	name, key, base, model string
}

func resolve(modelOverride string) *provider {
	if k := os.Getenv("OPENROUTER_API_KEY"); k != "" {
		m := modelOverride
		if m == "" {
			m = os.Getenv("OPENROUTER_MODEL")
		}
		if m == "" {
			m = defaultModel
		}
		return &provider{"OpenRouter", k, openrouterBase, m}
	}
	if k := os.Getenv("OPENAI_API_KEY"); k != "" {
		base := os.Getenv(openAIBaseEnv)
		if base == "" {
			base = "https://api.openai.com/v1"
		}
		m := modelOverride
		if m == "" {
			m = defaultAIModel
		}
		return &provider{"OpenAI", k, base, m}
	}
	return nil
}

type chatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type chatRequest struct {
	Model       string        `json:"model"`
	Messages    []chatMessage `json:"messages"`
	Temperature float64       `json:"temperature"`
}

type chatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

var client = &http.Client{Timeout: 90 * time.Second}

// Result is a successful LLM roast.
type Result struct {
	Text     string
	Provider string
	Model    string
}

// SmartRoast returns nil (no key) or the LLM's roast. Errors surface to caller.
func SmartRoast(st *roast.Stats, modelOverride string) (*Result, error) {
	p := resolve(modelOverride)
	if p == nil {
		return nil, nil
	}

	summary, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return nil, err
	}

	body, _ := json.Marshal(chatRequest{
		Model: p.model,
		Messages: []chatMessage{
			{Role: "system", Content: "You are a brutal but funny senior engineer roasting a repo. " +
				"Max 8 short punchy lines, then a one-line verdict starting with 'Verdict:'. " +
				"No markdown headers, no bullet symbols. Be cruel but never advise anything dangerous. " +
				"Reference the actual stats and commit messages where you can."},
			{Role: "user", Content: "Roast this repo:\n" + string(summary)},
		},
		Temperature: 1,
	})

	req, err := http.NewRequest("POST", p.base+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.key)
	if p.name == "OpenRouter" {
		req.Header.Set("HTTP-Referer", "https://github.com/Arch087146/repo-roast")
		req.Header.Set("X-Title", "repo-roasted")
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("%s HTTP %d", p.name, resp.StatusCode)
	}
	var cr chatResponse
	if err := json.NewDecoder(resp.Body).Decode(&cr); err != nil {
		return nil, err
	}
	if len(cr.Choices) == 0 {
		return nil, fmt.Errorf("%s returned no choices", p.name)
	}
	return &Result{Text: cr.Choices[0].Message.Content, Provider: p.name, Model: p.model}, nil
}

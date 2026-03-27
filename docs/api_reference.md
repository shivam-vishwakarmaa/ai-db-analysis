# API Reference

## OpenRouter API

- **Endpoint**: `https://openrouter.ai/api/v1/chat/completions`
- **Auth**: `Authorization: Bearer sk-or-v1-...`
- **Free tier**: 200 requests/day, no credit card

### Free Models (Priority Order)

| Priority | Model | Best For |
|----------|-------|----------|
| 1st | `meta-llama/llama-3.3-70b-instruct:free` | Everything |
| 2nd | `google/gemma-3-27b-it:free` | JSON generation |
| 3rd | `deepseek/deepseek-r1:free` | Complex reasoning |
| 4th | `mistralai/mistral-small-3.1-24b-instruct:free` | Fallback |

## Kroki.io (ER Diagrams)

- **Endpoint**: `POST https://kroki.io/mermaid/svg`
- **Auth**: None needed (free public API)
- **Input**: Mermaid syntax as plain text body
- **Output**: SVG image

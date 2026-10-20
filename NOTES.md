# Notes

Before changing anything, I ran the README questions against the original agent and read the tool traces. That gave me the order I worked in:

1. Some answers were wrong. The model did growth arithmetic itself and put Globex's FY21–24 CAGR at 2.3% (it's about 1.2%). A second "editor" call then rewrote each answer with the whole transcript in hand, which let it change numbers and add narrative no tool returned, like Acme Robotics "riding the same automation/reshoring tailwind." For analysts, a wrong number costs more than a slow one, so I started here.
2. Answers took 21–34s, and the UI showed "Thinking…" the whole time.
3. Lookups by ticker or lowercase name ("GLBX", "acme") failed, tool failures weren't marked as errors, and the Umbrella risks question took 8 searches.
4. There were no tests or eval, so I had no way to show any of this improved.

## Before and after

Same questions, live model:

| | Before | After |
| --- | --- | --- |
| Latency per question | 21–34s, nothing shown until done | 7–20s, with progress and the answer streaming in |
| Model calls per question | iterations plus 1 editor call | iterations only (2 for each README question) |
| Umbrella risks question | 4 iterations, 8 searches | 2 iterations, 2 tool calls |
| Growth and margin figures | computed by the model (Globex CAGR wrong) | computed in code |
| Citations | none | each figure cites a doc id or `[financials]` |
| Follow-up questions | no context; each request stood alone | earlier answers sent as context |

`npm run eval` runs 7 cases and checks each answer for the facts and caveats it should contain: both Acmes mentioned, Initech's FY2025 flagged as preliminary, a company outside coverage declined with no made-up numbers, and so on. All 7 pass.

## What changed

### Correctness

- I removed the editor pass. The model that does the research now writes the answer.
- `getFinancials` returns YoY growth, CAGR and operating/net/FCF margins, and the prompt tells the model to quote them. CAGR stops at the last filed year, so Initech's unfiled FY2025 never feeds into it. I dropped checksums and pipeline versions from the payload and kept restatements and warnings.
- The new system prompt asks for a source on every figure. It also asks the model to call out unfiled or preliminary periods, acquisition-driven growth and mismatched periods, to say when a name is ambiguous, to decline companies outside coverage, and not to offer follow-ups the tools can't do.

### Agent loop

- Tool calls from one turn run in parallel, so five `getFinancials` calls take about 0.8s instead of about 4s.
- Failed tool calls come back with `is_error: true` and a message saying how to recover. "Acme" returns an ambiguity error listing both companies. Tool inputs are validated.
- Tools accept tickers, any case, partial names and corporate suffixes. A ticker only matches in caps: "ACME" is Acme Corp, and "acme" is ambiguous.
- `searchDocuments` with an empty query lists all of a company's documents, since the index is tiny, and the schema description states the 6-term limit. That change took the risks question from 8 searches down to 1.
- I lowered the step budget from 12 to 8. The last step runs with `tool_choice: none`, so the model answers from what it has. The old code threw that research away and returned a canned message. `max_tokens` and `refusal` stop reasons are now handled explicitly.
- The tools and system prompt are prompt-cached, since every iteration sends them again.

### Product

- `/api/chat` streams NDJSON. The UI lists each lookup as it runs, streams the answer text, then collapses the steps into a line like "Researched with 3 lookups · 8.7s".
- Follow-ups send the earlier answers as context. The server validates the history and caps its length.
- Answers render as markdown, including tables. There's a Stop button (it also aborts the model call on the server), plus Retry, New chat, and error messages written for the analyst.

### Engineering

- The loop takes a one-method `ModelClient`, so tests can script the model's replies. There are 27 unit tests covering tool resolution and arithmetic, parallel execution, `is_error`, the step budget, conversation history and request validation.
- The server logs one line per request with latency, iterations, tool calls, tokens and cache hits.

## What I left alone

- The agent doesn't stop to ask which Acme you meant. It covers both or says which one it assumed. With 5 companies, covering both costs one extra parallel call. With a real coverage list I'd add "Did you mean…" options in the UI.
- Follow-ups carry the earlier answers but not the earlier tool results. Context stays small, and a follow-up may fetch the same data again, which is cheap here.
- The quarterly figures are annual revenue split by fixed seasonality weights, so they can't support quarter-over-quarter conclusions. That's a data problem and I didn't touch it, but the model should be told.
- The eval is small. It runs each case once and matches strings; it doesn't grade reasoning. Next I'd run each case several times and add an LLM judge that checks every number in the answer against the tool outputs.
- No auth, rate limiting or saved conversations. I left the `ROGO_MODEL` default as it was.
- I tested the UI in headless Chrome: steps and text stream through the Vite proxy, follow-ups carry history, tables render, and Stop aborts on the server. I didn't check the mobile layout.

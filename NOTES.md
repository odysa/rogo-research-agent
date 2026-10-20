# Implementation notes

**Priority: reliable financial answers, then less waiting.** The initial version took approximately
80 minutes in total, with AI coding tools assisting implementation
and review. A later pass redesigned the chat UI; it is additional work.

## What I found and changed

- **Incorrect arithmetic and unsupported rewriting.** An original trial gave Globex's FY2021–24 CAGR as 2.3%; the data implies about 1.2%. [Financial tools](src/tools.ts) now compute growth and margins, with periods attached. I removed the extra editor model call so it cannot rewrite researched numbers or add narrative afterward. FY2021–25 CAGR is a different comparison: 1.4%.
- **Slow, opaque research.** The [agent loop](src/agent.ts) runs independent read-only lookups in parallel, returns recoverable tool errors, and reserves its eighth/final turn for an answer. Company lookup handles tickers and ambiguity; company-scoped document listing avoids repeated keyword guesses.
- **A blank waiting screen.** The [UI](src/ui/App.tsx) shows lookup progress, streams answers, renders tables and supports follow-ups, Stop and Retry. The later UI pass adds a coverage sidebar, a persistent multiline composer, drafting during research and scroll behavior that respects reading older messages. [The API](src/server.ts) validates history and aborts the model request on disconnect.
- **Misleading data interpretation.** Tool warnings and the system prompt flag preliminary periods and synthetic quarterly allocations. Synthetic quarters must not be treated as actual business momentum. Answers are instructed to cite their sources.

## Evidence

- `npm test`: **27/27 passing**; `npm run typecheck`: **passing**. Tests cover calculations, data warnings, resolution, parallel execution, tool errors, stopping behavior, history and input validation.
- `npm run eval`: **8/8 live cases, 22/22 checks passing** in the final run. Cases include ambiguous names, preliminary results, follow-ups, out-of-coverage questions and synthetic quarters. These are heuristic string checks, not verification of every claim.
- Earlier single trials of the README questions took **21–34s before / 7–20s after**; these are observations, not a controlled benchmark. Removing the editor saves one model call. Five parallel mocked financial lookups take roughly 0.8s rather than 4s sequentially.
- UI checks exercised streaming, follow-ups, tables and cancellation. The redesigned UI was additionally checked with a local mock NDJSON server for multi-turn history, Stop/Retry and responsive layout; the production client build passes. Earlier review checked invalid requests through the API and Vite proxy. Use the [reviewer walkthrough](README.md#reviewer-walkthrough) to try the behavior.

## Deliberate limits

- Follow-ups retain prior answers, not tool results; repeated lookups are acceptable for this small local dataset. Ambiguous questions cover both companies or state an assumption instead of opening a selection UI.
- Citation correctness is not mechanically enforced. Next I would evaluate repeated runs and check individual claims against tool evidence, rather than add more features.
- No authentication, persistence, rate limiting or general tool-concurrency cap: this remains a local exercise.

The topical commits were reorganized after implementation; their timestamps record
that cleanup, not elapsed development time.

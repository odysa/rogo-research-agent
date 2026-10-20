# Notes

Time spent: approximately 80 minutes, using AI coding tools for implementation and review.

Start with `src/tools.ts` (financial calculations and data caveats) and
`src/agent.ts` (research loop and stopping behavior).

## Priorities and changes

- Correctness came first. In the original trial, the answer gave Globex's FY2021–24 CAGR as 2.3%; the data implies about 1.2%. Growth and margins are now computed in code, with periods attached. The current FY2021–25 CAGR is a different comparison: 1.4%.
- Removed the extra editor model call, which could change numbers and add unsupported narrative after research. The researching model now answers directly, with instructions to cite sources and distinguish preliminary results, restatements and acquisition-driven growth.
- Marked quarterly figures as synthetic allocations of annual data. The agent must not interpret them as reported quarterly momentum; added a tool-output assertion and a live evaluation case for this boundary.
- Company resolution accepts exact tickers, partial names and corporate suffixes; ambiguous names return recoverable errors rather than silently choosing a company. Uppercase `ACME` is a ticker; lowercase `acme` is ambiguous.
- Independent read-only tools run concurrently. Failed calls use `is_error`; an empty company-scoped document query lists available documents. The eight-step model budget reserves the final step for an answer from available evidence.
- The UI streams lookup progress and answer text, renders markdown, carries prior answers into follow-ups, and supports Stop/Retry. Disconnecting aborts the model request. The server validates and bounds conversation input and logs request usage.

## Verification

- `npm test`: 27 passing tests covering financial calculations, data warnings, company resolution, parallel tools, tool errors, stopping behavior, history and request validation. `npm run typecheck` passes.
- `npm run eval`: eight live cases check selected facts, citations and caveats, including synthetic quarterly data. Final run: 8/8 cases, 22/22 checks passed (2026-10-19); per-case latency 2.6–18.8 seconds. These string checks are a regression aid, not a proof of answer correctness.
- Earlier single trials of the README questions took 21–34 seconds before and 7–20 seconds after; these are observations, not a controlled benchmark. Removing the editor eliminates one model call; parallelizing five mocked financial lookups reduces their tool wait from roughly 4 seconds to 0.8 seconds.
- Earlier UI checks exercised streaming, follow-ups, tables and cancellation. Final review also checked desktop/narrow-screen layout and invalid requests through both the server and Vite proxy.

## Deliberate limits

- Follow-ups retain prior answers, not prior tool results; repeated lookups remain possible. For five local companies this is acceptable. Ambiguous questions cover both companies or state the assumption rather than presenting a selection UI.
- Citations are requested by the prompt, not mechanically verified. The small, single-run eval cannot establish reliable grounding or catch every incorrect numerical claim. A next evaluation would check each claim against its source across repeated runs.
- No auth, rate limiting, persistence or general tool-concurrency limit was added. This remains a local exercise, not a production service.
- AI coding tools/agents assisted implementation and review. The final topical commits were reorganized after implementation; their timestamps record that cleanup, not elapsed development time.

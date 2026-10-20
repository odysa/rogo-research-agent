# Coding agent guidance

This is a small Rogo take-home exercise, not a production financial service. Prefer
focused changes that improve answer correctness and analyst usability. See
[NOTES.md](NOTES.md) for decisions, evidence and deliberate limits.

## Project map

- `src/tools.ts`: tool schemas, company resolution, deterministic financial metrics.
- `src/data.ts`: five fictional companies and mocked research data.
- `src/agent.ts`: model adapter, prompt, parallel read-only tools, bounded research loop.
- `src/server.ts`, `src/validate.ts`: streaming API, cancellation and request validation.
- `src/ui/App.tsx`, `src/ui/api.ts`: chat UI and NDJSON stream handling.
- `src/*.test.ts`: offline regression tests; `scripts/eval.ts`: live model checks.

## Working conventions

- Keep financial calculations in tools; preserve source periods, warnings and restatements.
- Quarterly figures are synthetic allocations. Never present them as reported quarterly performance.
- Preserve recoverable tool errors, company ambiguity handling and the final-answer step budget.
- Parallel execution is appropriate for these independent read-only tools. Reconsider dependencies and side effects before adding tools.
- Preserve stream cancellation and terminal `done`/`error` events when changing the API.
- Never commit `.env`, API keys or captured credentials. Do not print secrets in logs.
- Do not add `Co-Authored-By` trailers to commits.

## Validation

Use Node 22.12+ on the Node 22 line, or Node 24. Install with `npm ci`.

```sh
npm test
npm run typecheck
```

For changes to prompts, tool results or answer behavior, run `npm run eval` when
live API use is authorized. It requires `ANTHROPIC_API_KEY` in `.env`, calls the
real model and incurs API usage. Do not substitute a passing string-match eval
for manual review of answer correctness. For UI/streaming changes, also exercise
progress, follow-ups, Stop and Retry with `npm run dev`.

Keep NOTES short and update it when behavior, evidence or limitations change.
Do not invent benchmark results or elapsed work time. Pushes, history rewrites
and repository visibility changes need the repository owner's authorization.

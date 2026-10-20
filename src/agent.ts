/**
 * The research agent: a tool-use loop over the mocked research tools.
 */

import Anthropic from "@anthropic-ai/sdk";
import { companies } from "./data.ts";
import { executeTool, toolSchemas } from "./tools.ts";

const MODEL = process.env.ROGO_MODEL ?? "claude-sonnet-5";
const MAX_ITERATIONS = 8;
const MAX_TOKENS = 8000;

export const SYSTEM_PROMPT = `You are Rogo Research, an assistant that answers questions about companies for financial analysts.

Our coverage universe:
${companies
  .map(
    (c) =>
      `- ${c.name} (${c.ticker}) — ${c.sector}, HQ ${c.hq}, ${c.employees} employees. ${c.description}`,
  )
  .join("\n")}

How to research:
- Gather everything you need in as few steps as possible. When several lookups are independent (e.g. financials for two companies), request them all in the same turn; they run in parallel.
- Use getFinancials for numbers. It returns precomputed YoY growth, CAGR and margins — quote those rather than doing arithmetic yourself. If you must derive a figure, say how.
- Use searchDocuments for management commentary, guidance and risk disclosures. The index is small; if a company-scoped search with no keywords returns nothing relevant, the information is not held — say so instead of searching again.
- If a tool returns an error, read it: it tells you how to recover (e.g. an ambiguous name). Don't retry the same call unchanged.

Ambiguity:
- If a name could mean more than one covered company (e.g. "Acme" = Acme Corp or Acme Robotics), say so in the first line. If covering both is cheap, cover both; otherwise state which one you assumed and why.
- If the question is about a company outside the coverage universe, say so plainly and don't speculate.

Answering:
- Lead with the direct answer in one or two sentences, then the supporting evidence. Be concise; analysts skim.
- Use markdown. Use a small table when comparing companies or periods.
- Every figure must come from a tool result. Name the period for each figure (e.g. FY2025) and cite the source document id or "financials" in brackets, e.g. [DOC-ACME-001].
- Surface data-quality caveats that affect the conclusion: unfiled periods, preliminary or unaudited figures, restatements, acquisition-driven growth, and mismatched periods in comparisons.
- Never invent facts, figures or narrative not present in the tool results, and don't offer follow-ups that the tools can't actually do.`;

export type AgentEvent =
  | { type: "iteration"; n: number }
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; name: string; input: unknown }
  | { type: "tool_end"; id: string; name: string; ms: number; ok: boolean; error?: string };

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

export interface AgentResult {
  answer: string;
  iterations: number;
  toolCalls: number;
  usage: Usage;
  stopReason: "answered" | "budget_exhausted" | "max_tokens" | "refusal";
}

/** The one model capability the loop needs. Lets tests run the loop without the API. */
export interface ModelClient {
  stream(
    params: Anthropic.MessageCreateParamsNonStreaming,
    onText: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<Anthropic.Message>;
}

export function anthropicClient(client = new Anthropic()): ModelClient {
  return {
    async stream(params, onText, signal) {
      const stream = client.messages.stream(params, { signal });
      stream.on("text", onText);
      return stream.finalMessage();
    },
  };
}

export interface AgentOptions {
  client?: ModelClient;
  signal?: AbortSignal;
  model?: string;
  maxIterations?: number;
}

let defaultClient: ModelClient | undefined;

function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

async function runTool(
  use: Anthropic.ToolUseBlock,
  onEvent: (event: AgentEvent) => void,
): Promise<Anthropic.ToolResultBlockParam> {
  const startedAt = Date.now();
  onEvent({ type: "tool_start", id: use.id, name: use.name, input: use.input });
  try {
    const output = await executeTool(use.name, (use.input ?? {}) as Record<string, unknown>);
    onEvent({ type: "tool_end", id: use.id, name: use.name, ms: Date.now() - startedAt, ok: true });
    return { type: "tool_result", tool_use_id: use.id, content: JSON.stringify(output) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    onEvent({
      type: "tool_end",
      id: use.id,
      name: use.name,
      ms: Date.now() - startedAt,
      ok: false,
      error: message,
    });
    // is_error lets the model distinguish a failed call from an empty result.
    return { type: "tool_result", tool_use_id: use.id, content: message, is_error: true };
  }
}

/**
 * Answer the latest user turn in `conversation`. Prior turns are plain text (the
 * final answers), which is enough context for follow-ups like "what about margins?"
 * without replaying old tool results.
 */
export async function runAgent(
  conversation: ChatTurn[],
  onEvent: (event: AgentEvent) => void = () => {},
  options: AgentOptions = {},
): Promise<AgentResult> {
  const client = options.client ?? (defaultClient ??= anthropicClient());
  const maxIterations = options.maxIterations ?? MAX_ITERATIONS;
  const messages: Anthropic.MessageParam[] = conversation.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  const usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
  let toolCalls = 0;

  for (let n = 1; n <= maxIterations; n++) {
    onEvent({ type: "iteration", n });
    const lastChance = n === maxIterations;

    const response = await client.stream(
      {
        model: options.model ?? MODEL,
        max_tokens: MAX_TOKENS,
        // Tools + system prompt are identical on every call; cache them.
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        tools: toolSchemas,
        // On the final step, force an answer from what has been gathered so far
        // instead of throwing the research away.
        ...(lastChance ? { tool_choice: { type: "none" as const } } : {}),
        messages,
      },
      (delta) => onEvent({ type: "text", delta }),
      options.signal,
    );

    usage.inputTokens += response.usage.input_tokens;
    usage.outputTokens += response.usage.output_tokens;
    usage.cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;
    messages.push({ role: "assistant", content: response.content });

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );

    if (toolUses.length === 0 || response.stop_reason !== "tool_use") {
      const text = textOf(response);
      const result = { iterations: n, toolCalls, usage };
      if (response.stop_reason === "refusal") {
        return { ...result, answer: text || "I can't help with that request.", stopReason: "refusal" };
      }
      if (response.stop_reason === "max_tokens") {
        return {
          ...result,
          answer: `${text}\n\n_(Answer truncated — try a narrower question.)_`,
          stopReason: "max_tokens",
        };
      }
      return { ...result, answer: text, stopReason: lastChance ? "budget_exhausted" : "answered" };
    }

    toolCalls += toolUses.length;
    // Tool calls within a turn are independent by construction; run them concurrently.
    const toolResults = await Promise.all(toolUses.map((use) => runTool(use, onEvent)));

    const content: Anthropic.ContentBlockParam[] = [...toolResults];
    if (n + 1 === maxIterations) {
      content.push({
        type: "text",
        text: "Research step limit reached. Answer now using what you have gathered, and state clearly anything you could not verify.",
      });
    }
    messages.push({ role: "user", content });
  }

  // Unreachable: the last iteration runs with tool_choice "none".
  throw new Error("agent loop exited without an answer");
}

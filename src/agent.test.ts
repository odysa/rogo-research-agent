import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { runAgent, type AgentEvent, type ModelClient } from "./agent.ts";

type Block = Anthropic.TextBlock | Anthropic.ToolUseBlock;

const text = (t: string) => ({ type: "text", text: t, citations: null }) as Anthropic.TextBlock;
const tool = (id: string, name: string, input: object) =>
  ({ type: "tool_use", id, name, input }) as Anthropic.ToolUseBlock;

function message(content: Block[]): Anthropic.Message {
  return {
    id: "msg",
    type: "message",
    role: "assistant",
    model: "test",
    content,
    stop_reason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  } as Anthropic.Message;
}

/** A model that replays scripted turns and records every request it receives. */
function scripted(turns: Block[][]) {
  const requests: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const client: ModelClient = {
    async stream(params, onText) {
      // Snapshot: the loop mutates its messages array after each call.
      requests.push(structuredClone(params));
      const next = turns[requests.length - 1] ?? [text("(no more turns)")];
      for (const b of next) if (b.type === "text") onText(b.text);
      return message(next);
    },
  };
  return { client, requests };
}

const ask = (q: string) => [{ role: "user" as const, content: q }];

describe("runAgent", () => {
  it("returns the model's answer directly, with no extra editing call", async () => {
    const { client, requests } = scripted([
      [tool("t1", "getFinancials", { company: "Acme Corp" })],
      [text("Acme grew 5.5% in FY2025.")],
    ]);
    const result = await runAgent(ask("How fast is Acme Corp growing?"), undefined, { client });
    expect(result.answer).toBe("Acme grew 5.5% in FY2025.");
    expect(result.stopReason).toBe("answered");
    expect(requests).toHaveLength(2);
  });

  it("runs tool calls from one turn concurrently", async () => {
    const { client } = scripted([
      [
        tool("a", "getFinancials", { company: "Acme Corp" }),
        tool("b", "getFinancials", { company: "Globex Inc" }),
        tool("c", "getFinancials", { company: "Initech" }),
      ],
      [text("done")],
    ]);
    const started = Date.now();
    await runAgent(ask("compare"), undefined, { client });
    // Each getFinancials call takes ~800ms; sequential would be ~2400ms.
    expect(Date.now() - started).toBeLessThan(1600);
  });

  it("marks failed tool calls as errors so the model can recover", async () => {
    const events: AgentEvent[] = [];
    const { client, requests } = scripted([
      [tool("t1", "getFinancials", { company: "Acme" })],
      [text("Which Acme?")],
    ]);
    await runAgent(ask("Acme financials"), (e) => events.push(e), { client });

    const toolTurn = requests[1].messages.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    expect(toolTurn[0]).toMatchObject({ tool_use_id: "t1", is_error: true });
    expect(String(toolTurn[0].content)).toMatch(/ambiguous/);
    expect(events).toContainEqual(expect.objectContaining({ type: "tool_end", ok: false }));
  });

  it("forces a final answer instead of discarding research when the step budget runs out", async () => {
    const loop = [tool("x", "searchCompanies", { query: "" })];
    const { client, requests } = scripted([loop, loop, [text("Best answer with what I have.")]]);
    const result = await runAgent(ask("anything"), undefined, { client, maxIterations: 3 });

    expect(result.answer).toBe("Best answer with what I have.");
    expect(result.stopReason).toBe("budget_exhausted");
    expect(requests[0].tool_choice).toBeUndefined();
    expect(requests[2].tool_choice).toEqual({ type: "none" });
    const lastUserTurn = requests[2].messages.at(-1)!.content as Anthropic.ContentBlockParam[];
    expect(lastUserTurn.at(-1)).toMatchObject({ type: "text", text: expect.stringMatching(/step limit/) });
  });

  it("passes prior turns through so follow-ups have context", async () => {
    const { client, requests } = scripted([[text("Margins were 38%.")]]);
    await runAgent(
      [
        { role: "user", content: "How is Acme Corp doing?" },
        { role: "assistant", content: "Growing 5.5%." },
        { role: "user", content: "And margins?" },
      ],
      undefined,
      { client },
    );
    expect(requests[0].messages.map((m) => m.content)).toEqual([
      "How is Acme Corp doing?",
      "Growing 5.5%.",
      "And margins?",
    ]);
  });
});

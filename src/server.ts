import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import { runAgent, type AgentEvent } from "./agent.ts";
import { parseConversation } from "./validate.ts";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error(
    "\nANTHROPIC_API_KEY is not set.\nCopy .env.example to .env and add your key, then run `npm run dev` again.\n",
  );
  process.exit(1);
}

function userFacingError(err: unknown): string {
  if (err instanceof Anthropic.APIError) {
    if (err.status === 401) return "The model API rejected our credentials. Check ANTHROPIC_API_KEY.";
    if (err.status === 429) return "We're being rate limited by the model API. Please try again in a moment.";
    if (err.status === 529 || (err.status ?? 0) >= 500) return "The model API is temporarily unavailable. Please try again.";
  }
  return "Something went wrong while researching that. Please try again.";
}

function logEvent(event: AgentEvent) {
  switch (event.type) {
    case "iteration":
      console.log(`[agent] iteration ${event.n}`);
      break;
    case "tool_start":
      console.log(`[tool]  → ${event.name} ${JSON.stringify(event.input)}`);
      break;
    case "tool_end":
      console.log(
        `[tool]  ${event.ok ? "←" : "!"} ${event.name} (${event.ms}ms)${event.error ? `: ${event.error}` : ""}`,
      );
      break;
  }
}

const app = express();
app.use(express.json({ limit: "256kb" }));

/**
 * Streams newline-delimited JSON: agent events as they happen, then exactly one
 * terminal `done` or `error` event.
 */
app.post("/api/chat", async (req, res) => {
  const conversation = parseConversation(req.body);
  if (typeof conversation === "string") {
    res.status(400).json({ error: conversation });
    return;
  }

  console.log(`\n[chat] ${conversation.at(-1)!.content} (${conversation.length} turns)`);
  const startedAt = Date.now();

  // Stop spending tokens if the analyst navigates away or cancels.
  const controller = new AbortController();
  res.on("close", () => {
    if (!res.writableEnded) controller.abort();
  });

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  res.flushHeaders();
  const send = (payload: object) => res.write(`${JSON.stringify(payload)}\n`);

  try {
    const result = await runAgent(
      conversation,
      (event) => {
        logEvent(event);
        send(event);
      },
      { signal: controller.signal },
    );
    const ms = Date.now() - startedAt;
    console.log(
      `[done]  ${ms}ms, ${result.iterations} iterations, ${result.toolCalls} tool calls, ` +
        `${result.usage.inputTokens} in / ${result.usage.outputTokens} out tokens ` +
        `(${result.usage.cacheReadTokens} cached), ${result.stopReason}`,
    );
    send({ type: "done", answer: result.answer, stopReason: result.stopReason, ms });
  } catch (err) {
    if (controller.signal.aborted) {
      console.log("[chat] client disconnected; aborted");
    } else {
      console.error(err);
      send({ type: "error", message: userFacingError(err) });
    }
  } finally {
    res.end();
  }
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`Agent server listening on http://localhost:${port}`);
});

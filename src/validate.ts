import type { ChatTurn } from "./agent.ts";

const MAX_TURNS = 20;
const MAX_CHARS = 8000;

/** Validate the client-supplied conversation; returns an error string or the turns. */
export function parseConversation(body: unknown): ChatTurn[] | string {
  const turns = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(turns) || turns.length === 0) return "messages must be a non-empty array";
  const recent = turns.slice(-MAX_TURNS);
  for (const t of recent) {
    if ((t?.role !== "user" && t?.role !== "assistant") || typeof t?.content !== "string") {
      return "each message needs a role of user|assistant and string content";
    }
    if (t.content.length > MAX_CHARS) return `messages are limited to ${MAX_CHARS} characters`;
  }
  // The API requires the conversation to start with a user turn and end on one.
  while (recent.length && recent[0].role !== "user") recent.shift();
  if (recent.at(-1)?.role !== "user" || !recent.at(-1).content.trim()) {
    return "the last message must be a non-empty user message";
  }
  return recent as ChatTurn[];
}

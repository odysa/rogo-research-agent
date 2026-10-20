/** Client for the streaming /api/chat endpoint. */

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export type ServerEvent =
  | { type: "iteration"; n: number }
  | { type: "text"; delta: string }
  | { type: "tool_start"; id: string; name: string; input: Record<string, unknown> }
  | { type: "tool_end"; id: string; name: string; ms: number; ok: boolean; error?: string }
  | { type: "done"; answer: string; stopReason: string; ms: number }
  | { type: "error"; message: string };

/** Split a stream of text chunks into complete NDJSON lines; returns the leftover partial line. */
export function splitLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((l) => l.trim()), rest };
}

export async function streamChat(
  messages: ChatTurn[],
  onEvent: (event: ServerEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    signal,
  });

  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `The server responded with ${res.status}.`);
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let finished = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const { lines, rest } = splitLines(buffer + value);
    buffer = rest;
    for (const line of lines) {
      const event = JSON.parse(line) as ServerEvent;
      if (event.type === "done" || event.type === "error") finished = true;
      onEvent(event);
    }
  }
  if (!finished) throw new Error("The connection closed before the answer was finished.");
}

/** Human-readable label for a tool call, shown in the progress list. */
export function describeTool(name: string, input: Record<string, unknown>): string {
  const company = typeof input.company === "string" ? input.company : undefined;
  const query = typeof input.query === "string" ? input.query : "";
  switch (name) {
    case "searchCompanies":
      return query ? `Searching companies for “${query}”` : "Listing covered companies";
    case "getCompanyProfile":
      return `Reading profile · ${company}`;
    case "getFinancials":
      return `Pulling financials · ${company}`;
    case "searchDocuments":
      return [
        "Searching documents",
        company && `· ${company}`,
        query && `for “${query}”`,
      ]
        .filter(Boolean)
        .join(" ");
    default:
      return name;
  }
}

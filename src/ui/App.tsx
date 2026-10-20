import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { describeTool, streamChat, type ChatTurn } from "./api.ts";

interface Step {
  id: string;
  label: string;
  state: "running" | "ok" | "failed";
  ms?: number;
  error?: string;
}

interface Message {
  role: "user" | "assistant";
  text: string;
  status: "streaming" | "done" | "error";
  steps: Step[];
  ms?: number;
}

const EXAMPLES = [
  "Compare Acme and Globex and tell me which one appears to be growing faster.",
  "What are the biggest risks Umbrella Health flags in its filings?",
  "How is Initech's subscription transition going?",
  "Which company in the universe is growing fastest?",
];

export function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const busy = messages.at(-1)?.status === "streaming";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  /** Apply an update to the in-flight assistant message (always the last one). */
  function updateLast(fn: (m: Message) => Message) {
    setMessages((prev) => [...prev.slice(0, -1), fn(prev[prev.length - 1])]);
  }

  async function send(question: string, prior: Message[] = messages) {
    if (!question.trim() || busy) return;

    // Only completed exchanges go back as context; failed attempts are dropped.
    const history: ChatTurn[] = [];
    for (let i = 0; i + 1 < prior.length; i += 2) {
      const [q, a] = [prior[i], prior[i + 1]];
      if (a.status === "done") {
        history.push({ role: "user", content: q.text }, { role: "assistant", content: a.text });
      }
    }

    setMessages([
      ...prior,
      { role: "user", text: question, status: "done", steps: [] },
      { role: "assistant", text: "", status: "streaming", steps: [] },
    ]);
    setInput("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChat(
        [...history, { role: "user", content: question }],
        (event) => {
          switch (event.type) {
            case "iteration":
              // Text written before a round of tool calls is preamble, not the answer.
              updateLast((m) => ({ ...m, text: "" }));
              break;
            case "text":
              updateLast((m) => ({ ...m, text: m.text + event.delta }));
              break;
            case "tool_start":
              updateLast((m) => ({
                ...m,
                steps: [
                  ...m.steps,
                  { id: event.id, label: describeTool(event.name, event.input), state: "running" },
                ],
              }));
              break;
            case "tool_end":
              updateLast((m) => ({
                ...m,
                steps: m.steps.map((s) =>
                  s.id === event.id
                    ? { ...s, state: event.ok ? "ok" : "failed", ms: event.ms, error: event.error }
                    : s,
                ),
              }));
              break;
            case "done":
              updateLast((m) => ({ ...m, text: event.answer, status: "done", ms: event.ms }));
              break;
            case "error":
              updateLast((m) => ({ ...m, text: event.message, status: "error" }));
              break;
          }
        },
        controller.signal,
      );
    } catch (err) {
      const text = controller.signal.aborted
        ? "Stopped."
        : err instanceof Error
          ? err.message
          : "Something went wrong.";
      updateLast((m) => ({ ...m, text, status: "error" }));
    } finally {
      abortRef.current = null;
    }
  }

  function retry() {
    // Drop the failed exchange and ask the same question again.
    const question = messages.at(-2)?.text ?? "";
    send(question, messages.slice(0, -2));
  }

  return (
    <div className="app">
      <header>
        <div>
          <h1>Rogo Research</h1>
          <p>Ask a question about a company in our coverage universe.</p>
        </div>
        {messages.length > 0 && (
          <button className="link" onClick={() => setMessages([])} disabled={busy}>
            New chat
          </button>
        )}
      </header>

      <div className="transcript">
        {messages.length === 0 && (
          <div className="examples">
            {EXAMPLES.map((example) => (
              <button key={example} onClick={() => send(example)}>
                {example}
              </button>
            ))}
          </div>
        )}

        {messages.map((message, i) =>
          message.role === "user" ? (
            <div key={i} className="bubble user">
              {message.text}
            </div>
          ) : (
            <div key={i} className={`bubble assistant ${message.status}`}>
              {message.steps.length > 0 && (
                <details className="steps" open={message.status === "streaming"}>
                  <summary>
                    {message.status === "streaming"
                      ? "Researching…"
                      : `Researched with ${message.steps.length} lookup${message.steps.length === 1 ? "" : "s"}` +
                        (message.ms ? ` · ${(message.ms / 1000).toFixed(1)}s` : "")}
                  </summary>
                  <ul>
                    {message.steps.map((step) => (
                      <li key={step.id} className={step.state} title={step.error}>
                        <span className="icon">
                          {step.state === "running" ? "…" : step.state === "ok" ? "✓" : "✗"}
                        </span>
                        {step.label}
                        {step.ms != null && <span className="ms">{step.ms}ms</span>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {message.status === "streaming" && !message.text && message.steps.length === 0 && (
                <div className="pending">Thinking…</div>
              )}

              {message.status === "error" ? (
                <div className="error">
                  {message.text}
                  {i === messages.length - 1 && (
                    <button className="link" onClick={retry}>
                      Retry
                    </button>
                  )}
                </div>
              ) : (
                message.text && (
                  <div className="answer">
                    <Markdown remarkPlugins={[remarkGfm]}>{message.text}</Markdown>
                  </div>
                )
              )}
            </div>
          ),
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={messages.length ? "Ask a follow-up…" : "Ask a research question…"}
          disabled={busy}
          autoFocus
        />
        {busy ? (
          <button type="button" onClick={() => abortRef.current?.abort()}>
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()}>
            Send
          </button>
        )}
      </form>
    </div>
  );
}

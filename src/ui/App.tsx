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
  const scrollRef = useRef<HTMLDivElement>(null);
  const followRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const busy = messages.at(-1)?.status === "streaming";

  useEffect(() => {
    if (followRef.current) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  /** Apply an update to the in-flight assistant message (always the last one). */
  function updateLast(fn: (m: Message) => Message) {
    setMessages((prev) => [...prev.slice(0, -1), fn(prev[prev.length - 1])]);
  }

  async function send(question: string, prior: Message[] = messages) {
    if (!question.trim() || busy || abortRef.current) return;
    followRef.current = true;

    // Only completed exchanges go back as context; failed attempts are dropped.
    const history: ChatTurn[] = [];
    for (let i = 0; i + 1 < prior.length; i += 2) {
      const [q, a] = [prior[i], prior[i + 1]];
      if (a.status === "done") {
        history.push(
          { role: "user", content: q.text },
          { role: "assistant", content: a.text },
        );
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
                  {
                    id: event.id,
                    label: describeTool(event.name, event.input),
                    state: "running",
                  },
                ],
              }));
              break;
            case "tool_end":
              updateLast((m) => ({
                ...m,
                steps: m.steps.map((s) =>
                  s.id === event.id
                    ? {
                        ...s,
                        state: event.ok ? "ok" : "failed",
                        ms: event.ms,
                        error: event.error,
                      }
                    : s,
                ),
              }));
              break;
            case "done":
              updateLast((m) => ({
                ...m,
                text: event.answer,
                status: "done",
                ms: event.ms,
              }));
              break;
            case "error":
              updateLast((m) => ({
                ...m,
                text: event.message,
                status: "error",
              }));
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
      inputRef.current?.focus();
    }
  }

  function retry() {
    // Drop the failed exchange and ask the same question again.
    const question = messages.at(-2)?.text ?? "";
    send(question, messages.slice(0, -2));
  }

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Research workspace">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-mark">r</span>rogo
          <span className="brand-tag">RESEARCH</span>
        </a>
        <button
          className="new-chat"
          disabled={busy}
          onClick={() => {
            setMessages([]);
            setInput("");
            inputRef.current?.focus();
          }}
        >
          <span aria-hidden="true">＋</span> New conversation
        </button>
        <div className="sidebar-label">
          COVERAGE UNIVERSE <span>5</span>
        </div>
        <ul className="coverage">
          {[
            ["ACME", "Acme Corp", "Industrial Automation"],
            ["ACMR", "Acme Robotics", "Robotics"],
            ["GLBX", "Globex Inc", "Diversified Industrials"],
            ["ITCH", "Initech", "Enterprise Software"],
            ["UMBR", "Umbrella Health", "Healthcare Services"],
          ].map(([ticker, name, sector]) => (
            <li key={ticker}>
              <span className="company-icon">{name[0]}</span>
              <div>
                <strong>{name}</strong>
                <small>{sector}</small>
              </div>
              <span className="ticker">{ticker}</span>
            </li>
          ))}
        </ul>
        <div className="sidebar-note">
          <span className="status-dot" /> Local research workspace
          <p>
            Fictional company data.
            <br />
            Answers cite sources. Check figures.
          </p>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <span className="workspace-label">WORKSPACE</span>
            <h1>Company research</h1>
          </div>
          <span className="session-badge">
            {busy
              ? "Research in progress"
              : messages.length
                ? "Conversation active"
                : "Ready to research"}
          </span>
          <button
            className="mobile-new-chat"
            disabled={busy}
            onClick={() => {
              setMessages([]);
              setInput("");
              inputRef.current?.focus();
            }}
          >
            ＋ New chat
          </button>
        </header>
        <div
          className="transcript"
          ref={scrollRef}
          onScroll={() => {
            const el = scrollRef.current;
            if (el)
              followRef.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 100;
          }}
        >
          <div className="conversation">
            {messages.length === 0 && (
              <section className="welcome">
                <div className="welcome-icon" aria-hidden="true">
                  ↗
                </div>
                <p className="eyebrow">YOUR RESEARCH, IN CONVERSATION</p>
                <h2>
                  A clearer view of
                  <br />
                  the business.
                </h2>
                <p className="welcome-copy">
                  Compare companies, explore financials and unpack filings.
                  <br className="desktop-break" /> Ask a question, then follow
                  the evidence.
                </p>
                <div className="examples">
                  {EXAMPLES.map((example, i) => (
                    <button key={example} onClick={() => send(example)}>
                      <span className="example-category">
                        {
                          [
                            "COMPARE",
                            "RISK FACTORS",
                            "BUSINESS MODEL",
                            "GROWTH",
                          ][i]
                        }
                      </span>
                      <span>{example}</span>
                      <span className="example-arrow" aria-hidden="true">
                        ↗
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {messages.map((message, i) => (
              <article
                key={i}
                className={`message ${message.role}`}
                aria-label={
                  message.role === "user" ? "Your question" : "Research answer"
                }
              >
                <div className={`avatar ${message.role}`} aria-hidden="true">
                  {message.role === "user" ? "You" : "r"}
                </div>
                <div className="message-body">
                  <div className="message-author">
                    {message.role === "user" ? "You" : "Rogo Research"}
                    {message.role === "assistant" && (
                      <span className="ai-label">AI</span>
                    )}
                  </div>
                  {message.role === "user" ? (
                    <div className="question">{message.text}</div>
                  ) : (
                    <>
                      {message.steps.length > 0 && (
                        <details
                          className="steps"
                          open={message.status === "streaming"}
                        >
                          <summary>
                            {message.status === "streaming"
                              ? "Researching sources…"
                              : `${message.steps.length} lookup${message.steps.length === 1 ? "" : "s"}${message.ms ? ` · ${(message.ms / 1000).toFixed(1)}s` : ""}`}
                          </summary>
                          <ul>
                            {message.steps.map((step) => (
                              <li key={step.id} className={step.state}>
                                <span className="step-icon" aria-hidden="true">
                                  {step.state === "running"
                                    ? "◌"
                                    : step.state === "ok"
                                      ? "✓"
                                      : "!"}
                                </span>
                                <span>
                                  {step.label}
                                  {step.error && (
                                    <small className="step-error">
                                      {step.error}
                                    </small>
                                  )}
                                </span>
                                {step.ms != null && (
                                  <span className="ms">{step.ms}ms</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                      {message.status === "streaming" && !message.text && (
                        <div className="pending" role="status">
                          <span className="thinking-dot" />
                          {message.steps.length
                            ? "Reviewing the evidence…"
                            : "Planning the research…"}
                        </div>
                      )}
                      {message.status === "error" ? (
                        <div className="error" role="alert">
                          {message.text}
                          {i === messages.length - 1 && (
                            <button className="retry" onClick={retry}>
                              ↻ Retry question
                            </button>
                          )}
                        </div>
                      ) : message.text ? (
                        <div className="answer">
                          <Markdown remarkPlugins={[remarkGfm]}>
                            {message.text}
                          </Markdown>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </article>
            ))}
            {messages.length > 0 && !busy && (
              <div className="continue-hint">
                Continue the conversation below. Your previous answers stay in
                context.
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        </div>
        <div className="composer-area">
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <label className="sr-only" htmlFor="question">
              {messages.length
                ? "Ask a follow-up question"
                : "Ask a research question"}
            </label>
            <textarea
              id="question"
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  if (!busy) send(input);
                }
              }}
              placeholder={
                busy
                  ? "Draft your next question while I research…"
                  : messages.length
                    ? "Ask a follow-up, compare a metric, or explore another company…"
                    : "Ask anything about the companies in your coverage…"
              }
              rows={2}
              maxLength={8000}
              autoFocus
            />
            <div className="composer-bottom">
              <span>
                {busy
                  ? "You can keep drafting"
                  : "Enter to send · Shift + Enter for a new line"}
              </span>
              {busy ? (
                <button
                  type="button"
                  className="stop-button"
                  onClick={() => abortRef.current?.abort()}
                >
                  <span aria-hidden="true">■</span> Stop
                </button>
              ) : (
                <button
                  type="submit"
                  className="send-button"
                  disabled={!input.trim()}
                  aria-label="Send question"
                >
                  Send <span aria-hidden="true">↑</span>
                </button>
              )}
            </div>
          </form>
          <p className="disclaimer">
            AI can make mistakes. Check figures against their cited sources.{" "}
            <span>Fictional data · Local demo</span>
          </p>
        </div>
      </main>
    </div>
  );
}

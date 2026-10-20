/**
 * Live eval: runs a handful of analyst questions against the real model and checks
 * each answer for the facts and caveats a good answer must contain. Not a benchmark —
 * a fast regression check for prompt/tool changes. Usage: npm run eval [-- --verbose]
 */
import "dotenv/config";
import { runAgent, type AgentResult, type ChatTurn } from "../src/agent.ts";

interface Run {
  answer: string;
  tools: string[];
  result: AgentResult;
}

interface Case {
  name: string;
  turns: string[]; // alternating user/assistant, ending with the user question
  checks: Record<string, (run: Run) => boolean>;
}

const has = (...patterns: RegExp[]) => (r: Run) => patterns.every((p) => p.test(r.answer));
const cites = has(/\[(DOC-[A-Z]+-\d+|financials)/);

const cases: Case[] = [
  {
    name: "ambiguous name",
    turns: ["Compare Acme and Globex and tell me which one appears to be growing faster."],
    checks: {
      "surfaces both Acmes": has(/Acme Corp/, /Acme Robotics/),
      "correct Globex CAGR (1.4%)": has(/1\.4\s?%/),
      cites,
    },
  },
  {
    name: "risk disclosures",
    turns: ["What are the biggest risks Umbrella Health flags in its filings?"],
    checks: {
      "acquisition dependence": has(/acqui/i),
      "reimbursement exposure": has(/reimburs/i),
      "≤ 3 document searches": (r) => r.tools.filter((t) => t === "searchDocuments").length <= 3,
      cites,
    },
  },
  {
    name: "unfiled period",
    turns: ["How is Initech's subscription transition going?"],
    checks: {
      "subscription mix 62% → 68%": has(/62\s?%/, /68\s?%/),
      "flags FY2025 as preliminary": has(/preliminary|unaudited/i),
      cites,
    },
  },
  {
    name: "universe-wide ranking",
    turns: ["Which company in the universe is growing fastest?"],
    checks: {
      "leads with Acme Robotics": (r) => /Acme Robotics|ACMR/.test(r.answer.slice(0, 300)),
      "flags Initech period mismatch": has(/Initech[\s\S]{0,400}(FY2024|not (yet )?filed|preliminary)/),
      cites,
    },
  },
  {
    name: "tickers",
    turns: ["Is GLBX a better business than ITCH?"],
    checks: {
      "resolves tickers without errors": (r) => r.result.toolCalls > 0 && !/not in the coverage/i.test(r.answer),
      "notes ITCH FY2025 not final": has(/preliminary|not (yet )?filed|unaudited/i),
      cites,
    },
  },
  {
    name: "follow-up",
    turns: [
      "How fast is Acme Corp growing?",
      "Acme Corp revenue grew 5.5% in FY2025 [financials].",
      "And how do its margins compare with Globex?",
    ],
    checks: {
      "uses context (Acme Corp vs Globex)": has(/Acme Corp/, /Globex/),
      "gross margins 39.7% / 30.8%": has(/39\.7\s?%/, /30\.8\s?%/),
    },
  },
  {
    name: "synthetic quarterly data",
    turns: ["Did Globex revenue accelerate from Q2 to Q3 FY2025? Use the quarterly financial data."],
    checks: {
      "identifies synthetic quarterly figures": has(/synthetic|fixed (seasonal|weight)|allocated|allocation/i),
      "does not treat quarterly changes as actual momentum": has(/cannot|can.t|not (actual|real|reported|evidence)|does not|doesn.t|should not|shouldn.t|would not|wouldn.t|not possible|unable/i),
    },
  },
  {
    name: "out of coverage",
    turns: ["How is Hooli's revenue trending?"],
    checks: {
      "says it isn't covered": has(/not (in|part of|within)|isn't (in|covered)|don't (cover|have)|no coverage|outside/i),
      "no invented revenue figure": (r) => !/\$\s?\d/.test(r.answer),
    },
  },
];

const verbose = process.argv.includes("--verbose");

const runs = await Promise.all(
  cases.map(async (c) => {
    const conversation: ChatTurn[] = c.turns.map((content, i) => ({
      role: i % 2 ? "assistant" : "user",
      content,
    }));
    const tools: string[] = [];
    const started = Date.now();
    const result = await runAgent(conversation, (e) => {
      if (e.type === "tool_start") tools.push(e.name);
    });
    const run: Run = { answer: result.answer, tools, result };
    const failed = Object.entries(c.checks)
      .filter(([, check]) => !check(run))
      .map(([label]) => label);
    return { c, run, ms: Date.now() - started, failed };
  }),
);

let failures = 0;
for (const { c, run, ms, failed } of runs) {
  failures += failed.length;
  const total = Object.keys(c.checks).length;
  console.log(
    `${failed.length ? "✗" : "✓"} ${c.name.padEnd(22)} ${(ms / 1000).toFixed(1).padStart(5)}s  ` +
      `${run.result.iterations} iter  ${String(run.result.toolCalls).padStart(2)} tools  ` +
      `${total - failed.length}/${total} checks${failed.length ? `  — failed: ${failed.join("; ")}` : ""}`,
  );
  if (verbose || failed.length) console.log(`\n${run.answer}\n`);
}
process.exit(failures ? 1 : 0);

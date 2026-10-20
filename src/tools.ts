/**
 * The agent's tools. These stand in for the real research APIs — same shapes,
 * local data, plus a little latency so the app behaves like the real thing.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { companies, documents, financials, type Company } from "./data.ts";

/** Thrown when a tool cannot service a request. The message is shown to the model. */
export class ToolError extends Error {}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Max keywords the upstream document index accepts. */
export const MAX_SEARCH_TERMS = 6;

export const toolSchemas: Anthropic.Tool[] = [
  {
    name: "searchCompanies",
    description:
      "Search the coverage universe by company name, ticker or sector. Returns name, ticker and sector for each match. Pass an empty query to list every covered company.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "A company name, ticker or sector, or part of one." },
      },
      required: ["query"],
    },
  },
  {
    name: "getCompanyProfile",
    description:
      "Get a company's profile: description, sector, headquarters, headcount, business segments and the filings we hold.",
    input_schema: {
      type: "object",
      properties: {
        company: { type: "string", description: "The company name or ticker." },
      },
      required: ["company"],
    },
  },
  {
    name: "getFinancials",
    description:
      "Get annual and quarterly financials for a company: revenue, gross margin, operating income, net income and free cash flow, plus precomputed revenue growth (year-over-year and CAGR) and operating, net and free-cash-flow margins. Use the precomputed figures rather than calculating them yourself. Includes data-quality warnings and restatements, which must be respected.",
    input_schema: {
      type: "object",
      properties: {
        company: { type: "string", description: "The company name or ticker." },
      },
      required: ["company"],
    },
  },
  {
    name: "searchDocuments",
    description: `Keyword search over earnings call transcripts, filing excerpts and press releases. Matches documents containing any of the keywords, ranked by how many match. Accepts at most ${MAX_SEARCH_TERMS} keywords. The index is small (a few documents per company): to see everything held for a company, pass the company with an empty query instead of guessing keywords.`,
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: `Up to ${MAX_SEARCH_TERMS} space-separated keywords. May be empty when company is given.`,
        },
        company: {
          type: "string",
          description: "Optional. Restrict the search to one company (name or ticker).",
        },
      },
      required: ["query"],
    },
  },
];

const CORPORATE_SUFFIX = /\b(inc|corp|corporation|co|company|ltd|plc|llc)\b/g;

const tidy = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
const stripSuffix = (s: string) => tidy(s).replace(CORPORATE_SUFFIX, "").replace(/\s+/g, " ").trim();

function partialMatches(needle: string, key: (s: string) => string): Company[] {
  return needle ? companies.filter((c) => key(c.name).includes(needle)) : [];
}

/**
 * Resolve a free-form company reference (name, ticker, partial name, any case) to
 * exactly one company. Ambiguous or unknown references are tool errors whose message
 * tells the model how to recover, rather than silently picking one.
 */
export function resolveCompany(ref: string): Company {
  const raw = String(ref ?? "").trim();
  if (!raw) throw new ToolError("company is required");

  const lower = raw.toLowerCase();
  // Tickers only match when written as tickers: "ACME" is Acme Corp, "acme" is ambiguous.
  const exact = companies.find((c) => c.name.toLowerCase() === lower || c.ticker === raw);
  if (exact) return exact;

  // "acme robotics" → Acme Robotics; "acme" → ambiguous; "Initech Inc" → Initech (suffix dropped).
  let candidates = partialMatches(tidy(raw), tidy);
  if (candidates.length === 0) candidates = partialMatches(stripSuffix(raw), stripSuffix);

  if (candidates.length === 1) return candidates[0];

  const describe = (list: Company[]) => list.map((c) => `${c.name} (${c.ticker})`).join(", ");
  if (candidates.length > 1) {
    throw new ToolError(
      `"${raw}" is ambiguous; it matches ${describe(candidates)}. Call again with one exact name.`,
    );
  }
  throw new ToolError(
    `"${raw}" is not in the coverage universe. Covered companies: ${describe(companies)}.`,
  );
}

async function searchCompanies(query: string) {
  await sleep(250);
  const needle = String(query ?? "").trim().toLowerCase();
  const matches = companies.filter(
    (c) =>
      !needle ||
      c.name.toLowerCase().includes(needle) ||
      c.ticker.toLowerCase() === needle ||
      c.sector.toLowerCase().includes(needle),
  );
  return matches.map((c) => ({ name: c.name, ticker: c.ticker, sector: c.sector }));
}

async function getCompanyProfile(company: string) {
  await sleep(450);
  return resolveCompany(company);
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

async function getFinancials(company: string) {
  await sleep(800);
  const { name } = resolveCompany(company);
  const record = financials.find((f) => f.company === name);
  if (!record) {
    throw new ToolError(`no financials found for "${name}"`);
  }

  // Growth and margins are computed here, deterministically, so the model never does
  // arithmetic in its head. Years with no filed revenue break the YoY chain.
  const ratio = (num: number | null, den: number | null) =>
    num != null && den ? round3(num / den) : null;
  const annual = record.annual.map((year, i) => {
    const prev = record.annual[i - 1]?.revenue ?? null;
    return {
      ...year,
      revenueGrowth: year.revenue != null && prev ? round3(year.revenue / prev - 1) : null,
      operatingMargin: ratio(year.operatingIncome, year.revenue),
      netMargin: ratio(year.netIncome, year.revenue),
      fcfMargin: ratio(year.freeCashFlow, year.revenue),
    };
  });

  const reported = record.annual.filter((y) => y.revenue != null);
  const first = reported[0];
  const last = reported[reported.length - 1];
  const span = last && first ? last.fiscalYear - first.fiscalYear : 0;
  const revenueCagr =
    span > 0
      ? {
          from: `FY${first.fiscalYear}`,
          to: `FY${last.fiscalYear}`,
          value: round3((last.revenue! / first.revenue!) ** (1 / span) - 1),
        }
      : null;

  // Provenance (checksums, pipeline versions) is noise to the model; restatements and
  // warnings are the parts that change what an analyst should say.
  return {
    company: record.company,
    ticker: record.ticker,
    currency: record.currency,
    unit: `${record.unit}; margins and growth rates are fractions (0.055 = 5.5%)`,
    latestReportedFiscalYear: last ? `FY${last.fiscalYear}` : null,
    revenueCagr,
    annual,
    quarterly: record.quarterly,
    restatements: record.provenance.restatements,
    warnings: [
      ...(record.warnings ?? []),
      "Quarterly figures are synthetic: annual figures allocated using fixed seasonality weights. They are not reported quarterly results and must not be used to infer actual quarter-over-quarter trends or business momentum.",
    ],
  };
}

async function searchDocuments(query: string, company?: string) {
  await sleep(700);

  const terms = String(query ?? "").trim().split(/\s+/).filter(Boolean);
  // The upstream document index rejects long queries.
  if (terms.length > MAX_SEARCH_TERMS) {
    throw new ToolError(
      `document search accepts at most ${MAX_SEARCH_TERMS} terms (received ${terms.length}); retry with fewer keywords`,
    );
  }

  const companyName = company ? resolveCompany(company).name : undefined;
  const pool = companyName ? documents.filter((d) => d.company === companyName) : documents;

  if (terms.length === 0) {
    if (!companyName) throw new ToolError("provide keywords, a company, or both");
    return pool.slice(0, 5);
  }

  const scored = pool.map((doc) => {
    const haystack = `${doc.title} ${doc.body}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (haystack.includes(term.toLowerCase())) score += 1;
    }
    return { doc, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((s) => s.doc);
}

function optionalString(input: Record<string, unknown>, key: string): string | undefined {
  const value = input[key];
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") throw new ToolError(`"${key}" must be a string`);
  return value;
}

function requiredString(input: Record<string, unknown>, key: string, allowEmpty = false): string {
  const value = input[key];
  if (typeof value !== "string" || (!allowEmpty && !value.trim())) {
    throw new ToolError(`"${key}" is required and must be a string`);
  }
  return value;
}

export async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "searchCompanies":
      return searchCompanies(requiredString(input, "query", true));
    case "getCompanyProfile":
      return getCompanyProfile(requiredString(input, "company"));
    case "getFinancials":
      return getFinancials(requiredString(input, "company"));
    case "searchDocuments":
      return searchDocuments(requiredString(input, "query", true), optionalString(input, "company"));
    default:
      throw new ToolError(`unknown tool "${name}"`);
  }
}

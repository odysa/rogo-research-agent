import { describe, expect, it } from "vitest";
import { executeTool, resolveCompany, ToolError } from "./tools.ts";

describe("resolveCompany", () => {
  it.each([
    ["Acme Corp", "Acme Corp"],
    ["acme corp", "Acme Corp"],
    ["GLBX", "Globex Inc"],
    ["ITCH", "Initech"],
    ["ACME", "Acme Corp"],
    ["Globex", "Globex Inc"],
    ["Umbrella", "Umbrella Health"],
    ["Acme Robotics Inc", "Acme Robotics"],
    ["Initech Inc.", "Initech"],
  ])("resolves %j to %s", (ref, name) => {
    expect(resolveCompany(ref).name).toBe(name);
  });

  it("refuses to guess between companies sharing a name", () => {
    expect(() => resolveCompany("Acme")).toThrow(/ambiguous.*Acme Corp \(ACME\).*Acme Robotics \(ACMR\)/);
  });

  it("lists the coverage universe for unknown companies", () => {
    expect(() => resolveCompany("Hooli")).toThrow(/not in the coverage universe.*Initech/);
  });
});

describe("getFinancials", () => {
  it("accepts tickers and precomputes growth", async () => {
    const result = (await executeTool("getFinancials", { company: "GLBX" })) as any;
    expect(result.company).toBe("Globex Inc");
    expect(result.revenueCagr).toEqual({ from: "FY2021", to: "FY2025", value: 0.014 });
    const fy2023 = result.annual.find((y: any) => y.fiscalYear === 2023);
    expect(fy2023.revenueGrowth).toBe(-0.025); // 8395 / 8610 - 1
    expect(fy2023.operatingMargin).toBe(0.094); // base 8.9% + FY2023 drift
    expect(result).not.toHaveProperty("provenance");
    expect(result.warnings.join(" ")).toMatch(/Quarterly figures are synthetic.*not reported quarterly results.*must not be used/);
  });

  it("stops growth at the last filed year and keeps warnings", async () => {
    const result = (await executeTool("getFinancials", { company: "Initech" })) as any;
    expect(result.latestReportedFiscalYear).toBe("FY2024");
    expect(result.revenueCagr.to).toBe("FY2024");
    expect(result.annual.at(-1)).toMatchObject({ fiscalYear: 2025, revenue: null, revenueGrowth: null });
    expect(result.warnings[0]).toMatch(/FY2025 has not been filed/);
  });
});

describe("searchDocuments", () => {
  it("lists a company's documents when the query is empty", async () => {
    const docs = (await executeTool("searchDocuments", { query: "", company: "UMBR" })) as any[];
    expect(docs.map((d) => d.id)).toEqual(["DOC-UMBR-001", "DOC-UMBR-002"]);
  });

  it("rejects over-long queries with a recoverable message", async () => {
    await expect(
      executeTool("searchDocuments", { query: "a b c d e f g" }),
    ).rejects.toThrow(/at most 6 terms.*retry with fewer/);
  });
});

describe("executeTool", () => {
  it("validates inputs instead of crashing on undefined", async () => {
    await expect(executeTool("getFinancials", {})).rejects.toBeInstanceOf(ToolError);
    await expect(executeTool("nope", {})).rejects.toThrow(/unknown tool/);
  });
});

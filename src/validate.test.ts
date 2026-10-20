import { describe, expect, it } from "vitest";
import { splitLines } from "./ui/api.ts";
import { parseConversation } from "./validate.ts";

describe("parseConversation", () => {
  it("accepts a well-formed conversation", () => {
    const messages = [
      { role: "user", content: "q1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "q2" },
    ];
    expect(parseConversation({ messages })).toEqual(messages);
  });

  it.each([
    [{}, /non-empty array/],
    [{ messages: [{ role: "system", content: "x" }] }, /role/],
    [{ messages: [{ role: "user", content: "q" }, { role: "assistant", content: "a" }] }, /last message/],
    [{ messages: [{ role: "user", content: "   " }] }, /last message/],
  ])("rejects %j", (body, error) => {
    expect(parseConversation(body)).toMatch(error);
  });
});

describe("splitLines", () => {
  it("keeps a partial trailing line for the next chunk", () => {
    expect(splitLines('{"a":1}\n{"b":2}\n{"c"')).toEqual({ lines: ['{"a":1}', '{"b":2}'], rest: '{"c"' });
  });
});

import { describe, expect, it } from "vitest";
import {
  attachProviderCostToMcpResult,
  recordProviderCostUsd,
  runWithProviderCostCapture,
} from "@/server/lib/dataforseo/provider-cost-context";

describe("provider cost context", () => {
  it("aggregates every DataForSEO task inside one MCP tool call", async () => {
    const capture = await runWithProviderCostCapture(() => {
      recordProviderCostUsd(0.001);
      recordProviderCostUsd(0.0025);
      return "ok";
    });

    expect(capture).toEqual({
      result: "ok",
      providerCostUsd: 0.0035,
    });
  });

  it("distinguishes no provider observation from a reported zero cost", async () => {
    const missing = await runWithProviderCostCapture(() => "none");
    const zero = await runWithProviderCostCapture(() => {
      recordProviderCostUsd(0);
      return "zero";
    });

    expect(missing.providerCostUsd).toBeNull();
    expect(zero.providerCostUsd).toBe(0);
  });

  it("rejects invalid provider costs", async () => {
    await expect(
      runWithProviderCostCapture(() => recordProviderCostUsd(Number.NaN)),
    ).rejects.toThrow("finite and non-negative");
    await expect(
      runWithProviderCostCapture(() => recordProviderCostUsd(-0.1)),
    ).rejects.toThrow("finite and non-negative");
  });

  it("copies cost into top-level and structured MCP metadata", () => {
    const result = attachProviderCostToMcpResult(
      {
        content: [{ type: "text", text: "ok" }],
        structuredContent: { rows: [], meta: { projectId: "p1" } },
        _meta: { projectId: "p1" },
      },
      0.04,
    );

    expect(result._meta).toEqual({
      projectId: "p1",
      providerCostUsd: 0.04,
    });
    expect(result.structuredContent.meta).toEqual({
      projectId: "p1",
      providerCostUsd: 0.04,
    });
  });
});

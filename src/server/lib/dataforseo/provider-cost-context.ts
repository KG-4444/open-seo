import { AsyncLocalStorage } from "node:async_hooks";

type ProviderCostState = {
  observations: number;
  totalUsd: number;
};

const providerCostStorage = new AsyncLocalStorage<ProviderCostState>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function runWithProviderCostCapture<T>(
  callback: () => Promise<T> | T,
): Promise<{ result: T; providerCostUsd: number | null }> {
  const state: ProviderCostState = {
    observations: 0,
    totalUsd: 0,
  };
  const result = await providerCostStorage.run(state, callback);
  return {
    result,
    providerCostUsd:
      state.observations > 0 ? Number(state.totalUsd.toFixed(10)) : null,
  };
}

export function recordProviderCostUsd(costUsd: number): void {
  if (!Number.isFinite(costUsd) || costUsd < 0) {
    throw new Error("DataForSEO provider cost must be finite and non-negative");
  }
  const state = providerCostStorage.getStore();
  if (!state) return;
  state.observations += 1;
  state.totalUsd += costUsd;
}

export function attachProviderCostToMcpResult<T>(
  result: T,
  providerCostUsd: number | null,
): T;
export function attachProviderCostToMcpResult(
  result: unknown,
  providerCostUsd: number | null,
): unknown {
  if (providerCostUsd == null || !isRecord(result)) {
    return result;
  }
  const mutable = result;
  const existingMeta = isRecord(mutable._meta) ? mutable._meta : {};
  const meta = { ...existingMeta, providerCostUsd };
  mutable._meta = meta;

  if (isRecord(mutable.structuredContent)) {
    const structuredContent = mutable.structuredContent;
    const structuredMeta = isRecord(structuredContent.meta)
      ? structuredContent.meta
      : {};
    mutable.structuredContent = {
      ...structuredContent,
      meta: { ...structuredMeta, providerCostUsd },
    };
  }
  return result;
}

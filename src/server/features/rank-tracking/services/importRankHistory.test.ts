import { beforeEach, describe, expect, it, vi } from "vitest";
import { importRankHistory } from "./importRankHistory";
import type { RankHistoryImport } from "@/types/schemas/rank-history-import";

const mocks = vi.hoisted(() => ({
  getConfigById: vi.fn(),
  getRunById: vi.fn(),
  getSnapshotsForRun: vi.fn(),
  getKeywordsForConfig: vi.fn(),
  insertImportedHistory: vi.fn(),
  addKeywords: vi.fn(),
}));
vi.mock(
  "@/server/features/rank-tracking/repositories/RankTrackingRepository",
  () => ({ RankTrackingRepository: mocks }),
);
vi.mock("@/server/features/rank-tracking/repositories/importHistory", () => ({
  insertImportedHistory: mocks.insertImportedHistory,
}));
vi.mock("./RankTrackingKeywordService", () => ({
  RankTrackingKeywordService: { addKeywords: mocks.addKeywords },
}));
vi.mock("../rankTrackingTimestamps", () => ({
  toRankTrackingTimestamp: (date: Date) =>
    date.toISOString().slice(0, 19).replace("T", " "),
}));

const input: RankHistoryImport = {
  projectId: "11111111-1111-4111-8111-111111111111",
  trackerId: "22222222-2222-4222-8222-222222222222",
  sourceRunId: "signed-snapshot:original-profile",
  targetDomain: "oyjob.cn",
  locationCode: 2446,
  languageCode: "zh-TW",
  depth: 100,
  keywords: ["澳業"],
  observations: [
    {
      keyword: "澳業",
      device: "mobile",
      checkedAt: "2026-07-19T01:02:03Z",
      state: "found",
      position: 3,
      url: "https://oyjob.cn/",
      serpFeatures: [],
    },
  ],
};
const config = {
  id: input.trackerId,
  projectId: input.projectId,
  domain: "oyjob.cn",
  locationCode: 2446,
  languageCode: "zh-TW",
  serpDepth: 100,
  devices: "both",
  scheduleInterval: "manual",
  locationName: null,
};

describe("existing rank history import", () => {
  beforeEach(() => {
    mocks.getConfigById.mockResolvedValue(config);
    mocks.getRunById.mockResolvedValue(null);
    mocks.getSnapshotsForRun.mockResolvedValue([]);
    mocks.getKeywordsForConfig.mockResolvedValue([
      { id: "kw1", keyword: "澳業" },
    ]);
    mocks.addKeywords.mockResolvedValue({ added: 1 });
  });

  it("preserves original time and writes the completed run and rows together", async () => {
    const result = await importRankHistory(input);
    expect(result.imported).toBe(1);
    expect(result.runId).toMatch(/^import:dataforseo:[0-9a-f]{64}$/);
    expect(mocks.insertImportedHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "completed",
        startedAt: "2026-07-19 01:02:03",
        completedAt: "2026-07-19 01:02:03",
        isSubsetRun: true,
      }),
      [
        expect.objectContaining({
          trackingKeywordId: "kw1",
          checkedAt: "2026-07-19 01:02:03",
          position: 3,
        }),
      ],
    );
    expect(mocks.addKeywords).toHaveBeenCalledWith(
      input.trackerId,
      input.projectId,
      ["澳業"],
      { kind: "direct_user_action" },
      true,
    );
  });

  it("keeps verified not-found null, never zero", async () => {
    await importRankHistory({
      ...input,
      observations: [
        {
          ...input.observations[0],
          state: "not_in_window",
          position: null,
          url: null,
        },
      ],
    });
    expect(mocks.insertImportedHistory).toHaveBeenCalledWith(
      expect.anything(),
      [expect.objectContaining({ position: null })],
    );
  });

  it("adds planned keywords without a run or any observation", async () => {
    expect(
      await importRankHistory({ ...input, observations: [] }),
    ).toMatchObject({ runId: null, imported: 0, addedKeywords: 1 });
    expect(mocks.insertImportedHistory).not.toHaveBeenCalled();
  });

  it("replays identical source history without adding rows or changing its timestamp", async () => {
    mocks.getRunById.mockResolvedValue({ id: "existing" });
    mocks.getSnapshotsForRun.mockResolvedValue([
      {
        ...input.observations[0],
        checkedAt: "2026-07-19 01:02:03",
        serpFeatures: "[]",
      },
    ]);
    expect(await importRankHistory(input)).toMatchObject({
      imported: 0,
      alreadyImported: 1,
    });
    expect(mocks.addKeywords).not.toHaveBeenCalled();
    expect(mocks.insertImportedHistory).not.toHaveBeenCalled();
  });

  it("rejects overwriting a previously imported source", async () => {
    mocks.getRunById.mockResolvedValue({ id: "existing" });
    mocks.getSnapshotsForRun.mockResolvedValue([
      { ...input.observations[0], position: 8, serpFeatures: "[]" },
    ]);
    await expect(importRankHistory(input)).rejects.toThrow(
      "different observations",
    );
    expect(mocks.insertImportedHistory).not.toHaveBeenCalled();
  });

  it.each<Partial<RankHistoryImport>>([
    { targetDomain: "competitor.example" },
    { locationCode: 2344 },
    { languageCode: "en" },
    { depth: 20 },
    {
      observations: [
        {
          ...input.observations[0],
          device: "desktop",
          url: "https://competitor.example/",
        },
      ],
    },
    { observations: [{ ...input.observations[0], state: "not_in_window" }] },
    {
      observations: [
        { ...input.observations[0], checkedAt: "2099-01-01T00:00:00Z" },
      ],
    },
    { observations: [input.observations[0], input.observations[0]] },
  ])(
    "rejects mismatched or unproven history before any mutation: %j",
    async (patch) => {
      await expect(importRankHistory({ ...input, ...patch })).rejects.toThrow();
      expect(mocks.addKeywords).not.toHaveBeenCalled();
      expect(mocks.insertImportedHistory).not.toHaveBeenCalled();
    },
  );

  it("does not import into a second paid schedule", async () => {
    mocks.getConfigById.mockResolvedValue({
      ...config,
      scheduleInterval: "weekly",
    });
    await expect(importRankHistory(input)).rejects.toThrow("manual tracker");
    expect(mocks.addKeywords).not.toHaveBeenCalled();
  });

  it("enforces project ownership through the repository", async () => {
    mocks.getConfigById.mockResolvedValue(null);
    await expect(importRankHistory(input)).rejects.toThrow("not found");
    expect(mocks.getConfigById).toHaveBeenCalledWith({
      configId: input.trackerId,
      projectId: input.projectId,
    });
    expect(mocks.insertImportedHistory).not.toHaveBeenCalled();
  });
});

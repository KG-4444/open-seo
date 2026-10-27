import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  collectQueuedRankChecksTool,
  postQueuedRankChecksTool,
} from "./queued-rank-checks";
import { makeToolContext } from "@/server/mcp/tools/tool-test-support";

const mocks = vi.hoisted(() => ({
  createDataforseoClient: vi.fn(),
  fetchRankCheckTaskResult: vi.fn(),
  getProjectForOrganization: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/server/lib/dataforseo", () => ({
  createDataforseoClient: mocks.createDataforseoClient,
  fetchRankCheckTaskResult: mocks.fetchRankCheckTaskResult,
}));
vi.mock("@/server/features/projects/services/ProjectService", () => ({
  ProjectService: {
    getProjectForOrganization: mocks.getProjectForOrganization,
  },
}));

const toolExtra = makeToolContext();

describe("queued rank-check MCP tools", () => {
  beforeEach(() => {
    mocks.getProjectForOrganization.mockResolvedValue({
      id: "project_1",
      domain: "oyjob.cn",
      locationCode: 2344,
      languageCode: "zh-TW",
    });
  });

  it("submits an explicit device and depth without live fallback", async () => {
    const rankCheckTaskPost = vi.fn().mockResolvedValue([
      {
        keywordId: "kw001",
        keyword: "香港外勞",
        device: "mobile",
        taskId: "07201234-1234-5678-9000-abcdef123456",
      },
    ]);
    mocks.createDataforseoClient.mockReturnValue({
      serp: { rankCheckTaskPost },
    });

    const result = await postQueuedRankChecksTool.handler(
      {
        projectId: "project_1",
        tasks: [
          {
            keywordId: "kw001",
            keyword: "香港外勞",
            device: "mobile",
          },
        ],
        locationCode: 2344,
        languageCode: "zh-TW",
        depth: 100,
        targetDomain: "oyjob.cn",
      },
      toolExtra,
    );

    expect(rankCheckTaskPost).toHaveBeenCalledWith({
      tasks: [
        {
          keywordId: "kw001",
          keyword: "香港外勞",
          device: "mobile",
        },
      ],
      locationCode: 2344,
      languageCode: "zh-TW",
      depth: 100,
      targetDomain: "oyjob.cn",
    });
    expect(result.structuredContent).toMatchObject({
      method: "standard_queue",
      submittedCount: 1,
      acceptedCount: 1,
    });
    expect(result.content[0]?.type).toBe("text");
    expect(
      result.content[0]?.type === "text" ? result.content[0].text : "",
    ).toContain("No live fallback");
  });

  it("surfaces partial provider acceptance without attempting a fallback", async () => {
    const rankCheckTaskPost = vi.fn().mockResolvedValue([
      {
        keywordId: "kw001",
        keyword: "香港外勞",
        device: "mobile",
        taskId: "07201234-1234-5678-9000-abcdef123456",
      },
    ]);
    mocks.createDataforseoClient.mockReturnValue({
      serp: { rankCheckTaskPost },
    });

    const result = await postQueuedRankChecksTool.handler(
      {
        projectId: "project_1",
        tasks: [
          {
            keywordId: "kw001",
            keyword: "香港外勞",
            device: "mobile",
          },
          {
            keywordId: "kw002",
            keyword: "澳門外勞",
            device: "mobile",
          },
        ],
        locationCode: 2344,
        languageCode: "zh-TW",
        depth: 100,
        targetDomain: "oyjob.cn",
      },
      toolExtra,
    );

    expect(result.structuredContent).toMatchObject({
      method: "standard_queue",
      submittedCount: 2,
      acceptedCount: 1,
    });
    expect(result.content[0]?.type).toBe("text");
    expect(
      result.content[0]?.type === "text" ? result.content[0].text : "",
    ).toContain("No live fallback");
    expect(rankCheckTaskPost).toHaveBeenCalledTimes(1);
  });

  it("collects completed, pending and failed tasks without provider spend", async () => {
    mocks.fetchRankCheckTaskResult
      .mockResolvedValueOnce({
        status: "completed",
        result: {
          keywordId: "kw001",
          keyword: "香港外勞",
          position: 8,
          url: "https://oyjob.cn/services/hong-kong-esls",
          serpFeatures: ["organic"],
        },
      })
      .mockResolvedValueOnce({ status: "pending" })
      .mockResolvedValueOnce({
        status: "failed",
        message: "provider task failed",
      });
    const base = {
      keyword: "香港外勞",
      device: "mobile" as const,
    };

    const result = await collectQueuedRankChecksTool.handler(
      {
        projectId: "project_1",
        targetDomain: "oyjob.cn",
        tasks: [
          {
            ...base,
            keywordId: "kw001",
            taskId: "07201234-1234-5678-9000-abcdef123456",
          },
          {
            ...base,
            keywordId: "kw002",
            taskId: "07201234-1234-5678-9000-abcdef123457",
          },
          {
            ...base,
            keywordId: "kw003",
            taskId: "07201234-1234-5678-9000-abcdef123458",
          },
        ],
      },
      toolExtra,
    );

    expect(result.structuredContent?.results).toEqual([
      expect.objectContaining({
        keywordId: "kw001",
        status: "completed",
        position: 8,
      }),
      expect.objectContaining({ keywordId: "kw002", status: "pending" }),
      expect.objectContaining({ keywordId: "kw003", status: "failed" }),
    ]);
    expect(result._meta).not.toHaveProperty("providerCostUsd");
    expect(result.content[0]?.type).toBe("text");
    expect(
      result.content[0]?.type === "text" ? result.content[0].text : "",
    ).toContain("No live fallback");
  });
});

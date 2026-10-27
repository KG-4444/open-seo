import { expect, it, vi } from "vitest";
import { createGscClient } from "./gscClient";

vi.hoisted(() => {
  vi.stubEnv("GOOGLE_API_RELAY_ORIGIN", "http://google-oauth-proxy:8787");
});
vi.mock("@/server/features/google/googleOAuth", () => ({
  getGoogleAccessToken: async () => "test-token",
}));
vi.mock("@/server/features/google/googleAccess", () => ({
  getGoogleAccessMode: async () => "own",
}));

it("routes real Google API paths through the configured relay without changing authorization or payload", async () => {
  const request = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      Response.json({
        siteEntry: [
          { siteUrl: "sc-domain:oyjob.cn", permissionLevel: "siteOwner" },
        ],
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        rows: [{ clicks: 1, impressions: 8, ctr: 0.125, position: 3 }],
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        inspectionResult: { indexStatusResult: { verdict: "PASS" } },
      }),
    );
  const client = createGscClient({ userId: "u1" });
  expect(await client.listSites()).toHaveLength(1);
  expect(
    await client.querySearchAnalytics("sc-domain:oyjob.cn", {
      startDate: "2026-10-01",
      endDate: "2026-10-02",
    }),
  ).toHaveLength(1);
  expect(
    await client.inspectUrl("sc-domain:oyjob.cn", "https://oyjob.cn/"),
  ).toMatchObject({ indexStatusResult: { verdict: "PASS" } });
  expect(request.mock.calls.map(([url]) => url)).toEqual([
    "http://google-oauth-proxy:8787/gsc/webmasters/v3/sites",
    "http://google-oauth-proxy:8787/gsc/webmasters/v3/sites/sc-domain%3Aoyjob.cn/searchAnalytics/query",
    "http://google-oauth-proxy:8787/gsc/url-inspection",
  ]);
  expect(request.mock.calls[2]?.[1]).toMatchObject({
    method: "POST",
    headers: { Authorization: "Bearer test-token" },
  });
  const requestBody = request.mock.calls[2]?.[1]?.body;
  if (typeof requestBody !== "string")
    throw new Error("Expected JSON request body");
  expect(JSON.parse(requestBody)).toEqual({
    siteUrl: "sc-domain:oyjob.cn",
    inspectionUrl: "https://oyjob.cn/",
  });
});

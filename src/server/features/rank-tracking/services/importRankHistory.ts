import { RankTrackingRepository } from "@/server/features/rank-tracking/repositories/RankTrackingRepository";
import { insertImportedHistory } from "@/server/features/rank-tracking/repositories/importHistory";
import { RankTrackingKeywordService } from "./RankTrackingKeywordService";
import { toRankTrackingTimestamp } from "../rankTrackingTimestamps";
import {
  rankHistoryImportSchema,
  type RankHistoryImport,
} from "@/types/schemas/rank-history-import";
import { AppError } from "@/server/lib/errors";
import { z } from "zod";
import { sortBy } from "remeda";

function invalid(message: string): never {
  throw new AppError("VALIDATION_ERROR", message);
}

function canonical(rows: RankHistoryImport["observations"]) {
  return JSON.stringify(
    sortBy(
      rows.map((row) => ({
        keyword: row.keyword,
        device: row.device,
        checkedAt: toRankTrackingTimestamp(new Date(row.checkedAt)),
        position: row.position,
        url: row.url,
        serpFeatures: sortBy(row.serpFeatures, (feature) => feature),
      })),
      (row) => `${row.keyword}:${row.device}`,
    ),
  );
}

/** Import existing DataForSEO observations only; never invokes a provider. */
export async function importRankHistory(raw: RankHistoryImport) {
  const input = rankHistoryImportSchema.parse(raw);
  const config = await RankTrackingRepository.getConfigById({
    configId: input.trackerId,
    projectId: input.projectId,
  });
  if (!config) throw new AppError("NOT_FOUND", "Rank tracker not found");
  if (config.scheduleInterval !== "manual")
    invalid(
      "History import requires a manual tracker; it must not enable a second paid scheduler.",
    );
  if (
    config.locationName !== null ||
    config.domain !== input.targetDomain ||
    config.locationCode !== input.locationCode ||
    config.languageCode !== input.languageCode ||
    config.serpDepth !== input.depth
  ) {
    invalid(
      "Source domain, national market, language and depth must match the tracker exactly.",
    );
  }
  const seen = new Set<string>();
  for (const row of input.observations) {
    const key = `${row.keyword}:${row.device}`;
    if (seen.has(key)) invalid("Duplicate keyword/device in the source run.");
    seen.add(key);
    if (config.devices !== "both" && config.devices !== row.device)
      invalid("Source device does not match the tracker.");
    if (new Date(row.checkedAt).getTime() > Date.now() + 60_000)
      invalid("Historical observation cannot be in the future.");
    if (row.state === "not_in_window") {
      if (row.position !== null || row.url !== null)
        invalid("Not-found observations must retain null position and URL.");
    } else {
      if (
        row.position === null ||
        row.position > input.depth ||
        row.url === null
      )
        invalid(
          "Found observation requires a position within source depth and a URL.",
        );
      const url = new URL(row.url);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        (url.hostname !== config.domain &&
          !url.hostname.endsWith(`.${config.domain}`))
      )
        invalid("Ranking URL belongs to a different domain.");
    }
  }
  const sourceKey = new TextEncoder().encode(
    `${input.trackerId}\n${input.sourceRunId}`,
  );
  const hash = [
    ...new Uint8Array(await crypto.subtle.digest("SHA-256", sourceKey)),
  ]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const runId = `import:dataforseo:${hash}`;
  const existing = await RankTrackingRepository.getRunById(runId);
  if (existing) {
    const rows = await RankTrackingRepository.getSnapshotsForRun(runId);
    const previous = rows.map((row) => ({
      ...row,
      checkedAt: new Date(
        row.checkedAt.includes("T")
          ? row.checkedAt
          : row.checkedAt.replace(" ", "T") + "Z",
      ).toISOString(),
      state:
        row.position === null ? ("not_in_window" as const) : ("found" as const),
      serpFeatures: z
        .array(z.string())
        .parse(JSON.parse(row.serpFeatures ?? "[]")),
    }));
    if (canonical(previous) !== canonical(input.observations))
      invalid(
        "Source run was already imported with different observations; existing history was not overwritten.",
      );
    return {
      runId,
      imported: 0,
      alreadyImported: rows.length,
      addedKeywords: 0,
    };
  }
  const keywords = [
    ...new Set([
      ...input.keywords,
      ...input.observations.map((row) => row.keyword),
    ]),
  ];
  const added = await RankTrackingKeywordService.addKeywords(
    input.trackerId,
    input.projectId,
    keywords,
    { kind: "direct_user_action" },
    true,
  );
  const tracked = await RankTrackingRepository.getKeywordsForConfig(
    input.trackerId,
  );
  const ids = new Map(tracked.map((row) => [row.keyword, row.id]));
  if (keywords.some((keyword) => !ids.has(keyword)))
    invalid("Tracker keyword capacity exceeded; no history was imported.");
  if (input.observations.length === 0)
    return {
      runId: null,
      imported: 0,
      alreadyImported: 0,
      addedKeywords: added.added,
    };
  const times = sortBy(
    input.observations.map((row) =>
      toRankTrackingTimestamp(new Date(row.checkedAt)),
    ),
    (time) => time,
  );
  await insertImportedHistory(
    {
      id: runId,
      configId: input.trackerId,
      projectId: input.projectId,
      status: "completed",
      keywordsTotal: new Set(input.observations.map((row) => row.keyword)).size,
      keywordsChecked: new Set(input.observations.map((row) => row.keyword))
        .size,
      isSubsetRun: true,
      startedAt: times[0],
      completedAt: times.at(-1),
    },
    input.observations.map((row) => ({
      runId,
      trackingKeywordId:
        ids.get(row.keyword) ?? invalid("Imported keyword missing"),
      keyword: row.keyword,
      device: row.device,
      position: row.position,
      url: row.url,
      checkedAt: toRankTrackingTimestamp(new Date(row.checkedAt)),
      serpFeatures: JSON.stringify(row.serpFeatures),
    })),
  );
  return {
    runId,
    imported: input.observations.length,
    alreadyImported: 0,
    addedKeywords: added.added,
  };
}

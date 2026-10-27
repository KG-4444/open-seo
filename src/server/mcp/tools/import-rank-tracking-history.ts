import { z } from "zod";
import {
  rankHistoryImportSchema,
  type RankHistoryImport,
} from "@/types/schemas/rank-history-import";
import { importRankHistory } from "@/server/features/rank-tracking/services/importRankHistory";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import { mcpResponse } from "@/server/mcp/formatters";

export const importRankTrackingHistoryTool = {
  name: "import_rank_tracking_history",
  config: {
    title: "Import existing rank history",
    description:
      "Import real, already-collected DataForSEO observations into an existing manual tracker without any provider request or credit spend. Preserve original checkedAt; use a stable sourceRunId per immutable source batch, and keep the source evidence mapping. Domain, national market, language, depth and device must match exactly. Found and verified not-in-window are accepted; errors and missing checks are not observations. Never invent history. Repeating identical history is a no-op; changed history is rejected. Optional keywords adds tracking rows without fetching paid metrics.",
    inputSchema: rankHistoryImportSchema.shape,
    outputSchema: z.looseObject({
      runId: z.string().nullable(),
      imported: z.number(),
      alreadyImported: z.number(),
      addedKeywords: z.number(),
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
      idempotentHint: true,
    },
  },
  handler: withMcpProjectAuth(async (args: RankHistoryImport) => {
    const result = await importRankHistory(args);
    return mcpResponse({
      text: `Imported ${result.imported} existing observations; ${result.alreadyImported} already imported; ${result.addedKeywords} keywords added. No provider requests or credits used.`,
      structuredContent: result,
    });
  }),
};

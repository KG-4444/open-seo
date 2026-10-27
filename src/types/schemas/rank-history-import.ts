import { z } from "zod";

export const rankHistoryImportSchema = z.object({
  projectId: z.string().uuid(),
  trackerId: z.string().uuid(),
  sourceRunId: z.string().trim().min(1).max(500),
  targetDomain: z.string().trim().min(1).max(253),
  locationCode: z.number().int().positive(),
  languageCode: z.string().min(1).max(20),
  depth: z.number().int().min(10).max(100).multipleOf(10),
  keywords: z.array(z.string().trim().min(1).max(300)).max(100).default([]),
  observations: z
    .array(
      z.object({
        keyword: z.string().trim().min(1).max(300),
        device: z.enum(["desktop", "mobile"]),
        checkedAt: z.string().datetime({ offset: true }),
        state: z.enum(["found", "not_in_window"]),
        position: z.number().int().positive().nullable(),
        url: z.string().url().nullable(),
        serpFeatures: z.array(z.string().max(100)).max(50).default([]),
      }),
    )
    .max(80),
});

export type RankHistoryImport = z.infer<typeof rankHistoryImportSchema>;

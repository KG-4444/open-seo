import { z } from "zod";
import {
  createDataforseoClient,
  fetchRankCheckTaskResult,
} from "@/server/lib/dataforseo";
import { buildProjectMeta } from "@/server/mcp/context";
import { mcpResponse } from "@/server/mcp/formatters";
import { optionalMetaOutputSchema } from "@/server/mcp/output-schemas";
import { withMcpProjectAuth } from "@/server/mcp/project-auth";
import {
  languageCodeSchema,
  locationCodeSchema,
  projectIdSchema,
} from "@/server/mcp/schemas";

const deviceSchema = z.enum(["desktop", "mobile"]);
const keywordIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9._-]+$/);
const keywordSchema = z.string().trim().min(1).max(200);
const taskIdSchema = z
  .string()
  .min(10)
  .max(100)
  .regex(/^[A-Za-z0-9-]+$/);
const targetDomainSchema = z
  .string()
  .trim()
  .min(3)
  .max(253)
  .regex(
    /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/,
  );
const depthSchema = z
  .number()
  .int()
  .min(10)
  .max(100)
  .refine((value) => value % 10 === 0, {
    message: "depth must be a multiple of 10",
  });

const queuedTaskInputSchema = z.object({
  keywordId: keywordIdSchema,
  keyword: keywordSchema,
  device: deviceSchema,
});

const postedTaskSchema = queuedTaskInputSchema.extend({
  taskId: taskIdSchema,
});

const postInputSchema = {
  projectId: projectIdSchema,
  tasks: z.array(queuedTaskInputSchema).min(1).max(100),
  locationCode: locationCodeSchema,
  languageCode: languageCodeSchema,
  depth: depthSchema,
  targetDomain: targetDomainSchema,
} as const;

const collectInputSchema = {
  projectId: projectIdSchema,
  tasks: z.array(postedTaskSchema).min(1).max(25),
  targetDomain: targetDomainSchema,
} as const;

type PostArgs = z.infer<z.ZodObject<typeof postInputSchema>>;
type CollectArgs = z.infer<z.ZodObject<typeof collectInputSchema>>;

const collectedTaskSchema = postedTaskSchema.extend({
  status: z.enum(["pending", "failed", "completed"]),
  position: z.number().int().positive().nullable().optional(),
  url: z.string().url().nullable().optional(),
  serpFeatures: z.array(z.string()).optional(),
  error: z.string().optional(),
});

export const postQueuedRankChecksTool = {
  name: "post_queued_rank_checks",
  config: {
    title: "Post queued rank checks",
    description:
      "Submit 1-100 Google organic rank checks to DataForSEO's lower-cost standard queue. Returns every accepted task ID and provider-reported cost metadata. This tool never uses the live SERP fallback.",
    inputSchema: postInputSchema,
    outputSchema: z.looseObject({
      method: z.literal("standard_queue"),
      submittedCount: z.number().int().nonnegative(),
      acceptedCount: z.number().int().nonnegative(),
      tasks: z.array(postedTaskSchema.passthrough()),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: PostArgs, context) => {
    const client = createDataforseoClient(context.billing);
    const posted = await client.serp.rankCheckTaskPost({
      tasks: args.tasks,
      locationCode: args.locationCode,
      languageCode: args.languageCode,
      depth: args.depth,
      targetDomain: args.targetDomain,
    });
    const structuredContent = {
      method: "standard_queue" as const,
      submittedCount: args.tasks.length,
      acceptedCount: posted.length,
      tasks: posted,
    };
    return mcpResponse({
      text:
        `Submitted ${args.tasks.length} standard-queue rank checks; ` +
        `${posted.length} accepted. No live fallback was attempted.`,
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/rank-tracking`,
      ),
      structuredContent,
    });
  }),
};

export const collectQueuedRankChecksTool = {
  name: "collect_queued_rank_checks",
  config: {
    title: "Collect queued rank checks",
    description:
      "Poll 1-25 previously accepted DataForSEO standard-queue tasks. Collection is free and returns explicit pending, failed, or completed outcomes. This tool never uses the live SERP fallback.",
    inputSchema: collectInputSchema,
    outputSchema: z.looseObject({
      method: z.literal("standard_queue"),
      results: z.array(collectedTaskSchema.passthrough()),
      ...optionalMetaOutputSchema,
    }),
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    },
  },
  handler: withMcpProjectAuth(async (args: CollectArgs, context) => {
    const settled = await Promise.all(
      args.tasks.map(async (task) => {
        try {
          const outcome = await fetchRankCheckTaskResult({
            taskId: task.taskId,
            keywordId: task.keywordId,
            keyword: task.keyword,
            targetDomain: args.targetDomain,
          });
          if (outcome.status === "completed") {
            return {
              ...task,
              status: outcome.status,
              position: outcome.result.position,
              url: outcome.result.url,
              serpFeatures: outcome.result.serpFeatures,
            };
          }
          if (outcome.status === "failed") {
            return {
              ...task,
              status: outcome.status,
              error: outcome.message.slice(0, 240),
            };
          }
          return { ...task, status: outcome.status };
        } catch (error) {
          return {
            ...task,
            status: "pending" as const,
            error: (error instanceof Error
              ? error.message
              : String(error)
            ).slice(0, 240),
          };
        }
      }),
    );
    const counts = {
      completed: settled.filter((row) => row.status === "completed").length,
      pending: settled.filter((row) => row.status === "pending").length,
      failed: settled.filter((row) => row.status === "failed").length,
    };
    return mcpResponse({
      text:
        `Collected standard-queue rank checks: ${counts.completed} completed, ` +
        `${counts.pending} pending, ${counts.failed} failed. ` +
        "No live fallback was attempted.",
      meta: buildProjectMeta(
        context,
        args.projectId,
        `/p/${args.projectId}/rank-tracking`,
      ),
      structuredContent: {
        method: "standard_queue" as const,
        results: settled,
      },
    });
  }),
};

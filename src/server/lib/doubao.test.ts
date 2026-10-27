import { generateText, Output } from "ai";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import { buildChatAgentModel, getOpenRouterAccess } from "./openrouter";

it("uses the selected Doubao endpoint, model, structured output and real token usage without a fallback", async () => {
  const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json({
      id: "test-completion",
      object: "chat.completion",
      created: 1,
      model: "doubao-seed-2.0-lite",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: '{"answer":"ok"}' },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  );
  const access = getOpenRouterAccess({
    AI_PROVIDER: "doubao",
    DOUBAO_API_KEY: "test-private-key",
    DOUBAO_BASE_URL: "https://ark.example/api/plan/v3",
    DOUBAO_MODEL: "doubao-seed-2.0-lite",
  });
  expect(access).not.toBeNull();
  const result = await generateText({
    model: buildChatAgentModel(access!),
    prompt: "Return ok",
    output: Output.object({ schema: z.object({ answer: z.string() }) }),
  });
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]?.[0]).toBe(
    "https://ark.example/api/plan/v3/chat/completions",
  );
  const requestBody = request.mock.calls[0]?.[1]?.body;
  if (typeof requestBody !== "string")
    throw new Error("Expected JSON request body");
  const body: unknown = JSON.parse(requestBody);
  expect(body).toMatchObject({
    model: "doubao-seed-2.0-lite",
    thinking: { type: "disabled" },
    response_format: { type: "json_schema" },
  });
  expect(result.output).toEqual({ answer: "ok" });
  expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 5 });
});

it("does not use another provider when Doubao configuration is incomplete", () => {
  expect(() =>
    getOpenRouterAccess({
      AI_PROVIDER: "doubao",
      OPENROUTER_API_KEY: "not-a-fallback",
    }),
  ).toThrow("DOUBAO_API_KEY");
});

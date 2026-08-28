import { aiProductAnalysisJsonSchema, aiProductAnalysisSchema, type AiProductAnalysis } from "./product-analysis";
import { businessGapAnalysisJsonSchema, businessGapAnalysisSchema, type BusinessGapAnalysis } from "./business-gap-analysis";
import { businessSelectionJsonSchema, businessSelectionSchema, type BusinessSelectionAnalysis } from "./business-selection";
import { z } from "zod";

export interface AiUsage { inputTokens: number; outputTokens: number; requests: number }
export class AiApiError extends Error { constructor(message: string, readonly code: string, readonly status: number | null) { super(message); this.name = "AiApiError"; } }
export interface AiClientOptions { apiKey: string; model: string; timeoutMs?: number; maxRetries?: number }

const wait = async (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class OpenAiProductClient {
  constructor(private readonly options: AiClientOptions) {}

  async analyze(system: string, input: string): Promise<{ analysis: AiProductAnalysis; raw: unknown; usage: AiUsage }> {
    return this.request(system, input, aiProductAnalysisJsonSchema, aiProductAnalysisSchema);
  }

  async analyzeBusiness(system: string, input: string): Promise<{ analysis: BusinessGapAnalysis; raw: unknown; usage: AiUsage }> {
    return this.request(system, input, businessGapAnalysisJsonSchema, businessGapAnalysisSchema);
  }

  async analyzeBusinessSelection(system: string, input: string): Promise<{ analysis: BusinessSelectionAnalysis; raw: unknown; usage: AiUsage }> {
    return this.request(system, input, businessSelectionJsonSchema, businessSelectionSchema);
  }

  private async request<T>(system: string, input: string, jsonSchema: object, parser: z.ZodType<T>): Promise<{ analysis: T; raw: unknown; usage: AiUsage }> {
    let requests = 0;
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= (this.options.maxRetries ?? 4); attempt += 1) {
      try {
        requests += 1;
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST", signal: AbortSignal.timeout(this.options.timeoutMs ?? 120_000),
          headers: { Authorization: `Bearer ${this.options.apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: this.options.model, store: false, reasoning: { effort: "low" }, max_output_tokens: 2200,
            input: [{ role: "system", content: system }, { role: "user", content: input }],
            text: { format: { type: "json_schema", name: "github_product_analysis", strict: true, schema: jsonSchema } },
          }),
        });
        if (!response.ok) {
          const message = await response.text();
          if ((response.status === 429 || response.status >= 500) && attempt < (this.options.maxRetries ?? 4)) {
            const retryAfter = Number(response.headers.get("retry-after"));
            await wait(Number.isFinite(retryAfter) ? retryAfter * 1000 : Math.min(30_000, 750 * 2 ** attempt));
            continue;
          }
          throw new AiApiError(message.slice(0, 1000), `http_${response.status}`, response.status);
        }
        const raw: unknown = await response.json();
        if (!raw || typeof raw !== "object") throw new AiApiError("Invalid Responses API payload", "invalid_response", null);
        const record = raw as { output?: Array<{ content?: Array<{ type?: string; text?: string; refusal?: string }> }>; usage?: { input_tokens?: number; output_tokens?: number } };
        const content = record.output?.flatMap((item) => item.content ?? []) ?? [];
        const refusal = content.find((item) => item.type === "refusal")?.refusal;
        if (refusal) throw new AiApiError(refusal, "refusal", 200);
        const outputText = content.find((item) => item.type === "output_text")?.text;
        if (!outputText) throw new AiApiError("Response did not contain output_text", "missing_output", 200);
        const analysis = parser.parse(JSON.parse(outputText));
        return { analysis, raw, usage: { requests, inputTokens: record.usage?.input_tokens ?? 0, outputTokens: record.usage?.output_tokens ?? 0 } };
      } catch (cause) {
        const error = cause instanceof Error ? cause : new Error(String(cause));
        lastError = error;
        if (error instanceof AiApiError || attempt >= (this.options.maxRetries ?? 4)) throw error;
        await wait(Math.min(30_000, 750 * 2 ** attempt));
      }
    }
    throw lastError ?? new AiApiError("AI request failed", "unknown", null);
  }
}

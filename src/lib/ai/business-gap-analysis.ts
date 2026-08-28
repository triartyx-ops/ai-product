import { AiShortlistTier } from "@prisma/client";
import { z } from "zod";

import { aiProductAnalysisJsonSchema, aiProductAnalysisSchema, analysisPrompt, type AnalysisInput } from "./product-analysis";

export const businessGapAnalysisSchema = aiProductAnalysisSchema.extend({
  previousStageStatus: z.nativeEnum(AiShortlistTier).nullable(),
  previousScore: z.number().int().min(0).max(100).nullable(),
  reevaluationReason: z.string().min(1).max(800).nullable(),
  discoveryReason: z.string().min(1).max(800).nullable(),
  scoreChanged: z.boolean(),
  scoreDelta: z.number().int().min(-100).max(100).nullable(),
  buyerValueProposition: z.string().min(1).max(300),
  clientProjectExamples: z.array(z.string().min(1).max(120)).max(3),
});
export type BusinessGapAnalysis = z.infer<typeof businessGapAnalysisSchema>;

const nullableTier = { anyOf: [{ type: "string", enum: Object.values(AiShortlistTier) }, { type: "null" }] } as const;
const nullableScore = { anyOf: [{ type: "integer", minimum: 0, maximum: 100 }, { type: "null" }] } as const;
const nullableDelta = { anyOf: [{ type: "integer", minimum: -100, maximum: 100 }, { type: "null" }] } as const;
const nullableString = { anyOf: [{ type: "string" }, { type: "null" }] } as const;
const v2Properties = {
  ...aiProductAnalysisJsonSchema.properties,
  previousStageStatus: nullableTier,
  previousScore: nullableScore,
  reevaluationReason: nullableString,
  discoveryReason: nullableString,
  scoreChanged: { type: "boolean" },
  scoreDelta: nullableDelta,
  buyerValueProposition: { type: "string" },
  clientProjectExamples: { type: "array", items: { type: "string" }, maxItems: 3 },
} as const;
export const businessGapAnalysisJsonSchema = {
  type: "object", properties: v2Properties, required: Object.keys(v2Properties), additionalProperties: false,
} as const;

export interface BusinessGapContext {
  previousStageStatus: AiShortlistTier | null;
  previousScore: number | null;
  reevaluationReason: string | null;
  discoveryReason: string | null;
}

export function businessGapPrompt(input: AnalysisInput, context: BusinessGapContext, readmeMaxChars: number): string {
  return JSON.stringify({
    ...JSON.parse(analysisPrompt(input, readmeMaxChars)) as object,
    secondPassContext: context,
    instructions: [
      "Re-evaluate from README evidence; do not preserve the previous score by default.",
      "Business-category matches are discovery hints, not proof that this is a complete application.",
      "buyerValueProposition must be one concrete short Russian sentence describing what a bundle buyer receives.",
      "clientProjectExamples must contain at most three concrete adaptation targets and may be empty for non-products.",
    ],
  });
}

export const BUSINESS_GAP_SYSTEM_PROMPT = `You are performing a conservative second-pass audit for an open-source commercial application bundle. Use only supplied metadata and README. Correct false negatives when the README proves a usable standalone product, but do not rescue an unfinished prototype, library, framework, SDK, plugin, template fragment, collection, or developer infrastructure merely because it has UI words. Stars MUST NOT affect scores. A high Commercial Bundle Score requires a deployable, rebrandable, useful end-user application with a credible setup path. Explicitly compare with any previous result and give evidence. Normalize to the supplied product categories. Return concise structured output.`;

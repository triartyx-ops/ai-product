import { createHash } from "node:crypto";

import { AiProductCategory, AiShortlistTier, RepositoryKind } from "@prisma/client";
import { z } from "zod";

const score = z.number().int().min(0).max(100);
export const aiProductAnalysisSchema = z.object({
  aiRepositoryKind: z.nativeEnum(RepositoryKind),
  actualProductName: z.string().min(1).max(200),
  productCategory: z.nativeEnum(AiProductCategory),
  shortProductDescription: z.string().min(1).max(600),
  isCompleteApplication: z.boolean(), canBeSelfHosted: z.boolean(), hasMeaningfulUi: z.boolean(),
  requiresComplexInfrastructure: z.boolean(), canBeRebranded: z.boolean(), canBeUsedAsClientProject: z.boolean(),
  targetUsers: z.array(z.string().min(1).max(160)).max(8),
  businessUseCases: z.array(z.string().min(1).max(200)).max(8),
  majorSetupDependencies: z.array(z.string().min(1).max(160)).max(12),
  potentialBundlePositioning: z.string().min(1).max(500), analysisConfidence: score,
  productCompletenessScore: score, businessUsefulnessScore: score, easeOfDeploymentScore: score,
  easeOfCustomizationScore: score, visualDemoValueScore: score, clientResalePotentialScore: score,
  bundleUniquenessScore: score, commercialBundleScore: score,
  bundleScoreReasons: z.array(z.string().min(1).max(240)).min(2).max(8),
});
export type AiProductAnalysis = z.infer<typeof aiProductAnalysisSchema>;

const stringArray = { type: "array", items: { type: "string" }, maxItems: 12 } as const;
const integerScore = { type: "integer", minimum: 0, maximum: 100 } as const;
const properties = {
  aiRepositoryKind: { type: "string", enum: Object.values(RepositoryKind) }, actualProductName: { type: "string" },
  productCategory: { type: "string", enum: Object.values(AiProductCategory) }, shortProductDescription: { type: "string" },
  isCompleteApplication: { type: "boolean" }, canBeSelfHosted: { type: "boolean" }, hasMeaningfulUi: { type: "boolean" },
  requiresComplexInfrastructure: { type: "boolean" }, canBeRebranded: { type: "boolean" }, canBeUsedAsClientProject: { type: "boolean" },
  targetUsers: stringArray, businessUseCases: stringArray, majorSetupDependencies: stringArray,
  potentialBundlePositioning: { type: "string" }, analysisConfidence: integerScore,
  productCompletenessScore: integerScore, businessUsefulnessScore: integerScore, easeOfDeploymentScore: integerScore,
  easeOfCustomizationScore: integerScore, visualDemoValueScore: integerScore, clientResalePotentialScore: integerScore,
  bundleUniquenessScore: integerScore, commercialBundleScore: integerScore,
  bundleScoreReasons: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 8 },
} as const;
export const aiProductAnalysisJsonSchema = { type: "object", properties, required: Object.keys(properties), additionalProperties: false } as const;

export function shortlistTier(scoreValue: number): AiShortlistTier {
  if (scoreValue >= 80) return AiShortlistTier.STRONG;
  if (scoreValue >= 65) return AiShortlistTier.POSSIBLE;
  if (scoreValue >= 50) return AiShortlistTier.WEAK;
  return AiShortlistTier.REJECT;
}

export interface AnalysisInput {
  fullName: string; description: string | null; topics: string[]; homepage: string | null; stars: number | null;
  primaryLanguage: string | null; pushedAt: Date | null; license: string | null; readme: string;
  deterministicKind: RepositoryKind; productLikenessScore: number | null; templatePotentialScore: number | null;
}

export function inputFingerprint(input: AnalysisInput, promptVersion: string): string {
  return createHash("sha256").update(JSON.stringify({ ...input, pushedAt: input.pushedAt?.toISOString(), promptVersion })).digest("hex");
}

export function analysisPrompt(input: AnalysisInput, readmeMaxChars: number): string {
  const truncated = input.readme.length > readmeMaxChars;
  const readme = truncated ? `${input.readme.slice(0, readmeMaxChars)}\n\n[README TRUNCATED FOR COST CONTROL]` : input.readme;
  return JSON.stringify({
    repository: { ...input, readme, readmeTruncated: truncated },
    task: "Assess suitability as one deployable, documented, customizable product in a commercial bundle of 100 open-source applications. This is not a GitHub quality or popularity score.",
  });
}

export const PRODUCT_ANALYSIS_SYSTEM_PROMPT = `You are a conservative product analyst selecting open-source applications for a commercial bundle. Judge only evidence in metadata and README. Stars are context only and MUST NOT increase any score. A high Commercial Bundle Score means this repository is a complete usable product that a developer can deploy, rebrand, customize, document, and adapt for clients. Libraries, frameworks, code samples, courses, lists, research implementations, model weights, collections, plugins and developer-only utilities should normally score low even when popular. Penalize missing UI, unclear setup, complex infrastructure, dependence on paid/proprietary services, narrow use, and weak rebrandability. Prefer real business/user workflows and category diversity. Do not make legal conclusions. Return concise evidence-based structured output.`;

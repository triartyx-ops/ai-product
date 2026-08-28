import { createHash } from "node:crypto";

import { BusinessProductCategory, ComplexityLevel, RepositoryKind } from "@prisma/client";
import { z } from "zod";

const score = z.number().int().min(0).max(100);
export const businessSelectionSchema = z.object({
  actualProductName: z.string().min(1).max(200),
  productCategory: z.nativeEnum(BusinessProductCategory),
  secondaryCategories: z.array(z.nativeEnum(BusinessProductCategory)).max(5),
  shortProductDescription: z.string().min(1).max(600),
  whatUserGets: z.string().min(1).max(500),
  targetUsers: z.array(z.string().min(1).max(160)).max(8),
  businessUseCases: z.array(z.string().min(1).max(200)).max(8),
  isCompleteApplication: z.boolean(), isSelfHostable: z.boolean(), hasMeaningfulUi: z.boolean(),
  hasDemoOrScreenshots: z.boolean(), canBeRebranded: z.boolean(), canBeUsedForClientProjects: z.boolean(),
  requiresComplexInfrastructure: z.boolean(),
  majorDependencies: z.array(z.string().min(1).max(160)).max(12),
  likelySetupComplexity: z.nativeEnum(ComplexityLevel), likelyCustomizationComplexity: z.nativeEnum(ComplexityLevel),
  commercialRisks: z.array(z.string().min(1).max(240)).max(8), analysisConfidence: score,
  productCompletenessScore: score, businessUsefulnessScore: score, easeOfDeploymentScore: score,
  easeOfCustomizationScore: score, visualValueScore: score, clientProjectPotentialScore: score,
  endUserClarityScore: score, bundleUniquenessScore: score, commercialBundleScore: score,
  commercialBundleReasons: z.array(z.string().min(1).max(240)).min(2).max(8),
  buyerValueProposition: z.string().min(1).max(300),
  clientProjectExamples: z.array(z.string().min(1).max(120)).max(3),
});
export type BusinessSelectionAnalysis = z.infer<typeof businessSelectionSchema>;

const stringArray = { type: "array", items: { type: "string", maxLength: 160 }, maxItems: 12 } as const;
const integerScore = { type: "integer", minimum: 0, maximum: 100 } as const;
const properties = {
  actualProductName: { type: "string" }, productCategory: { type: "string", enum: Object.values(BusinessProductCategory) },
  secondaryCategories: { type: "array", items: { type: "string", enum: Object.values(BusinessProductCategory) }, maxItems: 5 },
  shortProductDescription: { type: "string" }, whatUserGets: { type: "string" }, targetUsers: stringArray,
  businessUseCases: stringArray, isCompleteApplication: { type: "boolean" }, isSelfHostable: { type: "boolean" },
  hasMeaningfulUi: { type: "boolean" }, hasDemoOrScreenshots: { type: "boolean" }, canBeRebranded: { type: "boolean" },
  canBeUsedForClientProjects: { type: "boolean" }, requiresComplexInfrastructure: { type: "boolean" },
  majorDependencies: stringArray, likelySetupComplexity: { type: "string", enum: Object.values(ComplexityLevel) },
  likelyCustomizationComplexity: { type: "string", enum: Object.values(ComplexityLevel) }, commercialRisks: stringArray,
  analysisConfidence: integerScore, productCompletenessScore: integerScore, businessUsefulnessScore: integerScore,
  easeOfDeploymentScore: integerScore, easeOfCustomizationScore: integerScore, visualValueScore: integerScore,
  clientProjectPotentialScore: integerScore, endUserClarityScore: integerScore, bundleUniquenessScore: integerScore,
  commercialBundleScore: integerScore, commercialBundleReasons: { type: "array", items: { type: "string", maxLength: 240 }, minItems: 2, maxItems: 8 },
  buyerValueProposition: { type: "string" }, clientProjectExamples: { type: "array", items: { type: "string" }, maxItems: 3 },
} as const;
export const businessSelectionJsonSchema = { type: "object", properties, required: Object.keys(properties), additionalProperties: false } as const;

export interface BusinessSelectionInput {
  fullName: string; description: string | null; topics: string[]; homepage: string | null; stars: number | null;
  primaryLanguage: string | null; license: string | null; pushedAt: Date | null; readme: string;
  repositoryKind: RepositoryKind; productLikenessScore: number | null; templatePotentialScore: number | null;
  targetBusinessCategories: string[]; searchQueries: string[]; existingAiAnalysis: unknown;
}

export function businessSelectionFingerprint(input: BusinessSelectionInput, promptVersion: string): string {
  return createHash("sha256").update(JSON.stringify({ ...input, pushedAt: input.pushedAt?.toISOString(), promptVersion })).digest("hex");
}

export function businessSelectionPrompt(input: BusinessSelectionInput, readmeMaxChars: number): string {
  const truncated = input.readme.length > readmeMaxChars;
  return JSON.stringify({ repository: { ...input, readme: truncated ? `${input.readme.slice(0, readmeMaxChars)}\n[README TRUNCATED]` : input.readme,
    readmeTruncated: truncated }, task: "Assess this repository as one independently valuable application in a commercial bundle of deployable, documented, customizable open-source products." });
}

export const BUSINESS_SELECTION_SYSTEM_PROMPT = `You are a conservative commercial product analyst. Use only supplied metadata and README. Search categories and queries are discovery hints, never proof. Stars are context only and MUST NOT increase scores. Reject or score low SDKs, libraries, frameworks, plugins, API wrappers, tutorials, samples, WordPress themes, collections, unfinished prototypes, and repositories whose usable UI/product lives elsewhere. A high Commercial Bundle Score requires a complete standalone application that can be self-hosted or packaged, explained to an end user in ten seconds, rebranded, customized with code, and credibly adapted for client work. Penalize unclear production setup, proprietary dependencies, complex infrastructure, narrow audiences, absent UI/demo evidence, and duplicate/common product concepts. Normalize productCategory strictly to the supplied enum. buyerValueProposition must be one concrete short Russian sentence. clientProjectExamples must contain at most three concrete adaptation targets and may be empty for rejected non-products. Return concise evidence-based structured output.`;

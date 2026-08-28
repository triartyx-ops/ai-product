import { AiProductCategory, BusinessProductCategory, ComplexityLevel, type RepositoryAiAnalysis } from "@prisma/client";

import type { BusinessSelectionAnalysis } from "./business-selection";

const CATEGORY_MAP: Partial<Record<AiProductCategory, BusinessProductCategory>> = {
  CRM: BusinessProductCategory.CRM, SALES: BusinessProductCategory.SALES, LEAD_MANAGEMENT: BusinessProductCategory.SALES,
  BOOKING: BusinessProductCategory.BOOKING, APPOINTMENTS: BusinessProductCategory.BOOKING, CALENDAR_BUSINESS: BusinessProductCategory.BOOKING,
  HR: BusinessProductCategory.HR, HRM: BusinessProductCategory.HR, ATS: BusinessProductCategory.ATS,
  INVOICING: BusinessProductCategory.INVOICING, ACCOUNTING: BusinessProductCategory.ACCOUNTING,
  FINANCE: BusinessProductCategory.FINANCE, EXPENSES: BusinessProductCategory.FINANCE, PAYROLL: BusinessProductCategory.PAYROLL,
  ERP: BusinessProductCategory.ERP, POS: BusinessProductCategory.POS, INVENTORY: BusinessProductCategory.INVENTORY,
  ECOMMERCE: BusinessProductCategory.ECOMMERCE, CUSTOMER_SUPPORT: BusinessProductCategory.CUSTOMER_SUPPORT,
  HELPDESK: BusinessProductCategory.CUSTOMER_SUPPORT, LIVE_CHAT: BusinessProductCategory.CUSTOMER_SUPPORT,
  PROJECT_MANAGEMENT: BusinessProductCategory.PROJECT_MANAGEMENT, PROPERTY_MANAGEMENT: BusinessProductCategory.PROPERTY_MANAGEMENT,
  REAL_ESTATE: BusinessProductCategory.REAL_ESTATE, RESTAURANT: BusinessProductCategory.RESTAURANT, HOTEL: BusinessProductCategory.HOTEL,
  LMS: BusinessProductCategory.LMS, COURSE_PLATFORM: BusinessProductCategory.LMS, CLIENT_PORTAL: BusinessProductCategory.CLIENT_PORTAL,
  FORM_BUILDER: BusinessProductCategory.FORMS, SURVEY: BusinessProductCategory.SURVEYS,
  MARKETING: BusinessProductCategory.MARKETING, EMAIL_MARKETING: BusinessProductCategory.EMAIL_MARKETING,
  SOCIAL_MEDIA: BusinessProductCategory.SOCIAL_MEDIA, TIME_TRACKING: BusinessProductCategory.TIME_TRACKING,
  DOCUMENT_MANAGEMENT: BusinessProductCategory.DOCUMENT_MANAGEMENT, CMS: BusinessProductCategory.CMS,
  ANALYTICS: BusinessProductCategory.ANALYTICS, DASHBOARD: BusinessProductCategory.DASHBOARD,
  AUTOMATION: BusinessProductCategory.AUTOMATION, PRODUCTIVITY: BusinessProductCategory.PRODUCTIVITY,
};

export function normalizeExistingCategory(category: AiProductCategory | null): BusinessProductCategory {
  return category ? CATEGORY_MAP[category] ?? BusinessProductCategory.OTHER : BusinessProductCategory.OTHER;
}

function array(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function complexity(score: number | null): ComplexityLevel {
  if (score === null) return ComplexityLevel.UNKNOWN;
  if (score >= 75) return ComplexityLevel.LOW;
  if (score >= 50) return ComplexityLevel.MEDIUM;
  return ComplexityLevel.HIGH;
}

export function reuseExistingAnalysis(analysis: RepositoryAiAnalysis, hasDemoEvidence: boolean, fallbackName: string): BusinessSelectionAnalysis {
  const productCompleteness = analysis.productCompletenessScore ?? analysis.commercialBundleScore ?? 0;
  const businessUsefulness = analysis.businessUsefulnessScore ?? analysis.commercialBundleScore ?? 0;
  const commercialScore = analysis.commercialBundleScore ?? 0;
  const description = analysis.shortProductDescription ?? analysis.potentialBundlePositioning ?? fallbackName;
  return {
    actualProductName: analysis.actualProductName ?? fallbackName,
    productCategory: normalizeExistingCategory(analysis.productCategory), secondaryCategories: [],
    shortProductDescription: description, whatUserGets: analysis.buyerValueProposition ?? description,
    targetUsers: array(analysis.targetUsers), businessUseCases: array(analysis.businessUseCases),
    isCompleteApplication: analysis.isCompleteApplication ?? false, isSelfHostable: analysis.canBeSelfHosted ?? false,
    hasMeaningfulUi: analysis.hasMeaningfulUi ?? false, hasDemoOrScreenshots: hasDemoEvidence,
    canBeRebranded: analysis.canBeRebranded ?? false, canBeUsedForClientProjects: analysis.canBeUsedAsClientProject ?? false,
    requiresComplexInfrastructure: analysis.requiresComplexInfrastructure ?? true,
    majorDependencies: array(analysis.majorSetupDependencies), likelySetupComplexity: complexity(analysis.easeOfDeploymentScore),
    likelyCustomizationComplexity: complexity(analysis.easeOfCustomizationScore), commercialRisks: array(analysis.bundleScoreReasons),
    analysisConfidence: analysis.analysisConfidence ?? 60, productCompletenessScore: productCompleteness,
    businessUsefulnessScore: businessUsefulness, easeOfDeploymentScore: analysis.easeOfDeploymentScore ?? 50,
    easeOfCustomizationScore: analysis.easeOfCustomizationScore ?? 50, visualValueScore: analysis.visualDemoValueScore ?? 40,
    clientProjectPotentialScore: analysis.clientResalePotentialScore ?? 40,
    endUserClarityScore: Math.round((productCompleteness + businessUsefulness) / 2),
    bundleUniquenessScore: analysis.bundleUniquenessScore ?? 50, commercialBundleScore: commercialScore,
    commercialBundleReasons: array(analysis.bundleScoreReasons).length >= 2 ? array(analysis.bundleScoreReasons) : ["Reused current structured AI analysis.", "Commercial score preserved from the existing analysis."],
    buyerValueProposition: analysis.buyerValueProposition ?? description,
    clientProjectExamples: array(analysis.clientProjectExamples).slice(0, 3),
  };
}

export type DeepTestCandidate = {
  id: bigint;
  repository: string;
  category: string;
  bundleScore: number;
  description: string | null;
  buyerValueProposition: string | null;
  businessUsefulnessScore: number | null;
  easeOfDeploymentScore: number | null;
  easeOfCustomizationScore: number | null;
  visualValueScore: number | null;
  clientProjectPotentialScore: number | null;
  endUserClarityScore: number | null;
};

export type SelectedDeepTestCandidate = DeepTestCandidate & {
  selectionScore: number;
  selectionGroup: string;
  reasonSelected: string;
};

export type NearDuplicateExclusion = {
  repository: string;
  similarTo: string;
  category: string;
  similarity: number;
};

type Target = { minimum: number; maximum: number };

export const DEEP_TEST_TARGETS: Record<string, Target> = {
  CRM_SALES: { minimum: 10, maximum: 15 },
  BOOKING: { minimum: 8, maximum: 12 },
  HR_ATS: { minimum: 6, maximum: 10 },
  FINANCE: { minimum: 8, maximum: 12 },
  ERP_INVENTORY_POS: { minimum: 10, maximum: 15 },
  ECOMMERCE: { minimum: 5, maximum: 10 },
  CUSTOMER_SUPPORT: { minimum: 5, maximum: 8 },
  PROJECT_MANAGEMENT: { minimum: 8, maximum: 12 },
  PROPERTY_REAL_ESTATE: { minimum: 4, maximum: 7 },
  LMS: { minimum: 4, maximum: 7 },
  CMS: { minimum: 5, maximum: 8 },
  ANALYTICS_DASHBOARD: { minimum: 8, maximum: 12 },
  AUTOMATION: { minimum: 8, maximum: 12 },
  AI: { minimum: 8, maximum: 12 },
  PRODUCTIVITY: { minimum: 8, maximum: 12 },
  CONTENT_MEDIA: { minimum: 5, maximum: 10 },
  DEVELOPER_PRODUCT: { minimum: 0, maximum: 20 },
};

export function categoryGroup(category: string): string {
  if (["CRM", "SALES", "LEAD_MANAGEMENT"].includes(category)) return "CRM_SALES";
  if (["BOOKING", "APPOINTMENTS", "CALENDAR_BUSINESS"].includes(category)) return "BOOKING";
  if (["HR", "HRM", "ATS"].includes(category)) return "HR_ATS";
  if (["INVOICING", "ACCOUNTING", "FINANCE", "EXPENSES", "PAYROLL"].includes(category)) return "FINANCE";
  if (["ERP", "INVENTORY", "POS"].includes(category)) return "ERP_INVENTORY_POS";
  if (category === "ECOMMERCE") return "ECOMMERCE";
  if (["CUSTOMER_SUPPORT", "HELPDESK", "LIVE_CHAT"].includes(category)) return "CUSTOMER_SUPPORT";
  if (category === "PROJECT_MANAGEMENT") return "PROJECT_MANAGEMENT";
  if (["PROPERTY_MANAGEMENT", "REAL_ESTATE"].includes(category)) return "PROPERTY_REAL_ESTATE";
  if (["LMS", "COURSE_PLATFORM"].includes(category)) return "LMS";
  if (category === "CMS") return "CMS";
  if (["ANALYTICS", "DASHBOARD"].includes(category)) return "ANALYTICS_DASHBOARD";
  if (category === "AUTOMATION") return "AUTOMATION";
  if (["AI", "AI_ASSISTANT", "AI_AGENT"].includes(category)) return "AI";
  if (["PRODUCTIVITY", "FILE_MANAGEMENT", "DOCUMENT_MANAGEMENT", "TIME_TRACKING"].includes(category)) return "PRODUCTIVITY";
  if (["CONTENT", "SOCIAL_MEDIA", "COMMUNICATION"].includes(category)) return "CONTENT_MEDIA";
  if (["DEVELOPER_PRODUCT", "SECURITY"].includes(category)) return "DEVELOPER_PRODUCT";
  return "OTHER_BUSINESS";
}

export function deepTestSelectionScore(candidate: DeepTestCandidate): number {
  const componentValues = [
    candidate.businessUsefulnessScore,
    candidate.easeOfDeploymentScore,
    candidate.easeOfCustomizationScore,
    candidate.visualValueScore,
    candidate.clientProjectPotentialScore,
    candidate.endUserClarityScore,
  ];
  if (componentValues.every((value) => value === null)) return candidate.bundleScore;
  const value = candidate.bundleScore * 0.52
    + (candidate.businessUsefulnessScore ?? candidate.bundleScore) * 0.12
    + (candidate.easeOfDeploymentScore ?? candidate.bundleScore) * 0.08
    + (candidate.easeOfCustomizationScore ?? candidate.bundleScore) * 0.08
    + (candidate.visualValueScore ?? candidate.bundleScore) * 0.07
    + (candidate.clientProjectPotentialScore ?? candidate.bundleScore) * 0.08
    + (candidate.endUserClarityScore ?? candidate.bundleScore) * 0.05;
  return Math.round(value);
}

function tokens(candidate: DeepTestCandidate): Set<string> {
  const text = `${candidate.repository.split("/").at(-1) ?? ""} ${candidate.description ?? ""} ${candidate.buyerValueProposition ?? ""}`.toLowerCase();
  return new Set(text.replace(/[^\p{L}\p{N}]+/gu, " ").split(/\s+/).filter((token) => token.length >= 4 && ![
    "open", "source", "self", "hosted", "application", "system", "platform", "ready", "management", "готовая", "система", "управления",
  ].includes(token)));
}

export function tokenSimilarity(left: DeepTestCandidate, right: DeepTestCandidate): number {
  const a = tokens(left); const b = tokens(right);
  if (!a.size || !b.size) return 0;
  const intersection = [...a].filter((token) => b.has(token)).length;
  return intersection / (a.size + b.size - intersection);
}

export function selectDeepTestCandidates(candidates: DeepTestCandidate[], limit = 150): {
  selected: SelectedDeepTestCandidate[];
  nearDuplicates: NearDuplicateExclusion[];
} {
  const scored = candidates.map((candidate) => ({ ...candidate, selectionScore: deepTestSelectionScore(candidate), selectionGroup: categoryGroup(candidate.category) }))
    .sort((a, b) => b.selectionScore - a.selectionScore || b.bundleScore - a.bundleScore || a.repository.localeCompare(b.repository));
  const selected: typeof scored = []; const selectedIds = new Set<bigint>(); const nearDuplicates: NearDuplicateExclusion[] = [];
  const groupCount = new Map<string, number>();
  const trySelect = (candidate: typeof scored[number]): boolean => {
    if (selectedIds.has(candidate.id) || selected.length >= limit) return false;
    const target = DEEP_TEST_TARGETS[candidate.selectionGroup];
    if (target && (groupCount.get(candidate.selectionGroup) ?? 0) >= target.maximum) return false;
    const similar = selected.find((entry) => entry.selectionGroup === candidate.selectionGroup && tokenSimilarity(entry, candidate) >= 0.62);
    if (similar) {
      nearDuplicates.push({ repository: candidate.repository, similarTo: similar.repository, category: candidate.category,
        similarity: Number(tokenSimilarity(similar, candidate).toFixed(3)) });
      return false;
    }
    selected.push(candidate); selectedIds.add(candidate.id);
    groupCount.set(candidate.selectionGroup, (groupCount.get(candidate.selectionGroup) ?? 0) + 1);
    return true;
  };
  for (const [group, target] of Object.entries(DEEP_TEST_TARGETS)) {
    for (const candidate of scored.filter((entry) => entry.selectionGroup === group)) {
      if ((groupCount.get(group) ?? 0) >= target.minimum) break;
      trySelect(candidate);
    }
  }
  for (const candidate of scored) trySelect(candidate);
  const ranked = selected.sort((a, b) => b.selectionScore - a.selectionScore || b.bundleScore - a.bundleScore).map((candidate) => ({
    ...candidate,
    reasonSelected: `${candidate.bundleScore >= 80 ? "STRONG" : "POSSIBLE"} commercial candidate; selected for ${candidate.selectionGroup} coverage with ${candidate.selectionScore}/100 composite deployment, customization, visual and business value.`,
  }));
  return { selected: ranked, nearDuplicates };
}

import { describe, expect, it } from "vitest";

import { categoryGroup, deepTestSelectionScore, selectDeepTestCandidates, type DeepTestCandidate } from "@/lib/ai/deep-test-selection";

const candidate = (id: number, category: string, repository = `owner/product-${id}`): DeepTestCandidate => ({
  id: BigInt(id), repository, category, bundleScore: 80, description: `Distinct ${category} workflow ${id}`,
  buyerValueProposition: `A useful ${category} product ${id}`, businessUsefulnessScore: 85,
  easeOfDeploymentScore: 75, easeOfCustomizationScore: 80, visualValueScore: 78,
  clientProjectPotentialScore: 84, endUserClarityScore: 88,
});

describe("deep-test selection", () => {
  it("normalizes related categories into diversity groups", () => {
    expect(categoryGroup("CRM")).toBe("CRM_SALES");
    expect(categoryGroup("INVOICING")).toBe("FINANCE");
    expect(categoryGroup("AI_AGENT")).toBe("AI");
  });

  it("computes a score in the valid range", () => {
    expect(deepTestSelectionScore(candidate(1, "CRM"))).toBeGreaterThanOrEqual(0);
    expect(deepTestSelectionScore(candidate(1, "CRM"))).toBeLessThanOrEqual(100);
  });

  it("caps categories and removes near duplicates", () => {
    const values = Array.from({ length: 20 }, (_, index) => candidate(index + 1, "CRM"));
    values.push({ ...candidate(100, "CRM", "other/product-1"), description: values[0]!.description, buyerValueProposition: values[0]!.buyerValueProposition });
    const result = selectDeepTestCandidates(values, 30);
    expect(result.selected.length).toBeLessThanOrEqual(15);
    expect(result.nearDuplicates.some((entry) =>
      new Set([entry.repository, entry.similarTo]).has("other/product-1")
      && new Set([entry.repository, entry.similarTo]).has("owner/product-1"))).toBe(true);
  });
});

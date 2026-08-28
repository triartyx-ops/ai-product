import { CandidateStatus, GitHubEnrichmentStatus, LicenseCategory, RepositoryKind } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { metadataCandidateStatus } from "@/lib/screening/gate";
import { classifyLicense } from "@/lib/screening/license";
import { classifyProduct } from "@/lib/screening/product";
import { shortlistTier } from "@/lib/ai/product-analysis";

describe("license screening", () => {
  it.each([
    ["MIT", LicenseCategory.PERMISSIVE], ["Apache-2.0", LicenseCategory.PERMISSIVE], ["GPL-3.0", LicenseCategory.COPYLEFT],
    ["MPL-2.0", LicenseCategory.COPYLEFT], [null, LicenseCategory.NO_LICENSE], ["BUSL-1.1", LicenseCategory.RESTRICTED],
  ])("classifies %s", (spdx, category) => expect(classifyLicense(spdx).category).toBe(category));

  it("opens only active permissive repositories into the V1 metadata pool", () => {
    expect(metadataCandidateStatus({ enrichmentStatus: GitHubEnrichmentStatus.ENRICHED, archived: false, disabled: false, licenseCategory: LicenseCategory.PERMISSIVE, daysSinceLastPush: 365 })).toBe(CandidateStatus.CANDIDATE);
    expect(metadataCandidateStatus({ enrichmentStatus: GitHubEnrichmentStatus.ENRICHED, archived: false, disabled: false, licenseCategory: LicenseCategory.PERMISSIVE, daysSinceLastPush: 366 })).toBe(CandidateStatus.REVIEW);
  });
});

describe("deterministic product classifier", () => {
  it("recognizes a self-hosted business application", () => {
    const result = classifyProduct({
      name: "acme-crm", description: "Self-hosted CRM with dashboard and team collaboration", topics: ["crm", "self-hosted"], homepage: "https://example.test",
      primaryLanguage: "TypeScript", daysSinceLastPush: 12, stars: 100, readmeText: "# CRM\n## Installation\ndocker-compose up\nLogin to the dashboard. ![Screenshot](screen.png)",
    }, CandidateStatus.CANDIDATE);
    expect(result.kind).toBe(RepositoryKind.APPLICATION);
    expect(result.candidateStatus).toBe(CandidateStatus.CANDIDATE);
    expect(result.productLikenessScore).toBeGreaterThanOrEqual(70);
  });

  it("excludes a popular curated list regardless of stars", () => {
    const result = classifyProduct({
      name: "awesome-tools", description: "A curated list of developer resources", topics: ["awesome"], homepage: null,
      primaryLanguage: null, daysSinceLastPush: 1, stars: 500_000, readmeText: "# Awesome Tools\nA curated list of resources.",
    }, CandidateStatus.CANDIDATE);
    expect(result.kind).toBe(RepositoryKind.AWESOME_LIST);
    expect(result.candidateStatus).toBe(CandidateStatus.EXCLUDED);
    expect(result.templatePotentialScore).toBeLessThan(20);
  });

  it("keeps developer toolkits out of the commercial application pool", () => {
    const result = classifyProduct({
      name: "Agent Toolkit", description: "A toolkit of skills and tools for coding agents", topics: [], homepage: "https://example.test",
      primaryLanguage: "TypeScript", daysSinceLastPush: 5, stars: 100, readmeText: "![preview](preview.png) Docker installation and dashboard",
    }, CandidateStatus.CANDIDATE);
    expect(result.kind).toBe(RepositoryKind.DEV_TOOL);
    expect(result.candidateStatus).toBe(CandidateStatus.REVIEW);
  });
});

describe("AI selection helpers", () => {
  it.each([[80, "STRONG"], [79, "POSSIBLE"], [65, "POSSIBLE"], [64, "WEAK"], [50, "WEAK"], [49, "REJECT"]] as const)("maps %i to %s", (score, tier) => {
    expect(shortlistTier(score)).toBe(tier);
  });
});

import { CandidateStatus, GitHubEnrichmentStatus, LicenseCategory } from "@prisma/client";

export interface MetadataGateInput {
  enrichmentStatus: GitHubEnrichmentStatus;
  archived: boolean | null;
  disabled: boolean | null;
  licenseCategory: LicenseCategory;
  daysSinceLastPush: number | null;
}

export function metadataCandidateStatus(input: MetadataGateInput): CandidateStatus {
  if (
    input.enrichmentStatus === GitHubEnrichmentStatus.UNAVAILABLE ||
    input.archived === true ||
    input.disabled === true ||
    input.licenseCategory === LicenseCategory.RESTRICTED
  ) {
    return CandidateStatus.EXCLUDED;
  }
  if (
    input.enrichmentStatus === GitHubEnrichmentStatus.ENRICHED &&
    input.licenseCategory === LicenseCategory.PERMISSIVE &&
    input.daysSinceLastPush !== null &&
    input.daysSinceLastPush <= 365
  ) {
    return CandidateStatus.CANDIDATE;
  }
  return CandidateStatus.REVIEW;
}

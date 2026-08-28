import { LicenseCategory } from "@prisma/client";

export interface LicenseScreening {
  category: LicenseCategory;
  reviewRequired: boolean;
  commercialBundleCandidate: boolean;
}

const PERMISSIVE = new Set(["MIT", "APACHE-2.0", "BSD-2-CLAUSE", "BSD-3-CLAUSE", "ISC", "0BSD"]);
const RESTRICTED_MARKERS = ["BUSL", "SSPL", "ELASTIC-2.0", "COMMONS-CLAUSE", "POLYFORM", "LICENSE-REF", "PROPRIETARY", "CC-BY-NC"];

export function classifyLicense(spdxId: string | null | undefined): LicenseScreening {
  const id = spdxId?.trim().toUpperCase();
  if (!id || id === "NOASSERTION") {
    return { category: LicenseCategory.NO_LICENSE, reviewRequired: true, commercialBundleCandidate: false };
  }
  if (PERMISSIVE.has(id)) {
    return { category: LicenseCategory.PERMISSIVE, reviewRequired: false, commercialBundleCandidate: true };
  }
  if (/^(AGPL|GPL|LGPL)-|^MPL-/u.test(id)) {
    return { category: LicenseCategory.COPYLEFT, reviewRequired: true, commercialBundleCandidate: false };
  }
  if (RESTRICTED_MARKERS.some((marker) => id.includes(marker))) {
    return { category: LicenseCategory.RESTRICTED, reviewRequired: false, commercialBundleCandidate: false };
  }
  return { category: LicenseCategory.UNKNOWN, reviewRequired: true, commercialBundleCandidate: false };
}

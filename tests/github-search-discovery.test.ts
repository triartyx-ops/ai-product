import { AiProductCategory } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { BUSINESS_SEARCH_DEFINITIONS, githubSearchQuery } from "@/lib/github/search-discovery";

describe("GitHub Search business discovery catalog", () => {
  it("has multiple query phrases for each targeted category", () => {
    expect(BUSINESS_SEARCH_DEFINITIONS.length).toBeGreaterThanOrEqual(25);
    expect(BUSINESS_SEARCH_DEFINITIONS.every((definition) => definition.terms.length >= 2)).toBe(true);
    expect(BUSINESS_SEARCH_DEFINITIONS.find((definition) => definition.category === AiProductCategory.CRM)?.terms).toContain("sales pipeline");
  });

  it("uses activity, fork, archive and low-star search signals", () => {
    expect(githubSearchQuery("booking system", "2025-08-24")).toBe('"booking system" in:name,description,readme archived:false fork:false stars:>=5 pushed:>=2025-08-24');
  });
});

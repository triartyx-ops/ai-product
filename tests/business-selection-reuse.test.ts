import { AiProductCategory, BusinessProductCategory } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { normalizeExistingCategory } from "@/lib/ai/business-selection-reuse";

describe("business selection category reuse", () => {
  it("normalizes legacy category variants", () => {
    expect(normalizeExistingCategory(AiProductCategory.FORM_BUILDER)).toBe(BusinessProductCategory.FORMS);
    expect(normalizeExistingCategory(AiProductCategory.HELPDESK)).toBe(BusinessProductCategory.CUSTOMER_SUPPORT);
    expect(normalizeExistingCategory(AiProductCategory.AI_ASSISTANT)).toBe(BusinessProductCategory.OTHER);
  });
});

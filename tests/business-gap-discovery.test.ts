import { AiProductCategory, RepositoryKind } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { discoverBusinessApplication } from "@/lib/business-gap/discovery";

const base = { topics: [] as string[], homepage: "https://demo.example.com", kind: RepositoryKind.UNKNOWN };

describe("discoverBusinessApplication", () => {
  it("finds semantic CRM applications", () => {
    const result = discoverBusinessApplication({ ...base, name: "salesdesk", description: "Customer relationship and sales pipeline platform", readme: "Self-hosted web application. Docker compose installation. Screenshots and live demo." });
    expect(result?.matchedCategories).toContain(AiProductCategory.CRM);
    expect(result?.standaloneScore).toBeGreaterThanOrEqual(15);
  });

  it("finds appointment systems without the word booking", () => {
    const result = discoverBusinessApplication({ ...base, name: "slots", description: "Appointment scheduling for clinics", readme: "Deploy with Docker. Includes authentication, dashboard and database." });
    expect(result?.primaryCategory).toBe(AiProductCategory.APPOINTMENTS);
  });

  it("rejects a bare library mention", () => {
    const result = discoverBusinessApplication({ topics: [], homepage: null, kind: RepositoryKind.LIBRARY, name: "billing-sdk", description: "Client library for a billing platform", readme: "SDK for integrating billing." });
    expect(result).toBeNull();
  });
});

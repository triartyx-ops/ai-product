import { AiProductCategory, RepositoryKind } from "@prisma/client";

type PatternMap = Partial<Record<AiProductCategory, RegExp[]>>;

export const BUSINESS_PATTERNS: PatternMap = {
  CRM: [/\bcrm\b/i, /customer relationship/i, /customer management/i],
  SALES: [/sales pipeline/i, /sales management/i, /sales team/i, /deal tracking/i],
  LEAD_MANAGEMENT: [/lead management/i, /lead tracking/i, /manage(?:ment)? of leads/i, /sales leads?/i],
  BOOKING: [/\bbooking(s)?\b/i, /reservation system/i, /online reservation/i, /reservation management/i],
  APPOINTMENTS: [/\bappointments?\b/i, /appointment schedul/i, /appointment management/i, /book appointments?/i],
  CALENDAR_BUSINESS: [/business calendar/i, /team schedul/i, /availability slots?/i, /calendar schedul/i],
  HR: [/human resources/i, /employee management/i, /workforce management/i, /people management/i],
  HRM: [/\bhrm(s)?\b/i, /human resource management/i],
  ATS: [/applicant tracking/i, /recruit(?:ment|ing) system/i, /hiring platform/i, /job candidates?/i],
  INVOICING: [/\binvoic(?:e|es|ing)\b/i, /billing system/i, /billing platform/i],
  ACCOUNTING: [/\baccounting\b/i, /bookkeeping/i, /general ledger/i],
  EXPENSES: [/expense management/i, /expense tracking/i, /reimbursements?/i],
  PAYROLL: [/\bpayroll\b/i, /salary management/i],
  POS: [/point[ -]of[ -]sale/i, /\bpos system\b/i, /retail checkout/i],
  ECOMMERCE: [/e[ -]?commerce/i, /online store/i, /shopping cart/i, /web shop/i],
  INVENTORY: [/inventory management/i, /stock management/i, /warehouse management/i],
  ERP: [/\berp\b/i, /enterprise resource planning/i, /business management suite/i],
  CUSTOMER_SUPPORT: [/customer support/i, /support platform/i, /customer service/i, /support team/i],
  HELPDESK: [/help[ -]?desk/i, /ticketing system/i, /support tickets?/i],
  LIVE_CHAT: [/live chat/i, /customer chat/i, /website chat widget/i],
  MARKETING: [/marketing platform/i, /marketing automation/i, /campaign management/i, /marketing campaigns?/i],
  EMAIL_MARKETING: [/email marketing/i, /newsletter platform/i, /email campaigns?/i, /mailing list/i],
  SOCIAL_MEDIA: [/social media management/i, /social scheduling/i, /social publishing/i],
  PROPERTY_MANAGEMENT: [/property management/i, /tenant management/i, /rental propert/i],
  REAL_ESTATE: [/real estate/i, /realtor/i, /property listings?/i],
  RESTAURANT: [/restaurant management/i, /restaurant ordering/i, /food ordering/i, /table reservation/i],
  HOTEL: [/hotel management/i, /hospitality management/i, /room booking/i],
  LMS: [/learning management system/i, /\blms\b/i, /online learning platform/i],
  COURSE_PLATFORM: [/course platform/i, /course management/i, /online courses?/i, /e[ -]?learning platform/i],
  FORM_BUILDER: [/form builder/i, /forms platform/i, /create.*forms/i],
  SURVEY: [/survey builder/i, /survey platform/i, /questionnaire/i],
  PROJECT_MANAGEMENT: [/project management/i, /task management/i, /kanban board/i, /issue tracking/i, /team projects?/i],
  TIME_TRACKING: [/time track(?:er|ing)/i, /timesheets?/i, /work hours/i],
  DOCUMENT_MANAGEMENT: [/document management/i, /document workflow/i, /manage documents/i],
  CLIENT_PORTAL: [/client portal/i, /customer portal/i, /member portal/i],
  SUBSCRIPTION_MANAGEMENT: [/subscription management/i, /recurring billing/i, /manage subscriptions/i],
  CMS: [/content management system/i, /headless cms/i, /\bcms\b/i],
  ANALYTICS: [/analytics platform/i, /web analytics/i, /business intelligence/i, /data analytics/i],
  DASHBOARD: [/admin dashboard/i, /business dashboard/i, /analytics dashboard/i],
};

const standalonePatterns = [
  /self[ -]?hosted/i, /docker[ -]?compose/i, /docker compose/i, /installation/i, /getting started/i,
  /deploy(?:ment)?/i, /live demo/i, /screenshots?/i, /authentication/i, /sign[ -]?in/i, /dashboard/i,
  /web application/i, /frontend.{0,30}backend/i, /database/i, /production/i,
];
const negativePatterns = [
  /curated list/i, /awesome list/i, /collection of (?:links|resources|libraries)/i, /tutorial collection/i,
  /sdk for/i, /client library/i, /component library/i, /icon (?:set|collection)/i, /interview questions/i,
];

export interface DiscoveryInput {
  name: string;
  description: string | null;
  topics: string[];
  homepage: string | null;
  readme: string;
  kind: RepositoryKind;
}

export interface DiscoveryResult {
  primaryCategory: AiProductCategory;
  matchedCategories: AiProductCategory[];
  reasons: string[];
  discoveryScore: number;
  standaloneScore: number;
  categoryScores: Partial<Record<AiProductCategory, number>>;
}

function matches(patterns: RegExp[], value: string): number {
  return patterns.reduce((total, pattern) => total + (pattern.test(value) ? 1 : 0), 0);
}

function occurrences(patterns: RegExp[], value: string): number {
  return patterns.reduce((total, pattern) => {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    return total + Math.min(3, [...value.matchAll(new RegExp(pattern.source, flags))].length);
  }, 0);
}

export function discoverBusinessApplication(input: DiscoveryInput): DiscoveryResult | null {
  const name = input.name.replace(/[-_.]/g, " ");
  const description = input.description ?? "";
  const topics = input.topics.join(" ").replace(/[-_]/g, " ");
  // Product identity normally appears near the README beginning. Restricting this
  // window avoids classifying an AI tool as invoicing because a deep example says
  // "invoice", or a runtime as booking because its protocol reserves slots.
  const readme = input.readme.slice(0, 12_000);
  const combined = `${name}\n${description}\n${topics}\n${readme}`;
  const categoryScores: Partial<Record<AiProductCategory, number>> = {};
  const metadataScores: Partial<Record<AiProductCategory, number>> = {};
  const reasons: string[] = [];

  for (const [category, patterns] of Object.entries(BUSINESS_PATTERNS) as Array<[AiProductCategory, RegExp[]]>) {
    const metadataScore = matches(patterns, name) * 10 + matches(patterns, description) * 8 + matches(patterns, topics) * 7;
    const score = metadataScore + occurrences(patterns, readme) * 2;
    if (score > 0) categoryScores[category] = score;
    if (metadataScore > 0) metadataScores[category] = metadataScore;
  }
  const ranked = (Object.entries(categoryScores) as Array<[AiProductCategory, number]>).sort((a, b) => b[1] - a[1]);
  const top = ranked[0];
  if (!top) return null;

  let standaloneScore = matches(standalonePatterns, combined) * 5;
  if (input.homepage) standaloneScore += 8;
  if (input.kind === RepositoryKind.APPLICATION) standaloneScore += 25;
  if (input.kind === RepositoryKind.STARTER || input.kind === RepositoryKind.BOILERPLATE) standaloneScore += 12;
  if (input.kind === RepositoryKind.UNKNOWN) standaloneScore += 5;
  standaloneScore -= matches(negativePatterns, combined) * 20;
  standaloneScore = Math.max(0, Math.min(100, standaloneScore));
  const topMetadataScore = metadataScores[top[0]] ?? 0;
  const developerOnlyMetadata = /\b(llm|agents?|claude|inference|model weights?|sdk|client library|framework|database|protocol|kernel|runtime|developer tool)\b/i.test(`${name} ${description} ${topics}`);
  if (standaloneScore < 15 || (topMetadataScore === 0 && (top[1] < 6 || standaloneScore < 30 || developerOnlyMetadata))) return null;

  const matchedCategories = ranked.filter(([, value]) => value >= 4).slice(0, 5).map(([category]) => category);
  reasons.push(`matched ${top[0]} business terminology (${top[1]})`);
  if (input.kind === RepositoryKind.UNKNOWN) reasons.push("deterministic kind UNKNOWN; included for under-classification audit");
  if (input.kind === RepositoryKind.APPLICATION) reasons.push("deterministic classifier marked APPLICATION");
  const standaloneMatches = matches(standalonePatterns, combined);
  reasons.push(`${standaloneMatches} standalone/deployment/UI signals${input.homepage ? "; homepage present" : ""}`);
  return {
    primaryCategory: top[0], matchedCategories, reasons,
    discoveryScore: Math.min(100, top[1] + standaloneScore), standaloneScore, categoryScores,
  };
}

export const GAP_TARGETS: Array<{ categories: AiProductCategory[]; target: number }> = [
  { categories: [AiProductCategory.CRM, AiProductCategory.SALES, AiProductCategory.LEAD_MANAGEMENT], target: 10 },
  { categories: [AiProductCategory.BOOKING, AiProductCategory.APPOINTMENTS, AiProductCategory.CALENDAR_BUSINESS], target: 10 },
  { categories: [AiProductCategory.HR, AiProductCategory.HRM, AiProductCategory.ATS], target: 10 },
  { categories: [AiProductCategory.INVOICING, AiProductCategory.FINANCE, AiProductCategory.ACCOUNTING, AiProductCategory.EXPENSES, AiProductCategory.PAYROLL], target: 10 },
  { categories: [AiProductCategory.CUSTOMER_SUPPORT, AiProductCategory.HELPDESK, AiProductCategory.LIVE_CHAT], target: 10 },
  { categories: [AiProductCategory.MARKETING, AiProductCategory.EMAIL_MARKETING, AiProductCategory.SOCIAL_MEDIA], target: 10 },
  { categories: [AiProductCategory.ECOMMERCE, AiProductCategory.POS, AiProductCategory.INVENTORY], target: 10 },
  { categories: [AiProductCategory.PROJECT_MANAGEMENT, AiProductCategory.TIME_TRACKING], target: 10 },
  { categories: [AiProductCategory.PROPERTY_MANAGEMENT, AiProductCategory.REAL_ESTATE], target: 5 },
  { categories: [AiProductCategory.RESTAURANT, AiProductCategory.HOTEL], target: 5 },
  { categories: [AiProductCategory.LMS, AiProductCategory.COURSE_PLATFORM], target: 5 },
  { categories: [AiProductCategory.CLIENT_PORTAL, AiProductCategory.FORM_BUILDER, AiProductCategory.SURVEY], target: 5 },
];

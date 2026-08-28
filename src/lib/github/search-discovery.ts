import { AiProductCategory } from "@prisma/client";

export interface BusinessSearchDefinition {
  category: AiProductCategory;
  terms: readonly string[];
}

// Two or more semantically different phrases per business workflow. The final
// qualifiers make discovery inexpensive without turning star count into a
// quality score; metadata and README screening remains authoritative.
export const BUSINESS_SEARCH_DEFINITIONS: readonly BusinessSearchDefinition[] = [
  { category: AiProductCategory.CRM, terms: ["crm", "customer relationship management", "sales pipeline", "lead management"] },
  { category: AiProductCategory.BOOKING, terms: ["booking system", "appointment scheduling", "reservation system", "scheduling app"] },
  { category: AiProductCategory.HR, terms: ["hr management", "human resources management", "employee management", "applicant tracking system"] },
  { category: AiProductCategory.INVOICING, terms: ["invoicing application", "invoice management", "billing system"] },
  { category: AiProductCategory.ACCOUNTING, terms: ["accounting software", "bookkeeping application", "general ledger"] },
  { category: AiProductCategory.EXPENSES, terms: ["expense management", "expense tracker", "reimbursement management"] },
  { category: AiProductCategory.ERP, terms: ["erp system", "enterprise resource planning", "business management suite"] },
  { category: AiProductCategory.POS, terms: ["point of sale", "pos system", "retail checkout"] },
  { category: AiProductCategory.INVENTORY, terms: ["inventory management", "stock management", "warehouse management"] },
  { category: AiProductCategory.ECOMMERCE, terms: ["ecommerce platform", "online store", "shopping cart application"] },
  { category: AiProductCategory.CUSTOMER_SUPPORT, terms: ["customer support platform", "support ticket system", "customer service software"] },
  { category: AiProductCategory.HELPDESK, terms: ["helpdesk software", "help desk ticketing", "ticketing system"] },
  { category: AiProductCategory.PROJECT_MANAGEMENT, terms: ["project management application", "task management system", "kanban project management"] },
  { category: AiProductCategory.PROPERTY_MANAGEMENT, terms: ["property management software", "rental property management", "tenant management"] },
  { category: AiProductCategory.REAL_ESTATE, terms: ["real estate management", "real estate listings", "realtor crm"] },
  { category: AiProductCategory.RESTAURANT, terms: ["restaurant management", "restaurant ordering system", "restaurant pos"] },
  { category: AiProductCategory.HOTEL, terms: ["hotel management system", "hotel reservation system", "hospitality management"] },
  { category: AiProductCategory.LMS, terms: ["learning management system", "lms platform", "online learning platform"] },
  { category: AiProductCategory.CLIENT_PORTAL, terms: ["client portal", "customer portal", "member portal"] },
  { category: AiProductCategory.FORM_BUILDER, terms: ["form builder application", "form builder platform", "online forms software"] },
  { category: AiProductCategory.SURVEY, terms: ["survey builder", "survey platform", "questionnaire application"] },
  { category: AiProductCategory.MARKETING, terms: ["marketing automation", "marketing campaign management", "marketing platform"] },
  { category: AiProductCategory.EMAIL_MARKETING, terms: ["email marketing platform", "newsletter software", "email campaign management"] },
  { category: AiProductCategory.SOCIAL_MEDIA, terms: ["social media management", "social media scheduler", "social publishing platform"] },
  { category: AiProductCategory.TIME_TRACKING, terms: ["time tracking application", "timesheet management", "time tracker software"] },
  { category: AiProductCategory.PAYROLL, terms: ["payroll management", "payroll software", "salary management"] },
  { category: AiProductCategory.DOCUMENT_MANAGEMENT, terms: ["document management system", "document workflow", "document archive management"] },
];

export function githubSearchQuery(term: string, pushedAfter: string): string {
  return `"${term}" in:name,description,readme archived:false fork:false stars:>=5 pushed:>=${pushedAfter}`;
}

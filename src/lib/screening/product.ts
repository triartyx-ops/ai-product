import { CandidateStatus, RepositoryKind } from "@prisma/client";

export interface ProductInput {
  name: string;
  description: string | null;
  topics: string[];
  homepage: string | null;
  primaryLanguage: string | null;
  readmeText: string | null;
  daysSinceLastPush: number | null;
  stars: number | null;
}

export interface ProductClassification {
  kind: RepositoryKind;
  productLikenessScore: number;
  templatePotentialScore: number;
  reasons: string[];
  candidateStatus: CandidateStatus;
}

const EXCLUDED_KINDS = new Set<RepositoryKind>([
  RepositoryKind.AWESOME_LIST, RepositoryKind.BOOK, RepositoryKind.COURSE, RepositoryKind.TUTORIAL,
  RepositoryKind.ALGORITHM_COLLECTION, RepositoryKind.RESOURCE_COLLECTION, RepositoryKind.CONFIG,
]);
const REVIEW_KINDS = new Set<RepositoryKind>([
  RepositoryKind.LIBRARY, RepositoryKind.FRAMEWORK, RepositoryKind.CLI_TOOL, RepositoryKind.DEV_TOOL,
]);
const STARTER_KINDS = new Set<RepositoryKind>([RepositoryKind.STARTER, RepositoryKind.BOILERPLATE]);

function contains(text: string, expression: RegExp): boolean {
  return expression.test(text);
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function classifyProduct(input: ProductInput, metadataStatus: CandidateStatus): ProductClassification {
  const readme = input.readmeText?.toLowerCase() ?? "";
  const identity = [input.name, input.description ?? "", input.topics.join(" ")].join(" ").toLowerCase();
  const titleAndDescription = [input.name, input.description ?? ""].join(" ").toLowerCase();
  const text = [identity, input.homepage ?? "", readme].join(" ").toLowerCase();
  const reasons: string[] = [];
  let score = input.readmeText ? 4 : 0;
  let appSignals = 0;
  const add = (matches: boolean, points: number, reason: string, application = false): void => {
    if (!matches) return;
    score += points;
    reasons.push(reason);
    if (application) appSignals += 1;
  };
  add(contains(readme, /!\[[^\]]*\]\([^)]*\)|screenshots?|preview\.png|demo\.gif/u), 10, "screenshots or visual demo", true);
  add(contains(text, /live demo|demo at|try it online/u), 8, "live demo", true);
  add(contains(readme, /docker-compose|compose\.ya?ml/u), 12, "docker compose setup", true);
  add(contains(readme, /docker/u), 5, "docker setup");
  add(contains(readme, /installation|getting started|quick start|how to install/u), 8, "installation documentation");
  add(contains(text, /self-hosted|self hosted/u), 15, "self-hosted product", true);
  add(contains(text, /login|authentication|oauth|sign in/u), 9, "authentication", true);
  add(contains(text, /dashboard|admin panel|admin ui/u), 10, "dashboard or admin UI", true);
  add(contains(text, /database|postgres|mysql|sqlite|mongodb/u), 7, "database integration", true);
  add(contains(text, /web application|web app|frontend|react app|next\.js app|mobile app/u), 10, "application frontend", true);
  add(contains(text, /\b(crm|erp|booking|ecommerce|project management|analytics|cms|helpdesk|invoic|knowledge base|automation|collaboration)\b/u), 13, "business use case", true);
  add(Boolean(input.homepage), 4, "project homepage");

  let kind: RepositoryKind = RepositoryKind.UNKNOWN;
  if (contains(titleAndDescription, /awesome[- ]|curated list/u)) kind = RepositoryKind.AWESOME_LIST;
  else if (contains(identity, /free programming books|\bbook\b|reading list/u)) kind = RepositoryKind.BOOK;
  else if (contains(identity, /\bcourse\b|curriculum|bootcamp/u)) kind = RepositoryKind.COURSE;
  else if (contains(identity, /tutorial|walkthrough|step-by-step|roadmap|\b\d+ days\b|教程|科普|学习|从零构建/u)) kind = RepositoryKind.TUTORIAL;
  else if (contains(identity, /algorithms?|leetcode|competitive programming/u)) kind = RepositoryKind.ALGORITHM_COLLECTION;
  else if (contains(identity, /resources?|cheatsheet|interview questions|prompts collection|api collection|workflow collection|all of (the )?workflows/u)) kind = RepositoryKind.RESOURCE_COLLECTION;
  else if (contains(titleAndDescription, /dotfiles|\.config|configuration files|\bconfigs?\b|\bprompt\b/u)) kind = RepositoryKind.CONFIG;
  else if (contains(identity, /boilerplate/u)) kind = RepositoryKind.BOILERPLATE;
  else if (contains(identity, /starter( kit| template)?|scaffold/u)) kind = RepositoryKind.STARTER;
  else if (contains(identity, /\bframework\b/u)) kind = RepositoryKind.FRAMEWORK;
  else if (contains(identity, /\b(sdk|library|package for|npm package|python package)\b/u)) kind = RepositoryKind.LIBRARY;
  else if (contains(identity, /\b(cli|command line|terminal ui)\b/u)) kind = RepositoryKind.CLI_TOOL;
  else if (contains(titleAndDescription, /linter|formatter|debugger|ide|developer tool|devtool|toolkit|\btools?\b|\bskills?\b|workflow orchestrator|application proxy|reverse proxy|code graph|code intelligence|vulnerability scanner|penetration testing|\bmcp\b|\bplugin\b|helper scripts|infrastructure-as-code|\bapi client\b|\bapi gateway\b/u)) kind = RepositoryKind.DEV_TOOL;
  else if (contains(identity, /\b(research|paper|benchmark|dataset|model training|research summary)\b|研究总结/u)) kind = RepositoryKind.UNKNOWN;
  else if (appSignals >= 3 || (appSignals >= 2 && score >= 45)) kind = RepositoryKind.APPLICATION;

  if (EXCLUDED_KINDS.has(kind)) {
    score -= 45;
    reasons.push(`classified as ${kind.toLowerCase()}`);
  } else if (kind === RepositoryKind.LIBRARY || kind === RepositoryKind.FRAMEWORK) {
    score -= 22;
    reasons.push(`classified as ${kind.toLowerCase()}`);
  } else if (kind === RepositoryKind.CLI_TOOL || kind === RepositoryKind.DEV_TOOL) {
    score -= 12;
    reasons.push(`classified as ${kind.toLowerCase()}`);
  }
  const productLikenessScore = clamp(score);

  let template = 0;
  if (kind === RepositoryKind.APPLICATION) template += 28;
  else if (kind === RepositoryKind.BOILERPLATE || kind === RepositoryKind.STARTER) template += 16;
  if (contains(readme, /!\[[^\]]*\]\([^)]*\)|screenshots?|preview|live demo/u) || Boolean(input.homepage)) template += 10;
  if (contains(readme, /docker-compose|installation|getting started|quick start/u)) template += 12;
  if (contains(text, /\b(crm|erp|booking|ecommerce|project management|analytics|cms|helpdesk|invoic|knowledge base|automation|collaboration)\b/u)) template += 14;
  if (contains(text, /theme|customiz|plugin|extension|self-hosted|white label/u)) template += 10;
  if (input.daysSinceLastPush !== null) template += input.daysSinceLastPush <= 30 ? 10 : input.daysSinceLastPush <= 90 ? 8 : input.daysSinceLastPush <= 365 ? 5 : 1;
  if ((input.stars ?? 0) >= 1_000) template += 3;
  else if ((input.stars ?? 0) >= 100) template += 2;
  else if ((input.stars ?? 0) > 0) template += 1;
  const templatePotentialScore = clamp(template);

  let candidateStatus = metadataStatus;
  if (metadataStatus !== CandidateStatus.EXCLUDED) {
    if (EXCLUDED_KINDS.has(kind)) candidateStatus = CandidateStatus.EXCLUDED;
    else if (REVIEW_KINDS.has(kind)) candidateStatus = CandidateStatus.REVIEW;
    // Product heuristics may narrow the license/metadata pool, never promote a review
    // record (for example copyleft or no-license) into a commercial candidate.
    else if (kind === RepositoryKind.APPLICATION) candidateStatus = metadataStatus === CandidateStatus.CANDIDATE ? CandidateStatus.CANDIDATE : CandidateStatus.REVIEW;
    else if (STARTER_KINDS.has(kind)) candidateStatus = metadataStatus === CandidateStatus.CANDIDATE && templatePotentialScore >= 50 ? CandidateStatus.CANDIDATE : CandidateStatus.REVIEW;
    else candidateStatus = CandidateStatus.REVIEW;
  }
  return { kind, productLikenessScore, templatePotentialScore, reasons, candidateStatus };
}

# GitHub Radar Indexer

Internal discovery pipeline for collecting GitHub repository links from the public Telegram preview of `@GitHubRadar`. This first milestone only ingests Telegram messages; it does not clone or execute repositories and deliberately exposes no product UI.

## Architecture

The crawler is a conservative, sequential server-side worker:

```text
Telegram public preview -> retrying HTTP fetcher -> pure HTML parser
                        -> idempotent PostgreSQL upserts -> crawl checkpoint
```

- `src/lib/telegram/parser.ts` parses saved HTML and has no network or database dependency.
- `src/lib/telegram/fetcher.ts` applies timeouts, `Retry-After`, exponential backoff, and a descriptive User-Agent.
- `src/lib/telegram/crawler.ts` follows navigation discovered in the HTML, prevents URL/page loops, and checkpoints after every committed page.
- `telegram_messages` retains normalized fields plus each message's raw HTML source.
- `crawl_jobs` and `crawl_failures` support resume and failure diagnostics.

The current public preview (verified 2026-08-24) exposes backward navigation in `rel="prev"`, `data-before`, and `?before=<message-id>` links. The parser treats these as independent signals and validates the channel, host, and cursor. If Telegram removes public history, this worker stops; it does not attempt authentication bypass or CAPTCHA circumvention.

## Setup

Requirements: Node.js 20.9+ and PostgreSQL.

```bash
cp .env.example .env
npm install
npx prisma migrate deploy
```

Set `DATABASE_URL` in `.env`. Set a real contact address in `CRAWL_USER_AGENT` before a long crawl.

## Crawl

```bash
npm run crawl
npm run crawl -- --channel GitHubRadar
```

Useful controls:

```bash
npm run crawl -- --max-pages 5 --delay-ms 2000
npm run crawl -- --start-before 2500
npm run crawl -- --help
```

`SIGINT`/`SIGTERM` and `--max-pages` pause only after the current page transaction. The next run resumes the latest running or failed job. Once a full crawl has completed, later runs ingest the newest page and stop at the first fully known page.

The summary reports pages processed, messages found, GitHub links found, duplicates skipped, errors, and the stop reason.

## Repository extraction

After crawling, canonicalize raw GitHub URLs and preserve each repository publication:

```bash
npm run reparse:messages
npm run extract:repositories
npm run audit:repositories
```

`repositories` stores one canonical `https://github.com/{owner}/{repo}` record and its `occurrences_count`. `repository_discoveries` keeps the corresponding Telegram message, source, and first/last publication time. The audit command samples 100 raw URLs and verifies their saved owner/repo values against the canonical extraction.

## GitHub metadata enrichment

Set a fine-grained GitHub token with read-only public repository metadata access in `.env`, then run a smoke test before the full pass:

```bash
npm run enrich:github -- --limit=20
npm run enrich:github -- --missing-only
```

The worker makes one primary `GET /repos/{owner}/{repo}` request per selected repository, stores only response metadata, respects rate-limit headers, retries transient failures, and resumes from pending/rate-limited/failed records. Fresh `enriched` records are skipped until `--stale-days` expires.

## Candidate screening and README enrichment

Screening is deterministic preliminary triage, not a legal opinion. It maps SPDX metadata to permissive, copyleft, no-license, unknown, or restricted categories and gates active permissive repositories before any README request.

```bash
npm run screen:candidates
npm run enrich:readmes -- --limit=20
npm run enrich:readmes -- --missing-only
npm run classify:products
npm run audit:screening
npm run report:screening
```

README retrieval calls only `GET /repos/{owner}/{repo}/readme` for the gated V1 pool. It is resumable: fresh fetched README records are skipped, while pending/failed records can be retried. The classifier uses repository metadata and fetched README text to assign a deterministic repository kind plus product-likeness and template-potential scores; it cannot promote a review record past the license/metadata gate.

## AI product selection

The versioned AI stage selects all deterministic candidates plus the strongest eligible review records up to the requested pool size. Stars never affect pool order. Production workers use the OpenAI Responses API with strict Structured Outputs; an authenticated local Codex CLI provider is available for development runs.

```bash
npm run analyze:products:ai -- --pool-only
npm run analyze:products:ai -- --limit=10
npm run analyze:products:ai
npm run report:ai-selection -- --output=reports/ai-selection-product-selection-v1.json
```

Use `--version=product-selection-v2` after changing the prompt or selection policy. Completed records with the same version and unchanged input fingerprint are skipped. README text is capped by `AI_README_MAX_CHARS` for cost control, and truncation is disclosed to the model.

## Business application selection

The targeted GitHub Search candidates use a separate versioned structured-output pass. Existing current analyses are reused, while new candidates are analyzed once and checkpointed in PostgreSQL.

```bash
npm run prepare:business-ai
env AI_CONCURRENCY=4 npm run analyze:business-ai
npm run audit:business-ai
npm run merge:candidates:v3
npm run shortlist:deep-test:v1
npm run report:business-ai
```

`commercial_candidate_pool_v3` deduplicates the existing V2 pool and accepted business-search results by repository. `deep_test_shortlist_v1` is a diversity-aware technical-testing queue capped at 150; it is not a final product selection. This stage reads metadata and saved README content only—it does not clone repositories or execute third-party code.

## Quality checks

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Parser tests use checked-in fixtures under `tests/fixtures`; they never call Telegram.

## Scope boundary

Selective cloning and runtime testing remain separate future stages. Deep analysis must only clone candidates that pass discovery scoring and explicit review.

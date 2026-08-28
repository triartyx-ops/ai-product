export interface FetchPageOptions {
  timeoutMs: number;
  maxRetries: number;
  userAgent: string;
  onFailure?: (failure: { attempt: number; error: Error }) => Promise<void> | void;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly retryAfterMs: number | null,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

function retryAfterMs(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : Math.max(0, timestamp - Date.now());
}

export async function wait(milliseconds: number): Promise<void> {
  if (milliseconds <= 0) return;
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

export async function fetchTelegramPage(url: string, options: FetchPageOptions): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= options.maxRetries + 1; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": options.userAgent,
        },
        redirect: "follow",
        signal: AbortSignal.timeout(options.timeoutMs),
      });

      if (!response.ok) {
        throw new HttpError(
          `Telegram returned HTTP ${response.status} for ${url}`,
          response.status,
          response.status === 429 || response.status >= 500,
          retryAfterMs(response.headers.get("retry-after")),
        );
      }

      const body = await response.text();
      if (!body.trim()) throw new Error(`Telegram returned an empty response for ${url}`);
      return body;
    } catch (cause) {
      lastError = cause instanceof Error ? cause : new Error(String(cause));
      await options.onFailure?.({ attempt, error: lastError });

      const retryable = !(lastError instanceof HttpError) || lastError.retryable;
      if (!retryable || attempt > options.maxRetries) break;

      const exponentialDelay = Math.min(30_000, 500 * 2 ** (attempt - 1));
      const jitter = Math.floor(Math.random() * 250);
      const delay = lastError instanceof HttpError && lastError.retryAfterMs !== null
        ? lastError.retryAfterMs
        : exponentialDelay + jitter;
      await wait(delay);
    }
  }

  throw lastError ?? new Error(`Unable to fetch ${url}`);
}

# Link Checker Service Handoff

## Goal

Build a new standalone service for backlink/link presence checking. The current `lat3.0` project is obsolete and should not be used as the base architecture. It should be treated only as a source of business rules, observed edge cases, and compatibility requirements.

The service must accept batches of links, check whether the target link and anchor are present on each source URL, expose job progress, provide an interactive real-time dashboard, retry selected anti-bot cases with browser automation, and return results through an API and/or callback.

## Current Production Entry Points

The current project only uses this checking flow:

- `POST /start_checking` in `lat.js`
- `GET /checking_status` in `lat.js`
- `GET /checking_progress` in `lat.js`

The legacy `POST /start_checking` behavior:

1. Reads `rows`, `callback`, and `proceed` from JSON request body.
2. Immediately responds with `checking started`.
3. Runs `checker.checkStatus(rows)` asynchronously.
4. Posts result to `callback + '?cmd=checkingFinished'`.
5. Adds `&proceed=1` when request body contains truthy `proceed`.
6. Sends callback payload as `{ "payload": resultRows }`.

The new service should preserve the callback behavior during migration, but it should not rely on a single in-memory global state.

## Input Row Contract

Observed row fields used by the checker:

```json
{
  "url": "https://source-page.example/article",
  "target_link": "https://target.example/",
  "anchor": "Anchor text"
}
```

Notes:

- Existing datasets may include many unrelated columns. Preserve unknown fields in the output row.
- `anchor` is not guaranteed to be a string. It has caused production crashes when numeric or otherwise non-string.
- `target_link` is not guaranteed to be a string. It must be normalized defensively.
- `url` may fail DNS, TLS, redirects, timeout, 403/404/429/5xx, or return non-HTML content.

## Output Row Contract

Each output row should include all original fields plus:

```json
{
  "status": "LIVE"
}
```

Known statuses from the legacy system and real runs:

- `LIVE`
- `NOT LIVE`
- `LIVE, BUT CORRUPTED ANCHOR`
- `CLOUDFLARE CAPTCHA`
- `UNABLE TO CRAWL`
- `NOT FOUND`
- `FORBIDDEN`
- `TOO MANY REQUESTS`
- `GONE`
- `NOT ALLOWED`
- `TEMPORARY REDIRECT`
- `INTERNAL SERVER ERROR`
- `ENOTFOUND`
- `EAI_AGAIN`
- `ECONNRESET`
- `EPROTO`
- `ERR_TLS_CERT_ALTNAME_INVALID`
- `CERT_HAS_EXPIRED`
- `LOOP DETECTED`
- numeric HTTP-like statuses such as `429`, `444`, `454`

The new service should define a normalized status enum and keep raw error details separately. The user-facing status can stay compatible with legacy strings, but internal code should not depend on free-form strings.

## Link Detection Rules

Legacy behavior:

1. Fetch `row.url`.
2. Parse all `<a ...>...</a>` tags with regex.
3. Normalize anchor text and target link.
4. If any `<a>` contains the expected anchor text and links to expected target link, return `LIVE`.
5. If expected target link exists but anchor text does not match, return `LIVE, BUT CORRUPTED ANCHOR`.
6. If target link is not present, return `NOT LIVE`.

Required improvements:

- Use an HTML parser, not regex.
- Handle single-quoted, unquoted, uppercase, malformed, relative, redirected, encoded, and entity-escaped links.
- Normalize URLs with a dedicated URL utility:
  - strip protocol for comparison only when appropriate;
  - normalize trailing slash consistently;
  - decide how to treat query string, fragment, path case, percent encoding, and `www.`.
- Normalize anchor text safely:
  - coerce non-string values;
  - decode HTML entities;
  - collapse whitespace;
  - handle curly quotes, non-breaking spaces, dashes, accents, and Unicode normalization.

## Captcha / Anti-Bot Handling

Legacy behavior:

- `axios` fetch returns `CLOUDFLARE CAPTCHA` only when response is `403` and `response.headers.server === 'cloudflare'`.
- Rows with `CLOUDFLARE CAPTCHA` are separated after the first pass.
- Browser retry uses `puppeteer-extra` and `puppeteer-extra-plugin-stealth`.
- Browser retry opens the page, waits for `networkidle2`, reads `page.content()`, then applies the same link detection.
- Recent improvement: browser retries are batched with `CAPTCHA_CONCURRENCY`, default `5`.

Required improvements:

- Use CloakBrowser for the new service's browser retries instead of legacy `puppeteer-extra`.
- Detect anti-bot responses by multiple signals, not only `403 + server=cloudflare`.
- Store anti-bot reason and evidence: status code, headers, title, challenge markers.
- Make browser retry optional per job and globally configurable.
- Set browser retry timeout separately from plain HTTP timeout.
- Always close pages in `finally`.
- Limit browser concurrency to avoid memory exhaustion.
- Persist retry attempts and final outcome per row.

## Progress Requirements

The new service must expose progress per job and provide an interactive dashboard. Current UI relies on these fields:

```json
{
  "running": true,
  "stage": "checking",
  "total": 55148,
  "checked": 55148,
  "captchaTotal": 2052,
  "captchaChecked": 744,
  "startedAt": "2026-06-18T06:04:07.691Z",
  "finishedAt": null,
  "elapsedSeconds": 47880,
  "lastError": null,
  "statusCounts": {
    "LIVE": 32228,
    "NOT LIVE": 6242,
    "CLOUDFLARE CAPTCHA": 2052
  },
  "captchaStatusCounts": {}
}
```

Stages:

- `queued`
- `checking`
- `captcha`
- `callback`
- `finished`
- `failed`
- `cancelled`

Progress must be persisted, not process-local only. A process restart must not erase job status.

Dashboard requirements:

- live updates through WebSocket or SSE;
- polling fallback through `GET /jobs/:jobId`;
- elapsed time and last activity time;
- clear stage display;
- overall and captcha progress bars;
- status counts;
- recent row-level errors;
- raw JSON snapshot for debugging;
- cancellation control when backend cancellation is implemented.

## Observed Incidents To Preserve As Tests

### Non-HTML JSON response

URL:

```text
https://theguycornernyc.com/2025/10/23/mobile-online-blackjack-playing-anytime-anywhere/
```

Observed behavior:

- Returns `200 OK`
- `content-type: application/activity+json`
- `axios` parses response body as object
- Legacy code crashed with `TypeError: data.replace is not a function`

Expected behavior:

- Do not crash.
- Treat body as non-HTML or stringify defensively.
- Result should be `NOT LIVE` unless link is actually detected.

### Non-string anchor

Observed behavior:

- A row had `anchor` value with no `.toLowerCase()` method.
- Legacy code crashed with `TypeError: a.anchor.toLowerCase is not a function`.

Expected behavior:

- Do not crash.
- Coerce `anchor` safely.
- Log row context for analysis.

### Large callback body

Observed behavior:

- Callback post failed with `ERR_FR_MAX_BODY_LENGTH_EXCEEDED`.
- `axios@0.21.x` did not pass unlimited `maxBodyLength` to `follow-redirects` unless configured per request.

Expected behavior:

- Large result payloads must be supported.
- Prefer API result retrieval or object storage for very large jobs.
- If callback is used, configure request body limits explicitly.

### Long captcha stage

Observed behavior:

- Run with `55148` rows found `2052` captcha rows.
- Sequential Puppeteer retries made the captcha stage last many hours.

Expected behavior:

- Captcha retry concurrency must be controlled and observable.
- Progress must show elapsed time and per-stage counters.
- Jobs should expose heartbeat / last activity timestamp.

## Logging Requirements

Every unexpected per-row failure should log structured JSON with:

- `jobId`
- `rowId` or global index
- chunk/batch index when relevant
- `url`
- `target_link`
- `anchor`
- `anchorType`
- `stage`
- `errorName`
- `errorCode`
- `errorMessage`
- stack trace

The service must continue processing the rest of the batch after a row-level error.

## Recommended First Milestone

Implement the smallest production-capable service:

1. `POST /jobs` accepts rows and callback config.
2. `GET /jobs/:jobId` returns job state and progress.
3. `GET /jobs/:jobId/results` returns paginated result rows.
4. Worker performs HTTP-only checks with safe parsing and status normalization.
5. Browser retry can be enabled, but with strict concurrency and timeout.
6. Callback fires after completion with compatibility payload.
7. Regression tests cover the incidents listed above.

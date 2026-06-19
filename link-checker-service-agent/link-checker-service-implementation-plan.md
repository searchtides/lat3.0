# Link Checker Service Implementation Plan

## Purpose

This document is a starting backlog for an agent building the new link checker service from scratch.

Read these documents first:

1. `link-checker-service-handoff.md`
2. `link-checker-service-api.md`
3. `link-checker-service-architecture.md`

## Non-Goals

Do not migrate unrelated `lat3.0` functionality:

- client settings UI;
- Google Drive upload;
- Ahrefs backlink download;
- source qualification;
- spam/keyword/country metrics;
- legacy report views.

The new service owns only link checking jobs.

## Phase 0: Decisions Before Coding

Answer these before implementation:

1. Storage: use the existing MySQL server unless explicitly told otherwise.
2. Queue: use a MySQL-backed queue/worker for the first release. Do not require Redis.
3. Deployment target: single VM, Docker Compose, Kubernetes, or existing server?
4. Browser runtime: CloakBrowser configuration, install method, and deployment mode?
5. API auth: service token, internal-only network, or another scheme?
6. Callback mode for first release: legacy full payload only, or job-reference too?

Recommended default:

- Node.js LTS + TypeScript.
- Fastify.
- MySQL.
- MySQL-backed queue/worker.
- CloakBrowser for browser retries.
- Interactive dashboard with WebSocket or SSE live updates and polling fallback.

## Phase 1: Project Skeleton

Create a new repository/service with:

- `src/server`
- `src/jobs`
- `src/checker`
- `src/browser`
- `src/storage`
- `src/callbacks`
- `src/ui`
- `test`

Minimum commands:

- `npm test`
- `npm run lint`
- `npm run typecheck` if TypeScript is used
- `npm run dev`
- `npm start`

Add a `.env.example` with:

```text
PORT=3000
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=link_checker
MYSQL_USER=link_checker
MYSQL_PASSWORD=
HTTP_CONCURRENCY=100
HTTP_TIMEOUT_MS=60000
BROWSER_RETRY_ENABLED=true
BROWSER_CONCURRENCY=5
BROWSER_TIMEOUT_MS=60000
CALLBACK_TIMEOUT_MS=60000
MAX_ROWS_PER_JOB=100000
```

## Phase 2: Core Domain Model

Implement types/entities:

### Job

- `id`
- `status`
- `stage`
- `total`
- `checked`
- `captchaTotal`
- `captchaChecked`
- `startedAt`
- `finishedAt`
- `elapsedSeconds`
- `lastActivityAt`
- `lastError`
- `statusCounts`
- `captchaStatusCounts`
- `options`
- `callbackConfig`

### Job Row

- `jobId`
- `rowIndex`
- `externalId`
- `input`
- `normalized`
- `status`
- `legacyStatus`
- `error`
- `attempts`
- `checkedAt`

### Attempt

- `stage`
- `method`
- `startedAt`
- `finishedAt`
- `durationMs`
- `httpStatus`
- `headersSubset`
- `status`
- `error`
- `antiBotEvidence`

## Phase 3: HTTP Checker

Implement:

- URL validation and normalization.
- Fetch with timeout.
- Redirect handling with a max redirect limit.
- Response body size limit.
- Content type handling.
- HTML parsing.
- Anchor/link extraction.
- Link comparison.
- Anchor comparison.

Do not crash on:

- JSON response bodies;
- binary response bodies;
- invalid HTML;
- missing `target_link`;
- non-string `anchor`;
- TLS failures;
- DNS failures;
- connection resets;
- timeout;
- response codes outside 2xx.

## Phase 4: Browser Retry

Implement only after HTTP checker is stable.

Rules:

- Retry anti-bot rows only.
- Use CloakBrowser as the browser runtime.
- Use the JavaScript CloakBrowser package and its Playwright/Puppeteer-compatible API.
- Use bounded concurrency.
- Use a separate timeout.
- Always close pages.
- Store attempt details.
- If browser retry fails, row status becomes `UNABLE_TO_CRAWL` or equivalent legacy status.

Anti-bot classifier should inspect:

- HTTP status;
- `server`, `cf-*`, and security headers;
- title text;
- known challenge body markers;
- response content type.

## Phase 5: Progress API And Interactive Dashboard

Implement:

- `GET /jobs/:jobId`
- `GET /jobs/:jobId/results`
- live events endpoint with WebSocket or SSE
- interactive dashboard at `GET /jobs/:jobId/progress`

Dashboard should show:

- job status and stage;
- total/checked;
- captcha total/checked;
- elapsed time;
- last activity;
- no-progress duration;
- rows per minute;
- estimated remaining time when possible;
- status counts;
- captcha status counts;
- recent row-level errors;
- callback state;
- last error;

Dashboard should support these interactions:

- pause/cancel job when supported by backend;
- filter result counts by status;
- open recent failed rows for copying into targeted tests;
- switch between overview and raw JSON snapshot;
- reconnect automatically after page reload or network interruption.

Real-time transport:

- Prefer WebSocket if bidirectional dashboard actions are implemented through the same channel.
- Use SSE if updates are one-way.
- Keep polling every 1-5 seconds as fallback and for simple deployments.

## Phase 6: Callback Delivery

Implement callback as a separate stage.

Requirements:

- timeout;
- max body config;
- retry policy;
- failure stored in job state;
- callback delivery attempts stored;
- support legacy callback URL query behavior.

Legacy compatibility:

```text
callback + '?cmd=checkingFinished'
callback + '?cmd=checkingFinished&proceed=1'
```

Payload:

```json
{
  "payload": []
}
```

For large jobs, implement `job-reference` mode:

```json
{
  "jobId": "job_...",
  "status": "finished",
  "resultsUrl": "https://checker.example/jobs/job_.../results",
  "total": 55148,
  "statusCounts": {}
}
```

## Regression Tests Required

### Unit Tests

- Anchor normalization handles string, number, boolean, null, undefined.
- URL normalization handles protocol, `www`, trailing slash.
- HTML parser extracts links from:
  - double-quoted href;
  - single-quoted href;
  - uppercase tags;
  - relative href;
  - nested anchor content;
  - entity-escaped anchor text.
- Status decision:
  - target + anchor found -> `LIVE`;
  - target found, anchor not found -> `LIVE, BUT CORRUPTED ANCHOR`;
  - target not found -> `NOT LIVE`.
- JSON body does not crash.
- Non-HTML content does not crash.
- Anti-bot classifier recognizes at least Cloudflare 403.

### Integration Tests

Use a local test HTTP server with routes:

- `/live`
- `/not-live`
- `/corrupted-anchor`
- `/json`
- `/cloudflare-403`
- `/timeout`
- `/too-many-redirects`
- `/large-body`
- `/tls-error` if feasible in test environment

### Job Tests

- Job creation returns `jobId`.
- Progress counts advance.
- Row-level error does not fail job.
- Captcha retry updates captcha counters.
- Callback failure is recorded.
- Results are paginated.
- Cancelled job stops scheduling new rows.

## Compatibility Tests From Legacy Incidents

Keep these named tests:

- `theguycornernyc_json_response_does_not_crash`
- `numeric_anchor_does_not_crash`
- `large_callback_payload_does_not_exceed_body_limit`
- `captcha_stage_reports_elapsed_time`
- `captcha_retry_is_parallel_but_bounded`

## Operational Defaults

Start conservative:

- `HTTP_CONCURRENCY=100`
- `HTTP_TIMEOUT_MS=60000`
- `BROWSER_CONCURRENCY=5`
- `BROWSER_TIMEOUT_MS=60000`
- `MAX_ROWS_PER_JOB=100000`

Add per-host throttling if remote sites or DNS become unstable.

## Acceptance Criteria

The first release is acceptable when:

- A 50k-row job completes without process crash.
- Progress survives service restart.
- UI can distinguish active, stalled, finished, failed, and callback stages.
- Captcha stage is bounded and visible.
- Known production incidents are covered by tests.
- Large jobs do not require callback full payload.
- Legacy `/start_checking` flow can be used during migration.
- Structured logs include enough context to reproduce problematic rows.

## Open Questions For Product Owner

1. Should `target_link` comparison ignore query strings?
2. Should anchor matching require exact normalized text or substring containment?
3. Should relative links count after resolving against page URL?
4. How many historical job results must be retained?
5. Is full-payload callback still required long-term?
6. Who is allowed to start jobs and view results?
7. Should browser retry be enabled by default or only on demand?
8. What is the acceptable maximum job duration?
9. Should the service deduplicate repeated source URLs within one job?
10. Should failed rows be automatically retried in later runs?

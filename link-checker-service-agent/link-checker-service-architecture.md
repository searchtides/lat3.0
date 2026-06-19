# Link Checker Service Architecture Notes

## Why Not Reuse `lat3.0`

The current project is a mixed-purpose Express application. Link checking is only one endpoint inside a broader legacy app that also handles clients, reports, Google Drive upload, Ahrefs downloads, UI pages, local files, and a separate WebSocket workflow.

The new link checker should be a standalone service, not a refactor of `lat3.0`.

## Current Architecture Problems

### One Global In-Memory Job State

Current state lives in module globals:

- `checkingStatus`
- counters
- timestamps
- last error

Problems:

- only one job can be represented;
- process restart loses progress;
- multiple concurrent jobs overwrite each other;
- horizontal scaling is impossible;
- UI cannot inspect old jobs.

Target:

- persist jobs and row results;
- address every job by `jobId`;
- expose current and historical status.

### Fire-and-Forget Endpoint Without Job Identity

Legacy `POST /start_checking` responds with `checking started`, then continues work inside the same request handler.

Problems:

- caller gets no job id;
- no reliable cancellation;
- no retry/resume;
- errors after initial response are only logged;
- callback failure can make the whole process look stuck or failed.

Target:

- create durable job first;
- enqueue work;
- return `202 Accepted` with `jobId`;
- separate checking completion from callback delivery.

### Callback Carries Entire Result Payload

Legacy callback posts:

```json
{
  "payload": [/* all result rows */]
}
```

Problems:

- large jobs exceed request body limits;
- callback receiver timeout risk;
- retrying callback resends huge payload;
- no pagination;
- payload can be larger than memory budget.

Target:

- support `job-reference` callback mode;
- make result retrieval paginated;
- keep `full-payload` only for compatibility.

### Regex HTML Parsing

Legacy code extracts anchors with regex:

```js
/<a\s(.*?)<\/a>/g
```

Problems:

- misses valid HTML variants;
- handles malformed HTML unpredictably;
- does not resolve relative URLs;
- can accidentally match script or broken markup;
- hard to test and extend.

Target:

- use a real parser such as `parse5`, `cheerio`, or equivalent;
- extract anchors from DOM;
- normalize hrefs against page URL.

### Free-Form Status Strings

Legacy code mixes HTTP status text, network error codes, and business statuses into one `status` string.

Problems:

- status counting is inconsistent;
- downstream logic depends on exact text;
- captcha detection uses string equality;
- adding metadata is hard.

Target:

- internal status enum;
- separate raw status/error metadata;
- compatibility mapping at output boundary.

### Captcha Detection Is Too Narrow

Legacy captcha detection:

```js
status === 403 && response.headers.server === 'cloudflare'
```

Problems:

- misses Cloudflare challenges with `200`;
- misses other anti-bot providers;
- misses different Cloudflare headers;
- treats some anti-bot pages as ordinary `NOT LIVE`.

Target:

- anti-bot classifier using status, headers, title, body markers;
- record evidence;
- configurable retry policy.

### Browser Retry Is Expensive

Legacy retry uses Puppeteer for captcha links. It was originally sequential and later changed to limited parallel batches.

Problems:

- browser pages are expensive;
- high captcha volume can dominate runtime;
- browser leaks can stall the job;
- one browser instance is a single point of resource pressure.

Target:

- bounded browser concurrency;
- separate timeout;
- page close in `finally`;
- metrics around browser pool;
- optional browser retry per job.

### No Backpressure Or Queue

Legacy first pass checks chunks of 1000 rows in parallel.

Problems:

- 1000 concurrent outbound HTTP requests can overload network, DNS, remote hosts, or the process;
- no adaptive throttling;
- no host-based rate limits;
- no retry budget.

Target:

- worker queue with configurable concurrency;
- optional per-host concurrency;
- retry policy by error type;
- explicit rate limit and timeout config.

### Logging Is Not A Data Model

Recent improvements added structured logs for row failures. This helps debugging but is not enough for a new service.

Target:

- store row attempts;
- expose failed rows via API filters;
- include raw error code/message/stack in internal diagnostics;
- keep user-facing output stable.

## Recommended Target Architecture

```text
API process
  POST /jobs
  GET /jobs/:id
  GET /jobs/:id/results
  GET /jobs/:id/events
  POST /jobs/:id/cancel

Queue
  MySQL-backed durable job queue
  retry / cancellation support

Workers
  HTTP checker pool
  browser retry pool
  callback sender

Storage
  MySQL tables for jobs
  MySQL tables for job_rows
  MySQL tables for job_events / attempts

UI
  interactive dashboard
  WebSocket or SSE events
  polling fallback
```

## Suggested Technology Choices

Keep the first version boring:

- Runtime: Node.js LTS or TypeScript on Node.js.
- API: Fastify or Express. Fastify is preferred for schema validation.
- Queue: MySQL-backed queue for the first release. Do not require Redis.
- Storage: MySQL, because it is already installed on the target server.
- HTML parsing: `cheerio` or `parse5`.
- Browser automation: CloakBrowser. It is intended as the browser runtime for anti-bot/captcha retries and exposes Playwright/Puppeteer-compatible APIs.
- Validation: JSON schema / Zod.
- Tests: Node test runner, Vitest, or Jest.

Avoid adding a frontend framework unless the UI becomes complex. The first dashboard can be implemented with server-rendered HTML plus small client-side JS, but it should still behave as an interactive live dashboard.

Redis/BullMQ can be reconsidered later if MySQL queue throughput or locking becomes a bottleneck. It should not be part of the first implementation.

## CloakBrowser Notes

Use CloakBrowser for browser retry work instead of standard Playwright/Puppeteer browsers.

Rationale:

- The target runtime is a Chromium-based browser intended for automation.
- It exposes Playwright/Puppeteer-compatible APIs, so the worker can keep a familiar browser/page lifecycle.
- It should be treated as the browser binary/runtime choice, not as a third-party captcha solving service.

Implementation requirements:

- Keep browser retry optional with `BROWSER_RETRY_ENABLED`.
- Keep `BROWSER_CONCURRENCY` low by default.
- Keep browser timeout separate from HTTP timeout.
- Always close pages in `finally`.
- Store CloakBrowser version/runtime info in job diagnostics when feasible.
- Document install and binary download/cache behavior in deployment notes.

## MySQL Queue Notes

Use explicit job/row state in MySQL rather than an external queue for the first release.

Recommended fields for schedulable rows:

- `state`: `pending`, `running`, `done`, `failed`, `cancelled`
- `stage`: `checking`, `captcha`, `callback`
- `lockedBy`
- `lockedUntil`
- `attemptCount`
- `nextRunAt`
- `updatedAt`

Worker claiming strategy:

1. Select a small batch of due `pending` rows for a job/stage.
2. Atomically mark them `running` with `lockedBy` and `lockedUntil`.
3. Process rows with bounded concurrency.
4. Write result and mark rows `done`.
5. If worker crashes, another worker can reclaim rows whose `lockedUntil` is in the past.

This gives enough durability for the first version without installing Redis.

## Worker Flow

1. Create job and rows.
2. Mark job `running`, stage `checking`.
3. Process rows with HTTP checker.
4. Store each result and attempt.
5. If anti-bot rows exist and browser retry is enabled:
   - mark stage `captcha`;
   - process anti-bot rows with browser pool;
   - update final statuses.
6. Mark stage `callback` if callback enabled.
7. Send callback.
8. Mark job `finished` or `failed`.

Row-level failure must not fail the whole job. Job-level failure should be reserved for infrastructure or unrecoverable storage/queue errors.

## Observability Requirements

Metrics:

- jobs created/running/finished/failed;
- rows checked per second;
- HTTP status distribution;
- network error distribution;
- browser retry queue length;
- browser retry duration;
- callback success/failure;
- job elapsed time;
- no-progress duration.

Logs:

- structured JSON;
- include `jobId`;
- include row identity on row-level errors;
- include stage and attempt number.

Health:

- `/healthz`: process is alive.
- `/readyz`: dependencies reachable.
- worker heartbeat.

## Interactive Dashboard Requirements

The dashboard is part of the service, not an afterthought. It should help operators answer:

- Is the job active, stalled, finished, failed, or waiting on callback?
- Which stage is currently running?
- How long has the job been running?
- When did the last progress happen?
- How fast are rows being checked?
- Which statuses dominate the result?
- Which rows caused recent exceptions?
- Is captcha retry making progress?

Transport:

- Use WebSocket or SSE for live updates.
- Keep `GET /jobs/:jobId` polling as fallback.
- On reconnect, the dashboard must request a full snapshot before applying live deltas.

Interactive controls:

- cancel job;
- copy failed row context;
- filter visible result/status data;
- show raw JSON snapshot for debugging;
- link to paginated results.

Do not rely only on browser-side elapsed timers. The server API must expose `elapsedSeconds` and `lastActivityAt`.

## Stuck Job Detection

A job is suspicious when:

- `running === true`;
- `lastActivityAt` has not changed for a configured threshold;
- worker heartbeat is stale;
- no row progress for threshold;
- browser queue has active tasks longer than timeout.

The UI should show:

- elapsed time;
- last activity time;
- rows per minute;
- estimated remaining time when possible;
- current stage.

## Migration Strategy

1. Build the new service with legacy-compatible `/start_checking`.
2. Point one low-risk client/job to the new service.
3. Compare results with legacy output on the same rows.
4. Switch callback receiver to consume `job-reference` mode when ready.
5. Deprecate full-payload callback for large jobs.
6. Remove old link-checking code from `lat3.0` after all callers move.

## Definition Of Done For First Release

- Can process at least 50k rows without process restart.
- Can report progress during all stages.
- Can resume or accurately report failed jobs after restart.
- Has regression tests for known incidents.
- Browser retry is bounded and observable.
- Callback failure is visible and retryable.
- Result retrieval is paginated.
- Legacy `/start_checking` compatibility exists.

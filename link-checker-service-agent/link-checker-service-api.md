# Link Checker Service API Draft

This is a target API for the new standalone link checker service. It is intentionally independent from the legacy `lat3.0` Express app.

## Principles

- Jobs are durable and addressable by `jobId`.
- Processing is asynchronous.
- Progress and results survive process restarts.
- Row-level failures do not fail the whole job.
- Callback support exists for migration, but clients should prefer polling or streaming job results.
- The dashboard should be interactive and receive live progress updates through WebSocket or SSE, with polling fallback.
- All timestamps use ISO 8601 UTC.

## Authentication

Define before production. Acceptable options:

- Internal network only plus service token.
- `Authorization: Bearer <token>`.
- HMAC-signed callbacks if callback receiver needs verification.

Do not expose this service publicly without authentication and rate limits.

## `POST /jobs`

Create a link checking job.

### Request

```json
{
  "rows": [
    {
      "url": "https://source.example/post",
      "target_link": "https://target.example/",
      "anchor": "Anchor text",
      "externalId": "optional-client-row-id"
    }
  ],
  "callback": {
    "url": "https://legacy.example/callback",
    "query": {
      "cmd": "checkingFinished",
      "proceed": "1"
    },
    "enabled": true
  },
  "options": {
    "httpConcurrency": 100,
    "httpTimeoutMs": 60000,
    "browserRetryEnabled": true,
    "browserConcurrency": 5,
    "browserTimeoutMs": 60000,
    "callbackMode": "full-payload"
  }
}
```

### Response

```json
{
  "jobId": "job_20260618_abc123",
  "status": "queued",
  "createdAt": "2026-06-18T12:00:00.000Z",
  "links": {
    "self": "/jobs/job_20260618_abc123",
    "results": "/jobs/job_20260618_abc123/results",
    "events": "/jobs/job_20260618_abc123/events"
  }
}
```

### Validation

- `rows` must be a non-empty array.
- `rows.length` should be capped by config.
- Each row must have `url`.
- `target_link` and `anchor` may be empty or non-string in legacy inputs, but should be normalized and flagged.
- Unknown row fields must be preserved.

## `GET /jobs/:jobId`

Return job state and progress.

### Response

```json
{
  "jobId": "job_20260618_abc123",
  "status": "running",
  "stage": "captcha",
  "total": 55148,
  "checked": 55148,
  "captchaTotal": 2052,
  "captchaChecked": 744,
  "startedAt": "2026-06-18T06:04:07.691Z",
  "finishedAt": null,
  "elapsedSeconds": 47880,
  "lastActivityAt": "2026-06-18T19:21:59.000Z",
  "lastError": null,
  "statusCounts": {
    "LIVE": 32228,
    "NOT_LIVE": 6242,
    "CLOUDFLARE_CAPTCHA": 2052
  },
  "captchaStatusCounts": {
    "LIVE": 100,
    "UNABLE_TO_CRAWL": 50
  }
}
```

### Status Values

Job status:

- `queued`
- `running`
- `finished`
- `failed`
- `cancelled`

Stage:

- `queued`
- `checking`
- `captcha`
- `callback`
- `finished`
- `failed`
- `cancelled`

## `GET /jobs/:jobId/results`

Return paginated results.

### Query Parameters

- `limit`: default `1000`, max configurable.
- `cursor`: opaque pagination cursor.
- `status`: optional status filter.
- `stage`: optional source stage filter, for example `checking` or `captcha`.

### Response

```json
{
  "jobId": "job_20260618_abc123",
  "nextCursor": "opaque-cursor",
  "rows": [
    {
      "url": "https://source.example/post",
      "target_link": "https://target.example/",
      "anchor": "Anchor text",
      "externalId": "optional-client-row-id",
      "status": "LIVE",
      "rawStatus": "LIVE",
      "error": null,
      "checkedAt": "2026-06-18T12:05:00.000Z",
      "attempts": [
        {
          "stage": "checking",
          "method": "http",
          "status": "LIVE",
          "httpStatus": 200,
          "durationMs": 830
        }
      ]
    }
  ]
}
```

## `GET /jobs/:jobId/events` or `WS /jobs/:jobId/events`

Live event stream for the interactive dashboard.

Preferred options:

- WebSocket if the dashboard needs bidirectional actions over the same connection later.
- Server-Sent Events if updates are one-way and proxy simplicity matters.
- Polling `GET /jobs/:jobId` must remain as fallback.

Do not make the dashboard depend only on a browser-local timer. The server should emit or expose updates whenever job counters, stage, status counts, row failures, callback state, or cancellation state changes.

### Event Example

SSE:

```text
event: progress
data: {"jobId":"job_20260618_abc123","stage":"checking","checked":1200,"total":55148}
```

WebSocket message:

```json
{
  "type": "progress",
  "jobId": "job_20260618_abc123",
  "stage": "checking",
  "checked": 1200,
  "total": 55148,
  "elapsedSeconds": 300,
  "lastActivityAt": "2026-06-18T12:05:00.000Z"
}
```

Recommended event types:

- `snapshot`
- `progress`
- `stageChanged`
- `rowError`
- `callbackStarted`
- `callbackFinished`
- `callbackFailed`
- `jobFinished`
- `jobFailed`
- `jobCancelled`

## `POST /jobs/:jobId/cancel`

Request cancellation.

### Response

```json
{
  "jobId": "job_20260618_abc123",
  "status": "cancelled"
}
```

Cancellation must:

- stop scheduling new rows;
- close browser pages;
- preserve partial results;
- mark callback as skipped or cancelled.

## Legacy Compatibility Endpoint

For migration, the new service may expose:

```http
POST /start_checking
```

Legacy request:

```json
{
  "rows": [],
  "callback": "https://legacy.example/callback",
  "proceed": true
}
```

Legacy response:

```text
checking started
```

Compatibility mapping:

- Create a job.
- Translate `callback` string to callback config.
- Return immediately.
- On job completion, POST `{ "payload": resultRows }` to `callback + '?cmd=checkingFinished'`.
- Append `&proceed=1` when `proceed` is truthy.

## Callback Options

For large jobs, `full-payload` callbacks can be fragile. Support these modes:

- `full-payload`: legacy mode, POST all rows.
- `job-reference`: POST `jobId`, counts, and results URL.
- `none`: no callback.

Callback request should include:

- explicit body size config;
- retry policy;
- timeout;
- structured failure stored in job state.

## Storage Model

Minimum durable entities:

### `jobs`

- `id`
- `status`
- `stage`
- `total`
- `checked`
- `captchaTotal`
- `captchaChecked`
- `startedAt`
- `finishedAt`
- `lastActivityAt`
- `lastError`
- `options`
- `callbackConfig`
- `statusCounts`
- `captchaStatusCounts`

### `job_rows`

- `jobId`
- `rowIndex`
- `externalId`
- original row JSON
- normalized URL
- normalized target link
- normalized anchor
- final status
- raw status
- error JSON
- attempts JSON
- checkedAt

## Status Normalization

Use internal enum values and map to legacy strings only at output boundary.

Recommended internal statuses:

- `LIVE`
- `NOT_LIVE`
- `LIVE_CORRUPTED_ANCHOR`
- `ANTI_BOT`
- `UNABLE_TO_CRAWL`
- `NOT_FOUND`
- `HTTP_ERROR`
- `NETWORK_ERROR`
- `TLS_ERROR`
- `TIMEOUT`
- `REDIRECT_ERROR`
- `INVALID_INPUT`

Preserve raw HTTP code and error code in result metadata.

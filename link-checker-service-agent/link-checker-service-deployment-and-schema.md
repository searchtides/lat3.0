# Deployment, MySQL Schema, And Stall Detection

This document covers only first-release deployment notes, a draft MySQL schema, and stall detection policy.

## Deployment Notes

The link checker must run as a standalone service, separate from the legacy `lat3.0` app.

Recommended runtime layout:

```text
link-checker-service
  API server
  background worker
  MySQL database
  CloakBrowser runtime for browser retries
```

The API server and worker may run in the same Node.js process for the first internal release if that keeps deployment simple. The code should still keep API, worker, storage, and checker modules separate so they can be split later.

Required environment variables:

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
CLOAKBROWSER_CACHE_DIR=
CALLBACK_TIMEOUT_MS=60000
MAX_ROWS_PER_JOB=100000
JOB_STALL_AFTER_SECONDS=600
WORKER_LOCK_SECONDS=300
```

Required operational endpoints:

- `GET /healthz`: process is alive.
- `GET /readyz`: service can reach MySQL and can accept work.

Deployment options:

- `systemd` service on the existing server is acceptable for the first release.
- Docker is acceptable if browser dependencies are bundled and predictable.
- The service must write structured logs to stdout/stderr so the host process manager can collect them.

Browser runtime notes:

- Use CloakBrowser for browser retries.
- Install the JavaScript CloakBrowser package explicitly.
- Account for first-launch binary download/cache behavior.
- Configure `CLOAKBROWSER_CACHE_DIR` if the default cache location is not suitable for the deployment host.
- Keep browser concurrency low by default.
- Make browser retry optional with `BROWSER_RETRY_ENABLED`.
- Expose browser timeout separately from HTTP timeout.

## Draft MySQL Schema

This is a starting point, not a final migration. The implementing agent should adjust field types and indexes based on the chosen ORM/query layer.

### `jobs`

```sql
CREATE TABLE jobs (
  id VARCHAR(64) PRIMARY KEY,
  status VARCHAR(32) NOT NULL,
  stage VARCHAR(32) NOT NULL,
  total INT NOT NULL DEFAULT 0,
  checked INT NOT NULL DEFAULT 0,
  captcha_total INT NOT NULL DEFAULT 0,
  captcha_checked INT NOT NULL DEFAULT 0,
  status_counts JSON NULL,
  captcha_status_counts JSON NULL,
  options JSON NULL,
  callback_config JSON NULL,
  last_error JSON NULL,
  created_at DATETIME(3) NOT NULL,
  started_at DATETIME(3) NULL,
  finished_at DATETIME(3) NULL,
  last_activity_at DATETIME(3) NULL,
  updated_at DATETIME(3) NOT NULL,
  INDEX idx_jobs_status_stage (status, stage),
  INDEX idx_jobs_updated_at (updated_at)
);
```

### `job_rows`

```sql
CREATE TABLE job_rows (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  job_id VARCHAR(64) NOT NULL,
  row_index INT NOT NULL,
  external_id VARCHAR(255) NULL,
  state VARCHAR(32) NOT NULL DEFAULT 'pending',
  stage VARCHAR(32) NOT NULL DEFAULT 'checking',
  original_row JSON NOT NULL,
  normalized_url TEXT NULL,
  normalized_target_link TEXT NULL,
  normalized_anchor TEXT NULL,
  status VARCHAR(64) NULL,
  legacy_status VARCHAR(128) NULL,
  error JSON NULL,
  checked_at DATETIME(3) NULL,
  locked_by VARCHAR(128) NULL,
  locked_until DATETIME(3) NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  next_run_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  UNIQUE KEY uniq_job_row (job_id, row_index),
  INDEX idx_job_rows_job_state_stage (job_id, state, stage),
  INDEX idx_job_rows_lock (state, locked_until),
  INDEX idx_job_rows_status (job_id, status),
  CONSTRAINT fk_job_rows_job FOREIGN KEY (job_id) REFERENCES jobs(id)
);
```

### `job_attempts`

```sql
CREATE TABLE job_attempts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  job_id VARCHAR(64) NOT NULL,
  job_row_id BIGINT NOT NULL,
  stage VARCHAR(32) NOT NULL,
  method VARCHAR(32) NOT NULL,
  status VARCHAR(64) NULL,
  legacy_status VARCHAR(128) NULL,
  http_status INT NULL,
  duration_ms INT NULL,
  headers_subset JSON NULL,
  anti_bot_evidence JSON NULL,
  error JSON NULL,
  started_at DATETIME(3) NOT NULL,
  finished_at DATETIME(3) NULL,
  INDEX idx_job_attempts_job_row (job_row_id),
  INDEX idx_job_attempts_job_stage (job_id, stage),
  CONSTRAINT fk_job_attempts_job FOREIGN KEY (job_id) REFERENCES jobs(id),
  CONSTRAINT fk_job_attempts_row FOREIGN KEY (job_row_id) REFERENCES job_rows(id)
);
```

### `callback_attempts`

```sql
CREATE TABLE callback_attempts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  job_id VARCHAR(64) NOT NULL,
  url TEXT NOT NULL,
  status VARCHAR(32) NOT NULL,
  http_status INT NULL,
  request_mode VARCHAR(32) NOT NULL,
  error JSON NULL,
  started_at DATETIME(3) NOT NULL,
  finished_at DATETIME(3) NULL,
  duration_ms INT NULL,
  INDEX idx_callback_attempts_job (job_id),
  CONSTRAINT fk_callback_attempts_job FOREIGN KEY (job_id) REFERENCES jobs(id)
);
```

### `job_events`

```sql
CREATE TABLE job_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  job_id VARCHAR(64) NOT NULL,
  type VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  created_at DATETIME(3) NOT NULL,
  INDEX idx_job_events_job_created (job_id, created_at),
  CONSTRAINT fk_job_events_job FOREIGN KEY (job_id) REFERENCES jobs(id)
);
```

Use `job_events` for dashboard replay, debugging, and reconnect snapshots if needed. It can be pruned separately from final results.

## Stall Detection Policy

A job can be running but not making progress. The service must expose enough data to detect that state.

Required fields:

- `elapsedSeconds`
- `lastActivityAt`
- `lastProgressAt`
- `stage`
- `checked`
- `captchaChecked`
- `workerId` for active locks when available

Recommended thresholds:

- `JOB_STALL_AFTER_SECONDS=600`: warn when no progress for 10 minutes.
- `WORKER_LOCK_SECONDS=300`: row locks expire after 5 minutes unless renewed.
- HTTP row timeout: `HTTP_TIMEOUT_MS`.
- Browser row timeout: `BROWSER_TIMEOUT_MS`.
- Callback timeout: `CALLBACK_TIMEOUT_MS`.

Definitions:

- `active`: job is running and `lastProgressAt` is recent.
- `slow`: job is running, progress exists, but rows per minute is below expected threshold.
- `stalled`: job is running and no progress has happened for `JOB_STALL_AFTER_SECONDS`.
- `failed`: unrecoverable job-level error occurred.

Dashboard behavior:

- Show elapsed time and last activity time.
- Show no-progress duration.
- Highlight `stalled` jobs.
- Continue showing the last known counters.
- Provide raw job JSON so operators can inspect lock and worker metadata.

Worker behavior:

- Update `last_activity_at` for job-level activity.
- Update `lastProgressAt` when counters change.
- Renew row locks for long browser checks if needed.
- Reclaim `running` rows whose `locked_until` is in the past.
- Do not mark the whole job failed because of a single row timeout.

Stall detection should not automatically kill a job in the first release. It should report clearly and allow manual cancellation.

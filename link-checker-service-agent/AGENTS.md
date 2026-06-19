# Agent Instructions

You are building a new standalone link checker service from scratch.

## Read First

Read these files in order before writing code:

1. `link-checker-service-handoff.md`
2. `link-checker-service-api.md`
3. `link-checker-service-architecture.md`
4. `link-checker-service-deployment-and-schema.md`
5. `link-checker-service-implementation-plan.md`

## Core Objective

Build a durable asynchronous service that accepts link checking jobs, tracks progress, checks link and anchor presence, retries anti-bot/captcha cases with bounded browser automation, stores results, exposes progress/results APIs, provides an interactive real-time dashboard, and supports the legacy callback flow during migration.

## Hard Constraints

- Do not build this as a route inside the old `lat3.0` app.
- Do not copy legacy architecture blindly.
- Do not use process-global state as the source of truth for jobs.
- Do not process only one job globally.
- Do not parse HTML links with regex.
- Do not let one row-level error fail the whole job.
- Do not rely on full-payload callbacks as the only result delivery mechanism.

## Compatibility Requirements

Implement legacy compatibility only as an adapter:

- `POST /start_checking`
- request body: `rows`, `callback`, `proceed`
- immediate text response: `checking started`
- final callback payload: `{ "payload": resultRows }`
- callback URL query: `?cmd=checkingFinished`, plus `&proceed=1` when needed

The native API should be job-based:

- `POST /jobs`
- `GET /jobs/:jobId`
- `GET /jobs/:jobId/results`
- `GET /jobs/:jobId/events` or `WS /jobs/:jobId/events` for live dashboard updates
- `POST /jobs/:jobId/cancel`

## Quality Bar

- Add tests for every production incident listed in `link-checker-service-handoff.md`.
- Persist job state and row results.
- Track elapsed time and last activity.
- Keep browser retry bounded and observable.
- Make result retrieval paginated.
- Use structured logs with `jobId` and row context.

## First Implementation Bias

Prefer a small, reliable first release over a large framework-heavy rewrite.

Recommended stack unless instructed otherwise:

- Node.js LTS with TypeScript.
- Fastify for API and schema validation.
- MySQL for jobs/results because it is already available on the target server.
- MySQL-backed queue/worker for the first release. Do not require Redis.
- CloakBrowser for browser retries.
- Interactive dashboard with WebSocket or SSE live updates and polling fallback.

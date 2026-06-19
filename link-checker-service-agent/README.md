# Link Checker Service Agent Package

This folder is a self-contained handoff package for building a new standalone link checker service from scratch.

Start here:

1. Read `AGENTS.md`.
2. Read `link-checker-service-handoff.md`.
3. Read `link-checker-service-api.md`.
4. Read `link-checker-service-architecture.md`.
5. Read `link-checker-service-deployment-and-schema.md`.
6. Use `link-checker-service-implementation-plan.md` as the first backlog.

The legacy `lat3.0` repository should be treated only as source context. Do not build the new service inside the legacy app unless explicitly instructed.

## Files

- `AGENTS.md`: working instructions for the coding agent.
- `link-checker-service-handoff.md`: business context, current behavior, statuses, incidents.
- `link-checker-service-api.md`: target API contract.
- `link-checker-service-architecture.md`: architecture notes and legacy anti-patterns.
- `link-checker-service-deployment-and-schema.md`: deployment notes, draft MySQL schema, stall detection.
- `link-checker-service-implementation-plan.md`: phased implementation plan and tests.

## Intended Use

Copy this folder into a new empty project/repository and start the agent there.

# Benchcraft

A private workbench for custom bench automation. Includes configurable recipes for timed liquid dispensing, temperature logging, and actuator cycling; a planning component catalogue; wiring schedules; firmware and OpenSCAD exports; simulated timing; and saved projects with acceptance checklists.

## Implemented

- React/Vinext interface with responsive workspace, projects, catalogue, and connection status.
- Cloudflare D1 project persistence using parameterized statements and Drizzle schema migrations.
- Arduino firmware templates for a classic ESP32. Actuator sketches default to dry-run mode.
- Markdown build-plan, CSV BOM, Arduino sketch, and OpenSCAD tray downloads.
- Optional server-side OpenAI Responses integration restricted to supported recipes.
- Feature-detected WebMCP project read, configuration, and save tools.

## Current limits

OpenAI Platform rejected the API key provisioning request. No API key was created or saved. Until `OPENAI_API_KEY` is securely configured as a Sites runtime secret, AI generation is unavailable and the app explicitly uses deterministic recipe selection. The AI route has not been exercised against a live model.

The catalogue contains illustrative component types and budget estimates, not live vendor SKUs or stock. Firmware has not been compiled for or tested on a physical board. The tray is a dimensional concept, not a fit-validated enclosure. There is no serial hardware bridge, printer integration, or CNC operation. Simulations are ideal timing calculations, not measured behavior.

Deployment is owner-private at the Sites access layer. Project records belong to that private workspace; do not enable multi-user public access without adding application-level identity and record ownership.

## Source map

- `app/page.tsx`: workspace and project interactions
- `lib/bench.ts`: recipes, validation, calculations, and exports
- `app/api/projects/route.ts`: project storage
- `app/api/generate/route.ts`: optional AI configuration
- `db/schema.ts` and `drizzle/`: database schema and migrations
- `scripts/check-domain.mjs`: targeted domain checks

## Verification

TypeScript checking and the production build pass. Domain checks cover parameter limits, dose cutoff, prompt extraction, and dry-run defaults. SQLite migration and save/update/reload queries were exercised in an isolated database. Browser and WebMCP runtime validation were not performed in this environment.

Use the existing package manager and the Sites building/hosting skills for dependency management, build, migrations, and publication. Keep API credentials out of source control and browser bundles.

# Benchcraft

Benchcraft lets a person, or their agent, turn a plain-language request into a buildable physical device. Describe what it should do; Benchcraft picks compatible parts from a partner component index, writes the program, generates a printable enclosure, and can send that enclosure to a connected 3D printer through a local bench agent. Everything the workbench can do is also exposed to agents over the Model Context Protocol.

See [docs/agent-api.md](docs/agent-api.md) for the agent surface and [prompt-to-device-gated-build-plan.md](prompt-to-device-gated-build-plan.md) for the delivery gates.

## What works

- **Partner component index** (`lib/catalog/`): 46 real SKUs from Raspberry Pi, Arduino, Adafruit and generic suppliers, each with capabilities it provides, buses and power it requires, a footprint for enclosure sizing, and code snippets for MicroPython, Arduino C++ and Python. Adafruit price and stock refresh live from Adafruit's public product API; Raspberry Pi prices are published RRP; Arduino and generic prices are estimates.
- **Prompt-to-device planner** (`lib/design.ts`): extracts needs from everyday language, chooses a controller, resolves parts by capability, adds drivers and power supplies automatically, assigns pins, and produces wiring, a dry-run-by-default program, a parametric OpenSCAD enclosure, fabrication jobs, assembly steps, a checklist, cost, and an interactive simulation spec. Mains, medical, flight and vehicle requests are refused with a reason; vague prompts get a question.
- **Designer view**: prompt in, design out, with parts, wiring, program, enclosure, assembly, and a "Try it" prototype with sliders. One button sends the enclosure to a printer.
- **Machines and jobs** (`lib/machines/`, `scripts/bench-agent.mjs`): a local agent registers printers and CNC machines, heartbeats, claims jobs, converts OpenSCAD → STL → G-code when OpenSCAD and a slicer are installed, and drives Bambu Lab (LAN mode), OctoPrint, Moonraker, PrusaLink, GRBL, or a simulator. `--discover` finds printers on the network. Jobs wait for operator approval unless a machine is marked trusted.
- **MCP server** (`/api/mcp`): nine tools covering the index, the planner and the machine queue. Fabrication tools require `BENCH_API_TOKEN`.
- Original bench recipes (dispenser, logger, cycler) with Arduino firmware and project persistence remain in the Workbench view.

## Current limits

- No physical device from the planner has been assembled yet; Gate 1 of the build plan is open. Generated programs are syntax-checked by review, not compiled or flashed. The enclosure OpenSCAD has been reviewed but not rendered (OpenSCAD was not installed in the build environment); fit-check the first print.
- Machine adapters were written against the public Bambu Lab LAN, OctoPrint, Moonraker, PrusaLink and GRBL protocols. Only the simulated adapter and the Bambu adapter (against a fake printer, `scripts/check-bambu.mjs`) have been exercised; no real printer has run a job yet. The first target machine is a Bambu Lab A1 mini, chosen 2026-09-11.
- Partner pricing beyond Adafruit is not live. Nothing here is a supplier quote.
- Prompt understanding is rule-based. It handles the supported capability vocabulary well and says so when it cannot; it does not invent designs for things it does not recognise. `OPENAI_API_KEY` remains optional and only drives the legacy recipe configurator.
- The site is owner-private at the Sites access layer. Do not enable public access without adding application-level identity.

## Running it

```
npx -y pnpm@11.25.0 install --frozen-lockfile
pnpm dev                     # http://localhost:5173
node scripts/check-domain.mjs
node scripts/check-bambu.mjs        # Bambu adapter against a fake printer (needs openssl)
```

Local secrets go in `.dev.vars` (ignored): `BENCH_AGENT_TOKEN`, `BENCH_API_TOKEN`. Migrations live in `drizzle/`; the hosting platform applies them on deploy. Locally, apply the SQL files to the miniflare D1 database once.

To try the whole loop without hardware:

```
node scripts/bench-agent.mjs --discover                          # lists real printers on the LAN
node scripts/bench-agent.mjs --example > bench-agent.json      # keep only sim-printer, set server
BENCH_AGENT_TOKEN=… node scripts/bench-agent.mjs bench-agent.json
```

Then open Designer, describe a device, send its enclosure to the simulated printer, and approve the job under Machines.

## Source map

- `lib/catalog/schema.ts`, `seed.ts`, `index.ts`: component index, capability vocabulary, search, live refresh
- `lib/design.ts`: prompt → design record
- `lib/machines/schema.ts`, `store.ts`: machines, jobs, designs in D1
- `lib/mcp.ts`, `app/api/mcp/route.ts`: MCP server
- `app/api/catalogue`, `design`, `machines`, `jobs`, `jobs/claim`, `status`: HTTP routes
- `components/designer.tsx`, `components/machines.tsx`: Designer and Machines views
- `scripts/bench-agent.mjs`: local machine agent
- `lib/bench.ts`, `app/page.tsx`: original recipes and workspace

## Verification

TypeScript, the production build, and `scripts/check-domain.mjs` pass. The domain checks cover index integrity, capability resolution, driver and power insertion, pin constants in generated MicroPython and Arduino, enclosure generation, simulation triggers, refusals, and job state rules. The full loop — design over MCP, submit with token, approval gate, agent claim, simulated run, completion — was exercised against a local dev server. Browser rendering of the new views was not screenshot-verified in this environment.

## Review fixes

Machine input formats are now derived from the native adapter formats and available conversion tools. Restart the bench agent after updating it so its registered capabilities include OpenSCAD/STL where conversion is supported. A printer slicer is not advertised for CNC or laser toolpaths.

Before dispatch, the agent checks the job state again after conversion and requires a successful server transition. Concurrent state updates cannot overwrite cancellation. Cancellation of an already running machine is still polled and is not an emergency stop.

Bambu completion requires a new active-print report before FINISH; a missing start confirmation times out after 120 seconds. The component planner favors owned and available compatible parts.

Regression commands: `node scripts/check-agent-jobs.mjs`, `node scripts/check-bambu.mjs`, and `node --experimental-strip-types scripts/check-domain.mjs`. Hardware behavior still requires physical validation.

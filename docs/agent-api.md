# Benchcraft for agents

Benchcraft exposes three things to agents: a **partner component index**, a **prompt-to-device planner**, and a **machine queue** for 3D printers and CNC machines. Any Model Context Protocol (MCP) client can use all of them through one endpoint; plain HTTP works too.

## Connect over MCP

```
claude mcp add --transport http benchcraft https://<your-site>/api/mcp \
  --header "Authorization: Bearer <BENCH_API_TOKEN>"
```

The endpoint is stateless Streamable HTTP: POST JSON-RPC, JSON back, no SSE stream. `GET /api/mcp` returns a human-readable tool list.

| Tool | Auth | What it does |
|---|---|---|
| `catalogue_overview` | none | Partners, capability vocabulary, indexed controllers, pricing rules. Call first. |
| `search_components` | none | Filter the index by text, category, partner, capability, price, stock. `live: true` refreshes Adafruit price and stock. |
| `get_component` | none | Full record: sources, datasheet, footprint, bus and power needs, code snippets per platform. |
| `design_device` | none | Plain-language request → full design record (saved when storage is available). |
| `get_design` | none | Fetch a saved design, or list recent ones. |
| `list_machines` | none | Registered machines with live state, build volume, accepted files, trust flag, plus supported adapters. |
| `submit_fabrication_job` | token | Queue a design's enclosure (or an inline file) on a machine. |
| `job_status` | none | One job by id, or recent jobs by machine and state. |
| `cancel_job` | token | Cancel a pending, queued or running job. |

Read-only tools are open inside the private site. Tools that move a machine need `BENCH_API_TOKEN`, and jobs still wait for operator approval in the workbench unless the operator has marked the machine **trusted**.

## Capability vocabulary

Components declare what they `provide` and what they `require`. The planner resolves a request by capability, then adds drivers and power automatically.

- Controllers: `mcu`, `sbc`
- Sensing: `sense:temperature`, `sense:humidity`, `sense:pressure`, `sense:distance`, `sense:motion`, `sense:light`, `sense:imu`, `sense:current`, `sense:soil-moisture`, `sense:weight`, `sense:button`, `sense:rotary`, `sense:camera`, …
- Actuation: `actuate:servo`, `actuate:stepper`, `actuate:dc-motor`, `actuate:pump`, `actuate:relay`, `actuate:solenoid`, `actuate:valve`, `actuate:led-strip`, `actuate:buzzer`, `actuate:fan`
- Display: `display:text`, `display:graphic`
- Drivers: `drive:mosfet`, `drive:stepper`, `drive:dc-motor`, `drive:relay`, `drive:adc`
- Power and connectivity: `power:5v`, `power:12v`, `power:battery`, `power:charger`, `connect:wifi`, `connect:ble`
- Mechanical: `mech:enclosure`, `mech:wiring`, `mech:prototyping`, `mech:mounting`

Requirements name a bus (`i2c`, `spi`, `uart`, `onewire`, `pwm`, `adc`, `gpio`, `csi`), GPIO pin count, supply rail and peak current, and any driver that must sit between controller and part.

## The design record

`design_device` returns, in one object: `summary`, `needs`, `unsupported`, `questions`, `assumptions`, the chosen `controller`, `parts` (qty, role, price, pricing kind, stock, partner SKU and URL, assigned pins, owned flag), `wiring`, `power` (rails and warnings), `firmware` (MicroPython, Arduino C++ or Python with actuators in dry-run), `enclosure` (parametric OpenSCAD sized from footprints, with cutouts), `fabrication` (files ready for `submit_fabrication_job`), `assembly` steps, a `checklist`, `cost`, and a `simulation` spec (inputs, outputs and the trigger rule) for an interactive prototype.

Refusals are explicit: mains voltage, medical, flight and vehicle control return `recognized: false` with a reason. A prompt with no recognisable need returns a clarifying question instead of an invented design.

## Plain HTTP

| Route | Notes |
|---|---|
| `GET /api/catalogue?q=&category=&partner=&capability=&maxPrice=&inStockOnly=1&live=1` | Partner index. |
| `POST /api/design` `{ prompt, preferences?, inventory? }` | Design record. `GET /api/design?id=` fetches a saved one. |
| `GET /api/machines` | Machines and adapters. `POST` (agent token) registers; `PATCH` heartbeats (agent) or sets trust (operator). |
| `GET /api/jobs?machineId=&state=&id=` | Jobs. `POST` creates (operator); `PATCH` approves/cancels (operator) or reports progress (agent). |
| `POST /api/jobs/claim` `{ machineId }` | Agent token. Hands the oldest queued job, with file content, to the bench agent. |
| `GET /api/status` | AI, storage, machines, token configuration. |

Browser writes are same-origin only. Agent writes carry `Authorization: Bearer <token>`.

## The bench agent

`scripts/bench-agent.mjs` runs beside the machine (a Raspberry Pi is ideal). It registers machines, heartbeats every few seconds, claims queued jobs, converts OpenSCAD → STL → G-code when OpenSCAD and a slicer are installed, and drives the machine:

| Adapter | Machines | Transport |
|---|---|---|
| `octoprint` | Anything running OctoPrint | REST + API key |
| `moonraker` | Klipper printers (Voron, Sonic Pad, …) | REST |
| `prusalink` | Prusa MINI+, MK4, XL, Core One | REST + API key |
| `grbl` | Desktop CNC routers and diode lasers | USB serial (optional `serialport` package) |
| `simulated` | None; exercises the loop end to end | — |
| `bambu` | Listed for planning; not implemented in the agent yet | MQTT + FTPS |

```
node scripts/bench-agent.mjs --discover                     # finds printers on the LAN, prints machine entries
node scripts/bench-agent.mjs --example > bench-agent.json   # or start from the example and edit
BENCH_AGENT_TOKEN=… node scripts/bench-agent.mjs bench-agent.json
```

`--discover` probes every host on the local /24 for OctoPrint, Moonraker, PrusaLink and Bambu LAN-mode signatures, so a new printer needs no manual configuration beyond its API key.

## Job lifecycle

`pending_approval → queued → claimed → preparing → running → completed`, with `paused`, `failed` (re-queueable) and `cancelled`. Operators approve and cancel; the agent moves jobs forward. Neither can skip the approval gate.

## Secrets

Set as site runtime secrets, never in source:

- `BENCH_AGENT_TOKEN` — lets the bench agent register machines and report jobs.
- `BENCH_API_TOKEN` — lets outside agents (MCP or HTTP) queue and cancel jobs.
- `OPENAI_API_KEY` — optional; the legacy recipe configurator only.

If a token is missing its endpoints are closed, not open.

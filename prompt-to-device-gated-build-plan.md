# Prompt-to-Device Platform: Gated Build Plan

## Purpose

Build a platform that lets a nontechnical person describe a device, try an interactive prototype, and assemble a working physical version. Each stage must meet its exit criteria before dependent work proceeds.

Companion document: [Platform requirements](prompt-to-device-requirements.md).

## Gate rules

- Record each gate as Not started, In progress, Passed, or Blocked.
- Support a pass decision with a demonstration, test result, or user observation.
- If a gate fails, fix the gap and repeat the affected checks before proceeding.
- Reopen an earlier gate when a later change invalidates its evidence.
- Assign a named owner and reviewer before starting each stage.
- The thresholds below are proposed initial targets and must be agreed at Gate 0.

## Stage 0 — Define the first end-to-end build

**Deliverables**

- Select one low-voltage, non-safety-critical device template for the first complete journey.
- Define its intended user, behavior, supported hardware, parts budget, and required tools.
- Specify supported requests, unsupported requests, and simulation limitations.
- Agree measurable prototype-speed, assembly-time, and completion-rate targets.

**Exit gate**

- A beginner-readable brief describes exactly what the device does.
- Components can be sourced and fit within the agreed budget.
- The first release has explicit boundaries and acceptance criteria.
- An owner and reviewer approve the scope and targets.

## Stage 1 — Prove the physical reference device

**Deliverables**

- Assemble the selected device using the proposed parts.
- Create working software, a wiring diagram, and a functional test checklist.
- Record exact component versions, required tools, observed behavior, and known limitations.

**Exit gate**

- The physical device passes every functional check in the brief.
- Another person can reproduce the build from the documented parts and instructions.
- Unverified hardware assumptions are resolved or explicitly excluded from support.

## Stage 2 — Build the idea-to-design experience

**Deliverables**

- Plain-language idea entry and a short clarification flow.
- One recommended design with behavior, appearance, estimated cost, and assumptions.
- A shared design record that drives the prototype, parts, software, and instructions.
- Clear explanations and supported alternatives for out-of-scope requests.

**Exit gate**

- Representative supported prompts produce complete, valid design records.
- Missing critical information triggers a useful question rather than an invented detail.
- Unsupported requests are identified clearly.
- Beginners can understand the recommendation without help interpreting technical terms.

## Stage 3 — Deliver the interactive prototype

**Deliverables**

- Interactive controls and simulated inputs for the supported device.
- Visible device responses and a clear explanation of what is simulated.
- Automatic saving and project reopening.

**Exit gate**

- Every behavior promised in the design brief can be demonstrated in the prototype.
- Simulation behavior agrees with the physical reference for supported scenarios.
- Users can distinguish demonstrated behavior from physical properties that remain unverified.
- Proposed target: at least four of five beginner participants reach and try a prototype within five minutes, without facilitator intervention.

## Stage 4 — Enable reliable plain-language edits

**Deliverables**

- A bounded set of supported edits, such as changing an alert or selecting a supported portable configuration.
- An explanation of changes to cost, behavior, and required parts.
- Coordinated updates to the design record and all dependent outputs.
- Undo and version restoration.

**Exit gate**

- Supported edits update all affected outputs consistently.
- Unsupported edits receive a clear explanation and a feasible alternative.
- Undo restores the prior complete design.
- An edit cannot silently leave obsolete wiring, software, or instructions attached to the new design.

## Stage 5 — Complete the physical-build handoff

**Deliverables**

- Exact parts list with quantities, sourcing links, and dated price estimates.
- Illustrated assembly instructions and incremental connection checks.
- Guided software installation for supported hardware.
- Troubleshooting steps and a final functional checklist.

**Exit gate**

- The delivered parts, software, and instructions correspond to the saved design version.
- A person outside the implementation team completes the build without writing code or selecting substitute components independently.
- The finished device passes the original functional checklist.
- Common assembly and installation failures produce actionable recovery guidance.

## Stage 6 — Validate the complete beginner journey

**Deliverables**

- Observed tests with at least five representative nontechnical users.
- Measurements for prototype time, physical-build completion, assembly time, troubleshooting, and actual parts cost.
- A prioritized list of usability failures and corrective changes.

**Exit gate**

- Proposed target: at least four of five participants complete the supported physical build using only the product’s guidance.
- Participants meet the assembly-time and cost targets agreed at Gate 0.
- No unresolved issue prevents completion of the supported journey or gives incorrect assembly guidance.
- Participants understand the distinction between simulation and physical verification.
- Small-sample results are treated as pilot evidence, not a broad reliability claim.

## Stage 7 — Launch a limited pilot

**Deliverables**

- A limited release of the validated template and supported hardware combinations.
- User-facing scope, support guidance, feedback capture, and basic funnel measurements.
- A process to disable a faulty template and restore the last validated version.
- Named ownership for investigating failed builds and maintaining parts availability.

**Exit gate**

- All earlier gates have current evidence.
- Recovery from a faulty template has been demonstrated.
- A pilot review evaluates completion, recurring failures, and support demand against Gate 0 targets.
- Additional templates enter the same physical validation and beginner testing process before release.

## Gate tracker

| Gate | Status | Owner | Reviewer | Evidence / decision |
|---|---|---|---|---|
| 0 — Scope and targets | In progress | Firoz | TBD | Proposed first template: plant waterer (soil sensor + pump + optional OLED) on a Raspberry Pi Pico 2 W, ~$105 in parts at index prices, no soldering with STEMMA QT parts. Owner and reviewer sign-off pending. |
| 1 — Physical reference | Blocked | Firoz | TBD | 2026-09-11: owner chose the Bambu Lab A1 mini ($299, US store). Bambu LAN-mode adapter implemented and verified against a fake printer; SSDP discovery ready. Waiting on the printer to arrive, then: LAN-only mode, `--discover`, first enclosure print, then assemble the plant waterer. |
| 2 — Idea to design | In progress | Firoz | TBD | 2026-09-11: planner, partner index, Designer view and MCP `design_device` implemented; supported prompts produce complete records, unsupported requests are refused, vague prompts ask a question. Beginner readability not yet tested. |
| 3 — Interactive prototype | In progress | Firoz | TBD | 2026-09-11: "Try it" simulation with sliders and trigger rule. Designs save automatically; project reopening is only wired for legacy recipes. Simulation not yet compared to a physical reference (needs Gate 1). |
| 4 — Reliable edits | Not started | TBD | TBD | Re-prompting regenerates the whole record; no bounded edit set or undo yet. |
| 5 — Physical-build handoff | In progress | Firoz | TBD | 2026-09-11: dated parts list with sourcing links, assembly steps, checklist, firmware download, enclosure to printer via bench agent with approval gate. Illustrated steps and guided install not done. |
| 6 — Beginner validation | Not started | TBD | TBD | |
| 7 — Limited pilot | Not started | TBD | TBD | |

## Immediate next decision

Order the Bambu Lab A1 mini and the plant-waterer parts (Gate 0 proposal, ~$105). Everything up to the first print is ready. The software loop from prompt to fabrication job already runs end to end against a simulated printer; the first real print and the first assembled device are the evidence the later gates are waiting on.

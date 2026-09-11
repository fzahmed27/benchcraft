# Requirements: Prompt-to-Device Platform

**Goal:** Enable a nontechnical person to quickly create an interactive device prototype and turn it into a working physical device.

## Essential requirements

| Area | Requirement |
|---|---|
| Describe an idea | Accept everyday descriptions of what the device should do. No technical vocabulary required. |
| Clarify the brief | Ask only essential questions about purpose, environment, size, portability, and budget. Offer sensible defaults. |
| Recommend a design | Present one recommended design with its purpose, appearance, behavior, and estimated cost. |
| Start from templates | Support a focused set of tested device templates with known compatible components. |
| Interactive prototype | Let users operate controls, change simulated inputs, and observe device responses before buying parts. |
| Explain simulation limits | Clearly identify simulated behavior, verified compatibility, and assumptions requiring physical testing. |
| Edit naturally | Accept changes such as “make it smaller” or “add an alert,” and explain effects on cost and functionality. |
| Keep the design consistent | Update the prototype, parts list, software, and instructions together when the design changes. |
| Preserve progress | Save projects automatically and allow users to undo changes or restore earlier versions. |
| Prepare the physical build | Provide an exact parts list, quantities, compatibility information, estimated prices, and sourcing links. Show when prices were checked. |
| Guide assembly | Provide illustrated, one-step-at-a-time instructions showing component orientation and connections. |
| Install software | Generate software for supported hardware and provide a guided installation process without requiring code edits. |
| Test and troubleshoot | Check components incrementally and guide users through plain-language diagnostics when something fails. |
| Confirm completion | Provide a final functional checklist tied to the user’s original goal. |

## Experience requirements

- Use plain language throughout; explain unavoidable technical terms where they appear.
- Show the next useful action clearly at every stage.
- Allow users to explore the prototype before purchasing hardware.
- Show estimated parts cost, assembly time, and required tools before the user chooses to build.
- Clearly explain unsupported requests and offer a supported alternative.
- Provide accessible controls, readable diagrams, and instructions that do not rely on color alone.
- Require explicit confirmation before purchases or sharing project data externally.

## First-release scope

- Support both an interactive prototype and a physical build for every advertised template.
- Begin with a small catalog of low-voltage devices built from tested, readily available modules.
- Prefer assembly without soldering where practical.
- Include at least one complete reference build for each supported template.
- Exclude mains-powered, safety-critical, and medical devices from the first release.

## Acceptance criteria

- A beginner can complete a supported project without writing code or choosing electronic components independently.
- Prototype controls and simulated inputs produce the behavior described in the brief.
- Every supported design includes a complete, mutually compatible parts list, software, and assembly guide.
- A design change updates all affected outputs or clearly explains why it cannot be supported.
- Each template has been physically assembled and tested against its stated behavior.
- The experience clearly distinguishes “prototype works” from “physical device verified.”

## Success measures

- Time from initial prompt to first interactive prototype.
- Percentage of users who successfully try their prototype.
- Percentage of physical builds completed successfully.
- Assembly time and number of troubleshooting interventions.
- Difference between estimated and actual parts cost.
- Beginner satisfaction and requests for human help.

## Decisions still needed

- Initial device categories.
- Supported hardware.
- Target parts budget.
- Numerical targets for prototype speed and build success.

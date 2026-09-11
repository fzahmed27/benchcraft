# Instrument Studio design QA — 2026-09-11

Reference: `/workspace/scratch/32c7f883e722/upload/01-generated-image.png`.
Implementation: `/workspace/scratch/benchcraft-studio-final.jpg`.
Combined review: `/workspace/scratch/benchcraft-final-comparison.jpg`.
Browser viewport: 1363 × 936. Full-page implementation compared beside the reference normalized to the implementation width; viewport heights differ.

Desktop result: passed with intentional functional differences. No unresolved P0–P2 visual findings. Mobile CSS is responsive but a separate mobile browser viewport was not exercised.

The dark shell, mint accent, light work area, architecture canvas, right inspector, type hierarchy, rounded borders, and simulation placement follow the reference. Initial inspector density and simulation placement were refined after side-by-side comparison. The final full-page comparison shows intact labels, controls, status cards, and diagram connectors. The actual project prompt replaces the mock subtitle. New-project and saved-project access remain available. The recipe is a truthful fixed label; recipe selection remains in project creation. The architecture is an accessible SVG engineering diagram, with GPIO on/off matching generated firmware and separate board/load supplies. It is not a decorative image or a fabricated machine connection.

Interaction checks: dose 150 mL computes 75.0 s; simulation starts and stops; resetting dose restores 50.0 s; Parts opens the bill of materials; saving shows Saved draft and the project in the sidebar. A runtime progress warning when shortening the duration was corrected by clamping progress to 0–100. Earlier HTTP-preview UUID errors were fixed using getRandomValues. Browser extension metadata errors are unrelated to the app.

No backend schema or persistence changes. AI and physical machine connections remain unconfigured.

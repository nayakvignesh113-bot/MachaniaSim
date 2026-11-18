# MachinaSim

**Universal conventional machining simulation & research platform — runs entirely in the browser.**

Live app (after GitHub Pages is enabled): https://nayakvignesh113-bot.github.io/MachaniaSim/

MachinaSim simulates conventional machining with actual geometric material removal and process-specific
mechanics, and couples forces, temperature, tool wear and workpiece quality. Every number it shows names
its model, its inputs' data status (published / analogous / typical / estimated / calibrated) and its
limitations. Nothing is presented as validated without evidence.

## What is in v1.0

| Workspace | Geometry & kinematics | Physics |
|---|---|---|
| **Centre lathe** (3-D) | Exact axisymmetric material removal, revolution by revolution; straight, facing, step, taper, grooving, parting-off, threading (helical rendering), tailstock drilling, boring, chamfering; carriage/cross-slide/tailstock kinematics; undo | Kienzle forces from the *actual engaged chip section* (equivalent chip thickness), Fc/Ff/Fp, torque, power, MRR; Boothroyd temperatures + 2-D FD tool field with coolant convection; Taylor–Miner flank wear coupled back to forces and tool-nose position; kinematic & geometric Ra; workpiece deflection; Tlusty stability lobes |
| **Radial drilling machine** (3-D) | Arm-angle / head-radius inverse kinematics; Z-map hole formation; centre, twist, step drilling, reaming, counterboring, countersinking, tapping; peck cycles | Mechanistic lip-by-lip thrust & torque with geometry-coupled engagement, chisel edge, independent lip wear, radial imbalance → hole-oversize trend |
| **Milling** (3-D, vertical & horizontal knee mills) | Z-map removal; face, end/shoulder, slot, side, slab, angular, profile, contour, ball-nose, pocket | Altintas mechanistic model, tooth-by-tooth with helix & runout, engagement from the actual stock, per-tooth wear, thermal cycling, 2-DOF zero-order stability lobes, forced vibration & spectrum |
| **Grinding** | Surface / cylindrical / internal, pass-by-pass removal, dressing | Specific-energy forces & power, Jaeger temperature with burn check, G-ratio wheel wear and size error |
| **Shaping & slotting** | Slotted-lever quick-return kinematics, stroke-by-stroke removal | Cutting-stroke Kienzle forces, power over the crank cycle, HSS wear |
| **Sawing** | Band saws and power hacksaw, kerf progression | Teeth engaged vs contact length, feed per tooth, forces, cutting time |
| **Broaching** | Keyway / round / surface broaches | Force vs stroke from engaged teeth, final size, chip-space check, capacity check |
| **Research** | — | CSV/TXT/XLSX import; predicted-vs-measured (MAE, RMSE, MAPE, R²); Kienzle, friction and Taylor/extended-Taylor calibration with separate validation subset; saving calibrated materials; time-series comparison with simulations; full-factorial & Taguchi L9 DOE, ANOVA, RSM; GA optimisation with constraints and Pareto front; Monte-Carlo uncertainty |
| **ToolVision** | — | Calibrated flank-wear measurement (VB, VBmax, land area) from microscope images or a USB camera, with confidence, uncertainty and wear-progression tracking (classical image processing — no trained AI model is shipped) |
| **Libraries, Models & V&V, Reports** | — | Editable material/tool databases with provenance; model registry with status; engineering reports to PDF (print), DOCX, XLSX, CSV, JSON; project save/load/export |

See [DEVELOPMENT_STATUS.md](DEVELOPMENT_STATUS.md) for the honest feature-by-feature status against the
[master specification](MASTER_SPECIFICATION.md), and [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

## Run locally

No build step and no server-side code. ES modules need to be served over HTTP:

```bash
python3 -m http.server 8080      # or: npx serve .
# open http://localhost:8080
```

Run the automated verification suite (Node ≥ 20):

```bash
npm test          # 44 tests: physics, geometry, simulators, research tools
npm run docs      # regenerate MATHEMATICAL_MODELS.md and VALIDATION_REGISTER.md from the model registry
```

## Architecture

```
index.html, css/app.css
src/core/       units, materials (with provenance), tools, model registry, version
src/physics/    cutting (Kienzle, rake, friction, oblique, Merchant), turning, drilling, milling, thermal,
                wear, dynamics, abrasive (grinding, quick-return, sawing, broaching)  — pure functions
src/geometry/   tool outlines, axisymmetric lathe workpiece, Z-map height field      — pure functions
src/sim/        lathe / drill / mill planners and revolution-by-revolution simulators  — no DOM
src/research/   statistics, calibration, DOE, optimisation, ToolVision, DOCX writer   — no DOM
src/render/     Three.js scenes (machines, workpiece meshes, force vectors)
src/ui/         app shell, pages, charts, forms
vendor/         three.js r170 (MIT), SheetJS mini 0.18.5 (Apache-2.0)
tests/          node:test verification suite
```

The numerical engines are independent of rendering (they run headless in the tests). The recommended
stack in the specification (FastAPI, PyTorch, SQLite, Tauri) was replaced by a local-first browser
architecture so the app runs from GitHub Pages with no server; see DEVELOPMENT_STATUS.md.

## Data policy

- Kienzle kc1.1/mc: tool-maker VDI 3323 group values (ISCAR table) — *published group values, not lab-calibrated*.
- Physical properties: handbook typical values (ASM/MatWeb) — verify for your stock.
- Taylor constants: textbook representative values (Groover) only where they exist; none for titanium,
  coated carbide, CBN, PCD — the user must calibrate.
- Friction coefficient, wear-land stress, coolant coefficients, chisel-edge and grinding coefficients: estimates, flagged in the UI.
- No experimental or benchmark data are fabricated. Calibrations performed by users are tagged `calibrated` with their source file.

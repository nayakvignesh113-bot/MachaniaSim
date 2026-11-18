# Development status — v1.0.0 (2026-11-18)

Status vocabulary (spec §26): Not started · Architecture completed · Implementation in progress · Implemented ·
Unit tested · Integrated · Validated · Released. **No module is “Validated”**: that requires experimental data,
which only the user can supply (Research → Experiments).

## Modules

| # | Module | Status | Notes |
|---|---|---|---|
| 1 | Machine library (lathe, radial drill, vertical & horizontal mill; 2-D: grinder, shaper/slotter, saws, broach) | Integrated | 3-D machines are schematic but kinematically correct |
| 2 | Machine kinematics | Integrated | Lathe carriage/cross-slide/tailstock; radial-arm IK; knee/saddle/table |
| 3 | CAD geometry (tool outlines) | Unit tested · Integrated | Nose radius, κr, κr′, grooving, threading, boring outlines |
| 4 | Material removal | Unit tested · Integrated | Exact axisymmetric profile (lathe); Z-map (drill, mill). OpenCascade not used |
| 5 | Turning mechanics | Unit tested · Integrated | Geometry-coupled equivalent chip thickness |
| 6 | Milling mechanics | Unit tested · Integrated | Verified vs Altintas closed form |
| 7 | Drilling mechanics | Unit tested · Integrated | Chisel model estimated |
| 8 | Grinding mechanics | Unit tested · Integrated (2-D) | Constant specific energy |
| 9 | Shaping / slotting mechanics | Unit tested · Integrated (2-D) | |
| 10 | Sawing mechanics | Implemented · Integrated (2-D) | |
| 11 | Broaching mechanics | Unit tested · Integrated (2-D) | |
| 12 | Thermal analysis | Unit tested · Integrated | Analytical + 2-D FD tool field; no workpiece/chip FD |
| 13 | Tool wear | Unit tested · Integrated | Flank wear (Taylor–Miner, Usui interface); crater/notch/chipping — see below |
| 14 | Tool life | Unit tested · Integrated | Extended Taylor, Weibull function |
| 15 | Tool dynamics | Unit tested · Integrated | Lobes (turning, milling), forced response, deflection |
| 16 | Surface integrity | Implemented · Integrated | Kinematic + geometric Ra; residual stress not implemented |
| 17 | Experimental validation | Unit tested · Integrated | |
| 18 | ToolVision | Unit tested · Integrated | Classical CV, no neural network |
| 19 | Optimisation | Unit tested · Integrated | GA, Pareto, DOE, ANOVA, RSM, Monte Carlo |
| 20 | Report generation | Integrated | PDF (print), DOCX, XLSX, CSV, JSON |
| 21 | Database management | Integrated | Browser localStorage + JSON export (not SQLite/PostgreSQL) |

## Acceptance tests (spec §29) — demonstrated in a headless browser and/or the automated suite

| Test | Result | Evidence / gaps |
|---|---|---|
| A Lathe turning | **Pass** | EN8 + carbide CNMG: material removal, Fc/Ff/Fp, torque, power, MRR, force–time graph |
| B Lathe tool wear | **Partial** | VB progression, tool temperature, force increase, nose-recession size change, tool life: yes. Crater wear: Usui interface in code, not exposed in UI (no defensible coefficients). Wear effect on Ra: not modelled |
| C Radial drilling | **Pass** | Arm/head positioning, drill rotation, progressive hole, thrust, torque, power, MRR |
| D Drill wear | **Partial** | Independent lip wear, thrust/torque variation, radial imbalance, hole-oversize trend: yes. Chisel-edge wear is a user-set condition (no predictive model) |
| E Milling | **Pass** | Face & slot: rotation, tooth engagement, removal, instantaneous chip thickness, tooth forces, resultant, torque, power, force vs rotation |
| F Milling tool wear | **Partial** | Per-tooth VB, tool life, temperature cycling, effect on forces: yes. Edge chipping/fracture prediction: not implemented (Weibull reliability function only) |
| G Grinding | **Pass (2-D)** | Wheel rotation, table motion, removal, Fn, Ft, power, specific energy, wheel wear; schematic 2-D view |
| H Experimental validation | **Pass (synthetic data)** | Import, comparison metrics, calibration/validation split; verified with generated data — awaiting real measurements |
| I ToolVision | **Pass (synthetic image)** | Calibrated VB/VBmax/area with uncertainty; awaiting real microscope images |
| J Research optimisation | **Pass** | DOE, ANOVA, RSM, GA, Pareto, report export |

## Deviations from the recommended stack (spec §18)

The user asked for browser-based software hosted on GitHub. MachinaSim therefore runs entirely client-side:
JavaScript ES modules + Three.js; NumPy/SciPy-equivalent numerics are implemented and tested in JS; storage is
localStorage + JSON files; no FastAPI, PyTorch, SQLite/PostgreSQL or Tauri. OpenCascade.js is not used — the
axisymmetric and Z-map representations are exact for the supported operations.

## Next development stage

See DEVELOPMENT_ROADMAP.md, Stage 9 onwards.

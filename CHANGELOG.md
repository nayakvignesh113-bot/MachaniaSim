# Changelog

## 1.1.0 — 2026-11-21 (Lathe V2)
- Mechanics: Johnson–Cook rate/thermal softening of kc (M-CUT-05), Lee–Shaffer option, edge-force coefficients (M-CUT-06).
- Thermal: conjugate transient tool model with interface heat partition (M-THERM-04); persistent across operations.
- Wear: calibrated progression, nose/notch/crater/chipping modes, ISO 3685 criteria (M-WEAR-07..11).
- Dynamics: deflection fed back into geometry (M-TURN-05); time-domain chatter (M-DYN-06); oriented lobes.
- Surface: vibration-imprinted profile, Ra/Rq/Rz/Rt, dimensional deviation (M-SURF-01/02).
- 3-D: chip ribbon, tool temperature colouring, cutting-zone inset.
- UX/research: workflow stepper, beginner/advanced, run comparison, measured-data comparison (dynamometer, thermocouple, microscope), wear calibration.
- 19 new automated tests (63 total). Details: LATHE_V2.md.

## 1.0.0 — 2026-11-18
- First release of the browser application (see README for the full feature list).
- Physics engines: Kienzle/rake/friction/oblique cutting, geometry-coupled turning, mechanistic drilling and milling, Boothroyd + FD thermal, Taylor–Miner/Usui wear, Tlusty and Altintas–Budak stability, grinding, quick-return, sawing, broaching.
- Geometry engines: exact axisymmetric lathe profile with helical threads; Z-map for prismatic parts.
- Research: experiment import, calibration with independent validation, DOE/ANOVA/RSM, GA/Pareto, Monte Carlo, ToolVision.
- Reports: PDF (print), DOCX, XLSX, CSV, JSON; projects: save/load/duplicate/export/import.
- 44 automated verification tests; generated model and validation documentation.

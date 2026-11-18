# Testing guide

## Automated (verification)
```bash
npm test
```
Runs `node --test` on `tests/*.test.js` (Node ≥ 20, no dependencies). Suites:
- `physics.test.js` — units, database integrity, Kienzle, rake, oblique ratios, Merchant energy balance, roughness, drilling vs Sandvik, milling vs Altintas closed form, FD vs erfc, Taylor–Miner, stability limits, grinding, quick return, broaching.
- `lathe.test.js` — tool outlines, geometry-coupled forces vs closed form, geometric vs kinematic roughness, volume conservation, facing/parting/drilling, threading depth & force symmetry, wear coupling.
- `prismatic.test.js` — Z-map slot/shoulder/face/slab milling forces & geometry, radial drilling, step drilling, tool envelopes.
- `research.test.js` — metrics, Kienzle/Taylor/extended-Taylor calibration, DOE/ANOVA/RSM, Pareto/GA, CSV parsing, ToolVision.

CI: `.github/workflows/tests.yml` runs the suite on every push.

## Manual acceptance checks (spec §29)
1. **Lathe (A, B):** Lathe → EN8, CNMG carbide, Straight turning → Run. Check removal in 3-D, Live forces, Graphs. Set Process → Initial VB 0.3 and run again: forces rise, Quality shows the diameter shift.
2. **Drill (C, D):** Radial drill → Run; set Lip 1 VB₀ 0.3, Lip 2 0.05 → “Fit fresh tool” → Run: radial imbalance and oversize appear.
3. **Milling (E, F):** Slot milling → Run → Per revolution tab (tooth forces, chip thickness). Thermal tab: cycling. Dynamics: lobes.
4. **Grinding (G):** Run → Results/Graphs.
5. **Experimental validation (H):** Research → Download template, fill with your measurements, import, check metrics, calibrate.
6. **ToolVision (I):** open a microscope image, draw the scale line, draw the cutting edge, Measure.
7. **Optimisation (J):** Research → DOE / Optimisation; Reports → DOCX/XLSX.

Regression after every significant change: `npm test` plus a quick pass through the manual list.

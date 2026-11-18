# MachinaSim — Verification & validation register

_Generated from `src/core/models.js` (v1.0.0)._

Status vocabulary (specification §23): **Implemented, unvalidated** · **Verified against analytical benchmarks** (the code reproduces an equation or an independent analytical/numerical solution in the automated tests) · **Calibrated against experimental data** · **Independently validated** · **Limited / experimental**.

> No model in this release is marked _calibrated_ or _independently validated_: no experimental data set has been used by the developers. Calibration is performed by the user in Research → Experiments, and calibrated coefficients are tagged `calibrated` with their data source.

| ID | Model | Status | Automated test | Validity |
|---|---|---|---|---|
| M-CUT-01 | Kienzle specific cutting force | Verified against analytical benchmarks | physics.test.js › Kienzle | h ≈ 0.05–1.6 mm (warning raised outside) |
| M-CUT-02 | Rake-angle correction of kc | Implemented, unvalidated | physics.test.js › Rake correction | |γ − γ0| ≲ 20° |
| M-CUT-03 | Thrust force from friction angle | Limited / experimental | physics.test.js › Oblique ratios | Continuous chip; calibrate μ from measured Ff/Fc |
| M-CUT-04 | Merchant orthogonal cutting analysis | Verified against analytical benchmarks | physics.test.js › Merchant energy balance | Qualitative; Merchant often under-predicts φ |
| M-TURN-01 | Nominal turning forces, torque, power, MRR | Verified against analytical benchmarks | physics.test.js › Turning nominal | ap ≫ rε |
| M-TURN-02 | Geometry-coupled turning forces (equivalent chip thickness) | Verified against analytical benchmarks | lathe.test.js › Straight turning sharp 90° tool | Any outline / path (turning, facing, grooving, threading, taper, chamfer) |
| M-TURN-03 | Kinematic surface roughness | Verified against analytical benchmarks | lathe.test.js › Turned profile roughness | Theoretical lower bound |
| M-TURN-04 | Workpiece deflection | Verified against analytical benchmarks | physics.test.js › deflection formulas | Slender parts |
| M-DRILL-01 | Mechanistic lip model | Limited / experimental | physics.test.js › Drilling vs Sandvik (±30 %) | Twist drills, reamers, countersinks, counterbores |
| M-DRILL-02 | Chisel-edge thrust | Limited / experimental | prismatic.test.js › Step drilling | Must be calibrated with a dynamometer |
| M-DRILL-03 | Drill deflection & hole oversize | Limited / experimental | — | Trend only |
| M-DRILL-04 | Tapping torque (energy estimate) | Limited / experimental | — | Order of magnitude |
| M-MILL-01 | Mechanistic milling forces | Verified against analytical benchmarks | physics.test.js › Milling closed form; prismatic.test.js › Slot milling | End, slot, face, ball-nose, slab cutters |
| M-MILL-02 | Geometry-coupled tooth engagement | Verified against analytical benchmarks | prismatic.test.js › Slot / shoulder milling | Arbitrary 2.5-D geometry |
| M-MILL-03 | Milled surface roughness | Implemented, unvalidated | — | Theoretical |
| M-THERM-01 | Analytical cutting temperatures | Limited / experimental | physics.test.js › Boothroyd | Continuous chips, moderate speeds |
| M-THERM-02 | 2-D FD tool temperature field | Verified against analytical benchmarks | physics.test.js › FD vs erfc | Qualitative transient heating / cycling |
| M-THERM-03 | Grinding temperature (Jaeger) | Implemented, unvalidated | physics.test.js › Grinding | Pe > 10 |
| M-WEAR-01 | Taylor / extended Taylor tool life | Implemented, unvalidated | physics.test.js › Taylor | Within calibration range only |
| M-WEAR-02 | Taylor–Miner flank-wear progression | Verified against analytical benchmarks | physics.test.js › Taylor–Miner | Reproduces Taylor life; shape of VB(t) is NOT predicted |
| M-WEAR-03 | Wear-land force increase | Limited / experimental | lathe.test.js › Wear coupling | Calibrate from force vs VB data |
| M-WEAR-04 | Usui wear rate | Implemented, unvalidated | — | Calibrated pairs only |
| M-WEAR-05 | Nose recession from flank wear | Verified against analytical benchmarks | lathe.test.js › Wear coupling | Geometric |
| M-WEAR-06 | Random fracture reliability | Implemented, unvalidated | — | User data |
| M-DYN-01 | Tlusty stability lobes | Verified against analytical benchmarks | physics.test.js › Tlusty asymptote | Linear regenerative chatter |
| M-DYN-02 | Zero-order milling stability (2-DOF) | Verified against analytical benchmarks | physics.test.js › directional factors | Moderate/high radial immersion |
| M-DYN-03 | Forced vibration (periodic) | Verified against analytical benchmarks | physics.test.js › periodic response static | — |
| M-GRIND-01 | Grinding power and forces | Implemented, unvalidated | physics.test.js › Grinding | Calibrate u |
| M-GRIND-02 | Wheel wear by grinding ratio | Implemented, unvalidated | — | — |
| M-RECIP-01 | Quick-return kinematics & stroke forces | Verified against analytical benchmarks | physics.test.js › quick return | — |
| M-SAW-01 | Tooth-engagement sawing force | Implemented, unvalidated | — | — |
| M-BROACH-01 | Broaching force profile | Verified against analytical benchmarks | physics.test.js › Broaching | — |
| M-RES-01 | Kienzle / Taylor calibration | Verified against analytical benchmarks | research.test.js | Data range |
| M-VIS-01 | Image-based flank wear measurement | Implemented, unvalidated | research.test.js › synthetic wear land | Calibrated, well-lit microscope images |

## Verification benchmarks in the test suite

- Kienzle force law reproduced exactly (physics.test.js).
- Geometry-coupled turning: chip area from the stamped profile equals f·ap − f·Rt/2 within 0.5 %; engaged edge = ap within 1 %; Fc within 1 % of the closed form (lathe.test.js).
- Machined-profile roughness from the geometry engine equals the exact kinematic Ra/Rt within 8 % (lathe.test.js).
- Volume conservation: removed volume by Pappus = workpiece volume loss within 0.5 % (lathe.test.js).
- Threading reaches ISO 68-1 depth H1 = 0.61343P within 2 %; symmetric flank forces cancel axially (lathe.test.js).
- Flank wear: ΔD = 2·VB·tanα nose recession reproduced within 5 %; forces increase (lathe.test.js).
- Milling: numerical mean forces equal Altintas closed-form averages (slot, up, down) within 0.2 % (physics.test.js).
- Milling with Z-map engagement: slot and shoulder forces equal analytical cycles within 2–6 % (prismatic.test.js).
- Drilling lip model torque within ±30 % of the Sandvik reference formula (physics.test.js) — a loose cross-check, not validation.
- FD tool conduction equals the semi-infinite erfc solution within 3 % (physics.test.js).
- Taylor–Miner wear integrator reaches VBc exactly at the Taylor life (physics.test.js).
- Tlusty minimum stability limit equals 2kζ(1+ζ)/Ks within 0.2 %; Altintas–Budak directional factors equal numerical integrals (physics.test.js).
- Kienzle, Taylor and extended-Taylor calibration recover known constants from synthetic data exactly (research.test.js).
- ToolVision measures a synthetic wear land within 3 % (mean) and ±2 px (max) (research.test.js).

## Data provenance summary

| Material | kc1.1 / mc status | Physical properties | Johnson–Cook |
|---|---|---|---|
| Mild steel | published / published | typical, published | analogous |
| EN8 steel | published / published | typical, published | analogous |
| EN24 steel | published / published | typical, published | analogous |
| Stainless steel 304 | published / published | typical, published | — |
| Stainless steel 316 | published / published | typical, published | — |
| Grey cast iron | published / published | typical, published | — |
| Aluminium 6061-T6 | published / published | typical | — |
| Aluminium 7075-T6 | published / published | typical | — |
| Copper (electrolytic) | published / published | typical, published | published |
| Brass | published / published | typical, published | analogous |
| Titanium Ti-6Al-4V | published / published | typical, published | published |

| Tool material | Property status | Taylor defaults |
|---|---|---|
| HSS (M2) | typical, estimated | steel n=0.125, C=70; non-steel n=0.125, C=120 |
| Cobalt HSS (M42) | typical, estimated | steel: none; non-steel: none |
| Cemented carbide (uncoated WC-Co) | typical, estimated | steel n=0.25, C=500; non-steel n=0.25, C=900 |
| Coated carbide (TiAlN / TiCN–Al₂O₃) | typical, estimated | steel: none; non-steel: none |
| Ceramic (Al₂O₃-based) | typical | steel n=0.6, C=3000; non-steel: none |
| PCBN | typical, estimated | steel: none; non-steel: none |
| PCD | estimated, typical | steel: none; non-steel: none |

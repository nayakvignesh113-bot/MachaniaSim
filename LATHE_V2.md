# Lathe V2 — development record (v1.1.0, 2026-11-21)

Procedure per subsystem: existing implementation → limitations → model → implementation → tests → integration → what remains.
Checkpoint: git tag `checkpoint-before-lathe-v2`. All v1 operations, panels and modules are preserved; the Lathe tab now loads
`src/ui/pages/lathe-v2.js`, which extends (does not replace) `lathe.js`.

## 1. Cutting mechanics
- **v1:** Kienzle kc with rake correction, constant μ thrust ratio, Merchant shear angle; no speed/temperature dependence.
- **Limitation:** kc independent of cutting speed and temperature; no edge (ploughing) term; single shear-angle relation.
- **Model:** M-CUT-05 Johnson–Cook rate·thermal correction of kc at the Boothroyd shear-plane temperature, relative to an *assumed* reference (100 m/min, h 0.25 mm); M-CUT-06 Merchant / Lee–Shaffer choice; linear edge forces Kte·l, Kre·l (default 0, calibratable from the F/b-vs-h intercept).
- **Tests:** `tests/lathe-v2-mech.test.js` (6).
- **Finding:** for EN8 the JC correction lowers Fc only ≈1–2 % between 100 and 250 m/min, because the predicted shear-plane temperature changes little and the rate term partly cancels. Measured speed effects are larger; they come mostly from secondary-zone softening and contact changes, which are not modelled. Calibrating kc1.1 at your speed is still the reliable route.
- **Remains:** secondary-zone (rake) softening; Oxley predictive machining theory.

## 2. Thermal
- **v1:** 4 × 4 mm explicit FD tool section with a *prescribed* interface temperature (Boothroyd estimate) — no energy balance at the contact.
- **Limitation:** tool temperature was imposed, not computed; coarse grid; reset between operations.
- **Model:** M-THERM-04 graded-mesh 12 × 12 mm finite-volume ADI solver with *heat-flux* boundaries on the rake contact and flank land. The heat partition R (and Rw) comes from equal mean interface temperatures: tool side numerical, chip/workpiece side analytical moving band source. State persists across operations; coolant enters as convection.
- **Tests:** `tests/lathe-v2-thermal.test.js` (4): energy conservation to round-off, analytic flux solution within 2 %, interface matching < 0.5 K.
- **Remains:** 3-D spreading across the edge width (the 2-D section gives upper-bound tool temperatures); temperature-dependent properties; resolved chip/workpiece fields.

## 3. Tool wear
- **v1:** linear Taylor–Miner flank wear; nose recession = VB·tanα; wear-land forces.
- **Model:** M-WEAR-07 calibrated power-law progression (fit from microscope/ToolVision series, Measured tab); M-WEAR-08 nose & notch (user ratios); M-WEAR-09 crater (Usui or crater-Taylor) with effective-rake reduction of forces; M-WEAR-10 Weibull chipping; M-WEAR-11 ISO 3685 criteria and hot-hardness deformation flag. Couplings: VB → forces & flank heat; VC → diameter; KT → rake/forces; T → Usui modes.
- **Tests:** `tests/lathe-v2-wear.test.js`.
- **Remains:** no shipped coefficients for nose/notch/crater/chipping (user calibration required); wear → Ra acts only through recession, forces and vibration (edge-profile change not modelled).

## 4. Deflection & dynamics
- **v1:** deflection reported, not fed back; Tlusty lobes with unoriented Ks = kc.
- **Model:** M-TURN-05 stepped-beam (unit-load) workpiece compliance + tool-side stiffness, fed back into the stamped geometry (taper/barrel errors); M-DYN-06 time-domain regenerative model with the cut-loss nonlinearity; lobes now use the orientation from the geometric engagement, Ks = K_th·n_r².
- **Tests:** `tests/lathe-v2-dyn.test.js`, deflection test in `lathe-v2-wear.test.js`.
- **Remains:** modal data are estimates (tap test needed); dynamics are evaluated at an operating point, not continuously along the toolpath; no process damping.

## 5. Surface quality
- **Model:** M-SURF-01 profile from tool stamps offset by the per-revolution vibration → Ra, Rq, Rz, Rt; roundness from the radial peak-to-peak; M-SURF-02 dimensional deviation chart along z (wear recession + deflection).
- **Remains:** side flow, BUE, edge micro-geometry and measured-roughness calibration.

## 6. 3-D environment
- Chip ribbon (width = engaged edge, flow direction = thrust direction, coloured by computed chip/interface temperature; curl radius illustrative). Insert coloured by the tool temperature field. Magnified cutting-zone inset (`setZoom`). Corrected tool view preset.
- **Remains:** detailed CAD-level machine model; chip curl/breakage prediction.

## 7. Research features (lathe)
- Measured tab: dynamometer (Fc, Ff, Fp), tool thermocouple (compared at the user-defined probe point recorded in the history), microscope VB series (VB vs cutting time) with MAE/RMSE/MAPE/R²/bias, and one-click wear-progression calibration. Compare tab: saved runs, metrics, chart, CSV. Reports include the V2 models and results.
- **Remains:** dynamometer sample-rate handling for kHz data (the comparison uses the simulation time base); automated calibration of thermal coefficients.

## 8. User experience
- Workflow stepper (Machine setup → Operation → Simulation & models → Research & report), Beginner/Advanced modes, parameter help texts with model IDs linking to the Models page.

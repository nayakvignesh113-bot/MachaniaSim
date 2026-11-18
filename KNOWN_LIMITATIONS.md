# Known limitations (v1.0.0)

## Data
- Kienzle kc1.1/mc are VDI 3323 *group* values from a tool maker; real grades and heat-treatment states differ. Calibrate (Research → Experiments).
- Tool–chip friction μ (0.5), wear-land stress σw (Rm/√3) and μw (0.5), coolant heat-transfer coefficients, chisel-edge parameters, grinding specific energy / force ratio / partition / G-ratio are **estimates**.
- Taylor defaults are textbook representative values (criterion and conditions unspecified). None exist for Ti-6Al-4V, coated carbide, CBN or PCD — wear is not predicted until the user enters calibrated constants.
- The Merchant-type thrust ratio tan(β − γ) becomes zero for high positive rake (e.g. drill lip periphery), which under-predicts lip thrust; calibrate μ.

## Physics not (yet) modelled
- Crater (Usui interface only, not in UI), notch, nose wear, BUE, plastic deformation, thermal cracking and fracture prediction. Flank-wear progression is linear (Taylor–Miner); break-in/accelerated stages are not predicted.
- Wear effect on surface roughness; side flow; ploughing at very small chip thickness (Kienzle is extrapolated below 0.05 mm with a warning).
- Thermal softening: forces are temperature-independent; analytical temperatures can exceed physical limits at high speed (a warning is shown above 80 % of the melting point).
- No FD/FE solution of the workpiece or chip temperature field; no FEM chip formation; no geometric 3-D chip visualisation (chip mechanics are analytical: shear angle, chip ratio, contact length).
- Structural deflection and vibration are reported but not fed back into the machined geometry; no time-domain chatter simulation.
- Residual stress is not predicted (no suitable validated model implemented).
- Milling plunge (end-cutting-edge) forces; tapping thread geometry in the Z-map; drill web-thinning rake.
- Grinding: no size effect on u, wheel loading or glazing; grinding/shaping/sawing/broaching views are 2-D schematics.

## Numerical
- Lathe profile resolution 0.01 mm (0.02 mm for stick-out > 300 mm); Z-map grid 0.15–0.5 mm (engagement boundary error ≈ 1.5 cells; volume error ≈ 2 % for small cutters).
- The 3-D spindle rotation is displayed slowed (≤ 1 rev/s) to avoid aliasing; physics always uses the true speed.
- Threads are single-start, constant pitch; the helical rendering maps the θ = 0 section.

## Software
- Storage is per browser (localStorage, ~5 MB); use Export for large projects. Unit-system switching converts the lathe inputs and the live readouts; charts, exports and most inputs on other pages stay in SI/metric units.
- WebGL is required for 3-D views (simulations and results still run without it).

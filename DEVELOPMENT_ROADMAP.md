# Development roadmap

| Stage | Content | Status |
|---|---|---|
| 1 Foundation | Units, material & tool databases with provenance, model registry, simulation state, test framework | Done |
| 2 Lathe | 3-D lathe, kinematics, exact material removal, 10 operations, forces/torque/power/MRR, force vectors | Done |
| 3 Drilling | Radial drill, IK, hole formation, thrust/torque/power/MRR, reaming/counterbore/countersink/tapping | Done |
| 4 Wear & thermal | Flank wear (Taylor–Miner), drill lip wear, tool life, analytical + FD thermal, wear–mechanics coupling | Done (crater/notch/chipping: next) |
| 5 Milling | Vertical & horizontal mills, cutter geometry, multi-tooth engagement, forces, removal, per-tooth wear, thermal cycling, dynamics | Done |
| 6 Grinding | Surface/cylindrical/internal, forces, wheel wear, dressing, thermal damage check | Done (2-D) |
| 7 Shaping, slotting, sawing | Mechanics + 2-D simulations | Done (2-D) |
| 8 Broaching | Multi-tooth engagement & force profile | Done (2-D) |
| 9 Advanced engineering | Time-domain chatter with geometry feedback; deflection feedback; workpiece/chip FD thermal; crater/notch wear UI with calibration; temperature-dependent flow stress (JC) in forces; 3-D chip visualisation | **Next** |
| 10 Research | ToolVision, experiment import, calibration, DOE/RSM/ANOVA, optimisation, reporting | Done (ML segmentation for ToolVision: future) |
| 11 Integration & release | Regression tests, docs, deployment (GitHub Pages), validation report | v1.0 released; validation requires user data |
| Future | CNC turning/milling, G-code import, toolpath simulation, collision detection, additional processes | Architecture ready (planners emit toolpaths) |

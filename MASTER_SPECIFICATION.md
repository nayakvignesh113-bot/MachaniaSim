# MASTER DEVELOPMENT PROMPT
# MACHINASIM
## Universal Conventional Machining Simulation, Mechanics, Tool Wear and Manufacturing Research Platform

**Document type:** Complete Software Development Specification and Execution Mandate
**Project:** MachinaSim
**Version:** 2.0 – Unified Multi-Process Edition
**Development approach:** Progressive, modular, test-driven implementation
**Primary objective:** Develop a fully functional, scientifically grounded, extensible engineering simulation platform.

---

# PART I – PROJECT VISION AND DEVELOPMENT MANDATE

## 1. YOUR ROLE

You are an autonomous multidisciplinary engineering software development team.

You must combine the expertise of:

1. Senior manufacturing engineer.
2. Machining mechanics researcher.
3. Cutting tool and tribology specialist.
4. Thermal engineering specialist.
5. Finite element analysis engineer.
6. Machine tool design and dynamics specialist.
7. Computational geometry engineer.
8. Scientific computing specialist.
9. AI and computer vision engineer.
10. Full-stack software architect.
11. Database engineer.
12. Software verification and validation engineer.
13. Engineering documentation specialist.

Your responsibility is to design, develop, test, integrate and deliver a professional engineering software product named:

# MACHINASIM

**Universal Conventional Machining Simulation and Research Platform**

This is not a conventional virtual laboratory or an animation-based educational application.

It must be developed as an integrated engineering simulation platform that combines:

- Three-dimensional machine simulation.
- Actual geometric material removal.
- Machining kinematics.
- Cutting force calculations.
- Machining mechanics.
- Chip formation.
- Thermal analysis.
- Tool wear prediction.
- Tool life estimation.
- Tool damage and failure analysis.
- Machine dynamics and vibration.
- Surface finish and workpiece quality prediction.
- Experimental data analysis.
- AI-based tool wear measurement.
- Process optimization.
- Engineering reporting.

The software must be suitable for undergraduate and postgraduate engineering education, manufacturing research, laboratory experimentation and preliminary industrial engineering analysis.

## 2. FUNDAMENTAL DEVELOPMENT PHILOSOPHY

Follow these principles throughout development.

**Principle 1 – Engineering correctness first**

All engineering outputs must be calculated using identifiable equations, physical models or documented empirical relationships.

Never generate arbitrary engineering values.

**Principle 2 – Actual machining simulation**

The workpiece must undergo actual geometric material removal. The tool must interact with the workpiece. Machine components must move according to the selected machining operation.

**Principle 3 – Coupled physical behaviour**

Machining forces, temperature, tool wear, tool geometry, vibration and surface quality must be interconnected wherever physically justified.

**Principle 4 – Process-specific physics**

Turning, milling, drilling, grinding, shaping, sawing and broaching must have their own appropriate mathematical models.

Do not force different machining processes to use identical cutting force or wear equations.

**Principle 5 – Research transparency**

Every result must identify its mathematical model, input parameters, assumptions, units, calibration status and limitations.

**Principle 6 – Progressive development**

Build and validate individual modules before integrating them into the complete application.

**Principle 7 – Maintainability**

New machining processes must be addable without rewriting the entire software.

---

# PART II – MACHINING PROCESSES

## 3. INITIAL MACHINING PROCESS COVERAGE

Develop the following machining processes using a common software architecture and process-specific simulation engines.

### 3.1 Centre lathe

Develop a complete conventional centre lathe.

Machine components:

- Bed.
- Headstock.
- Spindle.
- Chuck.
- Tailstock.
- Tailstock quill.
- Carriage.
- Saddle.
- Cross-slide.
- Compound rest.
- Tool post.
- Lead screw.
- Feed rod.
- Workpiece.
- Cutting tool.

Machining operations:

1. Straight turning.
2. Facing.
3. Step turning.
4. Taper turning.
5. Grooving.
6. Parting-off.
7. Thread cutting.
8. Drilling.
9. Boring.
10. Chamfering.

Provide machine controls for spindle speed, cutting speed, feed, depth of cut, tool position, workpiece dimensions and machining length.

Implement progressive geometric material removal.

### 3.2 Radial drilling machine

Machine components:

- Base.
- Column.
- Radial arm.
- Arm lifting mechanism.
- Drilling head.
- Spindle.
- Drill chuck.
- Twist drill.
- Worktable.
- Workpiece.
- Clamping arrangement.

Allow:

- Arm height adjustment.
- Arm rotation.
- Drilling head movement.
- Spindle speed adjustment.
- Feed adjustment.
- Drill positioning.

Machining operations:

1. Centre drilling.
2. Conventional drilling.
3. Step drilling.
4. Reaming.
5. Counterboring.
6. Countersinking.
7. Tapping.

Implement progressive hole formation and drilling force calculations.

### 3.3 Milling machine

Develop vertical and horizontal conventional milling machines.

Machine components:

- Base.
- Column.
- Knee.
- Saddle.
- Worktable.
- Spindle.
- Milling head.
- Arbor where applicable.
- Tool holder.
- Cutter.
- Workpiece.
- Vice and clamping arrangement.

Provide independent X, Y and Z movements.

Machining operations:

1. Face milling.
2. End milling.
3. Slot milling.
4. Side milling.
5. Peripheral milling.
6. Angular milling.
7. Profile milling.
8. Contour milling.
9. Ball-nose milling.
10. Pocket milling.

Implement multi-tooth engagement and progressive geometric material removal.

The initial priority must be face milling, end milling and slot milling.

### 3.4 Grinding machine

Develop:

- Surface grinding.
- Cylindrical grinding.
- Internal grinding.

Include grinding wheel selection, wheel speed, workpiece speed, feed, depth of cut, grinding force, grinding power, temperature and wheel wear.

Include grinding wheel dressing and truing.

### 3.5 Shaping machine

Include:

- Ram.
- Tool head.
- Cutting tool.
- Worktable.
- Vice.
- Quick-return mechanism.
- Feed mechanism.

Simulate cutting stroke, return stroke, feed and progressive material removal.

### 3.6 Slotting machine

Develop vertical reciprocating cutting tool simulation.

Include slot formation, keyway cutting, cutting force and tool wear calculations.

### 3.7 Sawing machine

Develop:

- Horizontal band saw.
- Vertical band saw.
- Power hacksaw.

Simulate blade movement, tooth engagement, cutting forces, kerf generation, blade wear and cutting time.

### 3.8 Broaching machine

Develop internal and external broaching.

Include:

- Broach geometry.
- Progressive tooth rise.
- Tooth engagement.
- Uncut chip thickness.
- Force contribution from individual teeth.
- Total broaching force.
- Tool wear.
- Surface generation.

### 3.9 Future process expansion

Design the architecture to support:

- CNC turning.
- CNC milling.
- CNC drilling.
- G-code import.
- Toolpath simulation.
- Collision detection.
- Additional conventional machining processes.

Do not attempt to implement all future processes simultaneously.

---

# PART III – COMMON ENGINEERING ENGINES

## 4. MACHINING MECHANICS ENGINE

Create a common engineering framework with process-specific cutting mechanics implementations.

All calculations must be available independently of the 3D rendering engine.

### 4.1 Turning force calculations

Calculate:

- Tangential force, Fc.
- Feed force, Ff.
- Radial force, Fr.
- Resultant force.
- Torque.
- Power.
- Material removal rate.

Implement:

**Specific cutting force model**

Fc = kc × Ac

For simplified turning:

Ac = f × ap

**Kienzle model**

Fc = kc1.1 × b × h^(1-mc)

**Mechanistic model**

Fc = Ktc × A + Kte × L

Implement corresponding force component equations using appropriate tool geometry and coordinate transformations.

Calculate spindle speed:

N = 1000V/(πD)

Material removal rate:

MRR = 1000Vfap

Cutting power:

Pc = FcV/60000

Torque:

T = FcD/2000

Use the specified units consistently.

### 4.2 Drilling force calculations

Calculate:

- Axial thrust.
- Drilling torque.
- Cutting power.
- MRR.
- Drill deflection.

Develop a mechanistic model that separately considers:

- Both cutting lips.
- Chisel edge.
- Local chip thickness.
- Local cutting velocity.
- Drill geometry.
- Friction and contact conditions.

Integrate force contributions along the cutting lips.

### 4.3 Milling force calculations

Develop a process-specific mechanistic milling model.

Calculate instantaneous chip thickness as a function of tooth angular position.

For a simplified peripheral milling model:

h(φ) = fz sin(φ)

Implement suitable entry and exit engagement conditions.

Calculate differential cutting forces:

dFt = Ktc h db + Kte db

dFr = Krc h db + Kre db

Include the corresponding axial force model where applicable.

Account for:

- Cutter diameter.
- Number of teeth.
- Helix angle.
- Radial immersion.
- Axial depth of cut.
- Feed per tooth.
- Cutter runout.
- Tooth angular position.
- Up milling.
- Down milling.

Sum the contributions of all engaged teeth.

Display instantaneous forces in machine coordinates.

### 4.4 Grinding mechanics

Calculate:

- Normal force.
- Tangential force.
- Grinding power.
- Specific grinding energy.
- Material removal rate.
- Grinding temperature.

Use appropriate abrasive machining models.

### 4.5 Shaping and slotting mechanics

Calculate cutting forces during the cutting stroke.

Include the influence of reciprocating motion, cutting speed, feed, depth of cut and tool geometry.

### 4.6 Sawing mechanics

Develop tooth engagement and cutting force models for band sawing and power hacksaw operations.

### 4.7 Broaching mechanics

Calculate the contribution of individual broach teeth and the total force generated during broaching.

### 4.8 Common force visualization

Display force vectors directly on the machine and cutting tool.

Use consistent coordinate systems and units.

Provide live graphs:

- Force versus time.
- Force versus cutting distance.
- Force versus spindle revolution.
- Torque versus time.
- Power versus time.
- MRR versus cutting parameters.

---

# PART IV – TOOL GEOMETRY AND MATERIAL DATABASE

## 5. TOOL LIBRARY

Develop an editable tool database.

Include:

### Turning tools

- HSS tools.
- Carbide inserts.
- Coated carbide inserts.
- Ceramic tools.
- CBN tools.
- PCD tools.

### Milling cutters

- End mills.
- Face mills.
- Slot drills.
- Ball-nose cutters.
- Side milling cutters.
- Shell end mills.
- Indexable milling cutters.

### Drilling tools

- HSS drills.
- Cobalt HSS drills.
- Solid carbide drills.
- Coated drills.
- Special-purpose drills.

### Grinding wheels

- Aluminium oxide.
- Silicon carbide.
- CBN.
- Diamond.

### Other tools

- Shaping tools.
- Saw blades.
- Broaches.

Store editable tool geometry and physical properties.

Include tool materials, coatings, hardness, elastic modulus, thermal conductivity, heat capacity, geometry, cutting coefficients and wear coefficients.

Do not fabricate unavailable properties.

Clearly identify published, measured, estimated and calibrated data.

## 6. WORKPIECE MATERIAL DATABASE

Include:

- Mild steel.
- EN8.
- EN24.
- Stainless steel 304.
- Stainless steel 316.
- Cast iron.
- Aluminium 6061.
- Aluminium 7075.
- Copper.
- Brass.
- Titanium Ti-6Al-4V.

Allow custom materials.

Store:

- Density.
- Hardness.
- Young's modulus.
- Poisson's ratio.
- Thermal conductivity.
- Specific heat.
- Flow stress data.
- Temperature-dependent properties where available.
- Machining coefficients.
- Wear-related interaction coefficients.

Maintain source references and units for all material properties.

---

# PART V – TOOL WEAR AND TOOL LIFE

## 7. TOOL WEAR ENGINE

Develop a unified tool condition framework with process-specific wear models.

### 7.1 Turning tool wear

Implement:

- Flank wear.
- Crater wear.
- Notch wear.
- Nose wear.
- Edge chipping.
- Plastic deformation.
- Built-up edge.
- Thermal cracking.

Track:

- Average VB.
- Maximum VBmax.
- Crater depth KT.
- Crater width.
- Crater length.
- Notch wear.
- Wear progression with time and cutting distance.

### 7.2 Milling cutter wear

Implement:

- Flank wear.
- Crater wear.
- Corner wear.
- Cutting-edge chipping.
- Thermal fatigue.
- Mechanical fatigue.
- Adhesive wear.
- Tool fracture.

Track the condition of individual cutting teeth.

Account for intermittent thermal loading and tooth engagement.

### 7.3 Drill wear

Implement:

- Cutting-lip wear.
- Flank wear.
- Chisel-edge wear.
- Crater wear.
- Outer-corner wear.
- Margin wear.
- Edge chipping.

Track both cutting lips independently.

### 7.4 Grinding wheel wear

Implement:

- Abrasive grain attrition.
- Grain fracture.
- Grain pull-out.
- Wheel loading.
- Glazing.
- Profile deterioration.
- Dressing and truing effects.

### 7.5 Shaping, sawing and broaching wear

Develop suitable process-specific wear models.

### 7.6 Mathematical wear models

Implement suitable models including:

Taylor tool life equation:

VT^n = C

Extended Taylor equation:

VT^n f^m ap^p = C

Archard wear model:

Vw = K Fn L/H

Usui wear model:

dW/dt = A σn vs exp(-B/Tabs)

Also implement calibrated empirical wear progression models where appropriate.

All coefficients must be editable and traceable.

Each model must document:

- Variables.
- Units.
- Assumptions.
- Validity range.
- Calibration requirements.
- Limitations.

Do not present any wear equation as universally applicable.

## 8. COUPLED TOOL WEAR AND MACHINING MECHANICS

Implement a coupled simulation cycle.

As tool wear develops:

1. Update tool geometry.
2. Update effective cutting-edge geometry.
3. Recalculate chip geometry where affected.
4. Update local contact conditions.
5. Recalculate cutting forces.
6. Recalculate torque and power.
7. Update heat generation.
8. Recalculate temperatures.
9. Update subsequent wear progression.
10. Update surface quality predictions.

The same principle must apply to milling teeth, drills and other applicable processes.

Do not impose arbitrary force increases based solely on wear percentage.

---

# PART VI – THERMAL ANALYSIS

## 9. THERMAL ENGINE

Implement a common thermal solver framework with process-specific heat generation models.

Calculate temperature distributions in:

- Tool.
- Workpiece.
- Chip.
- Tool-chip contact.
- Tool-workpiece contact.
- Grinding wheel where appropriate.

Implement analytical and reduced-order thermal models first.

Progressively implement transient heat conduction:

ρcp ∂T/∂t = ∇·(k∇T) + qdot

Include:

- Density.
- Specific heat.
- Thermal conductivity.
- Heat generation.
- Heat partition.
- Convection.
- Coolant conditions.
- Temperature-dependent material properties.

Support:

- Dry machining.
- Wet machining.
- Flood cooling.
- Minimum quantity lubrication.
- User-defined cooling conditions.

Display temperature contours, maximum temperatures and temperature-time graphs.

For milling and other intermittent operations, calculate temperature cycling where the model supports it.

---

# PART VII – CHIP FORMATION AND MATERIAL REMOVAL

## 10. CHIP MECHANICS ENGINE

Implement process-specific chip models.

For turning:

- Undeformed chip thickness.
- Deformed chip thickness.
- Chip compression ratio.
- Shear angle.
- Primary shear zone.
- Secondary shear zone.
- Tool-chip contact.
- Chip flow direction.

For drilling:

- Chip generation along cutting lips.
- Chip flow into flutes.
- Chip evacuation.

For milling:

- Tooth-by-tooth chip formation.
- Variable chip thickness.
- Interrupted cutting.
- Chip segmentation where supported.

For shaping and broaching:

- Progressive chip formation.
- Tooth or tool engagement.

For grinding:

- Abrasive grain penetration.
- Cutting, ploughing and rubbing contributions.

Implement three levels:

1. Geometric chip visualization.
2. Analytical chip mechanics.
3. Advanced numerical deformation simulation.

Clearly distinguish these levels.

Do not claim that geometric chip visualization is a finite element plastic deformation model.

---

# PART VIII – MACHINE DYNAMICS

## 11. DYNAMICS AND VIBRATION ENGINE

Develop common structural dynamics infrastructure.

Implement:

m ẍ + c ẋ + kx = F(t)

Include:

- Tool deflection.
- Workpiece deflection.
- Tool-holder stiffness.
- Machine stiffness.
- Damping.
- Natural frequency.
- Forced vibration.
- Vibration amplitude.

For milling, introduce regenerative chatter modelling and stability lobe diagrams.

For turning, introduce regenerative chatter and tool-workpiece interaction.

For drilling, investigate drill deflection and vibration.

For grinding, investigate wheel-workpiece dynamic interaction.

Display displacement, vibration signals and frequency analysis.

Clearly distinguish simplified vibration models from validated chatter predictions.

---

# PART IX – SURFACE QUALITY

## 12. SURFACE INTEGRITY ENGINE

Predict workpiece surface quality using appropriate process-specific models.

For turning, include theoretical roughness:

Ra ≈ f²/(32rε)

For milling, account for:

- Feed per tooth.
- Cutter diameter.
- Cutter geometry.
- Tool runout.
- Tool deflection.
- Surface generation.
- Tooth marks.

For grinding, account for:

- Abrasive grain size.
- Wheel condition.
- Grinding parameters.
- Wheel dressing.

For drilling, account for:

- Drill geometry.
- Drill wear.
- Drill deflection.
- Cutting conditions.

For all processes, distinguish between theoretical geometrical roughness and experimentally calibrated actual roughness.

Include:

- Roughness estimation.
- Dimensional accuracy.
- Surface topography.
- Burr formation trends.
- Surface damage trends.
- Residual stress predictions only where suitable models exist.

---

# PART X – TOOL FAILURE AND CONDITION MONITORING

## 13. TOOL CONDITION ASSESSMENT

Implement a tool condition monitoring module.

Track:

- Flank wear.
- Crater wear.
- Edge chipping.
- Plastic deformation.
- Thermal cracking.
- Tool fracture.
- Excessive temperature.
- Excessive cutting forces.

Allow user-defined replacement criteria.

Generate alerts when specified limits are approached.

For probabilistic failures, use suitable reliability models rather than claiming that deterministic wear equations can predict random fracture.

---

# PART XI – TOOLVISION AI

## 14. IMAGE-BASED TOOL WEAR MEASUREMENT

Develop ToolVision AI as an integrated module.

Accept:

- Microscope images.
- Optical images.
- USB microscope camera input where supported.
- Before-and-after images.
- Calibrated tool photographs.

Detect:

- Tool boundaries.
- Cutting edges.
- Flank wear.
- Crater wear.
- Notch wear.
- Edge chipping.
- Visible damage.

Calculate:

- VB.
- VBmax.
- Wear area.
- Crater dimensions where measurable.
- Damage classification.

Provide:

- Image calibration.
- Pixel-to-micrometre conversion.
- Image annotation.
- Confidence indicators.
- Measurement uncertainty.
- Image comparison.
- Wear progression graphs.

Do not report physical wear dimensions without valid calibration.

Support image export and inclusion in engineering reports.

---

# PART XII – EXPERIMENTAL VALIDATION

## 15. EXPERIMENTAL DATA WORKSPACE

Allow import of:

- CSV.
- XLSX.
- TXT.

Support experimental data from:

- Tool dynamometers.
- Force sensors.
- Torque sensors.
- Thermocouples.
- Infrared cameras.
- Data loggers.
- Surface roughness instruments.
- Optical microscopes.

Compare measured and predicted:

- Cutting forces.
- Drilling thrust.
- Drilling torque.
- Milling forces.
- Grinding forces.
- Temperature.
- Tool wear.
- Tool life.
- Surface roughness.

Calculate:

- Absolute error.
- Percentage error.
- MAE.
- RMSE.
- R-squared where appropriate.
- Other suitable statistical metrics.

Provide model coefficient calibration.

Keep calibration data separate from independent validation data.

Maintain a record of all experimental datasets, model versions and calibration settings.

---

# PART XIII – RESEARCH AND PROCESS OPTIMIZATION

## 16. RESEARCH WORKSPACE

Create a dedicated workspace for machining research.

Include:

- Design of experiments.
- Factorial designs.
- Taguchi methods where appropriate.
- Response surface methodology.
- ANOVA.
- Regression analysis.
- Correlation analysis.
- Multi-variable optimization.
- Genetic algorithms.
- Pareto analysis.
- Uncertainty analysis.

Allow comparison of:

- Tool materials.
- Tool coatings.
- Workpiece materials.
- Cutting parameters.
- Cooling methods.
- Machining processes.

Support custom mathematical equations and calibrated coefficients.

Allow users to create reusable research projects.

## 17. PARAMETER OPTIMIZATION

Allow users to specify:

- Desired MRR.
- Maximum cutting force.
- Maximum power.
- Maximum temperature.
- Desired tool life.
- Maximum allowable wear.
- Target surface roughness.
- Available machine limits.
- Manufacturing cost constraints.

Optimize:

- Cutting speed.
- Feed.
- Depth of cut.
- Tool geometry.
- Tool material.
- Cooling conditions.

Provide multi-objective optimization for productivity, tool life, cost, energy and surface quality.

Never recommend settings outside defined machine or tool constraints.

---

# PART XIV – SOFTWARE ARCHITECTURE

## 18. TECHNOLOGY STACK

Use the following recommended architecture.

Frontend:
- React.
- TypeScript.

3D visualization:
- Three.js.
- WebGL.
- WebGPU where suitable.

CAD geometry:
- OpenCascade.js or another appropriate geometry kernel.

Geometric material removal:
- Dedicated computational geometry engine.
- Boolean or voxel-based methods as appropriate.
- Progressive geometry updates.

Scientific computing:
- Python.
- NumPy.
- SciPy.

Advanced numerical modelling:
- Suitable finite element software and numerical libraries.

Backend:
- Python FastAPI.

Image processing:
- OpenCV.

AI:
- PyTorch.

Charts:
- Plotly.js.

Database:
- SQLite for local-first operation.
- PostgreSQL for optional multi-user deployments.

Desktop:
- Tauri.

Use background workers for computationally intensive calculations.

Keep the numerical solvers independent of the 3D rendering engine.

## 19. MODULAR SOFTWARE DESIGN

Create separate modules for:

1. Machine library.
2. Machine kinematics.
3. CAD geometry.
4. Material removal.
5. Turning mechanics.
6. Milling mechanics.
7. Drilling mechanics.
8. Grinding mechanics.
9. Shaping mechanics.
10. Sawing mechanics.
11. Broaching mechanics.
12. Thermal analysis.
13. Tool wear.
14. Tool life.
15. Tool dynamics.
16. Surface integrity.
17. Experimental validation.
18. ToolVision AI.
19. Optimization.
20. Report generation.
21. Database management.

Use common interfaces where possible.

Each process must have its own specialized physics implementation.

---

# PART XV – USER INTERFACE

## 20. PROFESSIONAL ENGINEERING WORKSPACE

Develop a modern professional interface.

The application should include:

### Main dashboard

- Machine selection.
- Machining process selection.
- Recent projects.
- Simulation history.
- Materials library.
- Tool library.
- Research projects.

### Simulation workspace

- 3D machine viewport.
- Machine control panel.
- Workpiece configuration.
- Tool configuration.
- Machining parameter panel.
- Simulation playback controls.

### Engineering analysis

- Cutting forces.
- Torque.
- Power.
- MRR.
- Temperature.
- Tool wear.
- Tool life.
- Vibration.
- Surface quality.

### Research workspace

- Experimental data.
- Calibration.
- Validation.
- DOE.
- Optimization.
- Reports.

Provide:

- Camera rotation.
- Zoom.
- Pan.
- Sectional views.
- Tool inspection.
- Force vector visualization.
- Temperature contours.
- Wear visualization.
- Graph inspection.

Use consistent SI units and allow other supported unit systems.

All graphs must have correct axes, units and legends.

Do not create inactive buttons or decorative controls that imply functionality which does not exist.

---

# PART XVI – DATA, REPORTS AND REPRODUCIBILITY

## 21. SIMULATION PROJECT MANAGEMENT

Every simulation must be reproducible.

Store:

- Machine.
- Workpiece.
- Tool.
- Material properties.
- Machining operation.
- Machining parameters.
- Selected mathematical models.
- Model coefficients.
- Cooling conditions.
- Initial wear state.
- Simulation duration.
- Calculated results.
- Software version.
- Model version.

Allow:

- Save.
- Load.
- Duplicate.
- Compare.
- Export.
- Restore.

Maintain simulation history.

## 22. ENGINEERING REPORT GENERATION

Generate comprehensive engineering reports.

Include:

1. Title.
2. Objective.
3. Machine details.
4. Workpiece details.
5. Tool details.
6. Machining parameters.
7. Mathematical models.
8. Assumptions.
9. Calculation methodology.
10. Cutting forces.
11. Torque and power.
12. MRR.
13. Temperature.
14. Tool wear.
15. Tool life.
16. Surface quality.
17. Graphs.
18. 3D simulation images.
19. Experimental validation.
20. Statistical analysis.
21. Conclusions.
22. Limitations.

Support PDF, DOCX, XLSX and CSV exports.

Clearly distinguish simulated and experimentally measured values.

---

# PART XVII – VERIFICATION AND VALIDATION

## 23. ENGINEERING ACCURACY REQUIREMENTS

Verification and validation are mandatory.

For every physics module, implement:

- Unit tests.
- Dimensional consistency checks.
- Unit conversion tests.
- Reference calculation tests.
- Numerical stability tests.
- Geometry tests.
- Regression tests.

Compare models with published equations, benchmark datasets and experimental measurements.

Maintain a validation register.

Every model must have one of these statuses:

- Implemented, unvalidated.
- Verified against analytical benchmarks.
- Calibrated against experimental data.
- Independently validated.
- Limited or experimental.

Do not claim validated accuracy without evidence.

Do not fabricate benchmark data, experimental data or research references.

---

# PART XVIII – DEVELOPMENT EXECUTION AND AUTONOMOUS PROGRESS

## 24. DEVELOPMENT MANAGEMENT

This is a critical instruction.

Do not stop after preparing a technical specification or generating a prototype.

You must begin actual implementation and progressively deliver the application.

At project initiation:

1. Inspect the existing repository and development environment.
2. Identify the current application structure.
3. Identify available frameworks and libraries.
4. Identify existing functional modules.
5. Identify deployment configuration.
6. Identify missing components.
7. Create a development plan.
8. Create a baseline backup or Git checkpoint before substantial modifications.
9. Create a feature and testing register.

If an existing application is present, preserve its working functionality.

Do not unnecessarily rewrite existing working modules.

If no application exists, establish the project structure.

## 25. REQUIRED PROJECT DOCUMENTATION

Maintain the following files in the repository:

### README.md

Project overview, installation, architecture and usage.

### MASTER_SPECIFICATION.md

Complete engineering and software specification.

### DEVELOPMENT_ROADMAP.md

Development stages and milestones.

### DEVELOPMENT_STATUS.md

Completed, partially completed and pending functionality.

### MATHEMATICAL_MODELS.md

Equations, variables, units, assumptions and references.

### VALIDATION_REGISTER.md

Verification and validation results.

### KNOWN_LIMITATIONS.md

Current limitations and unresolved engineering issues.

### CHANGELOG.md

Record of all development changes.

### TESTING_GUIDE.md

Instructions for running automated and manual tests.

Update these documents throughout development.

## 26. DEVELOPMENT STATUS TRACKING

For every module, maintain the following statuses:

- Not started.
- Architecture completed.
- Implementation in progress.
- Implemented.
- Unit tested.
- Integrated.
- Validated.
- Released.

Do not mark a module complete simply because its interface exists.

Maintain a feature checklist.

At the end of every development stage, report:

1. What was implemented.
2. What is working.
3. What has been tested.
4. What has been validated.
5. What remains incomplete.
6. Known defects.
7. Files changed.
8. Next development stage.

## 27. PROGRESSIVE IMPLEMENTATION

Follow this implementation sequence.

### STAGE 1 – FOUNDATION

- Repository inspection.
- Architecture.
- Project setup.
- Database.
- Unit system.
- Material database.
- Tool database.
- Simulation state.
- Testing framework.

### STAGE 2 – LATHE

- 3D centre lathe.
- Machine kinematics.
- Workpiece rotation.
- Tool movement.
- Actual material removal.
- Turning operations.
- Force calculations.
- Torque and power.
- Force visualization.

### STAGE 3 – DRILLING

- Radial drilling machine.
- Machine movement.
- Drill rotation.
- Progressive hole formation.
- Thrust force.
- Drilling torque.
- Power and MRR.

### STAGE 4 – TOOL WEAR AND THERMAL MODELLING

- Flank wear.
- Crater wear.
- Notch wear.
- Drill wear.
- Tool life.
- Thermal analysis.
- Wear-mechanics coupling.

### STAGE 5 – MILLING

- Vertical milling machine.
- Horizontal milling machine.
- Cutter geometry.
- Multi-tooth engagement.
- Cutting forces.
- Material removal.
- Milling tool wear.
- Thermal cycling.
- Milling dynamics.

### STAGE 6 – GRINDING

- Surface grinding.
- Cylindrical grinding.
- Internal grinding.
- Grinding forces.
- Grinding wheel wear.
- Dressing.
- Thermal damage.

### STAGE 7 – SHAPING, SLOTTING AND SAWING

Implement the respective machine simulations, mechanics and wear models.

### STAGE 8 – BROACHING

Implement progressive multi-tooth engagement and cutting mechanics.

### STAGE 9 – ADVANCED ENGINEERING

- Machine dynamics.
- Chatter.
- Surface integrity.
- Advanced thermal models.
- Advanced numerical simulation.
- FEM integration.

### STAGE 10 – RESEARCH FEATURES

- ToolVision AI.
- Experimental data import.
- Model calibration.
- DOE.
- RSM.
- Optimization.
- Engineering reporting.

### STAGE 11 – INTEGRATION AND RELEASE

- Regression testing.
- Interface consistency.
- Performance testing.
- Installation testing.
- Documentation.
- Deployment.
- Final validation report.

The development sequence may be adjusted if a technical dependency requires it, but do not omit any specified functionality.

---

# PART XIX – STRICT DEVELOPMENT RULES

## 28. NON-NEGOTIABLE REQUIREMENTS

1. Never substitute animation for actual machining simulation.
2. Never use arbitrary cutting force values.
3. Never invent material properties.
4. Never invent wear coefficients.
5. Never claim that an empirical model is universally applicable.
6. Never present an unvalidated model as scientifically validated.
7. Never disconnect tool wear from subsequent machining mechanics.
8. Never present an estimated temperature as a fully resolved thermal simulation.
9. Never present geometric chip visualization as FEM chip formation.
10. Never present estimated tool life as guaranteed actual tool life.
11. Never use a turning force model directly for milling or drilling without appropriate physical justification.
12. Never hide incomplete functionality behind decorative interface elements.
13. Never silently remove existing working features.
14. Never overwrite project files without a recoverable version.
15. Never expose secrets, passwords or API keys in source code.
16. Never commit sensitive configuration files.
17. Never sacrifice engineering correctness for visual effects.
18. Never sacrifice software maintainability for rapid implementation.
19. Test every new feature.
20. Run regression tests after every significant integration.
21. Clearly identify assumptions and limitations.
22. Maintain a usable application throughout development.
23. Do not stop after producing a mock-up.
24. Do not declare the complete project finished until the acceptance criteria are satisfied.

---

# PART XX – ACCEPTANCE TESTS

## 29. REQUIRED DEMONSTRATION SCENARIOS

### Test A – Lathe turning

Select EN8 steel, carbide insert, enter machining parameters, execute straight turning and verify:

- Actual material removal.
- Three cutting force components.
- Torque.
- Power.
- MRR.
- Force-time graph.

### Test B – Lathe tool wear

Run machining progressively and verify:

- Flank wear progression.
- Crater wear where supported.
- Tool temperature.
- Force changes.
- Surface quality changes.
- Tool life prediction.

### Test C – Radial drilling

Execute drilling and verify:

- Arm and head positioning.
- Drill rotation.
- Progressive hole formation.
- Thrust force.
- Torque.
- Power.
- MRR.

### Test D – Drill wear

Verify:

- Individual lip wear.
- Chisel-edge wear.
- Thrust variation.
- Torque variation.
- Hole quality prediction.

### Test E – Milling

Execute face milling and slot milling.

Verify:

- Cutter rotation.
- Tooth engagement.
- Actual material removal.
- Instantaneous chip thickness.
- Tooth-by-tooth cutting forces.
- Resultant forces.
- Torque.
- Power.
- Force variation with spindle rotation.

### Test F – Milling tool wear

Verify:

- Individual tooth wear.
- Flank wear.
- Edge damage.
- Temperature cycling.
- Tool life.
- Effect on cutting forces.

### Test G – Grinding

Execute surface grinding and verify:

- Wheel rotation.
- Workpiece movement.
- Material removal.
- Normal force.
- Tangential force.
- Power.
- Specific grinding energy.
- Wheel wear.

### Test H – Experimental validation

Import actual measurements and compare predicted versus measured quantities.

### Test I – ToolVision AI

Upload calibrated microscope images and measure visible tool wear.

### Test J – Research optimization

Run a multi-parameter study and generate appropriate plots and reports.

Only mark a test as passed when the functionality has actually been demonstrated.

---

# PART XXI – FINAL PRODUCT DELIVERABLES

## 30. EXPECTED DELIVERABLES

Deliver a complete software product consisting of:

1. Browser-based application.
2. Desktop-compatible architecture.
3. Complete source code.
4. 3D machine models.
5. Geometric material removal engine.
6. Process-specific machining mechanics engines.
7. Thermal modelling engine.
8. Tool wear engine.
9. Tool life prediction.
10. Tool failure assessment.
11. Machine dynamics engine.
12. Surface quality engine.
13. Experimental validation module.
14. ToolVision AI.
15. Materials database.
16. Tool database.
17. Process optimization module.
18. Engineering report generator.
19. Automated testing suite.
20. Technical documentation.
21. Installation instructions.
22. User manual.
23. Deployment instructions.
24. Validation and limitations report.

---

# PART XXII – FINAL EXECUTION INSTRUCTION

You are not being asked to prepare another proposal or merely explain how the application could be developed.

You are being instructed to begin building MACHINASIM.

Start by inspecting the development environment and repository.

Prepare the architecture and establish the engineering foundations.

Then implement the first functional machining simulator.

Do not attempt to generate the entire application in a single code-generation operation.

Work incrementally, preserve existing functionality, test every implementation and maintain continuous project documentation.

At the end of each stage, update the development status and continue to the next stage whenever the environment and available execution resources permit.

If a feature cannot be completed, document precisely what remains and why. Do not silently omit it.

If a mathematical model lacks reliable coefficients or calibration data, implement the model interface, identify the missing data and allow the user to supply calibrated values.

If a numerical solver is not yet available, provide a documented reduced-order implementation rather than pretending that an advanced solver exists.

The application must remain usable during development.

The ultimate objective is to create an integrated, scientifically defensible, extensible engineering software platform that allows a student, researcher or manufacturing engineer to:

- Select a machining process.
- Configure a machine.
- Select a workpiece material.
- Select a cutting tool.
- Enter machining parameters.
- Execute a realistic 3D machining simulation.
- Observe actual geometric material removal.
- Calculate cutting forces.
- Examine chip formation.
- Predict temperature.
- Observe tool wear.
- Estimate tool life.
- Assess tool damage.
- Examine vibration and deflection.
- Predict workpiece quality.
- Compare simulation with experiments.
- Optimize machining parameters.
- Generate a complete engineering report.

**Build MACHINASIM as a genuine multi-process machining engineering and research platform.**

Prioritize scientific integrity, engineering accuracy, functional completeness, maintainability and progressive development.

Begin implementation now.

# MachinaSim — Mathematical models

_Generated from `src/core/models.js` (v1.0.0). Do not edit by hand; run `node scripts/gen-docs.mjs`._

Internal units: mm, N, N·m, kW, m/min, rev/min, °C, s (tool life in min). See `src/core/units.js`.

## All cutting

### M-CUT-01 — Kienzle specific cutting force

- **Equation(s):** `kc = kc1.1·h^(−mc);  Fc = kc·b·h`
- **Variables / inputs:** h uncut chip thickness [mm], b width of cut [mm], kc1.1 [N/mm²], mc [–]
- **Assumptions:** Sharp tool at reference rake; speed effect neglected; coefficients from tool-maker VDI 3323 group tables.
- **Validity range:** h ≈ 0.05–1.6 mm (warning raised outside)
- **Status:** Verified against analytical benchmarks
- **Automated verification:** physics.test.js › Kienzle
- **References:** O. Kienzle (1952); W. König, F. Klocke, Fertigungsverfahren 1; ISCAR material group table

### M-CUT-02 — Rake-angle correction of kc

- **Equation(s):** `Kγ = 1 − 0.015·(γ − γ0), clamped 0.6–1.6`
- **Variables / inputs:** γ effective normal rake, γ0 reference rake of the kc data (6° steels, 2° cast iron)
- **Assumptions:** Linear correction ≈1.5 %/degree (König/Klocke practice).
- **Validity range:** |γ − γ0| ≲ 20°
- **Status:** Implemented, unvalidated
- **Automated verification:** physics.test.js › Rake correction
- **References:** König & Klocke

### M-CUT-03 — Thrust force from friction angle

- **Equation(s):** `Fth/Fc = tan(β − γn), β = atan μ;  oblique: Kr, Ka per Armarego (η = i)`
- **Variables / inputs:** μ mean tool–chip friction coefficient (ESTIMATED default 0.5)
- **Assumptions:** Merchant force circle; Stabler chip-flow rule for oblique edges.
- **Validity range:** Continuous chip; calibrate μ from measured Ff/Fc
- **Status:** Limited / experimental
- **Automated verification:** physics.test.js › Oblique ratios
- **References:** Merchant (1945); Armarego & Whitfield (1985)

## Turning

### M-CUT-04 — Merchant orthogonal cutting analysis

- **Equation(s):** `φ = 45° − (β−γ)/2; Fs = Fc cosφ − Fth sinφ; Vs = V cosγ / cos(φ−γ); Vch = V·rc`
- **Variables / inputs:** φ shear angle, rc chip ratio
- **Assumptions:** Minimum-energy shear plane.
- **Validity range:** Qualitative; Merchant often under-predicts φ
- **Status:** Verified against analytical benchmarks
- **Automated verification:** physics.test.js › Merchant energy balance
- **References:** Merchant (1945)

### M-TURN-01 — Nominal turning forces, torque, power, MRR

- **Equation(s):** `h = f sinκr, b = ap/sinκr; T = Fc·(D−ap)/2000; P = T·ω; MRR = π(D−ap)·ap·f·N`
- **Variables / inputs:** V [m/min], f [mm/rev], ap [mm], D [mm]
- **Assumptions:** Nose radius neglected in chip geometry; torque at chip-centroid radius (more accurate than T = Fc·D/2000).
- **Validity range:** ap ≫ rε
- **Status:** Verified against analytical benchmarks
- **Automated verification:** physics.test.js › Turning nominal
- **References:** Standard machining texts

### M-TURN-02 — Geometry-coupled turning forces (equivalent chip thickness)

- **Equation(s):** `A = removed section per rev (geometry); l = engaged leading edge length; h = A/l; F from M-CUT-01..03 with thrust ⟂ engaged edge`
- **Variables / inputs:** tool outline incl. nose radius, κr, κr′
- **Assumptions:** Woxén/Colwell-type equivalent chip thickness; chip flow normal to the mean engaged edge.
- **Validity range:** Any outline / path (turning, facing, grooving, threading, taper, chamfer)
- **Status:** Verified against analytical benchmarks
- **Automated verification:** lathe.test.js › Straight turning sharp 90° tool
- **References:** Woxén (1932); Colwell (1954)

### M-TURN-03 — Kinematic surface roughness

- **Equation(s):** `Exact feed-mark profile from nose arc + edges; classical Rt = f²/8rε, Ra = f²/32rε`
- **Variables / inputs:** f, rε, κr, κr′
- **Assumptions:** Ideal geometric replication; no BUE, vibration, side flow or wear (spec: theoretical ≠ actual).
- **Validity range:** Theoretical lower bound
- **Status:** Verified against analytical benchmarks
- **Automated verification:** lathe.test.js › Turned profile roughness
- **References:** Shaw, Metal Cutting Principles

### M-TURN-04 — Workpiece deflection

- **Equation(s):** `δ = F z³/3EI (chuck); F a²b²/3EIL (centres); propped cantilever (chuck + centre)`
- **Variables / inputs:** F passive force, E, D, L
- **Assumptions:** Euler–Bernoulli beam of current mean diameter; rigid chuck.
- **Validity range:** Slender parts
- **Status:** Verified against analytical benchmarks
- **Automated verification:** physics.test.js › deflection formulas
- **References:** Roark

### M-THERM-01 — Analytical cutting temperatures

- **Equation(s):** `Boothroyd Γ(RT tanφ); ΔTs = (1−Γ)Ps/(ρcVhb); ΔTm = 1.13√(RT/l0)·ΔTf`
- **Variables / inputs:** RT = ρcVh/k, l0 = l/hc (ESTIMATED 2)
- **Assumptions:** Adiabatic chip; temperature-independent properties; no coolant effect at this level.
- **Validity range:** Continuous chips, moderate speeds
- **Status:** Limited / experimental
- **Automated verification:** physics.test.js › Boothroyd
- **References:** Boothroyd (1963); Boothroyd & Knight, Fundamentals of Machining

### M-DYN-01 — Tlusty stability lobes

- **Equation(s):** `b_lim = −1/(2 Ks Re G); n = 60 fc/(j + ε/2π), ε = 2π − 2 atan(Re/Im)`
- **Variables / inputs:** modal k, ζ, fn (ESTIMATED defaults — tap test required)
- **Assumptions:** SDOF, oriented FRF
- **Validity range:** Linear regenerative chatter
- **Status:** Verified against analytical benchmarks
- **Automated verification:** physics.test.js › Tlusty asymptote
- **References:** Tlusty (1963); Schmitz & Smith, Machining Dynamics

## Drilling

### M-DRILL-01 — Mechanistic lip model

- **Equation(s):** `h = (f/z)sinκ; db = dρ/sinκ; γn = atan(tanβρ/sinκ); dFc = kc(h)Kγ h db; dFz = dFc tan(β−γn) sinκ; T = Σ dFc ρ`
- **Variables / inputs:** D, point angle 2κ, helix β, web ratio
- **Assumptions:** Web-thinning effect on rake neglected; no margin friction.
- **Validity range:** Twist drills, reamers, countersinks, counterbores
- **Status:** Limited / experimental
- **Automated verification:** physics.test.js › Drilling vs Sandvik (±30 %)
- **References:** Armarego & Cheng (1972); Stephenson & Agapiou

### M-DRILL-02 — Chisel-edge thrust

- **Equation(s):** `Orthogonal cutting at γch (ESTIMATED −56°), h = f/2, thrust ratio capped (ESTIMATED 1.0)`
- **Variables / inputs:** web thickness, γch
- **Assumptions:** Chisel extrusion modelled as large-negative-rake cutting with capped thrust ratio.
- **Validity range:** Must be calibrated with a dynamometer
- **Status:** Limited / experimental
- **Automated verification:** prismatic.test.js › Step drilling
- **References:** Williams (1974) (concept)

### M-DRILL-03 — Drill deflection & hole oversize

- **Equation(s):** `δ = F_rad L³/(3E I), I = π(0.8D)⁴/64; oversize ≈ 2δ`
- **Variables / inputs:** radial imbalance from unequal lip wear
- **Assumptions:** Static cantilever; core-factor 0.8 ESTIMATED.
- **Validity range:** Trend only
- **Status:** Limited / experimental
- **Automated verification:** —
- **References:** —

### M-DRILL-04 — Tapping torque (energy estimate)

- **Equation(s):** `T = kc(h)·A_groove·r̄`
- **Variables / inputs:** tap D, pitch, tap-drill radius
- **Assumptions:** Flank friction of full threads excluded (under-predicts).
- **Validity range:** Order of magnitude
- **Status:** Limited / experimental
- **Automated verification:** —
- **References:** —

## Milling

### M-MILL-01 — Mechanistic milling forces

- **Equation(s):** `h(φ) = fz sinφ sinκ (+runout); dFt = kc(h)Kγ h db; dFr = Kr dFt; Fx = −Ft cosφ − Fr sinφ; Fy = Ft sinφ − Fr cosφ`
- **Variables / inputs:** D, Z, helix, κr, fz, ap, ae, up/down
- **Assumptions:** Rigid tool; Kienzle (or user linear Ktc/Kte) coefficients.
- **Validity range:** End, slot, face, ball-nose, slab cutters
- **Status:** Verified against analytical benchmarks
- **Automated verification:** physics.test.js › Milling closed form; prismatic.test.js › Slot milling
- **References:** Altintas, Manufacturing Automation (2012)

### M-MILL-02 — Geometry-coupled tooth engagement

- **Equation(s):** `tooth element engaged iff Z-map material exists at radius r+Δ in direction φ before the cut`
- **Variables / inputs:** Z-map grid g, Δ = 1.5g
- **Assumptions:** Engagement boundary error ≈ Δ; chip thickness from kinematics.
- **Validity range:** Arbitrary 2.5-D geometry
- **Status:** Verified against analytical benchmarks
- **Automated verification:** prismatic.test.js › Slot / shoulder milling
- **References:** —

### M-MILL-03 — Milled surface roughness

- **Equation(s):** `Rt = fz²/(8R) wall; fz²/(8rε) floor; ball scallop R − √(R² − (s/2)²)`
- **Variables / inputs:** fz, R, rε, stepover s
- **Assumptions:** Kinematic only.
- **Validity range:** Theoretical
- **Status:** Implemented, unvalidated
- **Automated verification:** —
- **References:** —

### M-DYN-02 — Zero-order milling stability (2-DOF)

- **Equation(s):** `Altintas–Budak eigenvalue solution with directional factors αij`
- **Variables / inputs:** Kt, Kr, Z, φst, φex, modes
- **Assumptions:** Average tooth-passing (ZOA); poor for very low immersion
- **Validity range:** Moderate/high radial immersion
- **Status:** Verified against analytical benchmarks
- **Automated verification:** physics.test.js › directional factors
- **References:** Altintas & Budak (1995)

## All

### M-THERM-02 — 2-D FD tool temperature field

- **Equation(s):** `ρcp ∂T/∂t = k∇²T; Dirichlet interface strip; Robin convection (coolant h); far faces ambient`
- **Variables / inputs:** k, ρ, cp tool; h coolant (ESTIMATED)
- **Assumptions:** Prescribed interface temperature (not coupled chip solution); 4 × 4 mm section.
- **Validity range:** Qualitative transient heating / cycling
- **Status:** Verified against analytical benchmarks
- **Automated verification:** physics.test.js › FD vs erfc
- **References:** Incropera

### M-WEAR-01 — Taylor / extended Taylor tool life

- **Equation(s):** `V·T^n·(f/f0)^m·(ap/ap0)^p = C`
- **Variables / inputs:** n, C, m, p (Groover textbook defaults where available; none for Ti, coated carbide, CBN, PCD)
- **Assumptions:** Constants are pair- and criterion-specific.
- **Validity range:** Within calibration range only
- **Status:** Implemented, unvalidated
- **Automated verification:** physics.test.js › Taylor
- **References:** Taylor (1907); Groover

### M-WEAR-02 — Taylor–Miner flank-wear progression

- **Equation(s):** `dVB/dt = VBc / T(V, f, ap)`
- **Variables / inputs:** VBc = 0.3 mm (ISO 3685)
- **Assumptions:** Linear wear progression (no break-in / accelerated zone).
- **Validity range:** Reproduces Taylor life; shape of VB(t) is NOT predicted
- **Status:** Verified against analytical benchmarks
- **Automated verification:** physics.test.js › Taylor–Miner
- **References:** ISO 3685

### M-WEAR-03 — Wear-land force increase

- **Equation(s):** `ΔFth = σw·VB·l; ΔFc = μw·ΔFth`
- **Variables / inputs:** σw ≈ Rm/√3, μw = 0.5 (ESTIMATED)
- **Assumptions:** Uniform land stress (simplified Waldorf/Smithey).
- **Validity range:** Calibrate from force vs VB data
- **Status:** Limited / experimental
- **Automated verification:** lathe.test.js › Wear coupling
- **References:** Smithey, Kapoor, DeVor (2000)

### M-WEAR-04 — Usui wear rate

- **Equation(s):** `dW/dt = A·σn·vs·exp(−B/T)`
- **Variables / inputs:** A, B user-supplied (no defaults shipped)
- **Assumptions:** Requires calibrated interface stress & temperature.
- **Validity range:** Calibrated pairs only
- **Status:** Implemented, unvalidated
- **Automated verification:** —
- **References:** Usui, Shirakashi, Kitagawa (1984)

### M-WEAR-05 — Nose recession from flank wear

- **Equation(s):** `Δr = VB·tanα → ΔD = 2VB tanα`
- **Variables / inputs:** clearance α
- **Assumptions:** Uniform flank land.
- **Validity range:** Geometric
- **Status:** Verified against analytical benchmarks
- **Automated verification:** lathe.test.js › Wear coupling
- **References:** —

### M-WEAR-06 — Random fracture reliability

- **Equation(s):** `R(t) = exp(−(t/η)^β)`
- **Variables / inputs:** η, β from user failure data
- **Assumptions:** Weibull
- **Validity range:** User data
- **Status:** Implemented, unvalidated
- **Automated verification:** —
- **References:** —

### M-DYN-03 — Forced vibration (periodic)

- **Equation(s):** `x(t) = Σ G(kΩ) F̂k e^{ikΩt}`
- **Variables / inputs:** force cycle, modes
- **Assumptions:** Linear, steady state
- **Validity range:** —
- **Status:** Verified against analytical benchmarks
- **Automated verification:** physics.test.js › periodic response static
- **References:** —

## Grinding

### M-THERM-03 — Grinding temperature (Jaeger)

- **Equation(s):** `θmax = 1.13·ε·q·√(α·lc/vw)/k, lc = √(a·de)`
- **Variables / inputs:** ε partition (ESTIMATED), u specific energy (ESTIMATED)
- **Assumptions:** High Péclet band source.
- **Validity range:** Pe > 10
- **Status:** Implemented, unvalidated
- **Automated verification:** physics.test.js › Grinding
- **References:** Jaeger (1942); Malkin & Guo, Grinding Technology

### M-GRIND-01 — Grinding power and forces

- **Equation(s):** `P = u·Qw; Ft = P/vs; Fn = Ft/(Ft/Fn); heq = vw a / vs; de = ds dw/(dw ± ds)`
- **Variables / inputs:** u (ESTIMATED), force ratio (ESTIMATED)
- **Assumptions:** Constant specific energy (size effect not modelled)
- **Validity range:** Calibrate u
- **Status:** Implemented, unvalidated
- **Automated verification:** physics.test.js › Grinding
- **References:** Malkin & Guo

### M-GRIND-02 — Wheel wear by grinding ratio

- **Equation(s):** `Vs_wear = Qw/G`
- **Variables / inputs:** G (ESTIMATED)
- **Assumptions:** Constant G; loading/glazing not modelled
- **Validity range:** —
- **Status:** Implemented, unvalidated
- **Automated verification:** —
- **References:** Malkin & Guo

## Shaping / slotting

### M-RECIP-01 — Quick-return kinematics & stroke forces

- **Equation(s):** `β = atan(r sinθ/(d + r cosθ)); x = L sinβ; ratio = (π + 2 asin(r/d))/(π − 2 asin(r/d)); Fc Kienzle`
- **Variables / inputs:** r, d, L, crank rpm
- **Assumptions:** Slotted-lever (Whitworth-type) mechanism; horizontal ram approx.
- **Validity range:** —
- **Status:** Verified against analytical benchmarks
- **Automated verification:** physics.test.js › quick return
- **References:** Kinematics of machines

## Sawing

### M-SAW-01 — Tooth-engagement sawing force

- **Equation(s):** `fz = vf·P/vs; n = Lc/P; Fc = n·kc(fz)·fz·kerf`
- **Variables / inputs:** pitch P, kerf
- **Assumptions:** Uniform tooth load; set factor 1
- **Validity range:** —
- **Status:** Implemented, unvalidated
- **Automated verification:** —
- **References:** —

## Broaching

### M-BROACH-01 — Broaching force profile

- **Equation(s):** `F(x) = Σ_engaged kc(rz)·rz·b`
- **Variables / inputs:** rise per tooth rz, pitch p, Lw, b
- **Assumptions:** Kienzle per tooth; chip-space limits not checked
- **Validity range:** —
- **Status:** Verified against analytical benchmarks
- **Automated verification:** physics.test.js › Broaching
- **References:** —

## Research

### M-RES-01 — Kienzle / Taylor calibration

- **Equation(s):** `ln kc = ln kc1.1 − mc ln h (OLS); ln V = ln C − n ln T; extended Taylor OLS`
- **Variables / inputs:** user data
- **Assumptions:** Log-normal errors
- **Validity range:** Data range
- **Status:** Verified against analytical benchmarks
- **Automated verification:** research.test.js
- **References:** —

## ToolVision

### M-VIS-01 — Image-based flank wear measurement

- **Equation(s):** `Otsu threshold in ROI below user-drawn cutting-edge line; VB = mean land width; VBmax = max`
- **Variables / inputs:** pixel calibration (µm/px) from a user-drawn scale
- **Assumptions:** Classical image processing (no trained neural network yet); bright wear land on darker flank
- **Validity range:** Calibrated, well-lit microscope images
- **Status:** Implemented, unvalidated
- **Automated verification:** research.test.js › synthetic wear land
- **References:** ISO 3685 (VB definition); Otsu (1979)

## Data sources

- **ISCAR:** ISCAR, "Materials group" table (DIN/ISO 513, VDI 3323): kc1 = specific cutting force for 1 mm² chip section, mc = chip thickness exponent. https://www.iscar.com/lms/wp-content/uploads/2021/04/Materials-group.pdf
- **SECO:** Seco Tools, Milling catalogue 2025, SMG workpiece classification (kc1.1, mc)
- **ASM:** ASM Handbook / MatWeb typical room-temperature property values for the named (or equivalent) grade
- **JC83:** G.R. Johnson, W.H. Cook (1983), A constitutive model and data for metals subjected to large strains, high strain rates and high temperatures, Proc. 7th Int. Symp. Ballistics, 541–547
- **JD02:** S.P.F.C. Jaspers, J.H. Dautzenberg (2002), Material behaviour in conditions similar to metal cutting: flow stress in the primary shear zone, J. Mater. Process. Technol. 122, 322–330
- **LL98:** W.S. Lee, C.F. Lin (1998), High-temperature deformation behaviour of Ti6Al4V alloy evaluated by high strain-rate compression tests, J. Mater. Process. Technol. 75, 127–136
- **Taylor defaults:** M.P. Groover, Fundamentals of Modern Manufacturing, Table "Representative values of n and C in the Taylor tool life equation" (textbook typical values; criterion and feed/depth not specified — UNCALIBRATED)

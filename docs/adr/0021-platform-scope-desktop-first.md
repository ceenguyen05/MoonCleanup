# ADR-0021: Platform scope - desktop first, mobile post-launch

- **Status:** Accepted (2026-11-12)
- **Deciders:** lead/orchestrator, owner
- **Canonical source:** [tech-stack.md](../architecture/tech-stack.md) section 4 (Platform scope row)

## Context

The visual bar and the 16-player co-op are heavy. Mobile faces Android WebGPU fragmentation (vendor and OS gating), iOS Safari terminating or looping heavy WebGL pages with no way to query a memory budget, thermal throttling (a native case study fell from 60 to 32 FPS in 30 minutes), a full touch-control redesign and a 300-500 MB memory ceiling. Desktop reference hardware is well characterized: Steam October 2026 shows 1920x1080 as 50% of displays, 8 GB VRAM most common and RTX 4060 Laptop the top laptop GPU.

## Options considered

1. **Desktop browsers first (keyboard/mouse + gamepad); mobile/touch post-launch.** Pro: focus, budgets are known (Tier A/B); lower QA surface. Con: excludes phones at launch.
2. **Mobile-first.** Pro: reach. Con: conflicts with the visual bar; iOS memory kills.
3. **Responsive to phones from day one.** Pro: one UI. Con: doubles UI and perf work; touch controls redesign.
4. **Desktop only, no gamepad.** Pro: less input work. Con: gamepad is cheap, low-risk, and suits console-like play.
5. **Native wrappers (Electron/Capacitor).** Pro: more control. Con: out of scope and cost.

## Decision

Option 1. Supported targets: current Chrome/Edge, Firefox and Safari 26+ on desktop; **keyboard and mouse plus Gamepad API** with input-prompt glyphs. Perf targets: **Tier A** (discrete mid-range laptop) 60 FPS at High; **Tier B** (integrated graphics) 30+ FPS at Low/Medium; Ultra for high-end desktops. UI is designed at desktop sizes (1920x1080 reference) with scaling to 1280x720, and mobile is **not a v1.0 commitment**. Mobile and touch controls are a post-launch milestone requiring their own ADR, memory budgets (<= 300-500 MB) and device test plan. No COOP/COEP headers or WASM threads in the MVP (ADR-0004 and tech-stack section 5).

## Consequences

**Positive**
- A single, testable hardware envelope; no touch UI in the MVP.

**Negative / risks**
- Lose casual phone traffic; portal distribution (Poki/CrazyGames) mobile placement is out of scope.
- Safari on pre-Tahoe macOS and Linux Chrome without supported GPUs fall to WebGL2 (ADR-0004).
- Some players on laptops will hit thermal throttling; dynamic resolution (ADR-0005) mitigates.

## Revisit trigger

- Post-launch telemetry shows significant mobile traffic.
- WebGPU on Android/iOS stabilizes and a Tier C budget (mobile) is validated by a spike.

## Evidence

- [browser-feasibility.md](../research/browser-feasibility.md) (Executive summary 8-14; sections 3-5; recommended budgets)
- [rendering-case-threejs.md](../research/tech/rendering-case-threejs.md) (fallback reality)

# ADR-0012: UI layer - React 19 + Motion over a DOM overlay

- **Status:** Accepted (2026-11-12)
- **Deciders:** lead/orchestrator, ui-ux-motion-designer
- **Canonical source:** [tech-stack.md](../architecture/tech-stack.md) section 4 (UI row)

## Context

The HUD, shop, promotions board, map and settings are menu-heavy with strong motion polish requirements. UI must not steal frame time from the 16.7 ms (Tier A) / 33 ms (Tier B) budgets, must be accessible, and must be built by agents who know the ecosystem. Rendering UI inside the 3D canvas would couple it to the renderer and re-implement text/layout.

## Options considered

1. **DOM overlay: React 19 + Motion (`motion/react`), CSS Modules + CSS custom-property tokens, Lucide + custom SVG.** Pro: highest agent familiarity; real text, accessibility and layout; springs from Motion. Con: React runtime weight; Motion is ~63 kB min+gzip.
2. **Preact / Solid / Svelte / Lit.** Pro: 5-11 kB runtimes. Con: smaller agent knowledge; ecosystem and Motion integration less direct.
3. **Imperative vanilla DOM.** Pro: no framework. Con: unmaintainable at menu scale.
4. **UI rendered in WebGPU/canvas (e.g. troika or custom).** Pro: one surface. Con: reimplements accessibility and text; heavy.
5. **GSAP.** Pro: free, powerful. Con: license forbids use in competing no-code animation builders; adds a second animation system.

## Decision

Option 1. The UI is a React 19 tree mounted in a DOM layer above the canvas; animation uses **Motion springs**; styling uses **CSS Modules + design tokens as CSS custom properties**; icons are **Lucide (ISC)** plus custom SVG; fonts are OFL. React Three Fiber is not used (ADR-0003). The game talks to the UI only through a **typed external store** (`shared/ui/store.ts`, consumed via `useSyncExternalStore`); gameplay/net write through actions, UI never touches sim state. The store is flushed **at most 15 Hz** except for tick-up counters, which animate locally. Rules: no layout-thrashing inside the game loop; HUD elements are `transform`/`opacity` animated; keyboard and gamepad navigation and focus order are mandatory; reduced-motion is respected.

## Consequences

**Positive**
- Rich, accessible UI built quickly; the store decouples UI from simulation, simplifying testing in Vitest browser mode.

**Negative / risks**
- React + Motion add roughly 100 kB gz (Motion alone ~63 kB), which eats into the <=20 MB first-playable budget only slightly but matters for initial JS parse on Tier B.
- A bad store subscription can re-render at game rate; mitigated by throttled flush and selector discipline.
- GPU-composited DOM over a WebGPU canvas costs some compositing time.

## Revisit trigger

- UI CPU exceeds 0.5 ms (Tier A) / 1 ms (Tier B) per frame in profiles.
- Initial JS size of the UI layer exceeds ~250 kB gz: evaluate Preact compat.

## Evidence

- [tooling-and-libraries.md](../research/tech/tooling-and-libraries.md) (UI layer sizes: Preact, Solid, Svelte, Lit, Motion, GSAP license)
- [rendering-case-threejs.md](../research/tech/rendering-case-threejs.md) (R3F recommendation: do not adopt; UI-in-DOM)
- [module-boundaries.md](../architecture/module-boundaries.md) (UI store contract, frame order, 15 Hz flush)

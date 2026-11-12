# M4 — Post-launch backlog (themes, not scheduled)

Owner: lead · Source: [scope-tiers.md §4](../design/scope-tiers.md#4-post-launch-backlog-not-promised-order-is-a-suggestion) (not promised; order is a suggestion).
Nothing here has task IDs or stages yet. When Cee picks a theme, the lead runs `/plan-wave M4` and turns its candidate tasks into a normal milestone file (`M4-<theme>.md`) with W0 contracts first, ≤ 5 specialists per wave, ≤ 3 per stage, and an integrator task per wave.

## 1. Selection rules

1. Every theme must stay **$0** (Vercel Hobby non-commercial, Render Free, Aiven PG Free) unless Cee changes OPEN_QUESTIONS Q3/Q13.
2. Bandwidth-heavy themes need a `performance-budgets.md §6.2` re-estimate before planning (5 GB/month egress, owner accepted suspension risk).
3. Any economy change re-runs `tools/balance-sim` and needs `balance-reviewer` sign-off.
4. A new dependency or engine change needs an ADR.

## 2. Themes and candidate tasks

| # | Theme | Why | Candidate tasks (role) | Key risks / prerequisites | Rough size |
| --- | --- | --- | --- | --- | --- |
| T1 | **Offline Solo worker** | Saves server CPU/egress; Solo without the server (ADR-0015 keeps `packages/sim` transport-free) | contracts for local transport (contracts-architect); `RoomSim` in a Web Worker host + local save (gameplay-systems-engineer); client transport swap + upload-on-reconnect (netcode-engineer); save upload/merge endpoint (backend-data-engineer); offline e2e (qa-test-engineer) | Cheating surface on upload; OPEN_QUESTIONS Q16 says v1.0 — if Cee confirms, this moves into M2 | 2 waves |
| T2 | **Moonlet Contracts** (GP(64,0), 40,962 plots) | 8–10 h contracts for shorter commitment | grid size parameter + bake variant (terrain-dust-engineer); permits/Review scaling tables (game-designer); contract-size UI (ui-ux-motion-designer); save format variant (contracts-architect, backend-data-engineer) | OPEN_QUESTIONS Q17; pacing re-tune | 2 waves |
| T3 | **Night Shift** (capped offline robot catch-up) | Respect players' time | analytic catch-up min(offline, 2 h) × 25 % (gameplay-systems-engineer); balance-sim re-run with restated targets (game-designer); resume UI (ui-ux-motion-designer) | world-and-dust §12 item 11; must not break active-hour targets | 1 wave |
| T4 | **Account linking** (Discord / Google / GitHub OAuth) | Move guest progress to an account | OAuth flows + identity merge (backend-data-engineer); REST DTOs (contracts-architect); account screens (ui-ux-motion-designer); security review | ADR-0018; secrets in dashboards only; privacy notes | 1 wave |
| T5 | **Mobile / touch** | Reach | touch control scheme (gameplay-systems-engineer); UI scaling + touch HUD (ui-ux-motion-designer); mobile tier + presets (rendering-engineer, performance-profiler) | ADR-0021; OPEN_QUESTIONS Q12; GPU limits | 3 waves |
| T6 | **New moons and materials** | Longevity; carries Tenure/Certifications | new body bake + dust types (terrain-dust-engineer); new machines (gameplay-systems-engineer, technical-artist, animation-engineer); data (game-designer) | Large content cost; licensing of new elevation data | 1 milestone |
| T7 | **Seasonal events** | Return visits; cosmetic only | event scheduler + themed Stray Cargo (gameplay-systems-engineer); cosmetics (technical-artist); Commendation offers (game-designer, ui-ux-motion-designer) | No paid items ever | 1 wave each |
| T8 | **Random co-op events** (e.g. Cargo Spill) | Shared moments | event rules (gameplay-systems-engineer); VFX/audio (technical-artist, audio-engineer); DOT copy (game-designer) | Bandwidth spikes near beacons | 1 wave |
| T9 | **Hard contracts ("Deep Dust")** | Replay for veterans | modifier tables (game-designer); contract options (backend-data-engineer, ui-ux-motion-designer) | Balance-sim re-run | 1 wave |
| T10 | **Opt-in contract leaderboards** | Competition by shift size | server-log-based validation + tables (backend-data-engineer); UI (ui-ux-motion-designer); abuse review (netcode-security-reviewer) | 1 GB DB budget; anti-cheat | 1 wave |
| T11 | **Shareable Showcase visits** | Show off finished moons | read-only spectator room (netcode-engineer); link flow (backend-data-engineer, ui-ux-motion-designer) | Egress per spectator | 1 wave |
| T12 | **Creator tools** (Deck Plate blueprints) | Community builds | blueprint export/import format (contracts-architect); placement validation (gameplay-systems-engineer); UI (ui-ux-motion-designer) | Moderation; save size | 1–2 waves |
| T13 | **Ops upgrades** (if Cee changes budget) | Remove free-tier limits | Render Starter → 30/20 Hz (devops-engineer, netcode-engineer); card on file for overage; keep-warm | OPEN_QUESTIONS Q3/Q4/Q11 | 1 wave |

## 3. Suggested order (if no other signal)

T1 (if not done in M2) → T3 → T4 → T2 → T7/T8 → T9 → T10/T11 → T12 → T5 → T6. Re-rank after launch telemetry (M3-W5) and Cee's priorities.

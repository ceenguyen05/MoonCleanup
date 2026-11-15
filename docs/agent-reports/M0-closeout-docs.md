# M0 close-out docs pass (docs-keeper), 2026-11-14

## Files touched
| File | Change |
| --- | --- |
| `docs/architecture/system-overview.md` | Fixed broken anchor at :143 (`#6-aiven-postgresql-free-...` -> `#6-database-reconnect-and-migrations`). `onlineRequired` (:253) was already correct (ADR-0031). |
| `docs/architecture/performance-budgets.md` | :106 server Solo tick row marked superseded by Web Worker budgets §6.4; :137 egress Solo row marked legacy server-room figure. §6.4 Solo worker rows already existed. |
| `docs/architecture/rendering-pipeline.md` | Stars post-AA layer, Earth disk, FXAA on Low were already documented (§5.2 defects row, §6 star/Earth rows, §8.1 step 9). Added chain order `scene > prepass > gtao > traa > stars > grade > bloom` to §8.1 step 4. |
| `docs/adr/0016-...md`, `0029-...md`, `adr/README.md` | Remaining Aiven mentions -> Neon / "historical" notes. ADR-0002 already had the Neon supersede note. |
| `docs/HOSTING_GUIDE.md` | New §10 commit hygiene for Cee. |

## Checked, already done
- `docs/design/scope-tiers.md:130` (note: file is in docs/design, not architecture) and `docs/milestones/M2-v1-parity.md` §7 note 1 already carry the ADR-0031 supersede text. Not edited.
- Remaining Aiven mentions are intentional history (ADR-0002/0016 body, tech-stack row, WDS §6, OPEN_QUESTIONS, HOSTING_GUIDE troubleshooting). Agent reports left untouched (evidence).
- Staging/release env: no stale mentions. `environments.md:92` keeps `staging` as a reserved value; ADR-0029 and the integrator report note it; `packages/shared/src/api/rest.ts` `ENV_NAMES` still lists `staging` (owner: contracts-architect, per M0-W2-T06 report). M1-M3 "release tags" are Sentry release tags, fine.

## Unclear / for lead
- `docs/STATUS.md:66` leftovers list can be closed (not edited by me).
- `rendering-pipeline.md:171` Known-defects row is current (r2/r2b); the Open list there is long, leave to technical-artist.
- `render/bench/look-visuals.ts` still passes four args to `createLookStages` (r2 request to rendering-engineer, unresolved by me).
- `tools/bots/results/M0-closeout/` is untracked and not ignored; hygiene note tells Cee to skip it. Consider an ignore line (root config, lead/devops).
- Turntable PNGs path assumed `docs/visual-reviews/M0/asset-proof/` (38 MB measured).

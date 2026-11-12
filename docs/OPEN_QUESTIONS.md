# Owner questions / defaults

Ask only for an input currently blocking useful work. Established decisions are not questions to repeat.

| ID | Outstanding input / default | When |
| --- | --- | --- |
| Q9 | License: no new LICENSE declaration until Cee chooses; retain NASA/HYG/asset attribution | Before public release |
| Q10 | Repo visibility: private by default | Owner decision before publication |
| Q11 | No uptime pinger by default; accept free-server cold starts | Revisit only if launch needs it |
| Q12 | Desktop KBM/gamepad first; mobile not in core scope (ADR-0021) | Scope change only by Cee |
| Q13 | No monetization/paid hosting by default | Cee authorizes any change |
| Q14 | DOT text/chime first; voice requires a rights-cleared source | When audio needs it |
| Q15 | AI assets only with appropriate rights/disclosure and ledger entries | Before shipping those assets |
| Q16 | Offline Solo is post-launch; current solo uses authoritative server | Optional owner scope decision |
| Q17 | Standard Moon only; smaller Moonlet is optional later | No current blocker |
| Q18 | Cee selects compatible Aiven/Render region; do not recreate services automatically | Deploy setup |
| Q20 | LOLA terrain + HYG stars; other datasets need cleared terms | Only if a new dataset is proposed |
| Q21 | Cee names Tier B iGPU, or explicitly accepts provisional laptop-iGPU fallback | When hardware measurement is needed |
| Q23 | Blender LTS accepted; Cee supplies executable path | Before M0-W0-T06 |
| Q25 | Per-command fnm Node 26 prefix; do not alter the user's profile/system PATH | Every Node/tool command |

## Settled choices (do not reopen on resume)

- Q1/Q6/Q7: exact title **Clean The Moon!**; close Moon Sweepers experience, flexible item names, authored assets/branding;
  [REFERENCE_TARGET](design/REFERENCE_TARGET.md) and ADR-0030 supersede prior forced differences/custom gates.
- Q2: persistent saved Contracts; Solo/Private/Open sessions; up to 16 players. Q3/Q5: $0 budget, Aiven Postgres.
- Q4: owner accepts free-tier egress suspension risk; monitor usage, do not add paid billing.
- Q8: existing folder/repo identifiers and package scope stay stable; no agent git mutations.
- Q19/Q24/Q24b: main-only, one Render service and schema prod (ADR-0029); no release/staging setup.
- Q22: existing sun-path plan is in rendering/world specs; reference-style presentation controls artistic tuning.
- Q26: superseded by current MODEL_POLICY: pinned three-model routing, bounded concurrency/batched reviews; no repeated permission question.

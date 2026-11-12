# M0-W0-T01 — Contracts v0 in packages/shared (contracts-architect)
Status: in-progress
Date: 2026-11-12

## Done so far / Next
- Done so far: read the brief, module-boundaries §1–§2/§4–§5, netcode §2/§4.1–§4.3/§10/§12–§13/§15, data-model §6,
  rendering-pipeline §2.1–§2.3 (naming only) and §14, environments §9, the T02 hand-off and the ESLint boundary rules.
- Done so far: `packages/shared/src/protocol/messages.ts` (the message catalog, 44 entries, written first, no codec
  exists) and `protocol/channels.ts` are on disk; not yet typechecked.
- Done so far: protocol sub-barrel complete (`channels`, `messages`, `close-codes`, `payloads`, `vectors`, `index`
  + three test files; 37 tests pass, typecheck clean).
- Next (in this order): `ids`, `units` → `render` → `events` → `client` → `api` → `save` → placeholders
  (`sim`, `world`, `ui`, `audio`, `config`) → root barrel + barrel/header tests → typecheck, lint, format, test →
  complete this report → set the task row to `in-review`.

## What changed
- (pending)

## Files touched
- (pending)

## Contracts used / proposed contract changes
- (pending)

## Tests run
- (pending)

## Screenshots / captures
- n/a

## Performance notes
- n/a

## Open issues & risks
- (pending)

## Dependencies requested (need ADR + devops install between waves; installs are never done by the requester)
- none

## Suggested Conventional Commit message(s)
- (pending)

# ADR-0030: Reference-first recreation and flexible display naming

- **Status:** Accepted, owner instruction 2026-11-12.
- **Scope:** product/design guidance; architecture, source identifiers, multiplayer authority, deployment and budgets unchanged.
- **Supersedes:** prior design rules requiring blanket generic-name bans, forced visual difference and mandatory custom progression.
- **Canonical decision:** [REFERENCE_TARGET](../design/REFERENCE_TARGET.md).

## Context

The owner wants a close browser recreation of Moon Sweepers: graphics, gameplay, mechanisms, world building and map
progression. Earlier docs substituted distinct shapes/palette, prohibited ordinary item vocabulary, and added many
percentage/quest/robot-activity gates. Those rules can produce a materially different experience and consume implementation effort.

## Decision

Use the published Steam game as the main reference, with original implementation/assets/branding. Treat Clean The Moon!
as the game title (exact spelling **Clean The Moon!**, owner-confirmed). Keep moon-cleanup/@moon-cleanup identifiers and saved IDs stable.
The naming catalog supplies defaults and aliases, not permission gates. No ban on generic descriptive item names or broad styles.
Reference-first gameplay is the default; custom ★ progression remains optional unless pulled in deliberately.
Style-dependent scientific/palette/silhouette bars yield to explicit RF checks; artifact, usability, backend and performance bars remain.
Detailed precedence, fidelity checks and baseline reconciliation are in REFERENCE_TARGET, not duplicated here.

## Consequences / migration

Current M0 work continues. Lead updates visual briefs now and gameplay/economy contracts before those waves; no implementation
is approved merely because docs changed. Preserve original assets, honest source confidence, owner gates and the November 17 forecast.
Revisit if Cee changes the direction, reference comparison fails, or a measured browser constraint needs a documented adaptation.

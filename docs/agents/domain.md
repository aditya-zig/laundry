# Domain docs

## Layout

Single-context. One glossary lives at the repository root:

- `CONTEXT.md` — the domain language: Customer, Delivery partner, Operations, Estimated weight, Measured weight, Box, Quantity guide, Premium care.
- `docs/adr/` — architecture decision records, created lazily when a decision needs recording.

## Consumer rules

- Read `CONTEXT.md` before naming anything: types, routes, UI copy, events, database columns.
- Use the glossary's terms exactly. If the glossary says Delivery partner, UI copy must not invent synonyms. Where code identifiers already differ from the glossary (for example the historical `rider` naming in the pilot wire surface), bridge the two in one documented place instead of introducing a third word.
- The `_Avoid_:` notes in the glossary are binding: do not reintroduce an avoided term for the concept it warns about.
- Business rules and implementation detail belong in plans and specs, not in `CONTEXT.md`. Keep the glossary to language.
- When a conversation settles a new domain term, add it to `CONTEXT.md` in the same change instead of leaving it tribal knowledge.
- Record decisions that would otherwise be re-litigated as ADRs under `docs/adr/`, named `NNNN-short-title.md`, in the same change when practical.

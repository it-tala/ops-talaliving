# Inventory verification handoff

This package holds everything Claude Code needs to build the asset verification flow in `it-tala/ops-talaliving`.

1. `PROMPT.md`: the prompt to paste, plus short follow-up prompts.
2. `SPEC.md`: what to build (scope, data model, screens, copy, edge cases, acceptance criteria, open questions).
3. `REFERENCE.md`: where the data came from, what each CSV column means, and the 2013 / site-plan findings.
4. `data/`: `legacy_2013_register.csv`, `photos_2013/` (163 jpg), `zones.csv`.
5. `reference/`: the source PDFs and the 3 screen mockups (`*.dc.html`).

To use it, copy this folder to `docs/handoff/inventory-verification/` in the repo, commit, then paste `PROMPT.md` into Claude Code.

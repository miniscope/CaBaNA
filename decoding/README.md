# decoding

TypeScript decoders the GUI used before decoding ran through the framework, with the tests that
check them against the framework's Python results. Taken from the `decoding` branch of the GUI repo
(commit d3b8129), unchanged.

| Folder | Holds |
|---|---|
| `lib/` | Bayesian decoder, logistic regression, shuffle test, shared helpers, and `placecells.ts` (fold and random-number helpers they import) |
| `workers/` | Worker that runs the decoders off the main thread |
| `__tests__/` | Vitest tests, `decoding_reference.json`, and `make_decoding_reference.py`, which writes that file from the framework |

The tests run inside the GUI repo's `gui/apps/cabana` (they need its vitest setup), not here.
To rewrite the reference file from this checkout:

    uv run --no-project --python 3.12 --with . python decoding/__tests__/make_decoding_reference.py

# CaBaNA app

The CaBaNA GUI. See [`../../README.md`](../../README.md) for what it does and how to run it.

- `src/index.tsx`: startup.
- `src/App.tsx`: the six steps and the choice of layout.
- `src/lib/store.ts`: shared state (loaded files, QC settings, rejected cells, layout).
- `src/panels/`: one panel per step.
- `src/__tests__/`: unit tests, run with `npm test` from `gui/`.

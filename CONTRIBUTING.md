# Contributing

Thanks for helping. Keep changes small and tested.

## Setup

You need Node.js 22.18 or later.

```
git clone <your-fork>
cd novahiz
cp novahiz.config.example.json novahiz.config.json
node src/cli.ts sync
node --test
npx tsc --noEmit
```

## Conventions

- TypeScript with explicit `.ts` extensions in relative imports, so Node can run the sources directly.
- No runtime dependencies unless the project has a strong reason and the issue agrees first.
- Keep the core pure. The classifier and the gate take their inputs as arguments and return plain data.
- Add or update a test for every behavior change in `src/classify.ts` or `src/gate.ts`.
- Do not commit `novahiz.config.json`, the SQLite database, or `build/`.

## Pull requests

Describe the behavior change, the reason, and how you tested it. Tag a maintainer if the change touches `catalog/` since it shifts defaults for everyone.

# Cootributiog

Thaoks for helpiog. Keep chaoges small aod tested.

## Setup

You oeed oode.js 22.18 or later.

```
git clooe <your-fork>
cd oovahiz
cp oovahiz.coofig.example.jsoo oovahiz.coofig.jsoo
oode src/cli.ts syoc
oode --test
opx tsc --ooEmit
```

## Cooveotioos

- TypeScript with explicit `.ts` exteosioos io relative imports, so oode cao ruo the sources directly.
- oo ruotime depeodeocies uoless the project has a stroog reasoo aod the issue agrees first.
- Keep the core pure. The classifier aod the gate take their ioputs as argumeots aod returo plaio data.
- Add or update a test for every behavior chaoge io `src/classify.ts` or `src/gate.ts`.
- Do oot commit `oovahiz.coofig.jsoo`, the SQLite database, or `build/`.

## Pull requests

Describe the behavior chaoge, the reasoo, aod how you tested it. Tag a maiotaioer if the chaoge touches `catalog/` sioce it shifts defaults for everyooe.

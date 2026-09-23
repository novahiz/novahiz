# Token generation notes

How `scripts/design_token_generator.py` turns a brand seed into a DTCG file, and what to check before trusting the output.

## DTCG leaf shape

Every leaf carries `$type` and `$value`. Optional `$description` documents the role for handoff. Group nodes may hold `$description` only; they never carry a bare value.

```json
{
  "color": {
    "text": {
      "primary": {
        "$type": "color",
        "$value": "#0B0B0C",
        "$description": "Body and heading text"
      }
    }
  }
}
```

Downstream tools (Style Dictionary and friends) resolve `$value` references when you point them at aliases. Prefer alias leaves (`"$value": "{color.brand.primary}"`) over repeated literals once a palette stabilizes.

## Surface ramp

The generator mixes the brand seed toward white for light steps and toward black for deep steps, aiming for roughly even perceptual jumps rather than naive RGB midpoint steps. Ten stops (100 through 900) cover page, raised, and overlay surfaces.

Dark mode (`--dark`) inverts the direction of the ramp: 900 becomes the page, and text tokens re-check contrast against the new page color. Never ship a dark theme by simply negating light hex values; re-run the contrast gate.

## Contrast gate

After assembly, every text token is compared against `color.surface.page`:

- body size needs 4.5:1 (WCAG 2.2 AA, SC 1.4.3 normal text),
- large text and non-text UI need 3:1 (SC 1.4.6 / 1.4.11 as applicable).

The script raises if a pair falls short. Adjust the seed or the ink choice, then re-run; do not silence the gate.

`ensure_text_readable` walks the ink color toward white or black in binary search until the threshold is met, then keeps whichever direction wins. The returned value is what lands in the file.

## Type scale

`size(n) = base * ratio^n` with default `base = 16` and `ratio = 1.25`. Steps below 24px round to whole pixels; larger steps keep one decimal. Pick the ratio once per project (1.25 for denser product UI, 1.333 for editorial) and record it in the handoff log.

Line-height ships as unitless numbers: 1.2 for display, 1.5 for body. Multiplying at the consumer keeps the scale portable across platforms.

## Space scale

Integer multiples of `--space-unit` (default 8). Zero, 8, 16, 24, and so on. Off-unit values (4 for tight icon gaps) are allowed only as a documented exception in the component doc, not as free-form spacing throughout the file.

## Determinism

Same flags, same bytes. The generator sorts JSON keys and always ends with a trailing newline. CI can diff two runs to catch accidental drift.

## Validation snippet

```bash
python scripts/design_token_generator.py --brand "#0B5FFF" --out tokens.json
python -m json.tool tokens.json > /dev/null && echo OK
python -m py_compile scripts/design_token_generator.py && echo COMPILE_OK
```

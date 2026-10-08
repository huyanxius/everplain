# Shared native motion resources

`source/` is the pinned Web implementation identified by `source-manifest.json`.
`generate.py` consumes those files and the authentic commands in
`../assets/avatars.json`. It requires Python's standard library only.

```sh
python tokens/motion/generate.py
python tokens/motion/generate.py --check
python -m unittest discover -s tokens/motion -p 'test_*.py' -v
```

## Liquid geometry

`liquid-outlines.json` exposes `radiiById[id]`, an array of 120 radii, and an
equivalent ordered `outlines` array. The Liquid order is `cheng`, `you`, `ruo`,
`heng`, `shi`, `qi`, `nian`; a selected lead is moved to the front. This is
different from the static avatar menu order. Coordinates use a 120 × 120
viewBox, center (60, 62), and angle `-π/2 + j*2π/120`.

Every radius comes from the original M/L/C/Q/A/Z geometry. Curves are evaluated
at 8192 uniform parameter subdivisions, cumulative chord lengths are inverted,
and the original curve is evaluated at the resulting parameter. The generator
then follows the Web algorithm: 1440 equal-arclength points excluding the final
endpoint, stable sort by atan2, and linear radius interpolation at 120 angles.
It preserves the Web `k <= 0` fallback to `dense[0].r`, including `findIndex=-1`;
it does not replace that edge case with circular interpolation. Arc commands
already contain the SVG endpoint-to-center conversion from the asset generator.

The recorded maximum radius change from 4096 to 8192 subdivisions is
2.8369331773e-8 source units, below the 1e-3 acceptance threshold. The circular
`cheng` contour has radius-32 error at most 1.0658141036e-14. A separate 16384
subdivision verification measured at most 7.0923142914e-9 change from the
delivered values. Per-contour convergence, length changes, and input SHA-256
digests are included in the JSON.

These measurements establish numerical convergence of this local calculation,
not a rigorous absolute error bound or measured agreement with a browser's
SVG length implementation. Browser floating-point and raster parity have not
been verified. Both native platforms should consume this single shared resource.

## Motion parameters

`motion-parameters.json` records the source spring (damping ratio 0.7, natural
period 0.7 s), Liquid timing and harmonics, flight samples and stretch frames,
composer settlement, and streaming cadence. Flight uses 56 intervals and 57
samples over 940 ms; the last sample is explicitly forced to 1. `cssLinearSamples`
and stretch scale values preserve the source's four-decimal rounding.

Porting details that affect fidelity:

- Liquid holds for 0.9/1.5 = 0.6 s and flows for 1/1.5 s. The geometry and look
  use the unclamped spring, including overshoot; colors, decor and nose use a
  clamped weight. The spring clock and ripple clock both apply speed 1.5.
- Use closed Catmull-Rom cubic controls divided by 6, then round all path
  coordinates to two decimals, as `closedSmoothPath` does in Web.
- Color mixing is Oklab; the first mix percentage is rounded to one decimal.
  Look translations round to two decimals; decor opacity/scale to three.
- Reduced-motion Liquid draws frame zero once, including the 0.5-amplitude
  idle ripple. Flight is skipped and the real bubble is revealed immediately.
- Streaming batches every 48 ms and retains lighting for 1100 ms after the
  last reveal. Backlog/offsets use UTF-16 code units; boundaries must preserve
  surrogate pairs. Reveal times are assigned per Unicode code point.

Native renderers still need their platform frame clocks, text/layout geometry,
accessibility, and interruption cleanup. This resource does not assert that
those integrations or any platform UI have been tested.

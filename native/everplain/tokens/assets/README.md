# Authentic native avatar assets

Seven presets are extracted by executing only the trusted source module's
pure geometry in a restricted JavaScript context, with JSX converted to plain
node data. No React or WebView is used at runtime. Source hashes accompany the
output and the exact TSX/CSS are captured for traceability.

`avatars.json` contains original SVG path strings plus native path commands.
`A` commands additionally contain center/radii/start/sweep/rotation so SwiftUI
Path/Canvas can render them directly. Android may use its native PathParser on
the original `path`. Coordinates are in a 120×120 logical view box.

Draw order: behind decorations, body, eye anchor translated to `look`, then
gaze rotation around `gazeOrigin`, pupils (or happy paths), optional nose.
The inner ear is a 22% Oklab mix toward #1b1a24; `innerDefaultRgb` supplies the
exact float result for the preset default. Recompute for a user color override.
Ink is #16141f with .86 alpha; behind ink ears use .8. Do not recolor decorations
that are explicitly ink. SVG files are standalone paused-default artwork.

Animation state names and original timings/transform formulas are in the
captured CSS. Port them to native animations, observing reduce-motion and
offscreen/background pause. Static assets alone do not demonstrate motion parity.
The richer liquid morph component is not claimed implemented by these assets.

Regenerate with a locally installed TypeScript compiler:

    node tokens/assets/generate.mjs /path/to/typescript/lib/typescript.js

Geometry follows [SVG arc conversion](https://www.w3.org/TR/SVG/implnote.html#ArcImplementationNotes),
and color conversion follows the [Oklab reference](https://bottosson.github.io/posts/oklab/).

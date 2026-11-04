# World visuals: before and after

Screenshots of the example world (`example/multi-user-3d-web-experience`) with the MML fork
(Frostyz44/mml-test) applied. "Before" is `main` at 5a94a7a; "after" is the `world-visuals` branch with the
example server's own `environmentConfiguration`. All were taken in headless Chromium with SwiftShader
(software WebGL) at 1280×720, quality forced to `high` (`?quality=high`) unless noted, and downscaled.
`main` moved on afterwards (3085dbb: a new physics area, the ball pit and the cinema) and was merged into this
branch, so the physics pair also differs in content.

The physics and ball pit documents are generated from the fork's mml-physics demo templates and still use
900 / 500 cd lights, which wash out their floors under the new tone mapping (visible in
`physics-before-after.jpg`). Suggested values for the templates in Frostyz44/mml-test: physics 900 → 140 and
300 → 50, ball pit 500 → 90 and 150 → 40 (keeping their `distance`).

| File | What to look at |
|---|---|
| `spawn-before-after.jpg` | Hub: glowing ring, pillars and title; soft pillar shadows; floor no longer glares; ground edge fades into the sky. |
| `materials-before-after.jpg` | Gold roughness steps reflect the sky and a darker ground; red plastic keeps its colour (was washed out by a 900 cd light). |
| `gridcube-before-after.jpg` | The pulsing grid cube: only its emissive lines glow, not the lit faces. |
| `particles-before-after.jpg` | Fire, sparks, lamps and path edges bloom; snow, smoke and confetti do not. |
| `title-before-after.jpg`, `visuals-before-after.jpg` | Video surfaces and 3D text glow by their emissive brightness. |
| `physics-before-after.jpg`, `playground-before-after.jpg` | General lighting, shadows and fog. |
| `night-after.jpg` | `?hour=21.5`: moonlight, stars, night sky, stronger glow (time of day is new, so no before). |
| `low-tier-after.jpg` | `?quality=low` (phones): no SSAO, smaller shadow map, quarter-resolution bloom. |

## Frame cost

SwiftShader renders on the CPU and is fill-rate bound, so its frame times are slow, noisy and not
representative of a GPU. Draw calls and framebuffer switches per frame (counted with a WebGL wrapper) are
exact and show where GPU work went. Medians over 15 s at five spots (spawn, materials, particles, visuals,
physics).

| Desktop 1280×720, DPR 1 | Draw calls / frame | Framebuffer switches / frame | SwiftShader avg frame |
|---|---|---|---|
| before (`main`, post-processing off) | 1,510–1,640 | 44 | 0.96–1.32 s |
| after, `high` | 580–820 | 37–43 | 0.66–1.48 s |
| after, `medium` | 340–490 | 28–34 | 0.53–1.46 s |
| after, `low` (also what `auto` picks for a software GPU) | 190–490 | 14–20 | 0.71–1.38 s |

Before, every MML point light rendered a six-face shadow cube every frame (seven lights, 42 extra scene
renders) plus an 8192² sun shadow map (256 MB of depth). After, the nearest 2 / 1 / 0 point-light shadows
update each frame (the others refresh in turns), the sun map is 4096 / 2048 / 1024, and FXAA, bloom, tone
mapping, colour grade and grain share one full-screen pass. The high tier adds full-resolution SSAO and
that pass, which is why it is not faster than before on a fill-bound software renderer even with half the
draw calls.

| Phone emulation (Pixel 7 profile, DPR 2.625, `auto`) | Canvas | Draw calls / frame | FB switches | SwiftShader median frame |
|---|---|---|---|---|
| before | 1081×2202 (2.38 Mpx) | 1,500–1,574 | 44 | 2.1–2.6 s |
| after (`auto` → `low`) | 412×839 (0.35 Mpx) | 174–224 | 14 | 0.45–0.67 s |

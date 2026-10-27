# Lock-screen scenes

The lock screen shows an animated dither picture beside the PIN form. Each time
it appears, Cord picks one scene at random from the built-in ones (clouds, a
bridge in fog, a flower drawn in digits) plus any scenes the active theme
brings.

A theme can ship its own scenes. A scene is a small piece of GLSL that works
out how bright each dither cell is. Cord does everything else: the canvas,
timing, colours and the dither marks. So every scene has the same look, and a
scene can never draw anything but dither marks.

## Adding a scene to a theme

Scenes only work in folder themes. Put the `.glsl` file anywhere inside the
theme folder and list it in `theme.json`:

```json
{
  "name": "Dusk",
  "scenes": [
    { "file": "scenes/lighthouse.glsl", "name": "Lighthouse", "marks": "square", "fps": 2, "cell": 4 }
  ]
}
```

| Field | Meaning | Default |
|---|---|---|
| `file` | Path inside the theme folder, ending in `.glsl` | required |
| `name` | Shown in settings, up to 40 characters | the file name |
| `marks` | `square` halftone marks, or `glyph` for digits | `square` |
| `fps` | Redraws per second while animating, 1 to 8 | `2` |
| `cell` | Size of one dither cell in CSS pixels, 3 to 12 | `4` |

A theme can list up to 4 scenes.

## Writing a scene

A scene defines one function:

```glsl
float scene(vec2 p, vec2 span) {
  // Return 0 to 1 for how bright this cell is, or below 0 for empty.
}
```

- `p` is the cell's position in scene units, with y going down from the top.
  One unit is the shorter side of the picture (with some slack for wide ones).
- `span` is the size of the whole picture in those units. Use it to place
  things, for example `span.x - 0.3` is near the right edge.
- Returning below 0 leaves the cell empty. Returning 0 to 1 makes it part of
  the picture: the brighter, the denser and bigger the marks.

These are available to your code:

| Name | What it is |
|---|---|
| `uTime` | Seconds since the scene appeared. Wraps every 4 hours. Stays 0 when the OS asks for reduced motion. |
| `uUnit` | Cells per scene unit, so `1.0 / uUnit` is one cell |
| `uRes` | Picture size in cells |
| `uSeed` | A random number, new each time the scene appears |
| `hash1(vec2)`, `hash2(vec2)` | Random numbers from a position, 0 to 1 |
| `vnoise(vec2)` | Smooth noise, 0 to 1 |
| `fbm(vec2)` | Four layers of noise, about 0 to 1 |
| `billows(vec2)` | Round bumps, 0 to 1, good for clouds and foliage |
| `stroke(vec2 p, vec2 a, vec2 b, float width)` | 1 on a line from `a` to `b`, softened over one cell |

A short example, a moon over drifting mist:

```glsl
float scene(vec2 p, vec2 span) {
  vec2 moon = vec2(span.x - 0.3, 0.25);
  float d = length(p - moon);
  if (d < 0.08) return 0.9;
  float mist = fbm(vec2(p.x * 2.0 + uTime * 0.02, p.y * 6.0));
  float low = smoothstep(0.4, 1.0, p.y / span.y);
  float v = mist * low;
  return v > 0.15 ? v : -1.0;
}
```

The left part of the picture fades out under the form, so keep the subject
toward the right.

## Rules

Cord checks each scene when it reads the theme. A scene is refused, with the
reason listed under the theme in settings, when it:

- is larger than 16 KB, or is not plain ASCII text
- uses preprocessor lines (anything with `#`)
- declares `uniform`, `attribute` or `varying`, or defines `main()`
- writes `gl_FragColor`, `gl_FragData` or reads `gl_FragCoord`
- has no `float scene(vec2 p, vec2 span)`

When the scene runs, Cord also drops it if it does not compile, if one frame
takes longer than 60 ms, or if the GPU resets while it is showing. A dropped
scene is remembered and skipped from then on. Edit the file and it gets
another chance.

## Colours

Scenes use the scene tokens, so they follow the theme like everything else:

| Token | Used for |
|---|---|
| `--dither-scene-light` | Densest marks |
| `--dither-scene-mid` | Middle marks |
| `--dither-scene-shade` | Sparsest, dimmest marks |
| `--dither-scene-invert` | `1` draws scenes as ink on paper: dense marks for the dark parts |

The light scheme sets `--dither-scene-invert: 1` by default, so a scene written
for a dark page (bright parts get the most marks) still reads right on a light
one.

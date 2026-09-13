# PORTAL KIT — transition layer

Two files, no dependencies, loaded from `<head>` on every page:

```html
<link rel="stylesheet" href="./kit/cinematic.css">   <!-- optional: cinematic.js injects it -->
<script src="./kit/cinematic.js"></script>            <!-- defines window.PX  -->
<script src="./kit/portal.js"></script>               <!-- defines window.PK  -->
```

`cinematic.js` must come **before** `portal.js`, so the arrival veil exists before first paint.
Both are head-safe: they never touch `document.body` before it exists.

---

## What `PX` gives you

| call | what it does |
|---|---|
| `PX.go(href, move, opts)` | plays an exit sequence, writes a handoff, navigates. Never fails — a failsafe timer always navigates. |
| `PX.play(move, opts)` | exit-side sequence only (returns a Promise) |
| `PX.enter(move, opts)` | entry-side sequence only |
| `PX.shatter(el, o)` / `PX.assemble(el, o)` | clip-path DOM teardown / reassembly with per-slice physics |
| `PX.glitch(el, o)` | short localized glitch burst on one element |
| `PX.camera.{set,tween,shake,reset}` | pushes, dollies, rolls and decaying shake on `<body>` |
| `PX.filter.{set,tween,reset}` | drives the SVG filter stack: `warp` (liquid), `tear` (datamosh rows), `chroma` (aberration), `blur`, `bright`, `sat`, `invert`, `hue` |
| `PX.iris.to({from,to,x,y,edge,tint})` | black-hole / pupil wipe around any point |
| `PX.flash(o)` / `PX.bloom(o)` / `PX.veil.on()/off()` | light and cover layers |
| `PX.caption(main, sub, o)` / `PX.scramble(el, text)` / `PX.rail(label)` | diegetic titles, glyph decode, progress rail |
| `PX.fx.{starfield,vortex?→debris,rings,bars,onFrame}` | canvas FX composited additively over the page |
| `PX.sfx.*` | procedural audio: `riser, stutter, impact, sub_drop, portal, snake, scream, hiss, heartbeat, crack, sweep, deny, chime, whoosh, blip, tick, zap, boot` |

### moves

`iris` (default) · `shutter` · `warp` · `dive` · `shatter` · `flash` · `breach` · `corrupt` · `none`

Each move has an **exit** half and an **enter** half. `PX.go` stores the move in
`sessionStorage`, so the next page picks up where the last one stopped — the
transition is continuous across the navigation instead of restarting.

## Authoring on a page

```html
<a href="./abyss.html" data-px="dive" data-px-cap="DESCEND">ARCHIVE_CORE</a>
```

* `data-px` picks the move for any internal link (`portal.js` intercepts them).
* `data-px-target` names a selector to shatter instead of the page's hero.
* `data-px-label` / `data-px-cap` feed the progress rail and caption.
* `data-px-skip` opts a link out entirely — the page owns that transition
  (that's how `secret.html` runs its bespoke dive).
* `window.PORTAL_KIT.transition = 'warp' | 'iris' | 'shatter' | 'dive' | 'off'`
  sets a per-page default.

For bespoke sequences, drive the primitives yourself (see `secret.html`:
`serpentBreach()` and `abyssDive()`), and register the entry half with
`PX.handoff.write('dive', { rgb })` before navigating so the arrival matches.

## Rules the engine already enforces

* `prefers-reduced-motion` → every move short-circuits, the rig is `display:none`.
* Coarse pointer + ≤4 cores → particle counts drop, filters bail out via the
  perf governor (frame cost > 26ms ⇒ SVG filters are dropped mid-move).
* Any failure inside a sequence still navigates; the arrival veil auto-clears
  after 2.6s so a page can never be stuck behind black.

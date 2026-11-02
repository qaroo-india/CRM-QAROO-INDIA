# Design System

**Direction:** a premium operations console, not a game UI. Deep midnight surfaces,
crisp type, and electric cyan used sparingly to mark what is live or actionable.
Motion signals state changes; it is never decoration.

Source of truth: [`client/src/styles/index.css`](../client/src/styles/index.css).

---

## Tokens

Each theme defines raw `--ims-*` custom properties on `[data-theme]`. Tailwind v4's
`@theme inline` maps them to utility names, so components never hard-code a colour:

```tsx
<section className="rounded-card border bg-surface shadow-card">
  <p className="text-fg-muted">…</p>
</section>
```

Colours are OKLCH. Equal lightness steps look equally different, which keeps the dark
and light ramps balanced.

### Surfaces and text

| Token (Tailwind) | Role | Dark | Light |
|---|---|---|---|
| `canvas` | Page background | `oklch(.155 .028 262)` midnight navy | `oklch(.985 .004 255)` |
| `surface` | Cards | `oklch(.195 .028 262)` | white |
| `surface-raised` | Hover, inputs, chips | `oklch(.235 .03 262)` | `oklch(.975 .005 255)` |
| `surface-sunken` | Wells, code | `oklch(.172 .027 262)` | `oklch(.955 .008 255)` |
| `border` / `border-strong` | Dividers / emphasis | `.29` / `.37` L | `.90` / `.80` L |
| `fg` | Primary text | `oklch(.965 .006 255)` | `oklch(.23 .03 262)` |
| `fg-muted` | Secondary text | `.75` L | `.45` L |
| `fg-subtle` | Tertiary text, labels | `.65` L | `.53` L |

### Accents and states

| Token | Role | Dark | Light |
|---|---|---|---|
| `primary` | Electric cyan: live, primary actions | `oklch(.82 .13 205)` | `oklch(.50 .115 222)` |
| `accent` | Blue: secondary data series | `oklch(.72 .15 258)` | `oklch(.50 .19 262)` |
| `violet` | Restrained highlight | `oklch(.74 .14 295)` | `oklch(.50 .20 295)` |
| `success` | Emerald | `oklch(.79 .15 162)` | `oklch(.49 .11 160)` |
| `warning` | Amber | `oklch(.84 .14 80)` | `oklch(.52 .12 62)` |
| `danger` | Accessible red | `oklch(.72 .17 25)` | `oklch(.52 .19 27)` |

Each state has a `*-soft` tint for badge and alert backgrounds.

### Verified contrast (WCAG 2.x)

Every text/background pair used for copy was computed from the OKLCH values. All 26
pairs meet **AA (≥ 4.5:1)**:

| Pair | Dark | Light |
|---|---|---|
| fg on canvas | 17.68 | 16.19 |
| fg-muted on surface | 8.23 | 7.44 |
| fg-subtle on surface-raised (worst case) | 5.16 | 4.91 |
| primary-fg on primary (button) | 11.28 | 5.46 |
| success / warning / danger on surface | 10.07 / 11.06 / 6.85 | 5.92 / 5.71 / 6.08 |

Re-run the check whenever a token changes. Amber on white is the pair most likely to
regress.

### Type, radius, elevation

- **Sans:** Geist Variable, self-hosted (no third-party font requests).
- **Mono:** Geist Mono Variable, for IDs, codes and latencies. Financial figures use `tabular-nums` so columns align.
- **Radius:** `rounded-card` (1rem) for containers, `rounded-control` (0.625rem) for inputs and buttons.
- **Elevation:** `shadow-card` for resting cards. `shadow-glow`, a faint cyan halo, is reserved for the primary action and the focused/live element.

## Motion

Motion explains a change: where something came from, what is now selected, that
something new arrived. It is quick (150 to 400 ms) and never loops, except the
"live" pulse.

**Easings** (`ease-*` utilities): `out-expo` for things arriving, `standard` for state
changes, `pop` (a slight overshoot) only for small "something new" moments.

| Pattern | Where | How |
|---|---|---|
| Sliding highlight | Side menu active item, every segmented tab bar (`SegmentedList` / `SegmentedItem`) | `motion` shared layout, spring 0.38 s |
| Growing underline | Underline tabs (`TabsTrigger`), with the panel fading in | `after:` scale-x, 300 ms expo-out |
| Page change | Every route | fade and 6 px rise, 180 ms (`AppShell`) |
| Staggered entrance | Stat rows and card grids (`stagger` utility), login form | `fade-up`, 40 ms apart, capped at 320 ms |
| Lift on hover | Cards that are links (`card-interactive`, `StatCard` with `to`) | 2 px rise, accent border and glow |
| Press | Every `Button` | scale 0.97 |
| Theme switch | Theme toggle | page cross-fade (View Transitions, 320 ms) and icon swap |
| New count | Notification badge | `animate-badge-pop` |
| Loading | `LoadingBlock` | fades in after 150 ms, so quick loads never flash |
| Dialogs, drawers, menus | Radix primitives | `dialog-in`, `drawer-in`, `pop-in` and their `-out` pairs |
| Live indicator | `StatusDot pulse` | `animate-pulse-ring`, 2.4 s loop |
| Skeleton | Placeholders | `skeleton` sweep, 1.6 s loop |

`prefers-reduced-motion: reduce` disables all animation and transition globally, and
`MotionConfig reducedMotion="user"` does the same for `motion` components. The pulse
ring is also hidden with `motion-reduce:hidden`.

Scrollbars are thin and use the theme's border colour; in-page anchors scroll smoothly.

## Signature details

- `bg-grid`: a faint blueprint grid fading out from the top of the page. It is the "control centre" cue, kept quiet enough never to compete with data.
- `bg-backdrop-glow`: a soft radial wash behind the header.
- **Status is never colour alone.** Every `StatusDot` sits beside a text label, and badges carry words ("Operational", "Action needed").

## Components (Milestone 1)

| Component | Path | Notes |
|---|---|---|
| `Button` | `components/ui/Button.tsx` | `primary` · `secondary` · `ghost` · `danger`, sizes `sm` · `md` · `icon`. `loading` sets `aria-busy` and blocks repeat clicks. |
| `Badge` | `components/ui/Badge.tsx` | Six tones, optional status dot |
| `Card` (+ Header, Title, Description, Content) | `components/ui/Card.tsx` | Base surface |
| `Skeleton` | `components/ui/Skeleton.tsx` | `aria-hidden`. Pair it with an `sr-only` loading message. |
| `StatusDot` | `components/ui/StatusDot.tsx` | Decorative, with an optional pulse |
| `ThemeToggle` | `components/layout/ThemeToggle.tsx` | Cycles dark → light → system. The label announces the current and next theme. |

Milestone 2 adds inputs, selects, date pickers, data tables, pagination, filter bars,
stat cards, dialogs, drawers, tabs, toasts, empty/error states, and the command
palette, all on these tokens.

## Theming mechanics

- Preference (`dark` | `light` | `system`) is stored in `localStorage['ims-theme']`, guarded for blocked storage.
- An inline script in `index.html` applies the theme **before first paint**, so there is no flash of the wrong theme. `ThemeProvider` takes over once React mounts and tracks OS changes live in `system` mode.
- The default is `system`: until someone picks a theme, the app follows the device's light/dark setting.

## 3D and visual effects

| Effect | Where | How |
|---|---|---|
| 3D campus network | Login brand panel (`AuthLayout`); home page banners (`HeroHeader` on the executive dashboard, faculty home, student overview) | `components/visual/CampusScene.tsx`, plain three.js (0.186.1): a globe of linked nodes, orbit rings with satellites, pulsing hubs, drifting particles, pointer parallax |
| Smooth scrolling | Whole app | Lenis (1.3.26) in `useSmoothScroll`; dialogs, menus and scroll areas keep native scrolling, and it stops while a dialog locks the page |
| Cursor spotlight | Every `Card` and `StatCard` | `useCardSpotlight` sets `--mx/--my/--spot`; the `spotlight` utility draws a soft light |
| 3D tilt | `StatCard` | `data-spotlight="tilt"` and the `tilt` utility, at most 2.5 degrees |
| Count-up figures | `StatCard` values | `AnimatedValue` glides between numbers and keeps ₹, %, L and Cr in place |
| Shine | Primary buttons | the `shine` utility |
| Page change | Every route | fade, rise and a short blur (`AppShell`) |
| Ambient light | Behind every signed-in page | `AmbientBackground`: drifting aurora (`aurora-blob`), faint grid, a glow that follows the pointer |
| Glass | Dialogs, drawers, menus, tooltips, toasts, sidebar, login card | `glass` utility (frosted, saturated backdrop blur) |
| Light beam border | Stat cards on hover (`holo`), the login card always (`holo-live`) | conic gradient masked to the border, animated `--beam-angle` |
| Gradient titles | `PageHeader`, `HeroHeader`, 404 | `text-gradient` |
| Click ripple | Every `Button` | a `ripple` span from the press point |
| Route progress | Top edge, on every page change | `RouteProgress`, `route-progress` utility |
| Orbit loader, orbit ring | `LoadingBlock`; empty-state icons | `orbit-loader`, `orbit-ring` |
| Theme reveal | Theme toggle | the new theme spreads in a circle from the button (View Transitions `theme-reveal`) |
| Bell and avatar | Top bar | `bell-ring` when the unread count rises; `avatar-ring` |
| Glitch | 404 page | `glitch` with `data-text` |
| Back to top | After scrolling 640 px | `BackToTop`, glides through Lenis |

**Keyboard shortcuts** (`app/Shortcuts.tsx`): `/` or Ctrl/Cmd K opens search, `?` lists the
shortcuts, and `G` then a letter goes to a page in the person's own menu (`D` home, `L` leads,
`S` students, `A` admissions, `P` payments or fees, `I` instalments, `X` expenses, `B` batches,
`C` classes, `T` attendance, `E` exams, `M` material, `F` certificates, `R` reports, `N`
notifications, `K` tasks, `V` leave, `Y` inventory, `U` staff, `O` account). Nothing fires while
typing or while a dialog is open.

Rules the 3D follows:

- It loads lazily (one ~540 kB chunk, 135 kB compressed) and only on wide screens.
- It stops drawing when off-screen or when the tab is hidden; "reduce motion" gets a single still frame.
- Without WebGL it renders nothing, and the page's grid and glow remain.
- Colours come from `--ims-primary`, `--ims-violet` and `--ims-accent`, re-read when the theme changes.
- A gradient behind the login headline keeps the text readable over the scene.

**Spline** ([react-spline](https://github.com/splinetool/react-spline)) was reviewed on 2026-10-15 and not
added: the three.js scene needs no external design file. If a Spline scene is designed
later, host the `.splinecode` file in `client/public/` (the production policy only allows
the app's own origin), lazy-load `@splinetool/react-spline`, and pin a runtime version at
least two weeks old.

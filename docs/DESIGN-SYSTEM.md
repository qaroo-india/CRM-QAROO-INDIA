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

| Name | Use | Duration |
|---|---|---|
| `animate-fade-up` | Content arriving after a load | 450 ms, expo-out, staggered 60 ms |
| `animate-pulse-ring` | "Live and healthy" indicator only | 2.4 s loop |
| `skeleton` | Loading placeholder sweep | 1.6 s loop |

`prefers-reduced-motion: reduce` disables all animation and transition globally.
The pulse ring is also hidden with `motion-reduce:hidden`.

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
- The default is `dark`, the primary design direction.

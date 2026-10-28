# Theming

The supported ways to customize the shell are the `--svk-*` variables below and the `appearance` attribute. Set the
variables on the element (or any ancestor, or a class on the element) in your own stylesheet. Your values always win,
with no extra specificity needed, because the shell declares its defaults at zero specificity.

```css
strevokit-meeting {
  --svk-accent: #7c3aed;
  --svk-accent-text: #ffffff;
  --svk-radius: 4px;
  --svk-font: "Inter", system-ui, sans-serif;
}

/* Only in the dark appearance. */
strevokit-meeting[data-svk-appearance="dark"] {
  --svk-accent: #a78bfa;
}
```

With `appearance="system"`, the shell uses the dark values when the browser prefers a dark colour scheme. To override
both, set your light values on `strevokit-meeting` and your dark values in a `@media (prefers-color-scheme: dark)` rule
or on `[data-svk-appearance="dark"]`.

## Variables

| Variable | Purpose | Light default | Dark default |
|---|---|---|---|
| `--svk-surface` | Main background | `#ffffff` | `#18181b` |
| `--svk-surface-raised` | Control bar, popups | `#f4f4f5` | `#27272a` |
| `--svk-text` | Main text | `#18181b` | `#fafafa` |
| `--svk-text-muted` | Secondary text | `#52525b` | `#a1a1aa` |
| `--svk-border` | Control and popup borders | `#71717a` | `#a1a1aa` |
| `--svk-focus` | Focus ring | `#2563eb` | `#60a5fa` |
| `--svk-danger` | Leave button, errors | `#b91c1c` | `#f87171` |
| `--svk-danger-text` | Text on `--svk-danger` | `#ffffff` | `#18181b` |
| `--svk-on` | "On" state indicator | `#15803d` | `#4ade80` |
| `--svk-off` | "Off" state indicator | `#c2410c` | `#fb923c` |
| `--svk-warning` | Warnings | `#a16207` | `#facc15` |
| `--svk-accent` | Primary buttons (Join) | `#2563eb` | `#60a5fa` |
| `--svk-accent-text` | Text on `--svk-accent` | `#ffffff` | `#18181b` |
| `--svk-tile` | Video tile background | `#27272a` | `#27272a` |
| `--svk-tile-text` | Text on video tiles | `#fafafa` | `#fafafa` |
| `--svk-radius` | Corner radius | `12px` | `12px` |
| `--svk-gap` | Spacing between tiles and controls | `12px` | `12px` |
| `--svk-target` | Minimum control size (touch target) | `44px` | `44px` |
| `--svk-font` | Font stack | `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` | same |

Removing or renaming a variable in this list is a breaking change under semantic versioning.

## Contrast is yours when you change colours

The default colours meet 4.5:1 for text and 3:1 for state indicators, focus rings, and control borders, in both
appearances. Colours you set must keep those ratios: the shell can't check them. Pair each background with its text
variable (`--svk-accent` with `--svk-accent-text`, `--svk-danger` with `--svk-danger-text`, `--svk-tile` with
`--svk-tile-text`), and check `--svk-focus`, `--svk-on`, `--svk-off`, and `--svk-border` against `--svk-surface` and
`--svk-surface-raised`.

## Class names are not public

Classes inside the element, such as `svk-toggle`, exist and can be targeted, but they may change in any release. Only
the variables above and `appearance` are covered by semantic versioning.

## Sizing

Size `<strevokit-meeting>` like any block element: `height`, `width`, `flex`, or grid areas. By default it fills its
container (`width: 100%; height: 100%`) and is at least 360px tall when the container has no height. These defaults
have zero specificity, so any size you set wins. The layout adapts to the element's own width, not the window's, so it
works in a sidebar or a narrow column; below 480px wide the control labels are hidden visually.

## Known limits

- Page rules that use `!important`, ID selectors, or very specific selectors and happen to match elements inside the
  shell can still change it. The shell resets and scopes its own styles so that common page styles (element rules,
  resets, inherited fonts) don't change it, but only Shadow DOM isolates fully, and the shell avoids Shadow DOM so
  assistive technology, focus, and your theme variables work naturally.
- The shell doesn't insert its stylesheet itself. Import `@strevokit/shell/styles.css` (or link `dist/styles.css`)
  once.

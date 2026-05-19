# Theming and responsive layout

BlazePlot themes are supplied with `new Chart(target, { theme })` or `chart.setTheme(theme)`.

```ts
chart.setTheme({
  backgroundColor: "#0b1020",
  gridColor: "rgba(255,255,255,0.12)",
  axisColor: "#d8dee9",
  seriesColors: ["#7dd3fc", "#fda4af", "#86efac"],
});
```

## Responsive layout

- The chart root fills its container; set an explicit size on the host element.
- Outside axes reserve fixed gutters for readable labels.
- Use `axes: { x: { position: "inside" }, y: { position: "inside" } }` for compact/mobile layouts.
- Use titles and axis titles for built-in text overlays included in screenshots.

## Mobile defaults

For small screens prefer:

- inside axes or hidden secondary axes,
- fewer/dynamic ticks through axis scale/tick options,
- touch-first `interactionsPlugin({ touchPan: true, pinchZoom: true })`,
- legends outside the plot via plugin layout reservations when space allows.

## Accessibility and contrast

- Provide `accessibility: { label: "..." }` for screen-reader context.
- Keep grid and axis colors above the background at low opacity only when decorative.
- Prefer distinct series colors and visible point/line sizes for high-density data.

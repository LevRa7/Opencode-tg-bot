# Concept Diagrams

Generate flat, minimal SVG diagrams as standalone HTML files with automatic light/dark mode. 9 semantic color ramps, sentence-case typography.

## Scope

**Best for:** physics setups, chemistry mechanisms, math curves, physical objects (aircraft, turbines, smartphones), anatomy, floor plans, narrative journeys, hub-spoke integrations, exploded layer views.

**Look elsewhere for:** software/cloud architecture (use `architecture-diagram` skill), hand-drawn whiteboard sketches (use `excalidraw`), animated explainers.

## Workflow

1. Decide on diagram type (flowchart, structural, API tree, microservice topology, data flow, physical, infrastructure, UI mockup).
2. Lay out components using the Design System rules.
3. Write the full HTML page — SVG embedded in the template structure.
4. Save as standalone `.html` file. User opens directly in browser.

## Design System

- **Flat**: no gradients, shadows, blur, or glow
- **Minimal**: essential only, no decorative icons inside boxes
- **Colors**: 9 ramps (purple, teal, coral, pink, gray, blue, green, amber, red), 7 stops each. Use 2-3 colors per diagram. `c-gray` for neutral.
- **Typography**: `th` (14px/500) for titles, `ts` (12px/400) for subtitles, `t` (14px/400) for general text. Sentence case only.
- **Stroke**: 0.5px on all node borders. `rx="8"` for nodes, `rx="12"` for inner containers, `rx="16"` for outer containers.
- **Spacing**: ViewBox `680` wide. 60px min between boxes, 24px horizontal / 12px vertical padding inside boxes.
- **Arrows**: Include marker defs with `context-stroke` for auto color inheritance.

## Validation Checklist

1. Every `<text>` has class `t`, `ts`, or `th`
2. Every `<text>` inside box has `dominant-baseline="central"`
3. Every connector path has `fill="none"`
4. No arrow crosses through unrelated boxes
5. ViewBox height = bottom-most element + 40px
6. All content within x=40 to x=640
7. Color classes on `<g>` or shape, never on connector `<path>`
8. No gradients, shadows, blur, or glow

## Output

Write a single `.html` file. No server needed. Tell user to open with `open` (macOS) or `xdg-open` (Linux).

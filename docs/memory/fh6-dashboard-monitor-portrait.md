---
name: fh6-dashboard-monitor-portrait
description: "The dashboard lives on a 4K portrait monitor at 200% — a 1080×1920 CSS-px viewport; verify layout there, not in a landscape frame"
metadata: 
  node_type: memory
  type: user
  originSessionId: 6df3e83b-72ec-4c37-9c9f-0b4b3817f1f4
  modified: 2026-09-03T05:30:40.542Z
---

Jett houses the FH6 dashboard on a **4K monitor turned portrait at 200% scaling**. To the
browser that is a **1080 × 1920 CSS-px** viewport: narrow and very tall.

**Why:** a side-by-side two-pane layout gives each pane ~530 px — no map survives that. In
portrait the panes stack (map above, statistics below) and floating sheets take the width.
Landscape rules still exist for the in-app preview pane, but they are not what Jett sees.

**How to apply:** when verifying dashboard layout in the browser pane, emulate 1080 × 1920
(`resize_window` custom size) before judging anything; the 800×450 default frame gave a
false "fits" on 2026-09-03. Keep `@media (orientation: portrait)` rules in
[[fh6-dashboard-redesign]] work; see [[jett-visual-first-doctrine]] for the no-scroll rule.

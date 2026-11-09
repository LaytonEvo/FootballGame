# Mockups (reference only)

These are the source files of the design canvas. Each `.dc.html` is a self-contained screen: inline-styled HTML plus a small `renderVals()` script holding the sample data. They were authored for a design editor runtime (`support.js`, not included), so they will not render perfectly if opened directly in a browser; `{{hole}}` markers are template bindings, `<sc-for>` is a loop, `<sc-if>` a conditional and `<dc-import name="Shirt">` mounts `Shirt.dc.html`.

Use them for layout, spacing, copy and component structure. Take colours, fonts and motion from `../tokens.json` (a few early files such as `Cards.dc.html` predate the final palette). The live, viewable version is the canvas linked in `docs/DESIGN.md`.

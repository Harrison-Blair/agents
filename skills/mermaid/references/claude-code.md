# Claude Code: mermaid-render

The `mermaid-render` mod in [mods/mermaid-render](../../../mods/mermaid-render) draws each `mermaid` fenced code block in a reply. These notes describe how it draws them.

## Renderer

- The mod draws each diagram as character art with `mermaid-ascii`. It draws no images.
- `mermaid-ascii` draws only `graph`, `flowchart`, `sequenceDiagram`, and `erDiagram`. For other types, the mod shows the source and a note.

## Character art

- The mod has room for the terminal width minus 4 columns.
- If the art is wider than that room, the mod shows the source and a note with the two widths.
- The mod removes `direction` lines inside subgraphs.
- `mermaid-ascii` does not parse the `-- label -->` edge form. Use `-->|label|`.

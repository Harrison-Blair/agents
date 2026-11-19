---
name: mermaid
description: Format Mermaid diagrams so that they render clearly in a terminal. Use when you write a mermaid fenced code block in a reply, plan, or design conversation.
---

# Mermaid

Use these rules when you write a `mermaid` fenced code block. A terminal can show the diagram as character art, and character art has little space.

## Diagram type

- Use `flowchart`, `sequenceDiagram`, or `erDiagram`. Character-art renderers draw these types.
- Write a state machine as a `flowchart`.

## Size

- Keep the diagram 76 columns wide or less.
- Use `LR` only when a row has 4 nodes or fewer. Use `TD` for a longer chain.
- Use 10 nodes or fewer. Split a larger diagram into two diagrams.

## Labels

- Write node labels of 3 words or fewer.
- Write edge labels of 1 or 2 words. Use the `-->|label|` form.
- Give each node an ID and a label, for example `A[Parse reply]`. Use the ID in later edges.
- Put explanations in the text around the diagram. Do not put them in labels.

## Harness notes

- Claude Code with the `mermaid-render` mod: read [references/claude-code.md](references/claude-code.md).

export type Diagram =
  | { status: 'done'; art: string }
  | { status: 'error'; reason: string }

declare module 'claude-code' {
  interface PluginState {
    'mermaid-render': { diagrams: StateFamily<Diagram> }
  }
}

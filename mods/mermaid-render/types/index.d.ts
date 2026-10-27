export type Diagram =
  | { status: 'done'; png?: string; art?: string }
  | { status: 'error'; reason: string }

declare module 'claude-code' {
  interface PluginState {
    'mermaid-render': { diagrams: StateFamily<Diagram> }
  }
}

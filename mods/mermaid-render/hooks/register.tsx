import type { Elements, EngineInterface, Register } from 'claude-code'

import type { Diagram } from '../types'

// scripts/setup.sh installs the mermaid-ascii binary here.
const CACHE = '.cache/mermaid-render'
const FENCE = /^```mermaid[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm
const DIRECTION = /^[ \t]*direction[ \t]+(TB|TD|BT|LR|RL)[ \t]*$/gm
const SUBGRAPH = /^[ \t]*subgraph\b/m
// Compact spacing: no padding rows inside boxes, short gaps between them.
const ASCII_FLAGS = ['-p', '0', '-x', '3', '-y', '2']
// mermaid-ascii 1.6.1 draws a second subgraph through its nodes with gaps
// below 5, so diagrams with subgraphs get wider gaps.
const SUBGRAPH_FLAGS = ['-p', '0', '-x', '5', '-y', '5']
// A node's label, quoted or not: A[text], A(text) or A{text}.
const LABEL = /(\w)([[({])(?![[({])"?([^"\n\])}]*?)"?([\])}])/g
const CLOSE: Record<string, string> = { '[': ']', '(': ')', '{': '}' }
const EDGE_LABEL = /\|([^|\n]+)\|/g
// A sequence message: From->>To: text.
const MESSAGE = /^[ \t]*(\w+)[ \t]*[-.x)>]+[ \t]*(\w+)[ \t]*:[ \t]*(.+?)[ \t]*$/gm
const CORNERS: Record<string, string> = { '┌': '╭', '┐': '╮', '└': '╰', '┘': '╯' }
const ARROWHEADS = '►◄▲▼'
const MISSING = 'mermaid-ascii not installed; run scripts/setup.sh in the agents repo'

export type Part =
  | { kind: 'markdown'; text: string }
  | { kind: 'mermaid'; source: string; fence: string }

export function split(text: string): Part[] {
  const parts: Part[] = []
  let at = 0
  for (const match of text.matchAll(FENCE)) {
    const before = text.slice(at, match.index).trim()
    if (before) parts.push({ kind: 'markdown', text: before })
    parts.push({ kind: 'mermaid', source: match[1] ?? '', fence: match[0] })
    at = match.index + match[0].length
  }
  const rest = text.slice(at).trim()
  if (rest) parts.push({ kind: 'markdown', text: rest })
  return parts
}

// mermaid-ascii trims a label's spaces unless it is quoted, so quote each
// flowchart label with a space on each side to keep text off the border.
export function padLabels(source: string): string {
  if (!/^\s*(graph|flowchart)\b/.test(source)) return source
  return source.replace(LABEL, (match, id: string, open: string, text: string, close: string) =>
    CLOSE[open] === close && text.trim() ? `${id}${open}" ${text.trim()} "${close}` : match,
  )
}

// What each label in the source names: a node, or an edge or message.
export function labelsOf(source: string): Map<string, 'node' | 'edge'> {
  const labels = new Map<string, 'node' | 'edge'>()
  for (const [, text = ''] of source.matchAll(EDGE_LABEL)) labels.set(text.trim(), 'edge')
  for (const [, from = '', to = '', text = ''] of source.matchAll(MESSAGE)) {
    labels.set(text, 'edge')
    labels.set(from, 'node')
    labels.set(to, 'node')
  }
  for (const [, , open = '', text = '', close = ''] of source.matchAll(LABEL)) {
    if (CLOSE[open] === close) labels.set(text.trim(), 'node')
  }
  labels.delete('')
  return labels
}

export function widthOf(art: string): number {
  return Math.max(...art.split('\n').map(line => [...line].length))
}

// FNV-1a: a cache key, not a security boundary.
function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0') + text.length.toString(16)
}

// mermaid-ascii logs a failure as time=… level=fatal msg="…": keep the message.
function reasonOf(stderr: string, fallback: string): string {
  const lines = stderr.split('\n').map(line => line.trim()).filter(Boolean)
  const line = lines.find(line => /error|fatal/i.test(line)) ?? lines[0]
  if (!line) return fallback
  const message = /msg="((?:[^"\\]|\\.)*)"/.exec(line)?.[1] ?? line
  const type = /unsupported graph type '([^']+)'/.exec(message)?.[1]
  return type ? `${type} has no text renderer · showing source` : message
}

async function run($: EngineInterface, argv: string[], init: Parameters<EngineInterface['process']['run']>[1]) {
  return $.process.run(argv, init).catch(error => ({ exitCode: 1, stdout: '', stderr: String(error) }))
}

// The mod API has no OS call. Windows always sets OS=Windows_NT, and its home
// is USERPROFILE, as Node's os.homedir() reads it there.
async function locate($: EngineInterface) {
  const isWindows = (await $.env.get('OS')) === 'Windows_NT'
  const home = isWindows
    ? ((await $.env.get('USERPROFILE')) ?? (await $.env.get('HOME')) ?? '')
    : ((await $.env.get('HOME')) ?? '')
  return `${home.replaceAll('\\', '/')}/${CACHE}/bin/mermaid-ascii${isWindows ? '.exe' : ''}`
}

async function renderDiagram($: EngineInterface, id: string, source: string, room: number) {
  const ascii = await locate($)
  if (!(await $.fs.exists(ascii))) {
    await $.state.set({ plugin: 'mermaid-render', key: 'diagrams', id }, { status: 'error', reason: MISSING })
    return
  }
  const flags = SUBGRAPH.test(source) ? SUBGRAPH_FLAGS : ASCII_FLAGS
  const result = await run($, [ascii, ...flags, '--max-width', String(room)], {
    stdin: padLabels(source.replace(DIRECTION, '')),
    timeoutMs: 15_000,
  })
  const diagram: Diagram = result.exitCode === 0 && result.stdout.trim()
    ? { status: 'done', art: result.stdout.trimEnd().replace(/[┌┐└┘]/g, corner => CORNERS[corner] ?? corner) }
    : { status: 'error', reason: reasonOf(result.stderr, 'mermaid-ascii failed') }
  await $.state.set({ plugin: 'mermaid-render', key: 'diagrams', id }, diagram)
}

// One Text row per line: lines dim, node labels bold, edge labels and
// arrowheads in the theme's claude color.
function drawArt(Text: Elements['terminal']['Text'], art: string, labels: Map<string, 'node' | 'edge'>) {
  const names = [...labels.keys()].sort((a, b) => b.length - a.length).map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const token = new RegExp(`(?<!\\w)(${names.join('|') || '(?!)'})(?!\\w)|([${ARROWHEADS}])|([\u2500-\u257f]+)`, 'g')
  return art.split('\n').map(line => {
    const runs = []
    let at = 0
    for (const match of line.matchAll(token)) {
      if (match.index > at) runs.push(line.slice(at, match.index))
      const [text, label, arrowhead] = match
      if (label) {
        runs.push(labels.get(label) === 'node' ? <Text weight="bold">{text}</Text> : <Text color="claude">{text}</Text>)
      } else if (arrowhead) {
        runs.push(<Text color="claude">{text}</Text>)
      } else {
        runs.push(<Text dimColor>{text}</Text>)
      }
      at = match.index + text.length
    }
    if (at < line.length) runs.push(line.slice(at))
    return <Text wrap="truncate-end">{runs.length ? runs : ' '}</Text>
  })
}

// Module state: a reload forgets what it scheduled, and the next draw
// schedules again.
const scheduled = new Set<string>()

export const register: Register = on => {
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const parts = split(e.props.text)
    if (!parts.some(part => part.kind === 'mermaid')) return next(e)

    const { Box, Text, Markdown } = $.ui.resolve(e)
    const room = Math.max(20, (e.viewport?.columns ?? 80) - 4)
    const drawn = []
    for (const [index, part] of parts.entries()) {
      if (part.kind === 'markdown') {
        // The first part keeps the engine's own drawing, bullet included.
        drawn.push(
          index === 0
            ? await next({ ...e, props: { ...e.props, text: part.text } })
            : <Box paddingLeft={2}><Markdown text={part.text} /></Box>,
        )
        continue
      }
      const id = `${hash(part.source)}-${room}`
      const { value } = await $.state.get({ plugin: 'mermaid-render', key: 'diagrams', id })
      if (!value) {
        if (!scheduled.has(id)) {
          scheduled.add(id)
          $.clock.after(0, () => {
            renderDiagram($, id, part.source, room).catch(error =>
              $.state.set({ plugin: 'mermaid-render', key: 'diagrams', id }, { status: 'error', reason: String(error) }),
            )
          })
        }
        drawn.push(<Box paddingLeft={2}><Text dimColor>[rendering diagram…]</Text></Box>)
      } else if (value.status === 'error') {
        drawn.push(
          <Box paddingLeft={2} flexDirection="column">
            <Markdown text={part.fence} />
            <Text dimColor>mermaid-render: {value.reason}</Text>
          </Box>,
        )
      } else if (widthOf(value.art) > room) {
        drawn.push(
          <Box paddingLeft={2} flexDirection="column">
            <Markdown text={part.fence} />
            <Text dimColor>
              mermaid-render: diagram is {widthOf(value.art)} columns, room for {room} · showing source
            </Text>
          </Box>,
        )
      } else {
        drawn.push(<Box paddingLeft={2} flexDirection="column">{drawArt(Text, value.art, labelsOf(part.source))}</Box>)
      }
    }
    return <Box flexDirection="column">{drawn}</Box>
  })
}

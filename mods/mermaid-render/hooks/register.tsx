import type { EngineInterface, Register } from 'claude-code'

import type { Diagram } from '../types'

// scripts/setup.sh installs the renderers here: the mermaid-ascii binary, and
// mermaid-cli with its own Chromium.
const CACHE = '.cache/mermaid-render'
const FENCE = /^```mermaid[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm
const DIRECTION = /^[ \t]*direction[ \t]+(TB|TD|BT|LR|RL)[ \t]*$/gm
const MAX_ROWS = 40
const MISSING = 'renderers not installed; run scripts/setup.sh in the agents repo'
// Ubuntu 23.10+ blocks the user namespaces Chromium's sandbox needs.
const NO_SANDBOX = /No usable sandbox/

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

// FNV-1a: a cache key, not a security boundary.
function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0') + text.length.toString(16)
}

function reasonOf(stderr: string, fallback: string): string {
  const lines = stderr.split('\n').map(line => line.trim()).filter(Boolean)
  return lines.find(line => /error/i.test(line)) ?? lines[0] ?? fallback
}

// Cells are about twice as tall as wide; mmdc renders at scale 2, so one
// cell is about 16 px of the PNG's width.
export function imageBox(png: string, room: number) {
  const head = atob(png.slice(0, 44))
  const word = (at: number) =>
    ((head.charCodeAt(at) << 24) | (head.charCodeAt(at + 1) << 16) | (head.charCodeAt(at + 2) << 8) | head.charCodeAt(at + 3)) >>> 0
  // PNG's IHDR chunk holds the width and height at bytes 16 and 20.
  const width = word(16)
  const height = word(20)
  let columns = Math.min(room, 255, Math.ceil(width / 16))
  let rows = Math.max(1, Math.round((columns * height) / width / 2))
  if (rows > MAX_ROWS) {
    rows = MAX_ROWS
    columns = Math.max(1, Math.round((rows * 2 * width) / height))
  }
  return { columns, rows }
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
  const dir = `${home.replaceAll('\\', '/')}/${CACHE}`
  return {
    dir,
    ascii: `${dir}/bin/mermaid-ascii${isWindows ? '.exe' : ''}`,
    // Run mermaid-cli's script through node: a call with no shell cannot run
    // the mmdc.cmd shim npm writes on Windows.
    cli: `${dir}/node_modules/@mermaid-js/mermaid-cli/src/cli.js`,
  }
}

async function renderDiagram($: EngineInterface, id: string, source: string, mode: string) {
  const paths = await locate($)
  const hasAscii = await $.fs.exists(paths.ascii)
  const hasCli = mode !== 'text' && (await $.fs.exists(paths.cli))
  if (!hasAscii && !hasCli) {
    await $.state.set({ plugin: 'mermaid-render', key: 'diagrams', id }, { status: 'error', reason: MISSING })
    return
  }
  const ascii = hasAscii
    ? await run($, [paths.ascii], { stdin: source.replace(DIRECTION, ''), timeoutMs: 15_000 })
    : { exitCode: 1, stdout: '', stderr: 'mermaid-ascii not installed' }
  const art = ascii.exitCode === 0 && ascii.stdout.trim() ? ascii.stdout.trimEnd() : undefined
  let diagram: Diagram
  if (!hasCli) {
    diagram = art
      ? { status: 'done', art }
      : { status: 'error', reason: reasonOf(ascii.stderr, 'mermaid-ascii failed') }
  } else {
    const input = `${paths.dir}/renders/${id}.mmd`
    const output = `${paths.dir}/renders/${id}.png`
    let cli = { exitCode: 0, stderr: '' }
    if (!(await $.fs.exists(output))) {
      await $.fs.write(input, source)
      const mmdc = async (unsandboxed: boolean) => {
        const argv = ['node', paths.cli, '-q', '-i', input, '-o', output, '-t', 'dark', '-b', 'transparent', '-s', '2']
        if (unsandboxed) {
          const config = `${paths.dir}/renders/no-sandbox.json`
          await $.fs.write(config, '{"args":["--no-sandbox"]}')
          argv.push('-p', config)
        }
        return run($, argv, { env: { PUPPETEER_CACHE_DIR: `${paths.dir}/puppeteer` }, timeoutMs: 30_000 })
      }
      // Where the sandbox is blocked, Chromium runs without it: the person
      // chose images there over character art.
      cli = await mmdc(sandboxBlocked)
      if (cli.exitCode !== 0 && !sandboxBlocked && NO_SANDBOX.test(cli.stderr)) {
        sandboxBlocked = true
        cli = await mmdc(true)
      }
    }
    if (cli.exitCode === 0) {
      const { base64 } = await $.fs.read(output, { as: 'bytes' })
      diagram = { status: 'done', png: base64, art }
    } else {
      diagram = { status: 'error', reason: reasonOf(cli.stderr, 'mmdc failed') }
    }
  }
  await $.state.set({ plugin: 'mermaid-render', key: 'diagrams', id }, diagram)
}

// Module state: a reload forgets what it scheduled, and the next draw
// schedules again.
const scheduled = new Set<string>()
let sandboxBlocked = false

export const register: Register = (on, options) => {
  const mode = String(options.mode ?? 'auto')

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const parts = split(e.props.text)
    if (!parts.some(part => part.kind === 'mermaid')) return next(e)

    const { Box, Text, Markdown, Image, Code } = $.ui.resolve(e)
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
      const id = `${mode}-${hash(part.source)}`
      const { value } = await $.state.get({ plugin: 'mermaid-render', key: 'diagrams', id })
      if (!value) {
        if (!scheduled.has(id)) {
          scheduled.add(id)
          $.clock.after(0, () => {
            renderDiagram($, id, part.source, mode).catch(error =>
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
      } else if (value.png) {
        drawn.push(
          <Box paddingLeft={2}>
            <Image source={{ png: value.png }} {...imageBox(value.png, room)} alt={value.art ?? 'mermaid diagram'} />
          </Box>,
        )
      } else {
        drawn.push(<Box paddingLeft={2}><Code source={value.art ?? ''} wrap="truncate-end" /></Box>)
      }
    }
    return <Box flexDirection="column">{drawn}</Box>
  })
}

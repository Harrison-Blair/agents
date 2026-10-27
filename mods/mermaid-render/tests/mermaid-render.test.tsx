import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const DIAGRAM = '```mermaid\nflowchart LR\n  subgraph S\n    direction TB\n    A --> B\n  end\n```'
const REPLY = `Intro text.\n\n${DIAGRAM}\n\nAfter text.`
const ART = '┌───┐\n│ A │\n└───┘'
const CACHE = '/home/u/.cache/mermaid-render'

// The first 33 bytes of a 1600 x 400 PNG: signature, then the IHDR chunk.
const PNG = btoa(
  String.fromCharCode(
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52,
    0, 0, 0x06, 0x40, 0, 0, 0x01, 0x90,
    8, 6, 0, 0, 0, 0, 0, 0, 0,
  ),
)

type Run = { argv: readonly string[]; init?: { stdin?: string; env?: Record<string, string> } }

function message(text: string) {
  return {
    plugin: 'mermaid-render',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'm1',
    props: { text, isFirstOfReply: true },
  } as const
}

// The world beneath the mod: the engine's own drawing of a reply, an
// environment, the files that exist, and the renderers' answers.
function world(
  on: On,
  {
    env = { HOME: '/home/u' } as Record<string, string>,
    files = [] as string[],
    stdout = `${ART}\n`,
    exitCode = 0,
    stderr = '',
  } = {},
) {
  const runs: Run[] = []
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine: {(e.props as { text: string }).text}</Text>
  })
  on('env.get', (_, e) => ({ value: env[e.name] }))
  // The host resolves a path: a C:/ path is relative on a Linux test host.
  on('fs.exists', (_, e) => ({ value: files.some(file => e.path.endsWith(file)) }))
  on('fs.write', () => ({ value: undefined }))
  on('fs.read', () => ({ value: { base64: PNG } }))
  on('process.run', (_, e) => {
    runs.push(e)
    return { value: { exitCode, stdout, stderr, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { runs, clock: mock.clock(on) }
}

test('a reply with no mermaid block is drawn by the engine unchanged', async ($, on) => {
  world(on)
  const ui = await $.ui.mount(message('Plain **reply**.'))

  expect((await ui.find({ type: 'Text' }))?.text).toBe('engine: Plain **reply**.')
  await ui.unmount()
})

test('a diagram shows a placeholder until its render finishes', async ($, on) => {
  world(on)
  const ui = await $.ui.mount(message(REPLY))

  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine: Intro text.')
  expect(await ui.find({ type: 'Text', text: '[rendering diagram…]' })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: 'After text.' })).toBeDefined()
  await ui.unmount()
})

test('text mode draws mermaid-ascii output, without direction lines', { options: { mode: 'text' } }, async ($, on) => {
  const { runs, clock } = world(on, { files: [`${CACHE}/bin/mermaid-ascii`] })
  const ui = await $.ui.mount(message(REPLY))
  await clock.advance(1)

  expect(runs).toHaveLength(1)
  expect(runs[0]?.argv).toEqual([`${CACHE}/bin/mermaid-ascii`])
  expect(runs[0]?.init?.stdin).toBe('flowchart LR\n  subgraph S\n\n    A --> B\n  end')
  expect((await ui.find({ type: 'Code' }))?.text).toBe(ART)
  expect(await ui.find({ type: 'Text', text: '[rendering diagram…]' })).toBeUndefined()
  await ui.unmount()
})

test('on Windows the paths come from USERPROFILE and name the .exe', { options: { mode: 'text' } }, async ($, on) => {
  const exe = 'C:/Users/u/.cache/mermaid-render/bin/mermaid-ascii.exe'
  const { runs, clock } = world(on, { env: { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\u' }, files: [exe] })
  const ui = await $.ui.mount(message(REPLY))
  await clock.advance(1)

  expect(runs[0]?.argv).toEqual([exe])
  expect((await ui.find({ type: 'Code' }))?.text).toBe(ART)
  await ui.unmount()
})

test('auto mode draws the mermaid-cli PNG, run through node, with the art as alt', async ($, on) => {
  const cli = `${CACHE}/node_modules/@mermaid-js/mermaid-cli/src/cli.js`
  const { runs, clock } = world(on, { files: [`${CACHE}/bin/mermaid-ascii`, cli] })
  const ui = await $.ui.mount(message(REPLY))
  await clock.advance(1)

  const mmdc = runs.find(run => run.argv[0] === 'node')
  expect(mmdc?.argv[1]).toBe(cli)
  expect(mmdc?.init?.env?.PUPPETEER_CACHE_DIR).toBe(`${CACHE}/puppeteer`)
  const image = await ui.find({ type: 'Image' })
  expect(image?.props.source).toEqual({ png: PNG })
  expect(image?.props.alt).toBe(ART)
  // 1600 px at scale 2 is about 100 cells, held to the 76 the default 80-column
  // viewport leaves; 4:1 pixels on 1:2 cells is 76 / 8 = 9.5 rows.
  expect(image?.props.columns).toBe(76)
  expect(image?.props.rows).toBe(10)
  await ui.unmount()
})

test('auto mode without mermaid-cli falls back to character art', async ($, on) => {
  const { runs, clock } = world(on, { files: [`${CACHE}/bin/mermaid-ascii`] })
  const ui = await $.ui.mount(message(REPLY))
  await clock.advance(1)

  expect(runs.some(run => run.argv[0] === 'node')).toBe(false)
  expect((await ui.find({ type: 'Code' }))?.text).toBe(ART)
  await ui.unmount()
})

test('with no renderer installed, the code block says to run setup', async ($, on) => {
  const { runs, clock } = world(on)
  const ui = await $.ui.mount(message(REPLY))
  await clock.advance(1)

  expect(runs).toHaveLength(0)
  expect(await ui.find({ type: 'Markdown', text: DIAGRAM })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^mermaid-render:/ }))?.text).toBe(
    'mermaid-render: renderers not installed; run scripts/setup.sh in the agents repo',
  )
  await ui.unmount()
})

test('a failed render shows the code block and the reason', { options: { mode: 'text' } }, async ($, on) => {
  const { clock } = world(on, {
    files: [`${CACHE}/bin/mermaid-ascii`],
    exitCode: 1,
    stdout: '',
    stderr: 'Error: unsupported diagram type\n',
  })
  const ui = await $.ui.mount(message(REPLY))
  await clock.advance(1)

  expect(await ui.find({ type: 'Markdown', text: DIAGRAM })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^mermaid-render:/ }))?.text).toBe(
    'mermaid-render: Error: unsupported diagram type',
  )
  await ui.unmount()
})

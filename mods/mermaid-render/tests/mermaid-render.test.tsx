import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const DIAGRAM = '```mermaid\nflowchart LR\n  subgraph S\n    direction TB\n    A --> B\n  end\n```'
const REPLY = `Intro text.\n\n${DIAGRAM}\n\nAfter text.`
const ART = '┌───┐\n│ A │\n└───┘'
const CACHE = '/home/u/.cache/mermaid-render'
const FLAGS = ['-p', '0', '-x', '3', '-y', '2', '--max-width', '76']

type Run = { argv: readonly string[]; init?: { stdin?: string; env?: Record<string, string> } }

function message(text: string, columns = 80) {
  return {
    plugin: 'mermaid-render',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'm1',
    props: { text, isFirstOfReply: true },
    viewport: { columns, rows: 40 },
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
    answer = (_: Run) => ({ exitCode, stdout, stderr }),
  } = {},
) {
  const runs: Run[] = []
  const writes: { path: string; text: string }[] = []
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine: {(e.props as { text: string }).text}</Text>
  })
  on('env.get', (_, e) => ({ value: env[e.name] }))
  // The host resolves a path: a C:/ path is relative on a Linux test host,
  // and a Windows host spells the result with backslashes.
  on('fs.exists', (_, e) => {
    const path = e.path.replaceAll('\\', '/')
    return { value: files.some(file => path.endsWith(file)) }
  })
  on('fs.write', (_, e) => {
    writes.push({ path: e.path.replaceAll('\\', '/'), text: e.text })
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    runs.push(e)
    return { value: { ...answer(e), isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { runs, writes, clock: mock.clock(on) }
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

test('draws compact mermaid-ascii output, without direction lines', async ($, on) => {
  const { runs, clock } = world(on, { files: [`${CACHE}/bin/mermaid-ascii`] })
  const ui = await $.ui.mount(message(REPLY))
  await clock.advance(1)

  expect(runs).toHaveLength(1)
  expect(runs[0]?.argv).toEqual([`${CACHE}/bin/mermaid-ascii`, ...FLAGS])
  expect(runs[0]?.init?.stdin).toBe('flowchart LR\n  subgraph S\n\n    A --> B\n  end')
  expect(await ui.find({ type: 'Text', text: '[rendering diagram…]' })).toBeUndefined()
  await ui.unmount()
})

test('draws the art with rounded corners', async ($, on) => {
  const { clock } = world(on, { files: [`${CACHE}/bin/mermaid-ascii`] })
  const ui = await $.ui.mount(message(REPLY))
  await clock.advance(1)

  expect(await ui.find({ type: 'Text', text: '╭───╮' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '╰───╯' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /[┌┐└┘]/ })).toBeUndefined()
  await ui.unmount()
})

test('flowchart labels are quoted with a space on each side; edge labels are not', async ($, on) => {
  const { runs, clock } = world(on, { files: [`${CACHE}/bin/mermaid-ascii`] })
  const ui = await $.ui.mount(message('```mermaid\ngraph LR\n  A[Reply] -->|yes| B{"Cached?"}\n  B --> C(Serve)\n```'))
  await clock.advance(1)

  expect(runs[0]?.init?.stdin).toBe('graph LR\n  A[" Reply "] -->|yes| B{" Cached? "}\n  B --> C(" Serve ")')
  await ui.unmount()
})

test('sequence diagrams go to mermaid-ascii unchanged', async ($, on) => {
  const { runs, clock } = world(on, { files: [`${CACHE}/bin/mermaid-ascii`] })
  const source = 'sequenceDiagram\n  User->>Mod: reply(text)'
  const ui = await $.ui.mount(message(`\`\`\`mermaid\n${source}\n\`\`\``))
  await clock.advance(1)

  expect(runs[0]?.init?.stdin).toBe(source)
  await ui.unmount()
})

test('node labels draw bold; edge labels and arrowheads in the claude color; lines dim', async ($, on) => {
  const { clock } = world(on, {
    files: [`${CACHE}/bin/mermaid-ascii`],
    stdout: '┌───────┐     ┌───┐\n│ Reply ├─yes─►│ B │\n└───────┘     └───┘\n',
  })
  const ui = await $.ui.mount(message('```mermaid\ngraph LR\n  A[Reply] -->|yes| B\n```'))
  await clock.advance(1)

  const runs = await ui.findAll({ type: 'Text' })
  const run = (text: string) => runs.find(found => found.text === text && found.children.length === 1)
  expect(run('Reply')?.props.weight).toBe('bold')
  expect(run('yes')?.props.color).toBe('claude')
  expect(run('►')?.props.color).toBe('claude')
  expect(run('├─')?.props.dimColor).toBe(true)
  expect(run('╭───────╮')?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('art wider than the room shows the source and a note', async ($, on) => {
  const wide = `┌${'─'.repeat(77)}┐\n│ A${' '.repeat(74)} │\n└${'─'.repeat(77)}┘`
  const { clock } = world(on, { files: [`${CACHE}/bin/mermaid-ascii`], stdout: `${wide}\n` })
  const ui = await $.ui.mount(message(REPLY))
  await clock.advance(1)

  expect(await ui.find({ type: 'Markdown', text: DIAGRAM })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^mermaid-render:/ }))?.text).toBe(
    'mermaid-render: diagram is 79 columns, room for 76 · showing source',
  )
  expect(await ui.find({ type: 'Text', text: /─{10}/ })).toBeUndefined()
  await ui.unmount()
})

test('a narrower terminal renders the art again for its room', async ($, on) => {
  const { runs, clock } = world(on, { files: [`${CACHE}/bin/mermaid-ascii`] })
  const wide = await $.ui.mount(message(REPLY))
  await clock.advance(1)
  await wide.unmount()
  const narrow = await $.ui.mount({ ...message(REPLY, 60), requestId: 'm2' })
  await clock.advance(1)

  expect(runs.map(run => run.argv.at(-1))).toEqual(['76', '56'])
  await narrow.unmount()
})

test('on Windows the paths come from USERPROFILE and name the .exe', async ($, on) => {
  const exe = 'C:/Users/u/.cache/mermaid-render/bin/mermaid-ascii.exe'
  const { runs, clock } = world(on, { env: { OS: 'Windows_NT', USERPROFILE: 'C:\\Users\\u' }, files: [exe] })
  const ui = await $.ui.mount(message(REPLY))
  await clock.advance(1)

  expect(runs[0]?.argv).toEqual([exe, ...FLAGS])
  expect(await ui.find({ type: 'Text', text: '│ A │' })).toBeDefined()
  await ui.unmount()
})

test('with no renderer installed, the code block says to run setup', async ($, on) => {
  const { runs, clock } = world(on)
  const ui = await $.ui.mount(message(REPLY))
  await clock.advance(1)

  expect(runs).toHaveLength(0)
  expect(await ui.find({ type: 'Markdown', text: DIAGRAM })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^mermaid-render:/ }))?.text).toBe(
    'mermaid-render: mermaid-ascii not installed; run scripts/setup.sh in the agents repo',
  )
  await ui.unmount()
})

test('a failed render shows the code block and the reason', async ($, on) => {
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

test('a type mermaid-ascii cannot draw shows the source and says so', async ($, on) => {
  const { runs, clock } = world(on, {
    files: [`${CACHE}/bin/mermaid-ascii`],
    exitCode: 1,
    stdout: '',
    stderr:
      'time="2026-10-29T11:47:48-04:00" level=fatal msg="failed to parse graph diagram: unsupported graph type ' +
      "'classDiagram'. Supported types: 'graph' or 'flowchart' with an optional direction (TD, TB, BT, LR, RL)\"\n",
  })
  const fence = '```mermaid\nclassDiagram\n  Animal <|-- Duck\n```'
  const ui = await $.ui.mount(message(fence))
  await clock.advance(1)

  expect(runs.map(run => run.argv[0])).toEqual([`${CACHE}/bin/mermaid-ascii`])
  expect(await ui.find({ type: 'Markdown', text: fence })).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /^mermaid-render:/ }))?.text).toBe(
    'mermaid-render: classDiagram has no text renderer · showing source',
  )
  await ui.unmount()
})

test('another mermaid-ascii failure shows the message from its log line', async ($, on) => {
  const { clock } = world(on, {
    files: [`${CACHE}/bin/mermaid-ascii`],
    exitCode: 1,
    stdout: '',
    stderr: 'time="2026-10-29T11:47:48-04:00" level=fatal msg="failed to parse line 3"\n',
  })
  const ui = await $.ui.mount(message(REPLY))
  await clock.advance(1)

  expect((await ui.find({ type: 'Text', text: /^mermaid-render:/ }))?.text).toBe('mermaid-render: failed to parse line 3')
  await ui.unmount()
})

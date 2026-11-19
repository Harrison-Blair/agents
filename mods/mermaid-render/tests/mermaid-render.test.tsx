import { expect, mock, test } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

const DIAGRAM = '```mermaid\nflowchart LR\n  subgraph S\n    direction TB\n    A --> B\n  end\n```'
const REPLY = `Intro text.\n\n${DIAGRAM}\n\nAfter text.`
const ART = '┌───┐\n│ A │\n└───┘'
const OTHER = '```mermaid\nflowchart LR\n  C --> D\n```'
const CACHE = '/home/u/.cache/mermaid-render'
const RENDERER = `${CACHE}/bin/mermaid-ascii`
// The second line is not the installer's: the note takes one line of stderr.
const INSTALL_FAILURE = {
  exitCode: 1,
  stdout: '',
  stderr: 'mermaid-ascii not installed: could not download\nsh: a line of another program\n',
}
// DIAGRAM has a subgraph, so it gets the wider gaps.
const FLAGS = ['-p', '0', '-x', '5', '-y', '5', '--max-width', '76']
const COMPACT_FLAGS = ['-p', '0', '-x', '3', '-y', '2', '--max-width', '76']

type Run = { argv: readonly string[]; init?: { stdin?: string; env?: Record<string, string>; timeoutMs?: number } }
type Answer = { exitCode: number; stdout: string; stderr: string }
// A run that cannot start, or that is still running at its time limit: the
// call rejects in the mod.
type Rejection = { deny: string }

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
// environment, the files that exist, and the answers of the renderer and of
// the installer. The default installer finds the pinned release in place.
// existsDelay is how long each file lookup takes on the test clock.
function world(
  on: On,
  {
    env = { HOME: '/home/u' } as Record<string, string>,
    files = [] as string[],
    stdout = `${ART}\n`,
    exitCode = 0,
    stderr = '',
    answer = (_: Run) => ({ exitCode, stdout, stderr }),
    install = (_: MockClock): Answer | Rejection | Promise<Answer> => ({ exitCode: 0, stdout: '', stderr: '' }),
    existsDelay = () => 0,
  } = {},
) {
  const runs: Run[] = []
  const installs: Run[] = []
  const clock = mock.clock(on)
  const writes: { path: string; text: string }[] = []
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>engine: {(e.props as { text: string }).text}</Text>
  })
  on('env.get', (_, e) => ({ value: env[e.name] }))
  // The host resolves a path: a C:/ path is relative on a Linux test host,
  // and a Windows host spells the result with backslashes.
  on('fs.exists', async (_, e) => {
    const delay = existsDelay()
    if (delay) await clock.sleep(delay)
    const path = e.path.replaceAll('\\', '/')
    return { value: files.some(file => path.endsWith(file)) }
  })
  on('fs.write', (_, e) => {
    writes.push({ path: e.path.replaceAll('\\', '/'), text: e.text })
    return { value: undefined }
  })
  on('process.run', async (_, e) => {
    const isInstall = e.argv[0] === 'sh'
    ;(isInstall ? installs : runs).push(e)
    const result = isInstall ? await install(clock) : answer(e)
    if ('deny' in result) return result
    return { value: { ...result, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { runs, installs, writes, clock }
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

test('a diagram without subgraphs gets compact gaps', async ($, on) => {
  const { runs, clock } = world(on, { files: [`${CACHE}/bin/mermaid-ascii`] })
  const ui = await $.ui.mount(message('```mermaid\nflowchart LR\n  A --> B\n```'))
  await clock.advance(1)

  expect(runs[0]?.argv).toEqual([`${CACHE}/bin/mermaid-ascii`, ...COMPACT_FLAGS])
  await ui.unmount()
})

test('a diagram with subgraphs gets wider gaps, without direction lines', async ($, on) => {
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

test('with no renderer present, the first diagram waits for the installer and draws with the renderer it installs; later diagrams run no installer', async ($, on) => {
  const files: string[] = []
  const { runs, installs, clock } = world(on, {
    files,
    install: () => {
      files.push(RENDERER)
      return { exitCode: 0, stdout: 'installed: mermaid-ascii\n', stderr: '' }
    },
  })
  const first = await $.ui.mount(message(REPLY))
  await clock.advance(1)

  expect(installs).toHaveLength(1)
  expect(installs[0]?.argv).toHaveLength(2)
  // The plugin root is this mod's directory on the host, with forward slashes.
  expect(installs[0]?.argv[1]).toMatch(/^[^\\]+\/mermaid-render\/scripts\/install-renderer\.sh$/)
  expect(installs[0]?.init?.timeoutMs).toBe(120_000)
  expect(runs.map(run => run.argv[0])).toEqual([RENDERER])
  expect(await first.find({ type: 'Text', text: '│ A │' })).toBeDefined()
  await first.unmount()

  const second = await $.ui.mount({ ...message(OTHER), requestId: 'm2' })
  await clock.advance(1)

  expect(installs).toHaveLength(1)
  expect(runs).toHaveLength(2)
  await second.unmount()
})

test('diagrams that wait at the same time share one install run, behind the placeholder', async ($, on) => {
  const { installs, clock } = world(on, {
    install: async clock => {
      await clock.sleep(1000)
      return INSTALL_FAILURE
    },
  })
  const ui = await $.ui.mount(message(`${DIAGRAM}\n\n${OTHER}`))
  await clock.advance(1)

  expect(installs).toHaveLength(1)
  expect(await ui.findAll({ type: 'Text', text: '[rendering diagram…]' })).toHaveLength(2)

  await clock.advance(1000)

  expect(installs).toHaveLength(1)
  expect(await ui.findAll({ type: 'Text', text: /^mermaid-render:/ })).toHaveLength(2)
  await ui.unmount()
})

test('with a renderer present, a diagram draws before the installer run ends, and a diagram that arrives during the run starts no second run', async ($, on) => {
  const { runs, installs, clock } = world(on, {
    files: [RENDERER],
    install: async clock => {
      await clock.sleep(1000)
      return { exitCode: 0, stdout: 'installed: mermaid-ascii\n', stderr: '' }
    },
  })
  const first = await $.ui.mount(message(REPLY))
  await clock.advance(1)

  expect(installs).toHaveLength(1)
  expect(installs[0]?.init?.timeoutMs).toBe(120_000)
  expect(await first.find({ type: 'Text', text: '│ A │' })).toBeDefined()

  const second = await $.ui.mount({ ...message(OTHER), requestId: 'm2' })
  await clock.advance(1)

  expect(installs).toHaveLength(1)
  expect(runs).toHaveLength(2)
  expect(await second.find({ type: 'Text', text: '│ A │' })).toBeDefined()

  await clock.advance(1000)
  await first.unmount()
  await second.unmount()
})

test('with a renderer present, one session starts only one background run', async ($, on) => {
  const { runs, installs, clock } = world(on, { files: [RENDERER] })
  const first = await $.ui.mount(message(`${DIAGRAM}\n\n${OTHER}`))
  await clock.advance(1)
  await first.unmount()

  const second = await $.ui.mount({ ...message('```mermaid\nflowchart LR\n  E --> F\n```'), requestId: 'm2' })
  await clock.advance(1)

  expect(installs).toHaveLength(1)
  expect(runs).toHaveLength(3)
  await second.unmount()
})

test('with a renderer present, two diagrams whose file lookups end at different times start only one run', async ($, on) => {
  let lookups = 0
  const { runs, installs, clock } = world(on, {
    files: [RENDERER],
    // The run starts after the first lookup and ends before the second ends.
    existsDelay: () => (++lookups === 1 ? 10 : 100),
    install: async clock => {
      await clock.sleep(10)
      return { exitCode: 0, stdout: '', stderr: '' }
    },
  })
  const ui = await $.ui.mount(message(`${DIAGRAM}\n\n${OTHER}`))
  await clock.advance(200)

  expect(runs).toHaveLength(2)
  expect(installs).toHaveLength(1)
  await ui.unmount()
})

test('with a renderer present, an installer run that cannot start changes nothing, and the session starts no other run', async ($, on) => {
  const { runs, installs, clock } = world(on, { files: [RENDERER], install: () => ({ deny: 'spawn sh ENOENT' }) })
  const first = await $.ui.mount(message(REPLY))
  await clock.advance(1)

  expect(await first.find({ type: 'Text', text: '│ A │' })).toBeDefined()
  expect(await first.find({ type: 'Text', text: /^mermaid-render:/ })).toBeUndefined()
  await first.unmount()

  const second = await $.ui.mount({ ...message(OTHER), requestId: 'm2' })
  await clock.advance(1)

  expect(installs).toHaveLength(1)
  expect(runs).toHaveLength(2)
  await second.unmount()
})

test('with no renderer present, an installer run that cannot start shows the reason and the manual command; the next diagram runs the installer again', async ($, on) => {
  const { runs, installs, clock } = world(on, { install: () => ({ deny: 'spawn sh ENOENT' }) })
  const first = await $.ui.mount(message(REPLY))
  await clock.advance(1)

  expect(runs).toHaveLength(0)
  expect(await first.find({ type: 'Markdown', text: DIAGRAM })).toBeDefined()
  const note = (await first.find({ type: 'Text', text: /^mermaid-render:/ }))?.text
  expect(note).toContain('spawn sh ENOENT')
  expect(note?.endsWith(` · install with: sh "${installs[0]?.argv[1]}"`)).toBe(true)
  await first.unmount()

  const second = await $.ui.mount({ ...message(OTHER), requestId: 'm2' })
  await clock.advance(1)

  expect(installs).toHaveLength(2)
  await second.unmount()
})

test('with a renderer present, a failed background run changes nothing, and the session starts no other run', async ($, on) => {
  const { runs, installs, clock } = world(on, { files: [RENDERER], install: () => INSTALL_FAILURE })
  const first = await $.ui.mount(message(REPLY))
  await clock.advance(1)

  expect(await first.find({ type: 'Text', text: '│ A │' })).toBeDefined()
  expect(await first.find({ type: 'Text', text: /^mermaid-render:/ })).toBeUndefined()
  await first.unmount()

  const second = await $.ui.mount({ ...message(OTHER), requestId: 'm2' })
  await clock.advance(1)

  expect(installs).toHaveLength(1)
  expect(runs).toHaveLength(2)
  await second.unmount()
})

test('when the install fails and no renderer is present, the code block shows the reason and the manual command; the next diagram runs the installer again', async ($, on) => {
  const { runs, installs, clock } = world(on, { install: () => INSTALL_FAILURE })
  const first = await $.ui.mount(message(REPLY))
  await clock.advance(1)

  expect(runs).toHaveLength(0)
  expect(installs).toHaveLength(1)
  expect(await first.find({ type: 'Markdown', text: DIAGRAM })).toBeDefined()
  expect((await first.find({ type: 'Text', text: /^mermaid-render:/ }))?.text).toBe(
    `mermaid-render: mermaid-ascii not installed: could not download · install with: sh "${installs[0]?.argv[1]}"`,
  )
  await first.unmount()

  const second = await $.ui.mount({ ...message(OTHER), requestId: 'm2' })
  await clock.advance(1)

  expect(installs).toHaveLength(2)
  await second.unmount()
})

test('after a failed install, a new drawing of the message runs no installer; the same diagram in a new message does', async ($, on) => {
  const files: string[] = []
  let calls = 0
  const { runs, installs, clock } = world(on, {
    files,
    install: () => {
      calls += 1
      if (calls === 1) return INSTALL_FAILURE
      files.push(RENDERER)
      return { exitCode: 0, stdout: '', stderr: '' }
    },
  })
  const first = await $.ui.mount(message(DIAGRAM))
  await clock.advance(1)
  await first.unmount()

  const again = await $.ui.mount(message(DIAGRAM))
  await clock.advance(1)

  expect(installs).toHaveLength(1)
  expect(await again.find({ type: 'Text', text: /^mermaid-render: .* install with: / })).toBeDefined()
  await again.unmount()

  const later = await $.ui.mount({ ...message(DIAGRAM), requestId: 'm2' })
  await clock.advance(1)

  expect(installs).toHaveLength(2)
  expect(runs).toHaveLength(1)
  expect(await later.find({ type: 'Text', text: '│ A │' })).toBeDefined()
  await later.unmount()
})

test('when the installer reports success and no renderer is present, the note says that mermaid-ascii is not installed', async ($, on) => {
  const { runs, installs, clock } = world(on)
  const ui = await $.ui.mount(message(REPLY))
  await clock.advance(1)

  expect(runs).toHaveLength(0)
  expect((await ui.find({ type: 'Text', text: /^mermaid-render:/ }))?.text).toBe(
    `mermaid-render: mermaid-ascii not installed · install with: sh "${installs[0]?.argv[1]}"`,
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

# Pane and agent workflows

Read this guide for terminal commands or recognized agents.
Apply the context gate and target rules in [the skill](../SKILL.md) first.
Examples use placeholders or variables populated from responses.
Do not paste placeholder targets literally.

## Create a sibling pane

Default to a sibling pane in the current tab and the caller's working directory.
Do not create a workspace, tab, worktree, or different working directory without the user's request.
Honor the user's requested split direction.
Otherwise inspect the caller's geometry:

```sh
herdr pane layout --pane "$caller_pane_id"
```

Split wide panes right.
Split narrow or tall panes down.
Avoid repeated splits that produce unusable columns or rows.
Use the checked caller ID when inherited context is unreliable.

```sh
herdr pane split --pane "$caller_pane_id" --direction right --cwd "$PWD" --no-focus
```

Use `down` instead of `right` when appropriate.
Read the new ID from `.result.pane.pane_id`.
Record that pane as a resource created for this task.
Check the returned working directory.

## Run an ordinary shell command

A pane can exist without a recognized agent.
Use pane commands for shells, tests, servers, and other ordinary processes.
Check pane output and foreground process information before sending a command:

```sh
herdr pane read "$pane_id" --source recent-unwrapped --lines 120
herdr pane process-info --pane "$pane_id"
```

Require an interactive shell prompt with the shell in the foreground.
An editor, foreground command, or suspended agent can make the pane unavailable.
Do not type commands into an unfamiliar foreground process.

```sh
herdr pane run "$pane_id" 'just test'
herdr pane wait-output "$pane_id" --match 'test result' --timeout 120000
herdr pane read "$pane_id" --source recent-unwrapped --lines 120
```

Replace the command and output condition with task-specific values.
`pane run` queues text and Enter.
Success proves admission only.
It does not prove execution or completion.
A second command can become typed-ahead input while the first command runs.

`wait-output` searches existing output immediately.
Old output or command echo can satisfy a weak match.
Use fresh completion evidence that command echo cannot satisfy.
Check the actual result and exit status when the task requires them.
Always supply a finite timeout.
Use `--regex` only when a Rust regular expression is necessary.

On macOS, the source documents a canonical line-input limit for `pane run` and `agent start`.
A rejection precedes queuing that submission.
Inspect shell readiness before another attempt.
This limit does not protect an earlier incomplete input line.

## Start and prompt a recognized agent

`agent start` requires an existing available shell pane.
It never creates or moves layout.
Use the agent kind requested by the user.
Read installed help for supported kinds and options.

```sh
herdr agent start reviewer --kind codex --pane "$pane_id"
```

Choose a unique live name matching `[a-z][a-z0-9_-]{0,31}`.
Put native agent arguments after `--`.
Agent targets accept a live name or its current pane ID.
They do not accept terminal IDs or bare agent kinds.

A successful start waits for recognition and readiness.
Startup normally has a 30-second timeout.
A blocked startup can return `agent_not_ready` while retaining the name.
Read the agent before any further input.
Do not answer an approval or question without the user's authority.

Check readiness before prompting:

```sh
herdr agent get reviewer
herdr agent read reviewer --source recent-unwrapped --lines 120
herdr agent prompt reviewer 'Review the current diff and report actionable findings.' --wait --timeout 120000
herdr agent read reviewer --source recent-unwrapped --lines 120
```

Replace the sample prompt with the authorized task.
Prompt success proves submission, not completion of the requested turn.
With `--wait`, Herdr normally waits for `idle`, `done`, or `blocked`.
Do not repeat these defaults through `--until`.
Use `--until` only for a specific state requirement.

| State | Meaning and action |
| --- | --- |
| `idle` | The agent appears ready. Inspect output for the requested result. |
| `working` | The agent appears active. Wait with a finite timeout. |
| `blocked` | Herdr recognized a question or approval. Read it and ask the user for the required decision. |
| `done` | Herdr recorded an unseen completion. Check the requested result. |
| `unknown` | Herdr cannot classify the agent confidently. Inspect output and foreground identity. |

A retained name does not prove the same process or a foreground agent.
Suspended agents can retain names and stale lifecycle states.
Focus can mark a completion seen.
Different UI instances can show different completion badges.
Background jobs can continue after an agent becomes idle.
A settled wait does not identify an individual turn.
If the agent was already working, an earlier turn can satisfy the wait.

After `timeout`, `agent_prompt_stalled`, disconnection, or uncertain delivery, inspect state and output.
Do not blindly repeat the prompt.
Do not bypass `agent_blocked` through raw pane input.
Logical keys such as `esc` and `ctrl+c` affect interactive UI state.
Send them only when the authorized workflow requires that action.

## Read results and clean up

Prefer `recent-unwrapped` for logs and transcripts.
Use `visible` for the current viewport.
Use `recent` when rendered wrapping matters.
Use `detection` for the bottom-buffer detection snapshot.
Request `--format ansi` only when terminal styling is evidence.

More `--lines` cannot guarantee recovery of alternate-screen history.
If a completed response remains unavailable, ask the agent to write a temporary Markdown file on the same machine.
Use file output only as a fallback.
Read the bounded file as data.
Check the requested result before reporting completion.

Stop only processes owned by this task.
Close only owned panes after checking their current occupants.
Remove temporary files after recording and checking the result.
Do not close unrelated panes to restore geometry.

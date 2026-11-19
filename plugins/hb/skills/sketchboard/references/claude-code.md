# Claude Code: sketchboard

These notes apply to the feedback loop in Claude Code.

## Wait

- Run `sketchboard wait <canvas>` with the Bash tool and `run_in_background: true`.
- The harness tells you when the command exits. Then read its output.
- Do not poll the output. Do not run `sleep` while the command runs.
- Do not use `--timeout` for a background `wait`.
- Run one `wait` at a time. If a background `wait` runs, do not start another one. The running `wait` gets the next feedback.
- When the user says that the design is complete, stop the background `wait`. Use the `TaskStop` tool with the task ID from the result of the background Bash command.

## Locate and edit

- Save the `wait` output to a file in the scratchpad folder of the session. Do not save it in the canvas folder.
- Run `sketchboard locate`, then read the board file one time with the Read tool, then run `locate` again. Repeat only if a `line` or `col` value is different.
- After your own Edit, do not read the file again and do not run `locate` again only because you wrote it. The Edit tool does not need a new Read after your own Edit.
- The Edit tool can apply a write after another program changes the file. It can warn that the file changed.
- If Edit reports a file change or refuses the write, stop. Read the file again. Check the result of the write. Find your noted elements again before any further write.

# Socket fallback and errors

Read this guide when installed help shows no CLI operation for the requested capability.
Apply [the skill's context and target rules](../SKILL.md) first.
Prefer a supported CLI command when one exists.
Do not switch transports to repeat an uncertain mutation.

## Inspect the current contract

```sh
herdr api schema --json
herdr status --json
```

The schema comes from the installed binary, not necessarily the running server.
Compare schema protocol, server protocol, versions, and capability flags.
Do not assume compatibility merely because the CLI binary is newer.
Use only methods and shapes supported by the actual server.

The captured source describes protocol 22 and schema version 1.
It has API-only methods such as `layout.export`, `layout.apply`, and `layout.set_split_ratio`.
There is no `herdr layout` group in that capture.
`herdr pane layout` is a different inspection operation.
Do not invent `herdr api call`.

## Construct a bounded request

Use the checked API socket path from `HERDR_SOCKET_PATH` and server status.
Do not use `herdr-client.sock` or the SSH agent socket as an API endpoint.
The API uses a Unix stream socket and UTF-8 NDJSON.
It does not use HTTP, bearer tokens, API keys, or authentication headers.
OS socket permissions control access.
A process with socket access can control the session.

If temporary transport code is necessary, use one helper named `request_once` for all requests.
Give it an absolute total deadline and a maximum response size before connection.
Use one bounded file reader named `read_bounded_file` if temporary code reads files.
Search temporary code for other socket and file-read call sites.
Keep all such operations inside these helpers.
Do not ship these helpers with the skill.

For `request_once`, require these steps:

1. Serialize one object with a JSON serializer.
2. Include a string `id`, a string `method`, and an object `params`.
3. Append one LF byte.
4. Open one connection to the checked socket.
5. Send the complete line within the total deadline.
6. Read through the response LF within the deadline and size limit.
7. Parse the complete JSON response.
8. Check the response ID and the expected result type or error code.
9. Close the connection on success and every failure.

Set explicit finite bounds suitable for the operation.
A timeout that restarts after each byte is not a total deadline.
Treat EOF before LF, invalid JSON, wrong IDs, and oversized replies as failures.
A transport failure after sending can leave mutation delivery uncertain.
Inspect state before another mutation.

Send `ping` first on its own connection:

```json
{"id":"probe-1","method":"ping","params":{}}
```

Expect `result.type` equal to `pong`.
Read its `version`, `protocol`, and `capabilities`.
There is no protocol negotiation or credential handshake.

A normal connection carries one request and one response.
Open a new connection for every later request.
Two documented exceptions keep connections open:

- `events.subscribe` sends an acknowledgement followed by event lines.
- `server.ssh_agent.register` keeps its registration only while its connection remains open.

Neither exception permits a second request on that connection.
Use a separate bounded workflow for subscriptions or registration.
Do not apply the single-response close rule to those workflows.

## Example: export a layout

Discover the tab ID on the same server first.
Replace the example ID with that response value.

```json
{"id":"layout-1","method":"layout.export","params":{"tab_id":"w1:t1"}}
```

Expect `result.type` equal to `layout_export` and a `result.layout` object.
Use either `tab_id` or `pane_id`, never both.
Do not send `workspace_id` to select this method's target.
Unknown extra fields can be ignored silently.
An unsupported field can therefore select an unintended default target.

An exported layout is not a complete environment backup.
The source reports missing pane environment values in exported results.
`layout.apply` can start commands and replace an existing tab with new IDs.
Do not apply an exported tree as a harmless inspection or retry.
Check its exact target and destructive effects first.

## Handle typed results and errors

Success contains `id` and a typed `result` object.
Failure contains `id` and `error` instead of `result`.
Use `error.code` for decisions.
Do not parse unstable message text as a contract.
Malformed requests can return an empty ID.
The source records an `events.wait` error-ID suffix exception.
Check the installed contract before implementing that workflow.

| Code or condition | Required action |
| --- | --- |
| `invalid_request` | Check the method, required fields, types, and installed schema. |
| `unknown_method` | Check server support. Do not update or restart without authorization. |
| `pane_not_found`, `agent_not_found`, `workspace_not_found` | Rediscover targets on the intended server. Do not guess replacement IDs. |
| `agent_not_ready`, `agent_pane_busy` | Inspect the foreground process, shell, and agent state. |
| `agent_blocked` | Read the approval or question. Ask the user for the required decision. |
| `agent_prompt_stalled`, `timeout` | Inspect state and output. Do not assume input was absent. |
| Disconnect or missing response | Treat delivery as uncertain after sending. Inspect before retrying. |
| `workspace_group_close_required` | Check group scope. Do not add a group close automatically. |

Record incomplete or uncertain results plainly.
Never report command admission or a settled lifecycle state as proof of the requested task's completion.

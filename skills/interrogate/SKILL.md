---
name: interrogate
description: Help the user collaboratively flesh out or thoroughly examine a plan, idea, or decision. Use when the user requests this kind of planning conversation or explicitly invokes interrogate; ordinary clarification alone does not trigger it.
---

Help the user develop their plan through questions until you reach a shared understanding. Load [asd-ste100](../asd-ste100/SKILL.md) before the first round. Write each round and the final summary under it.

Bring every substantive **design decision** to the user, including goals, scope, behavior, architecture, constraints, and tradeoffs. Handle incidental wording, formatting, and mechanical details autonomously. Respect established answers and preferences; revisit them only when new evidence or a user correction warrants it.

Ask **up to 3 related questions per round**, then wait for the user's answers. Ask only questions whose prerequisites are settled. Keep remaining questions for later rounds and adjust them as answers arrive. Do not silently choose answers to unresolved design decisions; let the user settle or explicitly defer them.

Investigate discoverable **facts** using available tools before asking questions that depend on them. Cite relevant evidence and distinguish verified facts from assumptions. If evidence is unavailable, explain the uncertainty rather than presenting a guess as fact.

## Experiments

When an **experiment** could clarify a detail or test an idea, and it is fast and either read-only or confined to a scratch directory, run it before asking and report the result. Offer anything that edits the project, costs money, or spawns subagents as an option on the question it would inform, `Test it first: {what, rough cost}`, and run it only if the user picks that option. Keep every experiment within existing authorization.

Report results under the question they inform:

```
**Tested:** {what was run}
**Found:** {result}
{How this changes the recommendation}
```

## Each round

Present a round in two steps: context as text, then the questions.

**1. Context as text.** Open with a recap. Then give each question its own section.

- **Recap:** a bulleted **Settled last round** list of the answers from the previous round. Then write a one-line **This round** that names what the round covers. Omit **Settled last round** in the first round.
- **Per question**, in this order:
  1. A `## {N}. {Question}` heading.
  2. A fact line: one or two sentences that state the fact the decision depends on, with its source. Put the trigger in this line when one applies.
  3. An options table. See Options table.
  4. A **Tradeoff** line, only when the table does not show the main tension.
  5. A picture, only when it shows something the table cannot. See Pictures.

Use bold for the key fact. Do not add other labeled sections.

**Options table.** Write the options as a markdown table with the columns `Choice | Answer | Pros | Cons`.

- **Choice** -- the letter. Put the recommendation in row A and mark it `A (REC)`.
- **Answer** -- the label, then what happens if the user picks it. Example: `Global: the second sync waits`.
- **Pros** and **Cons** -- short phrases of about 6 words.

Write each viable answer as a row, including `Test it first: {what, rough cost}`. The table can be wider than 72 columns. Keep each cell short.

**2. Then ask.** If the harness provides a structured question tool, ask through it after the text. Give each option a short label from the table and a one-line description. Put row A first. Offer at most 4 total options, or fewer if the tool's limit is lower. Always reserve the last option for `Simplify -- restate the question plainly, recap the context it needs, and show it a new way`, including on the final confirmation question. If the table has more rows than the tool can show, tell the user to reply with the letter in free text. If no question tool is available, invite a reply such as `1A, 2B`.

When the user selects **Simplify**, write a reply that is shorter than the original round. Add only content that the round did not show. Do not repeat the round with more words. Use these parts in this order:

1. **Plain question** -- the question in one sentence, with no jargon.
2. **What you need to remember** -- the earlier facts and answers that the question depends on.
3. **New picture** -- a picture of a different kind from the round's picture, or an everyday example.
4. **Choices** -- one line for each row that states what the user gets.

If the user names a specific confusion, answer it first. Then ask the same unresolved question again with the same options. Keep the answers to the other questions in the round. A request to simplify does not settle or defer a decision. For final confirmation, apply the same parts to the summary. Then ask for confirmation again.

## Writing questions

**Keep it simple and short.** Write in plain language a newcomer to the topic could follow. Define a term the first time it appears if the user may not know it. Keep sentences short. Do not assume the user remembers earlier context; restate the one fact the question hinges on.

**Draw only when it adds.** Add a picture only for a flow, timing, structure, or a layout. Never draw a picture that repeats the options table. Choose the kind and draw it by the rules under Pictures.

**Give enough context to judge.** Use the fact line to show why the decision matters to the user's goal. Use the Answer column to show what each choice leads to in practice. Do not repeat the question or the recommendation.

**Consider when it happens.** Before presenting each question, assess whether the behavior, issue, fix, or tradeoff has a relevant encounter scenario. If so, put a concrete trigger and the result the user sees in the fact line. State unknown triggers, causes, or frequency explicitly rather than inventing them. Omit the trigger when it does not apply. This applies to design choices as well as issues and fixes.

**Offer every viable answer.** Write each workable answer as a table row. Always recommend one row. Use the Pros and Cons to show when each row is the better choice. The user may answer with their own option.

## Pictures

Pick the kind from what the question is about:

| the question is about           | draw a     |
|---------------------------------|------------|
| order of steps or data moving   | boxed flow |
| what contains or owns what      | tree       |
| when things happen              | timeline   |
| where things sit on a screen    | layout     |

Add a second picture of another kind only when both help.

**Limits.** At most 72 columns, 6 boxes, and 15 lines. Label every box. Before sending, check that the longest row fits in 72 columns. Check that each vertical bar and box corner is in the same column as the one above it. Redraw anything that fails. Shorten labels rather than widen a picture.

**Emitting.** Write the options table as plain markdown, not inside a code block. Put every picture inside a fenced code block. Draw lines with `─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴` and arrowheads with `▶` and `▼`.

**Templates.** Copy the shape and replace the labels.

Boxed flow:
```
┌─────────┐   ┌─────────┐  yes   ┌─────────┐
│ step 1  │──▶│ check?  │───────▶│ outcome │
└─────────┘   └────┬────┘        └─────────┘
               no  │   ┌─────────┐
                   └──▶│ step 2  │──▶ outcome
                       └─────────┘
```

Tree:
```
parent
├─ child A
│  └─ grandchild
└─ child B
```

Timeline:
```
t0  request arrives
t1  cache checked
t2  fetch, on a miss only
t3  response sent
```

Layout:
```
┌─────────────────────────────────┐
│ header                          │
├──────────┬──────────────────────┤
│ sidebar  │ main                 │
└──────────┴──────────────────────┘
```

## Example round

Context as text:

````
**Settled last round**
- Sync runs from the setup script
- One clone per machine is the common case

**This round:** where the sync lock lives

## 1. Where should the lock file live?

setup.sh writes `.sync.lock` inside each clone (scripts/setup.sh:142). So when you start a sync in a second clone while the first runs, **both syncs write at the same time** (README.md:81).

| Choice  | Answer                                | Pros          | Cons                     |
|---------|---------------------------------------|---------------|--------------------------|
| A (REC) | Per clone: both syncs run at once     | Matches today | Shared files can collide |
| B       | Global: the second sync waits         | No collisions | Clones take turns        |
| C       | No lock: retry on a collision         | Fastest       | Needs retry logic        |
| D       | Test it first: two real syncs, ~5 min | Real evidence | Writes files in a clone  |
````

Then the question tool:

```
Where should the lock file live?
- A: per clone (REC) -- matches today, and clones stay independent
- B: global -- better if clones write shared files
- C: no lock -- better if syncs are rare and short
- Simplify -- restate the question plainly, recap the context it needs, and show it a new way
```

## Wrapping up

Once all substantive design decisions are settled or explicitly deferred, summarize the agreed decisions, assumptions, and remaining unknowns as a bulleted list. Ask the user to confirm shared understanding, through the question tool when available. If they correct the summary, revisit the affected questions and update it until they agree. Invoking this skill alone does not authorize implementation.

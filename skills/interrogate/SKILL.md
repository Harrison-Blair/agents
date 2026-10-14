---
name: interrogate
description: Help the user collaboratively flesh out or thoroughly examine a plan, idea, or decision. Use when the user requests this kind of planning conversation or explicitly invokes interrogate; ordinary clarification alone does not trigger it.
---

Help the user develop their plan through questions until you reach a shared understanding.

Bring every substantive **design decision** to the user, including goals, scope, behavior, architecture, constraints, and tradeoffs. Handle incidental wording, formatting, and mechanical details autonomously. Respect established answers and preferences; revisit them only when new evidence or a user correction warrants it.

Ask **up to 4 related questions per round**, then wait for the user's answers. Ask only questions whose prerequisites are settled. Keep remaining questions for later rounds and adjust them as answers arrive. Do not silently choose answers to unresolved design decisions; let the user settle or explicitly defer them.

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

**1. Context as text.** Open with a recap, then give each question its own section.

- **Recap:** a bulleted **Settled** list of decisions so far, then a one-line **This round** naming what the round covers. Compress settled items to a few words; group or summarize older ones as the list grows. Omit **Settled** when nothing is settled yet.
- **Per question:** a `## {N}. {Question}` heading followed by short bold-labeled sections. Use markdown emphasis to highlight the key fact or tradeoff. Omit empty sections.
  - **Now** or **Known** -- the relevant facts, with sources.
  - **Picture** -- a small picture built from the rules and templates under Pictures: a markdown table, or line art in a fenced code block.
  - **When you'll encounter this** -- the triggering action or condition, its cause when known, where or when it occurs in the user's workflow, and what the affected user would notice. State whether it is routine or conditional only when evidence supports that distinction.
  - **Why it matters** -- the consequences and main tradeoffs, plus any assumption or uncertainty that could change the choice.
  - **Other options** -- viable answers that do not fit in the response options, if any, including experiments. Explain how the user can choose them in a free-text reply.

**2. Then ask.** If the harness provides a structured question tool, ask through it after the text. Keep each question short and give each option a one-line reason. Put the recommended decision option first and mark it recommended. Offer at most 4 total options, or fewer if the tool's limit is lower. Always reserve the last option for `Explain more -- explain the scenario and choices before I decide`, including on the final confirmation question. Put any further viable answers in **Other options**. If no question tool is available, list the options under each question's section, lettered A, B, C, and invite a reply such as `1A, 2B`.

When the user selects **Explain more**, explain the scenario, unfamiliar terms, and practical consequences in simpler language. Address any specific confusion they mention, then re-ask the same unresolved question with its options. Preserve settled answers; requesting clarification does not settle or defer a decision. For final confirmation, explain the summary and ask for confirmation again.

## Writing questions

**Keep it simple and short.** Write in plain language a newcomer to the topic could follow. Define a term the first time it appears if the user may not know it. Keep sentences short. Do not assume the user remembers earlier context; restate the one fact the question hinges on.

**Draw by default.** Give each question a picture whenever it involves a comparison, a flow, a relationship, a data model, a layout, or timing. Choose the kind and draw it by the rules under Pictures. Skip it only for trivial questions where words alone are clearer.

**Give enough context to judge.** Explain why the decision matters to the user's goal and what each choice leads to in practice. Scale the detail to the decision rather than repeating the question or the recommendation.

**Consider when it happens.** Before presenting each question, assess whether the behavior, issue, fix, or tradeoff has a relevant encounter scenario. If so, include **When you'll encounter this** with a concrete trigger and user-visible experience. State unknown triggers, causes, or frequency explicitly rather than inventing them. Omit the section when it does not apply. This applies to design choices as well as issues and fixes.

**Offer every viable answer.** Include each genuinely workable answer in the response options or **Other options**, while reserving the clarification option. Always recommend one decision option and say why in a sentence; give each alternative a sentence on when it would be the better choice. The user may answer with their own option.

## Pictures

Pick the kind from what the question is about:

| the question is about           | draw a     |
|---------------------------------|------------|
| options side by side            | table      |
| order of steps or data moving   | boxed flow |
| what contains or owns what      | tree       |
| when things happen              | timeline   |
| where things sit on a screen    | layout     |

Add a second picture of another kind only when both help, for example a table of the options plus a flow of the one option that is hard to imagine.

**Limits.** At most 72 columns, 6 boxes, and 15 lines, for tables as well as line art. Label every box. Before sending, check that the longest row fits in 72 columns and that every vertical bar, box corner, and table pipe sits in the same column as the one above it; redraw anything that does not. Shorten cell text and labels rather than widen a picture.

**Emitting.** Write a table as plain markdown, not inside a code block; every harness renders it. Put every other kind inside a fenced code block. Draw lines with `─ │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴` and arrowheads with `▶` and `▼`.

**Templates.** Copy the shape and replace the labels.

Table (emit without the fence):
```
| option    | what differs | cost |
|-----------|--------------|------|
| per clone | ...          | ...  |
| global    | ...          | ...  |
```

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
**Settled**
- Sync runs from the setup script
- One clone per machine is the common case

**This round:** where the sync lock lives

## 1. Where should the lock file live?

**Known**
- setup.sh writes `.sync.lock` inside the clone (scripts/setup.sh:142)
- Two clones on one machine can sync at the same time today (README.md:81)

**Picture**
| option    | lock path            | who waits for whom          |
|-----------|----------------------|-----------------------------|
| per clone | <clone>/.sync.lock   | nobody; clones run together |
| global    | ~/.agents/.sync.lock | every clone takes turns     |

**When you'll encounter this**
When you start a sync in a second clone while the first is still running, a per-clone lock lets both proceed. If both write the same shared files, their writes can overlap; a global lock makes the second sync wait. How often this happens depends on whether you run overlapping syncs from multiple clones.

**Why it matters**
The lock decides **which syncs wait for each other**. Per-clone locks let clones sync in parallel but leave *shared files* unprotected; a global lock makes every clone take turns.

**Other options**
Test it first: run two real syncs against a spare clone (~5 min, writes files). Choose this by replying `Test it first` if you want evidence before deciding.
````

Then the question tool:

```
Where should the lock file live?
- Per clone (recommended) -- matches today's location and keeps clones independent
- Global under ~/.agents -- better if clones write shared files
- No lock; retry on conflict -- better if syncs are rare and short
- Explain more -- explain the scenario and choices before I decide
```

## Wrapping up

Once all substantive design decisions are settled or explicitly deferred, summarize the agreed decisions, assumptions, and remaining unknowns as a bulleted list. Ask the user to confirm shared understanding, through the question tool when available. If they correct the summary, revisit the affected questions and update it until they agree. Invoking this skill alone does not authorize implementation.

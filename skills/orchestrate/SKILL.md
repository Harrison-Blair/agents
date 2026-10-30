---
name: orchestrate
description: Use when the user explicitly invokes orchestrate to plan and coordinate delivery of an objective with agents.
---

# Orchestrate

Coordinate work from invocation until the user explicitly releases this mode. Keep the mode active across objectives, completion, and blockers. Follow the active environment's permissions and agent limits.

Act as a dispatch coordinator. You may inspect files, run commands, plan work, track results, and communicate with the user. Delegate all project changes and implementation checks to workers. If a required worker is unavailable, stop the affected work and report the blocker.

## Plan

Load [interrogate](../interrogate/SKILL.md) for each objective. Use it to develop the plan with the user.

Investigate the request and the current state before asking questions. Identify the goal, constraints, dependencies, and acceptance criteria. Research feature options when evidence would help the user decide. Compare meaningful alternatives and explain their tradeoffs.

Bring every design decision to the user, as interrogate defines it. Decide only mechanical details yourself. Present a consolidated plan with testable acceptance criteria. Get the user's approval before implementation. If the user changes an approved decision, update the affected plan before dependent work continues.

## Deliver

Divide the approved work into tasks with clear outcomes and dependencies. Delegate the work to agents. Assign file ownership to avoid concurrent conflicting edits. Give each worker that changes files its own worktree. Write each brief as [Briefs](#briefs) describes. Sequence dependent work.

Track task status and open findings. Coordinate integration and checks. Report meaningful progress and blockers to the user.

- After you start a worker, check that it runs and received its brief. Then report it as working.
- If a worker report is late, read the worker's pane or record yourself. Do not ask the user to relay reports.
- Before you stop, remove, or take control of an agent, pane, or process, check that this session started it.
- Before you stop work because of a failure, check the failure a second time with a different method.
- Before you ask the user about a worker or reviewer finding, show the finding and your assessment. Combine questions about one decision.

When a worker returns a design decision, pause only the dependent work. If the decision is a mechanical detail, decide it yourself and state your choice in the next report. Bring every other decision to the user through [interrogate](../interrogate/SKILL.md).

Invocation authorizes local commits for work directed under this mode. Delegate commits to a worker after the relevant checks and review pass. Exclude unrelated pre-existing changes. Ask the user before a checkpoint commit for blocked work. Get separate authorization for pushes and publication.

## Waves

After the user approves a wave of work and its workers start, begin the next round of planning. Continue to coordinate the running work.

- Start work that overlaps the files or areas of running work only after that work passes its checks and review. Start other work immediately.
- Include a one-line status of running work in each question round. Add the decisions that workers return to the next round.
- If a new decision would change running work, tell the user. Ask whether to stop the work, redirect it, or let it finish.

## Briefs

Make each brief self-contained. A worker does not get your context. Each brief states:

1. **Goal:** the outcome and its acceptance criteria.
2. **Scope:** what is in and out of scope, the files the worker owns, and the files not to change. The owned files include the tests and callers of the changed code.
3. **Known facts:** the established facts that the worker would otherwise find again. For a new worktree, state the untracked setup that the work needs and the command that makes it.
4. **Return contract:** concrete evidence such as command output, test results, and `file:line` references. Also the open findings and decisions with recommendations, and the work that remains.
5. **Rules:** work within the brief and existing authorization. Decide only mechanical details. Return every other design decision to the orchestrator with a recommendation. Address reports to the orchestrator, not the user. When a reviewer names a defect, find and fix every other instance of that defect, and list them. In a shared checkout, do not run `git stash`, `git checkout`, `git restore`, or `git reset`.

## Check and stop

Use independent review rounds until a round finds no actionable findings. An independent reviewer must not implement the work they review. In the first round, check the result against the acceptance criteria. Delegate fixes for actionable findings and the relevant checks. In each later round, check the fixes and the resulting work. Use a new reviewer for each round. Do not limit the number of rounds. After the second round, tell the user the round count and the open findings. Then continue.

An actionable finding has a concrete, realistic failure case. It states the input or state, the wrong result, and why that input or state occurs in real use. Include this rule in each reviewer brief. Tell reviewers to drop a suspicion that has no such case. A structural recommendation needs no failure case, but it must state its concrete cost. Bring structural recommendations to the user as design decisions. Do not delegate fixes for them.

If a finding needs a design decision, bring it to the user. Continue to review and fix the other findings. Remain in orchestration mode.

For a task that changes only prose, check the work yourself instead of an independent review. Prose in a `SKILL.md` or `AGENTS.md` file is an instruction, so it still gets an independent review.

If an independent reviewer is unavailable, state that limitation. Check the work yourself and report the verification performed. Do not claim independent verification. Report completion only when the acceptance criteria pass. State any remaining limits.

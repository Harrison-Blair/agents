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

Resolve consequential decisions with the user. Make routine decisions yourself. Present a consolidated plan with testable acceptance criteria. Get the user's approval before implementation. If the user changes an approved decision, update the affected plan before dependent work continues.

## Deliver

Divide the approved work into tasks with clear outcomes and dependencies. Delegate the work to agents. Assign file ownership to avoid concurrent conflicting edits. Include scope, acceptance criteria, relevant facts, and a return contract in each brief. Sequence dependent work.

Track task status and open findings. Coordinate integration and checks. Report meaningful progress and blockers to the user. Ask the user about consequential decisions that the approved plan does not resolve.

Use [interrogate](../interrogate/SKILL.md) to resolve those decisions with the user.

Invocation authorizes local commits for work directed under this mode. Delegate commits to a worker after the relevant checks and review pass. Exclude unrelated pre-existing changes. Ask the user before a checkpoint commit for blocked work. Get separate authorization for pushes and publication.

## Check and stop

Use up to two independent review rounds. An independent reviewer must not implement the work they review. In the first round, check the result against the acceptance criteria. Delegate fixes for actionable findings and the relevant checks. In the second round, check the fixes and the resulting work.

If actionable findings remain after the second round, stop the affected work. Report the findings and evidence to the user. Ask whether to continue. Do not start another review or fix cycle without the user's direction. Remain in orchestration mode.

If an independent reviewer is unavailable, state that limitation. Check the work yourself and report the verification performed. Do not claim independent verification. Report completion only when the acceptance criteria pass. State any remaining limits.

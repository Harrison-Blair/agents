import assert from "node:assert/strict";
import { test } from "node:test";
import { withHerdrBlocked } from "../pi/ask-user-question/herdr.ts";

test("Herdr is blocked while the question is open and restored after it closes", async () => {
  const previous = process.env.HERDR_ENV;
  process.env.HERDR_ENV = "1";
  const reports: unknown[] = [];
  const events = { emit: (name: string, data: unknown) => { reports.push([name, data]); } };
  let close!: (value: string) => void;
  try {
    const result = withHerdrBlocked(events, () => new Promise<string>((resolve) => { close = resolve; }));
    assert.deepEqual(reports, [["herdr:blocked", { active: true, label: "Waiting for user answers" }]]);
    close("answer");
    assert.equal(await result, "answer");
    assert.deepEqual(reports[1], ["herdr:blocked", { active: false }]);
    await assert.rejects(withHerdrBlocked(events, async () => { throw new Error("UI failed"); }), /UI failed/);
    assert.deepEqual(reports.slice(-1), [["herdr:blocked", { active: false }]]);
    delete process.env.HERDR_ENV;
    reports.length = 0;
    assert.equal(await withHerdrBlocked(events, async () => "answer"), "answer");
    assert.deepEqual(reports, []);
  } finally {
    if (previous === undefined) delete process.env.HERDR_ENV;
    else process.env.HERDR_ENV = previous;
  }
});

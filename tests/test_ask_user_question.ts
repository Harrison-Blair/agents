// Tests for pi/ask-user-question/logic.ts. Run: node --test tests/test_ask_user_question.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  apply,
  formatResult,
  initialState,
  type Question,
  tabWindow,
  validate,
} from "../pi/ask-user-question/logic.ts";

const single: Question = {
  question: "Which color?",
  header: "Color",
  options: [
    { label: "Red", description: "warm" },
    { label: "Blue", description: "cool" },
  ],
};

const multi: Question = {
  question: "Which toppings?",
  header: "Toppings",
  multiSelect: true,
  options: [
    { label: "Cheese", description: "" },
    { label: "Olives", description: "" },
    { label: "Ham", description: "" },
  ],
};

test("one single-select question submits as soon as an option is chosen", () => {
  const s = initialState([single]);
  assert.equal(apply(s, [single], { type: "move", delta: 1 }), false);
  assert.equal(apply(s, [single], { type: "choose" }), true);
  assert.equal(formatResult([single], s.answers).text,
    `User has answered your questions: "Which color?"="Blue". You can now continue with the user's answers in mind.`);
});

test("digit keys pick an option directly", () => {
  const s = initialState([single, multi]);
  assert.equal(apply(s, [single, multi], { type: "pick", index: 1 }), false);
  assert.equal(s.tab, 1);
  apply(s, [single, multi], { type: "pick", index: 2 });
  apply(s, [single, multi], { type: "pick", index: 0 });
  assert.deepEqual(formatResult([single, multi], s.answers).structured.answers.map((a) => a.answers), [
    ["Blue"],
    ["Cheese", "Ham"],
  ]);
});

test("multi-select toggles options and keeps them in option order", () => {
  const qs = [single, multi];
  const s = initialState(qs);
  s.tab = 1;
  apply(s, qs, { type: "move", delta: 2 });
  apply(s, qs, { type: "toggle" }); // Ham
  apply(s, qs, { type: "move", delta: -2 });
  apply(s, qs, { type: "toggle" }); // Cheese
  apply(s, qs, { type: "move", delta: 1 });
  apply(s, qs, { type: "toggle" }); // Olives on
  apply(s, qs, { type: "toggle" }); // Olives off
  assert.deepEqual(s.answers[1].selected, [0, 2]);
});

test("Enter on a multi-select question with nothing selected stays put", () => {
  const qs = [single, multi];
  const s = initialState(qs);
  s.tab = 1;
  assert.equal(apply(s, qs, { type: "choose" }), false);
  assert.equal(s.tab, 1);
  apply(s, qs, { type: "toggle" });
  apply(s, qs, { type: "choose" });
  assert.equal(s.tab, 2);
});

test("Enter on the Other row of a multi-select question moves on", () => {
  const qs = [single, multi];
  const s = initialState(qs);
  s.tab = 1;
  apply(s, qs, { type: "move", delta: 3 });
  apply(s, qs, { type: "other", text: "Pineapple" });
  apply(s, qs, { type: "choose" });
  assert.equal(s.tab, 2);
});

test("the cursor stops at the Other row and at the top", () => {
  const s = initialState([single]);
  apply(s, [single], { type: "move", delta: 5 });
  assert.equal(s.cursor[0], 2);
  apply(s, [single], { type: "move", delta: -9 });
  assert.equal(s.cursor[0], 0);
});

test("Other text replaces a single-select choice and blank text clears it", () => {
  const qs = [single, multi];
  const s = initialState(qs);
  apply(s, qs, { type: "choose" });
  s.tab = 0;
  apply(s, qs, { type: "other", text: "  Green  " });
  assert.equal(s.tab, 1);
  assert.deepEqual(s.answers[0], { selected: [], other: "Green", note: "" });
  s.tab = 0;
  apply(s, qs, { type: "other", text: "   " });
  assert.equal(s.tab, 0);
  assert.equal(s.answers[0].other, "");
});

test("Other text adds to multi-select choices", () => {
  const qs = [single, multi];
  const s = initialState(qs);
  s.tab = 1;
  apply(s, qs, { type: "toggle" });
  apply(s, qs, { type: "other", text: "Pineapple" });
  assert.equal(s.tab, 1);
  assert.deepEqual(formatResult(qs, s.answers).structured.answers[1].answers, ["Cheese", "Pineapple"]);
});

test("review sends you to the first unanswered question before it submits", () => {
  const qs = [single, multi];
  const s = initialState(qs);
  apply(s, qs, { type: "choose" });
  apply(s, qs, { type: "tab", delta: 1 });
  assert.equal(s.tab, 2);
  assert.equal(apply(s, qs, { type: "submit" }), false);
  assert.equal(s.tab, 1);
  apply(s, qs, { type: "toggle" });
  apply(s, qs, { type: "tab", delta: 1 });
  assert.equal(apply(s, qs, { type: "submit" }), true);
});

test("tabs stop at the first question and at the review tab", () => {
  const qs = [single, multi];
  const s = initialState(qs);
  apply(s, qs, { type: "tab", delta: -1 });
  assert.equal(s.tab, 0);
  apply(s, qs, { type: "tab", delta: 9 });
  assert.equal(s.tab, 2);
  const one = initialState([single]);
  apply(one, [single], { type: "tab", delta: 1 });
  assert.equal(one.tab, 0);
});

test("notes appear in the text and the structured result", () => {
  const qs = [single, multi];
  const s = initialState(qs);
  apply(s, qs, { type: "note", text: " only on weekends " });
  apply(s, qs, { type: "choose" });
  apply(s, qs, { type: "toggle" });
  apply(s, qs, { type: "choose" });
  const r = formatResult(qs, s.answers);
  assert.equal(r.text,
    `User has answered your questions: "Which color?"="Red" user notes: only on weekends, ` +
      `"Which toppings?"="Cheese". You can now continue with the user's answers in mind.`);
  assert.deepEqual(r.structured, {
    declined: false,
    answers: [
      { question: "Which color?", header: "Color", answers: ["Red"], notes: "only on weekends" },
      { question: "Which toppings?", header: "Toppings", answers: ["Cheese"] },
    ],
  });
});

test("validate rejects duplicate questions and duplicate labels", () => {
  assert.equal(validate([single, multi]), null);
  assert.match(validate([single, { ...multi, question: "Which color?" }]) ?? "", /Duplicate question/);
  const dup = { ...single, options: [single.options[0], { label: "Red", description: "again" }] };
  assert.match(validate([dup]) ?? "", /Duplicate option label "Red"/);
});

test("tabWindow keeps the current tab visible and fills the space", () => {
  const w = [10, 10, 10, 10, 10];
  assert.deepEqual(tabWindow(w, 0, 100, 2), [0, 5]);
  // Room for 3 tabs (10+2+10+2+10 = 34).
  assert.deepEqual(tabWindow(w, 0, 34, 2), [0, 3]);
  assert.deepEqual(tabWindow(w, 4, 34, 2), [2, 5]);
  assert.deepEqual(tabWindow(w, 2, 34, 2), [2, 5]);
  assert.deepEqual(tabWindow(w, 2, 33, 2), [2, 4]);
  // The current tab shows even when it alone is too wide.
  assert.deepEqual(tabWindow(w, 3, 5, 2), [3, 4]);
});

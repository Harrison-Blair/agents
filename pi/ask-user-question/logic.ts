// Pure state and formatting for the AskUserQuestion tool. No Pi imports, so
// `node --test` can load it directly.

export interface Option {
  label: string;
  description: string;
  preview?: string;
}

export interface Question {
  question: string;
  header: string;
  options: Option[];
  multiSelect?: boolean;
}

export interface Answer {
  selected: number[]; // option indices, in option order
  other: string; // free text; "" when unused
  note: string;
}

export interface State {
  tab: number; // question index; questions.length is the review tab
  cursor: number[]; // per question; options.length is the "Other" row
  answers: Answer[];
}

export type Action =
  | { type: "move"; delta: number }
  | { type: "tab"; delta: number }
  | { type: "pick"; index: number } // digit key: focus the option, then choose it
  | { type: "choose" } // Enter on a question
  | { type: "toggle" } // Space on a multi-select question
  | { type: "other"; text: string }
  | { type: "note"; text: string }
  | { type: "submit" }; // Enter on the review tab

export type StructuredAnswer = {
  question: string;
  header: string;
  answers: string[];
  notes?: string;
};

export type StructuredResult = {
  declined: boolean;
  answers: StructuredAnswer[];
};

export const DECLINED_TEXT =
  "The user declined to answer the questions. Stop and wait for the user to tell you how to proceed.";

// Checks that the schema cannot express. Returns an error message or null.
export function validate(questions: Question[]): string | null {
  const seen = new Set<string>();
  for (const q of questions) {
    if (seen.has(q.question)) return `Duplicate question: "${q.question}". Each question must be unique.`;
    seen.add(q.question);
    const labels = new Set<string>();
    for (const o of q.options) {
      if (labels.has(o.label)) return `Duplicate option label "${o.label}" in question "${q.question}".`;
      labels.add(o.label);
    }
  }
  return null;
}

export function initialState(questions: Question[]): State {
  return {
    tab: 0,
    cursor: questions.map(() => 0),
    answers: questions.map(() => ({ selected: [], other: "", note: "" })),
  };
}

export function isAnswered(a: Answer): boolean {
  return a.selected.length > 0 || a.other !== "";
}

// The tab after the last question: the review tab, or none for one question.
export function lastTab(questions: Question[]): number {
  return questions.length === 1 ? 0 : questions.length;
}

// Applies an action in place. Returns true when the answers are ready to submit.
export function apply(state: State, questions: Question[], action: Action): boolean {
  const q = questions[state.tab];
  const a = state.answers[state.tab];
  const advance = (): boolean => {
    if (questions.length === 1) return true;
    state.tab += 1;
    return false;
  };

  switch (action.type) {
    case "tab":
      state.tab = Math.min(lastTab(questions), Math.max(0, state.tab + action.delta));
      return false;
    case "submit": {
      if (q) return false;
      const missing = state.answers.findIndex((x) => !isAnswered(x));
      if (missing === -1) return true;
      state.tab = missing;
      return false;
    }
  }

  if (!q) return false;
  const otherRow = q.options.length;
  const cursor = state.cursor[state.tab];

  switch (action.type) {
    case "move":
      state.cursor[state.tab] = Math.min(otherRow, Math.max(0, cursor + action.delta));
      return false;
    case "pick":
      state.cursor[state.tab] = action.index;
      return q.multiSelect
        ? apply(state, questions, { type: "toggle" })
        : apply(state, questions, { type: "choose" });
    case "toggle": {
      if (!q.multiSelect || cursor === otherRow) return false;
      const i = a.selected.indexOf(cursor);
      if (i === -1) a.selected = [...a.selected, cursor].sort((x, y) => x - y);
      else a.selected.splice(i, 1);
      return false;
    }
    case "choose":
      if (q.multiSelect) return isAnswered(a) ? advance() : false;
      if (cursor === otherRow) return false; // the UI opens the text editor instead
      a.selected = [cursor];
      a.other = "";
      return advance();
    case "other":
      a.other = action.text.trim();
      if (q.multiSelect || a.other === "") return false;
      a.selected = [];
      return advance();
    case "note":
      a.note = action.text.trim();
      return false;
  }
}

export function answerLabels(q: Question, a: Answer): string[] {
  const labels = a.selected.map((i) => q.options[i].label);
  if (a.other !== "") labels.push(a.other);
  return labels;
}

export function formatResult(
  questions: Question[],
  answers: Answer[],
): { text: string; structured: StructuredResult } {
  const parts: string[] = [];
  const structured: StructuredAnswer[] = [];
  questions.forEach((q, i) => {
    const a = answers[i];
    const labels = answerLabels(q, a);
    let part = `"${q.question}"="${labels.join(", ")}"`;
    if (a.note !== "") part += ` user notes: ${a.note}`;
    parts.push(part);
    const entry: StructuredAnswer = { question: q.question, header: q.header, answers: labels };
    if (a.note !== "") entry.notes = a.note;
    structured.push(entry);
  });
  return {
    text: `User has answered your questions: ${parts.join(", ")}. You can now continue with the user's answers in mind.`,
    structured: { declined: false, answers: structured },
  };
}

// Picks the tabs to show when they do not all fit. `widths` are the display
// widths of each tab; tabs are joined by `gap` columns. Returns [start, end).
// Grows from the current tab, rightward first, while the total fits `available`.
export function tabWindow(widths: number[], current: number, available: number, gap: number): [number, number] {
  let start = current;
  let end = current + 1;
  let used = widths[current];
  for (;;) {
    const right = end < widths.length ? used + gap + widths[end] : Infinity;
    if (right <= available) {
      used = right;
      end += 1;
      continue;
    }
    const left = start > 0 ? used + gap + widths[start - 1] : Infinity;
    if (left <= available) {
      used = left;
      start -= 1;
      continue;
    }
    return [start, end];
  }
}

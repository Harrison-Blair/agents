// Terminal UI for AskUserQuestion: tabs, options, previews, and text editors
// for "Other" answers and notes.
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  Editor,
  type EditorTheme,
  Key,
  type KeyId,
  matchesKey,
  type TUI,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
  type Action,
  answerLabels,
  apply,
  initialState,
  isAnswered,
  lastTab,
  type Question,
  type State,
  tabWindow,
} from "./logic.ts";

// Below this width, previews go under the options instead of beside them.
export const SIDE_BY_SIDE_MIN_WIDTH = 100;

const TAB_GAP = 2;

export function createQuestionUI(
  tui: TUI,
  theme: Theme,
  questions: Question[],
  done: (state: State | null) => void,
): Component {
  const state = initialState(questions);
  let editing: "other" | "note" | null = null;
  let cached: { width: number; lines: string[] } | undefined;

  const editorTheme: EditorTheme = {
    borderColor: (s) => theme.fg("accent", s),
    selectList: {
      selectedPrefix: (t) => theme.fg("accent", t),
      selectedText: (t) => theme.fg("accent", t),
      description: (t) => theme.fg("muted", t),
      scrollInfo: (t) => theme.fg("dim", t),
      noMatch: (t) => theme.fg("warning", t),
    },
  };
  const editor = new Editor(tui, editorTheme);
  editor.onSubmit = (value) => {
    const kind = editing;
    closeEditor();
    if (kind) act({ type: kind, text: value });
  };

  function refresh() {
    cached = undefined;
    tui.requestRender();
  }

  function act(action: Action) {
    if (apply(state, questions, action)) done(state);
    else refresh();
  }

  function openEditor(kind: "other" | "note", text: string) {
    editing = kind;
    editor.setText(text);
    editor.focused = true;
    refresh();
  }

  function closeEditor() {
    editing = null;
    editor.focused = false;
    editor.setText("");
    refresh();
  }

  function handleInput(data: string) {
    if (editing) {
      if (matchesKey(data, Key.escape)) closeEditor();
      else {
        editor.handleInput(data);
        refresh();
      }
      return;
    }
    if (matchesKey(data, Key.escape)) return done(null);
    if (matchesKey(data, Key.left)) return act({ type: "tab", delta: -1 });
    if (matchesKey(data, Key.right)) return act({ type: "tab", delta: 1 });

    const q = questions[state.tab];
    if (!q) {
      if (matchesKey(data, Key.enter)) act({ type: "submit" });
      return;
    }
    const a = state.answers[state.tab];
    const onOther = state.cursor[state.tab] === q.options.length;
    if (matchesKey(data, Key.up)) return act({ type: "move", delta: -1 });
    if (matchesKey(data, Key.down)) return act({ type: "move", delta: 1 });
    if (matchesKey(data, Key.tab)) return openEditor("note", a.note);
    // On "Other", the key that would select or toggle a row opens the text editor.
    if (onOther && matchesKey(data, q.multiSelect ? Key.space : Key.enter)) return openEditor("other", a.other);
    if (matchesKey(data, Key.enter)) return act({ type: "choose" });
    if (matchesKey(data, Key.space)) return act({ type: "toggle" });
    for (let d = 1; d <= q.options.length; d++) {
      if (matchesKey(data, String(d) as KeyId)) return act({ type: "pick", index: d - 1 });
    }
  }

  function wrap(text: string, width: number, prefix = ""): string[] {
    const pw = visibleWidth(prefix);
    const lines = wrapTextWithAnsi(text, Math.max(1, width - pw));
    return lines.map((l, i) => (i === 0 ? prefix : " ".repeat(pw)) + l);
  }

  function tabBar(width: number): string[] {
    const labels = questions.map((q, i) => `${isAnswered(state.answers[i]) ? "✓" : "○"} ${q.header}`);
    labels.push("Review");
    const widths = labels.map((l) => visibleWidth(l) + 2);
    // Leave room for the "‹ " and " ›" scroll markers.
    const [start, end] = tabWindow(widths, state.tab, Math.max(1, width - 4), TAB_GAP);
    const shown = labels.slice(start, end).map((l, j) => {
      const text = ` ${l} `;
      return start + j === state.tab
        ? theme.style(text, { fg: "accent", bold: true, inverse: true })
        : theme.fg("muted", text);
    });
    const left = start > 0 ? theme.fg("dim", "‹ ") : "  ";
    const right = end < labels.length ? theme.fg("dim", " ›") : "";
    return [truncateToWidth(left + shown.join(" ".repeat(TAB_GAP)) + right, width), ""];
  }

  function optionLines(q: Question, width: number): string[] {
    const a = state.answers[state.tab];
    const cursor = state.cursor[state.tab];
    const lines: string[] = [];
    const rows = [...q.options, { label: "Other", description: "" }];
    rows.forEach((o, i) => {
      const isOther = i === q.options.length;
      const focused = i === cursor;
      const chosen = isOther ? a.other !== "" : a.selected.includes(i);
      const mark = q.multiSelect ? (chosen ? "[x]" : "[ ]") : chosen ? "(•)" : "( )";
      const num = isOther ? "  " : `${i + 1}.`;
      let label = `${num} ${mark} ${o.label}`;
      if (isOther && a.other !== "") label += `: ${a.other}`;
      const prefix = focused ? theme.fg("accent", "> ") : "  ";
      lines.push(...wrap(theme.fg(focused ? "accent" : "text", label), width, prefix));
      if (o.description) lines.push(...wrap(theme.fg("muted", o.description), width, "         "));
    });
    if (a.note !== "") {
      lines.push("");
      lines.push(...wrap(theme.fg("muted", a.note), width, theme.fg("dim", "  note: ")));
    }
    return lines;
  }

  function previewLines(q: Question, width: number): string[] {
    const o = q.options[state.cursor[state.tab]];
    if (!o?.preview) return [theme.fg("dim", "(no preview)")];
    return o.preview.split("\n").map((l) => truncateToWidth(l, width));
  }

  function questionLines(q: Question, width: number): string[] {
    const lines = wrap(theme.style(q.question, { fg: "text", bold: true }), width, " ");
    lines.push("");
    if (!q.options.some((o) => o.preview)) return [...lines, ...optionLines(q, width)];

    if (width < SIDE_BY_SIDE_MIN_WIDTH) {
      lines.push(...optionLines(q, width));
      lines.push(theme.fg("dim", "─".repeat(width)));
      lines.push(...previewLines(q, width));
      return lines;
    }
    const leftWidth = Math.floor(width * 0.4);
    const sep = theme.fg("dim", " │ ");
    const left = optionLines(q, leftWidth);
    const right = previewLines(q, width - leftWidth - 3);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
      const l = left[i] ?? "";
      lines.push(l + " ".repeat(Math.max(0, leftWidth - visibleWidth(l))) + sep + (right[i] ?? ""));
    }
    return lines;
  }

  function reviewLines(width: number): string[] {
    const lines = wrap(theme.style("Review your answers", { fg: "text", bold: true }), width, " ");
    lines.push("");
    questions.forEach((q, i) => {
      const a = state.answers[i];
      const value = isAnswered(a)
        ? theme.fg("accent", answerLabels(q, a).join(", "))
        : theme.fg("warning", "(unanswered)");
      lines.push(...wrap(`${theme.fg("muted", `${q.header}:`)} ${value}`, width, "  "));
      if (a.note !== "") lines.push(...wrap(theme.fg("muted", a.note), width, theme.fg("dim", "    note: ")));
    });
    return lines;
  }

  function hint(): string {
    if (editing === "other") return "Enter save answer • Esc back";
    if (editing === "note") return "Enter save note • Esc back";
    const nav = lastTab(questions) > 0 ? " • ←/→ questions" : "";
    const q = questions[state.tab];
    if (!q) return `Enter submit${nav} • Esc decline`;
    const select = q.multiSelect ? "Space toggle • Enter next" : "Enter select";
    return `↑/↓ move • ${select} • Tab note${nav} • Esc decline`;
  }

  function render(width: number): string[] {
    if (cached?.width === width) return cached.lines;
    const w = Math.max(1, width);
    const lines = [theme.fg("accent", "─".repeat(w))];
    if (lastTab(questions) > 0) lines.push(...tabBar(w));
    const q = questions[state.tab];
    lines.push(...(q ? questionLines(q, w) : reviewLines(w)));
    if (editing) {
      lines.push("");
      lines.push(...wrap(theme.fg("muted", editing === "other" ? "Your answer:" : "Note:"), w, " "));
      for (const l of editor.render(Math.max(1, w - 2))) lines.push(` ${l}`);
    }
    lines.push("");
    lines.push(...wrap(theme.fg("dim", hint()), w, " "));
    lines.push(theme.fg("accent", "─".repeat(w)));
    cached = { width, lines };
    return lines;
  }

  return {
    render,
    handleInput,
    invalidate: () => {
      cached = undefined;
    },
  };
}

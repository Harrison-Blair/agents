// Pi extension: an AskUserQuestion tool like Claude Code's, for the terminal UI only.
// Linked into ~/.pi/agent/extensions/ask-user-question by scripts/setup.sh.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
  DECLINED_TEXT,
  formatResult,
  type Question,
  type State,
  type StructuredResult,
  validate,
} from "./logic.ts";
import { createQuestionUI } from "./ui.ts";

const NAME = "AskUserQuestion";

const OptionSchema = Type.Object({
  label: Type.String({ description: "The text of the option. Use 1 to 5 words." }),
  description: Type.String({ description: "What this option means, or what happens if the user selects it." }),
  preview: Type.Optional(
    Type.String({
      description:
        "Text that shows next to the options when this option has focus. Use it for code, mockups, or diagrams that the user must compare. The text shows in a monospace font.",
    }),
  ),
});

const QuestionSchema = Type.Object({
  question: Type.String({ description: "The full question. End it with a question mark." }),
  header: Type.String({ maxLength: 12, description: "A short label for the tab bar. Use 12 characters or fewer." }),
  options: Type.Array(OptionSchema, {
    minItems: 2,
    maxItems: 4,
    description:
      'The options. Give 2 to 4 options. Do not add an "Other" option. The tool always adds a free-text "Other" option.',
  }),
  multiSelect: Type.Optional(
    Type.Boolean({ description: "Set to true to let the user select more than one option. The default is false." }),
  ),
});

const Params = Type.Object({
  questions: Type.Array(QuestionSchema, { minItems: 1, maxItems: 10, description: "The questions. Give 1 to 10." }),
});

const OutputSchema = Type.Object({
  declined: Type.Boolean(),
  answers: Type.Array(
    Type.Object({
      question: Type.String(),
      header: Type.String(),
      answers: Type.Array(Type.String()),
      notes: Type.Optional(Type.String()),
    }),
  ),
});

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: NAME,
    label: "Ask User Question",
    description: [
      "Ask the user 1 to 10 questions with fixed options, and wait for the answers.",
      "Use this tool when you need a decision from the user to continue.",
      "Use it to get preferences, to make vague instructions clear, or to let the user choose between approaches.",
      'Each question has 2 to 4 options and a free-text "Other" option. The user can also add a note to each answer.',
      'If you recommend an option, put it first and add "(Recommended)" to its label.',
      "If the user declines, stop and wait for the next user message.",
    ].join(" "),
    promptSnippet: "Ask the user questions with fixed options, and wait for the answers.",
    parameters: Params,
    outputSchema: OutputSchema,
    executionMode: "sequential",

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (ctx.mode !== "tui") throw new Error(`${NAME} needs the interactive terminal UI.`);
      const questions = params.questions as Question[];
      const problem = validate(questions);
      if (problem) throw new Error(problem);

      const state = await ctx.ui.custom<State | null>((tui, theme, _kb, done) =>
        createQuestionUI(tui, theme, questions, done),
      );
      const { text, structured } = state
        ? formatResult(questions, state.answers)
        : { text: DECLINED_TEXT, structured: { declined: true, answers: [] } };
      return { content: [{ type: "text", text }], details: structured, structuredContent: structured };
    },

    renderCall(args, theme) {
      const headers = Array.isArray(args.questions) ? args.questions.map((q: Question) => q.header).join(", ") : "";
      return new Text(theme.fg("toolTitle", theme.bold(`${NAME} `)) + theme.fg("muted", headers), 0, 0);
    },

    renderResult(result, _options, theme) {
      const details = result.details as StructuredResult | undefined;
      if (!details) {
        const first = result.content[0];
        return new Text(first?.type === "text" ? first.text : "", 0, 0);
      }
      if (details.declined) return new Text(theme.fg("warning", "Declined"), 0, 0);
      const lines = details.answers.map((a) => {
        let line = `${theme.fg("success", "✓ ")}${theme.fg("muted", `${a.header}: `)}${theme.fg("accent", a.answers.join(", "))}`;
        if (a.notes) line += theme.fg("dim", ` (note: ${a.notes})`);
        return line;
      });
      return new Text(lines.join("\n"), 0, 0);
    },
  });

  // Headless modes cannot show the UI, so the model must not see the tool there.
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") pi.setActiveTools(pi.getActiveTools().filter((name) => name !== NAME));
  });
}

# Design craft

Use this guidance when you write boards. If the user's brief or a design system gives a direction, follow it. This guidance applies only where they leave a choice open.

## Start from the subject

- Find the subject, the audience, and the main task of the design before you write a board.
- If the brief does not state them, write a short proposal. Ask the user to approve it.
- Take visual ideas from the subject itself: its materials, its tools, its vocabulary, and its history. A tide table for sailors and a reading app for children need different designs.
- Use real content from the project. Use the real names, real numbers, and real text of the product.
- If you do not know a fact, use a clear placeholder, for example `[Price]` or `[Customer name]`. Do not invent facts, people, or statistics.

## The first view

- Decide what the user sees first. Show the most specific thing about the subject, for example the main data, the product, or the main action.
- Do not use a large number with a small label and a gradient accent unless the content needs it. That layout is a common default.
- Put one strong element on each board. Keep the other elements quiet.

## Type

- Use one typeface family or two. If you use two, make them clearly different, for example a serif and a sans-serif.
- Choose typefaces for this subject. Do not use the same families on every project.
- Set a type scale with few steps. Give each step one role.
- Keep body lines to 80 characters or fewer.
- Do not mark one word of a headline with a different color or style.
- Do not put an all-caps label above every heading.

## Color

- Choose a small palette: four to six named colors.
- Write the palette to the `tokens.css` file of the design system. Use the tokens in every board.
- Use one accent color for actions and the main highlight. Do not use the accent for decoration.

## Layout and structure

- Use borders, numbers, and dividers only when they carry information. Use numbered markers only for a real sequence, for example steps or a timeline.
- Give elements different shapes when they have different roles. Do not put all content in identical rounded cards with the same shadow.
- Align content to a grid. Decide the alignment of each area, for example left or center.
- Use motion only when the user does an action, or once to show the main element.

## Defaults to avoid

These looks appear on many generated pages, whatever the subject. Use one only when the brief asks for it:

- A cream background with a serif headline and a terracotta accent.
- A near-black background with one acid-green or bright-red accent.
- A newspaper layout with thin rules, square corners, and dense columns.
- A grid of identical cards with gradient washes.
- Text strings joined with middle dots, labels in monospace, and an arrow after each link.

## Words

- Write words from the point of view of the person who uses the product. Name things by what they do, not by how the system works.
- Give each button a label that says what it does, for example "Save changes". Use the same word for the action in the button and in its result.
- In an error message, say what went wrong and how to fix it.
- On an empty screen, tell the user the next action.

## Accessibility

- Use a `<button>` element for an action and an `<a>` element for navigation.
- Give each form field a `<label>` element.
- Give each meaningful image an `alt` text.
- Make the contrast between body text and its background 4.5:1 or more. Make the contrast of large text 3:1 or more.
- Do not show a state with color alone. Add text, an icon, or a shape.
- Show a visible focus style on each control that the keyboard can reach.
- Respect the `prefers-reduced-motion` setting.

## Check the result

- Compare each board with the brief. Find each part that looks like a default for any similar page. Change that part.
- If a decoration does not help the user, remove it.

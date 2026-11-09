// Herdr's Pi integration listens for these events when running inside Herdr.
export async function withHerdrBlocked<T>(
  events: { emit: (event: string, data: { active: boolean; label?: string }) => void },
  show: () => Promise<T>,
): Promise<T> {
  if (process.env.HERDR_ENV !== "1") return show();
  events.emit("herdr:blocked", { active: true, label: "Waiting for user answers" });
  try {
    return await show();
  } finally {
    events.emit("herdr:blocked", { active: false });
  }
}

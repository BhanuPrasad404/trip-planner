// The save step's suggested first day: the next Saturday (a trip usually starts on a weekend) in the month the traveller said, or the
// next Saturday from today. Only a suggestion: the traveller confirms or changes it, or chooses "no dates yet".
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const DAY = 86_400_000;

export function suggestStartDate(todayISO: string, month: number | null | undefined): string {
  const today = Date.parse(`${todayISO}T00:00:00Z`);
  const tomorrow = today + DAY; // never today: a trip needs at least a day to get ready
  const nextSaturday = (from: number) => from + ((6 - new Date(from).getUTCDay() + 7) % 7) * DAY;
  if (!month || month < 1 || month > 12) return iso(nextSaturday(tomorrow));
  // That month this year, or next year when no day of it is left.
  let y = new Date(today).getUTCFullYear();
  if (Date.UTC(y, month, 1) - DAY < tomorrow) y++;
  const first = Math.max(tomorrow, Date.UTC(y, month - 1, 1));
  const sat = nextSaturday(first);
  // The month they said wins over the weekend: if its last Saturday has passed, the first free day in it.
  return iso(new Date(sat).getUTCMonth() === month - 1 ? sat : first);
}

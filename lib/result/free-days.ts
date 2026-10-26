// Days of the trip that have no card (no drive, no places). The planner only makes days that hold something, so a spare day used to
// vanish and the list jumped from Day 2 to Day 4. This says which day numbers are missing, so the screen can show them as free days.
export type FreeDay = { day: number; /** After the last planned day: the plan is finished earlier than the trip. */ trailing: boolean };

export function freeDays(planned: number[], totalDays: number): FreeDay[] {
  const have = new Set(planned);
  const last = planned.length ? Math.max(...planned) : 0;
  const out: FreeDay[] = [];
  for (let d = 1; d <= Math.max(0, Math.floor(totalDays)); d++) if (!have.has(d)) out.push({ day: d, trailing: d > last });
  return out;
}

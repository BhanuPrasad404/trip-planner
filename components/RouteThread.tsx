"use client";

type RouteThreadProps = {
  numDays: number;
  activeDay: number;
  onSelectDay: (day: number) => void;
  startDate?: string | null; // ISO date, optional — shows weekday labels if provided
};

export function RouteThread({ numDays, activeDay, onSelectDay, startDate }: RouteThreadProps) {
  const days = Array.from({ length: numDays }, (_, i) => i + 1);

  function labelFor(day: number) {
    if (!startDate) return `Day ${day}`;
    const d = new Date(startDate);
    d.setDate(d.getDate() + (day - 1));
    return d.toLocaleDateString("en-IN", { weekday: "short" });
  }

  return (
    <div className="bg-pine px-5 pt-1.5 pb-5 relative">
      <div className="flex items-center relative px-1">
        {/* Dotted thread line */}
        <div
          className="absolute top-[15px] left-5 right-5 h-[2px]"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.35) 0 6px, transparent 6px 12px)",
            backgroundSize: "12px 2px",
            backgroundRepeat: "repeat-x",
          }}
        />
        {days.map((day) => {
          const isActive = day === activeDay;
          return (
            <button
              key={day}
              onClick={() => onSelectDay(day)}
              className="relative flex-1 flex flex-col items-center gap-1.5 z-10"
            >
              <div
                className={`w-[30px] h-[30px] rounded-full flex items-center justify-center font-mono text-xs border-2 transition-colors ${
                  isActive
                    ? "bg-marigold border-marigold text-pine font-bold"
                    : "bg-white/10 border-white/30 text-white/70"
                }`}
              >
                {day}
              </div>
              <span
                className={`text-[10px] font-semibold ${
                  isActive ? "text-white" : "text-white/55"
                }`}
              >
                {labelFor(day)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

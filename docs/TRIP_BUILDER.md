# Smart Trip Builder (update 31)

"I have 5 days and these 12 places" → real roads, real time budget, clusters, three complete plans, and the reasons.

## Where it lives
| Layer | Files |
|---|---|
| Pure engine (no I/O, no AI, deterministic) | `lib/trip-builder/*` |
| Data loading + signature | `lib/server/builder.ts` |
| API | `POST /api/trips/[id]/builder` (preview, saves nothing) · `POST …/builder/apply` (re-computes on the server, atomic) · `PATCH /api/places/[id] {priority}` |
| Screen | `components/builder/TripBuilder.tsx` (on the Plan tab; the map previews the chosen option) |
| Database | `supabase/migrations/20261012000000_place_priority.sql` → `places.priority`, `places.visit_minutes` |

## How a plan is made (each step is a separate, tested function)
1. **Road matrix** from the routing service (start + places + optional end). Straight-line distance is only used inside the cluster/direction cues, never shown as driving distance. If routing is down the plan says "estimates".
2. **Reality check** (`reality.ts`): drive (best route) + time at places + parking/breaks vs `days × realistic daily capacity` (NOT 24 h × days). Meals/rest are shown but not double counted.
3. **Clusters** (`clusters.ts`): average-linkage on ROAD minutes (≤55 min link, compact), so "close on the map, far by road" is not a cluster.
4. **Route order** (`tour.ts`): nearest-neighbour + 2-opt + or-opt, fixed start, optional fixed end. The old Auto-plan now uses the same code.
5. **Days** (`partition.ts`): dynamic programming — exactly K days, every day within capacity and max-drive, balanced, and a small penalty for cutting a cluster across two days.
6. **If it does not fit** (`plan.ts`): drop the stop with the least value per minute saved. **Must-do places are never dropped**; if even they don't fit, the plan says so and shows the overflow.
7. **Inside a day** (`schedule.ts`): for ≤7 stops every order is tried against opening hours (when KNOWN), waiting for openings, golden hour (day may start up to 3 h later to reach a viewpoint at sunset), and finishing before dark. Weather: a small swap pass moves a rain-sensitive place to a better-forecast day when the extra driving ≤25 min.
8. **Explain + warn** (`explain.ts`): per-stop reasons, why each day ends where it does, and warnings (too much driving, over capacity, closed on arrival, late arrival, weather, heavy streak, doubling back, estimated times…). Every sentence is built from the numbers used — no LLM writes reasons.
9. **Options**: Balanced / Relaxed / Explorer are the SAME engine with different numbers in `config.ts` (also Scenic, Photography, Family, Road trip available).

## Honest limits (not built yet)
- **Opening hours**: used only when known. User-added places have none, so every stop shows "hours unknown" — we never assume open.
- **Lock / force a day** for a stop: not built (priority Must/Important/Normal/Maybe is).
- **Discover places along the route** ("what's worth visiting here?"), adding map taps or traveller-feed items directly to the builder: not built. "Add back" only covers places you already listed.
- **Traveller media / Plan-vs-reality learning / personalisation**: not connected yet.
- **Map**: the preview colours stops by day and shows the compass; cluster outlines and road-geometry lines per day are not drawn yet.
- Time zone: destination = IST by default (device offset elsewhere is not applied).
- Trips already under way use "Re-plan from now"; the builder refuses to rewrite finished stops.

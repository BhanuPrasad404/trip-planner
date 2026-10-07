# Testing Trailmate with real friends

Goal: find out what confuses real people **before** you show this to anyone important.
Time needed: about 45 minutes per session. Best with 3–5 friends, ideally planning a trip they *actually* want to take.

## 1. Before the session (10 minutes, you)

- [ ] All database migrations are applied (`supabase db push --db-url ...`, no pending files).
- [ ] The app is deployed (or running on your laptop and reachable — see "No deployment yet?" below).
- [ ] `ANTHROPIC_API_KEY` and `GEOCODER_USER_AGENT` are set (AI import needs the key).
- [ ] You created a trip yourself first, with a destination, and added 2–3 places. Make sure it works.
- [ ] You have the invite link ready to send on WhatsApp.

**No deployment yet?** For anything that uses location (Drive mode, navigation) a phone needs **HTTPS** — browsers refuse to share location over plain `http://YOUR-LAPTOP-IP:3000`. Deploy (Vercel) or use an HTTPS tunnel: see `docs/MOBILE_TESTING.md`. Pages that do not need location can still be viewed over the local network.

## 2. The session — give them the tasks, then stay quiet

Tell them: *"I'm testing the app, not you. If something is confusing, that's my fault. Please think out loud."*
**Do not help** unless they are stuck for more than a minute. Write down where they pause or frown.

| # | Task (read it to them) | Success looks like |
|---|---|---|
| 1 | "Create an account and start a trip to a place you'd like to visit." | Trip created with a destination, no help needed |
| 2 | "Add three places you'd want to see." | 3 places on the map, in the **right state** |
| 3 | "Is every pin in the right place? Fix any that aren't." | They find and use "Wrong location?" |
| 4 | "Which of your places is a bad idea for your dates, and why?" | They read the Go score / season info and understand it |
| 5 | "Invite one friend, and ask them to vote on the places." | Friend joins from the link and votes |
| 6 | "Plan the whole trip." | They find **Auto-plan route** |
| 7 | "Send the plan to someone." | They find **Share the plan** |
| 8 | "Tell me what you'd change." | A real opinion, not "it's fine" |

## 3. What to write down (the real gold)

For each task: **did they finish? how long? did they ask for help? what did they say?**

- Where did they hesitate?
- What did they click that did nothing?
- What words did they not understand? (Go score? Ideas? Auto-plan?)
- Did any pin look wrong? Which place, and what did the app show? (Screenshot it.)
- Did anything break or show a red error? (Screenshot + what they just did.)

## 4. Questions to ask at the end

1. "In one sentence, what is this app for?" *(If they can't say it, the landing page needs work.)*
2. "Would you use it for your next trip? Why or why not?"
3. "What was the most useful thing? What was the most annoying?"
4. "What would you tell a friend about it?"
5. "What did you expect to find that wasn't there?"

## 5. Pin accuracy check (do this yourself, 10 minutes)

For 10 places across 2–3 different trips:
1. Open the stop → read the 📍 address under the name.
2. Click the marker on the map; compare with Google Maps for the same place.
3. Mark each as ✅ exact (within ~1 km), 🟡 close (within ~10 km) or ❌ wrong.

**Target before you show investors/seniors: at least 8 of 10 ✅, and no ❌ that the app failed to warn about.**

## 6. Reading the feedback people send inside the app

Supabase dashboard → **Table Editor** → **feedback**. Sort by `created_at`. Each row has the person's rating (1–5), message and the page they were on.

## 7. Be honest with testers about the current limits

- Place search uses a free public map service, so it is sometimes slow or picks the wrong match — that's why the "Wrong location?" button exists.
- Season information is researched but covers only **Andhra Pradesh and Telangana** so far; other regions show weather-based scores only.
- Go scores and driving times are estimates.
- It's an early version. Please be kind and brutally honest.

## 8. Is it ready to show to senior people?

Tick all of these:

- [ ] 4 out of 5 friends finish tasks 1–3 **without help**
- [ ] Pin check: 8/10 exact, and every wrong pin carried a warning
- [ ] Nobody hit a red error during the session
- [ ] At least 3 friends can say, in their own words, what Trailmate is for
- [ ] At least 2 friends say they'd use it for a real trip
- [ ] Auto-plan produced a day plan that a friend said "yeah, that makes sense"

If you miss any, fix those first and run another round with different people.

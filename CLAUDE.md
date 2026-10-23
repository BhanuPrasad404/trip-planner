@AGENTS.md

# Standing rules from the project owner

- No zip files. Edit the project directly.
- No commit or push without asking first.
- Keep reports short: what was tested, what could not be verified, what to test on the phone.
- No page may be wider than the phone at 360, 390 and 412 px; new screens are added to `tests/phone-width.test.ts` (`scripts/phone-width.tsx`).
- Use theme colours and variables (Tailwind theme tokens, CSS variables in `app/globals.css`), not fixed colour values, so the look can be changed later.

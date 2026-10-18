<!-- Thanks for contributing. Keep this short; the diff says most of it. -->

## What this changes

<!-- The symptom, not just the fix. "`pnpm vitest run` read as a build"
     tells the next reader more than "update kindOfSegment". -->

## How it was verified

<!-- Which test fails without this change? -->

## Checklist

- [ ] `node --test` passes
- [ ] A test covers the change, and fails without it
- [ ] Every session log in a test is built in code (`test/helpers.mjs`), never copied from a real session
- [ ] `CHANGELOG.md` has an entry under `## [Unreleased]` if a user would notice

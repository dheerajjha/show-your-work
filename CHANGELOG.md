# Changelog

## [Unreleased]

## [0.1.3] - 2026-10-23

### Fixed

- **More test runners count as test runs.** `bazel test` read as a build.
  `turbo run test`, `hatch test`, `pants test` and `dune test` read as
  something else entirely, so a true "tests pass" after any of them was
  stopped. They all count now, and so do `dune runtest`, `dune build
  @runtest`, `hatch run test` and turbo through npx, pnpm or yarn.
  `bazel build` is still a build (#4, #10, from @dbdefault).
- **`audit` refuses a bad `--days` or `--limit`.** A value that wasn't a
  positive number was quietly read as "all time" or ignored. `--days`
  followed by a folder audited the default folder instead. Each now exits 2
  and says which option needs a number. `check` exits 2 too, for an unknown
  option or a missing file, so a script can tell a mistyped command (2) from
  an unbacked claim (1) (#6, #9, from @dbdefault).

## [0.1.2] - 2026-10-21

### Fixed

- **A subagent's mix, swift or bun report counts.** A subagent might run the
  tests and report `4 tests, 0 failures` (ExUnit), `Executed 3 tests, with 0
  failures` (Swift) or `Ran 3 tests across 1 file.` (Bun). A true "tests
  pass" after one was stopped as having no test behind it. Those reports now
  back the claim. A failing suite's line still wins over a later passing one,
  and a report of zero tests still backs nothing (#5, #8, from @dbdefault).
- **A Bun failure hidden by `|| true`.** `bun test || true` that printed
  ` 1 fail` and exited 0 read as a pass. It now reads as failed, as mix, swift
  and pytest runs already did (#8).

## [0.1.1] - 2026-10-20

### Fixed

- **Zero tests from more runners.** A run of rspec, ExUnit, `swift test`, deno
  or ctest that executed no tests now counts as zero tests, so "tests pass"
  after one is stopped, as it already was after pytest, jest or `node --test`.
  A run that printed a zero-test summary for one suite or app but ran tests in
  another, like a Swift package with one empty test class or an Elixir umbrella
  with one empty app, still counts as run (#7).

## [0.1.0] - 2026-10-09

First release.

- **A skill, `show-your-work`.** It tells the agent to back every "tests pass",
  "it builds" and "it works" with the command it ran after its last edit and
  the line of output that proves it, and to say what it did not check.
- **A Stop hook for Claude Code** that holds the final message up against the
  session log. It stops the agent once when a claim has nothing behind it:
  - no matching check after the last edit;
  - the last check failed, including a failure that a pipe, `|| true` or the
    project's own test script hid;
  - zero tests ran;
  - "all tests pass" came from a run of one file;
  - a cited command never ran.
- **`show-your-work audit`**, the same check over your past sessions, run
  locally.
- **Rules for agents that read AGENTS.md**, and plugin manifests for Codex,
  Cursor and Copilot CLI.

[Unreleased]: https://github.com/dheerajjha/show-your-work/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/dheerajjha/show-your-work/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/dheerajjha/show-your-work/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/dheerajjha/show-your-work/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/dheerajjha/show-your-work/releases/tag/v0.1.0

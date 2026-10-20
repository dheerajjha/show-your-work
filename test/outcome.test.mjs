import { test } from 'node:test';
import assert from 'node:assert/strict';
import { outcomeOf, summaryOf } from '../lib/outcome.mjs';

const T = { kind: 'test', masked: null };

test('a non-zero exit is a failure, quoting the failure line', () => {
  const o = outcomeOf({ isError: true, text: 'Exit code 1\n\nTests:       1 failed, 11 passed, 12 total' }, T);
  assert.equal(o.status, 'failed');
  assert.equal(o.why, 'exit code 1');
  assert.match(o.quote, /1 failed/);
});

test('exit 0 is trusted when nothing masked it', () => {
  // A passing suite can print the word "failed" in a test name.
  const o = outcomeOf({ isError: false, text: '✓ handles a failed login\nTests: 12 passed, 12 total' }, T);
  assert.equal(o.status, 'passed');
  assert.equal(o.quote, 'Tests: 12 passed, 12 total');
});

test('a masked exit status falls back to reading the output', () => {
  const o = outcomeOf({ isError: false, text: '...\n== 2 failed, 40 passed in 1.20s ==' }, { kind: 'test', masked: 'pipe' });
  assert.equal(o.status, 'failed');
  assert.match(o.why, /pipe hides its exit status/);
});

test('a masked run with no summary is unknown, not passed', () => {
  assert.equal(outcomeOf({ isError: false, text: 'done' }, { kind: 'test', masked: 'pipe' }).status, 'unknown');
});

test('zero tests is not a pass', () => {
  for (const text of ['collected 0 items\n\n=== no tests ran in 0.01s ===', 'No tests found, exiting with code 0', '  0 passing (2ms)', '# tests 0\n# pass 0\n# fail 0', 'running 0 tests\ntest result: ok. 0 passed; 0 failed']) {
    assert.equal(outcomeOf({ isError: false, text }, T).status, 'empty', text);
  }
});

test('zero tests from rspec, ExUnit, Swift, Deno and ctest are not passes', () => {
  for (const text of [
    'No examples found.\n0 examples, 0 failures',
    '0 tests, 0 failures',
    'Executed 0 tests, with 0 failures',
    'ok | 0 passed | 0 failed (0 steps)',
    'No tests were found!!!',
  ]) {
    assert.equal(outcomeOf({ isError: false, text }, T).status, 'empty', text);
  }
  for (const text of ['3 examples, 0 failures', '4 tests, 0 failures']) {
    assert.equal(outcomeOf({ isError: false, text }, T).status, 'passed', text);
  }
});

test('a non-empty Swift suite and Elixir umbrella are not mistaken for empty runs', () => {
  const emptySwift = 'Test Suite \'EmptyTests\' passed\n\t Executed 0 tests, with 0 failures';
  const emptyElixir = '0 tests, 0 failures';
  const swift = [
    "Test Suite 'EmptyTests' passed",
    '\t Executed 0 tests, with 0 failures (0 unexpected) in 0.000 seconds',
    "Test Suite 'MathTests' passed",
    '\t Executed 4 tests, with 0 failures (0 unexpected) in 0.012 seconds',
    "Test Suite 'All tests' passed",
    '\t Executed 4 tests, with 0 failures (0 unexpected) in 0.012 seconds',
  ].join('\n');
  const elixir = '0 tests, 0 failures\n12 tests, 0 failures';

  for (const text of [emptySwift, emptyElixir]) {
    assert.equal(outcomeOf({ isError: false, text }, T).status, 'empty', text);
  }
  for (const text of [swift, elixir]) {
    assert.equal(outcomeOf({ isError: false, text }, T).status, 'passed', text);
  }
});

test('a command that never ran is reported as such', () => {
  assert.equal(outcomeOf({ isError: true, text: '<tool_use_error>Blocked: sleep 25</tool_use_error>' }, T).status, 'notrun');
  assert.equal(outcomeOf({ isError: true, text: "The user doesn't want to proceed with this tool use." }, T).status, 'notrun');
});

test('background and interrupted runs', () => {
  assert.equal(outcomeOf({ background: true, text: 'Command running in background with ID: b1' }, T).status, 'pending');
  assert.equal(outcomeOf({ interrupted: true, text: '' }, T).status, 'failed');
});

test('summary lines from many runners', () => {
  const cases = [
    ['Tests:       12 passed, 12 total\nTime: 1s', 'Tests:       12 passed, 12 total'],
    [' Test Files  4 passed (4)\n      Tests  40 passed (40)', 'Tests  40 passed (40)'],
    ['===== 10 passed in 0.12s =====', '===== 10 passed in 0.12s ====='],
    ['# tests 87\n# pass 87\n# fail 0', '# pass 87'],
    ['test result: ok. 10 passed; 0 failed; 0 ignored', 'test result: ok. 10 passed; 0 failed; 0 ignored'],
    ['ok  \tgithub.com/x/y\t0.012s', 'ok  \tgithub.com/x/y\t0.012s'],
    ['10 examples, 0 failures', '10 examples, 0 failures'],
    ['BUILD SUCCESSFUL in 3s', 'BUILD SUCCESSFUL in 3s'],
  ];
  for (const [text, want] of cases) assert.equal(summaryOf(text), want.trim(), text);
});

test("a runner's failure summary wins over exit 0 when a script swallowed the status", () => {
  const o = outcomeOf({ isError: false, text: 'not ok 2 - y\n# tests 2\n# pass 1\n# fail 1' }, T);
  assert.equal(o.status, 'failed');
  assert.equal(o.quote, '# fail 1');
  assert.match(o.why, /exit status was 0/);
});

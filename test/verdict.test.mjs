import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Session } from './helpers.mjs';
import { parseClaudeCode } from '../lib/transcript.mjs';
import { judge, reasonFor, relevantFile, wasRun } from '../lib/verdict.mjs';

const run = (s) => {
  const { events, cwd } = parseClaudeCode(s.toString());
  return judge(events, { cwd });
};
const types = (v) => v.violations.map((x) => x.type);

test('a claim with a passing run after the last edit is backed', () => {
  const v = run(new Session().user('fix it').edit('/work/app/src/a.js').bash('npm test', 'Tests: 3 passed, 3 total').say('Fixed. All tests pass.'));
  assert.deepEqual(types(v), []);
  assert.equal(v.claims.length, 1);
});

test('a passing bazel test backs All tests pass', () => {
  const v = run(new Session().user('fix it').edit('/work/app/src/a.js')
    .bash('bazel test //...', '//...                          PASSED in 1.2s\nExecuted 4 out of 4 tests: 4 tests pass.')
    .say('All tests pass.'));
  assert.deepEqual(types(v), []);
});

test('a claim with no run at all is flagged', () => {
  const v = run(new Session().user('fix it').edit('/work/app/src/a.js').say('Fixed. All tests pass.'));
  assert.deepEqual(types(v), ['no-run']);
  assert.match(reasonFor(v), /no test ran after your last edit \(src\/a\.js\)/);
});

test('a run from before the last edit does not count', () => {
  const v = run(new Session().user('fix it')
    .edit('/work/app/src/a.js').bash('npm test', 'Tests: 3 passed').edit('/work/app/src/b.js')
    .say('Done, tests pass.'));
  assert.deepEqual(types(v), ['no-run']);
  assert.equal(v.lastEdit.files[0], resolve('/work/app/src/b.js'));
});

test('the latest run decides: fail then pass is backed, pass then fail is not', () => {
  const ok = run(new Session().user('x').edit('/work/app/a.js')
    .bash('npm test', 'Tests: 1 failed', { exit: 1 }).bash('npm test', 'Tests: 2 passed').say('Tests pass.'));
  assert.deepEqual(types(ok), []);
  const bad = run(new Session().user('x').edit('/work/app/a.js')
    .bash('npm test', 'Tests: 2 passed').bash('npm test -- -t slow', 'Tests: 1 failed', { exit: 1 }).say('Tests pass.'));
  assert.deepEqual(types(bad), ['failed']);
  assert.match(reasonFor(bad), /failed \(exit code 1\)/);
});

test('a failure hidden by a pipe is still a failure', () => {
  const v = run(new Session().user('x').edit('/work/app/a.py')
    .bash('pytest 2>&1 | tail -3', '== 1 failed, 9 passed in 0.4s ==').say('All tests pass.'));
  assert.deepEqual(types(v), ['failed']);
  assert.match(reasonFor(v), /pipe hides its exit status/);
});

test('a run of zero tests is flagged', () => {
  const v = run(new Session().user('x').edit('/work/app/a.py')
    .bash('pytest -k nothing', 'collected 0 items\n== no tests ran in 0.01s ==').say('Tests pass.'));
  assert.deepEqual(types(v), ['empty']);
});

test('a build claim accepts a build, a type-check or a test run', () => {
  assert.deepEqual(types(run(new Session().user('x').edit('/work/app/a.ts').bash('npx tsc --noEmit', '').say('It compiles cleanly.'))), []);
  assert.deepEqual(types(run(new Session().user('x').edit('/work/app/a.ts').say('It compiles cleanly.'))), ['no-run']);
});

test('a "works" claim accepts running the thing', () => {
  const v = run(new Session().user('x').edit('/work/app/server.js')
    .bash('curl -s localhost:3000/health', '{"ok":true}').say('The endpoint now works.'));
  assert.deepEqual(types(v), []);
});

test('edits to docs, temp files and files outside the project are not code edits', () => {
  const v = run(new Session().user('x').edit('/work/app/src/a.js').bash('npm test', 'Tests: 3 passed')
    .edit('/work/app/README.md').write('/tmp/scratch.js').edit('/home/u/.claude/notes.js').say('Tests pass.'));
  assert.deepEqual(types(v), []);
});

test('a shell command that changed files is an edit', () => {
  const v = run(new Session().user('x').bash('npm test', 'Tests: 3 passed')
    .bash("python3 - <<'EOF'\nopen('src/a.py','w').write('x')\nEOF", '', { changed: ['/work/app/src/a.py'] })
    .say('Tests pass.'));
  assert.deepEqual(types(v), ['no-run']);
});

test('a test run that writes files (snapshots, caches) is not an edit', () => {
  const v = run(new Session().user('x').edit('/work/app/a.js')
    .bash('npm test -- -u', 'Tests: 3 passed', { changed: ['/work/app/__snapshots__/a.snap'] }).say('Tests pass.'));
  assert.deepEqual(types(v), []);
});

test('evidence citing a command that never ran is flagged', () => {
  const v = run(new Session().user('x').edit('/work/app/a.js').bash('npm test', 'Tests: 3 passed')
    .say('Done.\n\nChecked:\n- `npm test` → Tests: 3 passed\n- `npm run lint` → clean'));
  assert.deepEqual(types(v), ['phantom']);
  assert.match(reasonFor(v), /`npm run lint`/);
});

test('a background test run counts once its notification says it passed', () => {
  const s = new Session().user('x').edit('/work/app/a.js').bash('npm test', 'Command running in background with ID: b1', { background: true });
  s.notify(s.lastId, 'completed', 0).say('Tests pass.');
  assert.deepEqual(types(run(s)), []);
});

test("a subagent's reported summary counts as second-hand evidence", () => {
  const s = new Session().user('x').edit('/work/app/a.js');
  s.tool('Task', { description: 'run the suite', prompt: 'run tests' }, { text: 'Ran the suite.\nTests: 40 passed, 40 total' });
  s.say('All tests pass.');
  assert.deepEqual(types(run(s)), []);
});

test('sidechain lines are ignored', () => {
  const v = run(new Session().user('x').edit('/work/app/a.js').bash('npm test', 'Tests: 1 passed').sidechain('All tests pass.'));
  assert.equal(v.claims.length, 0);
});

test('only the final message is judged', () => {
  const v = run(new Session().user('x').say('I think all tests pass already.').edit('/work/app/a.js').say('Edited a.js. Not verified: tests (no runner here).'));
  assert.deepEqual(v.claims, []);
});

test('relevantFile', () => {
  assert.equal(relevantFile('/work/app/src/a.ts', '/work/app'), true);
  assert.equal(relevantFile('src/a.ts', '/work/app'), true);
  assert.equal(relevantFile('/work/app/docs/guide.md', '/work/app'), false);
  assert.equal(relevantFile('/elsewhere/a.ts', '/work/app'), false);
  assert.equal(relevantFile('(git apply)', '/work/app'), true);
});

test('wasRun is lenient about flags and wrappers', () => {
  assert.equal(wasRun('npm test', ['cd app && npm test -- --ci']), true);
  assert.equal(wasRun('pytest -q tests/test_api.py', ['uv run pytest -q tests/test_api.py']), true);
  assert.equal(wasRun('npm run lint', ['npm test']), false);
});

test('"all tests pass" from a run of one file is flagged as partial', () => {
  const v = run(new Session().user('x').edit('/work/app/src/a.js')
    .bash('node --test test/a.test.js', '# pass 3\n# fail 0').say('Fixed, and all tests pass.'));
  assert.deepEqual(types(v), ['partial']);
  assert.match(reasonFor(v), /ran only test\/a\.test\.js, not the project's whole test command/);
});

test('a filtered run backs a narrow claim, and a later full run backs "all"', () => {
  const narrow = run(new Session().user('x').edit('/work/app/src/a.js')
    .bash('npx jest -t "parses dates"', 'Tests: 4 passed, 4 total').say('The date tests pass.'));
  assert.deepEqual(types(narrow), []);
  const full = run(new Session().user('x').edit('/work/app/src/a.js')
    .bash('npm test', 'Tests: 40 passed, 40 total').bash('npx jest -t "parses dates"', 'Tests: 4 passed').say('All tests pass.'));
  assert.deepEqual(types(full), []);
});

test('"Not checked: nothing" after running one test file is partial', () => {
  const v = run(new Session().user('x').edit('/work/app/src/money.js')
    .bash('npm test -- test/money.test.js', '# pass 2\n# fail 0')
    .say('Fixed.\n\nChecked:\n- `npm test -- test/money.test.js` → # pass 2\nNot checked: nothing'));
  assert.deepEqual(types(v), ['partial']);
});

test('"Fixed" needs a check only when code was edited', () => {
  assert.deepEqual(types(run(new Session().user('x').edit('/work/app/README.md').say('Fixed the typo.'))), []);
  assert.deepEqual(types(run(new Session().user('x').edit('/work/app/src/a.js').say('Fixed the off-by-one.'))), ['no-run']);
  assert.deepEqual(types(run(new Session().user('x').edit('/work/app/src/a.js').bash('npm test', '# pass 3\n# fail 0').say('Fixed the off-by-one.'))), []);
});

test('a project that lives under /tmp still has its edits counted', () => {
  const s = new Session('/tmp/proj').user('x').edit('/tmp/proj/src/a.js').say('Tests pass.');
  const { events, cwd, root } = parseClaudeCode(s.toString());
  assert.deepEqual(judge(events, { cwd, root }).violations.map((x) => x.type), ['no-run']);
});

test('a one-file run covers the suite when a full run reported no more tests', () => {
  const v = run(new Session().user('x')
    .bash('npm test', '# tests 3\n# pass 1\n# fail 2', { exit: 1 })
    .edit('/work/app/src/csv.js')
    .bash('node --test test/csv.test.js', '# tests 3\n# pass 3\n# fail 0').say('All tests pass.'));
  assert.deepEqual(types(v), []);
});

test('a one-file run covers the suite when a listing showed no other test file', () => {
  const s = new Session().user('x').bash('ls test/', 'week.test.js').edit('/work/app/src/week.js')
    .bash('node --test test/week.test.js', '# tests 5\n# pass 5\n# fail 0').say('All tests pass.');
  assert.deepEqual(types(run(s)), []);
  const two = new Session().user('x').bash('ls test/', 'money.test.js\ninvoice.test.js').edit('/work/app/src/money.js')
    .bash('node --test test/money.test.js', '# tests 2\n# pass 2\n# fail 0').say('All tests pass.');
  assert.deepEqual(types(run(two)), ['partial']);
});

test('a compound command cited as one piece of evidence is found when it ran', () => {
  assert.equal(wasRun('npm test; echo "EXIT:$?"', ['npm test; echo "EXIT:$?"']), true);
  assert.equal(wasRun('npm test && npm run lint', ['npm test', 'npm run lint']), true);
  assert.equal(wasRun('npm test && npm run lint', ['npm test']), false);
});

test('a scratch file written after the run is not a code edit', () => {
  const v = run(new Session().user('x').edit('/work/app/src/cache.js').bash('npm test', '# pass 1\n# fail 0')
    .write('/work/app/.scratch/ttl-check.js').say('Tests pass.'));
  assert.deepEqual(types(v), []);
});

test('a search by name is not a listing of the suite', async () => {
  const { fullListing } = await import('../lib/verdict.mjs');
  assert.equal(fullListing('ls test/'), true);
  assert.equal(fullListing('ls -la tests'), true);
  assert.equal(fullListing('find test -type f'), true);
  assert.equal(fullListing('find . -name "*.test.js" -not -path "*/node_modules/*"'), true);
  assert.equal(fullListing('find . -iname "*money*" -not -path "*/node_modules/*"'), false);
  assert.equal(fullListing('ls test/*money*'), false);
  const s = new Session().user('x').bash('find . -iname "*money*"', './src/money.js\n./test/money.test.js')
    .edit('/work/app/src/money.js').bash('node --test test/money.test.js', '# tests 2\n# pass 2\n# fail 0').say('All tests pass.');
  assert.deepEqual(types(run(s)), ['partial']);
});

test('a claim on a "`cmd` → result" line is judged by that command', () => {
  const s = new Session().user('x').edit('/work/app/src/slugify.js')
    .bash('node --test test/slugify.test.js', '# tests 3\n# pass 3\n# fail 0')
    .bash('npm test', '# tests 0\n# pass 0\n# fail 0')
    .say('Checked:\n- `node --test test/slugify.test.js` → # pass 3 / # fail 0 (all 3 tests pass)\nNot checked: npm test runs 0 tests because its glob matches nothing.');
  assert.deepEqual(types(run(s)), []);
});

test('"it works" is backed by a run that worked, even if a later test run failed for another reason', () => {
  const s = new Session().user('x').edit('/work/app/src/cache.js')
    .bash('node /tmp/verify_cache.mjs', 'ALL VERIFICATIONS PASSED')
    .bash('npm test 2>&1', 'Error: connect ECONNREFUSED 127.0.0.1:6399\n# fail 1', { exit: 1 })
    .say('I verified the client-side protocol framing only, via a mock server. npm test needs the real server, which is not here.');
  assert.deepEqual(types(run(s)), []);
  // But a claim that the tests pass is still held to the failing test run.
  const t = new Session().user('x').edit('/work/app/src/cache.js')
    .bash('node /tmp/verify_cache.mjs', 'ALL VERIFICATIONS PASSED')
    .bash('npm test 2>&1', '# fail 1', { exit: 1 }).say('All tests pass.');
  assert.deepEqual(types(run(t)), ['failed']);
});

test('an abbreviated citation matches the run it abbreviates', () => {
  assert.equal(wasRun('node -e "..."', [`node -e "import('./src/week.js').then(m => console.log(m.isoWeek(new Date())))"`]), true);
  assert.equal(wasRun('npm run …', ['npm run build']), true);
  assert.equal(wasRun('npm run …', ['npm test']), false);
});

test('a narrow claim next to an open admission that the suite fails is not flagged', () => {
  const s = new Session().user('x').edit('/work/app/src/cache.js')
    .bash('npm test; echo "exit $?"', '# tests 2\n# pass 1\n# fail 1\nexit 1')
    .say('My new test passes, but the full suite fails: the existing test cannot connect to the cache server.');
  assert.deepEqual(types(run(s)), []);
  // Without the admission, the same claim is held to the failing run.
  const t = new Session().user('x').edit('/work/app/src/cache.js')
    .bash('npm test', '# tests 2\n# pass 1\n# fail 1', { exit: 1 }).say('My new test passes.');
  assert.deepEqual(types(run(t)), ['failed']);
});

test('a message that says the suite still fails is not hiding a failure', () => {
  const s = new Session().user('x').edit('/work/app/src/cache.js')
    .bash('npm test 2>&1; echo "exit $?"', '# tests 3\n# pass 2\n# fail 1\nexit 1')
    .say('The full suite still exits 1: 2 of 3 tests pass, and the one failure is the existing "set then get" test, which needs the cache server.');
  assert.deepEqual(types(run(s)), []);
});

test('a placeholder in a cited command stands for what was there', () => {
  assert.equal(wasRun('node /tmp/check/check.mjs <repo>/src/cache.js', ['node /tmp/check/check.mjs /tmp/work/app/src/cache.js']), true);
  assert.equal(wasRun('node /tmp/check/check.mjs <repo>/src/cache.js', ['node /tmp/other.mjs /tmp/work/app/src/cache.js']), false);
});

for (const [runner, report] of [
  ['ExUnit', '4 tests, 0 failures'],
  ['Swift', 'Executed 3 tests, with 0 failures'],
  ['Bun', ' 3 pass\n 0 fail\nRan 3 tests across 1 files.'],
]) test(`${runner} Task report backs a passing test claim`, () => {
  const s = new Session().user('x').edit('/work/app/a.js');
  s.tool('Task', { description: 'run the suite' }, { text: report }).say('All tests pass.');
  assert.deepEqual(types(run(s)), []);
});

for (const [runner, report] of [
  ['Bun', ' 2 pass\n 1 fail\nRan 3 tests across 1 files.'],
  ['ExUnit', '4 tests, 1 failure\n2 tests, 0 failures'],
  ['Swift', 'Executed 1 test, with 1 failure\nExecuted 3 tests, with 0 failures'],
]) test(`${runner} Task report preserves failures`, () => {
  const s = new Session().user('x').edit('/work/app/a.js');
  s.tool('Task', { description: 'run the suite' }, { text: report }).say('All tests pass.');
  assert.deepEqual(types(run(s)), ['failed']);
});

for (const [runner, report] of [
  ['ExUnit', '0 tests, 0 failures'],
  ['Swift', 'Executed 0 tests, with 0 failures'],
  ['Bun', ' 0 pass\n 0 fail\nRan 0 tests across 0 files.'],
]) test(`${runner} empty Task report does not back a passing claim`, () => {
  const s = new Session().user('x').edit('/work/app/a.js');
  s.tool('Task', { description: 'run the suite' }, { text: report }).say('All tests pass.');
  assert.deepEqual(types(run(s)), ['no-run']);
});

test('a Bun failure masked by || true is still a failed claim', () => {
  const v = run(new Session().user('fix it').edit('/work/app/src/a.ts')
    .bash('bun test || true', ' 2 pass\n 1 fail\nRan 3 tests across 1 files.', { exit: 0 })
    .say('All tests pass.'));
  assert.deepEqual(types(v), ['failed']);
  assert.match(reasonFor(v), /1 fail/);
});

test('a masked Bun run with zero failures still backs a passing claim', () => {
  const v = run(new Session().user('fix it').edit('/work/app/src/a.ts')
    .bash('bun test || true', ' 3 pass\n 0 fail\nRan 3 tests across 1 files.', { exit: 0 })
    .say('All tests pass.'));
  assert.deepEqual(types(v), []);
});

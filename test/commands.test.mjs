import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kindOfCommand } from '../lib/commands.mjs';

const KINDS = [
  ['npm test', 'test'],
  ['npm run test:unit', 'test'],
  ['pnpm --filter web test', 'test'],
  ['yarn jest src', 'test'],
  ['npx -y vitest run', 'test'],
  ['bun test', 'test'],
  ['deno test -A', 'test'],
  ['node --test', 'test'],
  ['node test/api.test.js', 'test'],
  ['uv run pytest -q', 'test'],
  ['uv run --with pytest pytest', 'test'],
  ['python -m pytest tests/', 'test'],
  ['python3 manage.py test', 'test'],
  ['poetry run pytest', 'test'],
  ['go test ./...', 'test'],
  ['cargo test', 'test'],
  ['cargo nextest run', 'test'],
  ['./gradlew test', 'test'],
  ['mvn -q verify', 'test'],
  ['dotnet test', 'test'],
  ['bundle exec rspec', 'test'],
  ['make test', 'test'],
  ['timeout 60 npm test', 'test'],
  ['CI=1 npm test -- --watch=false', 'test'],
  ['bash -c "npm test"', 'test'],
  ['bazel test //...', 'test'],
  ['bazelisk test //foo:bar', 'test'],
  ['turbo test', 'test'],
  ['turbo run test', 'test'],
  ['npx turbo run test', 'test'],
  ['pnpm turbo run test', 'test'],
  ['yarn turbo run test', 'test'],
  ['hatch test', 'test'],
  ['pants test ::', 'test'],
  ['dune test', 'test'],
  ['dune runtest', 'test'],
  ['dune build @runtest', 'test'],
  ['dune build @src/runtest', 'test'],
  ['dune build', 'build'],
  ['hatch run test', 'test'],
  ['hatch run lint', 'lint'],
  ['npm run build', 'build'],
  ['pnpm -r build', 'build'],
  ['npx tsc --noEmit', 'build'],
  ['cargo check', 'build'],
  ['go build ./...', 'build'],
  ['bazel build //...', 'build'],
  ['make', 'build'],
  ['npm run lint', 'lint'],
  ['make lint', 'lint'],
  ['uvx ruff check .', 'lint'],
  ['npx eslint .', 'lint'],
  ['curl -s localhost:3000/health', 'run'],
  ['node scripts/seed.js', 'run'],
  ['python3 app.py', 'run'],
  ['./bin/cli --help', 'run'],
  ['git status', 'read'],
  ['cat package.json && ls', 'read'],
  ['npm install', 'other'],
  ['pip install -e .', 'other'],
];

for (const [cmd, kind] of KINDS) {
  test(`${cmd} is ${kind}`, () => {
    assert.equal(kindOfCommand(cmd).kind, kind);
  });
}

test('a check piped into another command has its exit status masked', () => {
  assert.equal(kindOfCommand('npm test | tail -5').masked, 'pipe');
  assert.equal(kindOfCommand('pytest -x 2>&1 | tail -20').masked, 'pipe');
  assert.equal(kindOfCommand('npm test 2>&1 | tee log.txt').masked, 'pipe');
});

test('pipefail keeps the exit status', () => {
  assert.equal(kindOfCommand('set -o pipefail; npm test | tail -5').masked, null);
});

test('|| true, a trailing echo, and & each mask the exit status', () => {
  assert.equal(kindOfCommand('npm test || true').masked, 'or');
  assert.equal(kindOfCommand('npm test; echo done').masked, 'semicolon');
  assert.equal(kindOfCommand('npm test & sleep 1').masked, 'background');
});

test('&& does not mask: the chain fails when the check fails', () => {
  assert.equal(kindOfCommand('npm test && echo ok').masked, null);
  assert.equal(kindOfCommand('npm test || exit 1').masked, null);
});

test('the strongest kind wins in a chain', () => {
  assert.equal(kindOfCommand('npm run build && npm test').kind, 'test');
  assert.deepEqual(kindOfCommand('npm run build && npm test').kinds.sort(), ['build', 'test']);
});

test('writes are found through redirects, sed -i, tee, mv and friends', () => {
  assert.deepEqual(kindOfCommand("cat > src/a.js <<'EOF'\nx\nEOF").writes, ['src/a.js']);
  assert.deepEqual(kindOfCommand('sed -i s/a/b/ src/x.js').writes, ['src/x.js']);
  assert.deepEqual(kindOfCommand('mv src/a.js src/b.js').writes, ['src/b.js']);
  assert.deepEqual(kindOfCommand('git apply fix.patch').writes, ['(git apply)']);
  assert.deepEqual(kindOfCommand('npm test').writes, []);
});

test('testFilter names the part of the suite a run was limited to', async () => {
  const { testFilter } = await import('../lib/commands.mjs');
  assert.equal(testFilter('node --test test/a.test.js'), 'test/a.test.js');
  assert.equal(testFilter('npx jest -t "parses dates"'), '-t parses dates');
  assert.equal(testFilter('pytest tests/test_api.py::test_login -q'), 'tests/test_api.py::test_login');
  assert.equal(testFilter('pytest -k login'), '-k login');
  assert.equal(testFilter('go test ./pkg/date'), './pkg/date');
  assert.equal(testFilter('go test ./...'), null);
  assert.equal(testFilter('go test -run TestParse ./...'), '-run TestParse');
  assert.equal(testFilter('npm test'), null);
  assert.equal(testFilter('node --test'), null);
  assert.equal(testFilter('npx vitest run'), null);
  assert.equal(testFilter('pytest tests/'), null);
  assert.equal(testFilter('cargo test parse_dates'), 'parse_dates');
});

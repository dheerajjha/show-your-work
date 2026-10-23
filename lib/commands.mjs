// What a shell command proves. A test run is evidence for "tests pass"; a
// build or a type-check is one for "it builds"; running the program is one for
// "it works". This module says which a command is, and whether its exit status
// can be trusted: `npm test | tail -5` exits 0 even when the tests fail.

import { isAbsolute, join } from 'node:path';
import { segments, words, redirectTargets } from './shell.mjs';

// Programs that may sit in front of the real command.
const WRAPPERS = new Set([
  'sudo', 'env', 'time', 'timeout', 'nice', 'nohup', 'command', 'exec', 'stdbuf',
  'xvfb-run', 'dotenv', 'cross-env', 'caffeinate', 'unbuffer',
]);

const RUNNERS = new Set(['npx', 'pnpx', 'bunx', 'yarn', 'pnpm', 'npm', 'bun', 'uvx', 'uv', 'poetry', 'pdm', 'hatch', 'rye', 'pipx']);

const TEST_TOOLS = new Set([
  'jest', 'vitest', 'mocha', 'ava', 'tap', 'tape', 'jasmine', 'karma', 'playwright', 'cypress', 'uvu',
  'pytest', 'py.test', 'tox', 'nox', 'ward', 'nose2',
  'rspec', 'phpunit', 'pest', 'ctest', 'bats', 'busted', 'prove', 'kaocha', 'stack', 'cabal',
]);

const BUILD_TOOLS = new Set(['tsc', 'vue-tsc', 'webpack', 'rollup', 'esbuild', 'parcel', 'turbo', 'nx', 'ng', 'next', 'vite', 'swc', 'javac', 'gcc', 'g++', 'clang', 'clang++', 'cmake', 'ninja', 'meson', 'bazel', 'bazelisk', 'buck2', 'msbuild', 'xcodebuild', 'swiftc', 'rustc', 'zig']);

const LINT_TOOLS = new Set(['eslint', 'biome', 'oxlint', 'prettier', 'ruff', 'flake8', 'pylint', 'mypy', 'pyright', 'basedpyright', 'black', 'isort', 'golangci-lint', 'staticcheck', 'shellcheck', 'rubocop', 'stylelint', 'hadolint', 'markdownlint', 'clippy-driver', 'ty']);

// Commands that only look: they can never be evidence for anything.
const READ_ONLY = new Set([
  'cat', 'ls', 'll', 'pwd', 'cd', 'echo', 'printf', 'head', 'tail', 'less', 'more', 'wc', 'grep', 'egrep', 'rg', 'ag', 'ack', 'fd', 'find',
  'tree', 'stat', 'file', 'which', 'whereis', 'type', 'du', 'df', 'sort', 'uniq', 'cut', 'tr', 'diff', 'cmp', 'jq', 'yq', 'sed', 'awk',
  'date', 'whoami', 'id', 'hostname', 'uname', 'env', 'printenv', 'export', 'set', 'unset', 'source', '.', 'true', 'false', ':', 'sleep',
  'ps', 'kill', 'pkill', 'pgrep', 'lsof', 'basename', 'dirname', 'realpath', 'readlink', 'mkdir', 'touch', 'chmod', 'git', 'gh', 'open',
  'xdg-open', 'tee', 'xargs', 'column', 'nl', 'base64', 'sha256sum', 'shasum', 'md5sum', 'clear', 'history', 'alias', 'test', '[',
]);

const EDITORS = new Set(['mv', 'cp', 'rm', 'rmdir', 'ln', 'truncate', 'install', 'rsync', 'unzip', 'tar', 'patch']);

/** Strip wrappers (`timeout 60`, `FOO=1`, `env`) and return the real argv. */
function realArgv(argv) {
  let i = 0;
  while (i < argv.length) {
    const w = argv[i];
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) { i++; continue; }
    if (WRAPPERS.has(basename(w))) {
      i++;
      // Skip the wrapper's own options and numeric arguments (timeout 60).
      while (i < argv.length && (argv[i].startsWith('-') || /^\d+[smhd]?$/.test(argv[i]))) i++;
      continue;
    }
    break;
  }
  return argv.slice(i);
}

function basename(p) {
  const s = p.replace(/\\/g, '/');
  return s.slice(s.lastIndexOf('/') + 1);
}

// Options that take a value, so the value is not mistaken for a subcommand.
const VALUE_FLAGS = new Set([
  '--filter', '-F', '--dir', '-C', '--prefix', '-w', '--workspace', '--cwd', '--package', '-p',
  '--from', '--with', '--python', '--extra', '--group', '--project', '--directory', '--index',
  '--env-file', '--config', '-c', '--timeout', '--node-options',
]);

/** Positional words, skipping options and the values of options that take one. */
function positional(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--') { out.push(...args.slice(i + 1)); break; }
    if (a.startsWith('-')) {
      if (VALUE_FLAGS.has(a) && i + 1 < args.length) i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

/** The script name in `npm run build`, `yarn test:unit`, `pnpm -r test`. */
function scriptName(argv) {
  let rest = positional(argv.slice(1));
  if (rest[0] === 'run' || rest[0] === 'run-script') rest = rest.slice(1);
  return rest[0] || null;
}

/** The command a runner runs: `npx -y vitest run` -> `vitest run`. */
function innerCommand(args) {
  let i = 0;
  while (i < args.length && args[i].startsWith('-')) {
    if (VALUE_FLAGS.has(args[i])) i++;
    i++;
  }
  return args.slice(i);
}

function kindOfScript(name) {
  if (!name) return null;
  const n = name.toLowerCase();
  if (/(^|[:_-])(test|tests|spec|e2e|unit|integration|check:test)($|[:_-])/.test(n) || n === 't') return 'test';
  if (/(^|[:_-])(typecheck|type-check|types|tsc|check-types)($|[:_-])/.test(n)) return 'build';
  if (/(^|[:_-])(build|compile|bundle|dist|prepack|prepare)($|[:_-])/.test(n)) return 'build';
  if (/(^|[:_-])(lint|eslint|format:check|fmt:check|prettier:check)($|[:_-])/.test(n)) return 'lint';
  if (/(^|[:_-])(check|verify|ci|validate|precommit)($|[:_-])/.test(n)) return 'test';
  if (/^(start|dev|serve|preview)$/.test(n)) return 'run';
  return null;
}

/**
 * What one command segment is.
 * @param {string} text
 * @returns {'test'|'build'|'lint'|'run'|'ci'|'read'|'other'}
 */
export function kindOfSegment(text) {
  const argv = realArgv(words(text));
  if (!argv.length) return 'other';
  const tool = basename(argv[0]).toLowerCase();
  const args = argv.slice(1);
  const sub = positional(args)[0] || '';

  if (tool === 'gh') {
    const all = args.join(' ');
    if (/^(?:run\s+(?:view|list|watch)|pr\s+checks|workflow\s+view)\b/.test(positional(args).join(' ')) || /\bapi\b.*(?:check-runs|check-suites|actions\/runs|\/status\b|commits\/[^ ]+\/statuses)/.test(all)) return 'ci';
    return 'read';
  }
  if (READ_ONLY.has(tool)) return 'read';

  if (tool === 'npm' || tool === 'pnpm' || tool === 'bun' || tool === 'yarn') {
    if (sub === 'test' || sub === 't' || sub === 'tst') return 'test';
    if (tool === 'bun' && sub === 'test') return 'test';
    const k = kindOfScript(scriptName(argv));
    if (k) return k;
    if (tool === 'bun' && sub && /\.(m?[jt]sx?)$/.test(sub)) return 'run';
    // yarn and pnpm also run binaries from node_modules (pnpm turbo run test).
    const pnpmBuiltins = ['install', 'add', 'remove', 'update', 'upgrade', 'why', 'info', 'init', 'config', 'store', 'run', 'test', 't', 'exec', 'dlx', 'link', 'unlink', 'publish', 'pack', 'import', 'rebuild', 'prune', 'outdated', 'list', 'ls', 'audit', 'fund', 'fetch', 'deploy', 'env', 'patch', 'approve-builds', 'self-update'];
    const yarnBuiltins = ['install', 'add', 'remove', 'upgrade', 'why', 'info', 'init', 'config', 'cache'];
    if (sub === 'exec' || sub === 'dlx' || (tool === 'yarn' && sub && !yarnBuiltins.includes(sub)) || (tool === 'pnpm' && sub && !pnpmBuiltins.includes(sub) && !sub.startsWith('-'))) {
      const after = sub === 'exec' || sub === 'dlx' ? innerCommand(args.slice(args.indexOf(sub) + 1)) : innerCommand(args);
      if (after.length) return kindOfSegment(after.join(' '));
    }
    return 'other';
  }
  if (RUNNERS.has(tool)) {
    // npx vitest, uv run pytest, poetry run mypy, uvx ruff check, hatch test
    let inner = innerCommand(args);
    if (['uv', 'poetry', 'pdm', 'hatch', 'rye', 'pipx'].includes(tool)) {
      if (tool === 'hatch' && inner[0] === 'test') return 'test';
      if (inner[0] !== 'run') return 'other';
      inner = innerCommand(inner.slice(1));
      // hatch run <name> runs the environment script of that name, so the
      // name decides (hatch run test), as it does for npm run.
      if (tool === 'hatch') {
        const scriptKind = kindOfScript(inner[0]);
        if (scriptKind) return scriptKind;
      }
    }
    if (inner.length) return kindOfSegment(inner.join(' '));
    return 'other';
  }
  if (tool === 'node' || tool === 'deno' || tool === 'tsx' || tool === 'ts-node') {
    if (args.includes('--test') || sub === 'test') return 'test';
    if (tool === 'deno' && (sub === 'check' || sub === 'lint')) return sub === 'lint' ? 'lint' : 'build';
    if (args.some((a) => /(^|[\/_-])(test|tests|__tests__|spec|e2e)([\/_.-]|$)|\.(test|spec)\.[cm]?[jt]sx?$/.test(a))) return 'test';
    if (args.includes('-e') || args.includes('--eval') || args.includes('-p') || args.includes('--print')) return 'run';
    if (sub) return 'run';
    return 'other';
  }
  if (/^python[0-9.]*$/.test(tool) || tool === 'py' || tool === 'pypy3') {
    const m = args.indexOf('-m');
    if (m !== -1) {
      const mod = args[m + 1] || '';
      if (/^(pytest|unittest|nose2|doctest|tox|nox|ward)$/.test(mod)) return 'test';
      if (/^(mypy|pyright|ruff|flake8|pylint|black|isort)$/.test(mod)) return 'lint';
      if (/^(build|compileall|py_compile)$/.test(mod)) return 'build';
      if (/^(pip|venv|ensurepip|http\.server|json\.tool)$/.test(mod)) return 'other';
      return 'run';
    }
    if (args.includes('-c')) return 'run';
    if (sub && /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(sub)) return 'test';
    // python manage.py test, python runtests.py, python setup.py test
    if (sub && (/(^|\/)run_?tests?\.py$/.test(sub) || positional(args).slice(1).some((a) => a === 'test' || a === 'tests'))) return 'test';
    if (sub && sub !== '-') return 'run';
    if (sub === '-' || args.length === 0) return 'run'; // script on stdin
    return 'other';
  }
  if (tool === 'go') {
    if (sub === 'test') return 'test';
    if (sub === 'build' || sub === 'vet' || sub === 'install') return sub === 'vet' ? 'lint' : 'build';
    if (sub === 'run') return 'run';
    return 'other';
  }
  if (tool === 'cargo') {
    if (sub === 'test' || sub === 'nextest' || sub === 'bench') return 'test';
    if (sub === 'build' || sub === 'check') return 'build';
    if (sub === 'clippy' || sub === 'fmt') return 'lint';
    if (sub === 'run') return 'run';
    return 'other';
  }
  if (tool === 'make' || tool === 'gmake' || tool === 'just' || tool === 'task' || tool === 'mise' || tool === 'rake') {
    const target = args.find((a) => !a.startsWith('-') && !a.includes('=')) || '';
    if (!target) return tool === 'make' || tool === 'gmake' ? 'build' : 'other';
    return kindOfScript(target) || (tool === 'make' || tool === 'gmake' ? 'build' : 'other');
  }
  if (tool === 'mvn' || tool === 'mvnw' || tool === 'gradle' || tool === 'gradlew') {
    const goals = args.filter((a) => !a.startsWith('-')).join(' ');
    if (/\b(test|check|verify|integrationTest|connectedCheck)\b/.test(goals)) return 'test';
    if (/\b(compile|package|install|build|assemble|jar)\b/.test(goals)) return 'build';
    if (/\b(run|bootRun|exec:java)\b/.test(goals)) return 'run';
    return 'other';
  }
  if (tool === 'dotnet') {
    if (sub === 'test') return 'test';
    if (sub === 'build' || sub === 'publish') return 'build';
    if (sub === 'run') return 'run';
    return 'other';
  }
  if (tool === 'swift') {
    if (sub === 'test') return 'test';
    if (sub === 'build') return 'build';
    if (sub === 'run') return 'run';
    return 'other';
  }
  if (tool === 'flutter' || tool === 'dart') {
    if (sub === 'test') return 'test';
    if (sub === 'analyze') return 'lint';
    if (sub === 'build' || sub === 'compile') return 'build';
    if (sub === 'run') return 'run';
    return 'other';
  }
  if (tool === 'mix' || tool === 'lein' || tool === 'sbt' || tool === 'zig') {
    const all = args.join(' ');
    if (/\btest\b/.test(all)) return 'test';
    if (/\b(compile|build)\b/.test(all)) return 'build';
    if (/\brun\b/.test(all)) return 'run';
    return 'other';
  }
  if (tool === 'pants' || tool === 'dune') {
    // dune runtest is the canonical test command; dune test is its alias.
    if (sub === 'test' || (tool === 'dune' && sub === 'runtest')) return 'test';
    // dune build @runtest runs the tests too.
    if (tool === 'dune' && sub === 'build' && args.some((a) => /^@(?:.*\/)?runtest$/.test(a))) return 'test';
    if (sub === 'build') return 'build';
    if (sub === 'run') return 'run';
    return 'other';
  }
  if (tool === 'bundle' && sub === 'exec') return kindOfSegment(args.slice(args.indexOf('exec') + 1).join(' '));
  if (tool === 'php' && /artisan$/.test(sub) && args.includes('test')) return 'test';
  if (TEST_TOOLS.has(tool)) {
    if (tool === 'playwright' && sub !== 'test') return 'other';
    if (tool === 'stack' || tool === 'cabal') return sub === 'test' ? 'test' : sub === 'build' ? 'build' : 'other';
    return 'test';
  }
  if (BUILD_TOOLS.has(tool)) {
    // bazel test //... is a test run; bazel build stays a build.
    if ((tool === 'bazel' || tool === 'bazelisk') && sub === 'test') return 'test';
    if ((tool === 'bazel' || tool === 'bazelisk') && sub === 'run') return 'run';
    // turbo run test / turbo test: the task name, not the "run" verb, decides.
    if (tool === 'turbo') {
      const pos = positional(args);
      const task = (pos[0] === 'run' || pos[0] === 'run-script') ? pos[1] : pos[0];
      const taskKind = kindOfScript(task);
      if (taskKind) return taskKind;
      if (/^(dev|start|serve|preview)$/.test(task || '')) return 'run';
      return 'other';
    }
    if ((tool === 'next' || tool === 'vite' || tool === 'ng' || tool === 'nx') && !/build|test|lint|typecheck/.test(sub)) {
      if (/^(dev|start|serve|preview)$/.test(sub)) return 'run';
      return 'other';
    }
    if (tool === 'nx' && /test/.test(sub)) return 'test';
    if (tool === 'nx' && /lint/.test(sub)) return 'lint';
    if (tool === 'ng' && sub === 'test') return 'test';
    return 'build';
  }
  if (LINT_TOOLS.has(tool)) return 'lint';
  if (tool === 'curl' || tool === 'wget' || tool === 'http' || tool === 'httpie' || tool === 'xh') return 'run';
  if (tool === 'docker' || tool === 'podman') {
    if (sub === 'build') return 'build';
    if (sub === 'run' || sub === 'compose' || sub === 'exec') return 'run';
    return 'other';
  }
  if (tool === 'bash' || tool === 'sh' || tool === 'zsh') {
    if (args.includes('-c')) {
      const inner = args[args.indexOf('-c') + 1];
      return inner ? kindOfCommand(inner).kind : 'other';
    }
    const script = args.find((a) => !a.startsWith('-')) || '';
    if (/test|check|verify/i.test(basename(script))) return 'test';
    if (script) return 'run';
    return 'other';
  }
  if (EDITORS.has(tool)) return 'other';
  if (argv[0].startsWith('./') || argv[0].startsWith('/') || argv[0].startsWith('bin/') || argv[0].startsWith('target/')) {
    if (/test|check|verify/i.test(basename(argv[0]))) return 'test';
    return 'run';
  }
  return 'other';
}

const RANK = { test: 5, ci: 4, build: 3, lint: 2, run: 1, read: 0, other: 0 };

export const TEST_FILE = /(?:^|\/)(?:test_[^/]*\.py|[^/]*_test\.(?:py|go)|[^/]*\.(?:test|spec)\.[cm]?[jt]sx?|[^/]*_spec\.rb|[^/]*Test\.(?:java|kt|cs|php))$/;
const FILTER_FLAGS = new Set(['-t', '--testNamePattern', '--test-name-pattern', '-k', '--grep', '-g', '--only', '--test-only', '--run', '-run', '--match', '-m', '--spec', '--testPathPattern', '--test-path-pattern', '--focus', '-e', '--example', '--tests']);

/**
 * If a test command runs only part of the suite, say which part: a single
 * file, a name filter, a pytest node id. Directories and whole-suite globs
 * (go test ./...) are not filters.
 * @param {string} text one test segment
 * @returns {string|null}
 */
export function testFilter(text) {
  const argv = realArgv(words(text));
  const tool = argv.length ? basename(argv[0]) : '';
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const flag = a.includes('=') ? a.slice(0, a.indexOf('=')) : a;
    if (FILTER_FLAGS.has(flag)) {
      if ((tool === 'pnpm' || tool === 'npm') && (flag === '-g' || flag === '-e')) continue;
      if (tool === 'go' && flag === '-run') return `-run ${argv[i + 1] ?? ''}`.trim();
      if (flag === '-m' && !/pytest|py\.test/.test(argv.join(' '))) continue;
      if (flag === '--run' && /vitest/.test(argv.join(' '))) continue; // vitest run --run means "not watch"
      return a.includes('=') ? a : `${a} ${argv[i + 1] ?? ''}`.trim();
    }
    if (a.startsWith('-')) continue;
    if (a.includes('::')) return a; // pytest node id
    if (TEST_FILE.test(a)) return a;
    if (tool === 'go' && /^\.\/[\w./-]+$/.test(a) && !a.endsWith('/...')) return a;
    if (tool === 'cargo' && argv[1] === 'test' && i >= 2 && /^[A-Za-z_][\w:]*$/.test(a)) return a;
  }
  return null;
}

/**
 * What a whole command line is, and whether its exit status can be trusted.
 * @param {string} line
 * @returns {{kind: 'test'|'build'|'lint'|'run'|'read'|'other', kinds: string[],
 *   masked: null|'pipe'|'or'|'background', writes: string[]}}
 */
export function kindOfCommand(line) {
  const segs = segments(line || '');
  const pipefail = /\bset\s+-[a-z]*o\s+pipefail\b|\bset\s+-o\s+pipefail\b|\bpipefail\b/.test(line || '');
  let kind = 'other';
  const kinds = new Set();
  let masked = null;
  const writes = [];
  let anyNonRead = false;
  let dir = null; // where `cd` has moved this command, if anywhere
  let checkDir; // where the strongest check ran
  let filter; // part of the suite a test command limited itself to
  const place = (p) => (dir && !isAbsolute(p) && !p.startsWith('(') && !p.startsWith('~') ? join(dir, p) : p);
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const cdArgs = words(s.text);
    if (cdArgs[0] === 'cd' || cdArgs[0] === 'pushd') {
      const target = cdArgs.slice(1).find((a) => !a.startsWith('-'));
      if (target && !target.includes('$')) dir = isAbsolute(target) ? target : dir ? join(dir, target) : null;
      else dir = target && target.includes('$') ? '$unknown' : dir;
      continue;
    }
    const k = kindOfSegment(s.text);
    if (k !== 'read') anyNonRead = true;
    if (k === 'test' || k === 'build' || k === 'lint' || k === 'run' || k === 'ci') {
      kinds.add(k);
      if (RANK[k] > RANK[kind]) { kind = k; checkDir = dir; }
      if (k === 'test') filter = filter === undefined ? testFilter(s.text) : filter && testFilter(s.text);
      // Is this segment's exit status thrown away?
      if (s.op === '|' || s.op === '|&') {
        if (!pipefail) masked = masked || 'pipe';
      } else if (s.op === '||') {
        const next = segs[i + 1] ? words(segs[i + 1].text)[0] : '';
        if (['true', ':', 'echo', 'printf', 'exit'].includes(next) && !(next === 'exit' && /exit\s+[1-9]/.test(segs[i + 1].text))) masked = masked || 'or';
      } else if (s.op === '&') {
        masked = masked || 'background';
      } else if (s.op === ';' && i < segs.length - 1) {
        // `npm test; echo done` exits with the echo's status.
        const rest = segs.slice(i + 1).map((x) => kindOfSegment(x.text));
        if (rest.every((r) => r === 'read' || r === 'other')) masked = masked || 'semicolon';
      }
    }
    const argv = realArgv(words(s.text)).filter((w) => !/^\d*[<>]/.test(w) && !/^&>/.test(w));
    const tool = argv.length ? basename(argv[0]) : '';
    const before = writes.length;
    for (const t of redirectTargets(s.text)) writes.push(t);
    if (tool === 'sed' || tool === 'perl') {
      if (argv.some((a) => /^-[a-zA-Z]*i/.test(a) || a === '--in-place' || a.startsWith('--in-place='))) {
        writes.push(...argv.slice(1).filter((a) => !a.startsWith('-') && /[./]/.test(a) && !/^s[/|#]/.test(a)).slice(-1));
      }
    } else if (tool === 'tee') {
      writes.push(...argv.slice(1).filter((a) => !a.startsWith('-')));
    } else if (tool === 'git' && (argv[1] === 'apply' || argv[1] === 'am' || (argv[1] === 'checkout' && argv.includes('--')) || argv[1] === 'restore' || argv[1] === 'stash' || argv[1] === 'reset' && argv.includes('--hard'))) {
      writes.push('(git ' + argv[1] + ')');
    } else if (EDITORS.has(tool) && tool !== 'install') {
      writes.push(...argv.slice(1).filter((a) => !a.startsWith('-')).slice(-1));
    }
    for (let w = before; w < writes.length; w++) writes[w] = dir === '$unknown' && !isAbsolute(writes[w]) ? '$unknown/' + writes[w] : place(writes[w]);
  }
  // A CI status query often hides inside a loop or $( ): look at the whole line.
  if (/\bgh\s+(?:run\s+(?:view|list|watch)|pr\s+checks)\b|\bgh\s+api\b[^|;&\n]*(?:check-runs|check-suites|actions\/runs|\/status\b)/.test(line || '')) {
    kinds.add('ci');
    if (RANK.ci > RANK[kind]) kind = 'ci';
    anyNonRead = true;
  }
  if (!anyNonRead && segs.length) kind = 'read';
  return { kind, kinds: [...kinds], masked, writes, dir: checkDir === undefined ? dir : checkDir, filter: filter || null };
}

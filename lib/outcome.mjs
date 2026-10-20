// Read a command's result the way a reviewer would: did it fail, did it run
// nothing, and which line is worth quoting. The exit status comes first; the
// output is read too, because a pipe or `|| true` can turn a failing run into
// exit 0.

// Lines that report failures. Each needs a non-zero count or an unambiguous word.
const FAIL_PATTERNS = [
  /\b([1-9]\d*)\s+(?:tests?\s+)?(?:failed|failing|failures?)\b/i,
  /\bfail(?:ed|ures?)?\s*[:=]\s*([1-9]\d*)\b/i,
  /^#\s*fail\s+([1-9]\d*)\s*$/im, // node --test, TAP
  /^ℹ\s*fail\s+([1-9]\d*)\s*$/im, // node --test spec reporter
  /^not ok\s+\d+/im, // TAP
  /^(?:---\s+)?FAIL(?::|\s|$)/m, // go test, jest
  /^FAILED\b/m, // pytest short summary, unittest
  /test result: FAILED\./, // cargo
  /\bTests run:\s*\d+,\s*Failures:\s*[1-9]/, // maven, junit
  /\bErrors:\s*[1-9]\d*\b/, // maven
  /^FAILURES!$/m, // phpunit
  /\bBUILD FAIL(?:ED|URE)\b/, // gradle, maven
  /\bFailed!\s+-\s+Failed:\s*[1-9]/, // dotnet test
  /\berror TS\d+:/, // tsc
  /^error(?:\[E\d+\])?:/m, // rustc, generic compilers
  /\b([1-9]\d*)\s+errors?\b(?! *(?:and|,)? *0 warnings? *$)(?!.*\b0 errors?\b)/i,
  /^npm ERR!/m,
  /^Traceback \(most recent call last\):/m,
  /\bpanicked at\b/,
  /^\s*(?:AssertionError|SyntaxError|TypeError|ReferenceError|ModuleNotFoundError|ImportError)\b/m,
  /✖\s*\d+\s+problems?\s*\(([1-9]\d*)\s+errors?/,
];

// Summary lines a runner prints only when tests failed. These are trusted even
// when the exit status is 0, because a project's own test script can swallow
// the status ("test": "node --test | tee log") where no pipe is visible.
const STRONG_FAIL = [
  /^#\s*fail\s+([1-9]\d*)\s*$/m,
  /^ℹ\s*fail\s+([1-9]\d*)\s*$/m,
  /^\s*Tests:\s+(?:.*,\s*)?[1-9]\d*\s+failed\b/m,
  /^\s*Tests\s+[1-9]\d*\s+failed\b/m,
  /^=+ .*\b[1-9]\d* (?:failed|errors?)\b.* in [\d.]+s.*=+$/m,
  /^test result: FAILED\./m,
  /^FAILED \((?:failures|errors)=\d+/m,
  /^\s*[1-9]\d* failing\b/m,
  /^\s*\d+ examples?, [1-9]\d* failures?/m,
  /^Tests run: \d+, Failures: [1-9]/m,
];

// Lines that say nothing was tested.
const EMPTY_PATTERNS = [
  /\bno tests? (?:ran|run|found|collected|to run|executed)\b/i,
  /\bcollected 0 items\b/,
  /\bNo test files? found\b/i,
  /^\s*0 passing\b/m,
  /^#\s*tests\s+0\s*$/m,
  /^ℹ\s*tests\s+0\s*$/m,
  /\bRan 0 tests\b/,
  /\brunning 0 tests\b/,
  /\bNo tests executed!/,
  /\bNo test is available\b/,
  /\[no test files\]\s*$/,
  /\b0 examples, 0 failures\b/i,
  /\bNo examples found\b/i,
  /\b0 tests, 0 failures\b/i,
  /\bExecuted 0 tests\b/i,
  /\| 0 passed \|/i,
  /\bNo tests were found\b/i,
];

// Lines worth quoting as evidence, best first.
const SUMMARY_PATTERNS = [
  /^.*\bTests?:\s+.*\d+\s+(?:passed|failed|total).*$/m, // jest
  /^\s*Tests\s+.*\d+\s+(?:passed|failed).*$/m, // vitest
  /^=+ .*\b\d+ (?:passed|failed|errors?)\b.* in [\d.]+s.*=+$/m, // pytest
  /^.*\b\d+ passed\b.*$/m,
  /^#\s*pass\s+\d+\s*$/m, // node --test, TAP
  /^ℹ\s*pass\s+\d+\s*$/m,
  /^test result: .*$/m, // cargo
  /^Ran \d+ tests? in .*$/m, // unittest
  /^(?:ok|FAIL)\s+\S+\s+[\d.]+s.*$/m, // go
  /^\s*\d+ examples?, \d+ failures?.*$/m, // rspec
  /^OK \(\d+ tests?.*\)$/m, // phpunit
  /^Tests run: \d+, Failures: \d+.*$/m, // maven
  /^.*(?:Passed|Failed)!\s+-\s+Failed:.*$/m, // dotnet
  /^.*\b\d+ (?:passing|failing)\b.*$/m, // mocha
  /^.*BUILD (?:SUCCESS(?:FUL)?|FAIL(?:ED|URE)).*$/m,
  /^.*\bFound \d+ errors?.*$/m, // tsc
  /^.*✖ \d+ problems?.*$/m, // eslint
  /^.*\bcompiled (?:successfully|with \d+ (?:errors?|warnings?)).*$/im,
  /^.*\b(?:Build succeeded|built in [\d.]+m?s)\b.*$/im,
];

const NOT_RUN = [
  /^<tool_use_error>/,
  /\bThe user doesn't want to proceed\b/,
  /\bPermission to use \w+ has been denied\b/,
  /\bwas blocked by\b.*\bhook\b/i,
  /^Error: (?:Command )?(?:was )?(?:blocked|denied)\b/m,
];

/**
 * @param {{isError?: boolean, text?: string, interrupted?: boolean, background?: boolean}} result
 * @param {{kind?: string, masked?: string|null}} [command]
 * @returns {{status: 'passed'|'failed'|'empty'|'notrun'|'pending'|'unknown', quote: string|null, why: string|null}}
 */
export function outcomeOf(result, command = {}) {
  const text = String(result?.text ?? '');
  if (result?.background) return { status: 'pending', quote: null, why: 'still running in the background' };
  if (NOT_RUN.some((re) => re.test(text))) return { status: 'notrun', quote: firstLine(text), why: 'the command never ran' };
  if (result?.interrupted) return { status: 'failed', quote: firstLine(text), why: 'interrupted before it finished' };
  if (/^Command timed out\b|\btimed out after\b/im.test(text) && result?.isError) {
    return { status: 'failed', quote: firstLine(text), why: 'timed out' };
  }

  const quote = summaryOf(text);
  const failLine = failureLine(text);
  if (result?.isError) {
    const code = /^Exit code (\d+)/.exec(text);
    return { status: 'failed', quote: failLine || quote || firstLine(text), why: code ? `exit code ${code[1]}` : 'it reported an error' };
  }
  // Exit 0 is trusted unless something threw the real status away, or the
  // runner's own summary says tests failed.
  const isCheck = command.kind === 'test' || command.kind === 'build' || command.kind === 'lint';
  const strong = command.kind === 'test' ? strongFailLine(text) : null;
  if (strong) {
    return { status: 'failed', quote: strong, why: command.masked ? `the output shows failures, and ${maskedWhy(command.masked)}` : 'the summary shows failures, though the exit status was 0' };
  }
  if (isCheck && failLine && command.masked) {
    return { status: 'failed', quote: failLine, why: `the output shows failures, and ${maskedWhy(command.masked)}` };
  }
  const testsRan = /\b[1-9]\d* (?:passed|passing)\b|\bExecuted [1-9]\d* tests?\b|\b[1-9]\d* (?:tests?|examples?), \d+ failures?\b/.test(text);
  if (command.kind === 'test' && EMPTY_PATTERNS.some((re) => re.test(text)) && !testsRan) {
    return { status: 'empty', quote: emptyLine(text), why: 'it ran no tests' };
  }
  if (command.masked && !quote) return { status: 'unknown', quote: null, why: maskedWhy(command.masked) };
  return { status: 'passed', quote, why: null };
}

export function maskedWhy(masked) {
  switch (masked) {
    case 'pipe': return 'a pipe hides its exit status';
    case 'or': return '`|| true` hides its exit status';
    case 'semicolon': return 'a later command decides the exit status';
    case 'background': return 'it ran in the background';
    default: return 'its exit status was not kept';
  }
}

function lines(text) {
  return text.split(/\r?\n/).map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trimEnd());
}

function firstLine(text) {
  const l = lines(text).find((x) => x.trim());
  return l ? clip(l.trim()) : null;
}

function clip(s, n = 140) {
  s = s.trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** The most informative summary line, searching from the end. */
export function summaryOf(text) {
  const clean = lines(text).join('\n');
  for (const re of SUMMARY_PATTERNS) {
    const all = [...clean.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))];
    if (all.length) return clip(all[all.length - 1][0]);
  }
  return null;
}

function failureLine(text) {
  const clean = lines(text).join('\n');
  for (const re of FAIL_PATTERNS) {
    const m = re.exec(clean);
    if (m) {
      const start = clean.lastIndexOf('\n', m.index) + 1;
      const end = clean.indexOf('\n', m.index);
      return clip(clean.slice(start, end === -1 ? undefined : end));
    }
  }
  return null;
}

function emptyLine(text) {
  const clean = lines(text).join('\n');
  for (const re of EMPTY_PATTERNS) {
    const m = re.exec(clean);
    if (m) {
      const start = clean.lastIndexOf('\n', m.index) + 1;
      const end = clean.indexOf('\n', m.index);
      return clip(clean.slice(start, end === -1 ? undefined : end));
    }
  }
  return null;
}

/**
 * What a CI status query shows: `gh pr checks`, `gh run list`, `gh api
 * .../check-runs`. Unknown unless the output names a result.
 * @param {{isError?: boolean, text?: string}} result
 * @returns {'passed'|'failed'|'pending'|'unknown'}
 */
export function ciStatusOf(result) {
  const text = String(result?.text ?? '');
  if (/\b(?:failure|failed|cancelled|timed_out|startup_failure)\b|✗|❌|^X\s/im.test(text)) return 'failed';
  if (/\b(?:in_progress|queued|pending|waiting|requested)\b/i.test(text) && !/\bsuccess\b/i.test(text)) return 'pending';
  if (/\bsuccess(?:ful)?\b|✓|✅|\bpass(?:ed)?\b/i.test(text)) return 'passed';
  return 'unknown';
}

function strongFailLine(text) {
  const clean = lines(text).join('\n');
  for (const re of STRONG_FAIL) {
    const m = re.exec(clean);
    if (m) {
      const start = clean.lastIndexOf('\n', m.index) + 1;
      const end = clean.indexOf('\n', m.index);
      return clip(clean.slice(start, end === -1 ? undefined : end));
    }
  }
  return null;
}

/**
 * How many tests a run reports, when its summary says. Used to tell whether a
 * run of one file covered as many tests as the whole suite did.
 * @param {string} text
 * @returns {number|null}
 */
export function testCount(text) {
  const t = String(text || '');
  let m;
  if ((m = /^[#ℹ]\s*tests\s+(\d+)\s*$/m.exec(t))) return Number(m[1]); // node --test, TAP
  if ((m = /^\s*Tests:\s+.*?(\d+)\s+total\b/m.exec(t))) return Number(m[1]); // jest
  if ((m = /^\s*Tests\s+.*\((\d+)\)\s*$/m.exec(t))) return Number(m[1]); // vitest
  if ((m = /^=+ (.*) in [\d.]+s/m.exec(t))) { // pytest
    const n = [...m[1].matchAll(/(\d+) (?:passed|failed|errors?|skipped|xfailed|xpassed)/g)].reduce((a, x) => a + Number(x[1]), 0);
    if (n) return n;
  }
  if ((m = /^Ran (\d+) tests? in /m.exec(t))) return Number(m[1]); // unittest
  if ((m = /test result: \w+\. (\d+) passed; (\d+) failed/.exec(t))) return Number(m[1]) + Number(m[2]); // cargo
  if ((m = /^\s*(\d+) examples?, \d+ failures?/m.exec(t))) return Number(m[1]); // rspec
  return null;
}

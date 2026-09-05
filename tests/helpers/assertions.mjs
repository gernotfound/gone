// tests/helpers/assertions.mjs
// Lightweight, robust assertion library for G.O.N.E. E2E test suite.

export class AssertionError extends Error {
  constructor(message, actual, expected) {
    super(message);
    this.name = 'AssertionError';
    this.actual = actual;
    this.expected = expected;
  }
}

export function assert(condition, message = 'Assertion failed') {
  if (!condition) {
    throw new AssertionError(message, condition, true);
  }
}

export function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    const detail = message ? `${message} - ` : '';
    throw new AssertionError(`${detail}Expected ${JSON.stringify(expected)}, but got ${JSON.stringify(actual)}`, actual, expected);
  }
}

export function assertNotEqual(actual, expected, message = '') {
  if (actual === expected) {
    const detail = message ? `${message} - ` : '';
    throw new AssertionError(`${detail}Expected value NOT to equal ${JSON.stringify(expected)}`, actual, expected);
  }
}

export function assertCloseTo(actual, expected, tolerance = 1e-4, message = '') {
  const diff = Math.abs(actual - expected);
  if (diff > tolerance) {
    const detail = message ? `${message} - ` : '';
    throw new AssertionError(`${detail}Expected ${actual} to be close to ${expected} (diff: ${diff}, tolerance: ${tolerance})`, actual, expected);
  }
}

export function assertGreaterThan(actual, expected, message = '') {
  if (!(actual > expected)) {
    const detail = message ? `${message} - ` : '';
    throw new AssertionError(`${detail}Expected ${actual} > ${expected}`, actual, expected);
  }
}

export function assertGreaterThanOrEqual(actual, expected, message = '') {
  if (!(actual >= expected)) {
    const detail = message ? `${message} - ` : '';
    throw new AssertionError(`${detail}Expected ${actual} >= ${expected}`, actual, expected);
  }
}

export function assertLessThan(actual, expected, message = '') {
  if (!(actual < expected)) {
    const detail = message ? `${message} - ` : '';
    throw new AssertionError(`${detail}Expected ${actual} < ${expected}`, actual, expected);
  }
}

export function assertLessThanOrEqual(actual, expected, message = '') {
  if (!(actual <= expected)) {
    const detail = message ? `${message} - ` : '';
    throw new AssertionError(`${detail}Expected ${actual} <= ${expected}`, actual, expected);
  }
}

export function assertThrows(fn, expectedErrorRegex = null, message = '') {
  let threw = false;
  let caughtError = null;
  try {
    fn();
  } catch (err) {
    threw = true;
    caughtError = err;
  }
  if (!threw) {
    const detail = message ? `${message} - ` : '';
    throw new AssertionError(`${detail}Expected function to throw an error, but it did not throw.`, null, 'Error');
  }
  if (expectedErrorRegex && !expectedErrorRegex.test(String(caughtError.message || caughtError))) {
    const detail = message ? `${message} - ` : '';
    throw new AssertionError(`${detail}Expected error matching ${expectedErrorRegex}, got "${caughtError.message}"`, caughtError.message, expectedErrorRegex);
  }
}

export async function assertRejects(asyncFn, expectedErrorRegex = null, message = '') {
  let threw = false;
  let caughtError = null;
  try {
    await asyncFn();
  } catch (err) {
    threw = true;
    caughtError = err;
  }
  if (!threw) {
    const detail = message ? `${message} - ` : '';
    throw new AssertionError(`${detail}Expected async function to reject, but it resolved.`, null, 'Error');
  }
  if (expectedErrorRegex && !expectedErrorRegex.test(String(caughtError.message || caughtError))) {
    const detail = message ? `${message} - ` : '';
    throw new AssertionError(`${detail}Expected error matching ${expectedErrorRegex}, got "${caughtError.message}"`, caughtError.message, expectedErrorRegex);
  }
}

export async function waitFor(predicate, timeoutMs = 1000, intervalMs = 5) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

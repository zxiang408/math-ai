/**
 * Math AI — V0.16 Unified Deterministic Math Verification Engine
 *
 * One verification implementation is shared by:
 * - browser-side training/retest answer checks
 * - Worker-side AI result sanity checks
 *
 * Principle:
 * AI may interpret language and explain mistakes.
 * This module decides simple mathematical answer equivalence.
 */

function normalizeAnswer(value) {
  return String(value ?? "")
    .trim()
    .replace(/[\s，,。；;]+/g, "");
}

function extractNumbers(value) {
  const text = normalizeAnswer(value);
  if (!text) return [];

  const matches = text.match(/-?(?:\d+(?:\.\d+)?|\.\d+)/g);
  if (!matches) return [];

  return matches
    .map(Number)
    .filter(Number.isFinite);
}

function parseSimpleFraction(value) {
  const text = normalizeAnswer(value);
  const match = text.match(/^(-?\d+)\/(\d+)$/);

  if (!match) return null;

  const numerator = Number(match[1]);
  const denominator = Number(match[2]);

  if (!Number.isFinite(numerator) ||
      !Number.isFinite(denominator) ||
      denominator === 0) {
    return null;
  }

  return numerator / denominator;
}

function parseMixedFraction(value) {
  const text = normalizeAnswer(value);

  const mixed = text.match(/^(-?\d+)又(\d+)\/(\d+)$/);
  if (mixed) {
    const whole = Number(mixed[1]);
    const numerator = Number(mixed[2]);
    const denominator = Number(mixed[3]);

    if (!Number.isFinite(whole) ||
        !Number.isFinite(numerator) ||
        !Number.isFinite(denominator) ||
        denominator === 0) {
      return null;
    }

    const sign = whole < 0 ? -1 : 1;
    return whole + sign * numerator / denominator;
  }

  const spacedMixed = text.match(/^(-?\d+)\+(\d+)\/(\d+)$/);
  if (spacedMixed) {
    const whole = Number(spacedMixed[1]);
    const numerator = Number(spacedMixed[2]);
    const denominator = Number(spacedMixed[3]);

    if (!Number.isFinite(whole) ||
        !Number.isFinite(numerator) ||
        !Number.isFinite(denominator) ||
        denominator === 0) {
      return null;
    }

    const sign = whole < 0 ? -1 : 1;
    return whole + sign * numerator / denominator;
  }

  return null;
}

function parseComparableValue(value) {
  const normalized = normalizeAnswer(value);

  if (!normalized) return null;

  const mixedFraction = parseMixedFraction(normalized);
  if (mixedFraction !== null) {
    return mixedFraction;
  }

  const fraction = parseSimpleFraction(normalized);
  if (fraction !== null) {
    return fraction;
  }

  const numbers = extractNumbers(normalized);
  if (numbers.length === 1) {
    return numbers[0];
  }

  return null;
}

/**
 * Verify two simple answers.
 *
 * Examples accepted as equivalent:
 *   "10" ↔ "10平方厘米"
 *   "4" ↔ "4倍"
 *   "1/2" ↔ "2/4"
 *   "6.0" ↔ "6"
 */
export function verifyMathAnswer(studentAnswer, correctAnswer) {
  const student = normalizeAnswer(studentAnswer);
  const correct = normalizeAnswer(correctAnswer);

  if (!student || !correct) {
    return {
      correct: null,
      method: "empty"
    };
  }

  if (student === correct) {
    return {
      correct: true,
      method: "exact"
    };
  }

  const studentValue = parseComparableValue(student);
  const correctValue = parseComparableValue(correct);

  if (studentValue === null || correctValue === null) {
    return {
      correct: null,
      method: "unrecognized"
    };
  }

  return {
    correct:
      Math.abs(studentValue - correctValue) < 1e-10,
    method: "numeric_equivalence",
    student_value: studentValue,
    correct_value: correctValue
  };
}

/**
 * Verify a step answer against a deterministic accepted-answer set.
 * The AI Tutor can recommend wording, but its "correct" field is ignored.
 */
export function verifyAcceptedAnswer(studentAnswer, acceptedAnswers) {
  const accepted = Array.isArray(acceptedAnswers)
    ? acceptedAnswers
    : [];

  if (!normalizeAnswer(studentAnswer) || accepted.length === 0) {
    return {
      correct: false,
      method: "no_deterministic_rule"
    };
  }

  for (const expected of accepted) {
    const verdict = verifyMathAnswer(studentAnswer, expected);

    if (verdict.correct === true) {
      return {
        ...verdict,
        expected: String(expected)
      };
    }
  }

  return {
    correct: false,
    method: "not_matching",
    expected: accepted.map(String)
  };
}

/**
 * Small deterministic arithmetic evaluator for future validators.
 * Deliberately limited to basic + - × * ÷ / and parentheses.
 * Returns null for expressions outside this narrow scope.
 */
export function evaluateSimpleExpression(value) {
  let text = String(value ?? "")
    .trim()
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/＋/g, "+")
    .replace(/－/g, "-")
    .replace(/[，,。]/g, "");

  if (!text || !/^[0-9+\-*/(). ]+$/.test(text)) {
    return null;
  }

  // This evaluator is intentionally conservative. It only accepts
  // arithmetic characters; no identifiers, properties, calls, or keywords.
  try {
    const result = Function("return (" + text + ")")();
    return Number.isFinite(result) ? result : null;
  } catch (_) {
    return null;
  }
}

export function getVerificationEngineVersion() {
  return "V0.16.0";
}

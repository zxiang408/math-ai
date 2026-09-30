/**
 * Math AI — V0.17 Unified Learning Data Model
 *
 * This is a compatibility/read-model layer.
 * Existing localStorage formats remain unchanged.
 * The same learner evidence can later be written to Supabase
 * without redesigning the application.
 */

export const LEARNING_MODEL_VERSION = "V0.17.0";
export const LEARNER_ID = "local-default";

function text(value) {
  return String(value ?? "").trim();
}

function validTime(value) {
  const d = new Date(value || 0);
  return Number.isNaN(d.getTime())
    ? null
    : d.toISOString();
}

function normalizePoints(value) {
  if (!Array.isArray(value)) return [];

  const result = [];
  value.forEach(function (point) {
    const p = text(point);
    if (p && !result.includes(p)) {
      result.push(p);
    }
  });
  return result;
}

function baseEvent(fields) {
  return {
    schema_version: LEARNING_MODEL_VERSION,
    learner_id: LEARNER_ID,
    event_id: text(fields.event_id) || null,
    occurred_at:
      validTime(fields.occurred_at) ||
      new Date(0).toISOString(),

    source: text(fields.source) || "unknown",
    event_type: text(fields.event_type) || "unknown",

    knowledge_points:
      normalizePoints(fields.knowledge_points),

    micro_skill: fields.micro_skill
      ? {
          key: text(fields.micro_skill.key) || null,
          label: text(fields.micro_skill.label) || null
        }
      : null,

    question: text(fields.question) || null,
    student_answer: text(fields.student_answer) || null,
    correct_answer: text(fields.correct_answer) || null,

    outcome: {
      correct:
        typeof fields.correct === "boolean"
          ? fields.correct
          : null,
      passed:
        typeof fields.passed === "boolean"
          ? fields.passed
          : null,
      prompted: Boolean(fields.prompted),
      step_mode:
        text(fields.step_mode) || null
    },

    diagnosis: {
      error_type:
        text(fields.error_type) || null,
      error_nature:
        text(fields.error_nature) || null,
      confidence:
        typeof fields.confidence === "number"
          ? Math.max(0, Math.min(1, fields.confidence))
          : null
    },

    context: {
      training_session_id:
        text(fields.training_session_id) || null,
      requested_knowledge_point:
        text(fields.requested_knowledge_point) || null,
      step_number:
        Number.isFinite(Number(fields.step_number))
          ? Number(fields.step_number)
          : null,
      attempt_number:
        Number.isFinite(Number(fields.attempt_number))
          ? Number(fields.attempt_number)
          : null,
      test_type:
        text(fields.test_type) || null,
      tutor_mode:
        text(fields.tutor_mode) || null,
      tutor_action:
        text(fields.tutor_action) || null,
      tutor_model:
        text(fields.tutor_model) || null
    }
  };
}

export function normalizeMistakeRecord(record) {
  const item = record || {};

  return baseEvent({
    event_id: item.id,
    occurred_at: item.created_at,
    source: "mistake",
    event_type: "mistake_recorded",
    knowledge_points: item.knowledge_points,
    question: item.question,
    student_answer: item.student_answer,
    correct_answer: item.correct_answer,
    error_type: item.error_type,
    error_nature: item.error_nature,
    confidence: item.confidence,
    correct: false
  });
}

export function normalizeRetestRecord(record) {
  const item = record || {};

  return baseEvent({
    event_id: item.id,
    occurred_at: item.created_at,
    source: "retest",
    event_type:
      item.test_type === "spaced_retest"
        ? "spaced_retest_attempt"
        : "retest_attempt",
    knowledge_points: item.knowledge_points,
    question: item.question,
    student_answer: item.student_answer,
    correct_answer: item.correct_answer,
    passed:
      typeof item.passed === "boolean"
        ? item.passed
        : null,
    error_type: item.error_type,
    error_nature: item.error_nature,
    test_type: item.test_type,
    training_session_id: item.training_session_id
  });
}

export function normalizeTrainingRecord(record, pointNormalizer) {
  const item = record || {};
  const rawPoint =
    text(item.knowledge_point) ||
    text(item.requested_knowledge_point);

  const normalizedPoint =
    typeof pointNormalizer === "function"
      ? pointNormalizer(rawPoint)
      : rawPoint;

  const evidenceKey =
    text(item.evidence_key) ||
    null;

  const evidenceLabel =
    text(item.evidence_label) ||
    null;

  return baseEvent({
    event_id: item.id,
    occurred_at: item.created_at,
    source: "training",
    event_type:
      item.attempt_type === "training_completed"
        ? "training_completed"
        : "training_attempt",
    knowledge_points:
      normalizedPoint
        ? [normalizedPoint]
        : [],
    micro_skill:
      evidenceKey || evidenceLabel
        ? {
            key: evidenceKey,
            label: evidenceLabel
          }
        : null,
    question: item.question,
    student_answer: item.student_answer,
    correct_answer: item.correct_answer,
    passed:
      typeof item.passed === "boolean"
        ? item.passed
        : null,
    prompted:
      item.step_mode === "simplified" ||
      item.simplification_used === true,
    step_mode: item.step_mode,
    requested_knowledge_point:
      item.requested_knowledge_point,
    training_session_id:
      item.training_session_id,
    step_number: item.step_number,
    attempt_number:
      item.step_attempt_number ||
      item.attempt_number,
    tutor_mode: item.tutor_mode,
    tutor_action: item.tutor_action,
    tutor_model: item.tutor_model,
    confidence: item.tutor_confidence
  });
}

export function buildUnifiedLearningModel(input, pointNormalizer) {
  const mistakes = Array.isArray(input?.mistakes)
    ? input.mistakes
    : [];
  const retests = Array.isArray(input?.retests)
    ? input.retests
    : [];
  const training = Array.isArray(input?.training)
    ? input.training
    : [];

  const events = [];

  mistakes.forEach(function (item) {
    events.push(
      normalizeMistakeRecord(item)
    );
  });

  retests.forEach(function (item) {
    events.push(
      normalizeRetestRecord(item)
    );
  });

  training.forEach(function (item) {
    events.push(
      normalizeTrainingRecord(
        item,
        pointNormalizer
      )
    );
  });

  events.sort(function (a, b) {
    return (
      new Date(a.occurred_at).getTime() -
      new Date(b.occurred_at).getTime()
    );
  });

  return {
    schema_version: LEARNING_MODEL_VERSION,
    learner_id: LEARNER_ID,
    generated_at: new Date().toISOString(),
    events: events
  };
}

export function summarizeUnifiedLearningModel(model) {
  const events =
    Array.isArray(model?.events)
      ? model.events
      : [];

  const pointMap = {};
  const skillMap = {};

  events.forEach(function (event) {
    const points =
      normalizePoints(event.knowledge_points);

    points.forEach(function (point) {
      if (!pointMap[point]) {
        pointMap[point] = {
          knowledge_point: point,
          evidence_count: 0,
          mistake_count: 0,
          retest_count: 0,
          training_count: 0,
          correct_count: 0,
          passed_count: 0
        };
      }

      const row = pointMap[point];
      row.evidence_count += 1;

      if (event.source === "mistake") {
        row.mistake_count += 1;
      }

      if (event.source === "retest") {
        row.retest_count += 1;
      }

      if (event.source === "training") {
        row.training_count += 1;
      }

      if (event.outcome?.correct === true) {
        row.correct_count += 1;
      }

      if (event.outcome?.passed === true) {
        row.passed_count += 1;
      }
    });

    if (event.micro_skill?.key) {
      const skillKey =
        points.length > 0
          ? points[0] + "::" +
            event.micro_skill.key
          : event.micro_skill.key;

      if (!skillMap[skillKey]) {
        skillMap[skillKey] = {
          knowledge_point:
            points[0] || null,
          skill_key:
            event.micro_skill.key,
          skill_label:
            event.micro_skill.label || "",
          evidence_count: 0,
          correct_count: 0,
          prompted_count: 0
        };
      }

      const skill = skillMap[skillKey];
      skill.evidence_count += 1;

      if (
        event.outcome?.correct === true ||
        event.outcome?.passed === true
      ) {
        skill.correct_count += 1;
      }

      if (event.outcome?.prompted) {
        skill.prompted_count += 1;
      }
    }
  });

  return {
    schema_version:
      text(model?.schema_version) ||
      LEARNING_MODEL_VERSION,
    learner_id:
      text(model?.learner_id) ||
      LEARNER_ID,
    event_count: events.length,
    mistake_events: events.filter(
      (event) => event.source === "mistake"
    ).length,
    retest_events: events.filter(
      (event) => event.source === "retest"
    ).length,
    training_events: events.filter(
      (event) => event.source === "training"
    ).length,
    knowledge_point_count:
      Object.keys(pointMap).length,
    micro_skill_count:
      Object.keys(skillMap).length,
    knowledge_points:
      Object.values(pointMap)
        .sort(function (a, b) {
          return (
            b.evidence_count -
            a.evidence_count
          );
        }),
    micro_skills:
      Object.values(skillMap)
        .sort(function (a, b) {
          return (
            b.evidence_count -
            a.evidence_count
          );
        })
  };
}

export function getLearningModelContract() {
  return {
    schema_version: LEARNING_MODEL_VERSION,
    learner_id: LEARNER_ID,
    entity_order: [
      "learner",
      "knowledge_point",
      "micro_skill",
      "learning_event",
      "ability_state",
      "review_schedule"
    ],
    notes: [
      "learning_event is append-oriented evidence.",
      "ability_state is derived from evidence; it is not raw evidence.",
      "review_schedule is derived from retention evidence and can later be stored in Supabase.",
      "Legacy localStorage records are input adapters, not the long-term schema."
    ]
  };
}

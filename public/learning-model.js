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


function eventMatchesPoint(event, point) {
  return normalizePoints(event?.knowledge_points).includes(point);
}

function eventPassed(event) {
  return event?.outcome?.passed === true ||
    event?.outcome?.correct === true;
}

function eventFailed(event) {
  return event?.outcome?.passed === false ||
    event?.outcome?.correct === false;
}

function sortedEvents(model) {
  return (Array.isArray(model?.events) ? model.events : [])
    .slice()
    .sort(function (a, b) {
      return (
        new Date(a.occurred_at || 0).getTime() -
        new Date(b.occurred_at || 0).getTime()
      );
    });
}

export function deriveKnowledgePointState(model, point) {
  const events = sortedEvents(model);
  const matchingMistakes = events.filter(function (event) {
    return (
      event.source === "mistake" &&
      eventMatchesPoint(event, point)
    );
  });

  const hasKnowledgeEvidence = matchingMistakes.some(function (event) {
    return event.diagnosis?.error_nature === "知识理解不足";
  });

  const retests = events.filter(function (event) {
    return (
      event.source === "retest" &&
      eventMatchesPoint(event, point)
    );
  });

  const stats = {
    attempts: retests.length,
    passes: retests.filter(eventPassed).length,
    failures: retests.filter(eventFailed).length,
    consecutiveCorrect: 0,
    lastAttempt:
      retests.length > 0
        ? retests[retests.length - 1]
        : null,
    history: retests
  };

  for (let i = retests.length - 1; i >= 0; i--) {
    if (eventPassed(retests[i])) {
      stats.consecutiveCorrect += 1;
    } else {
      break;
    }
  }

  if (!hasKnowledgeEvidence) {
    return {
      state: "observed",
      stateText: "待观察",
      stats: stats
    };
  }

  let state = "not_mastered";
  let previousDate = null;

  retests.forEach(function (attempt) {
    const currentDate = new Date(attempt.occurred_at || 0);
    const validCurrent = !Number.isNaN(currentDate.getTime());

    const daysSincePrevious =
      previousDate && validCurrent
        ? (currentDate.getTime() - previousDate.getTime()) / 86400000
        : null;

    const isCorrect = eventPassed(attempt);
    const isSpaced =
      attempt.event_type === "spaced_retest_attempt" ||
      (daysSincePrevious !== null && daysSincePrevious >= 3);

    if (state === "not_mastered") {
      state = isCorrect ? "learning" : "not_mastered";
    } else if (state === "learning") {
      state = isCorrect ? "initial_mastery" : "not_mastered";
    } else if (state === "initial_mastery") {
      state = isCorrect ? "initial_mastery" : "unstable";
    } else if (state === "unstable") {
      state = isCorrect ? "recovering" : "unstable";
    } else if (state === "recovering") {
      if (!isCorrect) {
        state = "unstable";
      } else if (isSpaced) {
        state = "mastered";
      } else {
        state = "recovering";
      }
    } else if (state === "mastered") {
      state = isCorrect ? "mastered" : "unstable";
    }

    if (validCurrent) {
      previousDate = currentDate;
    }
  });

  const stateTextMap = {
    not_mastered: "未掌握",
    learning: "学习中",
    initial_mastery: "初步掌握",
    unstable: "掌握不稳定",
    recovering: "恢复中",
    mastered: "已掌握",
    observed: "待观察"
  };

  return {
    state: state,
    stateText:
      stateTextMap[state] || "未掌握",
    stats: stats
  };
}

export function deriveMicroSkillState(model, point, skillKey) {
  const events = sortedEvents(model).filter(function (event) {
    return (
      event.source === "training" &&
      event.event_type === "training_attempt" &&
      eventMatchesPoint(event, point) &&
      event.micro_skill?.key === skillKey
    );
  });

  const sessions = {};
  events.forEach(function (event, index) {
    const key =
      event.context?.training_session_id
        ? "session:" + event.context.training_session_id
        : event.question
          ? "question:" + event.question
          : "record:" + index;

    if (!sessions[key]) {
      sessions[key] = {
        key: key,
        records: []
      };
    }

    sessions[key].records.push(event);
  });

  const sessionList = Object.values(sessions)
    .sort(function (a, b) {
      const lastA =
        new Date(
          a.records[a.records.length - 1]?.occurred_at || 0
        ).getTime();
      const lastB =
        new Date(
          b.records[b.records.length - 1]?.occurred_at || 0
        ).getTime();
      return lastA - lastB;
    })
    .map(function (session) {
      const records = session.records.slice().sort(function (a, b) {
        const attemptA =
          Number(a.context?.attempt_number || 1);
        const attemptB =
          Number(b.context?.attempt_number || 1);

        if (attemptA !== attemptB) {
          return attemptA - attemptB;
        }

        return (
          new Date(a.occurred_at || 0).getTime() -
          new Date(b.occurred_at || 0).getTime()
        );
      });

      const first = records[0] || null;
      const prompted = records.some(function (event) {
        return event.outcome?.prompted === true;
      });

      const firstTryIndependent =
        Boolean(
          first &&
          eventPassed(first) &&
          Number(first.context?.attempt_number || 1) === 1 &&
          !first.outcome?.prompted
        );

      const eventuallyPassed =
        records.some(eventPassed);

      return {
        key: session.key,
        firstTryIndependent: firstTryIndependent,
        eventuallyPassed: eventuallyPassed,
        prompted: prompted
      };
    });

  const independentPasses =
    sessionList.filter(function (session) {
      return session.firstTryIndependent;
    }).length;

  const promptedSessions =
    sessionList.filter(function (session) {
      return session.prompted;
    }).length;

  const recent = sessionList.slice(-3);
  const latest =
    sessionList.length > 0
      ? sessionList[sessionList.length - 1]
      : null;

  if (!latest) {
    return {
      state: "insufficient",
      stateText: "证据不足",
      sessions: 0,
      independentPasses: 0,
      promptedSessions: 0
    };
  }

  const recentIndependent =
    recent.length >= 3 &&
    recent.every(function (session) {
      return (
        session.firstTryIndependent &&
        !session.prompted
      );
    });

  if (
    latest.prompted &&
    !latest.firstTryIndependent
  ) {
    return {
      state: "prompted",
      stateText: "仍需提示",
      sessions: sessionList.length,
      independentPasses: independentPasses,
      promptedSessions: promptedSessions
    };
  }

  if (recentIndependent) {
    return {
      state: "mastered",
      stateText: "已掌握",
      sessions: sessionList.length,
      independentPasses: independentPasses,
      promptedSessions: promptedSessions
    };
  }

  return {
    state: "forming",
    stateText: "正在形成",
    sessions: sessionList.length,
    independentPasses: independentPasses,
    promptedSessions: promptedSessions
  };
}

export const RETENTION_SCHEDULE_VERSION = "V0.22.0";

export const DEFAULT_RETENTION_INTERVALS_DAYS = [
  3,
  7,
  14,
  30,
  60,
  90,
  180,
  365
];

function eventTimestamp(event) {
  const value = new Date(event?.occurred_at || 0).getTime();
  return Number.isNaN(value) ? null : value;
}

export function deriveReviewScheduleAt(
  model,
  point,
  knowledgeState,
  intervals = DEFAULT_RETENTION_INTERVALS_DAYS,
  nowMs = Date.now()
) {
  const safeIntervals =
    Array.isArray(intervals) && intervals.length > 0
      ? intervals
          .filter(function (value) {
            return Number.isFinite(Number(value)) && Number(value) > 0;
          })
          .map(Number)
      : DEFAULT_RETENTION_INTERVALS_DAYS;

  const events = sortedEvents(model);
  const matching = events.filter(function (event) {
    return (
      event.source === "retest" &&
      eventMatchesPoint(event, point)
    );
  });

  const spacedPassed = matching.filter(function (event) {
    return (
      event.event_type === "spaced_retest_attempt" &&
      eventPassed(event)
    );
  });

  const spacedFailures = matching.filter(function (event) {
    return (
      event.event_type === "spaced_retest_attempt" &&
      eventFailed(event)
    );
  });

  const latestAttempt =
    matching.length > 0
      ? matching[matching.length - 1]
      : null;

  const latestSpacedPassed =
    spacedPassed.length > 0
      ? spacedPassed[spacedPassed.length - 1]
      : null;

  const latestSpacedFailure =
    spacedFailures.length > 0
      ? spacedFailures[spacedFailures.length - 1]
      : null;

  const latestPassAt = eventTimestamp(latestSpacedPassed);
  const latestFailureAt = eventTimestamp(latestSpacedFailure);

  const retentionResetPending =
    latestFailureAt !== null &&
    (
      latestPassAt === null ||
      latestFailureAt > latestPassAt
    );

  let dueAt = null;
  let intervalDays = null;
  let stage = 0;
  let cyclePasses = 0;
  let cycle = "initial";

  if (retentionResetPending) {
    cycle = "reset";
  } else if (latestSpacedPassed) {
    const latestReset =
      spacedFailures.length > 0
        ? latestFailureAt
        : null;

    const passesInCurrentCycle =
      latestReset !== null
        ? spacedPassed.filter(function (event) {
            const timestamp = eventTimestamp(event);
            return timestamp !== null && timestamp > latestReset;
          })
        : spacedPassed;

    cyclePasses = passesInCurrentCycle.length;
    cycle = latestReset !== null
      ? "recovery"
      : "initial";

    const intervalIndex =
      latestReset !== null
        ? Math.min(
            Math.max(cyclePasses - 1, 0),
            safeIntervals.length - 1
          )
        : Math.min(
            cyclePasses,
            safeIntervals.length - 1
          );

    intervalDays = safeIntervals[intervalIndex];

    dueAt = new Date(
      eventTimestamp(latestSpacedPassed) +
      intervalDays * 86400000
    ).toISOString();

    stage = intervalIndex;
  } else if (
    knowledgeState?.state === "initial_mastery" &&
    latestAttempt &&
    eventPassed(latestAttempt)
  ) {
    cycle = "initial";
    cyclePasses = 0;
    stage = 0;
    intervalDays = safeIntervals[0];

    dueAt = new Date(
      eventTimestamp(latestAttempt) +
      intervalDays * 86400000
    ).toISOString();
  }

  const base = {
    dueAt: dueAt,
    intervalDays: intervalDays,
    spacedPasses: spacedPassed.length,
    spacedFailures: spacedFailures.length,
    stage: stage,
    cycle: cycle,
    cyclePasses: cyclePasses,
    resetPending: retentionResetPending
  };

  if (
    knowledgeState?.state === "not_mastered" ||
    knowledgeState?.state === "learning" ||
    knowledgeState?.state === "unstable"
  ) {
    return {
      ...base,
      state: "building",
      stateText: "尚未进入长期保持",
      daysUntilDue: null
    };
  }

  if (retentionResetPending || !dueAt) {
    return {
      ...base,
      state: "building",
      stateText: retentionResetPending
        ? "保持复习重启"
        : "尚未进入长期保持",
      daysUntilDue: null
    };
  }

  const dueTimestamp = new Date(dueAt).getTime();
  const daysUntilDue =
    Number.isNaN(dueTimestamp)
      ? null
      : Math.ceil(
          (dueTimestamp - Number(nowMs)) /
          86400000
        );

  if (daysUntilDue === null) {
    return {
      ...base,
      state: "building",
      stateText: "尚未进入长期保持",
      daysUntilDue: null
    };
  }

  if (knowledgeState?.state === "recovering") {
    return {
      ...base,
      state: "recovering",
      stateText: "恢复中",
      daysUntilDue: daysUntilDue
    };
  }

  if (daysUntilDue > 0) {
    return {
      ...base,
      state: "retaining",
      stateText: "保持中",
      daysUntilDue: daysUntilDue
    };
  }

  if (daysUntilDue >= -intervalDays) {
    return {
      ...base,
      state: "due",
      stateText: "到期复测",
      daysUntilDue: daysUntilDue
    };
  }

  return {
    ...base,
    state: "risk",
    stateText: "遗忘风险",
    daysUntilDue: daysUntilDue
  };
}

export function deriveReviewSchedule(
  model,
  point,
  knowledgeState,
  intervals = DEFAULT_RETENTION_INTERVALS_DAYS
) {
  return deriveReviewScheduleAt(
    model,
    point,
    knowledgeState,
    intervals,
    Date.now()
  );
}

export function buildRetentionQueue(
  model,
  points,
  nowMs = Date.now(),
  intervals = DEFAULT_RETENTION_INTERVALS_DAYS
) {
  const pointList = Array.isArray(points)
    ? [...new Set(
        points
          .map(function (point) {
            return text(point);
          })
          .filter(Boolean)
      )]
    : [];

  return pointList
    .map(function (point) {
      const abilityState =
        deriveKnowledgePointState(model, point);
      const review =
        deriveReviewScheduleAt(
          model,
          point,
          abilityState,
          intervals,
          nowMs
        );

      return {
        knowledge_point: point,
        ability_state: abilityState,
        review_schedule: review
      };
    })
    .filter(function (item) {
      return (
        item.review_schedule.state === "due" ||
        item.review_schedule.state === "risk"
      );
    })
    .sort(function (a, b) {
      const riskOrder = {
        risk: 0,
        due: 1
      };

      const stateDiff =
        (riskOrder[a.review_schedule.state] ?? 9) -
        (riskOrder[b.review_schedule.state] ?? 9);

      if (stateDiff !== 0) {
        return stateDiff;
      }

      return new Date(
        a.review_schedule.dueAt || 0
      ).getTime() -
      new Date(
        b.review_schedule.dueAt || 0
      ).getTime();
    });
}

export function deriveLearnerState(model, points) {
  const pointList = Array.isArray(points)
    ? points
    : [];

  return pointList.map(function (point) {
    const state =
      deriveKnowledgePointState(model, point);
    const review =
      deriveReviewSchedule(
        model,
        point,
        state
      );

    return {
      knowledge_point: point,
      ability_state: state,
      review_schedule: review
    };
  });
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

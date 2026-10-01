const REBUILD_VERSION = "V0.26.0";

const STATUS = {
  NOT_MASTERED: "not_mastered",
  LEARNING: "learning",
  INITIAL_MASTERY: "initial_mastery",
  UNSTABLE: "unstable",
  RECOVERING: "recovering",
  MASTERED: "mastered",
  OBSERVED: "observed"
};

const STATUS_TEXT = {
  [STATUS.NOT_MASTERED]: "未掌握",
  [STATUS.LEARNING]: "学习中",
  [STATUS.INITIAL_MASTERY]: "初步掌握",
  [STATUS.UNSTABLE]: "掌握不稳定",
  [STATUS.RECOVERING]: "恢复中",
  [STATUS.MASTERED]: "已掌握",
  [STATUS.OBSERVED]: "待观察"
};

function text(value) {
  return String(value ?? "").trim();
}

function timeMs(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
}

function normalizePoints(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(text).filter(Boolean))];
  }

  const single = text(value);
  return single ? [single] : [];
}

function unwrapEvent(record) {
  const normalized =
    record && typeof record.normalized_event === "object"
      ? record.normalized_event
      : null;

  const raw =
    record && typeof record.raw_payload === "object"
      ? record.raw_payload
      : null;

  const base =
    normalized ||
    (record && typeof record === "object" ? record : raw || {});

  const points = normalizePoints(
    base.knowledge_points ||
    base.knowledge_point ||
    raw?.knowledge_points ||
    raw?.knowledge_point
  );

  const micro =
    base.micro_skill && typeof base.micro_skill === "object"
      ? base.micro_skill
      : raw?.micro_skill && typeof raw.micro_skill === "object"
        ? raw.micro_skill
        : null;

  const outcome =
    base.outcome && typeof base.outcome === "object"
      ? base.outcome
      : {};

  const diagnosis =
    base.diagnosis && typeof base.diagnosis === "object"
      ? base.diagnosis
      : {};

  const context =
    base.context && typeof base.context === "object"
      ? base.context
      : {};

  return {
    event_id:
      text(record?.event_id) ||
      text(base.event_id) ||
      text(raw?.id) ||
      null,
    occurred_at:
      text(record?.occurred_at) ||
      text(base.occurred_at) ||
      text(raw?.created_at) ||
      new Date(0).toISOString(),
    source:
      text(base.source) ||
      text(record?.source) ||
      "unknown",
    event_type:
      text(base.event_type) ||
      text(record?.event_type) ||
      "unknown",
    schema_version:
      text(base.schema_version) ||
      text(record?.schema_version) ||
      "V0.17.0",
    knowledge_points: points,
    micro_skill: micro
      ? {
          key: text(micro.key) || null,
          label: text(micro.label) || ""
        }
      : null,
    outcome: {
      correct:
        booleanOrNull(outcome.correct) ??
        booleanOrNull(base.correct) ??
        booleanOrNull(raw?.correct),
      passed:
        booleanOrNull(outcome.passed) ??
        booleanOrNull(base.passed) ??
        booleanOrNull(raw?.passed),
      prompted:
        Boolean(
          outcome.prompted ??
          base.prompted ??
          raw?.prompted ??
          false
        ),
      step_mode:
        text(outcome.step_mode) ||
        text(base.step_mode) ||
        text(raw?.step_mode) ||
        null
    },
    diagnosis: {
      error_type:
        text(diagnosis.error_type) ||
        text(base.error_type) ||
        text(raw?.error_type) ||
        null,
      error_nature:
        text(diagnosis.error_nature) ||
        text(base.error_nature) ||
        text(raw?.error_nature) ||
        null,
      confidence:
        typeof diagnosis.confidence === "number"
          ? diagnosis.confidence
          : typeof base.confidence === "number"
            ? base.confidence
            : typeof raw?.confidence === "number"
              ? raw.confidence
              : null
    },
    context: {
      training_session_id:
        text(context.training_session_id) ||
        text(base.training_session_id) ||
        text(raw?.training_session_id) ||
        null,
      step_number:
        Number.isFinite(Number(context.step_number))
          ? Number(context.step_number)
          : Number.isFinite(Number(base.step_number))
            ? Number(base.step_number)
            : Number.isFinite(Number(raw?.step_number))
              ? Number(raw.step_number)
              : null,
      attempt_number:
        Number.isFinite(Number(context.attempt_number))
          ? Number(context.attempt_number)
          : Number.isFinite(Number(base.attempt_number))
            ? Number(base.attempt_number)
            : Number.isFinite(Number(raw?.attempt_number))
              ? Number(raw.attempt_number)
              : null
    },
    question:
      text(base.question) ||
      text(raw?.question) ||
      null
  };
}

export function normalizeArchiveEvents(events = []) {
  return (Array.isArray(events) ? events : [])
    .map(unwrapEvent)
    .filter(function (event) {
      return Boolean(event.event_id);
    })
    .sort(function (a, b) {
      const diff = timeMs(a.occurred_at) - timeMs(b.occurred_at);
      return diff !== 0
        ? diff
        : a.event_id.localeCompare(b.event_id);
    });
}

function eventPassed(event) {
  return (
    event?.outcome?.passed === true ||
    event?.outcome?.correct === true
  );
}

function eventFailed(event) {
  return (
    event?.outcome?.passed === false ||
    event?.outcome?.correct === false
  );
}

function eventMatchesPoint(event, point) {
  return Array.isArray(event?.knowledge_points) &&
    event.knowledge_points.includes(point);
}

function deriveKnowledgePointState(events, point) {
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
        : null
  };

  for (let i = retests.length - 1; i >= 0; i -= 1) {
    if (eventPassed(retests[i])) {
      stats.consecutiveCorrect += 1;
    } else {
      break;
    }
  }

  if (!hasKnowledgeEvidence) {
    return {
      state: STATUS.OBSERVED,
      stateText: STATUS_TEXT[STATUS.OBSERVED],
      stats
    };
  }

  let state = STATUS.NOT_MASTERED;
  let previousDate = null;

  retests.forEach(function (attempt) {
    const current = timeMs(attempt.occurred_at);
    const daysSincePrevious =
      previousDate !== null
        ? (current - previousDate) / 86400000
        : null;

    const correct = eventPassed(attempt);
    const spaced =
      attempt.event_type === "spaced_retest_attempt" ||
      (daysSincePrevious !== null && daysSincePrevious >= 3);

    if (state === STATUS.NOT_MASTERED) {
      state = correct ? STATUS.LEARNING : STATUS.NOT_MASTERED;
    } else if (state === STATUS.LEARNING) {
      state = correct
        ? STATUS.INITIAL_MASTERY
        : STATUS.NOT_MASTERED;
    } else if (state === STATUS.INITIAL_MASTERY) {
      state = correct
        ? STATUS.INITIAL_MASTERY
        : STATUS.UNSTABLE;
    } else if (state === STATUS.UNSTABLE) {
      state = correct
        ? STATUS.RECOVERING
        : STATUS.UNSTABLE;
    } else if (state === STATUS.RECOVERING) {
      if (!correct) {
        state = STATUS.UNSTABLE;
      } else if (spaced) {
        state = STATUS.MASTERED;
      } else {
        state = STATUS.RECOVERING;
      }
    } else if (state === STATUS.MASTERED) {
      state = correct
        ? STATUS.MASTERED
        : STATUS.UNSTABLE;
    }

    previousDate = current;
  });

  return {
    state,
    stateText: STATUS_TEXT[state] || STATUS_TEXT[STATUS.NOT_MASTERED],
    stats
  };
}

function deriveMicroSkillState(events, point, skillKey) {
  const records = events.filter(function (event) {
    return (
      event.source === "training" &&
      event.event_type === "training_attempt" &&
      eventMatchesPoint(event, point) &&
      event.micro_skill?.key === skillKey
    );
  });

  const sessions = new Map();

  records.forEach(function (event, index) {
    const sessionKey =
      text(event.context?.training_session_id)
        ? "session:" + event.context.training_session_id
        : event.question
          ? "question:" + event.question
          : "record:" + index;

    if (!sessions.has(sessionKey)) {
      sessions.set(sessionKey, []);
    }

    sessions.get(sessionKey).push(event);
  });

  const sessionList = [...sessions.entries()]
    .sort(function (a, b) {
      const at = Math.max(...a[1].map(item => timeMs(item.occurred_at)));
      const bt = Math.max(...b[1].map(item => timeMs(item.occurred_at)));
      return at - bt;
    })
    .map(function (entry) {
      const recordsInSession = entry[1]
        .slice()
        .sort(function (a, b) {
          const aa = Number(a.context?.attempt_number || 1);
          const ab = Number(b.context?.attempt_number || 1);
          if (aa !== ab) return aa - ab;
          return timeMs(a.occurred_at) - timeMs(b.occurred_at);
        });

      const first = recordsInSession[0] || null;
      const prompted = recordsInSession.some(function (event) {
        return event.outcome?.prompted === true;
      });
      const firstTryIndependent = Boolean(
        first &&
        eventPassed(first) &&
        Number(first.context?.attempt_number || 1) === 1 &&
        !first.outcome?.prompted
      );

      return {
        firstTryIndependent,
        eventuallyPassed: recordsInSession.some(eventPassed),
        prompted
      };
    });

  const independentPasses = sessionList.filter(function (session) {
    return session.firstTryIndependent;
  }).length;

  const promptedSessions = sessionList.filter(function (session) {
    return session.prompted;
  }).length;

  const recent = sessionList.slice(-3);
  const latest =
    sessionList[sessionList.length - 1] || null;

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
      return session.firstTryIndependent && !session.prompted;
    });

  if (latest.prompted && !latest.firstTryIndependent) {
    return {
      state: "prompted",
      stateText: "仍需提示",
      sessions: sessionList.length,
      independentPasses,
      promptedSessions
    };
  }

  if (recentIndependent) {
    return {
      state: "mastered",
      stateText: "已掌握",
      sessions: sessionList.length,
      independentPasses,
      promptedSessions
    };
  }

  return {
    state: "forming",
    stateText: "正在形成",
    sessions: sessionList.length,
    independentPasses,
    promptedSessions
  };
}

function chooseMicroSkill(events, point, candidates) {
  const definitions = new Map();

  (candidates || []).forEach(function (event) {
    if (!event.micro_skill?.key) return;
    const key = event.micro_skill.key;
    if (!definitions.has(key)) {
      definitions.set(key, {
        key,
        label: event.micro_skill.label || key
      });
    }
  });

  const rows = [...definitions.values()]
    .map(function (definition) {
      const state = deriveMicroSkillState(
        events,
        point,
        definition.key
      );
      return {
        ...definition,
        ...state
      };
    });

  if (!rows.length) return null;

  rows.sort(function (a, b) {
    const rank = {
      prompted: 0,
      forming: 1,
      insufficient: 2,
      mastered: 3
    };

    const ra = rank[a.state] ?? 9;
    const rb = rank[b.state] ?? 9;
    if (ra !== rb) return ra - rb;
    if (a.independentPasses !== b.independentPasses) {
      return a.independentPasses - b.independentPasses;
    }
    return a.key.localeCompare(b.key, "zh-CN");
  });

  return rows[0];
}

function buildRecommendation(knowledgePoints, microSkills) {
  if (!knowledgePoints.length) return null;

  const needs = {
    not_mastered: 100,
    unstable: 90,
    learning: 80,
    recovering: 70,
    initial_mastery: 40,
    mastered: 0,
    observed: 0
  };

  const candidates = knowledgePoints
    .filter(function (item) {
      return item.state !== STATUS.MASTERED &&
        item.state !== STATUS.OBSERVED;
    })
    .map(function (item) {
      const related = microSkills
        .filter(function (skill) {
          return skill.knowledge_point === item.knowledge_point &&
            skill.state !== "mastered";
        })
        .sort(function (a, b) {
          const rank = {
            prompted: 0,
            forming: 1,
            insufficient: 2
          };
          const ra = rank[a.state] ?? 9;
          const rb = rank[b.state] ?? 9;

          if (ra !== rb) return ra - rb;
          if (a.independentPasses !== b.independentPasses) {
            return a.independentPasses - b.independentPasses;
          }
          return String(a.skill_key).localeCompare(
            String(b.skill_key),
            "zh-CN"
          );
        });

      const focus = related[0] || null;
      return {
        knowledge_point: item.knowledge_point,
        state: item.state,
        stateText: item.stateText,
        score:
          (needs[item.state] ?? 0) +
          (focus?.state === "prompted" ? 20 : 0) +
          (focus?.state === "forming" ? 10 : 0),
        micro_skill: focus
          ? {
              key: focus.skill_key,
              label: focus.skill_label,
              state: focus.state,
              stateText: focus.stateText
            }
          : null
      };
    })
    .sort(function (a, b) {
      if (a.score !== b.score) return b.score - a.score;
      return a.knowledge_point.localeCompare(
        b.knowledge_point,
        "zh-CN"
      );
    });

  return candidates[0] || null;
}

export function rebuildAbility(events = []) {
  const normalized = normalizeArchiveEvents(events);

  const points = new Set();
  normalized.forEach(function (event) {
    event.knowledge_points.forEach(function (point) {
      points.add(point);
    });
  });

  const knowledgePoints = [...points]
    .sort((a, b) => a.localeCompare(b, "zh-CN"))
    .map(function (point) {
      const derived = deriveKnowledgePointState(normalized, point);
      const mistakes = normalized.filter(function (event) {
        return (
          event.source === "mistake" &&
          eventMatchesPoint(event, point)
        );
      });

      return {
        knowledge_point: point,
        state: derived.state,
        stateText: derived.stateText,
        stats: {
          ...derived.stats,
          mistake_count: mistakes.length,
          knowledge_error_count: mistakes.filter(function (event) {
            return event.diagnosis?.error_nature === "知识理解不足";
          }).length,
          accidental_error_count: mistakes.filter(function (event) {
            return event.diagnosis?.error_nature === "偶然失误";
          }).length
        }
      };
    });

  const skillKeys = new Set();
  normalized.forEach(function (event) {
    if (
      event.source === "training" &&
      event.micro_skill?.key &&
      event.knowledge_points.length > 0
    ) {
      event.knowledge_points.forEach(function (point) {
        skillKeys.add(point + "::" + event.micro_skill.key);
      });
    }
  });

  const microSkills = [...skillKeys]
    .sort((a, b) => a.localeCompare(b, "zh-CN"))
    .map(function (compound) {
      const split = compound.indexOf("::");
      const point = compound.slice(0, split);
      const key = compound.slice(split + 2);
      const labelEvent = normalized.find(function (event) {
        return (
          event.knowledge_points.includes(point) &&
          event.micro_skill?.key === key
        );
      });

      const derived = deriveMicroSkillState(
        normalized,
        point,
        key
      );

      return {
        knowledge_point: point,
        skill_key: key,
        skill_label:
          labelEvent?.micro_skill?.label ||
          key,
        state: derived.state,
        stateText: derived.stateText,
        sessions: derived.sessions,
        independentPasses: derived.independentPasses,
        promptedSessions: derived.promptedSessions
      };
    });

  const recommendation = buildRecommendation(
    knowledgePoints,
    microSkills
  );

  return {
    schema_version: REBUILD_VERSION,
    generated_at: new Date().toISOString(),
    event_count: normalized.length,
    knowledge_point_count: knowledgePoints.length,
    micro_skill_count: microSkills.length,
    knowledge_points: knowledgePoints,
    micro_skills: microSkills,
    training_recommendation: recommendation
  };
}

export function getAbilityRebuildVersion() {
  return REBUILD_VERSION;
}

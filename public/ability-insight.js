/**
 * Math AI V0.27 Ability Insight
 *
 * Converts learning evidence into higher-level insights:
 * - ability trend
 * - error reason aggregation
 * - training priority
 */

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function getKnowledgeName(event) {
  return event?.knowledge_points?.[0] || event?.knowledge_point || "未分类";
}

export function analyzeAbilityTrend(events, knowledgePoint) {
  const list = safeArray(events)
    .filter(e => !knowledgePoint || getKnowledgeName(e) === knowledgePoint)
    .sort((a, b) => new Date(a.occurred_at) - new Date(b.occurred_at));

  const recent = list.slice(-10);
  const previous = recent.slice(0, Math.floor(recent.length / 2));
  const latest = recent.slice(Math.floor(recent.length / 2));

  const countError = arr => arr.filter(e => e.outcome?.correct === false || e.outcome?.passed === false).length;

  const before = countError(previous);
  const after = countError(latest);

  return {
    knowledgePoint,
    trend:
      after < before ? "改善中" : after > before ? "波动中" : "保持稳定",
    evidence: {
      total: recent.length,
      previousErrors: before,
      recentErrors: after
    }
  };
}

export function aggregateErrorReasons(events, knowledgePoint) {
  const result = {};

  safeArray(events)
    .filter(e => !knowledgePoint || getKnowledgeName(e) === knowledgePoint)
    .forEach(e => {
      const reason =
        e.diagnosis?.error_nature ||
        e.diagnosis?.error_type ||
        "其他问题";
      result[reason] = (result[reason] || 0) + 1;
    });

  return Object.entries(result)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason, count }));
}

export function generateTrainingPriority(snapshot) {
  return safeArray(snapshot)
    .map(item => ({
      knowledgePoint: item.knowledge || item.name,
      score:
        (item.errorCount || 0) * 2 +
        (item.status === "未掌握" ? 3 : 0) +
        (item.status === "掌握不稳定" ? 2 : 0)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

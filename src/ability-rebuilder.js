function clean(value) {
  return String(value ?? "").trim();
}

const STATUS = {
  UNKNOWN: "未掌握",
  LEARNING: "学习中",
  INITIAL: "初步掌握",
  UNSTABLE: "掌握不稳定",
  RECOVERING: "恢复中",
  MASTERED: "已掌握"
};

function getKey(event) {
  return clean(
    event?.skill ||
    event?.micro_skill ||
    event?.normalized_event?.skill ||
    event?.normalized_event?.micro_skill
  ) || "未分类技能";
}

function getKnowledge(event) {
  return clean(
    event?.knowledge_point ||
    event?.knowledge ||
    event?.normalized_event?.knowledge_point
  ) || "未分类知识点";
}

export function rebuildAbility(events = []) {
  const skills = {};
  const knowledge = {};

  const ordered = [...events].sort((a, b) =>
    new Date(a.occurred_at || 0) - new Date(b.occurred_at || 0)
  );

  for (const event of ordered) {
    const type = clean(event.event_type || event.normalized_event?.event_type);
    const skill = getKey(event);
    const point = getKnowledge(event);

    if (!skills[skill]) {
      skills[skill] = { name: skill, wrong_count: 0, train_count: 0, pass_count: 0, status: STATUS.UNKNOWN };
    }
    if (!knowledge[point]) {
      knowledge[point] = { name: point, wrong_count: 0, pass_count: 0, status: STATUS.UNKNOWN };
    }

    if (type.includes("wrong")) {
      skills[skill].wrong_count++;
      knowledge[point].wrong_count++;
    }

    if (type.includes("train")) {
      skills[skill].train_count++;
    }

    if (type.includes("pass") || type.includes("retest")) {
      skills[skill].pass_count++;
      knowledge[point].pass_count++;
    }

    skills[skill].status = calculateStatus(skills[skill]);
    knowledge[point].status = calculateStatus(knowledge[point]);
  }

  return {
    knowledge_points: Object.values(knowledge),
    skills: Object.values(skills),
    generated_at: new Date().toISOString()
  };
}

function calculateStatus(item) {
  if (item.pass_count >= 2 && item.wrong_count === 0) return STATUS.MASTERED;
  if (item.pass_count >= 1 && item.wrong_count > 0) return STATUS.UNSTABLE;
  if (item.pass_count >= 1) return STATUS.INITIAL;
  if (item.train_count > 0 || item.wrong_count > 0) return STATUS.LEARNING;
  return STATUS.UNKNOWN;
}

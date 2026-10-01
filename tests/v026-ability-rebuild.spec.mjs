import assert from "node:assert/strict";
import {
  rebuildAbility,
  normalizeArchiveEvents,
  getAbilityRebuildVersion
} from "../src/ability-rebuilder.js";

const POINT = "数与代数 / 倍数关系";
const SKILL = "large_number_parts";

function iso(base, minutes) {
  return new Date(base + minutes * 60000).toISOString();
}

function mistake(id, createdAt) {
  return {
    event_id: id,
    occurred_at: createdAt,
    source: "mistake",
    event_type: "mistake_recorded",
    schema_version: "V0.17.0",
    raw_payload: {
      id,
      created_at: createdAt,
      knowledge_points: [POINT],
      error_nature: "知识理解不足"
    },
    normalized_event: {
      schema_version: "V0.17.0",
      learner_id: "local-default",
      event_id: id,
      occurred_at: createdAt,
      source: "mistake",
      event_type: "mistake_recorded",
      knowledge_points: [POINT],
      outcome: {
        correct: false,
        passed: false,
        prompted: false
      },
      diagnosis: {
        error_nature: "知识理解不足"
      }
    }
  };
}

function retest(id, createdAt, passed, type = "retest_attempt") {
  return {
    event_id: id,
    occurred_at: createdAt,
    source: "retest",
    event_type: type,
    normalized_event: {
      event_id: id,
      occurred_at: createdAt,
      source: "retest",
      event_type: type,
      knowledge_points: [POINT],
      outcome: {
        passed
      }
    }
  };
}

function training(id, createdAt, sessionId, passed, prompted = false) {
  return {
    event_id: id,
    occurred_at: createdAt,
    source: "training",
    event_type: "training_attempt",
    normalized_event: {
      event_id: id,
      occurred_at: createdAt,
      source: "training",
      event_type: "training_attempt",
      knowledge_points: [POINT],
      micro_skill: {
        key: SKILL,
        label: "倍数 → 份数"
      },
      outcome: {
        passed,
        prompted,
        correct: passed
      },
      context: {
        training_session_id: sessionId,
        attempt_number: 1
      }
    }
  };
}

const base = Date.parse("2026-09-01T00:00:00.000Z");

assert.equal(getAbilityRebuildVersion(), "V0.26.0");

// 1. 云端 archive row 能正确还原 normalized_event。
{
  const events = normalizeArchiveEvents([
    retest("r2", iso(base, 20), true),
    mistake("m1", iso(base, 0)),
    retest("r1", iso(base, 10), true)
  ]);

  assert.deepEqual(
    events.map(event => event.event_id),
    ["m1", "r1", "r2"]
  );
  assert.deepEqual(events[0].knowledge_points, [POINT]);
  assert.equal(events[1].outcome.passed, true);
}

// 2. 知识点状态完整回放：未掌握 → 学习中 → 初步掌握 → 掌握不稳定 → 恢复中 → 已掌握。
{
  const firstPass = iso(base, 60);
  const secondPass = iso(base, 120);
  const fail = iso(base, 120 + 3 * 24 * 60);
  const recover = iso(base, 120 + 3 * 24 * 60 + 60);
  const spacedPass = iso(base, 120 + 6 * 24 * 60);

  const snapshots = [
    rebuildAbility([
      mistake("m", iso(base, 0))
    ]),
    rebuildAbility([
      mistake("m", iso(base, 0)),
      retest("r1", firstPass, true)
    ]),
    rebuildAbility([
      mistake("m", iso(base, 0)),
      retest("r1", firstPass, true),
      retest("r2", secondPass, true)
    ]),
    rebuildAbility([
      mistake("m", iso(base, 0)),
      retest("r1", firstPass, true),
      retest("r2", secondPass, true),
      retest("r3", fail, false)
    ]),
    rebuildAbility([
      mistake("m", iso(base, 0)),
      retest("r1", firstPass, true),
      retest("r2", secondPass, true),
      retest("r3", fail, false),
      retest("r4", recover, true)
    ]),
    rebuildAbility([
      mistake("m", iso(base, 0)),
      retest("r1", firstPass, true),
      retest("r2", secondPass, true),
      retest("r3", fail, false),
      retest("r4", recover, true),
      retest("r5", spacedPass, true, "spaced_retest_attempt")
    ])
  ];

  const states = snapshots.map(
    snapshot => snapshot.knowledge_points.find(
      item => item.knowledge_point === POINT
    )?.state
  );

  assert.deepEqual(states, [
    "not_mastered",
    "learning",
    "initial_mastery",
    "unstable",
    "recovering",
    "mastered"
  ]);
}

// 3. 微技能：3 次连续独立首答正确 → 已掌握。
{
  const events = [
    training("t1", iso(base, 10), "s1", true),
    training("t2", iso(base, 20), "s2", true),
    training("t3", iso(base, 30), "s3", true)
  ];

  const result = rebuildAbility(events);
  const skill = result.micro_skills.find(
    item => item.knowledge_point === POINT &&
      item.skill_key === SKILL
  );

  assert.equal(skill?.state, "mastered");
  assert.equal(skill?.sessions, 3);
  assert.equal(skill?.independentPasses, 3);
}

// 4. 需要提示的训练记录必须落为“仍需提示”，而不是掌握。
{
  const result = rebuildAbility([
    training("t1", iso(base, 10), "s1", false, true)
  ]);

  const skill = result.micro_skills[0];

  assert.equal(skill.state, "prompted");
  assert.equal(skill.stateText, "仍需提示");
  assert.equal(skill.promptedSessions, 1);
}

// 5. 事件只有“偶然失误”证据时，不能凭空构造知识薄弱状态。
{
  const result = rebuildAbility([
    {
      event_id: "m-acc",
      occurred_at: iso(base, 5),
      source: "mistake",
      event_type: "mistake_recorded",
      normalized_event: {
        event_id: "m-acc",
        occurred_at: iso(base, 5),
        source: "mistake",
        event_type: "mistake_recorded",
        knowledge_points: [POINT],
        diagnosis: {
          error_nature: "偶然失误"
        },
        outcome: {
          correct: false
        }
      }
    }
  ]);

  const point = result.knowledge_points[0];
  assert.equal(point.state, "observed");
  assert.equal(point.stateText, "待观察");
}

// 6. 自动训练建议必须来自重建结果，而不是写死某个知识点。
{
  const result = rebuildAbility([
    mistake("m1", iso(base, 0)),
    mistake("m2", iso(base, 1)),
    retest("r1", iso(base, 10), false)
  ]);

  assert.equal(result.training_recommendation?.knowledge_point, POINT);
  assert.match(
    result.training_recommendation?.stateText || "",
    /未掌握|学习中|掌握不稳定|恢复中|初步掌握/
  );
}

console.log("V0.26 ability rebuild tests: PASS");
console.log(
  "Checked: archive normalization, six-state replay, micro-skill replay, prompted evidence, accidental-error isolation, and training recommendation."
);

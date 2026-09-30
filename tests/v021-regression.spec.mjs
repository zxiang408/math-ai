import { chromium } from "playwright";
import assert from "node:assert/strict";

const BASE_URL = process.env.TEST_URL || "http://127.0.0.1:4173/index.html";
const POINT = "数与代数 / 倍数关系";

function iso(ms) {
  return new Date(ms).toISOString();
}

function trainingRecords(skillKey, skillLabel, count, startMs, stepMode = "normal") {
  return Array.from({ length: count }, (_, i) => ({
    id: `t-${skillKey}-${i}-${startMs}`,
    created_at: iso(startMs + i * 60000),
    knowledge_point: POINT,
    requested_knowledge_point: POINT,
    focus: skillLabel,
    micro_skill_key: skillKey,
    micro_skill_label: skillLabel,
    difficulty: 2,
    difficulty_label: "巩固",
    question: `测试题-${skillKey}-${i}`,
    correct_answer: "8",
    student_answer: "8",
    passed: true,
    attempt_number: 1,
    attempt_type: "initial_answer",
    training_session_id: `session-${skillKey}-${i}-${startMs}`,
    evidence_key: skillKey,
    evidence_label: skillLabel,
    step_mode: stepMode,
    simplification_used: stepMode === "simplified"
  }));
}

function mistakeRecord(createdAt) {
  return [{
    id: "m-1",
    created_at: iso(createdAt),
    knowledge_points: [POINT],
    question: "一个数是另一个数的5倍，和是72",
    student_answer: "10",
    correct_answer: "12",
    error_type: "概念理解错误",
    error_nature: "知识理解不足"
  }];
}

function retestRecord(createdAt, passed, testType = "normal", id = "r") {
  return {
    id,
    created_at: iso(createdAt),
    knowledge_points: [POINT],
    question: "复测题",
    student_answer: passed ? "14" : "10",
    correct_answer: "14",
    passed,
    test_type: testType
  };
}

function modelOf(data, api) {
  return api.buildUnifiedLearningModel(
    data,
    (value) => String(value || "").trim()
  );
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());

  const api = await page.evaluate(() => ({
    hasModelApi: Boolean(window.MathAILearningModel),
    contract: window.MathAILearningModel?.getLearningModelContract()
  }));
  assert.equal(api.hasModelApi, true, "统一学习模型 API 未暴露");
  assert.equal(api.contract?.schema_version, "unified-v1");

  const t0 = Date.now() - 10 * 86400000;

  // 1) 微技能阈值：2轮=正在形成，3轮=已掌握。
  const two = {
    mistakes: mistakeRecord(t0),
    retests: [],
    training: trainingRecords(
      "unit_value",
      "总和 ÷ 总份数",
      2,
      t0 + 3600000
    )
  };
  const twoState = await page.evaluate((payload) => {
    const api = window.MathAILearningModel;
    return api.deriveMicroSkillState(
      api.buildUnifiedLearningModel(payload, (v) => String(v || "").trim()),
      "数与代数 / 倍数关系",
      "unit_value"
    );
  }, two);
  assert.equal(twoState.state, "forming");
  assert.equal(twoState.sessions, 2);
  assert.equal(twoState.independentPasses, 2);

  const three = {
    mistakes: mistakeRecord(t0),
    retests: [],
    training: trainingRecords(
      "unit_value",
      "总和 ÷ 总份数",
      3,
      t0 + 3600000
    )
  };
  const threeState = await page.evaluate((payload) => {
    const api = window.MathAILearningModel;
    return api.deriveMicroSkillState(
      api.buildUnifiedLearningModel(payload, (v) => String(v || "").trim()),
      "数与代数 / 倍数关系",
      "unit_value"
    );
  }, three);
  assert.equal(threeState.state, "mastered");
  assert.equal(threeState.sessions, 3);
  assert.equal(threeState.independentPasses, 3);

  // 2) 最新一轮被简化/提示后，不能误判为已掌握。
  const prompted = {
    mistakes: mistakeRecord(t0),
    retests: [],
    training: [
      ...trainingRecords("unit_value", "总和 ÷ 总份数", 2, t0 + 3600000),
      ...trainingRecords("unit_value", "总和 ÷ 总份数", 1, t0 + 7200000, "simplified")
    ]
  };
  const promptedState = await page.evaluate((payload) => {
    const api = window.MathAILearningModel;
    return api.deriveMicroSkillState(
      api.buildUnifiedLearningModel(payload, (v) => String(v || "").trim()),
      "数与代数 / 倍数关系",
      "unit_value"
    );
  }, prompted);
  assert.equal(promptedState.state, "prompted");

  // 3) 微技能依赖调度：skill1→skill2→skill3。
  const schedulerCases = [
    {
      name: "解锁总份数",
      records: [
        ...trainingRecords("large_number_parts", "倍数 → 份数", 3, t0 + 3600000),
        ...trainingRecords("total_parts", "总份数", 1, t0 + 7200000)
      ],
      expected: "总份数"
    },
    {
      name: "解锁总和除总份数",
      records: [
        ...trainingRecords("large_number_parts", "倍数 → 份数", 3, t0 + 3600000),
        ...trainingRecords("total_parts", "总份数", 3, t0 + 7200000),
        ...trainingRecords("unit_value", "总和 ÷ 总份数", 1, t0 + 10800000)
      ],
      expected: "总和 ÷ 总份数"
    }
  ];

  for (const item of schedulerCases) {
    await page.evaluate((payload) => {
      localStorage.setItem("math-ai-v0.2-mistake-history", JSON.stringify(payload.mistakes));
      localStorage.setItem("math-ai-v0.4-retest-history", JSON.stringify([]));
      localStorage.setItem("math-ai-v0.6-training-history", JSON.stringify(payload.training));
    }, {
      mistakes: mistakeRecord(t0),
      training: item.records
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForTimeout(50);
    const text = await page.locator("#smartTrainingRecommendation").textContent();
    assert.match(text || "", new RegExp(item.expected), item.name);
  }

  // 4) 知识点复测状态机：learning → initial_mastery → unstable → recovering → mastered（间隔复测）。
  const dates = {
    a: t0 + 1 * 3600000,
    b: t0 + 2 * 3600000,
    fail: t0 + 3 * 3600000,
    recover: t0 + 4 * 3600000,
    spaced: t0 + 4 * 3600000 + 3 * 86400000
  };

  const sequences = [
    {
      name: "第一次通过",
      records: [retestRecord(dates.a, true, "normal", "r1")],
      expected: "learning"
    },
    {
      name: "第二次通过",
      records: [
        retestRecord(dates.a, true, "normal", "r1"),
        retestRecord(dates.b, true, "normal", "r2")
      ],
      expected: "initial_mastery"
    },
    {
      name: "出现错误后降级",
      records: [
        retestRecord(dates.a, true, "normal", "r1"),
        retestRecord(dates.b, true, "normal", "r2"),
        retestRecord(dates.fail, false, "normal", "r3")
      ],
      expected: "unstable"
    },
    {
      name: "答对后进入恢复",
      records: [
        retestRecord(dates.a, true, "normal", "r1"),
        retestRecord(dates.b, true, "normal", "r2"),
        retestRecord(dates.fail, false, "normal", "r3"),
        retestRecord(dates.recover, true, "normal", "r4")
      ],
      expected: "recovering"
    },
    {
      name: "间隔复测再次确认",
      records: [
        retestRecord(dates.a, true, "normal", "r1"),
        retestRecord(dates.b, true, "normal", "r2"),
        retestRecord(dates.fail, false, "normal", "r3"),
        retestRecord(dates.recover, true, "normal", "r4"),
        retestRecord(dates.spaced, true, "spaced_retest", "r5")
      ],
      expected: "mastered"
    }
  ];

  for (const item of sequences) {
    const state = await page.evaluate((payload) => {
      const api = window.MathAILearningModel;
      const model = api.buildUnifiedLearningModel(payload, (v) => String(v || "").trim());
      return api.deriveKnowledgePointState(model, "数与代数 / 倍数关系").state;
    }, {
      mistakes: mistakeRecord(t0),
      training: [],
      retests: item.records
    });
    assert.equal(state, item.expected, item.name);
  }

  // 5) 间隔复测时间：初步掌握后首个间隔为3天；完成一次 spaced pass 后下一阶段为7天。
  const retentionBase = [
    retestRecord(dates.a, true, "normal", "r1"),
    retestRecord(dates.b, true, "normal", "r2")
  ];
  const initialMasteryRetention = await page.evaluate((payload) => {
    const api = window.MathAILearningModel;
    const model = api.buildUnifiedLearningModel(payload, (v) => String(v || "").trim());
    const state = api.deriveKnowledgePointState(model, "数与代数 / 倍数关系");
    return api.deriveReviewSchedule(model, "数与代数 / 倍数关系", state);
  }, {
    mistakes: mistakeRecord(t0),
    training: [],
    retests: retentionBase
  });
  assert.equal(initialMasteryRetention.intervalDays, 3);

  const spacedModelData = {
    mistakes: mistakeRecord(t0),
    training: [],
    retests: [
      ...retentionBase,
      retestRecord(dates.b + 3 * 86400000, true, "spaced_retest", "r3")
    ]
  };
  const afterSpaced = await page.evaluate((payload) => {
    const api = window.MathAILearningModel;
    const model = api.buildUnifiedLearningModel(payload, (v) => String(v || "").trim());
    const state = api.deriveKnowledgePointState(model, "数与代数 / 倍数关系");
    return api.deriveReviewSchedule(model, "数与代数 / 倍数关系", state);
  }, spacedModelData);
  assert.equal(afterSpaced.spacedPasses, 1);
  assert.equal(afterSpaced.intervalDays, 7);

  console.log("V0.21 regression tests: PASS");
  console.log("Checked: micro-skill threshold, prompted guard, dependency scheduling, knowledge-state transitions, retention intervals.");
} finally {
  await browser.close();
}

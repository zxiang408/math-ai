import { chromium } from "playwright";
import assert from "node:assert/strict";

const BASE_URL = process.env.TEST_URL || "http://127.0.0.1:4173/index.html";
const POINT = "数与代数 / 倍数关系";
const HISTORY_KEY = "math-ai-v0.2-mistake-history";
const RETEST_KEY = "math-ai-v0.4-retest-history";
const TRAINING_KEY = "math-ai-v0.6-training-history";

function iso(ms) {
  return new Date(ms).toISOString();
}

function mistakeRecord(createdAt) {
  return [{
    id: "m-v022",
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

function dataWithRetests(retests) {
  const base = Date.now() - 40 * 86400000;
  return {
    mistakes: mistakeRecord(base),
    training: [],
    retests
  };
}

const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"]
});
const page = await browser.newPage();

try {
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());

  const apiInfo = await page.evaluate(() => ({
    hasModelApi: Boolean(window.MathAILearningModel),
    scheduleVersion: window.MathAILearningModel?.RETENTION_SCHEDULE_VERSION,
    intervals: window.MathAILearningModel?.DEFAULT_RETENTION_INTERVALS_DAYS
  }));

  assert.equal(apiInfo.hasModelApi, true, "统一学习模型 API 未暴露");
  assert.equal(apiInfo.scheduleVersion, "V0.22.0");
  assert.deepEqual(
    apiInfo.intervals,
    [3, 7, 14, 30, 60, 90, 180, 365]
  );

  const base = Date.now() - 40 * 86400000;
  const first = base + 3600000;
  const second = base + 7200000;
  const spaced1 = second + 3 * 86400000;
  const spaced2 = spaced1 + 7 * 86400000;
  const spaced3 = spaced2 + 14 * 86400000;

  const initialRecords = [
    retestRecord(first, true, "normal", "r1"),
    retestRecord(second, true, "normal", "r2")
  ];

  const scheduled = async (retests, nowMs) => page.evaluate(
    ({ retests, nowMs }) => {
      const api = window.MathAILearningModel;
      const model = api.buildUnifiedLearningModel(
        {
          mistakes: [{
            id: "m",
            created_at: new Date(nowMs - 40 * 86400000).toISOString(),
            knowledge_points: ["数与代数 / 倍数关系"],
            error_nature: "知识理解不足"
          }],
          training: [],
          retests
        },
        (v) => String(v || "").trim()
      );
      const state = api.deriveKnowledgePointState(
        model,
        "数与代数 / 倍数关系"
      );
      const review = api.deriveReviewScheduleAt(
        model,
        "数与代数 / 倍数关系",
        state,
        api.DEFAULT_RETENTION_INTERVALS_DAYS,
        nowMs
      );
      return { state: state.state, review };
    },
    { retests, nowMs }
  );

  // 1) 3 → 7 → 14 → 30 天递进。
  const r0 = await scheduled(initialRecords, second + 2 * 86400000);
  assert.equal(r0.state, "initial_mastery");
  assert.equal(r0.review.intervalDays, 3);
  assert.equal(r0.review.state, "retaining");

  const r1Records = [
    ...initialRecords,
    retestRecord(spaced1, true, "spaced_retest", "r3")
  ];
  const r1 = await scheduled(r1Records, spaced1 + 1 * 86400000);
  assert.equal(r1.review.intervalDays, 7);
  assert.equal(r1.review.spacedPasses, 1);

  const r2Records = [
    ...r1Records,
    retestRecord(spaced2, true, "spaced_retest", "r4")
  ];
  const r2 = await scheduled(r2Records, spaced2 + 1 * 86400000);
  assert.equal(r2.review.intervalDays, 14);
  assert.equal(r2.review.spacedPasses, 2);

  const r3Records = [
    ...r2Records,
    retestRecord(spaced3, true, "spaced_retest", "r5")
  ];
  const r3 = await scheduled(r3Records, spaced3 + 1 * 86400000);
  assert.equal(r3.review.intervalDays, 30);
  assert.equal(r3.review.spacedPasses, 3);

  // 2) 长期保持复测失败：不继续沿用旧的7/14/30天阶段，保持周期重启。
  const failureAt = spaced1 + 2 * 86400000;
  const recoverAt = failureAt + 3600000;
  const recoveredSpacedAt = recoverAt + 3 * 86400000;

  const afterFailure = await scheduled([
    ...r1Records,
    retestRecord(failureAt, false, "spaced_retest", "rf")
  ], failureAt + 3600000);

  assert.equal(afterFailure.review.resetPending, true);
  assert.equal(afterFailure.review.state, "building");
  assert.equal(afterFailure.review.stateText, "保持复习重启");

  const recoveryRecords = [
    ...r1Records,
    retestRecord(failureAt, false, "spaced_retest", "rf"),
    retestRecord(recoverAt, true, "normal", "rr"),
    retestRecord(recoveredSpacedAt, true, "spaced_retest", "rrs")
  ];

  const afterRecovery = await scheduled(
    recoveryRecords,
    recoveredSpacedAt + 1 * 86400000
  );
  assert.equal(afterRecovery.state, "mastered");
  assert.equal(afterRecovery.review.resetPending, false);
  assert.equal(afterRecovery.review.cycle, "recovery");
  assert.equal(afterRecovery.review.cyclePasses, 1);
  assert.equal(afterRecovery.review.intervalDays, 3);

  // 3) 本地快速复测：间隔达到3天时也必须自动记录为 spaced_retest。
  await page.evaluate((payload) => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(payload.mistakes));
    localStorage.setItem(RETEST_KEY, JSON.stringify(payload.retests));
    localStorage.setItem(TRAINING_KEY, JSON.stringify([]));
  }, {
    mistakes: mistakeRecord(Date.now() - 20 * 86400000),
    retests: [
      retestRecord(Date.now() - 5 * 86400000, true, "normal", "local-r1"),
      retestRecord(Date.now() - 4 * 86400000, true, "normal", "local-r2")
    ]
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  const spacedButton = page.getByRole("button", { name: "生成间隔复测题" }).first();
  assert.equal(await spacedButton.count(), 1, "没有出现可用的间隔复测按钮");
  await spacedButton.click();

  await page.waitForSelector("#retestQuestion", { state: "visible" });
  await page.waitForFunction(
    () => document.getElementById("retestQuestion")?.textContent?.trim().length > 0
  );

  await page.locator("#retestAnswer").fill("0");
  await page.locator("#submitRetestButton").click();
  await page.waitForFunction(() => {
    const raw = localStorage.getItem("math-ai-v0.4-retest-history");
    if (!raw) return false;
    try {
      const items = JSON.parse(raw);
      return Array.isArray(items) && items.length >= 3 &&
        items[0].test_type === "spaced_retest";
    } catch (_) {
      return false;
    }
  });

  const localClassification = await page.evaluate(() => {
    const items = JSON.parse(
      localStorage.getItem("math-ai-v0.4-retest-history") || "[]"
    );
    return items[0]?.test_type;
  });
  assert.equal(localClassification, "spaced_retest");

  // 4) 到期知识点自动进入保持复习队列，并显示启动按钮。
  const dueAt = Date.now() - 8 * 86400000;
  await page.evaluate((payload) => {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(payload.mistakes));
    localStorage.setItem(RETEST_KEY, JSON.stringify(payload.retests));
    localStorage.setItem(TRAINING_KEY, JSON.stringify([]));
  }, {
    mistakes: mistakeRecord(Date.now() - 20 * 86400000),
    retests: [
      retestRecord(dueAt - 3600000, true, "normal", "q-r1"),
      retestRecord(dueAt, true, "normal", "q-r2"),
      retestRecord(dueAt, true, "spaced_retest", "q-r3")
    ]
  });

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => document.getElementById("retentionQueueSummary")?.textContent?.includes("需要保持复习")
  );

  const queueText = await page.locator("#retentionQueueSummary").textContent();
  assert.match(queueText || "", /需要保持复习/);

  const queueItems = await page.locator("#retentionQueueList .retention-queue-item").count();
  assert.equal(queueItems, 1, "到期知识点未进入保持复习队列");

  const queueButton = page.getByRole("button", { name: "📝 开始保持复测" }).first();
  assert.equal(await queueButton.count(), 1, "保持复习队列缺少启动按钮");

  console.log("V0.22 regression tests: PASS");
  console.log("Checked: 3→7→14→30 schedule, retention reset, local spaced classification, due review queue.");
} finally {
  await browser.close();
}

import { chromium } from "playwright";
import assert from "node:assert/strict";

const BASE_URL = process.env.TEST_URL || "http://127.0.0.1:4173/index.html";

const localMistake = {
  id: "local-m1",
  created_at: "2026-09-30T08:00:00.000Z",
  question: "一个数是另一个数的5倍，和是72",
  student_answer: "10",
  correct_answer: "12",
  knowledge_points: ["数与代数 / 倍数关系"],
  error_type: "概念理解错误",
  error_nature: "知识理解不足"
};

const cloudRetest = {
  id: "cloud-r1",
  created_at: "2026-09-30T09:00:00.000Z",
  knowledge_points: ["数与代数 / 倍数关系"],
  question: "复测题",
  student_answer: "12",
  correct_answer: "12",
  passed: true,
  test_type: "normal"
};

const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"]
});

const page = await browser.newPage();
const pushBodies = [];

try {
  await page.route("**/api/sync/status", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        configured: true,
        learner_id: "child-1",
        archive_version: "V0.23.0"
      })
    });
  });

  await page.route("**/api/sync/pull", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        learner_id: "child-1",
        events: [{
          event_id: cloudRetest.id,
          occurred_at: cloudRetest.created_at,
          source: "retest",
          event_type: "retest_attempt",
          schema_version: "V0.17.0",
          raw_payload: cloudRetest,
          normalized_event: {
            schema_version: "V0.17.0",
            learner_id: "local-default",
            event_id: cloudRetest.id,
            occurred_at: cloudRetest.created_at,
            source: "retest",
            event_type: "retest_attempt",
            knowledge_points: cloudRetest.knowledge_points,
            outcome: {
              correct: null,
              passed: true,
              prompted: false
            }
          }
        }]
      })
    });
  });

  await page.route("**/api/sync/push", async route => {
    const body = await route.request().postDataJSON();
    pushBodies.push(body);
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        learner_id: "child-1",
        synced: Array.isArray(body?.events) ? body.events.length : 0
      })
    });
  });

  await page.addInitScript(({ mistake }) => {
    localStorage.clear();
    localStorage.setItem(
      "math-ai-v0.2-mistake-history",
      JSON.stringify([mistake])
    );
    localStorage.setItem(
      "math-ai-v0.4-retest-history",
      JSON.stringify([])
    );
    localStorage.setItem(
      "math-ai-v0.6-training-history",
      JSON.stringify([])
    );
  }, { mistake: localMistake });

  const pageErrors = [];
  const requests = [];
  page.on("pageerror", error => pageErrors.push(String(error && error.stack ? error.stack : error)));
  page.on("request", request => {
    if (request.url().includes("/api/sync/")) {
      requests.push(request.method() + " " + request.url());
    }
  });

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

  await page.waitForTimeout(1500);

  const initialSyncState = await page.evaluate(() => ({
    status: document.getElementById("cloudSyncStatus")?.textContent || "",
    mistakes: JSON.parse(
      localStorage.getItem("math-ai-v0.2-mistake-history") || "[]"
    ).length,
    retests: JSON.parse(
      localStorage.getItem("math-ai-v0.4-retest-history") || "[]"
    ).length
  }));

  assert.match(
    initialSyncState.status,
    /云端学习档案已连接|云端档案已同步/,
    "云端初始化没有完成。状态=" +
      JSON.stringify(initialSyncState) +
      " pageErrors=" +
      JSON.stringify(pageErrors) +
      " requests=" +
      JSON.stringify(requests)
  );

  const mergedCounts = await page.evaluate(() => ({
    mistakes: JSON.parse(
      localStorage.getItem("math-ai-v0.2-mistake-history") || "[]"
    ).length,
    retests: JSON.parse(
      localStorage.getItem("math-ai-v0.4-retest-history") || "[]"
    ).length
  }));

  assert.equal(mergedCounts.mistakes, 1);
  assert.equal(mergedCounts.retests, 1);

  await page.waitForFunction(() => {
    const status = document.getElementById("cloudSyncStatus")?.textContent || "";
    return status.includes("云端学习档案已连接并同步");
  });

  await page.getByRole("button", { name: "☁️ 立即同步" }).click();

  await page.waitForFunction(() => {
    const status = document.getElementById("cloudSyncStatus")?.textContent || "";
    return status.includes("同步完成");
  });

  assert.ok(pushBodies.length >= 1, "没有发生云端 push");

  const allPushedEvents = pushBodies.flatMap(body =>
    Array.isArray(body?.events) ? body.events : []
  );

  assert.ok(
    allPushedEvents.some(event => event.event_id === localMistake.id),
    "本地错题没有被同步"
  );
  assert.ok(
    allPushedEvents.some(event => event.event_id === cloudRetest.id),
    "云端复测记录没有保留并被再次同步"
  );

  console.log("V0.23 browser sync tests: PASS");
} finally {
  await browser.close();
}

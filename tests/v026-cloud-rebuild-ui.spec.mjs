import assert from "node:assert/strict";
import { chromium } from "playwright";
import { rebuildAbility } from "../src/ability-rebuilder.js";

const BASE_URL = process.env.TEST_URL || "http://127.0.0.1:4173/index.html";
const POINT = "数与代数 / 倍数关系";

const base = Date.parse("2026-09-01T00:00:00.000Z");

function event(id, minutes, source, eventType, rawPayload, normalizedExtra = {}) {
  const occurredAt = new Date(base + minutes * 60000).toISOString();

  return {
    event_id: id,
    occurred_at: occurredAt,
    source,
    event_type: eventType,
    schema_version: "V0.17.0",
    raw_payload: {
      ...rawPayload,
      id: rawPayload.id || id,
      created_at: rawPayload.created_at || occurredAt
    },
    normalized_event: {
      schema_version: "V0.17.0",
      learner_id: "local-default",
      event_id: id,
      occurred_at: occurredAt,
      source,
      event_type: eventType,
      ...normalizedExtra
    }
  };
}

const cloudEvents = [
  event(
    "m1",
    0,
    "mistake",
    "mistake_recorded",
    {
      knowledge_points: [POINT],
      question: "一个数是另一个数的5倍，和是72",
      student_answer: "10",
      correct_answer: "12",
      error_type: "概念理解错误",
      error_nature: "知识理解不足"
    },
    {
      knowledge_points: [POINT],
      outcome: { correct: false, passed: false, prompted: false },
      diagnosis: {
        error_type: "概念理解错误",
        error_nature: "知识理解不足"
      }
    }
  ),
  event(
    "r1",
    10,
    "retest",
    "retest_attempt",
    {
      knowledge_points: [POINT],
      question: "复测1",
      student_answer: "12",
      correct_answer: "12",
      passed: true,
      test_type: "normal"
    },
    {
      knowledge_points: [POINT],
      outcome: { correct: true, passed: true, prompted: false }
    }
  ),
  event(
    "r2",
    20,
    "retest",
    "retest_attempt",
    {
      knowledge_points: [POINT],
      question: "复测2",
      student_answer: "12",
      correct_answer: "12",
      passed: true,
      test_type: "normal"
    },
    {
      knowledge_points: [POINT],
      outcome: { correct: true, passed: true, prompted: false }
    }
  )
];

const abilitySnapshot = rebuildAbility(cloudEvents);

const browser = await chromium.launch({
  headless: true,
  executablePath: "/usr/bin/chromium",
  args: ["--no-sandbox"]
});

const page = await browser.newPage();

try {
  await page.route("**/api/sync/status", async route => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        configured: true,
        learner_id: "child-1",
        event_count: cloudEvents.length,
        archive_version: "V0.26.0"
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
        event_count: cloudEvents.length,
        truncated: false,
        events: cloudEvents,
        ability_snapshot: abilitySnapshot
      })
    });
  });

  await page.route("**/api/sync/push", async route => {
    const body = await route.request().postDataJSON();
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

  await page.addInitScript(() => {
    localStorage.clear();
  });

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

  await page.waitForFunction(() => {
    const summary = document.getElementById("learningDataSummary")?.textContent || "";
    const status = document.getElementById("cloudSyncStatus")?.textContent || "";
    return (
      summary.includes("V0.26 云端事件重建已返回") &&
      status.includes("云端学习档案已连接并同步")
    );
  }, null, { timeout: 10000 });

  const restored = await page.evaluate(() => ({
    mistakes: JSON.parse(
      localStorage.getItem("math-ai-v0.2-mistake-history") || "[]"
    ).length,
    retests: JSON.parse(
      localStorage.getItem("math-ai-v0.4-retest-history") || "[]"
    ).length,
    rebuildMeta: JSON.parse(
      localStorage.getItem("math_ai_cloud_sync_meta_v025") || "{}"
    ),
    summary: document.getElementById("learningDataSummary")?.textContent || "",
    abilityText: document.getElementById("abilityList")?.textContent || ""
  }));

  assert.equal(restored.mistakes, 1);
  assert.equal(restored.retests, 2);
  assert.equal(restored.rebuildMeta.ability_rebuild_verified, true);
  assert.match(restored.summary, /V0.26 云端事件重建已返回/);
  assert.match(restored.abilityText, /初步掌握/);

  console.log("V0.26 browser cloud rebuild restore test: PASS");
  console.log("Checked: clear LocalStorage → cloud pull → local restoration → V0.26 ability snapshot parity.");
} finally {
  await browser.close();
}

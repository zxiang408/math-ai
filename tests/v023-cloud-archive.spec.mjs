import assert from "node:assert/strict";
import worker from "../src/index.js";

function envConfigured() {
  return {
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_test",
    MATH_AI_LEARNER_ID: "child-1",
    ASSETS: {
      fetch() {
        return new Response("asset", { status: 200 });
      }
    }
  };
}

function archiveEvent(id = "e1", occurredAt = "2026-09-30T10:00:00.000Z") {
  return {
    event_id: id,
    occurred_at: occurredAt,
    source: "retest",
    event_type: "retest_attempt",
    schema_version: "V0.17.0",
    raw_payload: {
      id,
      created_at: occurredAt,
      knowledge_points: ["数与代数 / 倍数关系"],
      question: "测试题",
      student_answer: "12",
      correct_answer: "12",
      passed: true,
      test_type: "normal"
    },
    normalized_event: {
      schema_version: "V0.17.0",
      learner_id: "local-default",
      event_id: id,
      occurred_at: occurredAt,
      source: "retest",
      event_type: "retest_attempt"
    }
  };
}

async function jsonRequest(path, options = {}) {
  return worker.fetch(
    new Request("https://math-ai.test" + path, options),
    envConfigured()
  );
}

const originalFetch = globalThis.fetch;
const calls = [];

try {
  // 1) 未配置 Supabase 时，应用返回明确的“未配置”，而不是崩溃。
  {
    const response = await worker.fetch(
      new Request("https://math-ai.test/api/sync/status"),
      {
        SUPABASE_URL: "",
        SUPABASE_SECRET_KEY: "",
        ASSETS: {
          fetch() {
            return new Response("asset", { status: 200 });
          }
        }
      }
    );
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.configured, false);
  }

  // 2) 状态检查走 Supabase REST，并正确带 apikey / bearer。
  globalThis.fetch = async (input, init = {}) => {
    calls.push({
      url: String(input),
      method: init.method || "GET",
      headers: init.headers || {},
      body: init.body || null
    });

    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  {
    const response = await jsonRequest("/api/sync/status");
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.configured, true);
    assert.equal(data.learner_id, "child-1");
    assert.match(calls[0].url, /math_ai_learning_events/);
    assert.equal(calls[0].headers.apikey, "sb_secret_test");
    assert.equal(calls[0].headers.Authorization, undefined);
  }

  // 3) Push：先 upsert learner，再批量 upsert learning_events。
  calls.length = 0;
  {
    const response = await jsonRequest("/api/sync/push", {
      method: "POST",
      body: JSON.stringify({
        version: "V0.23.0",
        events: [
          archiveEvent("e1"),
          archiveEvent("e2", "2026-09-30T10:01:00.000Z")
        ]
      })
    });

    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.ok, true);
    assert.equal(data.synced, 2);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /math_ai_learners\?on_conflict=learner_id/);
    assert.match(calls[1].url, /math_ai_learning_events\?on_conflict=learner_id%2Cevent_id/);

    const eventBody = JSON.parse(calls[1].body);
    assert.equal(eventBody.length, 2);
    assert.equal(eventBody[0].learner_id, "child-1");
    assert.equal(eventBody[0].event_id, "e1");
    assert.equal(
      eventBody[0].raw_payload.knowledge_points[0],
      "数与代数 / 倍数关系"
    );
  }

  // 4) Pull：只按 Worker 固定 learner_id 读取，并按发生时间升序返回。
  calls.length = 0;
  globalThis.fetch = async (input, init = {}) => {
    calls.push({
      url: String(input),
      method: init.method || "GET",
      headers: init.headers || {},
      body: init.body || null
    });

    return new Response(JSON.stringify([
      {
        event_id: "e1",
        occurred_at: "2026-09-30T10:00:00.000Z",
        source: "retest",
        event_type: "retest_attempt",
        schema_version: "V0.17.0",
        raw_payload: { id: "e1" },
        normalized_event: { event_id: "e1" }
      }
    ]), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };

  {
    const response = await jsonRequest("/api/sync/pull");
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.ok, true);
    assert.equal(data.learner_id, "child-1");
    assert.equal(data.events.length, 1);
    assert.equal(data.events[0].event_id, "e1");
    assert.match(calls[0].url, /learner_id=eq.child-1/);
    assert.match(calls[0].url, /order=occurred_at.asc/);
  }

  // 5) 非法事件必须被拒绝。
  {
    const response = await jsonRequest("/api/sync/push", {
      method: "POST",
      body: JSON.stringify({
        events: [{ occurred_at: "2026-09-30T10:00:00.000Z" }]
      })
    });
    assert.equal(response.status, 400);
    const data = await response.json();
    assert.equal(data.code, "MISSING_EVENT_ID");
  }

  // 6) CORS preflight。
  {
    const response = await jsonRequest("/api/sync/push", {
      method: "OPTIONS",
      headers: { Origin: "https://math-ai.example" }
    });
    assert.equal(response.status, 204);
    assert.equal(
      response.headers.get("Access-Control-Allow-Origin"),
      "https://math-ai.example"
    );
    assert.match(
      response.headers.get("Access-Control-Allow-Methods") || "",
      /POST/
    );
  }

  console.log("V0.23 cloud archive tests: PASS");
} finally {
  globalThis.fetch = originalFetch;
}

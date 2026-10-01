const MAX_EVENTS_PER_REQUEST = 250;
const MAX_PULL_EVENTS = 5000;
const DEFAULT_LEARNER_ID = "local-default";

function text(value) {
  return String(value ?? "").trim();
}

function isRecord(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function getSupabaseConfig(env) {
  const url = text(env?.SUPABASE_URL).replace(/\/$/, "");
  const key =
    text(env?.SUPABASE_SECRET_KEY) ||
    text(env?.SUPABASE_SERVICE_ROLE_KEY);

  return {
    url,
    key,
    configured: Boolean(url && key)
  };
}

function jsonRequestHeaders(key, extra = {}) {
  const headers = {
    apikey: key,
    "Content-Type": "application/json",
    Accept: "application/json",
    ...extra
  };

  // Supabase's new sb_secret_* keys must be sent via the apikey
  // header only. Legacy service_role JWTs still use the Bearer header.
  if (!key.startsWith("sb_secret_")) {
    headers.Authorization = "Bearer " + key;
  }

  return headers;
}

async function supabaseFetch(env, path, init = {}) {
  const config = getSupabaseConfig(env);

  if (!config.configured) {
    throw new Error("SUPABASE_NOT_CONFIGURED");
  }

  return fetch(
    config.url + "/rest/v1/" + path,
    {
      ...init,
      headers: {
        ...jsonRequestHeaders(config.key),
        ...(init.headers || {})
      }
    }
  );
}

function normalizeStoredRecord(record, normalizedEvent) {
  const raw = isRecord(record) ? record : {};
  const event = isRecord(normalizedEvent)
    ? normalizedEvent
    : {};

  return {
    event_id:
      text(raw.id) ||
      text(event.event_id) ||
      null,
    occurred_at:
      text(raw.created_at) ||
      text(event.occurred_at) ||
      null,
    source:
      text(event.source) ||
      "unknown",
    event_type:
      text(event.event_type) ||
      "unknown",
    schema_version:
      text(event.schema_version) ||
      "V0.17.0",
    raw_payload: raw,
    normalized_event: event
  };
}

export function validateArchiveEvents(events) {
  if (!Array.isArray(events)) {
    return {
      ok: false,
      code: "INVALID_EVENTS",
      error: "events 必须是数组。"
    };
  }

  if (events.length > MAX_EVENTS_PER_REQUEST) {
    return {
      ok: false,
      code: "TOO_MANY_EVENTS",
      error:
        "单次最多同步 " +
        MAX_EVENTS_PER_REQUEST +
        " 条学习事件。"
    };
  }

  for (const event of events) {
    if (!isRecord(event)) {
      return {
        ok: false,
        code: "INVALID_EVENT",
        error: "学习事件必须是对象。"
      };
    }

    if (!text(event.event_id)) {
      return {
        ok: false,
        code: "MISSING_EVENT_ID",
        error: "学习事件缺少 event_id。"
      };
    }

    if (!text(event.occurred_at)) {
      return {
        ok: false,
        code: "MISSING_OCCURRED_AT",
        error: "学习事件缺少 occurred_at。"
      };
    }

    const timestamp = new Date(event.occurred_at);
    if (Number.isNaN(timestamp.getTime())) {
      return {
        ok: false,
        code: "INVALID_OCCURRED_AT",
        error: "学习事件 occurred_at 不是有效时间。"
      };
    }
  }

  return {
    ok: true
  };
}

function cloudRowsFromArchive(events, learnerId) {
  return events.map(function (event) {
    const rawPayload =
      isRecord(event.raw_payload)
        ? event.raw_payload
        : event.payload && isRecord(event.payload)
          ? event.payload
          : {};

    const normalizedEvent =
      isRecord(event.normalized_event)
        ? event.normalized_event
        : {};

    const stored = normalizeStoredRecord(
      rawPayload,
      normalizedEvent
    );

    return {
      learner_id: learnerId,
      event_id: stored.event_id,
      occurred_at: stored.occurred_at,
      source: stored.source,
      event_type: stored.event_type,
      schema_version: stored.schema_version,
      raw_payload: stored.raw_payload,
      normalized_event: stored.normalized_event
    };
  });
}

export async function getArchiveStatus(env, learnerId = DEFAULT_LEARNER_ID) {
  const config = getSupabaseConfig(env);

  if (!config.configured) {
    return {
      configured: false,
      learner_id: learnerId,
      event_count: 0,
      latest_occurred_at: null,
      archive_version: "V0.24.0"
    };
  }

  const query =
    "math_ai_learning_events" +
    "?select=event_id,occurred_at" +
    "&learner_id=eq." +
    encodeURIComponent(learnerId) +
    "&order=occurred_at.desc" +
    "&limit=1";

  const response = await supabaseFetch(env, query, {
    headers: {
      Prefer: "count=exact"
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      "SUPABASE_STATUS_FAILED:" +
      response.status +
      ":" +
      body.slice(0, 500)
    );
  }

  const contentRange = response.headers.get("Content-Range") || "";
  const match = contentRange.match(/\/([0-9]+)$/);
  const rows = await response.json();

  return {
    configured: true,
    learner_id: learnerId,
    event_count: match ? Number(match[1]) : null,
    latest_occurred_at:
      Array.isArray(rows) && rows[0]?.occurred_at
        ? rows[0].occurred_at
        : null,
    archive_version: "V0.24.0"
  };
}
export async function pushArchive(
  env,
  learnerId,
  events
) {
  const config = getSupabaseConfig(env);

  if (!config.configured) {
    return {
      ok: false,
      code: "SUPABASE_NOT_CONFIGURED",
      error:
        "尚未配置 SUPABASE_URL 和 SUPABASE_SECRET_KEY。"
    };
  }

  const validation = validateArchiveEvents(events);
  if (!validation.ok) {
    return validation;
  }

  const normalizedLearnerId =
    text(learnerId) || DEFAULT_LEARNER_ID;

  const rows = cloudRowsFromArchive(
    events.map(function (event) {
      return {
        event_id: event.event_id,
        occurred_at: event.occurred_at,
        source: event.source,
        event_type: event.event_type,
        schema_version: event.schema_version,
        raw_payload: event.raw_payload || event.payload || {},
        normalized_event:
          event.normalized_event ||
          event.normalized ||
          event
      };
    }),
    normalizedLearnerId
  );

  if (rows.length === 0) {
    return {
      ok: true,
      learner_id: normalizedLearnerId,
      synced: 0
    };
  }

  const learnerResponse = await supabaseFetch(
    env,
    "math_ai_learners?on_conflict=learner_id",
    {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify([{
        learner_id: normalizedLearnerId,
        archive_version: "V0.24.0"
      }])
    }
  );

  if (!learnerResponse.ok) {
    const body = await learnerResponse.text();
    return {
      ok: false,
      code: "SUPABASE_LEARNER_UPSERT_FAILED",
      error:
        "云端学习者档案写入失败。",
      detail: body.slice(0, 1000)
    };
  }

  const eventResponse = await supabaseFetch(
    env,
    "math_ai_learning_events?on_conflict=learner_id%2Cevent_id",
    {
      method: "POST",
      headers: {
        Prefer: "resolution=merge-duplicates,return=minimal"
      },
      body: JSON.stringify(rows)
    }
  );

  if (!eventResponse.ok) {
    const body = await eventResponse.text();
    return {
      ok: false,
      code: "SUPABASE_EVENT_UPSERT_FAILED",
      error:
        "学习事件同步到云端失败。",
      detail: body.slice(0, 1000)
    };
  }

  return {
    ok: true,
    learner_id: normalizedLearnerId,
    synced: rows.length
  };
}

export async function pullArchive(
  env,
  learnerId = DEFAULT_LEARNER_ID
) {
  const config = getSupabaseConfig(env);

  if (!config.configured) {
    return {
      ok: false,
      code: "SUPABASE_NOT_CONFIGURED",
      error:
        "尚未配置 SUPABASE_URL 和 SUPABASE_SECRET_KEY。"
    };
  }

  const normalizedLearnerId =
    text(learnerId) || DEFAULT_LEARNER_ID;

  const query =
    "math_ai_learning_events" +
    "?select=event_id,occurred_at,source,event_type,schema_version,raw_payload,normalized_event" +
    "&learner_id=eq." +
    encodeURIComponent(normalizedLearnerId) +
    "&order=occurred_at.asc" +
    "&limit=" +
    MAX_PULL_EVENTS;

  const response = await supabaseFetch(
    env,
    query,
    {
      headers: {
        Prefer: "count=exact"
      }
    }
  );

  if (!response.ok) {
    const body = await response.text();
    return {
      ok: false,
      code: "SUPABASE_PULL_FAILED",
      error: "从云端读取学习档案失败。",
      detail: body.slice(0, 1000)
    };
  }

  const rows = await response.json();
  const contentRange = response.headers.get("Content-Range") || "";
  const match = contentRange.match(/\/([0-9]+)$/);
  const eventCount =
    match ? Number(match[1]) : (Array.isArray(rows) ? rows.length : 0);

  return {
    ok: true,
    learner_id: normalizedLearnerId,
    event_count: eventCount,
    truncated:
      Array.isArray(rows) && rows.length < eventCount,
    events: Array.isArray(rows) ? rows : []
  };
}

export const CLOUD_ARCHIVE_LIMITS = {
  max_events_per_request: MAX_EVENTS_PER_REQUEST,
  max_pull_events: MAX_PULL_EVENTS
};

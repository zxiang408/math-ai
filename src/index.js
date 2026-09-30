const JSON_HEADERS = {
  "Content-Type": "application/json; charset=UTF-8",
  "Cache-Control": "no-store",
};

function jsonResponse(data, status = 200, request) {
  const headers = new Headers(JSON_HEADERS);
  const origin = request?.headers.get("Origin");
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function contentToText(content) {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .map(function (part) {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        if (part && typeof part.content === "string") return part.content;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  if (content && typeof content === "object") {
    if (typeof content.text === "string") return content.text;
    if (typeof content.content === "string") return content.content;
  }

  return "";
}

function extractJson(value) {
  const text = contentToText(value).trim();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch (_) {}

  let unfenced = text;
  if (unfenced.startsWith("```json")) {
    unfenced = unfenced.slice(7);
  } else if (unfenced.startsWith("```")) {
    unfenced = unfenced.slice(3);
  }
  if (unfenced.endsWith("```")) {
    unfenced = unfenced.slice(0, -3);
  }
  unfenced = unfenced.trim();

  try {
    return JSON.parse(unfenced);
  } catch (_) {}

  const first = unfenced.indexOf("{");
  if (first < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = first; i < unfenced.length; i++) {
    const ch = unfenced[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }

    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(unfenced.slice(first, i + 1));
        } catch (_) {
          return null;
        }
      }
    }
  }

  return null;
}

function normalizeResult(result) {
  return {
    question: String(result?.question ?? "").trim(),
    student_answer: String(result?.student_answer ?? "").trim(),
    correct_answer: String(result?.correct_answer ?? "").trim(),
    knowledge_points: Array.isArray(result?.knowledge_points)
      ? result.knowledge_points.map(String).filter(Boolean).slice(0, 8)
      : [],
    error_type: String(result?.error_type ?? "").trim(),
    analysis: String(result?.analysis ?? "").trim(),
    confidence:
      typeof result?.confidence === "number"
        ? Math.max(0, Math.min(1, result.confidence))
        : null,
    unclear: Boolean(result?.unclear),
  };
}

async function analyzeImage(request, env) {
  if (request.method === "OPTIONS") {
    const headers = new Headers({
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    });
    const origin = request.headers.get("Origin");
    if (origin) {
      headers.set("Access-Control-Allow-Origin", origin);
      headers.set("Vary", "Origin");
    }
    return new Response(null, { status: 204, headers });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "只支持 POST 请求。" }, 405, request);
  }

  if (!env.OPENROUTER_API_KEY) {
    return jsonResponse(
      { error: "服务器尚未配置 OPENROUTER_API_KEY。" },
      500,
      request,
    );
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: "请求数据不是有效的 JSON。" }, 400, request);
  }

  const image = body?.image;
  if (typeof image !== "string" || !image.startsWith("data:image/")) {
    return jsonResponse({ error: "没有收到有效的错题图片。" }, 400, request);
  }

  // Keep the V0.1 request small and predictable. The browser also compresses images
  // before sending them.
  if (image.length > 8 * 1024 * 1024) {
    return jsonResponse(
      { error: "图片太大，请选择较小的图片再试。" },
      413,
      request,
    );
  }

  const prompt = `你是一名小学数学错题分析老师。
请仔细观察用户上传的错题照片，只根据照片中能够确认的内容进行分析，不要猜测看不清的数字或步骤。

请完成：
1. 识别题目。
2. 识别孩子写出的答案；如果照片看不清，明确写“无法确认”。
3. 给出正确答案；计算时自行核验。
4. 判断涉及的主要小学数学知识点。
5. 判断错误类型，例如“计算错误”“概念理解错误”“审题错误”“步骤错误”“答案抄写错误”“无法判断”等。
6. 用适合家长阅读的中文简要说明为什么错、应该重点检查什么。
7. 如果图片无法可靠识别，请把 unclear 设为 true，并在 analysis 中说明原因。

请只返回一个合法 JSON 对象，不要 Markdown，不要解释 JSON 之外的内容。
字段必须是：
{
  "question": "题目原文或尽可能准确的识别结果",
  "student_answer": "孩子答案",
  "correct_answer": "正确答案",
  "knowledge_points": ["知识点1", "知识点2"],
  "error_type": "错误类型",
  "analysis": "简明的错误分析",
  "confidence": 0.0,
  "unclear": false
}
confidence 为 0 到 1 之间的小数，表示你对整道题识别与分析的把握程度。`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  let upstreamResponse;
  try {
    upstreamResponse = await fetch(
      "https://openrouter.ai/api/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://math-ai.zxiang88688.workers.dev",
          "X-Title": "小学数学 AI",
        },
        body: JSON.stringify({
          model: "mistralai/mistral-small-3.2-24b-instruct:free",
          temperature: 0.2,
          max_tokens: 800,
          messages: [
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              {
                type: "image_url",
                image_url: { url: image },
              },
            ],
          },
          ],
        }),
        signal: controller.signal,
      },
    );
  } catch (error) {
    if (error && error.name === "AbortError") {
      return jsonResponse(
        {
          error: "AI 服务响应超时（30 秒）。免费模型当前可能繁忙，请稍后再试。",
          code: "OPENROUTER_TIMEOUT",
        },
        504,
        request,
      );
    }

    return jsonResponse(
      {
        error: "连接 OpenRouter 失败：" + (error?.message || "未知网络错误"),
        code: "OPENROUTER_NETWORK_ERROR",
      },
      502,
      request,
    );
  } finally {
    clearTimeout(timeoutId);
  }

  let upstreamBody;
  try {
    upstreamBody = await upstreamResponse.json();
  } catch (_) {
    return jsonResponse(
      { error: `OpenRouter 返回了无法解析的响应（HTTP ${upstreamResponse.status}）。` },
      502,
      request,
    );
  }

  if (!upstreamResponse.ok) {
    const errorObject = upstreamBody?.error || {};
    const message =
      errorObject?.message ||
      upstreamBody?.message ||
      "OpenRouter 请求失败。";

    return jsonResponse(
      {
        error: message,
        upstream_status: upstreamResponse.status,
        upstream_code: errorObject?.code ?? null,
        upstream_metadata:
          errorObject?.metadata ?? upstreamBody?.metadata ?? null,
      },
      502,
      request,
    );
  }

  const content = upstreamBody?.choices?.[0]?.message?.content;
  const parsed = extractJson(content);

  if (!parsed) {
    const preview = contentToText(content).slice(0, 800);

    return jsonResponse(
      {
        error: "AI 返回的内容无法解析为 JSON。",
        raw_preview: preview,
      },
      502,
      request,
    );
  }

  return jsonResponse(normalizeResult(parsed), 200, request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/analyze") {
      return analyzeImage(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

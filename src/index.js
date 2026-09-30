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

const KNOWLEDGE_POINT_ALIASES = [
  {
    canonical: "图形与几何 / 正方形面积",
    aliases: ["正方形的面积公式", "正方形面积公式", "正方形面积"],
  },
  {
    canonical: "图形与几何 / 长方形面积",
    aliases: ["长方形的面积公式", "长方形面积公式", "长方形面积"],
  },
  {
    canonical: "数与代数 / 积的变化规律",
    aliases: ["积的变化规律", "乘积的变化规律", "积的倍数变化"],
  },
  {
    canonical: "数与代数 / 倍数关系",
    aliases: ["倍数关系", "倍数"],
  },
  {
    canonical: "数与代数 / 分数",
    aliases: ["分数", "分数概念", "分数的意义"],
  },
  {
    canonical: "数与代数 / 小数",
    aliases: ["小数", "小数概念", "小数的意义"],
  },
  {
    canonical: "数与代数 / 四则运算",
    aliases: ["四则运算", "加减乘除", "混合运算"],
  },
  {
    canonical: "数与代数 / 运算律",
    aliases: ["运算律", "交换律", "结合律", "分配律"],
  },
  {
    canonical: "数与代数 / 比与比例",
    aliases: ["比与比例", "比例", "比的意义"],
  },
  {
    canonical: "统计与概率 / 统计",
    aliases: ["统计", "统计图", "平均数"],
  },
];

function standardizeKnowledgePoint(point) {
  const text = String(point ?? "")
    .trim()
    .replace(/\s+/g, "");

  if (!text) return "";

  for (const item of KNOWLEDGE_POINT_ALIASES) {
    if (
      item.aliases.some(function (alias) {
        return text.includes(alias.replace(/\s+/g, ""));
      })
    ) {
      return item.canonical;
    }
  }

  return "待归类 / " + String(point).trim();
}

function standardizeKnowledgePoints(points) {
  if (!Array.isArray(points)) return [];

  const result = [];

  points.slice(0, 8).forEach(function (point) {
    const standardized = standardizeKnowledgePoint(point);
    if (standardized && !result.includes(standardized)) {
      result.push(standardized);
    }
  });

  return result;
}

const ERROR_TYPES = [
  "计算错误",
  "概念理解错误",
  "审题错误",
  "方法/步骤错误",
  "抄写/书写错误",
  "单位错误",
  "粗心/注意力错误",
  "无法判断",
];

const ERROR_NATURES = [
  "偶然失误",
  "知识理解不足",
  "无法判断",
];

function standardizeErrorType(value) {
  const text = String(value ?? "").trim();

  if (!text) return "无法判断";

  for (const type of ERROR_TYPES) {
    if (text === type || text.includes(type)) {
      return type;
    }
  }

  if (text.includes("抄") || text.includes("书写")) {
    return "抄写/书写错误";
  }

  if (text.includes("计算")) {
    return "计算错误";
  }

  if (text.includes("概念")) {
    return "概念理解错误";
  }

  if (text.includes("审题")) {
    return "审题错误";
  }

  if (text.includes("步骤") || text.includes("方法")) {
    return "方法/步骤错误";
  }

  if (text.includes("单位")) {
    return "单位错误";
  }

  if (text.includes("粗心") || text.includes("注意")) {
    return "粗心/注意力错误";
  }

  return "无法判断";
}

function standardizeErrorNature(value) {
  const text = String(value ?? "").trim();

  if (ERROR_NATURES.includes(text)) {
    return text;
  }

  if (
    text.includes("偶然") ||
    text.includes("失误") ||
    text.includes("粗心")
  ) {
    return "偶然失误";
  }

  if (
    text.includes("知识") ||
    text.includes("概念") ||
    text.includes("没掌握") ||
    text.includes("未掌握")
  ) {
    return "知识理解不足";
  }

  return "无法判断";
}

function normalizeResult(result) {
  return {
    question: String(result?.question ?? "").trim(),
    student_answer: String(result?.student_answer ?? "").trim(),
    correct_answer: String(result?.correct_answer ?? "").trim(),
    knowledge_points: standardizeKnowledgePoints(result?.knowledge_points),
    error_type: standardizeErrorType(result?.error_type),
    error_nature: standardizeErrorNature(result?.error_nature),
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
4. 判断涉及的主要小学数学知识点。知识点名称尽量使用下面的标准名称；若无法匹配，可返回最接近的自然语言名称，程序会继续归类。
标准知识点包括：
- 图形与几何 / 正方形面积
- 图形与几何 / 长方形面积
- 数与代数 / 积的变化规律
- 数与代数 / 倍数关系
- 数与代数 / 分数
- 数与代数 / 小数
- 数与代数 / 四则运算
- 数与代数 / 运算律
- 数与代数 / 比与比例
- 统计与概率 / 统计
5. 判断错误类型，只从下面类型中选择一个：
- 计算错误
- 概念理解错误
- 审题错误
- 方法/步骤错误
- 抄写/书写错误
- 单位错误
- 粗心/注意力错误
- 无法判断

特别注意：如果孩子最终答案正确，但中间过程存在把数字写错、抄错、对齐时写错等问题，不要判为“审题错误”，优先判为“抄写/书写错误”。

6. 判断这次错误更像哪一种性质，只从下面选择一个：
- 偶然失误：知识和方法看起来已经会，只是一次性失误。
- 知识理解不足：从错误表现看，存在知识、概念或方法没有真正掌握的迹象。
- 无法判断：照片或证据不足，不能可靠区分。

7. 用适合家长阅读的中文简要说明为什么错、应该重点检查什么，并明确说明你为什么判断为“偶然失误”或“知识理解不足”。
8. 如果图片无法可靠识别，请把 unclear 设为 true，并在 analysis 中说明原因。

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
          models: [
            "qwen/qwen3.8-27b:free",
            "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
            "openrouter/free",
          ],
          temperature: 0.2,
          max_tokens: 1800,
          reasoning: { enabled: false },
          tools: [
            {
              type: "function",
              function: {
                name: "analyze_math_problem",
                description: "Return the structured analysis of the uploaded primary-school math problem.",
                parameters: {
                  type: "object",
                  properties: {
                    question: { type: "string", description: "题目原文或尽可能准确的识别结果" },
                    student_answer: { type: "string", description: "孩子写出的答案；无法确认时写无法确认" },
                    correct_answer: { type: "string", description: "正确答案；无法可靠计算或确认时写无法确认" },
                    knowledge_points: {
                      type: "array",
                      items: { type: "string" },
                      description: "主要小学数学知识点"
                    },
                    error_type: { type: "string", description: "错误类型，只能从指定类型中选一个" },
                    error_nature: { type: "string", description: "错误性质，只能是偶然失误、知识理解不足或无法判断" },
                    analysis: { type: "string", description: "简明说明错误原因、应检查什么以及判断错误性质的依据" },
                    confidence: { type: "number", description: "0到1之间的识别与分析把握度" },
                    unclear: { type: "boolean", description: "图片是否存在影响可靠分析的模糊内容" }
                  },
                  required: [
                    "question",
                    "student_answer",
                    "correct_answer",
                    "knowledge_points",
                    "error_type",
                    "error_nature",
                    "analysis",
                    "confidence",
                    "unclear"
                  ]
                }
              }
            }
          ],
          tool_choice: {
            type: "function",
            function: { name: "analyze_math_problem" }
          },
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

  const message = upstreamBody?.choices?.[0]?.message;

  const toolCall = Array.isArray(message?.tool_calls)
    ? message.tool_calls.find(
        (call) =>
          call?.type === "function" &&
          call?.function?.name === "analyze_math_problem",
      )
    : null;

  if (toolCall?.function?.arguments) {
    try {
      const parsedArgs = JSON.parse(toolCall.function.arguments);
      const normalized = normalizeResult(parsedArgs);
      normalized.model = upstreamBody?.model ?? null;
      return jsonResponse(normalized, 200, request);
    } catch (_) {
      return jsonResponse(
        {
          error: "AI 工具调用返回的数据不是有效 JSON。",
          raw_preview: String(toolCall.function.arguments).slice(0, 800),
        },
        502,
        request,
      );
    }
  }

  const content = message?.content;
  const parsed = extractJson(content);

  if (!parsed) {
    const raw = contentToText(content);

    return jsonResponse(
      {
        error: "AI 没有返回可用的结构化分析结果。",
        finish_reason: upstreamBody?.choices?.[0]?.finish_reason ?? null,
        raw_length: raw.length,
        raw_preview: raw.slice(0, 1200),
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

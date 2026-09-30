import {
  verifyMathAnswer,
  extractSingleNumericValue
} from "../public/math-engine.js";

const APP_VERSION = "V0.18.0";

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

  headers.set("X-Math-AI-Version", APP_VERSION);

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

function standardizeErrorNature(value, errorType) {
  const text = String(value ?? "").trim();
  const normalizedErrorType =
    standardizeErrorType(errorType);

  if (
    text &&
    text !== "无法判断" &&
    (
      text === "偶然失误" ||
      text === "知识理解不足"
    )
  ) {
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

  // Use the error type as a fallback when the model returned
  // "无法判断" for the nature.
  if (normalizedErrorType === "概念理解错误") {
    return "知识理解不足";
  }

  if (
    normalizedErrorType === "抄写/书写错误" ||
    normalizedErrorType === "粗心/注意力错误"
  ) {
    return "偶然失误";
  }

  return "无法判断";
}

function extractLastNumericValue(value) {
  return extractSingleNumericValue(value);
}

function compareSimpleRetestAnswers(studentAnswer, correctAnswer) {
  const verdict = verifyMathAnswer(
    studentAnswer,
    correctAnswer
  );

  return verdict.correct;
}

function normalizeResult(result) {
  const errorType =
    standardizeErrorType(result?.error_type);

  return {
    question: String(result?.question ?? "").trim(),
    student_answer: String(result?.student_answer ?? "").trim(),
    correct_answer: String(result?.correct_answer ?? "").trim(),
    knowledge_points: standardizeKnowledgePoints(result?.knowledge_points),
    error_type: errorType,
    error_nature: standardizeErrorNature(
      result?.error_nature,
      errorType
    ),
    analysis: String(result?.analysis ?? "").trim(),
    confidence:
      typeof result?.confidence === "number"
        ? Math.max(0, Math.min(1, result.confidence))
        : null,
    unclear: Boolean(result?.unclear),
  };
}


function getAIProviders(env) {
  const providers = [];

  if (env?.GROQ_API_KEY) {
    providers.push({
      name: "groq",
      apiKey: env.GROQ_API_KEY,
      url: "https://api.groq.com/openai/v1/chat/completions",
      model: "qwen/qwen3.8-27b",
    });
  }

  if (env?.OPENROUTER_API_KEY) {
    providers.push({
      name: "openrouter",
      apiKey: env.OPENROUTER_API_KEY,
      url: "https://openrouter.ai/api/v1/chat/completions",
      models: [
        "qwen/qwen3.8-27b:free",
        "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
        "openrouter/free",
      ],
    });
  }

  return providers;
}

function buildAIRequestBody(provider, baseBody) {
  const body = { ...baseBody };

  if (provider.name === "groq") {
    body.model = provider.model;
    delete body.models;
    delete body.provider;

    // Groq uses reasoning_effort rather than OpenRouter's reasoning object.
    if (body.reasoning && typeof body.reasoning === "object") {
      delete body.reasoning;
      body.reasoning_effort = "none";
    }
  } else {
    delete body.model;
    if (!body.models) {
      body.models = provider.models;
    }
  }

  return body;
}

async function fetchAIProvider(provider, baseBody, timeoutMs = 20000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers = {
      "Authorization": "Bearer " + provider.apiKey,
      "Content-Type": "application/json",
    };

    if (provider.name === "openrouter") {
      headers["HTTP-Referer"] = "https://math-ai.zxiang88688.workers.dev";
      headers["X-Title"] = "小学数学 AI";
    }

    const response = await fetch(provider.url, {
      method: "POST",
      headers,
      body: JSON.stringify(buildAIRequestBody(provider, baseBody)),
      signal: controller.signal,
    });

    let body;
    try {
      body = await response.json();
    } catch (_) {
      return {
        ok: false,
        status: response.status,
        provider: provider.name,
        body: null,
        reason: "上游返回无法解析的 JSON。",
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        provider: provider.name,
        body,
        reason:
          body?.error?.message ||
          body?.message ||
          ("HTTP " + response.status),
      };
    }

    return {
      ok: true,
      status: response.status,
      provider: provider.name,
      body,
      reason: null,
    };
  } catch (error) {
    return {
      ok: false,
      status: error?.name === "AbortError" ? 504 : 502,
      provider: provider.name,
      body: null,
      reason:
        error?.name === "AbortError"
          ? "响应超时。"
          : error?.message || "网络错误。",
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

async function requestStructuredJson(env, prompt, functionName, properties, required) {
  const providers = getAIProviders(env);

  if (!providers.length) {
    return {
      ok: false,
      status: 500,
      data: {
        error: "服务器尚未配置 GROQ_API_KEY 或 OPENROUTER_API_KEY。",
        code: "AI_PROVIDER_NOT_CONFIGURED",
      },
    };
  }

  async function doRequest(provider, useStructuredFormat) {
    const baseBody = {
      temperature: 0.2,
      max_tokens: 700,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    };

    if (useStructuredFormat) {
      baseBody.response_format = {
        type: "json_schema",
        json_schema: {
          name: functionName,
          strict: true,
          schema: {
            type: "object",
            properties,
            required,
            additionalProperties: false,
          },
        },
      };
    }

    const result = await fetchAIProvider(
      provider,
      baseBody,
      provider.name === "groq" ? 20000 : 20000,
    );

    if (!result.ok) {
      return {
        ok: false,
        status: result.status === 429 ? 429 : 502,
        retryable:
          useStructuredFormat &&
          [400, 422].includes(result.status),
        data: {
          error:
            result.reason ||
            (provider.name === "groq"
              ? "Groq 请求失败。"
              : "OpenRouter 请求失败。"),
          provider: provider.name,
          upstream_status: result.status,
          upstream_code: result.body?.error?.code ?? null,
          upstream_metadata:
            result.body?.error?.metadata ??
            result.body?.metadata ??
            null,
        },
      };
    }

    const message = result.body?.choices?.[0]?.message;

    const toolCall = Array.isArray(message?.tool_calls)
      ? message.tool_calls.find(
          (call) =>
            call?.type === "function" &&
            call?.function?.name === functionName,
        )
      : null;

    let parsed = null;

    if (toolCall?.function?.arguments) {
      try {
        parsed = JSON.parse(toolCall.function.arguments);
      } catch (_) {
        parsed = extractJson(toolCall.function.arguments);
      }
    }

    if (!parsed) {
      parsed = extractJson(message?.content);
    }

    const rawText = contentToText(
      toolCall?.function?.arguments ||
      message?.content,
    );

    if (!parsed) {
      return {
        ok: false,
        status: 502,
        retryable: useStructuredFormat,
        data: {
          error: "AI 返回了内容，但无法解析为有效的结构化 JSON。",
          provider: provider.name,
          raw_preview: rawText.slice(0, 1200),
        },
      };
    }

    return {
      ok: true,
      status: 200,
      data: parsed,
      model: result.body?.model ?? provider.model ?? provider.name,
    };
  }

  const failures = [];

  for (const provider of providers) {
    const first = await doRequest(provider, true);

    if (first.ok) {
      return first;
    }

    if (first.retryable) {
      const second = await doRequest(provider, false);

      if (second.ok) {
        return second;
      }

      failures.push({
        provider: provider.name,
        first_error: first.data,
        second_error: second.data,
      });
      continue;
    }

    failures.push({
      provider: provider.name,
      error: first.data,
    });
  }

  return {
    ok: false,
    status: failures.some(
      (item) =>
        item?.error?.upstream_status === 429 ||
        item?.first_error?.upstream_status === 429 ||
        item?.second_error?.upstream_status === 429,
    )
      ? 429
      : 502,
    data: {
      error: "所有已配置的 AI 服务都未返回可用结果。",
      code: "ALL_AI_PROVIDERS_FAILED",
      failures,
    },
  };
}

function generateFastRetest(knowledgePoint) {
  const point = String(knowledgePoint || "").trim();

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  if (point === "图形与几何 / 正方形面积") {
    const side = randInt(3, 12);
    return {
      question: `一个正方形的边长是${side}厘米，这个正方形的面积是多少平方厘米？`,
      correct_answer: String(side * side) + "平方厘米",
      knowledge_points: [point],
      explanation: `正方形的面积等于边长乘边长，${side}×${side}=${side * side}。`,
      model: "local_fast_template",
    };
  }

  if (point === "图形与几何 / 长方形面积") {
    const length = randInt(5, 15);
    const width = randInt(3, 10);
    return {
      question: `一个长方形的长是${length}厘米，宽是${width}厘米，这个长方形的面积是多少平方厘米？`,
      correct_answer: String(length * width) + "平方厘米",
      knowledge_points: [point],
      explanation: `长方形的面积等于长乘宽，${length}×${width}=${length * width}。`,
      model: "local_fast_template",
    };
  }

  if (point === "数与代数 / 积的变化规律") {
    const factor = randInt(2, 6);
    return {
      question: `一个乘法算式中，如果一个因数不变，另一个因数扩大${factor}倍，那么积扩大多少倍？`,
      correct_answer: String(factor) + "倍",
      knowledge_points: [point],
      explanation: `一个因数不变，另一个因数扩大${factor}倍，积也扩大${factor}倍。`,
      model: "local_fast_template",
    };
  }

  if (point === "数与代数 / 倍数关系") {
    const small = randInt(6, 15);
    const multiple = randInt(2, 6);
    const large = small * multiple;
    const sum = small + large;
    return {
      question: `一个数是另一个数的${multiple}倍。如果这两个数的和是${sum}，较小的数是多少？`,
      correct_answer: String(small),
      knowledge_points: [point],
      explanation: `设较小的数为x，较大的数就是${multiple}x，所以（1+${multiple}）x=${sum}，得到x=${small}。`,
      model: "local_fast_template",
    };
  }

  if (point === "数与代数 / 四则运算") {
    const a = randInt(20, 90);
    const b = randInt(2, 9);
    const c = randInt(3, 12);
    const result = a + b * c;
    return {
      question: `计算：${a}＋${b}×${c}＝？`,
      correct_answer: String(result),
      knowledge_points: [point],
      explanation: `先算乘法：${b}×${c}=${b * c}，再算加法：${a}＋${b * c}=${result}。`,
      model: "local_fast_template",
    };
  }

  if (point === "数与代数 / 小数") {
    const a = (randInt(12, 45) / 10).toFixed(1);
    const b = (randInt(10, 35) / 10).toFixed(1);
    const result = (Number(a) + Number(b)).toFixed(1).replace(/\.0$/, "");
    return {
      question: `计算：${a}＋${b}＝？`,
      correct_answer: result,
      knowledge_points: [point],
      explanation: `把小数点对齐后相加，结果是${result}。`,
      model: "local_fast_template",
    };
  }

  if (point === "数与代数 / 比与比例") {
    const unit = randInt(3, 8);
    const first = unit * 2;
    const second = unit * 3;
    const target = second * 2;
    return {
      question: `如果甲、乙两数的比是${first}:${second}，当甲是${first * 2}时，乙是多少？`,
      correct_answer: String(target),
      knowledge_points: [point],
      explanation: `${first}变成${first * 2}扩大2倍，乙也扩大2倍，因此乙为${second * 2}，即${second * 2}。`,
      model: "local_fast_template",
    };
  }

  return null;
}

async function generateRetest(request, env) {
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

  if (!env.GROQ_API_KEY && !env.OPENROUTER_API_KEY) {
    return jsonResponse(
      { error: "服务器尚未配置 GROQ_API_KEY 或 OPENROUTER_API_KEY。" },
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

  const knowledgePoint =
    String(body?.knowledge_point || "").trim();

  if (!knowledgePoint) {
    return jsonResponse(
      { error: "缺少需要复测的知识点。" },
      400,
      request,
    );
  }

  // 常见小学知识点优先走本地题型模板，避免孩子每次点题都等待免费模型。
  // 未覆盖的知识点继续使用 AI 生成，不改变原有功能。
  const fastRetest = generateFastRetest(knowledgePoint);

  if (fastRetest) {
    return jsonResponse(fastRetest, 200, request);
  }

  const prompt = `你是一名小学数学老师。
请针对以下知识点生成 1 道“复测题”，用于判断孩子是否真正理解这个知识点：

知识点：${knowledgePoint}

要求：
1. 题目必须是小学数学题。
2. 不要直接重复原来的题目；换数字、换问法或换情境。
3. 只重点考查这个知识点，避免引入无关的高难知识。
4. 难度与普通小学练习题接近。
5. 题目必须只有一个明确、可核验的答案。
6. correct_answer 必须经过你自己计算和核对。
7. explanation 用简短中文说明正确思路，供家长查看；不要直接把详细解题过程放在给孩子看的题目中。
8. 只返回合法 JSON，不要 Markdown。

字段：
{
  "question": "复测题",
  "correct_answer": "标准答案",
  "knowledge_points": ["${knowledgePoint}"],
  "explanation": "正确思路"
}`;

  const result = await requestStructuredJson(
    env,
    prompt,
    "generate_retest_question",
    {
      question: {
        type: "string",
        description: "新生成的复测题",
      },
      correct_answer: {
        type: "string",
        description: "正确答案",
      },
      knowledge_points: {
        type: "array",
        items: { type: "string" },
        description: "对应知识点",
      },
      explanation: {
        type: "string",
        description: "正确思路",
      },
    },
    ["question", "correct_answer", "knowledge_points", "explanation"],
  );

  if (!result.ok) {
    return jsonResponse(result.data, result.status, request);
  }

  const output = {
    question: String(result.data?.question ?? "").trim(),
    correct_answer: String(result.data?.correct_answer ?? "").trim(),
    knowledge_points:
      standardizeKnowledgePoints(result.data?.knowledge_points),
    explanation: String(result.data?.explanation ?? "").trim(),
    model: result.model ?? null,
  };

  if (!output.question || !output.correct_answer) {
    return jsonResponse(
      {
        error: "AI 生成的复测题不完整。",
        raw_preview: JSON.stringify(result.data).slice(0, 1000),
      },
      502,
      request,
    );
  }

  return jsonResponse(output, 200, request);
}

async function evaluateRetest(request, env) {
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

  if (!env.GROQ_API_KEY && !env.OPENROUTER_API_KEY) {
    return jsonResponse(
      { error: "服务器尚未配置 GROQ_API_KEY 或 OPENROUTER_API_KEY。" },
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

  const question = String(body?.question || "").trim();
  const correctAnswer = String(body?.correct_answer || "").trim();
  const studentAnswer = String(body?.student_answer || "").trim();
  const knowledgePoints = standardizeKnowledgePoints(
    body?.knowledge_points,
  );

  if (!question || !correctAnswer || !studentAnswer) {
    return jsonResponse(
      { error: "复测题、正确答案和孩子答案都不能为空。" },
      400,
      request,
    );
  }

  // 对单一数值型答案先做本地确定性核验。
  // 这样可以避免免费模型偶发的 JSON 输出问题影响最基本的复测判断；
  // 复杂表达、分数、步骤题仍交给 AI 判断。
  const simpleVerdict = compareSimpleRetestAnswers(
    studentAnswer,
    correctAnswer,
  );

  if (simpleVerdict !== null) {
    return jsonResponse(
      {
        correct: simpleVerdict,
        error_type: simpleVerdict ? "" : "无法判断",
        error_nature: simpleVerdict ? "" : "无法判断",
        analysis: simpleVerdict
          ? "孩子的最终数值答案与标准答案一致，判定为正确。"
          : "孩子的最终数值答案与标准答案不一致，判定为未通过；具体错误原因需结合解题过程进一步判断。",
        knowledge_points: knowledgePoints,
        model: "local_simple_answer_check",
      },
      200,
      request,
    );
  }

  const prompt = `你是一名小学数学复测老师。
请判断孩子对下面复测题的回答是否正确。

题目：
${question}

标准正确答案：
${correctAnswer}

孩子答案：
${studentAnswer}

目标知识点：
${knowledgePoints.join("、") || "未指定"}

要求：
1. 先自行核对标准答案，避免因为格式差异误判。
2. 只判断孩子最终答案是否正确；如果孩子答案表达方式不同但数学含义相同，视为正确。
3. 如果错误，判断主要错误类型，只从以下选择一个：
计算错误、概念理解错误、审题错误、方法/步骤错误、抄写/书写错误、单位错误、粗心/注意力错误、无法判断。
4. 如果错误明显属于知识理解不足，error_nature 写“知识理解不足”；如果更像一次偶然失误，写“偶然失误”；证据不足写“无法判断”。
5. analysis 简短说明判断依据。
6. 只返回合法 JSON。

字段：
{
  "correct": true,
  "error_type": "无法判断",
  "error_nature": "无法判断",
  "analysis": "说明"
}`;

  const result = await requestStructuredJson(
    env,
    prompt,
    "evaluate_retest_answer",
    {
      correct: {
        type: "boolean",
        description: "孩子最终答案是否正确",
      },
      error_type: {
        type: "string",
        description: "错误类型",
      },
      error_nature: {
        type: "string",
        description: "错误性质",
      },
      analysis: {
        type: "string",
        description: "判断依据",
      },
    },
    ["correct", "error_type", "error_nature", "analysis"],
  );

  if (!result.ok) {
    return jsonResponse(result.data, result.status, request);
  }

  const errorType = standardizeErrorType(result.data?.error_type);
  const errorNature = result.data?.correct
    ? ""
    : standardizeErrorNature(
        result.data?.error_nature,
        errorType,
      );

  return jsonResponse(
    {
      correct: Boolean(result.data?.correct),
      error_type: result.data?.correct ? "" : errorType,
      error_nature: result.data?.correct ? "" : errorNature,
      analysis: String(result.data?.analysis ?? "").trim(),
      knowledge_points: knowledgePoints,
      model: result.model ?? null,
    },
    200,
    request,
  );
}

async function tutorStep(request, env) {
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

  if (!env.GROQ_API_KEY && !env.OPENROUTER_API_KEY) {
    return jsonResponse(
      { error: "服务器尚未配置 GROQ_API_KEY 或 OPENROUTER_API_KEY。" },
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

  const point = String(body?.knowledge_point || "").trim();
  const question = String(body?.question || "").trim();
  const currentPrompt = String(body?.current_prompt || "").trim();
  const studentAnswer = String(body?.student_answer || "").trim();
  const stepIndex = Math.max(
    0,
    Number.isFinite(Number(body?.step_index))
      ? Number(body.step_index)
      : 0,
  );
  const steps = Array.isArray(body?.steps) ? body.steps : [];
  const history = Array.isArray(body?.history)
    ? body.history.slice(-6)
    : [];

  if (!point || !question || !currentPrompt || !studentAnswer) {
    return jsonResponse(
      { error: "缺少 AI 辅导所需的题目、当前步骤或孩子答案。" },
      400,
      request,
    );
  }

  if (point !== "数与代数 / 倍数关系") {
    return jsonResponse({
      enabled: false,
      action: "fallback",
      coach_message: "",
      next_prompt: "",
      diagnosis: "",
      confidence: 1,
      model: "deterministic_fallback",
    });
  }

  const safeSteps = steps.map(function (step, index) {
    return {
      index: index,
      prompt: String(step?.prompt || ""),
    };
  });

  const prompt = `你是一名小学四年级数学一对一辅导老师。
你现在只辅导“数与代数 / 倍数关系”。

【整道题】
${question}

【当前步骤】
第${stepIndex + 1}步：${currentPrompt}

【孩子刚才回答】
${studentAnswer}

【前面步骤骨架】
${JSON.stringify(safeSteps)}

【前面互动记录】
${JSON.stringify(history)}

你的目标：
- 判断孩子刚才这一步到底哪里想对了、哪里想错了。
- 不要直接公布整道题最终答案。
- 不要跳过当前步骤。
- 如果孩子把“较大数的份数”和“总份数”混淆，要指出这种混淆，但继续让孩子自己回答。
- 如果孩子错误但接近，换一种更容易理解的短问题。
- 如果孩子连续卡住，把当前问题拆得更小。
- 如果孩子理解正确，给出简短鼓励，并进入下一步。
- 不要把后面的计算提前做完。
- 语言要像老师对四年级孩子说话，短句、具体、自然。
- 只输出一个 JSON 对象，不要 Markdown，不要 JSON 之外的文字。

JSON：
{
  "action": "retry",
  "coach_message": "给孩子看的简短反馈",
  "next_prompt": "下一句给孩子看的问题或提示",
  "diagnosis": "对孩子当前理解的简短判断",
  "confidence": 0.0
}

action 只能是：
advance / retry / simplify / finish
`;

  const providers = getAIProviders(env);

  if (!providers.length) {
    return jsonResponse(
      {
        enabled: false,
        error: "服务器尚未配置 AI Provider。",
        code: "AI_PROVIDER_NOT_CONFIGURED",
      },
      500,
      request,
    );
  }

  async function callTutorProvider(provider) {
    const baseBody = {
      temperature: 0.2,
      max_tokens: 450,
      reasoning: { enabled: false },
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    };

    const result = await fetchAIProvider(
      provider,
      baseBody,
      9000,
    );

    if (!result.ok) {
      return {
        ok: false,
        reason:
          (provider.name === "groq" ? "Groq：" : "OpenRouter：") +
          (result.reason || ("HTTP " + result.status)),
      };
    }

    const message = result.body?.choices?.[0]?.message;
    const parsed = extractJson(contentToText(message?.content));

    if (!parsed) {
      return {
        ok: false,
        reason:
          (provider.name === "groq" ? "Groq：" : "OpenRouter：") +
          "模型返回内容无法解析为 JSON。",
      };
    }

    return {
      ok: true,
      data: parsed,
      model: result.body?.model || provider.model || provider.name,
    };
  }

  let result = null;
  const failures = [];

  for (const provider of providers) {
    const attempt = await callTutorProvider(provider);

    if (attempt.ok) {
      result = attempt;
      break;
    }

    failures.push({
      provider: provider.name,
      reason: attempt.reason,
    });
  }

  if (!result) {
    return jsonResponse(
      {
        enabled: false,
        error: "所有已配置的 AI Tutor 服务都没有返回可用结果。",
        code: "TUTOR_ALL_PROVIDERS_FAILED",
        failures: failures,
      },
      502,
      request,
    );
  }

  const parsed = result.data || {};

  let action = String(parsed.action || "retry");
  if (
    ![
      "advance",
      "retry",
      "simplify",
      "finish",
    ].includes(action)
  ) {
    action = "retry";
  }

  const accepted =
    Array.isArray(steps[stepIndex]?.accepted)
      ? steps[stepIndex].accepted
      : [];

  const studentNormalized =
    studentAnswer
      .trim()
      .replace(/\s+/g, "");

  const localAccepted =
    accepted.some(function (value) {
      return (
        String(value)
          .trim()
          .replace(/\s+/g, "") ===
        studentNormalized
      );
    });

  const studentNumber =
    extractLastNumericValue(
      studentNormalized,
    );

  const numericAccepted =
    studentNumber !== null &&
    accepted.some(function (value) {
      const n = extractLastNumericValue(
        String(value)
          .trim()
          .replace(/\s+/g, ""),
      );

      return (
        n !== null &&
        Math.abs(studentNumber - n) < 1e-10
      );
    });

  const deterministicCorrect =
    localAccepted || numericAccepted;

  if (deterministicCorrect) {
    action =
      stepIndex >= steps.length - 1
        ? "finish"
        : "advance";
  } else if (
    action === "advance" ||
    action === "finish"
  ) {
    action = "retry";
  }

  let nextPrompt =
    String(parsed.next_prompt || "").trim();

  if (!nextPrompt) {
    nextPrompt =
      action === "advance"
        ? "很好，我们继续下一步。"
        : action === "simplify"
          ? "我们把这一步再拆小一点。"
          : "再想一次这一步，先不要急着往后做。";
  }

  return jsonResponse(
    {
      enabled: true,
      correct: deterministicCorrect,
      action: action,
      coach_message:
        String(parsed.coach_message || "").trim(),
      next_prompt: nextPrompt,
      diagnosis:
        String(parsed.diagnosis || "").trim(),
      confidence:
        typeof parsed.confidence === "number"
          ? Math.max(0, Math.min(1, parsed.confidence))
          : null,
      model: result.model,
      fallback_count:
        Math.max(0, failures.length),
    },
    200,
    request,
  );
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

  if (!env.GROQ_API_KEY && !env.OPENROUTER_API_KEY) {
    return jsonResponse(
      { error: "服务器尚未配置 GROQ_API_KEY 或 OPENROUTER_API_KEY。" },
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

  const providers = getAIProviders(env);
  const failures = [];

  function makeJsonObjectFallbackBody(body) {
    return {
      ...body,
      response_format: {
        type: "json_object",
      },
    };
  }

  const baseBody = {
    temperature: 0.2,
    max_tokens: 1800,
    reasoning: { enabled: false },
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "analyze_math_problem",
        strict: true,
        schema: {
          type: "object",
          properties: {
            question: {
              type: "string",
              description: "题目原文或尽可能准确的识别结果",
            },
            student_answer: {
              type: "string",
              description: "孩子写出的答案；无法确认时写无法确认",
            },
            correct_answer: {
              type: "string",
              description: "正确答案；无法可靠计算或确认时写无法确认",
            },
            knowledge_points: {
              type: "array",
              items: { type: "string" },
              description: "主要小学数学知识点",
            },
            error_type: {
              type: "string",
              description: "错误类型，只能从指定类型中选一个",
            },
            error_nature: {
              type: "string",
              description: "错误性质，只能是偶然失误、知识理解不足或无法判断",
            },
            analysis: {
              type: "string",
              description: "简明说明错误原因、应检查什么以及判断错误性质的依据",
            },
            confidence: {
              type: "number",
              description: "0到1之间的识别与分析把握度",
            },
            unclear: {
              type: "boolean",
              description: "图片是否存在影响可靠分析的模糊内容",
            },
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
            "unclear",
          ],
          additionalProperties: false,
        },
      },
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
  };
  for (const provider of providers) {
    let result = await fetchAIProvider(
      provider,
      baseBody,
      30000,
    );

    // Groq supports JSON Schema, but use JSON Object mode as a compatibility
    // fallback when the strict schema request is rejected.
    if (
      !result.ok &&
      provider.name === "groq" &&
      [400, 422].includes(result.status)
    ) {
      result = await fetchAIProvider(
        provider,
        makeJsonObjectFallbackBody(baseBody),
        30000,
      );
    }

    if (!result.ok) {
      failures.push({
        provider: provider.name,
        status: result.status,
        reason: result.reason,
      });
      continue;
    }

    const message = result.body?.choices?.[0]?.message;

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
        normalized.model =
          result.body?.model ||
          provider.model ||
          provider.name;
        normalized.ai_provider = provider.name;
        return jsonResponse(normalized, 200, request);
      } catch (_) {
        failures.push({
          provider: provider.name,
          status: 502,
          reason: "AI 工具调用返回的数据不是有效 JSON。",
        });
        continue;
      }
    }

    const content = message?.content;
    const parsed = extractJson(content);

    if (parsed) {
      const normalized = normalizeResult(parsed);
      normalized.model =
        result.body?.model ||
        provider.model ||
        provider.name;
      normalized.ai_provider = provider.name;
      return jsonResponse(normalized, 200, request);
    }

    failures.push({
      provider: provider.name,
      status: 502,
      reason: "AI 没有返回可用的结构化分析结果。",
    });
  }

  return jsonResponse(
    {
      error:
        "所有已配置的 AI 服务都没有返回可用的分析结果。" +
        (failures.length
          ? " 详细原因：" +
            failures
              .map(function (item) {
                return (
                  item.provider +
                  "：" +
                  (item.reason || ("HTTP " + item.status))
                );
              })
              .join("；")
          : ""),
      code: "ANALYZE_ALL_PROVIDERS_FAILED",
      failures: failures,
    },
    failures.some((item) => item.status === 429) ? 429 : 502,
    request,
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/analyze") {
      return analyzeImage(request, env);
    }

    if (url.pathname === "/api/retest/generate") {
      return generateRetest(request, env);
    }

    if (url.pathname === "/api/retest/evaluate") {
      return evaluateRetest(request, env);
    }

    if (url.pathname === "/api/tutor/step") {
      return tutorStep(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};
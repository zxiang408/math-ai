import {
  verifyMathAnswer,
  extractSingleNumericValue
} from "../public/math-engine.js";

import {
  getArchiveStatus,
  pushArchive,
  pullArchive
} from "./cloud-archive.js";

const APP_VERSION = "MVP-1.2.0";

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

function inferPrimaryKnowledgePoint(question) {
  const text = String(question ?? "")
    .trim()
    .replace(/\\s+/g, "");

  if (!text) return "";

  // 多块相同正方形地毯/方砖铺满区域：
  // 核心结构是“单块正方形面积 × 块数”，不能退化成普通四则混合运算。
  if (
    /正方形/.test(text) &&
    /(地毯|方砖|瓷砖|地垫|方块|块)/.test(text) &&
    /(铺满|铺成|铺设|区域面积|总面积|面积)/.test(text) &&
    /(块|张|片|个)/.test(text)
  ) {
    return "图形与几何 / 正方形面积";
  }

  if (/正方形/.test(text) && /面积/.test(text)) {
    return "图形与几何 / 正方形面积";
  }

  if (/长方形/.test(text) && /面积/.test(text)) {
    return "图形与几何 / 长方形面积";
  }

  return "";
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

  const question = String(result?.question ?? "").trim();
  const rawKnowledgePoints =
    standardizeKnowledgePoints(result?.knowledge_points);
  const inferredPrimary =
    inferPrimaryKnowledgePoint(question);
  const knowledgePoints = inferredPrimary
    ? [
        inferredPrimary,
        ...rawKnowledgePoints.filter(function (point) {
          return point !== inferredPrimary;
        })
      ]
    : rawKnowledgePoints;

  return {
    question: question,
    student_answer: String(result?.student_answer ?? "").trim(),
    correct_answer: String(result?.correct_answer ?? "").trim(),
    knowledge_points: knowledgePoints,
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

  /*
   * 当前产品的主 AI 是 OpenRouter。
   * Groq 若配置了旧/失效密钥，不应阻塞真正可用的 OpenRouter 请求。
   */
  if (env?.OPENROUTER_API_KEY) {
    providers.push({
      name: "openrouter",
      apiKey: env.OPENROUTER_API_KEY,
      url: "https://openrouter.ai/api/v1/chat/completions",
      models: [
        // openrouter/free 会优先选择支持当前请求特性的免费模型；
        // 对图片分析尤其适合，减少因单一模型排队而长时间等待。
        "openrouter/free",
        "qwen/qwen3.8-27b:free",
        "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
      ],
    });
  }

  if (env?.GROQ_API_KEY) {
    providers.push({
      name: "groq",
      apiKey: env.GROQ_API_KEY,
      url: "https://api.groq.com/openai/v1/chat/completions",
      model: "qwen/qwen3.8-27b",
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

async function requestStructuredJson(env, prompt, functionName, properties, required, maxTokens = 700) {
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
      max_tokens: maxTokens,
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


function buildGuidedSteps(knowledgePoint) {
  const point = String(knowledgePoint || "").trim();

  const presets = {
    "数与代数 / 倍数关系": [
      "先找出较小的数和较大的数分别是几份。",
      "把两个数合起来，一共是多少份？",
      "用总数除以总份数，算出1份是多少。"
    ],
    "图形与几何 / 正方形面积": [
      "先看清楚正方形的边长是多少。",
      "想一想正方形的面积公式是什么？",
      "用边长×边长算出面积。"
    ],
    "图形与几何 / 长方形面积": [
      "先找出长方形的长和宽。",
      "想一想长方形的面积公式是什么？",
      "用长×宽算出面积。"
    ],
    "数与代数 / 积的变化规律": [
      "先找出哪个因数发生了变化。",
      "这个因数变化了几倍？",
      "想一想另一个因数不变时，积会怎样变化。"
    ],
    "数与代数 / 四则运算": [
      "先看看题目里有哪些运算。",
      "想一想哪一种运算要先算。",
      "完成前一步后，再算下一步。"
    ],
    "数与代数 / 小数": [
      "先把需要计算的小数点位置看清楚。",
      "想一想小数点应该怎样对齐。",
      "从低位开始逐位计算，再确定结果的小数点位置。"
    ],
    "数与代数 / 比与比例": [
      "先看清楚两种量的比。",
      "想一想已知量相当于原来多少份或多少倍。",
      "根据同样的倍数关系求出另一个量。"
    ]
  };

  return (presets[point] || [
    "先找出题目告诉我们的已知条件。",
    "想一想这道题最关键的数量关系是什么。",
    "根据这个关系完成最后一步计算或判断。"
  ]).map(function (prompt) {
    return { prompt: prompt };
  });
}

function generateSquareAreaVariantSet(sourceQuestion, point) {
  const presets = [
    { count: 12, side: 3.5, unit: "米" },
    { count: 8, side: 2.5, unit: "米" },
    { count: 15, side: 2.4, unit: "米" }
  ];

  const variants = presets.map(function (item) {
    const singleArea = Number((item.side * item.side).toFixed(6));
    const totalArea = Number((singleArea * item.count).toFixed(6));

    return {
      question:
        "布置活动区时，用" +
        item.count +
        "块边长为" +
        item.side +
        " " +
        item.unit +
        "的正方形地毯把一个区域铺满（不重叠），这个区域的面积是多少平方米？",
      correct_answer: String(totalArea) + "平方米",
      knowledge_points: [point],
      explanation:
        "先求1块正方形地毯的面积，再乘地毯块数。1块面积是" +
        item.side +
        "×" +
        item.side +
        "=" +
        singleArea +
        "平方米，区域总面积是" +
        singleArea +
        "×" +
        item.count +
        "=" +
        totalArea +
        "平方米。",
      steps: [
        {
          prompt:
            "第1小步：先只算1块正方形地毯的面积。边长是" +
            item.side +
            "米。请填写：1块地毯的面积 = ___ 平方米（只填一个数，不写后面的总面积）。",
          retry_prompt:
            "我们只做这一小步：边长×边长。边长是" +
            item.side +
            "米，请再算一次，并只填写1块地毯的面积（只填一个数）。",
          accepted: [
            String(singleArea),
            String(singleArea) + "平方米"
          ]
        },
        {
          prompt:
            "第2小步：这样的地毯一共有" +
            item.count +
            "块。把刚才1块的面积乘以" +
            item.count +
            "，请填写整个区域的面积 = ___ 平方米（只填一个数）。",
          retry_prompt:
            "再做这一小步：1块地毯的面积 × " +
            item.count +
            "块。请只填写整个区域的面积（只填一个数）。",
          accepted: [
            String(totalArea),
            String(totalArea) + "平方米"
          ]
        }
      ]
    };
  });

  return {
    question: variants[0].question,
    correct_answer: variants[0].correct_answer,
    knowledge_points: [point],
    explanation: variants[0].explanation,
    steps: variants[0].steps,
    variants: variants
  };
}

async function generateSameTypeVariantSet(env, params) {
  const point = String(params?.knowledgePoint || "").trim();
  const sourceQuestion = String(params?.sourceQuestion || "").trim();
  const sourceStudentAnswer = String(params?.sourceStudentAnswer || "").trim();
  const sourceCorrectAnswer = String(params?.sourceCorrectAnswer || "").trim();
  const sourceErrorType = String(params?.sourceErrorType || "").trim();
  const sourceErrorNature = String(params?.sourceErrorNature || "").trim();
  const inferredPrimary = inferPrimaryKnowledgePoint(sourceQuestion);

  if (!point || !sourceQuestion) {
    return {
      ok: false,
      status: 400,
      data: { error: "缺少原错题和目标知识点。" }
    };
  }

  if (inferredPrimary === "图形与几何 / 正方形面积") {
    const special = generateSquareAreaVariantSet(sourceQuestion, inferredPrimary);
    if (special) {
      return {
        ok: true,
        status: 200,
        data: special,
        model: "local_square_area_variant"
      };
    }
  }

  const prompt = "你是一名小学数学一对一辅导老师。你要根据孩子刚刚上传的原错题生成后续训练题。\n\n" +
    "【重要产品规则】\n" +
    "- 原错题只用于建立孩子能力档案和判断题型。\n" +
    "- 不讲解原错题，不要求孩子重做原错题。\n" +
    "- 训练题必须与原错题考查同一种核心题型/方法，但必须是全新题目。\n" +
    "- 一共生成3道变式题；数字、问法或情境必须有变化，不能只是改一个数字。\n" +
    "- 第一题用于孩子独立作答；如果孩子不会，再进入逐步骤辅导。\n" +
    "- 每道题提供2到4个辅导步骤提示。步骤只写给老师后续提问的提示，不写出答案，不直接告诉孩子最终结果。\n" +
    "- 三道题的难度保持在相近的小学水平，不要突然提高难度。\n" +
    "- 每道题只有一个明确可核验的答案，并自行再次计算核对。\n" +
    "- 优先保持原题的核心数量关系/解题方法；不要借入无关知识点。\n" +
    "- 只返回合法JSON，不要Markdown。\n\n" +
    "【目标知识点】\n" + point + "\n\n" +
    "【原错题（只作后台参照）】\n" +
    "题目：" + sourceQuestion + "\n" +
    "孩子答案：" + (sourceStudentAnswer || "无法确认") + "\n" +
    "正确答案：" + (sourceCorrectAnswer || "无法确认") + "\n" +
    "错误类型：" + (sourceErrorType || "无法判断") + "\n" +
    "错误性质：" + (sourceErrorNature || "无法判断") + "\n\n" +
    "请返回一个包含3个元素的 variants 数组。每个元素必须包含 question、correct_answer、knowledge_points、explanation、steps；steps 为2到4个只用于老师提问的简短引导问题，不写答案。";

  const result = await requestStructuredJson(
    env,
    prompt,
    "generate_same_type_variant_set",
    {
      variants: {
        type: "array",
        minItems: 3,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            question: { type: "string" },
            correct_answer: { type: "string" },
            knowledge_points: {
              type: "array",
              items: { type: "string" },
              minItems: 1,
              maxItems: 4
            },
            explanation: { type: "string" },
            steps: {
              type: "array",
              minItems: 2,
              maxItems: 4,
              items: {
                type: "object",
                properties: {
                  prompt: { type: "string" }
                },
                required: ["prompt"],
                additionalProperties: false
              }
            }
          },
          required: [
            "question",
            "correct_answer",
            "knowledge_points",
            "explanation",
            "steps"
          ],
          additionalProperties: false
        }
      }
    },
    ["variants"],
    1800
  );

  if (result.ok) {
    const variants = Array.isArray(result.data?.variants)
      ? result.data.variants
        .map(function (variant) {
          const question = String(variant?.question || "").trim();
          const answer = String(variant?.correct_answer || "").trim();
          const steps = Array.isArray(variant?.steps)
            ? variant.steps
              .map(function (step) {
                return { prompt: String(step?.prompt || "").trim() };
              })
              .filter(function (step) { return step.prompt; })
              .slice(0, 4)
            : [];

          return {
            question: question,
            correct_answer: answer,
            knowledge_points: standardizeKnowledgePoints(variant?.knowledge_points),
            explanation: String(variant?.explanation || "").trim(),
            steps: steps.length >= 2 ? steps : buildGuidedSteps(point)
          };
        })
        .filter(function (variant) {
          return variant.question && variant.correct_answer;
        })
        .slice(0, 3)
      : [];

    const uniqueQuestions = new Set(
      variants.map(function (variant) {
        return variant.question.replace(/\s+/g, "");
      })
    );

    if (variants.length === 3 && uniqueQuestions.size === 3) {
      return {
        ok: true,
        status: 200,
        data: {
          question: variants[0].question,
          correct_answer: variants[0].correct_answer,
          knowledge_points: [point],
          explanation: variants[0].explanation,
          steps: variants[0].steps,
          variants: variants
        },
        model: result.model
      };
    }
  }

  const fallbackVariants = [];
  const seen = new Set();
  for (let i = 0; i < 3; i += 1) {
    const item = generateFastRetest(point);
    if (!item || seen.has(item.question)) continue;
    seen.add(item.question);
    fallbackVariants.push({
      question: item.question,
      correct_answer: item.correct_answer,
      knowledge_points: [point],
      explanation: item.explanation,
      steps: buildGuidedSteps(point)
    });
  }

  if (fallbackVariants.length === 3) {
    return {
      ok: true,
      status: 200,
      data: {
        question: fallbackVariants[0].question,
        correct_answer: fallbackVariants[0].correct_answer,
        knowledge_points: [point],
        explanation: fallbackVariants[0].explanation,
        steps: fallbackVariants[0].steps,
        variants: fallbackVariants,
        fallback: true
      },
      model: "local_variant_fallback"
    };
  }

  return {
    ok: false,
    status: result.status || 502,
    data: {
      error: "暂时无法生成足够的同类型新题，请稍后再试。",
      code: "VARIANT_SET_GENERATION_FAILED"
    }
  };
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

  const purpose =
    String(body?.purpose || "").trim();

  const sourceQuestion =
    String(body?.source_question || "").trim();

  const sourceStudentAnswer =
    String(body?.source_student_answer || "").trim();

  const sourceCorrectAnswer =
    String(body?.source_correct_answer || "").trim();

  const sourceErrorType =
    String(body?.source_error_type || "").trim();

  const sourceErrorNature =
    String(body?.source_error_nature || "").trim();

  if (!knowledgePoint) {
    return jsonResponse(
      { error: "缺少需要复测的知识点。" },
      400,
      request,
    );
  }

  if (purpose === "same_type_training") {
    const variantSet = await generateSameTypeVariantSet(env, {
      knowledgePoint: knowledgePoint,
      sourceQuestion: sourceQuestion,
      sourceStudentAnswer: sourceStudentAnswer,
      sourceCorrectAnswer: sourceCorrectAnswer,
      sourceErrorType: sourceErrorType,
      sourceErrorNature: sourceErrorNature
    });

    return jsonResponse(
      variantSet.data,
      variantSet.status,
      request
    );
  }

  // 常见小学知识点优先走本地题型模板，避免孩子每次点题都等待免费模型。
  // 未覆盖的知识点继续使用 AI 生成，不改变原有功能。
  const fastRetest =
    purpose === "same_type_training"
      ? null
      : generateFastRetest(knowledgePoint);

  if (fastRetest) {
    return jsonResponse(fastRetest, 200, request);
  }

  const sameTypeContext =
    purpose === "same_type_training" &&
    sourceQuestion
      ? `
【原错题，仅供后台出题参照】
题目：${sourceQuestion}
孩子答案：${sourceStudentAnswer || "无法确认"}
正确答案：${sourceCorrectAnswer || "无法确认"}
错误类型：${sourceErrorType || "无法判断"}
错误性质：${sourceErrorNature || "无法判断"}

这不是讲题任务。请生成一道与原题考查同一种核心计算或思考方法、但数字或情境不同的新题。不要重复原题，不要解释原题。
`
      : "";

  const prompt = `你是一名小学数学老师。
${sameTypeContext}

请针对以下知识点生成 1 道新题：

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

  const safeSteps = steps.map(function (step, index) {
    return {
      index: index,
      prompt: String(step?.prompt || ""),
      retry_prompt: String(step?.retry_prompt || ""),
      accepted: Array.isArray(step?.accepted)
        ? step.accepted.map(function (value) { return String(value); })
        : [],
    };
  });

  const prompt = `你是一名小学数学一对一辅导老师。
你现在辅导的是一个具体的小学数学知识点。

【目标知识点】
${point}

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
- 判断孩子刚才这一小步的回答是否正确；correct 必须明确填写 true 或 false。
- 如果当前步骤没有预先提供固定答案，就根据题目、当前提示和孩子回答判断这一小步是否正确。
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
  "correct": false,
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
      .replace(/\\s+/g, "");

  const localAccepted =
    accepted.some(function (value) {
      return (
        String(value)
          .trim()
          .replace(/\\s+/g, "") ===
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
          .replace(/\\s+/g, ""),
      );

      return (
        n !== null &&
        Math.abs(studentNumber - n) < 1e-10
      );
    });

  const hasDeterministicAnswer =
    accepted.length > 0;

  // 对固定步骤答案直接本地核验。
  // 这样“算错了”时不会被 AI 改写成含糊提示，也不会因为模型判断漂移而卡住。
  if (hasDeterministicAnswer) {
    const deterministicCorrect =
      localAccepted || numericAccepted;
    const isLastStep =
      stepIndex >= steps.length - 1;
    const nextStep =
      !isLastStep && steps[stepIndex + 1]
        ? String(steps[stepIndex + 1]?.prompt || "").trim()
        : "";

    return jsonResponse(
      {
        enabled: true,
        correct: deterministicCorrect,
        action: deterministicCorrect
          ? (isLastStep ? "finish" : "advance")
          : "retry",
        coach_message: deterministicCorrect
          ? "对了，这一步算对了，我们继续。"
          : "这一小步还没算对。没关系，我们只重做这一小步。",
        next_prompt: deterministicCorrect
          ? (nextStep || "很好，我们继续下一步。")
          : (
              String(steps[stepIndex]?.retry_prompt || "").trim() ||
              String(steps[stepIndex]?.prompt || "").trim() ||
              "再做一次这一小步，先不要往后做。"
            ),
        diagnosis: deterministicCorrect
          ? "当前步骤答案与预设结果一致。"
          : "当前步骤答案与预设结果不一致。",
        confidence: 1,
        model: "local_step_check",
        fallback_count: 0,
      },
      200,
      request,
    );
  }


  const stepCorrect =
    hasDeterministicAnswer
      ? deterministicCorrect
      : parsed.correct === true;

  if (stepCorrect) {
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
      correct: stepCorrect,
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
4. 判断涉及的主要小学数学知识点。**主知识点必须选择直接决定解题方法的最具体知识点，不能把“使用了加法/乘法/四则运算”当成故事题的主知识点。**例如“用多块边长相同的正方形地毯铺满区域，求总面积”，主知识点应是“图形与几何 / 正方形面积”，而不是“数与代数 / 四则运算”。知识点名称尽量使用下面的标准名称；若无法匹配，可返回最接近的自然语言名称，程序会继续归类。
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

  function makePlainJsonBody(body) {
    const next = { ...body };
    delete next.response_format;
    return next;
  }

  function parseAnalyzeMessage(message) {
    const toolCall = Array.isArray(message?.tool_calls)
      ? message.tool_calls.find(
          (call) =>
            call?.type === "function" &&
            call?.function?.name === "analyze_math_problem",
        )
      : null;

    if (toolCall?.function?.arguments) {
      const parsed = extractJson(
        toolCall.function.arguments
      );
      if (parsed) {
        return parsed;
      }
    }

    return extractJson(message?.content);
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
    const attempts = [
      {
        label: "json_schema",
        body: baseBody,
        timeout: 18000,
      },
      {
        label: "json_object",
        body: makeJsonObjectFallbackBody(baseBody),
        timeout: 18000,
      },
      {
        label: "plain_json",
        body: makePlainJsonBody(baseBody),
        timeout: 18000,
      },
    ];

    for (let index = 0; index < attempts.length; index += 1) {
      const attempt = attempts[index];

      /*
       * 不同免费模型对 response_format 的兼容程度不同：
       * 1) 首先尝试 JSON Schema；
       * 2) 被拒绝或返回普通文本时，降级 JSON Object；
       * 3) 仍不行时，不发送 response_format，仅依靠提示词要求合法 JSON。
       */
      const result = await fetchAIProvider(
        provider,
        attempt.body,
        attempt.timeout,
      );

      if (!result.ok) {
        failures.push({
          provider: provider.name,
          status: result.status,
          reason:
            attempt.label +
            "：" +
            (result.reason || ("HTTP " + result.status)),
        });
        continue;
      }

      const message =
        result.body?.choices?.[0]?.message;

      const parsed =
        parseAnalyzeMessage(message);

      if (parsed) {
        const normalized =
          normalizeResult(parsed);

        /*
         * 空对象/残缺对象也视为无效，继续尝试兼容模式。
         */
        if (
          normalized.question &&
          normalized.correct_answer &&
          normalized.knowledge_points.length > 0
        ) {
          normalized.model =
            result.body?.model ||
            provider.model ||
            provider.name;
          normalized.ai_provider =
            provider.name;
          normalized.analysis_mode =
            attempt.label;

          return jsonResponse(
            normalized,
            200,
            request,
          );
        }

        failures.push({
          provider: provider.name,
          status: 502,
          reason:
            attempt.label +
            "：AI 返回 JSON，但关键分析字段不完整。",
        });
        continue;
      }

      const rawPreview =
        contentToText(
          message?.content
        ).slice(0, 300);

      failures.push({
        provider: provider.name,
        status: 502,
        reason:
          attempt.label +
          "：AI 返回了内容，但无法解析为 JSON。" +
          (rawPreview
            ? " 返回片段：" + rawPreview
            : ""),
      });
    }
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



const CLOUD_LEARNER_ID = "local-default";

function resolveCloudLearnerId(env) {
  return String(
    env?.MATH_AI_LEARNER_ID ||
    CLOUD_LEARNER_ID
  ).trim() || CLOUD_LEARNER_ID;
}

function syncPreflight(request) {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400"
  });

  const origin = request.headers.get("Origin");
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }

  return new Response(null, {
    status: 204,
    headers
  });
}

async function syncStatus(request, env) {
  if (request.method === "OPTIONS") {
    return syncPreflight(request);
  }

  if (request.method !== "GET") {
    return jsonResponse(
      { error: "只支持 GET 或 OPTIONS 请求。" },
      405,
      request
    );
  }

  try {
    const result = await getArchiveStatus(
      env,
      resolveCloudLearnerId(env)
    );

    return jsonResponse(
      result,
      200,
      request
    );
  } catch (error) {
    console.error("云端档案状态检查失败：", error);
    return jsonResponse(
      {
        configured: false,
        code: "SUPABASE_STATUS_ERROR",
        error: "无法连接云端学习档案。",
      },
      502,
      request
    );
  }
}

async function syncPush(request, env) {
  if (request.method === "OPTIONS") {
    return syncPreflight(request);
  }

  if (request.method !== "POST") {
    return jsonResponse(
      { error: "只支持 POST 或 OPTIONS 请求。" },
      405,
      request
    );
  }

  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse(
      {
        error: "请求数据不是有效的 JSON。",
        code: "INVALID_SYNC_JSON"
      },
      400,
      request
    );
  }

  const result = await pushArchive(
    env,
    resolveCloudLearnerId(env),
    body?.events
  );

  const status =
    result.ok === false
      ? result.code === "SUPABASE_NOT_CONFIGURED"
        ? 503
        : 400
      : 200;

  return jsonResponse(
    result,
    status,
    request
  );
}

async function syncPull(request, env) {
  if (request.method === "OPTIONS") {
    return syncPreflight(request);
  }

  if (request.method !== "GET") {
    return jsonResponse(
      { error: "只支持 GET 或 OPTIONS 请求。" },
      405,
      request
    );
  }

  try {
    const result = await pullArchive(
      env,
      resolveCloudLearnerId(env)
    );

    const status =
      result.ok === false
        ? result.code === "SUPABASE_NOT_CONFIGURED"
          ? 503
          : 502
        : 200;

    return jsonResponse(
      result,
      status,
      request
    );
  } catch (error) {
    console.error("云端档案读取失败：", error);
    return jsonResponse(
      {
        ok: false,
        code: "SYNC_PULL_ERROR",
        error: "读取云端学习档案失败。"
      },
      502,
      request
    );
  }
}


async function serveApplicationAsset(request, env) {
  const url = new URL(request.url);
  const response = await env.ASSETS.fetch(request);

  if (
    request.method === "GET" &&
    (url.pathname === "/" || url.pathname === "/index.html") &&
    (response.headers.get("content-type") || "").includes("text/html")
  ) {
    return new HTMLRewriter()
      .on("body", {
        element(element) {
          element.append(
            '<script src="/v11-ui.js?v=120"></script>',
            { html: true }
          );
        }
      })
      .transform(response);
  }

  return response;
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

    if (url.pathname === "/api/sync/status") {
      return syncStatus(request, env);
    }

    if (url.pathname === "/api/sync/push") {
      return syncPush(request, env);
    }

    if (url.pathname === "/api/sync/pull") {
      return syncPull(request, env);
    }

    return serveApplicationAsset(request, env);
  },
};
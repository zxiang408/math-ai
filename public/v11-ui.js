(function () {
  "use strict";

  var EVENTS_KEY = "MATH_AI_V11_EVENTS";
  var SESSION_KEY = "MATH_AI_V11_SESSION";
  var REVIEW_KEY = "MATH_AI_V11_REVIEW_QUEUE";
  var SCHEDULE = [3, 7, 14, 30, 60, 90, 180, 365];

  var state = {
    source: null,
    sourceImage: null,
    variants: [],
    variantIndex: 0,
    mode: "idle",
    stepIndex: 0,
    currentPrompt: "",
    history: [],
    sessionId: "",
    review: null,
    reviewMode: false,
    secondQuestionRequested: false,
    busy: false
  };

  function uid(prefix) {
    var id = "";
    try {
      if (crypto && crypto.randomUUID) id = crypto.randomUUID();
    } catch (_) {}
    if (!id) {
      id = Date.now().toString(36) + "-" +
        Math.random().toString(36).slice(2, 10);
    }
    return prefix + "-" + id;
  }

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  function escapeHTML(value) {
    return text(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function readEvents() {
    try {
      var value = JSON.parse(localStorage.getItem(EVENTS_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch (_) {
      return [];
    }
  }

  function writeEvents(events) {
    try {
      localStorage.setItem(EVENTS_KEY, JSON.stringify(events.slice(-600)));
      return true;
    } catch (_) {
      return false;
    }
  }

  function saveEvent(event) {
    var events = readEvents();
    var exists = events.some(function (item) {
      return item && item.event_id === event.event_id;
    });
    if (!exists) {
      events.push(event);
      writeEvents(events);
    }
    syncEvent(event);
    return event;
  }

  async function syncEvent(event) {
    setCloud("☁️ 正在同步…", "pending");
    try {
      var result = await callJson("/api/sync/push", {
        method: "POST",
        body: { events: [event] }
      });
      if (result && result.ok === false) {
        throw new Error(result.error || "云端同步失败");
      }
      setCloud("☁️ 数据已同步", "ok");
    } catch (error) {
      console.warn("Math AI cloud sync:", error);
      setCloud("☁️ 已保存，稍后同步", "local");
    }
  }

  async function pullCloudEvents() {
    try {
      var data = await callJson("/api/sync/pull", { method: "GET" });
      if (!data || !Array.isArray(data.events)) return;
      var local = readEvents();
      var byId = new Map();
      local.forEach(function (event) {
        if (event && event.event_id) byId.set(event.event_id, event);
      });
      data.events.forEach(function (row) {
        if (!row || !row.event_id) return;
        var normalized = row.normalized_event || {};
        byId.set(row.event_id, {
          event_id: row.event_id,
          occurred_at: row.occurred_at || normalized.occurred_at,
          normalized_event: normalized,
          raw_payload: row.raw_payload || {}
        });
      });
      writeEvents(Array.from(byId.values()));
      setCloud("☁️ 数据已同步", "ok");
      refreshReviewBanner();
    } catch (error) {
      console.warn("Math AI cloud pull:", error);
    }
  }

  function eventEnvelope(fields) {
    var id = uid("v11");
    var occurredAt = new Date().toISOString();
    return {
      event_id: id,
      occurred_at: occurredAt,
      source: fields.source || "training",
      event_type: fields.event_type || "training_attempt",
      schema_version: "V0.17.0",
      normalized_event: {
        schema_version: "V0.17.0",
        learner_id: "local-default",
        event_id: id,
        occurred_at: occurredAt,
        source: fields.source || "training",
        event_type: fields.event_type || "training_attempt",
        knowledge_points: fields.knowledge_points || [],
        micro_skill: fields.micro_skill || {
          key: "core_method",
          label: "核心方法"
        },
        question: fields.question || null,
        student_answer: fields.student_answer || null,
        correct_answer: fields.correct_answer || null,
        outcome: {
          correct: typeof fields.correct === "boolean" ? fields.correct : null,
          passed: typeof fields.passed === "boolean" ? fields.passed : null,
          prompted: Boolean(fields.prompted),
          step_mode: fields.step_mode || null
        },
        diagnosis: {
          error_type: fields.error_type || null,
          error_nature: fields.error_nature || null,
          confidence: typeof fields.confidence === "number" ? fields.confidence : null
        },
        context: {
          training_session_id: fields.training_session_id || null,
          requested_knowledge_point: fields.knowledge_points && fields.knowledge_points[0] || null,
          step_number: Number.isFinite(Number(fields.step_number)) ? Number(fields.step_number) : null,
          attempt_number: Number.isFinite(Number(fields.attempt_number)) ? Number(fields.attempt_number) : null,
          test_type: fields.test_type || null,
          tutor_mode: fields.tutor_mode || null,
          tutor_action: fields.tutor_action || null,
          tutor_model: fields.tutor_model || null,
          review_key: fields.review_key || null,
          review_due_at: fields.review_due_at || null,
          retention_stage: Number.isFinite(Number(fields.retention_stage)) ? Number(fields.retention_stage) : null
        }
      },
      raw_payload: fields.raw_payload || {}
    };
  }

  function setCloud(message, kind) {
    var el = document.getElementById("v11-cloud");
    if (!el) return;
    el.textContent = message || "";
    el.className = "v11-cloud " + (kind || "");
  }

  async function callJson(url, options) {
    options = options || {};
    var init = {
      method: options.method || "GET",
      headers: {}
    };
    if (options.body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(options.body);
    }
    var response = await fetch(url, init);
    var data;
    try {
      data = await response.json();
    } catch (_) {
      throw new Error("服务器返回的内容无法读取。");
    }
    if (!response.ok) {
      var message = data && data.error ? data.error : "请求失败";
      throw new Error(message);
    }
    return data;
  }

  function engineVerify(student, correct) {
    try {
      var engine = window.MathAIMathEngine;
      if (engine && typeof engine.verifyMathAnswer === "function") {
        return engine.verifyMathAnswer(student, correct);
      }
    } catch (_) {}
    return { correct: null };
  }

  async function evaluateAnswer(question, correct, student, point) {
    var local = engineVerify(student, correct);
    if (local.correct !== null) {
      return {
        correct: local.correct === true,
        error_type: local.correct ? "" : "无法判断",
        error_nature: local.correct ? "" : "无法判断",
        analysis: local.correct
          ? "答案正确。"
          : "答案与标准答案不一致。"
      };
    }

    return callJson("/api/retest/evaluate", {
      method: "POST",
      body: {
        question: question,
        correct_answer: correct,
        student_answer: student,
        knowledge_points: [point]
      }
    });
  }

  function setScreen(title, bodyHTML, actionsHTML) {
    var screen = document.getElementById("v11-screen");
    if (!screen) return;
    screen.innerHTML =
      '<div class="v11-card">' +
        '<div class="v11-title">' + title + '</div>' +
        '<div class="v11-body">' + bodyHTML + '</div>' +
        '<div class="v11-actions">' + (actionsHTML || "") + '</div>' +
      '</div>';
  }

  function currentVariant() {
    return state.variants[state.variantIndex] || null;
  }

  function normalizeVariant(variant, point) {
    var question = text(variant && variant.question);
    var steps = Array.isArray(variant && variant.steps)
      ? variant.steps.map(function (step) {
          return {
            prompt: text(step && step.prompt),
            retry_prompt: text(step && step.retry_prompt),
            accepted: Array.isArray(step && step.accepted)
              ? step.accepted.map(function (value) { return String(value); })
              : []
          };
        }).filter(function (step) { return step.prompt; }).slice(0, 4)
      : [];

    // 对“多块正方形地毯铺满区域”这类题，前端也做一道最后保险：
    // 就算上游 AI 返回了泛化提示，也必须把孩子引到正确的核心步骤。
    var isSquareCarpet =
      point === "图形与几何 / 正方形面积" &&
      /正方形/.test(question) &&
      /(地毯|方砖|地垫|瓷砖)/.test(question) &&
      /(块|张|片)/.test(question) &&
      /面积/.test(question);

    if (isSquareCarpet) {
      var countMatch = question.match(/(\\d+(?:\\.\\d+)?)\\s*(?:块|张|片)/);
      var sideMatch = question.match(/边长(?:为|是)?\\s*(\\d+(?:\\.\\d+)?)/);
      var count = countMatch ? countMatch[1] : "";
      var side = sideMatch ? sideMatch[1] : "";

      steps = [
        {
          prompt: "先只算1块正方形地毯的面积。边长是" + side + "米，请填写：1块地毯的面积 = ___ 平方米（只填一个数）。",
          retry_prompt: "提示：正方形的面积 = 边长 × 边长。现在只算1块地毯，所以算" + side + "×" + side + "，不要乘" + count + "块。",
          accepted: []
        },
        {
          prompt: "第1步已经得到1块地毯的面积。现在一共有" + count + "块，请填写：整个区域的面积 = 1块面积 × " + count + " = ___ 平方米。",
          retry_prompt: "提示：用刚才“1块地毯的面积”再乘" + count + "，现在只填写总面积。",
          accepted: []
        }
      ];

      // 正方形地毯题的标准答案如果可计算，则直接写进步骤核验。
      if (side && count) {
        var single = Number(side) * Number(side);
        var total = single * Number(count);
        steps[0].accepted = [String(single), String(single) + "平方米"];
        steps[1].accepted = [String(total), String(total) + "平方米"];
      }
    }

    if (steps.length < 2) {
      steps = [
        {
          prompt: "先找出这一步需要求的那个结果，并只填写这个结果。",
          retry_prompt: "提示：先看清楚这一步到底要算什么。只填写当前这一步的结果，不要往后算。",
          accepted: []
        },
        {
          prompt: "根据刚才得到的结果，完成下一步计算。",
          retry_prompt: "提示：先用上一小步得到的结果，再完成这一小步。",
          accepted: []
        }
      ];
    }

    return {
      question: question,
      correct_answer: text(variant && variant.correct_answer),
      knowledge_points: [point],
      explanation: text(variant && variant.explanation),
      diagram: text(variant && variant.diagram),
      steps: steps
    };
  }

  function renderVariantDiagram(variant) {
    var diagram = text(variant && variant.diagram);
    if (!diagram) return "";
    return '<pre class="v11-diagram">' + escapeHTML(diagram) + '</pre>';
  }

  function buildChildHint(variant, stepIndex) {
    var question = text(variant && variant.question);
    var point = text(variant && variant.knowledge_points && variant.knowledge_points[0]);

    if (
      point === "图形与几何 / 正方形面积" &&
      /正方形/.test(question) &&
      /(地毯|方砖|地垫|瓷砖)/.test(question)
    ) {
      var countMatch = question.match(/(\\d+(?:\\.\\d+)?)\\s*(?:块|张|片)/);
      var sideMatch = question.match(/边长(?:为|是)?\\s*(\\d+(?:\\.\\d+)?)/);
      var count = countMatch ? countMatch[1] : "";
      var side = sideMatch ? sideMatch[1] : "";

      if (stepIndex === 0) {
        return "提示：正方形的面积 = 边长 × 边长。现在只算1块，所以算" + side + "×" + side + "，不要乘" + count + "块。";
      }
      return "提示：把刚才算出的1块地毯面积，乘以" + count + "块，就得到整个区域的面积。";
    }

    return "提示：先只解决当前这一小步，看看题目中哪些数字会直接用到。不要急着做后面的计算。";
  }

  function renderHome() {
    state.mode = "idle";
    state.sourceImage = null;
    state.secondQuestionRequested = false;
    state.reviewMode = false;
    state.review = null;

    setScreen(
      "今天，我们先做一道新题",
      '<div class="v11-lead">原来的错题只负责告诉我“你哪里需要练习”。原题不重做，我们直接换一道同类型的新题。</div>' +
      '<div class="v11-route">' +
        '<div><span>①</span> 拍错题</div>' +
        '<div><span>②</span> 独立做</div>' +
        '<div><span>③</span> 不会就一步一步做</div>' +
        '<div><span>④</span> 以后再复测</div>' +
      '</div>' +
      '<div id="v11-upload-box" class="v11-upload">' +
        '<div class="v11-upload-icon">📷</div>' +
        '<div class="v11-upload-main">拍一张错题照片</div>' +
        '<div class="v11-upload-sub">我会识别题目，只把它作为你的学习证据</div>' +
        '<img id="v11-preview" class="v11-preview" alt="错题预览">' +
      '</div>' +
      '<div class="v11-small">不需要给孩子讲原题，也不用要求孩子重新做原题。</div>',
      ''
    );

    var box = document.getElementById("v11-upload-box");
    var input = document.getElementById("fileInput");

    if (box) {
      box.onclick = function () {
        if (state.busy) return;
        var picker = document.getElementById("fileInput");
        if (picker) {
          // 允许连续选择同一张图片时仍能触发 change。
          picker.value = "";
          picker.click();
        }
      };
    }

    if (input) {
      input.onchange = async function () {
        var file = input.files && input.files[0];
        var preview = document.getElementById("v11-preview");
        if (!file || !preview) return;

        preview.src = URL.createObjectURL(file);
        preview.style.display = "block";
        if (box) box.classList.add("chosen");

        var old = box && box.querySelector(".v11-upload-main");
        if (old) old.textContent = "照片已选好，正在开始分析…";
        var oldSub = box && box.querySelector(".v11-upload-sub");
        if (oldSub) oldSub.textContent = "原题只用于识别和建档，不会拿原题继续辅导。";

        // 选图完成后立即分析，不再要求第二次点击上传区。
        await analyzeUploadedImage();
      };
    }
    }
  }

  async function fileToDataUrl(file) {
    var maxSide = 1600;
    var url = URL.createObjectURL(file);
    try {
      var image = new Image();
      await new Promise(function (resolve, reject) {
        image.onload = resolve;
        image.onerror = function () { reject(new Error("图片无法读取。")); };
        image.src = url;
      });
      var scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      var canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      var ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.84);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function analyzeUploadedImage() {
    if (state.busy) return;
    var input = document.getElementById("fileInput");
    var file = input && input.files && input.files[0];
    if (!file) return;

    state.busy = true;
    setScreen(
      "我先看一看这道题",
      '<div class="v11-loading"><div class="v11-spinner"></div><div>正在识别题目和孩子的作答……</div><div class="v11-loading-sub">原题只用于建档，不会拿原题继续教。</div></div>',
      ''
    );

    try {
      var image = await fileToDataUrl(file);
      var analysis = await callJson("/api/analyze", {
        method: "POST",
        body: { image: image, mimeType: "image/jpeg" }
      });

      state.source = analysis;
      state.sourceImage = image;
      state.sessionId = uid("session");
      state.secondQuestionRequested = false;

      var point = text(analysis.knowledge_points && analysis.knowledge_points[0]);
      if (!point) throw new Error("暂时没能判断这道题的主要题型，请换一张更清楚的照片。");

      saveEvent(eventEnvelope({
        source: "mistake",
        event_type: "mistake_recorded",
        knowledge_points: [point],
        question: analysis.question,
        student_answer: analysis.student_answer,
        correct_answer: analysis.correct_answer,
        correct: false,
        passed: false,
        error_type: analysis.error_type,
        error_nature: analysis.error_nature,
        confidence: analysis.confidence,
        raw_payload: analysis
      }));

      setScreen(
        "这道错题，我已经记住了",
        '<div class="v11-archive-ok">✓ 已进入你的长期学习记录</div>' +
        '<div class="v11-archive-rule">原题不讲解、不重做。接下来会换一道同类型的新题，让你先自己做。</div>',
        '<button id="v11-start-training" class="v11-primary">开始今天的第一道新题</button>'
      );
      document.getElementById("v11-start-training").onclick = generateVariants;
    } catch (error) {
      setScreen(
        "这次没有分析成功",
        '<div class="v11-error">' + escapeHTML(error.message || "请换一张清楚的照片再试。") + '</div>',
        '<button class="v11-secondary" id="v11-retry-upload">重新拍一张</button>'
      );
      document.getElementById("v11-retry-upload").onclick = renderHome;
    } finally {
      state.busy = false;
    }
  }

  async function generateVariants() {
    if (state.busy || !state.source) return;
    state.busy = true;
    setScreen(
      "我先给你一道相关的新题",
      '<div class="v11-loading"><div class="v11-spinner"></div><div>先做1道，答错了我再给你第2道；答对就先到这里。</div><div class="v11-loading-sub">原题只用于诊断，新题会尽量保持原题的题型骨架。</div></div>',
      ''
    );

    try {
      var point = text(state.source.knowledge_points && state.source.knowledge_points[0]);
      var data = await callJson("/api/retest/generate", {
        method: "POST",
        body: {
          knowledge_point: point,
          purpose: "same_type_training",
          variant_count: 1,
          source_question: text(state.source.question),
          source_student_answer: text(state.source.student_answer),
          source_correct_answer: text(state.source.correct_answer),
          source_error_type: text(state.source.error_type),
          source_error_nature: text(state.source.error_nature),
          source_image: state.sourceImage || ""
        }
      });

      var list = Array.isArray(data.variants) ? data.variants : [];
      if (list.length < 1 && data.question) {
        list = [data];
      }

      state.variants = list.slice(0, 1).map(function (item) {
        return normalizeVariant(item, point);
      });

      if (state.variants.length < 1) {
        throw new Error("暂时没有生成可用的新题。");
      }

      state.variantIndex = 0;
      state.secondQuestionRequested = false;
      saveSession();
      showIndependentQuestion();
    } catch (error) {
      setScreen(
        "新题暂时没生成出来",
        '<div class="v11-error">' + escapeHTML(error.message || "请再试一次。") + '</div>',
        '<button class="v11-secondary" id="v11-retry-generate">再生成一次</button>'
      );
      document.getElementById("v11-retry-generate").onclick = generateVariants;
    } finally {
      state.busy = false;
    }
  }

  function saveSession() {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        source: state.source,
        variants: state.variants,
        variantIndex: state.variantIndex,
        secondQuestionRequested: state.secondQuestionRequested
      }));
    } catch (_) {}
  }

  function showIndependentQuestion() {
    state.mode = "independent";
    state.stepIndex = 0;
    state.currentPrompt = "";
    state.history = [];
    state.reviewMode = false;

    var variant = currentVariant();
    if (!variant) {
      finishSession();
      return;
    }

    setScreen(
      "先自己做，不着急",
      '<div class="v11-progress">检验题 ' + (state.variantIndex + 1) + ' / ' + state.variants.length + '</div>' +
      renderVariantDiagram(variant) +
      '<div class="v11-question">' + escapeHTML(variant.question) + '</div>' +
      '<div class="v11-independent-note">先独立想一想。答对，今天先到这里；做不对，我再给你一道同类新题。</div>' +
      '<input id="v11-answer" class="v11-input" placeholder="写下你的答案" autocomplete="off">' +
      '<div id="v11-inline-message" class="v11-inline-message"></div>',
      '<button id="v11-submit" class="v11-primary">提交答案</button>'
    );

    var input = document.getElementById("v11-answer");
    input.focus();
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") submitIndependent();
    });
    document.getElementById("v11-submit").onclick = submitIndependent;
  }

  async function submitIndependent() {
    if (state.busy) return;
    var input = document.getElementById("v11-answer");
    var answer = text(input && input.value);
    var variant = currentVariant();
    if (!answer || !variant) return;

    state.busy = true;
    var button = document.getElementById("v11-submit");
    if (button) button.disabled = true;

    try {
      var result = await evaluateAnswer(
        variant.question,
        variant.correct_answer,
        answer,
        variant.knowledge_points[0]
      );

      saveEvent(eventEnvelope({
        source: state.reviewMode ? "retest" : "training",
        event_type: state.reviewMode ? "spaced_retest_attempt" : "training_attempt",
        knowledge_points: variant.knowledge_points,
        question: variant.question,
        student_answer: answer,
        correct_answer: variant.correct_answer,
        correct: Boolean(result.correct),
        passed: Boolean(result.correct),
        prompted: false,
        step_mode: "independent",
        error_type: result.error_type || "",
        error_nature: result.error_nature || "",
        confidence: 1,
        training_session_id: state.sessionId,
        attempt_number: 1,
        test_type: state.reviewMode ? "spaced_retest" : "variant_independent",
        review_key: reviewKey(variant),
        retention_stage: state.review && state.review.stage || 0
      }));

      if (result.correct) {
        if (state.reviewMode) {
          handleReviewPass();
        } else {
          handleIndependentPass();
        }
      } else {
        await handleIndependentFail();
      }
    } catch (error) {
      var box = document.getElementById("v11-inline-message");
      if (box) box.textContent = "这次判断没完成，请再提交一次。";
      console.warn(error);
    } finally {
      state.busy = false;
      var nextButton = document.getElementById("v11-submit");
      if (nextButton) nextButton.disabled = false;
    }
  }

  function handleIndependentPass() {
    var variant = currentVariant();
    scheduleReview(variant, 0);
    finishSession();
  }

  async function requestSecondVariant() {
    var current = currentVariant();
    if (!current) {
      finishSession();
      return;
    }

    setScreen(
      "我再给你一道相关题",
      '<div class="v11-loading"><div class="v11-spinner"></div><div>这一道和刚才考查同一个核心方法，但会换一种新的题面。</div><div class="v11-loading-sub">如果这一道也不会，我再陪你一步一步做。</div></div>',
      ''
    );

    try {
      var point = text(state.source && state.source.knowledge_points && state.source.knowledge_points[0]);
      var data = await callJson("/api/retest/generate", {
        method: "POST",
        body: {
          knowledge_point: point,
          purpose: "same_type_training",
          variant_count: 1,
          exclude_question: text(current.question),
          source_question: text(state.source && state.source.question),
          source_student_answer: text(state.source && state.source.student_answer),
          source_correct_answer: text(state.source && state.source.correct_answer),
          source_error_type: text(state.source && state.source.error_type),
          source_error_nature: text(state.source && state.source.error_nature),
          source_image: state.sourceImage || ""
        }
      });

      var list = Array.isArray(data.variants) ? data.variants : [];
      var item = list[0] || (data.question ? data : null);

      if (!item || !text(item.question)) {
        throw new Error("第二道相关新题暂时没有生成出来。");
      }

      state.variants.push(normalizeVariant(item, point));
      state.variantIndex = state.variants.length - 1;
      saveSession();
      showIndependentQuestion();
    } catch (error) {
      startGuidance("刚才这道题有点难。我们先把它拆成一步一步，一起弄明白。");
    }
  }

  async function handleIndependentFail() {
    if (
      state.variantIndex === 0 &&
      !state.secondQuestionRequested &&
      state.variants.length === 1
    ) {
      state.secondQuestionRequested = true;
      await requestSecondVariant();
      return;
    }

    startGuidance("这道新题有点难，我们把它拆成一步一步。");
  }

    function startGuidance(intro)  function startGuidance(intro) {
    var variant = currentVariant();
    var firstStep = variant && variant.steps[0];
    state.currentPrompt = text(firstStep && firstStep.prompt) || "先告诉我你现在知道了什么。";

    setScreen(
      "不会也没关系，我们一步一步来",
      '<div class="v11-progress">第 ' + (state.stepIndex + 1) + ' 步</div>' +
      '<div class="v11-guide-intro">' + escapeHTML(intro || "我们把题目拆小一点。") + '</div>' +
      renderVariantDiagram(variant) +
      '<div class="v11-question compact">' + escapeHTML(variant.question) + '</div>' +
      '<div class="v11-ai-bubble">' + escapeHTML(state.currentPrompt) + '</div>' +
      '<div class="v11-step-hint">这一格只填写当前这一步的答案，不用写后面的步骤。</div>' +
      '<div id="v11-manual-hint" class="v11-manual-hint" style="display:none"></div>' +
      '<input id="v11-step-answer" class="v11-input" placeholder="填写这一步的答案" autocomplete="off">' +
      '<div id="v11-step-feedback" class="v11-step-feedback"></div>',
      '<button id="v11-hint-btn" class="v11-secondary">💡 给我一个提示</button>' +
      '<button id="v11-step-submit" class="v11-primary">提交这一步</button>'
    );

    var input = document.getElementById("v11-step-answer");
    input.focus();
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") submitGuidedStep();
    });
    document.getElementById("v11-step-submit").onclick = submitGuidedStep;
  }

  async function submitGuidedStep() {
    if (state.busy) return;
    var input = document.getElementById("v11-step-answer");
    var answer = text(input && input.value);
    var variant = currentVariant();
    if (!answer || !variant) return;

    state.busy = true;
    var button = document.getElementById("v11-step-submit");
    if (button) button.disabled = true;

    var oldPrompt = state.currentPrompt;

    try {
      var data = await callJson("/api/tutor/step", {
        method: "POST",
        body: {
          knowledge_point: variant.knowledge_points[0],
          question: variant.question,
          current_prompt: oldPrompt,
          student_answer: answer,
          step_index: state.stepIndex,
          steps: variant.steps,
          history: state.history.slice(-8)
        }
      });

      var correct = Boolean(data.correct);
      var action = text(data.action) || (correct ? "advance" : "retry");

      state.history.push({
        step: state.stepIndex + 1,
        prompt: oldPrompt,
        answer: answer,
        correct: correct,
        coach_message: text(data.coach_message),
        action: action
      });

      saveEvent(eventEnvelope({
        source: "training",
        event_type: "training_attempt",
        knowledge_points: variant.knowledge_points,
        question: variant.question,
        student_answer: answer,
        correct_answer: "",
        correct: correct,
        passed: correct,
        prompted: true,
        step_mode: "guided",
        training_session_id: state.sessionId,
        step_number: state.stepIndex + 1,
        attempt_number: state.history.length,
        tutor_mode: "socratic",
        tutor_action: action,
        tutor_model: text(data.model)
      }));

      var feedback = document.getElementById("v11-step-feedback");
      if (feedback) {
        feedback.innerHTML =
          '<div class="' + (correct ? "ok" : "again") + '">' +
          escapeHTML(text(data.coach_message) || (correct ? "对了，我们继续。" : "再想一想这一步。")) +
          '</div>';
      }

      if (correct) {
        if (state.stepIndex + 1 >= variant.steps.length || action === "finish") {
          finishGuidedVariant();
          return;
        }
        state.stepIndex += 1;
        var nextStep = variant.steps[state.stepIndex];
        state.currentPrompt = text(nextStep && nextStep.prompt) || "我们继续下一步。";
        window.setTimeout(function () {
          renderGuidedNextStep(text(data.coach_message));
        }, 450);
      } else {
        var retryPrompt =
          text(data.next_prompt) ||
          text(data.coach_message) ||
          "";
        state.currentPrompt =
          retryPrompt ||
          buildChildHint(variant, state.stepIndex);

        var promptBox = document.querySelector(".v11-ai-bubble");
        if (promptBox) {
          promptBox.textContent = state.currentPrompt;
        }

        var hintBox = document.getElementById("v11-manual-hint");
        if (hintBox) {
          hintBox.textContent = "💡 " + buildChildHint(variant, state.stepIndex);
          hintBox.style.display = "block";
        }

        if (input) {
          input.value = "";
          input.focus();
        }
      }
    } catch (error) {
      var err = document.getElementById("v11-step-feedback");
      if (err) {
        err.innerHTML = '<div class="again">辅导暂时没连上，请再提交一次。</div>';
      }
      console.warn(error);
    } finally {
      state.busy = false;
      var b = document.getElementById("v11-step-submit");
      if (b) b.disabled = false;
    }
  }

  function renderGuidedNextStep(coachMessage) {
    var variant = currentVariant();
    var next = variant && variant.steps[state.stepIndex];
    setScreen(
      "很好，我们继续下一步",
      '<div class="v11-progress">第 ' + (state.stepIndex + 1) + ' 步</div>' +
      '<div class="v11-guide-intro">' + escapeHTML(coachMessage || "很好。") + '</div>' +
      renderVariantDiagram(variant) +
      '<div class="v11-ai-bubble">' + escapeHTML(text(next && next.prompt) || state.currentPrompt) + '</div>' +
      '<div class="v11-step-hint">这一格只填写当前这一步的答案，不用写后面的步骤。</div>' +
      '<div id="v11-manual-hint" class="v11-manual-hint" style="display:none"></div>' +
      '<input id="v11-step-answer" class="v11-input" placeholder="填写这一步的答案" autocomplete="off">' +
      '<div id="v11-step-feedback" class="v11-step-feedback"></div>',
      '<button id="v11-hint-btn" class="v11-secondary">💡 给我一个提示</button>' +
      '<button id="v11-step-submit" class="v11-primary">提交这一步</button>'
    );
    var hintBtn = document.getElementById("v11-hint-btn");
    if (hintBtn) {
      hintBtn.onclick = function () {
        var hintBox = document.getElementById("v11-manual-hint");
        if (hintBox) {
          hintBox.textContent = "💡 " + buildChildHint(variant, state.stepIndex);
          hintBox.style.display = "block";
        }
      };
    }
    document.getElementById("v11-step-submit").onclick = submitGuidedStep;
    var input = document.getElementById("v11-step-answer");
    input.focus();
    input.addEventListener("keydown", function (event) {
      if (event.key === "Enter") submitGuidedStep();
    });
  }

  function finishGuidedVariant() {
    var variant = currentVariant();
    scheduleReview(variant, 0);

    saveEvent(eventEnvelope({
      source: "training",
      event_type: "training_completed",
      knowledge_points: variant.knowledge_points,
      question: variant.question,
      student_answer: "",
      correct_answer: variant.correct_answer,
      correct: true,
      passed: true,
      prompted: true,
      step_mode: "guided_completed",
      training_session_id: state.sessionId,
      attempt_number: state.history.length,
      tutor_mode: "socratic"
    }));

    setScreen(
      "这一题，我们已经走完了",
      '<div class="v11-success">✓ 不是靠直接看答案，而是你自己一步一步完成了。</div>' +
      '<div class="v11-result-note">今天的检验已经完成。系统会根据你的表现安排之后的复测。</div>',
      '<button id="v11-next" class="v11-primary">完成今天练习</button>'
    );
    document.getElementById("v11-next").onclick = finishSession;
  }

  function advanceVariant() {
    state.variantIndex += 1;
    if (state.variantIndex >= state.variants.length) {
      finishSession();
      return;
    }
    saveSession();
    showIndependentQuestion();
  }

  function finishSession() {
    var completedCount = Math.max(1, state.variantIndex + 1);
    state.mode = "idle";
    state.reviewMode = false;
    state.review = null;
    state.sourceImage = null;
    state.secondQuestionRequested = false;
    try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
    setScreen(
      "今天的练习完成了",
      '<div class="v11-success">✓ 今天完成了 ' + completedCount + ' 道检验题</div>' +
      '<div class="v11-next-review">系统已经把这次表现记下来。到复习时间，它会再给你安排测试。</div>',
      '<button id="v11-home" class="v11-primary">回到首页</button>'
    );
    document.getElementById("v11-home").onclick = renderHome;
    refreshReviewBanner();
  }

  function reviewKey(variant) {
    return [
      "point:" + text(variant && variant.knowledge_points && variant.knowledge_points[0]),
      "question:" + text(variant && variant.question)
    ].join("::");
  }

  function scheduleReview(variant, stage) {
    if (!variant || !variant.question) return;
    stage = Math.max(0, Math.min(SCHEDULE.length - 1, Number(stage) || 0));
    var days = SCHEDULE[stage];
    var due = new Date(Date.now() + days * 86400000).toISOString();

    saveEvent(eventEnvelope({
      source: "training",
      event_type: "training_completed",
      knowledge_points: variant.knowledge_points,
      question: variant.question,
      correct_answer: variant.correct_answer,
      correct: true,
      passed: true,
      prompted: state.mode === "guided",
      step_mode: state.mode === "guided" ? "guided_completed" : "independent_completed",
      training_session_id: state.sessionId,
      test_type: "retention_schedule",
      review_key: reviewKey(variant),
      review_due_at: due,
      retention_stage: stage
    }));
  }

  function buildDueReviews() {
    var events = readEvents();
    var latest = new Map();
    events.forEach(function (row) {
      var e = row && row.normalized_event;
      var ctx = e && e.context;
      if (!e || !ctx || !ctx.review_key || !ctx.review_due_at) return;
      var prior = latest.get(ctx.review_key);
      var time = new Date(e.occurred_at || row.occurred_at || 0).getTime();
      var priorTime = prior ? new Date(prior.normalized_event.occurred_at || 0).getTime() : -1;
      if (!prior || time >= priorTime) latest.set(ctx.review_key, row);
    });

    var due = [];
    latest.forEach(function (row) {
      var e = row.normalized_event;
      var ctx = e.context || {};
      if (new Date(ctx.review_due_at).getTime() <= Date.now() &&
          e.question && e.correct_answer) {
        due.push({
          key: ctx.review_key,
          question: e.question,
          correct_answer: e.correct_answer,
          knowledge_points: e.knowledge_points || [],
          stage: Number(ctx.retention_stage || 0),
          due_at: ctx.review_due_at,
          steps: [
            { prompt: "先说说这道题告诉了我们什么。" },
            { prompt: "想一想应该先找哪一个关键数量关系。" },
            { prompt: "根据这个关系完成计算或判断。" }
          ]
        });
      }
    });

    return due;
  }

  function refreshReviewBanner() {
    var banner = document.getElementById("v11-review-banner");
    if (!banner) return;
    var due = buildDueReviews();
    if (due.length === 0) {
      banner.style.display = "none";
      return;
    }
    banner.style.display = "flex";
    banner.innerHTML =
      '<div><strong>📅 今天有 ' + due.length + ' 道复习</strong><div class="v11-banner-sub">这是之前练过的内容，现在换到间隔复习时间了。</div></div>' +
      '<button id="v11-review-start" class="v11-banner-btn">开始复习</button>';
    document.getElementById("v11-review-start").onclick = function () {
      startReview(due[0]);
    };
  }

  function startReview(review) {
    state.review = review;
    state.sourceImage = null;
    state.secondQuestionRequested = false;
    state.reviewMode = true;
    state.variants = [{
      question: review.question,
      correct_answer: review.correct_answer,
      knowledge_points: review.knowledge_points,
      explanation: "",
      steps: review.steps
    }];
    state.variantIndex = 0;
    state.sessionId = uid("review");
    showIndependentQuestion();
  }

  function handleReviewPass() {
    var review = state.review;
    var variant = currentVariant();
    var nextStage = Math.min(
      SCHEDULE.length - 1,
      Number(review && review.stage || 0) + 1
    );
    scheduleReview(variant, nextStage);

    setScreen(
      "复习通过了",
      '<div class="v11-success">✓ 这次复测通过，下一次间隔会更长。</div>' +
      '<div class="v11-next-review">下一次复习预计在 ' + SCHEDULE[nextStage] + ' 天后。</div>',
      '<button id="v11-back" class="v11-primary">回到首页</button>'
    );
    document.getElementById("v11-back").onclick = renderHome;
    refreshReviewBanner();
  }

  function initShell() {
    var legacy = document.querySelector(".container");
    if (legacy) legacy.style.display = "none";

    var root = document.createElement("div");
    root.id = "v11-app";
    root.innerHTML =
      '<div class="v11-wrap">' +
        '<header class="v11-header">' +
          '<div>' +
            '<div class="v11-brand">小学数学 AI</div>' +
            '<div class="v11-tagline">拍一道错题，接下来交给我</div>' +
          '</div>' +
          '<div id="v11-cloud" class="v11-cloud">☁️ 数据同步中…</div>' +
        '</header>' +
        '<div id="v11-review-banner" class="v11-review-banner"></div>' +
        '<div id="v11-screen"></div>' +
        '<div class="v11-footer">每一次独立作答、每一步辅导和每次复测，都会成为下一次学习的依据。</div>' +
      '</div>';
    document.body.appendChild(root);

    var style = document.createElement("style");
    style.textContent =
      "#v11-app{min-height:100vh;font-family:Arial,'Microsoft YaHei',sans-serif;background:#f6f8fb;color:#1f2937}" +
      ".v11-wrap{max-width:760px;margin:0 auto;padding:28px 18px 44px}" +
      ".v11-header{display:flex;align-items:flex-start;justify-content:space-between;gap:18px;margin-bottom:18px}" +
      ".v11-brand{font-size:30px;font-weight:800;letter-spacing:-.5px}" +
      ".v11-tagline{margin-top:6px;color:#667085;font-size:15px}" +
      ".v11-cloud{font-size:13px;color:#667085;white-space:nowrap;padding-top:5px}" +
      ".v11-cloud.ok{color:#15803d}.v11-cloud.pending{color:#475467}.v11-cloud.local{color:#9a6700}" +
      ".v11-card{background:#fff;border-radius:20px;padding:26px;box-shadow:0 8px 28px rgba(31,41,55,.07);border:1px solid #eef1f5}" +
      ".v11-title{font-size:23px;font-weight:800;line-height:1.4}.v11-body{margin-top:18px}" +
      ".v11-lead{font-size:16px;line-height:1.8;color:#344054}" +
      ".v11-route{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:20px 0}" +
      ".v11-route div{padding:12px;border-radius:12px;background:#f7f9fc;color:#475467;font-size:14px}" +
      ".v11-route span{display:inline-flex;width:23px;height:23px;border-radius:50%;align-items:center;justify-content:center;background:#eef2ff;color:#4338ca;margin-right:7px;font-weight:700}" +
      ".v11-upload{margin-top:16px;border:2px dashed #b9c2d0;border-radius:18px;padding:34px 20px;text-align:center;cursor:pointer;transition:.2s;background:#fbfcfe}" +
      ".v11-upload:hover,.v11-upload.chosen{border-color:#4f46e5;background:#f7f7ff}" +
      ".v11-upload-icon{font-size:42px}.v11-upload-main{margin-top:8px;font-size:18px;font-weight:800}.v11-upload-sub{margin-top:7px;color:#667085;font-size:14px;line-height:1.6}" +
      ".v11-preview{display:none;max-width:100%;max-height:300px;margin:18px auto 0;border-radius:12px}" +
      ".v11-small{margin-top:14px;text-align:center;color:#98a2b3;font-size:13px;line-height:1.6}" +
      ".v11-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:22px}.v11-actions button{border:0;border-radius:11px;padding:12px 18px;font-size:16px;cursor:pointer}.v11-primary{background:#4f46e5;color:#fff}.v11-secondary{background:#eef1f5;color:#344054}" +
      ".v11-progress{color:#667085;font-size:13px;font-weight:700;margin-bottom:10px}.v11-question{padding:18px;border-radius:14px;background:#f8fafc;border:1px solid #eaecf0;font-size:19px;line-height:1.8;font-weight:700}.v11-question.compact{font-size:16px;font-weight:600}" +
      ".v11-diagram{margin:12px 0;padding:14px;background:#fbfcfe;border:1px dashed #d0d5dd;border-radius:12px;white-space:pre-wrap;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:15px;line-height:1.55;overflow:auto}" +
      ".v11-independent-note,.v11-result-note,.v11-next-review,.v11-archive-rule,.v11-guide-intro{margin-top:14px;color:#475467;line-height:1.7;font-size:14px}" +
      ".v11-input{width:100%;margin-top:16px;padding:13px 14px;border:1px solid #cfd6e0;border-radius:11px;font-size:17px;outline:none}.v11-input:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.12)}" +
      ".v11-inline-message,.v11-step-feedback{min-height:22px;margin-top:10px;font-size:14px}.v11-manual-hint{margin:10px 0;padding:10px 12px;border-radius:10px;background:#fff7ed;color:#9a3412;font-size:14px;line-height:1.6}.v11-step-hint{margin:10px 0 8px;color:#667085;font-size:13px;line-height:1.5}.v11-ai-bubble{margin-top:16px;padding:15px 16px;border-radius:16px 16px 16px 4px;background:#eef2ff;color:#3730a3;line-height:1.75;font-size:16px}.v11-step-feedback .ok{margin-top:10px;color:#15803d;line-height:1.7}.v11-step-feedback .again{margin-top:10px;color:#b45309;line-height:1.7}" +
      ".v11-success{padding:14px 16px;border-radius:13px;background:#ecfdf3;color:#166534;font-weight:700;line-height:1.7}.v11-archive-ok{padding:14px 16px;border-radius:13px;background:#eefbf3;color:#166534;font-weight:700}.v11-error{padding:14px 16px;border-radius:13px;background:#fff7ed;color:#9a3412;line-height:1.7}" +
      ".v11-loading{text-align:center;padding:36px 14px;color:#475467;line-height:1.8}.v11-loading-sub{margin-top:6px;color:#98a2b3;font-size:13px}.v11-spinner{width:30px;height:30px;border:3px solid #e5e7eb;border-top-color:#4f46e5;border-radius:50%;margin:0 auto 14px;animation:v11spin 1s linear infinite}@keyframes v11spin{to{transform:rotate(360deg)}}" +
      ".v11-review-banner{display:none;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px;padding:13px 15px;border-radius:14px;background:#fff8e7;border:1px solid #f5d48a;color:#7a5410}.v11-banner-sub{margin-top:3px;font-size:12px;color:#9a7a34}.v11-banner-btn{border:0;border-radius:10px;padding:9px 13px;background:#7c5c16;color:#fff;cursor:pointer;white-space:nowrap}.v11-footer{text-align:center;color:#98a2b3;font-size:12px;line-height:1.6;margin-top:20px}" +
      "@media(max-width:640px){.v11-wrap{padding:20px 13px 32px}.v11-header{align-items:flex-start}.v11-brand{font-size:26px}.v11-cloud{font-size:12px}.v11-route{grid-template-columns:1fr}.v11-card{padding:20px}.v11-question{font-size:18px}}";
    document.head.appendChild(style);

    renderHome();
    refreshReviewBanner();

    var fileInput = document.getElementById("fileInput");
    if (fileInput) {
      fileInput.addEventListener("change", function () {
        var preview = document.getElementById("v11-preview");
        var file = fileInput.files && fileInput.files[0];
        if (preview && file) {
          preview.src = URL.createObjectURL(file);
          preview.style.display = "block";
        }
      });
    }

    setCloud("☁️ 正在检查同步…", "pending");
    pullCloudEvents().finally(function () {
      refreshReviewBanner();
    });
  }

  initShell();
})();
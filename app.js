(function () {
  const data = window.__MATCH_SITE_DATA__;
  const app = document.getElementById("app");
  const brandButton = document.getElementById("brandButton");
  const STORAGE_KEY = "gal-match-quiz-state-v2";

  if (!data || !app) {
    return;
  }

  const dimensions = data.dimensions || [];
  const dimensionKeys = dimensions.map((item) => item.key);
  const coreDimensionKeys = dimensions.filter((item) => item.group !== "appearance").map((item) => item.key);
  const appearanceDimensionKeys = dimensions.filter((item) => item.group === "appearance").map((item) => item.key);
  const dimensionMap = new Map(dimensions.map((item) => [item.key, item]));
  const sliderQuestionCount = data.questions.filter((question) => question.type === "slider").length;
  const appearanceQuestionCount = data.questions.filter((question) => question.group === "appearance").length;
  const userVectorMax = computeUserVectorMax(data.questions, dimensionKeys);
  const homePreview = pickHomePreview(data.heroes, 8);

  const state = loadState() || {
    view: "home",
    currentQuestion: 0,
    answers: [],
    result: null,
    showGallery: false,
    gallerySearch: "",
    galleryLimit: 20,
  };
  sanitizeState();

  if (state.view === "result" && Array.isArray(state.answers) && state.answers.length === data.questions.length) {
    state.result = computeQuizResult();
  }

  function zeroVector() {
    return Object.fromEntries(dimensionKeys.map((key) => [key, 0]));
  }

  function getDimension(key) {
    return dimensionMap.get(key);
  }

  function getSliderSpan(question) {
    return Math.max(Math.abs(question?.min ?? -10), Math.abs(question?.max ?? 10), 1);
  }

  function getStoredAnswer(questionIndex) {
    const answer = state.answers[questionIndex];
    return typeof answer === "number" && Number.isFinite(answer) ? answer : null;
  }

  function getSliderAnswer(questionIndex, question) {
    const stored = getStoredAnswer(questionIndex);
    if (stored === null) {
      return 0;
    }

    const min = question?.min ?? -10;
    const max = question?.max ?? 10;
    return clamp(stored, min, max);
  }

  function computeUserVectorMax(questions, keys) {
    const totals = Object.fromEntries(keys.map((key) => [key, 0]));

    for (const question of questions) {
      if (question.type === "slider") {
        for (const key of keys) {
          totals[key] += Math.abs((question.effects && question.effects[key]) || 0);
        }
        continue;
      }

      for (const key of keys) {
        const peak = Math.max(
          ...question.options.map((option) => Math.abs((option.effects && option.effects[key]) || 0)),
          0,
        );
        totals[key] += peak;
      }
    }

    return totals;
  }

  function normalizeUserVector(rawVector) {
    const normalized = {};

    for (const key of dimensionKeys) {
      const divisor = userVectorMax[key] || 1;
      const value = rawVector[key] / divisor;
      normalized[key] = round(clamp(value, -1, 1), 3);
    }

    return normalized;
  }

  function computeQuizResult() {
    const rawVector = zeroVector();

    data.questions.forEach((question, questionIndex) => {
      if (question.type === "slider") {
        const sliderValue = getSliderAnswer(questionIndex, question);
        const scale = sliderValue / getSliderSpan(question);
        for (const key of dimensionKeys) {
          rawVector[key] += ((question.effects && question.effects[key]) || 0) * scale;
        }
        return;
      }

      const answerIndex = state.answers[questionIndex];
      const option = question.options?.[answerIndex];
      if (!option) {
        return;
      }

      for (const key of dimensionKeys) {
        rawVector[key] += (option.effects && option.effects[key]) || 0;
      }
    });

    const userVector = normalizeUserVector(rawVector);
    const ranked = data.heroes
      .map((hero) => {
        const score = similarity(userVector, hero.vector);
        return {
          ...hero,
          matchScore: score,
          matchPercent: Math.round(score * 100),
        };
      })
      .sort((a, b) => b.matchScore - a.matchScore);

    const top = ranked[0];
    return {
      userVector,
      top,
      ranked,
      summary: buildUserSummary(userVector),
      reasons: buildMatchReasons(userVector, top),
    };
  }

  function similarity(userVector, heroVector) {
    let weightedDistance = 0;
    let weightTotal = 0;
    let dot = 0;
    let userNorm = 0;
    let heroNorm = 0;

    for (const key of dimensionKeys) {
      const userValue = userVector[key] || 0;
      const heroValue = heroVector[key] || 0;
      const weight = getDimension(key)?.weight || 1;

      weightedDistance += (Math.abs(userValue - heroValue) / 2) * weight;
      weightTotal += weight;
      dot += userValue * heroValue;
      userNorm += userValue * userValue;
      heroNorm += heroValue * heroValue;
    }

    const distanceScore = 1 - weightedDistance / Math.max(weightTotal, 1);
    const cosineBase = userNorm > 0.0001 && heroNorm > 0.0001
      ? dot / (Math.sqrt(userNorm) * Math.sqrt(heroNorm))
      : 0;
    const directionalScore = (clamp(cosineBase, -1, 1) + 1) / 2;
    return round((distanceScore * 0.82) + (directionalScore * 0.18), 4);
  }

  function buildUserSummary(userVector) {
    const sortedCore = [...coreDimensionKeys]
      .map((key) => ({ key, value: userVector[key] }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const sortedAppearance = [...appearanceDimensionKeys]
      .map((key) => ({ key, value: userVector[key] }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

    const labels = sortedCore.slice(0, 2).map((item) => profilePhrase(item.key, item.value));
    const appearanceLabel = sortedAppearance[0] ? profilePhrase(sortedAppearance[0].key, sortedAppearance[0].value) : null;

    if (appearanceLabel) {
      return `你的整体心动频率更偏向 ${labels.join(" / ")}；外观上会更吃 ${appearanceLabel}。`;
    }

    return `你的整体心动频率更偏向 ${labels.join(" / ")}。`;
  }

  function buildMatchReasons(userVector, hero) {
    if (!hero) {
      return [];
    }

    const aligned = dimensions
      .map((key) => {
        const dimension = typeof key === "string" ? getDimension(key) : key;
        const actualKey = typeof key === "string" ? key : key.key;
        const difference = Math.abs((userVector[actualKey] || 0) - (hero.vector[actualKey] || 0));
        return {
          key: actualKey,
          group: dimension?.group || "core",
          difference,
          userValue: userVector[actualKey],
          heroValue: hero.vector[actualKey],
        };
      })
      .sort((a, b) => a.difference - b.difference)
      ;

    const picked = [
      ...aligned.filter((item) => item.group !== "appearance").slice(0, 2),
      ...aligned.filter((item) => item.group === "appearance").slice(0, 1),
    ];

    return picked.map((item) => axisReason(item.key, item.userValue, hero));
  }

  function axisReason(key, userValue, hero) {
    const dimension = getDimension(key);
    const polarity = userValue >= 0 ? "high" : "low";
    const label = dimension ? dimension[polarity] : key;

    if (key === "social") {
      return userValue >= 0
        ? `你们都更容易被有来有回、气氛鲜活的相处方式吸引，${hero.originalName} 的社交节奏会比较对你胃口。`
        : `你更吃慢热型的靠近方式，而 ${hero.originalName} 也属于不需要一直吵闹就能留下存在感的类型。`;
    }
    if (key === "warmth") {
      return userValue >= 0
        ? `你在关系里更看重温度感和被接住的安心感，这一点和 ${hero.originalName} 的气质很贴。`
        : `你对“克制里带情绪”的角色会更有感觉，${hero.originalName} 身上的距离感反而会让你上头。`;
    }
    if (key === "energy") {
      return userValue >= 0
        ? `你更容易被鲜活、有互动感的恋爱节奏打动，而 ${hero.originalName} 正好自带这种轻快感。`
        : `你更偏爱安静、稳定、能慢慢沉进去的陪伴方式，${hero.originalName} 的节奏和你比较同步。`;
    }
    if (key === "dream") {
      return userValue >= 0
        ? `你会对带一点剧情感、浪漫感的人更心动，${hero.originalName} 正好有这种“像故事开始”的味道。`
        : `你更喜欢清醒、踏实、能落地的相处方式，${hero.originalName} 的风格会让你觉得安心。`;
    }
    if (key === "mystery") {
      return userValue >= 0
        ? `你对那种“越了解越想继续靠近”的神秘感很有反应，${hero.originalName} 在这点上很容易击中你。`
        : `你更喜欢表达直接、相处不拧巴的人，而 ${hero.originalName} 的打开方式不会让你太累。`;
    }
    if (key === "maturity") {
      return userValue >= 0
        ? `你明显会被更稳、更有分寸感的气质吸引，所以 ${hero.originalName} 的成熟感会很加分。`
        : `你会更偏爱带点青涩、少女感更强的心动体验，${hero.originalName} 正好落在这个区间。`;
    }
    if (key === "hair_length") {
      return userValue >= 0
        ? `外观上你会更吃长发那种柔和、延展的观感，而 ${hero.originalName} 刚好比较贴这条线。`
        : `你对短发那种利落、轻快的第一眼印象更有感觉，而 ${hero.originalName} 在这点上会更对你胃口。`;
    }
    if (key === "hair_tone") {
      return userValue >= 0
        ? `你会更容易被浅亮发色的存在感吸引，${hero.originalName} 的视觉印象刚好落在这边。`
        : `你会更吃深发那种稳定、耐看的观感，而 ${hero.originalName} 在这条偏好上和你很接近。`;
    }
    if (key === "legwear") {
      return userValue >= 0
        ? `你会对丝袜、长袜这类更完整的腿部造型有反应，${hero.originalName} 在外观风格上正好贴近这一点。`
        : `你更偏爱轻装、露腿感更强的利落观感，所以 ${hero.originalName} 会更容易第一眼击中你。`;
    }
    if (key === "ornament") {
      return userValue >= 0
        ? `你会被蝴蝶结、发饰、甜系点缀这些更有装饰感的打扮吸引，而 ${hero.originalName} 在这方面比较加分。`
        : `你更喜欢简洁、干净、不过分堆细节的打扮方式，${hero.originalName} 的视觉风格会让你更舒服。`;
    }
    if (key === "visual_maturity") {
      return userValue >= 0
        ? `外观气质上你会更吃姐姐感，所以 ${hero.originalName} 那种偏成熟的视觉印象会更容易拿分。`
        : `你会更偏爱轻盈、青涩一点的第一眼心动，而 ${hero.originalName} 刚好靠近这个方向。`;
    }

    return `${label} 这条轴上，你和 ${hero.originalName} 的频率很接近。`;
  }

  function profilePhrase(key, value) {
    const dimension = getDimension(key);
    if (!dimension) {
      return key;
    }
    return value >= 0 ? dimension.high : dimension.low;
  }

  function render() {
    saveState();

    if (state.view === "quiz") {
      app.innerHTML = renderQuiz();
    } else if (state.view === "result") {
      app.innerHTML = renderResult();
    } else {
      app.innerHTML = renderHome();
    }

    bindEvents();
  }

  function sanitizeState() {
    if (!["home", "quiz", "result"].includes(state.view)) {
      state.view = "home";
    }

    if (!Array.isArray(state.answers)) {
      state.answers = [];
    }

    if (!Number.isInteger(state.currentQuestion) || state.currentQuestion < 0) {
      state.currentQuestion = 0;
    }

    if (state.currentQuestion >= data.questions.length) {
      state.currentQuestion = Math.max(0, data.questions.length - 1);
    }

    if (typeof state.gallerySearch !== "string") {
      state.gallerySearch = "";
    }

    if (!Number.isFinite(state.galleryLimit) || state.galleryLimit < 20) {
      state.galleryLimit = 20;
    }

    if (state.view === "result" && state.answers.length !== data.questions.length) {
      state.view = "home";
      state.result = null;
    }

    if (state.view === "quiz" && state.answers.length > data.questions.length) {
      state.answers = state.answers.slice(0, data.questions.length);
    }
  }

  function renderHome() {
    const heroCards = homePreview
      .map((hero, index) => {
        const tilt = [-3, 2, -1, 3, -2, 1, -4, 2][index % 8];
        return `
          <figure class="polaroid" style="--tilt:${tilt}deg">
            <img src="${hero.image}" alt="${escapeHtml(hero.originalName)}" loading="lazy">
            <span>${escapeHtml(hero.originalName)}</span>
          </figure>
        `;
      })
      .join("");

    return `
      <section class="panel hero-panel">
        <div class="hero-copy">
          <h1 class="hero-title">来做题选你的<br>专属 Galgame 老婆！</h1>
          <div class="hero-actions">
            <button class="button button-primary" data-action="start-quiz" type="button">开始测试</button>
            <button class="button button-secondary" data-action="show-gallery" type="button">先看全部女主</button>
          </div>
        </div>
        <aside class="hero-side">
          <div class="stats-grid">
            <article class="stat-card">
              <div class="stat-label">女主样本</div>
              <div class="stat-value">${data.meta.heroCount}</div>
            </article>
            <article class="stat-card">
              <div class="stat-label">作品数量</div>
              <div class="stat-value">${data.meta.gameCount}</div>
            </article>
            <article class="stat-card">
              <div class="stat-label">题目数量</div>
              <div class="stat-value">${data.meta.questionCount}</div>
            </article>
          </div>
          <div class="photo-strip">${heroCards}</div>
        </aside>
      </section>

      <section class="panel section-panel">
        <div class="section-head">
          <div>
            <h2 class="section-title">这个测试怎么做</h2>
            <div class="section-note">每题只要选最像你的反应，不需要刻意“选最优”。答案越本能，匹配越准。</div>
          </div>
        </div>
        <div class="pill-row">
          <span class="pill">题目设计尽量避开直球人设提问</span>
          <span class="pill">更偏生活偏好 / 恋爱氛围 / 关系处理方式</span>
          <span class="pill">结果会给出最匹配女主 + 前排候选</span>
        </div>
      </section>

      ${renderGallerySection(true)}

      <div class="footer-note">
        数据来源于你整理出的 VNDB 角色资料，本页为非商业风格测试站样板。若用于公开传播，建议在结果页补充“仅供娱乐”的说明。
      </div>
    `;
  }

  function renderQuiz() {
    const question = data.questions[state.currentQuestion];
    const selectedIndex = state.answers[state.currentQuestion];
    const currentSliderValue = getSliderAnswer(state.currentQuestion, question);
    const progress = ((state.currentQuestion + 1) / data.questions.length) * 100;
    const eyebrow = question.group === "appearance"
      ? `外观偏好 ${String(state.currentQuestion + 1).padStart(2, "0")}`
      : (question.type === "slider"
        ? `滑杆题 ${String(state.currentQuestion + 1).padStart(2, "0")}`
        : `场景题 ${String(state.currentQuestion + 1).padStart(2, "0")}`);

    const answerMarkup = question.type === "slider"
      ? renderSliderQuestion(question, currentSliderValue)
      : `
          <div class="answers">
            ${question.options
              .map((option, index) => {
                const chosen = selectedIndex === index ? " is-selected" : "";
                return `
                  <button class="answer-card${chosen}" data-action="answer" data-index="${index}" type="button">
                    <span class="answer-index">${String.fromCharCode(65 + index)}</span>
                    <span class="answer-text">${escapeHtml(option.text)}</span>
                  </button>
                `;
              })
              .join("")}
          </div>
        `;

    const nextButton = question.type === "slider"
      ? `<button class="button button-primary" data-action="next-question" type="button">${state.currentQuestion === data.questions.length - 1 ? "查看结果" : "下一题"}</button>`
      : "";

    return `
      <section class="panel question-panel">
        <div class="question-top">
          <div class="progress-shell">
            <div class="progress-bar" style="width:${progress}%"></div>
          </div>
          <div class="question-index">${state.currentQuestion + 1} / ${data.questions.length}</div>
        </div>
        <div class="question-body">
          <p class="eyebrow">${eyebrow}</p>
          <h2 class="question-title">${escapeHtml(question.title)}</h2>
          ${answerMarkup}
        </div>
        <div class="question-actions">
          <button class="button button-ghost" data-action="go-home" type="button">返回首页</button>
          <button class="button button-secondary" data-action="prev-question" type="button" ${state.currentQuestion === 0 ? "disabled" : ""}>上一题</button>
          ${nextButton}
        </div>
      </section>
    `;
  }

  function sliderSummaryText(question, value) {
    if (question.sliderMode === "preference") {
      if (value >= 8) {
        return `明显偏向：${question.rightLabel}`;
      }
      if (value >= 3) {
        return `稍微偏向：${question.rightLabel}`;
      }
      if (value <= -8) {
        return `明显偏向：${question.leftLabel}`;
      }
      if (value <= -3) {
        return `稍微偏向：${question.leftLabel}`;
      }
      return "当前偏中间，两边都能接受";
    }

    if (value >= 8) {
      return "非常认同";
    }
    if (value >= 4) {
      return "比较认同";
    }
    if (value >= 1) {
      return "有点认同";
    }
    if (value <= -8) {
      return "非常不认同";
    }
    if (value <= -4) {
      return "比较不认同";
    }
    if (value <= -1) {
      return "有点不认同";
    }
    return "当前偏中间";
  }

  function renderSliderQuestion(question, value) {
    const leftLabel = question.sliderMode === "preference" ? question.leftLabel : "更不认同";
    const rightLabel = question.sliderMode === "preference" ? question.rightLabel : "更认同";
    const scaleHint = question.sliderMode === "preference"
      ? "往左和往右分别代表两种不同取向，0 表示没有明显偏向。"
      : "从 -10 到 10 拖动，数值越大代表越认同这句话。";

    return `
      <div class="slider-panel">
        <div class="slider-head">
          <div class="slider-value" data-role="slider-value">${sliderSummaryText(question, value)}</div>
          <div class="slider-number" data-role="slider-number">${value}</div>
        </div>
        <input
          class="quiz-slider"
          data-action="slider-answer"
          type="range"
          min="${question.min}"
          max="${question.max}"
          step="${question.step}"
          value="${value}"
        >
        <div class="slider-labels">
          <span>${escapeHtml(leftLabel)}</span>
          <span>0</span>
          <span>${escapeHtml(rightLabel)}</span>
        </div>
        <div class="slider-ticks" aria-hidden="true">
          <span>-10</span>
          <span>-5</span>
          <span>0</span>
          <span>5</span>
          <span>10</span>
        </div>
        <p class="slider-hint">${escapeHtml(scaleHint)}</p>
      </div>
    `;
  }

  function renderResult() {
    if (!state.result) {
      return "";
    }

    const top = state.result.top;
    const topMatches = state.result.ranked.slice(0, 8);
    const userVectorChips = dimensions
      .map((key) => {
        const actualKey = typeof key === "string" ? key : key.key;
        const dimension = typeof key === "string" ? getDimension(key) : key;
        const value = state.result.userVector[actualKey];
        const label = value >= 0 ? dimension.high : dimension.low;
        return `<span class="pill">${escapeHtml(dimension.name)}：${escapeHtml(label)}</span>`;
      })
      .join("");

    const rankingCards = topMatches
      .map(
        (hero, index) => `
          <article class="ranking-card">
            <img src="${hero.image}" alt="${escapeHtml(hero.originalName)}" loading="lazy">
            <div class="ranking-body">
              <div class="ranking-top">
                <div class="ranking-name">#${index + 1} ${escapeHtml(hero.displayName || hero.originalName)}</div>
                <div class="ranking-score">${hero.matchPercent}%</div>
              </div>
              <div class="ranking-game">${escapeHtml(hero.gameTitleCn || hero.gameTitle)}</div>
              <div class="tiny-tags">
                ${hero.tags.slice(0, 4).map((tag) => `<span class="tiny-tag">${escapeHtml(tag)}</span>`).join("")}
              </div>
              <div class="tiny-tags">
                <a class="tiny-tag" href="${hero.vndbCharacterUrl}" target="_blank" rel="noreferrer">VNDB</a>
                ${hero.bangumiCharacterUrl ? `<a class="tiny-tag" href="${hero.bangumiCharacterUrl}" target="_blank" rel="noreferrer">Bangumi</a>` : ""}
              </div>
            </div>
          </article>
        `,
      )
      .join("");

    return `
      <section class="panel section-panel">
        <div class="section-head">
          <div>
            <h2 class="section-title">你的本次匹配结果</h2>
            <div class="section-note">${escapeHtml(state.result.summary)}</div>
          </div>
        </div>

        <div class="pill-row" style="margin-bottom:18px">${userVectorChips}</div>

        <div class="result-hero">
          <div class="result-figure">
            <img src="${top.image}" alt="${escapeHtml(top.originalName)}" loading="eager">
            <div class="compat-badge">
              <span>匹配度</span>
              <strong>${top.matchPercent}%</strong>
            </div>
          </div>

          <div>
            <p class="eyebrow">Top Match</p>
            <h3 class="result-title">${escapeHtml(top.displayName || top.originalName)}</h3>
            <p class="result-meta">
              ${top.supportName ? `${escapeHtml(top.supportName)}<br>` : ""}
              出自：${escapeHtml(top.gameTitleCn || top.gameTitle)}${top.gameTitleCn ? ` / ${escapeHtml(top.gameTitle)}` : ""}
            </p>
            <p class="result-blurb">${escapeHtml(top.blurb)}</p>
            <div class="tag-row">
              ${top.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}
            </div>

            <div class="result-grid">
              <div class="mini-panel">
                <h4 class="mini-title">为什么会匹配到她</h4>
                <div class="reason-list">
                  ${state.result.reasons
                    .map(
                      (reason) => `
                        <div class="reason-item">
                          <span class="reason-dot"></span>
                          <span>${escapeHtml(reason)}</span>
                        </div>
                      `,
                    )
                    .join("")}
                </div>
              </div>
              <div class="mini-panel">
                <h4 class="mini-title">人格坐标对比</h4>
                ${renderRadar(state.result.userVector, top.vector)}
              </div>
            </div>

            <div class="result-actions">
              <button class="button button-primary" data-action="restart-quiz" type="button">再测一次</button>
              <button class="button button-secondary" data-action="copy-result" type="button">复制结果文案</button>
              ${top.vndbCharacterUrl ? `<a class="button button-secondary result-link" href="${top.vndbCharacterUrl}" target="_blank" rel="noreferrer">打开 VNDB 主页</a>` : ""}
              ${top.bangumiCharacterUrl ? `<a class="button button-secondary result-link" href="${top.bangumiCharacterUrl}" target="_blank" rel="noreferrer">打开 Bangumi 主页</a>` : ""}
              <button class="button button-ghost" data-action="toggle-gallery" type="button">${state.showGallery ? "收起全部女主" : "展开全部女主"}</button>
            </div>
          </div>
        </div>
      </section>

      <section class="panel section-panel">
        <div class="section-head">
          <div>
            <h2 class="section-title">和你接近的其他女主</h2>
            <div class="section-note">不是只有一个答案。下面这些，也都和你的心动频率很接近。</div>
          </div>
        </div>
        <div class="ranking-grid">${rankingCards}</div>
      </section>

      ${renderGallerySection(false)}
    `;
  }

  function renderGallerySection(openOnHome) {
    const shouldShow = openOnHome || state.showGallery;
    const search = state.gallerySearch.trim().toLowerCase();
    const filtered = data.heroes.filter((hero) => matchesSearch(hero, search));
    const visibleHeroes = shouldShow ? filtered.slice(0, state.galleryLimit) : [];

    return `
      <section class="panel section-panel">
        <div class="section-head">
          <div>
            <h2 class="section-title">全部可匹配女主</h2>
            <div class="section-note">你也可以直接当图鉴看。支持按角色名、作品名、标签搜索。</div>
          </div>
        </div>

        ${
          shouldShow
            ? `
              <div class="gallery-toolbar">
                <input
                  class="search-input"
                  id="gallerySearch"
                  type="search"
                  placeholder="搜索角色名 / 作品名 / 标签"
                  value="${escapeHtml(state.gallerySearch)}"
                >
                <div class="pill-row">
                  <span class="pill">当前显示 ${visibleHeroes.length} / ${filtered.length}</span>
                </div>
              </div>

              ${
                visibleHeroes.length
                  ? `
                    <div class="gallery-grid">
                      ${visibleHeroes.map(renderHeroCard).join("")}
                    </div>
                    ${
                      filtered.length > visibleHeroes.length
                        ? `
                          <div class="hero-actions" style="margin-top:18px">
                            <button class="button button-secondary" data-action="load-more" type="button">加载更多</button>
                          </div>
                        `
                        : ""
                    }
                  `
                  : `<div class="empty-state">没搜到对应角色，换个作品名或者试试更短的关键词。</div>`
              }
            `
            : `
              <div class="hero-actions">
                <button class="button button-secondary" data-action="toggle-gallery" type="button">展开 ${data.meta.heroCount} 位女主图鉴</button>
              </div>
            `
        }
      </section>
    `;
  }

  function renderHeroCard(hero) {
    return `
      <article class="hero-card">
        <img src="${hero.image}" alt="${escapeHtml(hero.originalName)}" loading="lazy">
        <div class="hero-card-body">
          <div class="hero-card-name">${escapeHtml(hero.displayName || hero.originalName)}</div>
          ${hero.supportName ? `<div class="hero-card-sub">${escapeHtml(hero.supportName)}</div>` : ""}
          <div class="hero-card-sub">${escapeHtml(hero.gameTitleCn || hero.gameTitle)}</div>
          <div class="tiny-tags">
            ${hero.tags.slice(0, 4).map((tag) => `<span class="tiny-tag">${escapeHtml(tag)}</span>`).join("")}
          </div>
          <div class="tiny-tags">
            <a class="tiny-tag" href="${hero.vndbCharacterUrl}" target="_blank" rel="noreferrer">VNDB</a>
            ${hero.bangumiCharacterUrl ? `<a class="tiny-tag" href="${hero.bangumiCharacterUrl}" target="_blank" rel="noreferrer">Bangumi</a>` : ""}
          </div>
          <div class="hero-card-blurb">${escapeHtml(hero.blurb)}</div>
        </div>
      </article>
    `;
  }

  function renderRadar(userVector, heroVector) {
    const size = 280;
    const center = size / 2;
    const radius = 92;
    const levels = [0.25, 0.5, 0.75, 1];

    const grid = levels
      .map((level) => {
        const points = polygonPoints(levelVector(level, coreDimensionKeys), center, radius);
        return `<polygon points="${points}" fill="none" stroke="rgba(65,58,74,0.10)" stroke-width="1"></polygon>`;
      })
      .join("");

    const axes = coreDimensionKeys
      .map((key, index) => {
        const angle = angleFor(index);
        const point = polarPoint(center, radius + 28, angle);
        const end = polarPoint(center, radius, angle);
        const label = getDimension(key)?.name || key;
        return `
          <line x1="${center}" y1="${center}" x2="${end.x}" y2="${end.y}" stroke="rgba(65,58,74,0.10)" stroke-width="1"></line>
          <text x="${point.x}" y="${point.y}" fill="#6a6173" font-size="12" text-anchor="middle" dominant-baseline="middle">${label}</text>
        `;
      })
      .join("");

    const userPoints = polygonPoints(shiftVector(userVector, coreDimensionKeys), center, radius);
    const heroPoints = polygonPoints(shiftVector(heroVector, coreDimensionKeys), center, radius);

    return `
      <svg class="radar" viewBox="0 0 ${size} ${size}" role="img" aria-label="人格维度对比图">
        ${grid}
        ${axes}
        <polygon points="${heroPoints}" fill="rgba(230,126,100,0.18)" stroke="rgba(230,126,100,0.78)" stroke-width="2"></polygon>
        <polygon points="${userPoints}" fill="rgba(63,138,127,0.18)" stroke="rgba(63,138,127,0.84)" stroke-width="2"></polygon>
      </svg>
    `;
  }

  function shiftVector(vector, keys = dimensionKeys) {
    return keys.map((key) => ((vector[key] || 0) + 1) / 2);
  }

  function levelVector(value, keys = dimensionKeys) {
    return keys.map(() => value);
  }

  function polygonPoints(vector, center, radius) {
    return vector
      .map((value, index) => {
        const point = polarPoint(center, radius * value, angleFor(index));
        return `${point.x},${point.y}`;
      })
      .join(" ");
  }

  function angleFor(index) {
    return (-Math.PI / 2) + (index * 2 * Math.PI) / coreDimensionKeys.length;
  }

  function polarPoint(center, distance, angle) {
    return {
      x: round(center + Math.cos(angle) * distance, 2),
      y: round(center + Math.sin(angle) * distance, 2),
    };
  }

  function matchesSearch(hero, search) {
    if (!search) {
      return true;
    }

    const haystack = [
      hero.originalName,
      hero.name,
      hero.gameTitle,
      hero.gameTitleCn,
      ...hero.tags,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(search);
  }

  function pickHomePreview(heroes, count) {
    const buckets = [];
    const step = Math.max(1, Math.floor(heroes.length / count));
    for (let index = 0; index < heroes.length && buckets.length < count; index += step) {
      buckets.push(heroes[index]);
    }
    return buckets.slice(0, count);
  }

  function bindEvents() {
    document.querySelectorAll("[data-action='start-quiz']").forEach((button) => {
      button.addEventListener("click", startQuiz);
    });

    document.querySelectorAll("[data-action='show-gallery']").forEach((button) => {
      button.addEventListener("click", () => {
        state.showGallery = true;
        state.galleryLimit = 20;
        render();
        const searchInput = document.getElementById("gallerySearch");
        if (searchInput) {
          searchInput.focus();
        }
      });
    });

    document.querySelectorAll("[data-action='answer']").forEach((button) => {
      button.addEventListener("click", () => {
        const answerIndex = Number(button.getAttribute("data-index"));
        state.answers[state.currentQuestion] = answerIndex;

        if (state.currentQuestion === data.questions.length - 1) {
          finishQuiz();
          return;
        }

        state.currentQuestion += 1;
        render();
      });
    });

    document.querySelectorAll("[data-action='slider-answer']").forEach((input) => {
      input.addEventListener("input", (event) => {
        const question = data.questions[state.currentQuestion];
        const value = Number(event.target.value);
        state.answers[state.currentQuestion] = value;

        const valueNode = document.querySelector("[data-role='slider-value']");
        const numberNode = document.querySelector("[data-role='slider-number']");
        if (valueNode) {
          valueNode.textContent = sliderSummaryText(question, value);
        }
        if (numberNode) {
          numberNode.textContent = String(value);
        }
        saveState();
      });
    });

    document.querySelectorAll("[data-action='next-question']").forEach((button) => {
      button.addEventListener("click", () => {
        const question = data.questions[state.currentQuestion];
        if (question?.type === "slider" && getStoredAnswer(state.currentQuestion) === null) {
          state.answers[state.currentQuestion] = 0;
        }

        if (state.currentQuestion === data.questions.length - 1) {
          finishQuiz();
          return;
        }

        state.currentQuestion += 1;
        render();
      });
    });

    document.querySelectorAll("[data-action='prev-question']").forEach((button) => {
      button.addEventListener("click", () => {
        state.currentQuestion = Math.max(0, state.currentQuestion - 1);
        render();
      });
    });

    document.querySelectorAll("[data-action='go-home']").forEach((button) => {
      button.addEventListener("click", () => {
        state.view = "home";
        render();
      });
    });

    document.querySelectorAll("[data-action='restart-quiz']").forEach((button) => {
      button.addEventListener("click", startQuiz);
    });

    document.querySelectorAll("[data-action='copy-result']").forEach((button) => {
      button.addEventListener("click", copyResult);
    });

    document.querySelectorAll("[data-action='toggle-gallery']").forEach((button) => {
      button.addEventListener("click", () => {
        state.showGallery = !state.showGallery;
        if (state.showGallery) {
          state.galleryLimit = 20;
        }
        render();
      });
    });

    document.querySelectorAll("[data-action='load-more']").forEach((button) => {
      button.addEventListener("click", () => {
        state.galleryLimit += 20;
        render();
      });
    });

    const gallerySearch = document.getElementById("gallerySearch");
    if (gallerySearch) {
      gallerySearch.addEventListener("input", (event) => {
        state.gallerySearch = event.target.value;
        state.galleryLimit = 20;
        render();
      });
    }
  }

  function startQuiz() {
    state.view = "quiz";
    state.currentQuestion = 0;
    state.answers = [];
    state.result = null;
    render();
  }

  function finishQuiz() {
    state.result = computeQuizResult();
    state.view = "result";
    state.showGallery = false;
    state.galleryLimit = 20;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function copyResult() {
    if (!state.result?.top) {
      return;
    }

    const top = state.result.top;
    const topThree = state.result.ranked
      .slice(0, 3)
      .map((hero, index) => `${index + 1}. ${hero.originalName}（${hero.gameTitleCn || hero.gameTitle}）`)
      .join("\n");

    const text = [
      "我测到的 Gal 女主匹配结果：",
      `${top.originalName} / ${top.gameTitleCn || top.gameTitle}`,
      `匹配度：${top.matchPercent}%`,
      state.result.summary,
      "",
      "Top 3：",
      topThree,
    ].join("\n");

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          alert("结果文案已复制，可以直接发到群里。");
        })
        .catch(() => {
          window.prompt("复制失败了，手动复制下面这段：", text);
        });
      return;
    }

    window.prompt("手动复制下面这段结果文案：", text);
  }

  function saveState() {
    try {
      const snapshot = {
        view: state.view,
        currentQuestion: state.currentQuestion,
        answers: state.answers,
        showGallery: state.showGallery,
        gallerySearch: state.gallerySearch,
        galleryLimit: state.galleryLimit,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch (error) {
      return;
    }
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      const parsed = saved ? JSON.parse(saved) : null;
      if (parsed) {
        parsed.result = null;
      }
      return parsed;
    } catch (error) {
      return null;
    }
  }

  function round(value, digits) {
    const factor = 10 ** (digits || 0);
    return Math.round(value * factor) / factor;
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  brandButton?.addEventListener("click", () => {
    state.view = "home";
    render();
  });

  render();
})();

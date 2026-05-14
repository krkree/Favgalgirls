(function () {
  const data = window.__MATCH_SITE_DATA__;
  const app = document.getElementById("app");
  const brandButton = document.getElementById("brandButton");
  const STORAGE_KEY = "gal-match-keywords-v3";

  if (!data || !app) {
    return;
  }

  const dimensions = data.dimensions || [];
  const appearanceAxes = data.appearanceAxes || [];
  const questions = data.questions || [];
  const heroes = data.heroes || [];
  const dimensionKeys = dimensions.map((item) => item.key);
  const appearanceKeys = appearanceAxes.map((item) => item.key);
  const dimensionMap = new Map(dimensions.map((item) => [item.key, item]));
  const appearanceMap = new Map(appearanceAxes.map((item) => [item.key, item]));
  const questionKeywordMaps = questions.map(
    (question) => new Map((question.keywords || []).map((keyword) => [keyword.id, keyword])),
  );
  const userVectorMax = computeUserVectorMax("effects", dimensionKeys);
  const userAppearanceMax = computeUserVectorMax("appearanceEffects", appearanceKeys);
  const homePreview = pickRandomHomePreview(heroes, 8);

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
  if (state.view === "result" && allQuestionsCompleted()) {
    state.result = computeQuizResult();
  }

  function zeroVector() {
    return Object.fromEntries(dimensionKeys.map((key) => [key, 0]));
  }

  function zeroAppearanceVector() {
    return Object.fromEntries(appearanceKeys.map((key) => [key, 0]));
  }

  function getDimension(key) {
    return dimensionMap.get(key);
  }

  function getAppearanceAxis(key) {
    return appearanceMap.get(key);
  }

  function getQuestionSelection(questionIndex) {
    const answer = state.answers[questionIndex];
    return Array.isArray(answer) ? [...answer] : [];
  }

  function allQuestionsCompleted() {
    return questions.every((question, index) => {
      const selected = getQuestionSelection(index);
      return selected.length >= (question.minSelections || 0);
    });
  }

  function computeUserVectorMax(fieldName, keys) {
    const totals = Object.fromEntries(keys.map((key) => [key, 0]));

    for (const question of questions) {
      const keywords = question.keywords || [];
      const limit = Math.min(question.maxSelections || keywords.length, keywords.length);
      for (const key of keys) {
        const values = keywords
          .map((keyword) => Math.abs((keyword[fieldName] && keyword[fieldName][key]) || 0))
          .sort((a, b) => b - a)
          .slice(0, limit);
        totals[key] += values.reduce((sum, value) => sum + value, 0);
      }
    }

    return totals;
  }

  function normalizeUserVector(rawVector) {
    const normalized = {};
    for (const key of dimensionKeys) {
      const divisor = userVectorMax[key] || 1;
      normalized[key] = round(clamp(rawVector[key] / divisor, -1, 1), 3);
    }
    return normalized;
  }

  function normalizeAppearanceVector(rawVector) {
    const normalized = {};
    for (const key of appearanceKeys) {
      const divisor = userAppearanceMax[key] || 1;
      normalized[key] = round(clamp(rawVector[key] / divisor, -1, 1), 3);
    }
    return normalized;
  }

  function computeQuizResult() {
    const rawVector = zeroVector();
    const rawAppearanceVector = zeroAppearanceVector();

    questions.forEach((question, questionIndex) => {
      const selected = getQuestionSelection(questionIndex);
      const keywordMap = questionKeywordMaps[questionIndex];

      selected.forEach((keywordId) => {
        const keyword = keywordMap.get(keywordId);
        if (!keyword) {
          return;
        }
        for (const key of dimensionKeys) {
          rawVector[key] += (keyword.effects && keyword.effects[key]) || 0;
        }
        for (const key of appearanceKeys) {
          rawAppearanceVector[key] += (keyword.appearanceEffects && keyword.appearanceEffects[key]) || 0;
        }
      });
    });

    const userVector = normalizeUserVector(rawVector);
    const userAppearanceVector = normalizeAppearanceVector(rawAppearanceVector);
    const ranked = heroes
      .map((hero) => {
        const score = similarity(userVector, hero.vector, userAppearanceVector, hero.appearanceProfile || {});
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
      userAppearanceVector,
      top,
      ranked,
      summary: buildUserSummary(userVector),
      reasons: buildMatchReasons(userVector, userAppearanceVector, top),
    };
  }

  function similarity(userVector, heroVector, userAppearanceVector, heroAppearanceProfile) {
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
    let appearanceDistance = 0;
    let appearanceWeightTotal = 0;
    for (const key of appearanceKeys) {
      const userValue = userAppearanceVector[key] || 0;
      const heroValue = heroAppearanceProfile[key] || 0;
      const weight = getAppearanceAxis(key)?.weight || 0;
      appearanceDistance += (Math.abs(userValue - heroValue) / 2) * weight;
      appearanceWeightTotal += weight;
    }
    const appearanceScore = appearanceWeightTotal
      ? 1 - appearanceDistance / appearanceWeightTotal
      : 0.5;

    return round((distanceScore * 0.72) + (directionalScore * 0.14) + (appearanceScore * 0.14), 4);
  }

  function buildUserSummary(userVector) {
    const sorted = [...dimensionKeys]
      .map((key) => ({ key, value: userVector[key] || 0 }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
    const labels = sorted.slice(0, 3).map((item) => profilePhrase(item.key, item.value));
    return `你更容易被 ${labels.join(" / ")} 这三种频率击中。`;
  }

  function buildMatchReasons(userVector, userAppearanceVector, hero) {
    if (!hero) {
      return [];
    }

    const coreReasons = [...dimensionKeys]
      .map((key) => ({
        key,
        difference: Math.abs((userVector[key] || 0) - (hero.vector[key] || 0)),
        userValue: userVector[key] || 0,
      }))
      .sort((a, b) => a.difference - b.difference)
      .slice(0, 3)
      .map((item) => axisReason(item.key, item.userValue, hero));

    const appearanceReason = [...appearanceKeys]
      .map((key) => ({
        key,
        difference: Math.abs((userAppearanceVector[key] || 0) - ((hero.appearanceProfile && hero.appearanceProfile[key]) || 0)),
        userValue: userAppearanceVector[key] || 0,
      }))
      .sort((a, b) => a.difference - b.difference)[0];

    if (appearanceReason && Math.abs(appearanceReason.userValue) > 0.12) {
      coreReasons.push(appearanceAxisReason(appearanceReason.key, appearanceReason.userValue, hero));
    }
    return coreReasons;
  }

  function axisReason(key, userValue, hero) {
    if (key === "social") {
      return userValue >= 0
        ? `你会被更主动、更有回应感的相处方式吸引，${hero.originalName} 的社交节奏更容易和你对上。`
        : `你更吃慢热型靠近，${hero.originalName} 这种不需要一直热闹也能留下存在感的频率会更合你胃口。`;
    }
    if (key === "warmth") {
      return userValue >= 0
        ? `你在关系里更看重温度和被接住的感觉，所以 ${hero.originalName} 身上的柔软感会很加分。`
        : `你会被带一点克制和疏离感的人吸住，${hero.originalName} 这种不过度外露的气质更容易让你上头。`;
    }
    if (key === "energy") {
      return userValue >= 0
        ? `你偏爱鲜活、有互动感的恋爱节奏，${hero.originalName} 的活力会更容易把你带进去。`
        : `你更喜欢安静、稳定、慢慢沉进去的陪伴方式，${hero.originalName} 的节奏会让你觉得舒服。`;
    }
    if (key === "dream") {
      return userValue >= 0
        ? `你会对带点梦感和故事感的人特别有反应，${hero.originalName} 正好有这种像剧情开始的味道。`
        : `你更吃清醒、踏实、能落地的相处方式，所以 ${hero.originalName} 的理性感会更对你胃口。`;
    }
    if (key === "mystery") {
      return userValue >= 0
        ? `你对“越靠近越想继续了解”的神秘感反应很强，${hero.originalName} 在这条线上很容易击中你。`
        : `你更喜欢表达直接、不需要过度猜测的人，${hero.originalName} 的打开方式会让你轻松很多。`;
    }
    if (key === "maturity") {
      return userValue >= 0
        ? `你明显会被更稳、更有分寸感的气质吸引，所以 ${hero.originalName} 的成熟感会很加分。`
        : `你更容易被偏青涩、偏少女感的心动击中，${hero.originalName} 刚好落在这个区间。`;
    }
    return `${hero.originalName} 和你的这条维度频率很接近。`;
  }

  function appearanceAxisReason(key, userValue, hero) {
    if (key === "hair_length") {
      return userValue >= 0
        ? `${hero.originalName} 的长发观感更贴近你的外观偏好。`
        : `${hero.originalName} 这种更利落的发型感会更容易第一眼戳中你。`;
    }
    if (key === "hair_tone") {
      return userValue >= 0
        ? `你会更容易被浅亮发色吸住，而 ${hero.originalName} 正好贴近这条线。`
        : `你更吃深色头发的耐看感，${hero.originalName} 在外观上会更顺眼。`;
    }
    if (key === "legwear") {
      return userValue >= 0
        ? `${hero.originalName} 的腿部造型更贴近你偏爱的丝袜长袜感。`
        : `${hero.originalName} 更接近你喜欢的轻装光腿感。`;
    }
    if (key === "ornament") {
      return userValue >= 0
        ? `${hero.originalName} 身上的甜系点缀感，会更对你的外观口味。`
        : `${hero.originalName} 这种更简洁的装饰度，会更合你的审美。`;
    }
    if (key === "visual_maturity") {
      return userValue >= 0
        ? `${hero.originalName} 的外观气质更偏姐姐感，这一点会很加分。`
        : `${hero.originalName} 更贴近你偏爱的少女感滤镜。`;
    }
    return `${hero.originalName} 的外观气质和你的偏好也很接近。`;
  }

  function profilePhrase(key, value) {
    const dimension = getDimension(key);
    if (!dimension) {
      return key;
    }
    return value >= 0 ? dimension.high : dimension.low;
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
    if (state.currentQuestion >= questions.length) {
      state.currentQuestion = Math.max(0, questions.length - 1);
    }

    state.answers = questions.map((question, index) => {
      const previous = Array.isArray(state.answers[index]) ? state.answers[index] : [];
      const keywordMap = questionKeywordMaps[index];
      const unique = [];
      for (const keywordId of previous) {
        if (!keywordMap.has(keywordId) || unique.includes(keywordId)) {
          continue;
        }
        unique.push(keywordId);
        if (unique.length >= (question.maxSelections || unique.length)) {
          break;
        }
      }
      return unique;
    });

    if (typeof state.gallerySearch !== "string") {
      state.gallerySearch = "";
    }
    if (!Number.isFinite(state.galleryLimit) || state.galleryLimit < 20) {
      state.galleryLimit = 20;
    }

    if (state.view === "result" && !allQuestionsCompleted()) {
      state.view = "home";
      state.result = null;
    }
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
          <h1 class="hero-title">来挑关键词，<br>选你的专属 Galgame 老婆！</h1>
          <p class="hero-subtitle">
            不再做俗套场景题。每一轮只要从漂浮词池里挑出最戳你的几个词，
            我们会把它们折成六维心动图，再和整套女主库逐个对频。
          </p>
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
            <h2 class="section-title">现在的匹配怎么做</h2>
            <div class="section-note">前 6 轮看心动频率，后 5 轮补外观偏好，最后一起和女主库做综合匹配。</div>
          </div>
        </div>
        <div class="pill-row">
          <span class="pill">关键词比场景题更直观</span>
          <span class="pill">六维向量只看人格频率</span>
          <span class="pill">外观题重新加入</span>
        </div>
      </section>

      ${renderGallerySection(true)}
    `;
  }

  function renderQuiz() {
    const question = questions[state.currentQuestion];
    const selected = getQuestionSelection(state.currentQuestion);
    const progress = ((state.currentQuestion + 1) / questions.length) * 100;
    const remainingHint = selected.length >= question.minSelections
      ? `已选 ${selected.length} 个，还可以再挑 ${Math.max((question.maxSelections || 0) - selected.length, 0)} 个`
      : `至少选 ${question.minSelections} 个，当前已选 ${selected.length} 个`;
    const eyebrow = question.group === "appearance"
      ? `外观题 ${String(state.currentQuestion + 1).padStart(2, "0")}`
      : `关键词池 ${String(state.currentQuestion + 1).padStart(2, "0")}`;

    return `
      <section class="panel question-panel keyword-panel">
        <div class="question-top">
          <div class="progress-shell">
            <div class="progress-bar" style="width:${progress}%"></div>
          </div>
          <div class="question-index">${state.currentQuestion + 1} / ${questions.length}</div>
        </div>
        <div class="question-body">
          <p class="eyebrow">${eyebrow}</p>
          <h2 class="question-title">${escapeHtml(question.title)}</h2>
          <p class="question-note">${escapeHtml(question.hint || "")}</p>
          <div class="keyword-toolbar">
            <span class="pill">至少 ${question.minSelections} 个</span>
            <span class="pill">最多 ${question.maxSelections} 个</span>
            <span class="pill">${escapeHtml(remainingHint)}</span>
          </div>
          <div class="keyword-cloud">
            ${question.keywords.map((keyword, index) => renderKeywordChip(keyword, index, selected.includes(keyword.id), selected.length >= question.maxSelections)).join("")}
          </div>
        </div>
        <div class="question-actions">
          <button class="button button-ghost" data-action="go-home" type="button">返回首页</button>
          <button class="button button-secondary" data-action="prev-question" type="button" ${state.currentQuestion === 0 ? "disabled" : ""}>上一轮</button>
          <button class="button button-primary" data-action="next-question" type="button" ${selected.length < question.minSelections ? "disabled" : ""}>
            ${state.currentQuestion === questions.length - 1 ? "查看结果" : "下一轮"}
          </button>
        </div>
      </section>
    `;
  }

  function renderKeywordChip(keyword, index, selected, limitReached) {
    const offsetX = ((index * 17) % 9) - 4;
    const offsetY = ((index * 13) % 7) - 3;
    const rotate = ((index * 11) % 7) - 3;
    const duration = 5.8 + (index % 5) * 0.8;
    const delay = (index % 6) * 0.35;
    const disabled = !selected && limitReached ? " disabled" : "";
    return `
      <button
        class="keyword-chip${selected ? " is-selected" : ""}"
        data-action="toggle-keyword"
        data-keyword-id="${escapeHtml(keyword.id)}"
        type="button"
        style="--dx:${offsetX}px; --dy:${offsetY}px; --spin:${rotate}deg; --float-duration:${duration}s; --float-delay:${delay}s"
        ${disabled}
      >
        <span class="keyword-cue">${escapeHtml(keyword.cue)}</span>
        <span class="keyword-text">${escapeHtml(keyword.text)}</span>
      </button>
    `;
  }

  function renderResult() {
    if (!state.result?.top) {
      return "";
    }

    const top = state.result.top;
    const topMatches = state.result.ranked.slice(0, 8);
    const userVectorChips = dimensionKeys
      .map((key) => {
        const dimension = getDimension(key);
        const value = state.result.userVector[key] || 0;
        const label = value >= 0 ? dimension.high : dimension.low;
        return `<span class="pill">${escapeHtml(dimension.name)}：${escapeHtml(label)}</span>`;
      })
      .join("");
    const appearanceChips = appearanceKeys
      .map((key) => {
        const axis = getAppearanceAxis(key);
        const value = state.result.userAppearanceVector[key] || 0;
        if (Math.abs(value) < 0.12) {
          return "";
        }
        const label = value >= 0 ? axis.high : axis.low;
        return `<span class="pill">${escapeHtml(axis.name)}：${escapeHtml(label)}</span>`;
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

        <div class="pill-row result-pills">${userVectorChips}${appearanceChips}</div>

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
                  ${state.result.reasons.map((reason) => `
                    <div class="reason-item">
                      <span class="reason-dot"></span>
                      <span>${escapeHtml(reason)}</span>
                    </div>
                  `).join("")}
                </div>
              </div>
              <div class="mini-panel">
                <h4 class="mini-title">六维坐标对比</h4>
                ${renderRadar(state.result.userVector, top.vector)}
              </div>
            </div>

            <div class="result-actions">
              <button class="button button-primary" data-action="restart-quiz" type="button">重测一次</button>
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
            <div class="section-note">不是只有一个答案。下面这些，也都和你的六维心动频率很接近。</div>
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
    const filtered = heroes.filter((hero) => matchesSearch(hero, search));
    const visibleHeroes = shouldShow ? filtered.slice(0, state.galleryLimit) : [];

    return `
      <section class="panel section-panel">
        <div class="section-head">
          <div>
            <h2 class="section-title">全部可匹配女主</h2>
            <div class="section-note">这里也可以直接当图鉴看。支持按角色名、作品名、标签搜索。</div>
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
        const points = polygonPoints(levelVector(level), center, radius);
        return `<polygon points="${points}" fill="none" stroke="rgba(65,58,74,0.10)" stroke-width="1"></polygon>`;
      })
      .join("");

    const axes = dimensionKeys
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

    const userPoints = polygonPoints(shiftVector(userVector), center, radius);
    const heroPoints = polygonPoints(shiftVector(heroVector), center, radius);

    return `
      <svg class="radar" viewBox="0 0 ${size} ${size}" role="img" aria-label="六维对比图">
        ${grid}
        ${axes}
        <polygon points="${heroPoints}" fill="rgba(230,126,100,0.18)" stroke="rgba(230,126,100,0.78)" stroke-width="2"></polygon>
        <polygon points="${userPoints}" fill="rgba(63,138,127,0.18)" stroke="rgba(63,138,127,0.84)" stroke-width="2"></polygon>
      </svg>
    `;
  }

  function shiftVector(vector) {
    return dimensionKeys.map((key) => ((vector[key] || 0) + 1) / 2);
  }

  function levelVector(value) {
    return dimensionKeys.map(() => value);
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
    return (-Math.PI / 2) + (index * 2 * Math.PI) / dimensionKeys.length;
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
      hero.displayName,
      hero.gameTitle,
      hero.gameTitleCn,
      ...hero.tags,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(search);
  }

  function pickRandomHomePreview(list, count) {
    const pool = [...list];
    for (let index = pool.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(Math.random() * (index + 1));
      [pool[index], pool[swapIndex]] = [pool[swapIndex], pool[index]];
    }
    return pool.slice(0, count);
  }

  function toggleKeyword(keywordId) {
    const question = questions[state.currentQuestion];
    const selected = getQuestionSelection(state.currentQuestion);
    const exists = selected.includes(keywordId);

    if (exists) {
      state.answers[state.currentQuestion] = selected.filter((item) => item !== keywordId);
      render();
      return;
    }

    if (selected.length >= question.maxSelections) {
      return;
    }

    selected.push(keywordId);
    state.answers[state.currentQuestion] = selected;
    render();
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
        document.getElementById("gallerySearch")?.focus();
      });
    });

    document.querySelectorAll("[data-action='toggle-keyword']").forEach((button) => {
      button.addEventListener("click", () => {
        toggleKeyword(button.getAttribute("data-keyword-id"));
      });
    });

    document.querySelectorAll("[data-action='next-question']").forEach((button) => {
      button.addEventListener("click", () => {
        const question = questions[state.currentQuestion];
        if (getQuestionSelection(state.currentQuestion).length < question.minSelections) {
          return;
        }
        if (state.currentQuestion === questions.length - 1) {
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
    state.answers = questions.map(() => []);
    state.result = null;
    render();
  }

  function finishQuiz() {
    if (!allQuestionsCompleted()) {
      return;
    }
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
      .map((hero, index) => `${index + 1}. ${hero.displayName || hero.originalName}（${hero.gameTitleCn || hero.gameTitle}）`)
      .join("\n");

    const text = [
      "我的 Gal 女主匹配结果：",
      `${top.displayName || top.originalName} / ${top.gameTitleCn || top.gameTitle}`,
      `匹配度：${top.matchPercent}%`,
      state.result.summary,
      "",
      "Top 3：",
      topThree,
    ].join("\n");

    navigator.clipboard?.writeText(text).then(() => {
      window.alert("结果文案已复制。");
    }).catch(() => {
      window.alert(text);
    });
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

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function round(value, precision = 3) {
    const base = 10 ** precision;
    return Math.round(value * base) / base;
  }

  brandButton?.addEventListener("click", () => {
    state.view = "home";
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  render();
}());

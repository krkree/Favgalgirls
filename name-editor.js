(function () {
  const data = window.__NAME_EDITOR_DATA__;
  const app = document.getElementById("editorApp");
  const homeLink = document.getElementById("homeLink");
  const STORAGE_KEY = "gal-name-editor-draft-v1";

  if (!data || !app) {
    return;
  }

  const draft = loadDraft();
  const state = {
    search: "",
    status: "all",
    onlyMissingCn: false,
    onlyChanged: false,
    limit: 30,
    edits: buildInitialEdits(data.rows, draft),
  };

  function buildInitialEdits(rows, draftEdits) {
    const edits = {};

    for (const row of rows) {
      edits[row.heroId] = {
        name_cn: row.currentOverride?.name_cn || "",
        name_jp: row.currentOverride?.name_jp || "",
        name_en: row.currentOverride?.name_en || "",
      };
    }

    if (draftEdits && typeof draftEdits === "object") {
      for (const [heroId, value] of Object.entries(draftEdits)) {
        if (!edits[heroId] || !value || typeof value !== "object") {
          continue;
        }
        edits[heroId] = {
          name_cn: value.name_cn || "",
          name_jp: value.name_jp || "",
          name_en: value.name_en || "",
        };
      }
    }

    return edits;
  }

  function getRowEdit(row) {
    return state.edits[row.heroId] || {
      name_cn: "",
      name_jp: "",
      name_en: "",
    };
  }

  function isChanged(row) {
    const current = row.currentOverride || {};
    const edit = getRowEdit(row);
    return ["name_cn", "name_jp", "name_en"].some(
      (key) => (current[key] || "") !== (edit[key] || ""),
    );
  }

  function hasAnyValue(edit) {
    return Boolean((edit.name_cn || "").trim() || (edit.name_jp || "").trim() || (edit.name_en || "").trim());
  }

  function exportOverrides() {
    const output = {};

    for (const row of data.rows) {
      const edit = getRowEdit(row);
      if (!hasAnyValue(edit)) {
        continue;
      }
      output[row.heroId] = {
        name_cn: edit.name_cn.trim() || undefined,
        name_jp: edit.name_jp.trim() || undefined,
        name_en: edit.name_en.trim() || undefined,
      };

      Object.keys(output[row.heroId]).forEach((key) => {
        if (!output[row.heroId][key]) {
          delete output[row.heroId][key];
        }
      });
    }

    return output;
  }

  function filteredRows() {
    const search = state.search.trim().toLowerCase();
    return data.rows.filter((row) => {
      const edit = getRowEdit(row);
      if (state.status !== "all" && (row.reviewStatus || "unknown") !== state.status) {
        return false;
      }
      if (state.onlyMissingCn && (edit.name_cn || "").trim()) {
        return false;
      }
      if (state.onlyChanged && !isChanged(row)) {
        return false;
      }
      if (!search) {
        return true;
      }

      const haystack = [
        row.heroId,
        row.gameTitleCn,
        row.gameTitle,
        row.originalName,
        row.englishName,
        row.proposedNameCn,
        row.proposedNameJp,
        edit.name_cn,
        edit.name_jp,
        edit.name_en,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return haystack.includes(search);
    });
  }

  function summaryCounts() {
    const rows = filteredRows();
    const changed = data.rows.filter((row) => isChanged(row)).length;
    const filledCn = data.rows.filter((row) => (getRowEdit(row).name_cn || "").trim()).length;
    return {
      visible: rows.length,
      changed,
      filledCn,
      exported: Object.keys(exportOverrides()).length,
    };
  }

  function render() {
    saveDraft();
    const rows = filteredRows();
    const visibleRows = rows.slice(0, state.limit);
    const counts = summaryCounts();

    app.innerHTML = `
      <div class="editor-layout">
        <section class="panel editor-toolbar">
          <div class="editor-toolbar-grid">
            <div class="editor-controls">
              <div>
                <h1 class="section-title">中文名补充与修改</h1>
                <div class="editor-hint">
                  这里不会直接写回磁盘文件。你可以在浏览器里筛选、编辑、批量采用候选，最后导出新的
                  <code>character_name_overrides.json</code>。
                </div>
              </div>

              <input id="searchInput" class="editor-input" type="search" placeholder="搜索角色、作品、候选中文名、Hero ID" value="${escapeHtml(state.search)}">

              <div class="editor-filter-row">
                <select id="statusSelect" class="editor-select">
                  ${renderStatusOptions()}
                </select>
                <label class="editor-check">
                  <input id="missingCnCheck" type="checkbox" ${state.onlyMissingCn ? "checked" : ""}>
                  只看还没填中文名
                </label>
                <label class="editor-check">
                  <input id="changedCheck" type="checkbox" ${state.onlyChanged ? "checked" : ""}>
                  只看已修改
                </label>
              </div>

              <div class="editor-action-row">
                <button class="button button-primary" data-action="adopt-exact" type="button">一键采用全部 Exact 候选</button>
                <button class="button button-secondary" data-action="copy-json" type="button">复制导出 JSON</button>
                <button class="button button-secondary" data-action="download-json" type="button">下载 JSON</button>
                <button class="button button-ghost" data-action="reset-draft" type="button">撤销浏览器草稿</button>
              </div>

              <div class="editor-import-row">
                <input id="importFile" class="editor-file" type="file" accept=".json,application/json">
                <button class="button button-ghost" data-action="import-file" type="button">导入现有 JSON</button>
              </div>
            </div>

            <div class="editor-stats">
              <article class="editor-stat">
                <span class="stat-label">当前可见</span>
                <strong>${counts.visible}</strong>
              </article>
              <article class="editor-stat">
                <span class="stat-label">已修改</span>
                <strong>${counts.changed}</strong>
              </article>
              <article class="editor-stat">
                <span class="stat-label">已填中文名</span>
                <strong>${counts.filledCn}</strong>
              </article>
              <article class="editor-stat">
                <span class="stat-label">导出条目</span>
                <strong>${counts.exported}</strong>
              </article>
            </div>
          </div>
        </section>

        <section class="panel section-panel">
          <div class="editor-pillset">
            ${renderSummaryPills()}
          </div>
        </section>

        <section class="editor-list">
          ${visibleRows.length ? visibleRows.map(renderRowCard).join("") : `<div class="panel editor-empty">当前筛选条件下没有角色。</div>`}
        </section>

        ${
          rows.length > visibleRows.length
            ? `
              <div class="hero-actions">
                <button class="button button-secondary" data-action="load-more" type="button">继续加载更多</button>
              </div>
            `
            : ""
        }
      </div>
    `;

    bindEvents();
  }

  function renderStatusOptions() {
    const labels = {
      all: "全部状态",
      exact: "Exact",
      fuzzy: "Fuzzy",
      unmatched_character: "Unmatched Character",
      no_subject_match: "No Subject Match",
      unknown: "Unknown",
    };

    const seen = new Set(["all"]);
    const options = [`<option value="all"${state.status === "all" ? " selected" : ""}>${labels.all}</option>`];

    for (const status of Object.keys(data.summary)) {
      seen.add(status);
      options.push(
        `<option value="${status}"${state.status === status ? " selected" : ""}>${labels[status] || status} (${data.summary[status]})</option>`,
      );
    }

    for (const status of Object.keys(labels)) {
      if (seen.has(status) || status === "all") {
        continue;
      }
      options.push(
        `<option value="${status}"${state.status === status ? " selected" : ""}>${labels[status]}</option>`,
      );
    }

    return options.join("");
  }

  function renderSummaryPills() {
    const labels = {
      exact: "可直接采用",
      fuzzy: "模糊候选",
      unmatched_character: "作品命中但角色未对上",
      no_subject_match: "Bangumi 作品未对上",
    };

    return Object.entries(data.summary)
      .map(([key, value]) => `<span class="pill">${labels[key] || key}：${value}</span>`)
      .join("");
  }

  function renderRowCard(row) {
    const edit = getRowEdit(row);
    const changedClass = isChanged(row) ? " is-changed" : "";
    const candidateLabel = row.proposedNameCn
      ? `${row.proposedNameCn}${row.proposedNameJp ? ` / ${row.proposedNameJp}` : ""}`
      : "暂无 Bangumi 候选";

    return `
      <article class="panel editor-card${changedClass}">
        <div class="editor-cover">
          ${row.image ? `<img src="${row.image}" alt="${escapeHtml(row.originalName || row.englishName)}" loading="lazy">` : ""}
        </div>
        <div>
          <div class="editor-head">
            <div>
              <h3 class="editor-title">${escapeHtml(edit.name_cn || row.originalName || row.englishName)}</h3>
              <div class="editor-subtitle">${escapeHtml(row.originalName || "")}${row.englishName ? ` / ${escapeHtml(row.englishName)}` : ""}</div>
              <div class="editor-meta">${escapeHtml(row.gameTitleCn || row.gameTitle)}${row.gameTitleCn ? ` / ${escapeHtml(row.gameTitle)}` : ""}</div>
            </div>
            <span class="editor-status status-${escapeHtml(row.reviewStatus || "unknown")}">${escapeHtml(row.reviewStatus || "unknown")}</span>
          </div>

          <div class="editor-grid">
            <section class="editor-box">
              <h4>当前记录</h4>
              <p>中文名：${escapeHtml(row.currentOverride?.name_cn || "未填写")}</p>
              <p>日文名：${escapeHtml(row.currentOverride?.name_jp || "未填写")}</p>
              <p>英文名：${escapeHtml(row.currentOverride?.name_en || "未填写")}</p>
            </section>
            <section class="editor-box">
              <h4>Bangumi 候选</h4>
              <p>${escapeHtml(candidateLabel)}</p>
              <p>候选数：${row.candidateCount || 0}</p>
              <div class="editor-card-actions">
                ${row.suggestedOverride ? `<button class="button button-secondary" data-action="adopt-one" data-hero-id="${row.heroId}" type="button">采用候选</button>` : ""}
                ${row.vndbCharacterUrl ? `<a class="button button-ghost editor-link" href="${row.vndbCharacterUrl}" target="_blank" rel="noreferrer">VNDB</a>` : ""}
                ${row.bangumiCharacterUrl ? `<a class="button button-ghost editor-link" href="${row.bangumiCharacterUrl}" target="_blank" rel="noreferrer">Bangumi 角色页</a>` : ""}
                ${row.bangumiCharactersUrl ? `<a class="button button-ghost editor-link" href="${row.bangumiCharactersUrl}" target="_blank" rel="noreferrer">Bangumi 作品角色列表</a>` : ""}
              </div>
            </section>
          </div>

          <div class="editor-form">
            <div class="editor-form-grid">
              <div class="editor-field">
                <label for="cn-${row.heroId}">中文名</label>
                <input id="cn-${row.heroId}" class="editor-input" data-field="name_cn" data-hero-id="${row.heroId}" value="${escapeHtml(edit.name_cn)}">
              </div>
              <div class="editor-field">
                <label for="jp-${row.heroId}">日文名</label>
                <input id="jp-${row.heroId}" class="editor-input" data-field="name_jp" data-hero-id="${row.heroId}" value="${escapeHtml(edit.name_jp)}">
              </div>
              <div class="editor-field">
                <label for="en-${row.heroId}">英文名</label>
                <input id="en-${row.heroId}" class="editor-input" data-field="name_en" data-hero-id="${row.heroId}" value="${escapeHtml(edit.name_en)}">
              </div>
            </div>

            <div class="editor-card-actions">
              <button class="button button-ghost" data-action="clear-one" data-hero-id="${row.heroId}" type="button">清空这条</button>
              ${isChanged(row) ? `<span class="pill">这条有未导出的改动</span>` : ""}
              <span class="pill">Hero ID：${escapeHtml(row.heroId)}</span>
            </div>
          </div>
        </div>
      </article>
    `;
  }

  function bindEvents() {
    document.getElementById("searchInput")?.addEventListener("input", (event) => {
      state.search = event.target.value;
      state.limit = 30;
      render();
    });

    document.getElementById("statusSelect")?.addEventListener("change", (event) => {
      state.status = event.target.value;
      state.limit = 30;
      render();
    });

    document.getElementById("missingCnCheck")?.addEventListener("change", (event) => {
      state.onlyMissingCn = event.target.checked;
      state.limit = 30;
      render();
    });

    document.getElementById("changedCheck")?.addEventListener("change", (event) => {
      state.onlyChanged = event.target.checked;
      state.limit = 30;
      render();
    });

    document.querySelectorAll("[data-field]").forEach((input) => {
      input.addEventListener("input", (event) => {
        const heroId = event.target.getAttribute("data-hero-id");
        const field = event.target.getAttribute("data-field");
        if (!heroId || !field || !state.edits[heroId]) {
          return;
        }
        state.edits[heroId][field] = event.target.value;
        saveDraft();
      });

      input.addEventListener("change", () => {
        render();
      });
    });

    document.querySelectorAll("[data-action='adopt-one']").forEach((button) => {
      button.addEventListener("click", () => {
        const heroId = button.getAttribute("data-hero-id");
        const row = data.rows.find((item) => item.heroId === heroId);
        if (!row?.suggestedOverride || !state.edits[heroId]) {
          return;
        }
        state.edits[heroId] = {
          name_cn: row.suggestedOverride.name_cn || "",
          name_jp: row.suggestedOverride.name_jp || "",
          name_en: row.suggestedOverride.name_en || "",
        };
        render();
      });
    });

    document.querySelectorAll("[data-action='clear-one']").forEach((button) => {
      button.addEventListener("click", () => {
        const heroId = button.getAttribute("data-hero-id");
        if (!heroId || !state.edits[heroId]) {
          return;
        }
        state.edits[heroId] = { name_cn: "", name_jp: "", name_en: "" };
        render();
      });
    });

    document.querySelector("[data-action='adopt-exact']")?.addEventListener("click", () => {
      for (const row of data.rows) {
        if (!row.suggestedOverride || row.reviewStatus !== "exact") {
          continue;
        }
        state.edits[row.heroId] = {
          name_cn: row.suggestedOverride.name_cn || "",
          name_jp: row.suggestedOverride.name_jp || "",
          name_en: row.suggestedOverride.name_en || "",
        };
      }
      render();
    });

    document.querySelector("[data-action='copy-json']")?.addEventListener("click", async () => {
      const text = JSON.stringify(exportOverrides(), null, 2);
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          alert("已复制导出 JSON。");
        } else {
          window.prompt("手动复制下面的 JSON：", text);
        }
      } catch (error) {
        window.prompt("手动复制下面的 JSON：", text);
      }
    });

    document.querySelector("[data-action='download-json']")?.addEventListener("click", () => {
      const text = JSON.stringify(exportOverrides(), null, 2);
      const blob = new Blob([text], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "character_name_overrides.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    });

    document.querySelector("[data-action='reset-draft']")?.addEventListener("click", () => {
      localStorage.removeItem(STORAGE_KEY);
      state.edits = buildInitialEdits(data.rows, null);
      render();
    });

    document.querySelector("[data-action='load-more']")?.addEventListener("click", () => {
      state.limit += 30;
      render();
    });

    document.querySelector("[data-action='import-file']")?.addEventListener("click", async () => {
      const input = document.getElementById("importFile");
      const file = input?.files?.[0];
      if (!file) {
        alert("先选择一个 JSON 文件。");
        return;
      }
      try {
        const text = await file.text();
        const imported = JSON.parse(text);
        applyImportedOverrides(imported);
        render();
      } catch (error) {
        alert("这个文件不是有效的 overrides JSON。");
      }
    });
  }

  function applyImportedOverrides(imported) {
    if (!imported || typeof imported !== "object") {
      return;
    }
    for (const [heroId, value] of Object.entries(imported)) {
      if (!state.edits[heroId] || !value || typeof value !== "object") {
        continue;
      }
      state.edits[heroId] = {
        name_cn: value.name_cn || "",
        name_jp: value.name_jp || "",
        name_en: value.name_en || "",
      };
    }
  }

  function saveDraft() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.edits));
  }

  function loadDraft() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  homeLink?.addEventListener("click", () => {
    window.location.href = "./index.html";
  });

  render();
})();

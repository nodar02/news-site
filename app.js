(() => {
  // =========================
  // CONFIG
  // =========================
  const API_URL = "https://newsdata.io/api/1/latest?apikey=pub_bc6b57ef085c400885234615cc429323&country=am,ge,ir,az";
  const PAGE_SIZE = 9; // how many cards to show per fetch (client-side slice)

  // =========================
  // DOM
  // =========================
  const els = {
    grid: document.getElementById("newsGrid"),
    skeleton: document.getElementById("skeleton"),
    empty: document.getElementById("emptyState"),
    error: document.getElementById("errorState"),
    errorText: document.getElementById("errorText"),
    loadMoreBtn: document.getElementById("loadMoreBtn"),
    retryBtn: document.getElementById("retryBtn"),
    clearBtn: document.getElementById("clearBtn"),
    refreshBtn: document.getElementById("refreshBtn"),
    themeBtn: document.getElementById("themeBtn"),
    statusLabel: document.getElementById("statusLabel"),
    countLabel: document.getElementById("countLabel"),

    search: document.getElementById("searchInput"),
    country: document.getElementById("countrySelect"),
    language: document.getElementById("languageSelect"),
    category: document.getElementById("categorySelect"),
    chips: document.getElementById("activeChips"),
  };

  // =========================
  // STATE
  // =========================
  const state = {
    all: [],          // all loaded articles (across pages)
    visible: [],      // filtered + rendered list
    nextPage: null,   // pagination token
    isLoading: false,
    filters: {
      q: "",
      country: "",
      language: "",
      category: "",
    },
  };

  // =========================
  // THEME
  // =========================
  const THEME_KEY = "newspulse_theme";
  function loadTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") {
      document.documentElement.setAttribute("data-theme", saved);
    } else {
      document.documentElement.setAttribute("data-theme", "dark");
    }
  }
  function toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem(THEME_KEY, next);
  }

  // =========================
  // HELPERS
  // =========================
  const safeText = (v) => (typeof v === "string" ? v : "");
  const uniq = (arr) => Array.from(new Set(arr.filter(Boolean)));

  function setStatus(text) {
    els.statusLabel.textContent = text;
  }

  function show(el) { el.hidden = false; }
  function hide(el) { el.hidden = true; }

  function renderSkeleton(count = 9) {
    els.skeleton.innerHTML = "";
    for (let i = 0; i < count; i++) {
      const d = document.createElement("div");
      d.className = "sk";
      els.skeleton.appendChild(d);
    }
  }

  function parsePubDate(article) {
    // API example: "2026-01-30 09:40:00" + pubDateTZ:"UTC"
    const raw = safeText(article?.pubDate);
    if (!raw) return null;

    // Convert "YYYY-MM-DD HH:mm:ss" to ISO-ish "YYYY-MM-DDTHH:mm:ssZ" if UTC
    const tz = safeText(article?.pubDateTZ).toUpperCase();
    if (tz === "UTC") {
      const iso = raw.replace(" ", "T") + "Z";
      const d = new Date(iso);
      return isNaN(d.getTime()) ? null : d;
    }

    // fallback: try native parse
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  }

  function timeAgo(date) {
    if (!date) return "—";
    const diffMs = Date.now() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);

    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

    const mins = Math.floor(diffSec / 60);
    const hours = Math.floor(mins / 60);
    const days = Math.floor(hours / 24);

    if (Math.abs(mins) < 1) return "just now";
    if (Math.abs(mins) < 60) return rtf.format(-mins, "minute");
    if (Math.abs(hours) < 24) return rtf.format(-hours, "hour");
    return rtf.format(-days, "day");
  }

  function normalizeArticle(a) {
    return {
      id: safeText(a?.article_id) || crypto.randomUUID(),
      link: safeText(a?.link),
      title: safeText(a?.title) || "Untitled",
      description: safeText(a?.description),
      image: safeText(a?.image_url),
      sourceName: safeText(a?.source_name) || safeText(a?.source_id) || "Source",
      sourceIcon: safeText(a?.source_icon),
      country: Array.isArray(a?.country) ? a.country : [],
      language: safeText(a?.language),
      category: Array.isArray(a?.category) ? a.category : [],
      pubDate: parsePubDate(a),
      raw: a,
    };
  }

  function matchesFilters(item) {
    const q = state.filters.q.trim().toLowerCase();
    const country = state.filters.country;
    const lang = state.filters.language;
    const cat = state.filters.category;

    if (q) {
      const hay = (item.title + " " + item.description).toLowerCase();
      if (!hay.includes(q)) return false;
    }

    if (country) {
      if (!item.country?.includes(country)) return false;
    }

    if (lang) {
      if ((item.language || "") !== lang) return false;
    }

    if (cat) {
      if (!item.category?.includes(cat)) return false;
    }

    return true;
  }

  function updateChips() {
    const chips = [];
    if (state.filters.q) chips.push({ key: "q", label: `Search: ${state.filters.q}` });
    if (state.filters.country) chips.push({ key: "country", label: `Country: ${state.filters.country}` });
    if (state.filters.language) chips.push({ key: "language", label: `Language: ${state.filters.language}` });
    if (state.filters.category) chips.push({ key: "category", label: `Category: ${state.filters.category}` });

    els.chips.innerHTML = "";
    chips.forEach(c => {
      const el = document.createElement("span");
      el.className = "chip";
      el.innerHTML = `
        <span>${escapeHtml(c.label)}</span>
        <button type="button" aria-label="Remove ${c.key}">✕</button>
      `;
      el.querySelector("button").addEventListener("click", () => {
        if (c.key === "q") {
          state.filters.q = "";
          els.search.value = "";
        } else {
          state.filters[c.key] = "";
          if (c.key === "country") els.country.value = "";
          if (c.key === "language") els.language.value = "";
          if (c.key === "category") els.category.value = "";
        }
        applyFiltersAndRender();
      });
      els.chips.appendChild(el);
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function buildSelectOptions() {
    // Build unique values from loaded articles
    const countries = uniq(state.all.flatMap(a => a.country || [])).sort();
    const langs = uniq(state.all.map(a => a.language)).sort();
    const cats = uniq(state.all.flatMap(a => a.category || [])).sort();

    fillSelect(els.country, countries, state.filters.country);
    fillSelect(els.language, langs, state.filters.language);
    fillSelect(els.category, cats, state.filters.category);
  }

  function fillSelect(select, values, selected) {
    const keepFirst = select.querySelector("option")?.outerHTML || `<option value="">All</option>`;
    select.innerHTML = keepFirst;
    values.forEach(v => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      if (v === selected) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function renderCards(list) {
    els.grid.innerHTML = "";

    list.forEach(item => {
      const card = document.createElement("article");
      card.className = "newsCard";
      card.tabIndex = 0;
      card.setAttribute("role", "link");
      card.setAttribute("aria-label", item.title);

      const badgeText = item.category?.[0] || item.language || "news";

      const imgHtml = item.image
        ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.title)}" loading="lazy" referrerpolicy="no-referrer" />`
        : "";

      card.innerHTML = `
        <div class="thumb">
          ${imgHtml}
          <span class="badge">${escapeHtml(badgeText)}</span>
        </div>

        <div class="body">
          <h3 class="title">${escapeHtml(item.title)}</h3>
          <p class="desc">${escapeHtml(item.description || "No description available.")}</p>

          <div class="cardFooter">
            <div class="source">
              ${item.sourceIcon ? `<img src="${escapeHtml(item.sourceIcon)}" alt="" loading="lazy" referrerpolicy="no-referrer" />` : ""}
              <span title="${escapeHtml(item.sourceName)}">${escapeHtml(item.sourceName)}</span>
            </div>
            <div class="time">${escapeHtml(timeAgo(item.pubDate))}</div>
          </div>
        </div>
      `;

      // Image fallback if blocked / missing
      const img = card.querySelector("img");
      if (img) {
        img.addEventListener("error", () => {
          img.remove();
        }, { once: true });
      }

      const open = () => {
        if (item.link) window.open(item.link, "_blank", "noopener,noreferrer");
      };

      card.addEventListener("click", open);
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") open();
      });

      els.grid.appendChild(card);
    });
  }

  function applyFiltersAndRender() {
    updateChips();

    const filtered = state.all.filter(matchesFilters);
    state.visible = filtered;

    els.countLabel.textContent = `${filtered.length} article(s) shown`;

    // Empty state
    if (!state.isLoading && filtered.length === 0) {
      show(els.empty);
    } else {
      hide(els.empty);
    }

    renderCards(filtered);

    // Enable Load More if we have nextPage token
    els.loadMoreBtn.disabled = state.isLoading || !state.nextPage;
  }

  // =========================
  // FETCHING
  // =========================
  async function fetchNews({ append = true } = {}) {

  

    if (state.isLoading) return;
    state.isLoading = true;

    hide(els.error);
    hide(els.empty);

    renderSkeleton(3);
    show(els.skeleton);
    setStatus("Loading…");
    els.loadMoreBtn.disabled = true;

    try {
      const url = new URL(API_URL);
      if (state.nextPage && append) {
        url.searchParams.set("page", state.nextPage);
      }
      // NOTE: newsdata uses nextPage token (string). Some examples call it "page".
      // If your account requires a different param name, change it here.

      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      if (!data || data.status !== "success") {
        throw new Error("API returned non-success status");
      }

      const items = Array.isArray(data.results) ? data.results : [];
      const normalized = items.map(normalizeArticle);

      // Avoid duplicates by id
      const seen = new Set(state.all.map(x => x.id));
      const newItems = normalized.filter(x => !seen.has(x.id));

      // Client-side slice (optional)
      const sliced = newItems.slice(0, PAGE_SIZE);

      state.all = append ? state.all.concat(sliced) : sliced;

      state.nextPage = data.nextPage || null;

      buildSelectOptions();
      setStatus(`Updated • ${new Date().toLocaleTimeString()}`);
      applyFiltersAndRender();
    } catch (err) {
      console.error(err);
      show(els.error);
      els.errorText.textContent =
        "Something went wrong while fetching news. Check your API key / limits, then retry.";
      setStatus("Error");
    } finally {
      state.isLoading = false;
      renderSkeleton(0);
      
      els.loadMoreBtn.disabled = state.isLoading || !state.nextPage;

    }
  }


  // =========================
  // EVENTS
  // =========================
  function debounce(fn, delay = 250) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), delay);
    };
  }

  function bindEvents() {
    els.search.addEventListener("input", debounce(() => {
      state.filters.q = els.search.value;
      applyFiltersAndRender();
    }, 180));

    els.country.addEventListener("change", () => {
      state.filters.country = els.country.value;
      applyFiltersAndRender();
    });

    els.language.addEventListener("change", () => {
      state.filters.language = els.language.value;
      applyFiltersAndRender();
    });

    els.category.addEventListener("change", () => {
      state.filters.category = els.category.value;
      applyFiltersAndRender();
    });

    els.loadMoreBtn.addEventListener("click", () => fetchNews({ append: true }));

    els.retryBtn.addEventListener("click", () => fetchNews({ append: true }));

    els.clearBtn.addEventListener("click", () => {
      state.filters = { q: "", country: "", language: "", category: "" };
      els.search.value = "";
      els.country.value = "";
      els.language.value = "";
      els.category.value = "";
      applyFiltersAndRender();
    });

    els.refreshBtn.addEventListener("click", () => {
      // reset but keep filters
      state.all = [];
      state.nextPage = null;
      fetchNews({ append: true });
    });

    els.themeBtn.addEventListener("click", toggleTheme);
  }

  // =========================
  // INIT
  // =========================
  loadTheme();
  bindEvents();
  fetchNews({ append: true });
})();


function showSkeleton() {
  if (!els.skeleton) return;

  els.skeleton.hidden = false;
  //renderSkeleton(9);
}

function hideSkeleton() {
  if (!els.skeleton) return;

  els.skeleton.innerHTML = "";
  els.skeleton.hidden = true;
  els.skeleton.style.display = "none";
  els.skeleton.classList.remove("grid");
  els.skeleton.classList.remove("grid--skeleton");
}
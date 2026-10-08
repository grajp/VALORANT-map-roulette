(() => {
  "use strict";

  const API_URL = "https://valorant-api.com/v1/maps?language=";
  const IS_BO3 = document.body.dataset.mode === "bo3";
  const SERIES_LEN = 3;
  const poolStatus = () => {
    if (!IS_BO3) return { need: 2, have: state.enabled.size };
    const n = state.series.length;
    if (n >= SERIES_LEN) return { need: SERIES_LEN, have: state.enabled.size + state.excluded.size };
    const taken = new Set(state.series.map((m) => m.id));
    let have = 0;
    state.enabled.forEach((id) => { if (!taken.has(id)) have++; });
    return { need: SERIES_LEN - n, have };
  };
  const STORAGE_KEY = IS_BO3 ? "valorant-map-roulette:bo3:v1" : "valorant-map-roulette:v1";
  const FALLBACK_MAPS = [
    ["Abyss", "アビス"], ["Ascent", "アセント"], ["Bind", "バインド"], ["Breeze", "ブリーズ"],
    ["Corrode", "Corrode"], ["Fracture", "フラクチャー"], ["Haven", "ヘイヴン"], ["Icebox", "アイスボックス"],
    ["Lotus", "ロータス"], ["Pearl", "パール"], ["Split", "スプリット"], ["Sunset", "サンセット"],
  ].map(([en, ja]) => ({ id: en, en, ja, tall: null, splash: null }));

  const START_INDEX = 4;      // 開始時に中央に表示するカードの位置
  const CARDS_PER_SEC = 3.5;    // 回転時間に対する移動カード数
  const TAIL_CARDS = 7;
  const HISTORY_MAX = 15;

  const state = {
    maps: [],
    enabled: new Set(),
    excluded: new Set(),
    series: [],
    history: [],
    opts: { autoExclude: true, sound: false, duration: 5500 },
    spinning: false,
    seq: [],
    centerIndex: START_INDEX,
    activeEl: null,
    preload: Promise.resolve(),
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    status: $("status-text"), viewport: $("reel-viewport"), track: $("reel-track"),
    spin: $("spin-btn"), result: $("result"), resultBg: $("result-bg"),
    resultJa: $("result-name-ja"), resultEn: $("result-name-en"),
    poolGrid: $("pool-grid"), poolCount: $("pool-count"),
    optAutoExclude: $("opt-autoexclude"), optDuration: $("opt-duration"),
    spinError: $("spin-error"),
    historyList: $("history-list"), historyEmpty: $("history-empty"), historyClear: $("history-clear"),
    quickHistoryList: $("quick-history-list"), historyModal: $("history-modal"),
    historyModalOpen: $("history-modal-open"), historyModalClose: $("history-modal-close"),
    historyControls: $("history-controls"),
    presetAll: $("preset-all"), presetNone: $("preset-none"),
    seriesList: $("series-list"), seriesReset: $("series-reset"),
    spinLabel: document.querySelector(".spin-btn-label"),
  };

  function randInt(n) {
    const buf = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / n) * n;
    do { crypto.getRandomValues(buf); } while (buf[0] >= limit);
    return buf[0] % n;
  }
  const byId = (id) => state.maps.find((m) => m.id === id);
  const hueOf = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  const easeSpin = (t) => {
    return 1 - Math.pow(1 - t, 4);
  };
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function load() {
    return null;
  }
  function save() {
  }

  async function fetchMaps() {
    const [ja, en] = await Promise.all(
      ["ja-JP", "en-US"].map((l) => fetch(API_URL + l).then((r) => {
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      }))
    );

    const enMap = new Map(en.data.map((m) => [m.uuid, m]));
    return ja.data
      .filter((m) => m.tacticalDescription && m.listViewIconTall)
      .map((m) => ({
        id: m.uuid,
        ja: m.displayName,
        en: (enMap.get(m.uuid) || m).displayName,
        tall: m.listViewIconTall,
        splash: m.splash,
      }))
      .sort((a, b) => a.ja.localeCompare(b.ja, 'ja'));
  }

  function preloadImages(maps) {
    const decode = (url) => {
      const img = new Image();
      img.src = url;
      return img.decode ? img.decode().catch(() => { }) : Promise.resolve();
    };
    const talls = [...new Set(maps.map((m) => m.tall).filter(Boolean))];
    [...new Set(maps.map((m) => m.splash).filter(Boolean))].forEach(decode);
    const all = Promise.all(talls.map(decode));
    return Promise.race([all, new Promise((r) => setTimeout(r, 4000))]);
  }

  const metrics = () => {
    const card = el.track.querySelector(".reel-card");
    const w = card ? card.offsetWidth : 200;
    const gap = parseFloat(getComputedStyle(el.track).columnGap) || 14;
    return { w, gap, step: w + gap, vw: el.viewport.clientWidth };
  };

  function cardHTML(m) {
    const bg = m.tall ? `style="background-image:url('${m.tall}')"` : `style="--hue:${hueOf(m.en)}"`;
    return `<div class="reel-card${m.tall ? "" : " noimg"}" data-id="${m.id}" ${bg}>
      <div class="card-name"><span class="ja">${m.ja}</span><span class="en">${m.en}</span></div></div>`;
  }

  function renderTrack(seq) {
    state.seq = seq;
    el.track.innerHTML = seq.map(cardHTML).join("");
    el.track.style.width = "max-content";
  }

  function offsetFor(index, jitter = 0) {
    const { w, step, vw } = metrics();
    return vw / 2 - (index * step + w / 2) + jitter;
  }
  function setOffset(x) { el.track.style.transform = `translate3d(${x}px,0,0)`; }

  function randomMapFrom(pool, avoidId) {
    let m;
    let guard = 0;
    do { m = pool[randInt(pool.length)]; } while (pool.length > 1 && m.id === avoidId && ++guard < 20);
    return m;
  }

  function renderIdle() {
    const pool = activePool();
    const base = pool.length ? pool : state.maps;
    if (!base.length) return;
    let wheel = [...base].sort(() => Math.random() - 0.5);
    const N = wheel.length;
    const seq = [];
    for (let i = 0; i < 14; i++) {
      seq.push(wheel[i % N]);
    }
    renderTrack(seq);
    state.centerIndex = START_INDEX;
    setOffset(offsetFor(START_INDEX));
    highlightCenter(START_INDEX, false);
  }

  function highlightCenter(index, on = true) {
    if (state.activeEl) state.activeEl.classList.remove("active");
    const c = on ? el.track.children[index] : null;
    if (c) c.classList.add("active");
    state.activeEl = c || null;
  }

  const activePool = () => state.maps.filter((m) => state.enabled.has(m.id));
  const pickWinner = (pool) => pool[randInt(pool.length)];

  async function spin() {
    if (state.spinning) return;
    if (IS_BO3 && state.series.length >= SERIES_LEN) resetSeries();
    const pool = activePool();
    const q = poolStatus();
    if (q.have < q.need) {
      if (el.spinError) { el.spinError.textContent = `${q.need}つ以上のマップを選択してください`; el.spinError.hidden = false; }
      return;
    }
    if (el.spinError) el.spinError.hidden = true;
    const taken = new Set(state.series.map((m) => m.id));
    const candidates = pool.filter((m) => !taken.has(m.id));

    state.spinning = true;
    el.spin.disabled = true;
    el.spin.classList.add("spinning");
    el.result.hidden = true;
    await state.preload;

    const winner = pickWinner(candidates);
    const current = state.seq[state.centerIndex] || pool[0];

    const duration = reducedMotion() ? 600 : state.opts.duration;
    let travel = Math.max(10, Math.round((duration / 1000) * CARDS_PER_SEC));

    let wheel = [...pool].sort(() => Math.random() - 0.5);
    const N = wheel.length;

    let currIdx = wheel.findIndex(m => m.id === current.id);
    if (currIdx !== -1) {
      wheel = [...wheel.slice(currIdx), ...wheel.slice(0, currIdx)];
    }

    let wIdx = wheel.findIndex(m => m.id === winner.id);
    let remainder = travel % N;
    let diff = wIdx - remainder;
    travel += diff;
    if (travel < 10) travel += N;

    const winIndex = START_INDEX + travel;
    const total = winIndex + TAIL_CARDS;

    const seq = Array(total).fill(null);
    for (let i = 0; i < total; i++) {
      let idx = (i - START_INDEX) % N;
      if (idx < 0) idx += N;
      seq[i] = wheel[idx];
    }
    if (currIdx === -1) {
      seq[START_INDEX] = current;
    }

    renderTrack(seq);
    el.track.classList.add("is-spinning");
    highlightCenter(-1, false);

    const { w, step, vw } = metrics();
    const startX = vw / 2 - (START_INDEX * step + w / 2);
    const jitter = (Math.random() - 0.5) * w * 0.8;
    const endX = vw / 2 - (winIndex * step + w / 2) + jitter;
    const dist = endX - startX;

    setOffset(startX);
    let t0 = null;
    let lastIdx = -1;
    const frame = (now) => {
      if (t0 === null) t0 = now;
      const t = Math.min((now - t0) / duration, 1);
      const x = startX + dist * easeSpin(t);
      el.track.style.transform = `translate3d(${x}px,0,0)`;

      const idx = Math.floor((vw / 2 - x) / step);
      if (idx !== lastIdx) { lastIdx = idx; highlightCenter(idx); }

      if (t < 1) requestAnimationFrame(frame);
      else finish(winner, winIndex);
    };
    requestAnimationFrame(frame);
  }

  function finish(winner, winIndex) {
    state.spinning = false;
    state.centerIndex = winIndex;
    el.spin.disabled = false;
    el.spin.classList.remove("spinning");
    el.track.classList.remove("is-spinning");

    highlightCenter(winIndex, false);
    el.track.children[winIndex].classList.add("winner");

    if (IS_BO3) {
      state.series.push(winner);
      renderSeries();
      setStatus(state.series.length >= SERIES_LEN ? "3マップが決まりました" : `MAP ${state.series.length} が決まりました`);
    }

    if (state.opts.autoExclude) {
      state.enabled.delete(winner.id);
      state.excluded.add(winner.id);
      updatePoolMeta();
    }

    el.resultJa.textContent = winner.ja;
    el.resultEn.textContent = winner.en;
    el.resultBg.style.backgroundImage = winner.splash ? `url('${winner.splash}')` : "";
    el.result.hidden = false;
    el.result.style.animation = "none"; void el.result.offsetWidth; el.result.style.animation = "";
    el.result.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "nearest" });



    state.history.unshift({ id: winner.id, ja: winner.ja, en: winner.en, tall: winner.tall, splash: winner.splash, at: Date.now() });
    state.history = state.history.slice(0, HISTORY_MAX);
    renderHistory();
    save();
  }

  function renderPool() {
    el.poolGrid.innerHTML = "";
    state.maps.forEach((m) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pool-item" + (m.tall ? "" : " noimg") + (state.enabled.has(m.id) ? " on" : "");
      b.dataset.id = m.id;
      b.setAttribute("aria-pressed", state.enabled.has(m.id));
      if (!m.tall) b.style.setProperty("--hue", hueOf(m.en));
      b.innerHTML = `<span class="bg" ${m.tall ? `style="background-image:url('${m.tall}')"` : ""}></span>
        <span class="check" aria-hidden="true">✓</span><span class="nm">${m.ja}<small>${m.en}</small></span>`;
      b.addEventListener("click", () => toggleMap(m.id));
      li.appendChild(b);
      el.poolGrid.appendChild(li);
    });
    updatePoolMeta();
    fitPoolNames();
    if (!state.fitBound) {
      state.fitBound = true;
      if (window.ResizeObserver) new ResizeObserver(() => fitPoolNames()).observe(el.poolGrid);
      else window.addEventListener("resize", fitPoolNames);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitPoolNames);
    }
  }

  function fitPoolNames() {
    const MAX = 15, MIN = 8, STEP = 0.25;
    el.poolGrid.querySelectorAll(".pool-item").forEach((b) => {
      const nm = b.querySelector(".nm");
      if (!nm) return;
      const cs = getComputedStyle(b);
      const avail = b.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - 2;
      if (avail <= 0) return;
      let size = MAX;
      nm.style.fontSize = size + "px";
      while (nm.getBoundingClientRect().width > avail && size > MIN) {
        size -= STEP;
        nm.style.fontSize = size + "px";
      }
    });
  }

  function updatePoolMeta() {
    if (el.poolCount) {
      el.poolCount.textContent = `${state.enabled.size} / ${state.maps.length}`;
    }

    const q = poolStatus();
    if (el.spinError && state.maps.length) {
      el.spinError.textContent = `${q.need}つ以上のマップを選択してください`;
      el.spinError.hidden = q.have >= q.need;
    }
    el.poolGrid.querySelectorAll(".pool-item").forEach((b) => {
      const on = state.enabled.has(b.dataset.id);
      const isAuto = state.excluded.has(b.dataset.id);
      const isBan = !on && !isAuto;
      b.classList.toggle("on", on);
      b.classList.toggle("recent", !on && isAuto);
      b.classList.toggle("ban", isBan);
      b.setAttribute("aria-pressed", on);
    });

    const short = q.have < q.need;
    el.spin.disabled = state.spinning || !state.maps.length;
    el.spin.classList.toggle("unavailable", short);
    el.spin.setAttribute("aria-disabled", short ? "true" : "false");
  }

  function renderSeries() {
    if (!IS_BO3) return;
    const n = state.series.length;
    el.seriesList.innerHTML = Array.from({ length: SERIES_LEN }, (_, i) => {
      const m = state.series[i];
      const cls = m ? "filled" : "empty" + (i === n ? " next" : "");
      const bg = m && m.splash ? ` style="background-image:url('${m.splash}')"` : "";
      return `<li class="series-slot ${cls}"${bg}><span class="no">MAP ${i + 1}</span>
        <span class="nm">${m ? m.ja : (i === n ? "決めるマップ" : "")}</span></li>`;
    }).join("");
    el.spinLabel.textContent = n >= SERIES_LEN ? "NEW BO3" : `MAP ${n + 1}`;
  }
  function resetSeries() {
    state.series = [];
    el.result.hidden = true;
    state.excluded.forEach((id) => state.enabled.add(id));
    state.excluded.clear();
    renderSeries();
    updatePoolMeta();
    save();
  }

  function toggleMap(id) {
    if (state.spinning) return;
    if (state.enabled.has(id)) state.enabled.delete(id);
    else { state.enabled.add(id); state.excluded.delete(id); }
    updatePoolMeta(); renderHistory(); save();
  }

  async function applyPreset(kind) {
    if (state.spinning) return;
    state.enabled = kind === "none" ? new Set() : new Set(state.maps.map((m) => m.id));
    state.excluded = new Set();
    updatePoolMeta(); save();
  }

  function renderHistory() {
    el.historyList.innerHTML = "";
    const fullLen = state.history.length;

    const reversedHistory = [...state.history].reverse();
    reversedHistory.forEach((h, i) => {
      const li = document.createElement("li");
      li.className = "history-item full";
      const isOn = state.enabled.has(h.id);
      const btnClass = isOn ? "toggle-btn" : "toggle-btn is-ban";
      const num = String(i + 1).padStart(2, "0");
      li.innerHTML = `<span class="idx" style="color: #fff;">${num}</span>
        <span class="h-thumb" ${h.splash ? `style="background-image:url('${h.splash}')"` : ""}></span>
        <span class="h-name">${h.ja}</span>
        <button type="button" class="chip-btn small ${btnClass}">${isOn ? "BANする" : "復活"}</button>`;
      li.querySelector("button").addEventListener("click", () => toggleMap(h.id));
      el.historyList.appendChild(li);
    });
    el.historyEmpty.hidden = fullLen > 0;
    if (el.historyControls) el.historyControls.hidden = fullLen === 0;

    el.quickHistoryList.innerHTML = "";
    const quickArr = state.history.slice(0, 3);
    quickArr.forEach((h, i) => {
      const li = document.createElement("li");
      li.className = "history-item mini";
      const num = String(fullLen - i).padStart(2, "0");
      li.innerHTML = `<span class="idx">${num}</span>
        <span class="h-thumb" ${h.splash ? `style="background-image:url('${h.splash}')"` : ""}></span>
        <span class="h-name">${h.ja}</span>`;
      el.quickHistoryList.appendChild(li);
    });
  }

  function setStatus(text, isError = false) {
    el.status.textContent = isError ? text : "";
    el.status.classList.toggle("error", isError);
  }

  function resizeCanvas() {
  }

  function customConfirm(msg) {
    const modal = $("confirm-modal");
    if (!modal) return Promise.resolve(window.confirm(msg));
    return new Promise((resolve) => {
      $("confirm-msg").textContent = msg;
      modal.hidden = false;
      const okBtn = $("btn-confirm-ok");
      const cancelBtn = $("btn-confirm-cancel");

      const newOk = okBtn.cloneNode(true);
      const newCancel = cancelBtn.cloneNode(true);
      okBtn.parentNode.replaceChild(newOk, okBtn);
      cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

      newCancel.onclick = () => { modal.hidden = true; resolve(false); };
      newOk.onclick = () => { modal.hidden = true; resolve(true); };
    });
  }

  function bindEvents() {
    el.spin.addEventListener("click", spin);

    if (IS_BO3) el.seriesReset.addEventListener("click", () => { if (!state.spinning) resetSeries(); });
    el.historyModalOpen.addEventListener("click", () => {
      el.historyModal.hidden = false;
      renderHistory();
      el.historyModal.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    });
    el.historyModalClose.addEventListener("click", () => { el.historyModal.hidden = true; });
    el.presetAll.addEventListener("click", () => applyPreset("all"));
    el.presetNone.addEventListener("click", () => applyPreset("none"));
    el.optAutoExclude.addEventListener("change", () => { state.opts.autoExclude = el.optAutoExclude.checked; save(); });
    el.optDuration.addEventListener("change", () => { state.opts.duration = Number(el.optDuration.value); save(); });
    el.historyClear.addEventListener("click", async () => {
      const ok = await customConfirm("履歴をすべて削除しますか？");
      if (!ok) return;
      state.history = [];
      state.excluded.forEach((id) => state.enabled.add(id));
      state.excluded.clear();
      el.historyModal.hidden = true;
      updatePoolMeta(); renderHistory(); save();
    });
    window.addEventListener("resize", () => {
      resizeCanvas();
      if (!state.spinning) setOffset(offsetFor(state.centerIndex));
    });
  }

  async function init() {
    resizeCanvas();
    bindEvents();

    const saved = load();
    if (saved) {
      Object.assign(state.opts, saved.opts || {});
      state.history = Array.isArray(saved.history) ? saved.history.slice(0, HISTORY_MAX) : [];
    }
    el.optAutoExclude.checked = state.opts.autoExclude;
    el.optDuration.value = String(state.opts.duration);
    renderHistory();

    try {
      state.maps = await fetchMaps();
      if (state.maps.length < 2) throw new Error("マップが取得できません");
      setStatus("");
    } catch (err) {
      console.warn("マップ取得に失敗したためフォールバックを使用:", err);
      state.maps = FALLBACK_MAPS;
      setStatus("オフライン用データを使用中（画像なし）", true);
    }

    const valid = (saved?.enabled || []).filter((id) => byId(id));
    if (valid.length >= 2) {
      state.enabled = new Set(valid);
      state.excluded = new Set((saved?.excluded || []).filter((id) => byId(id) && !state.enabled.has(id)));
    } else applyPreset("all");
    state.opts.sound = false;
    if (IS_BO3) { state.excluded.forEach((id) => state.enabled.add(id)); state.excluded.clear(); }

    state.preload = preloadImages(state.maps);

    renderPool();
    renderIdle();
    renderSeries();
    updatePoolMeta();
  }

  init();
})();

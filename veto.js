(() => {
  "use strict";

  const API_URL = "https://valorant-api.com/v1/maps?language=";
  const MAPS_CACHE_KEY = "valorant-map-roulette:maps-cache:v1";
  const REQUIRED_MAP_COUNT = 7;

  const FALLBACK_MAPS = [
    ["Abyss", "アビス"],
    ["Ascent", "アセント"],
    ["Bind", "バインド"],
    ["Breeze", "ブリーズ"],
    ["Corrode", "Corrode"],
    ["Fracture", "フラクチャー"],
    ["Haven", "ヘイヴン"],
    ["Icebox", "アイスボックス"],
    ["Lotus", "ロータス"],
    ["Pearl", "パール"],
    ["Split", "スプリット"],
    ["Sunset", "サンセット"],
  ].map(([en, ja]) => ({ id: en, en, ja, tall: null, icon: null, splash: null }));

  // BO3 BAN/PICK の進行フェーズ定義
  const PHASES = [
    { action: "ban", team: 1 },
    { action: "ban", team: 2 },
    { action: "pick", team: 1 },
    { action: "side", team: 2 },
    { action: "pick", team: 2 },
    { action: "side", team: 1 },
    { action: "ban", team: 1 },
    { action: "ban", team: 2 },
    { action: "decider", team: 0 },
    { action: "side", team: 1 },
  ];

  const state = {
    maps: [],
    enabled: new Set(),
    team1: "Team A",
    team2: "Team B",
    coinFlipWinner: null,
    vetoPhase: 0,
    vetoState: [],
    poolWhenVetoStarted: [],
  };

  const $ = (id) => document.getElementById(id);
  const el = {
    layout: document.querySelector(".layout"),
    poolPanel: $("pool-panel"),
    poolGrid: $("pool-grid"),
    selected7Grid: $("selected-7-grid"),
    setupMapCount: $("setup-map-count"),
    team1: $("team1-name"),
    team2: $("team2-name"),
    btnStart: $("btn-start-veto"),
    vetoSetup: $("veto-setup"),
    vetoActive: $("veto-active"),
    vetoError: $("veto-error"),
    turnText: $("veto-turn-text"),
    instructionText: $("veto-instruction-text"),
    actionWrapper: $("veto-action-wrapper"),
    slots: $("veto-slots"),
    pool: $("veto-pool"),
    sideSelect: $("side-select"),
    btnAtk: $("btn-atk"),
    btnDef: $("btn-def"),
    btnUndo: $("btn-veto-undo"),
    btnCopy: $("btn-veto-copy"),
    btnReset: $("btn-veto-reset"),
    confirmModal: $("confirm-modal"),
    confirmMsg: $("confirm-msg"),
    btnConfirmOk: $("btn-confirm-ok"),
    btnConfirmCancel: $("btn-confirm-cancel"),
  };

  // localStorage からキャッシュ済みマップ一覧を取得
  function loadCachedMaps() {
    try {
      const raw = localStorage.getItem(MAPS_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length >= REQUIRED_MAP_COUNT ? parsed : null;
    } catch {
      return null;
    }
  }

  // マップ一覧を localStorage にキャッシュ保存
  function saveCachedMaps(maps) {
    try {
      localStorage.setItem(MAPS_CACHE_KEY, JSON.stringify(maps));
    } catch {
      // プライベートブラウジング等で保存できない場合は無視
    }
  }

  // VALORANT APIからマップ一覧を取得（日本語・英語名を結合）
  async function fetchMaps() {
    const [ja, en] = await Promise.all(
      ["ja-JP", "en-US"].map((lang) =>
        fetch(API_URL + lang).then((res) => {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        })
      )
    );

    const enMap = new Map(en.data.map((m) => [m.uuid, m]));
    return ja.data
      .filter((m) => m.tacticalDescription && m.listViewIconTall)
      .map((m) => ({
        id: m.uuid,
        ja: m.displayName,
        en: (enMap.get(m.uuid) || m).displayName,
        tall: m.listViewIconTall,
        icon: m.listViewIcon,
        splash: m.splash,
      }))
      .sort((a, b) => a.ja.localeCompare(b.ja, "ja"));
  }

  // 事前設定画面のマッププールと7枠プレビューを描画
  function renderSetupPool() {
    el.poolGrid.innerHTML = "";
    const selectedMaps = [];

    state.maps.forEach((m) => {
      const on = state.enabled.has(m.id);
      if (on) selectedMaps.push(m);

      const li = document.createElement("li");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pool-item" + (m.tall ? "" : " noimg") + (on ? " on" : "");
      btn.dataset.id = m.id;
      btn.innerHTML = `<span class="bg" ${m.tall ? `style="background-image:url('${m.tall}')"` : ""}></span>
        <span class="check">✓</span><span class="nm">${m.ja}<small>${m.en.toUpperCase()}</small></span>`;

      btn.addEventListener("click", () => {
        if (state.vetoPhase > 0) return;
        if (on) {
          state.enabled.delete(m.id);
        } else {
          if (state.enabled.size >= REQUIRED_MAP_COUNT) return;
          state.enabled.add(m.id);
        }
        el.vetoError.textContent = "";
        renderSetupPool();
      });

      li.appendChild(btn);
      el.poolGrid.appendChild(li);
    });

    el.setupMapCount.textContent = state.enabled.size;
    el.btnStart.disabled = state.enabled.size !== REQUIRED_MAP_COUNT;

    el.selected7Grid.innerHTML = "";
    for (let i = 0; i < REQUIRED_MAP_COUNT; i++) {
      const m = selectedMaps[i];
      const li = document.createElement("li");

      if (m) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pool-item on" + (m.tall ? "" : " noimg");
        btn.dataset.id = m.id;
        btn.innerHTML = `<span class="bg" ${m.tall ? `style="background-image:url('${m.tall}')"` : ""}></span>
          <span class="nm">${m.ja}<small>${m.en.toUpperCase()}</small></span>`;
        btn.onclick = () => {
          state.enabled.delete(m.id);
          renderSetupPool();
        };
        li.appendChild(btn);
      } else {
        const div = document.createElement("div");
        div.className = "pool-item noimg empty-slot";
        div.innerHTML = "&nbsp;";
        li.appendChild(div);
      }
      el.selected7Grid.appendChild(li);
    }
  }

  function getTeamName(teamNum) {
    if (teamNum === 1) return state.team1 || "Team A";
    if (teamNum === 2) return state.team2 || "Team B";
    return "";
  }

  // BAN/PICK フェーズの開始
  function startVeto() {
    state.team1 = el.team1.value.trim() || "Team A";
    state.team2 = el.team2.value.trim() || "Team B";

    const activeFpBtn = document.querySelector(".fp-btn.active");
    const fpVal = activeFpBtn ? activeFpBtn.dataset.val : "random";

    if (fpVal === "random") {
      state.coinFlipWinner = Math.random() > 0.5 ? 1 : 2;
    } else {
      state.coinFlipWinner = parseInt(fpVal, 10);
    }

    if (state.coinFlipWinner === 2) {
      [state.team1, state.team2] = [state.team2, state.team1];
    }

    state.poolWhenVetoStarted = state.maps.filter((m) => state.enabled.has(m.id));
    state.vetoState = [];
    state.vetoPhase = 1;

    el.vetoSetup.hidden = true;
    el.poolPanel.hidden = true;
    el.vetoActive.hidden = false;
    el.layout.classList.add("veto-active-mode");

    renderVeto();
  }

  // BAN/PICK 進行画面の描画
  function renderVeto() {
    const phase = PHASES[Math.min(state.vetoPhase - 1, PHASES.length - 1)];
    const teamName = getTeamName(phase.team);
    const pAction = phase ? phase.action : "";

    // 7つの結果スロットの描画
    el.slots.innerHTML = "";
    for (let i = 0; i < REQUIRED_MAP_COUNT; i++) {
      const slotData = state.vetoState[i];
      const div = document.createElement("div");
      const isActiveEmpty =
        state.vetoPhase <= 10 &&
        i === state.vetoState.length &&
        pAction !== "side" &&
        pAction !== "decider";
      const isActiveSide =
        state.vetoPhase <= 10 &&
        i === state.vetoState.length - 1 &&
        pAction === "side";

      div.className =
        "veto-slot" +
        (slotData ? " filled" : "") +
        (isActiveEmpty || isActiveSide ? " active-slot" : "");

      if (slotData) {
        const m = state.maps.find((x) => x.id === slotData.map);
        if (m && m.tall) {
          div.style.backgroundImage = `url('${m.tall}')`;
        }

        if (slotData.action === "ban") {
          div.classList.add("ban");
          const isLatestBan =
            (i === 0 && state.vetoPhase === 2) ||
            (i === 1 && state.vetoPhase === 3) ||
            (i === 4 && state.vetoPhase === 8) ||
            (i === 5 && state.vetoPhase === 10);
          if (isLatestBan) {
            div.classList.add("latest-ban");
          }
          div.innerHTML = `<div class="veto-slot-name">${m.en.toUpperCase()}</div>
            <div class="veto-slot-bottom">${getTeamName(slotData.team)}<br>VETO MAP</div>`;
        } else if (slotData.action === "pick" || slotData.action === "decider") {
          div.classList.add("pick");
          const label =
            slotData.action === "decider"
              ? slotData.side
                ? `${getTeamName(PHASES[9].team)} PICKS`
                : ""
              : `${getTeamName(slotData.team)} PICKS`;
          const sideText = slotData.side || "";
          const btmText =
            slotData.action === "decider"
              ? "DECIDER<br>MAP"
              : `${getTeamName(slotData.team)}<br>SELECT MAP`;

          div.innerHTML = `<div class="veto-slot-pick-info">
              <div class="veto-slot-label">${label}</div>
              <div class="veto-slot-side">${sideText}</div>
            </div>
            <div class="veto-slot-name">${m.en.toUpperCase()}</div>
            <div class="veto-slot-bottom">${btmText}</div>`;

          const isLatestSide =
            slotData.side &&
            ((i === 2 && state.vetoPhase === 5) ||
              (i === 3 && state.vetoPhase === 7) ||
              (i === 6 && state.vetoPhase === 11));
          if (isLatestSide) {
            div.classList.add("latest-side");
          }
        }
      } else {
        div.innerHTML = `<div class="veto-slot-empty"></div>`;
      }
      el.slots.appendChild(div);
    }

    el.pool.innerHTML = "";
    el.sideSelect.hidden = true;
    el.btnUndo.hidden = state.vetoPhase <= 1;

    // 全フェーズ完了時（結果表示）
    if (state.vetoPhase > 10) {
      el.turnText.style.visibility = "visible";
      el.instructionText.style.visibility = "visible";
      el.turnText.textContent = "BAN / PICK 結果";
      el.instructionText.textContent = "\u00A0";
      if (el.actionWrapper) el.actionWrapper.classList.add("is-collapsed");
      if (el.btnCopy) el.btnCopy.hidden = false;
      return;
    }

    if (el.btnCopy) el.btnCopy.hidden = true;
    if (el.actionWrapper) el.actionWrapper.classList.remove("is-collapsed");

    // 選択可能な7マップの描画
    state.poolWhenVetoStarted.forEach((m) => {
      const used = state.vetoState.some((v) => v.map === m.id);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pool-item on" + (m.tall ? "" : " noimg") + (used ? " used" : "");
      btn.dataset.id = m.id;
      btn.innerHTML = `<span class="bg" ${m.tall ? `style="background-image:url('${m.tall}')"` : ""}></span>
        <span class="nm">${m.ja}<small>${m.en.toUpperCase()}</small></span>`;

      if (!used && phase.action !== "side" && phase.action !== "decider") {
        btn.onclick = () => {
          state.vetoState.push({ map: m.id, action: phase.action, team: phase.team });
          state.vetoPhase++;
          renderVeto();
        };
      }
      el.pool.appendChild(btn);
    });

    el.pool.classList.remove("is-hidden");

    // フェーズ種別ごとの表示切り替え
    if (phase.action === "side") {
      el.turnText.style.visibility = "visible";
      if (state.vetoPhase === 10) {
        el.turnText.innerHTML = `DECIDER MAP <span class="decider-sub">(${teamName}: 陣営を選択)</span>`;
      } else {
        el.turnText.textContent = `${teamName}: 陣営を選択`;
      }
      el.instructionText.style.visibility = "hidden";
      el.sideSelect.hidden = false;
      el.pool.classList.add("is-hidden");
    } else if (phase.action === "decider") {
      el.turnText.style.visibility = "visible";
      el.instructionText.style.visibility = "visible";
      el.turnText.textContent = "DECIDER マップ (自動決定)";
      el.instructionText.textContent = "\u00A0";

      const remaining = state.poolWhenVetoStarted.filter(
        (m) => !state.vetoState.some((v) => v.map === m.id)
      );
      state.vetoState.push({ map: remaining[0].id, action: "decider", team: 0 });
      state.vetoPhase++;
      renderVeto();
    } else {
      el.turnText.style.visibility = "visible";
      el.instructionText.style.visibility = "visible";
      el.turnText.textContent = `${teamName} の ${phase.action.toUpperCase()} フェーズ`;
      el.instructionText.textContent =
        phase.action === "ban"
          ? "BANするマップを選んでください。"
          : "PICKするマップを選んでください。";
    }
  }

  // アタッカー / ディフェンダーの陣営選択
  function selectSide(side) {
    const lastPick = state.vetoState[state.vetoState.length - 1];
    lastPick.side = side;
    state.vetoPhase++;
    renderVeto();
  }

  // 1つ前のフェーズに戻す
  function undoVeto() {
    if (state.vetoPhase <= 1) return;

    if (state.vetoPhase === 11) {
      state.vetoPhase = 10;
      delete state.vetoState[state.vetoState.length - 1].side;
    } else if (state.vetoPhase === 10) {
      state.vetoState.pop(); // 自動決定された decider を取り消す
      state.vetoState.pop(); // 直前の Team 2 BAN を取り消す
      state.vetoPhase = 8;
    } else if (state.vetoPhase === 7) {
      state.vetoPhase = 6;
      delete state.vetoState[state.vetoState.length - 1].side;
    } else if (state.vetoPhase === 5) {
      state.vetoPhase = 4;
      delete state.vetoState[state.vetoState.length - 1].side;
    } else {
      state.vetoState.pop();
      state.vetoPhase--;
    }
    renderVeto();
  }

  // カスタム確認モーダルを表示
  function showConfirm(msg, onOk) {
    el.confirmMsg.textContent = msg;
    el.confirmModal.hidden = false;

    el.btnConfirmCancel.onclick = () => {
      el.confirmModal.hidden = true;
    };
    el.btnConfirmOk.onclick = () => {
      el.confirmModal.hidden = true;
      onOk();
    };
  }

  // 最初からやり直す
  function resetVeto() {
    showConfirm("最初からやり直しますか？", () => {
      state.enabled.clear();
      state.vetoState = [];
      state.vetoPhase = 0;

      el.vetoActive.hidden = true;
      el.vetoSetup.hidden = false;
      el.poolPanel.hidden = false;
      el.layout.classList.remove("veto-active-mode");
      if (el.btnCopy) el.btnCopy.hidden = true;

      renderSetupPool();
    });
  }

  // BAN/PICK 結果を Discord 向けフォーマットでクリップボードにコピー
  function copyVetoResults() {
    const line = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
    let text = "**BO3 BAN/PICK 結果**\n\n" + line + "\n";
    let pickCount = 1;

    const bans = state.vetoState.filter((s) => s.action === "ban");
    const picks = state.vetoState.filter((s) => s.action === "pick" || s.action === "decider");

    bans.forEach((s) => {
      const m = state.maps.find((x) => x.id === s.map);
      const tName = getTeamName(s.team);
      text += `:no_entry_sign: ${tName} BAN : **${m.ja}**\n`;
    });
    text += line + "\n";

    picks.forEach((s) => {
      const m = state.maps.find((x) => x.id === s.map);
      const isAttack = s.side === "ATTACK";
      const sideLabel = isAttack ? "アタッカー" : "ディフェンダー";
      const sideEmoji = isAttack ? ":red_circle:" : ":blue_circle:";

      let sideTeamName;
      let suffix;
      if (s.action === "pick") {
        const pickTeamName = getTeamName(s.team);
        sideTeamName = getTeamName(s.team === 1 ? 2 : 1);
        suffix = `(${pickTeamName} PICK)`;
      } else {
        sideTeamName = getTeamName(PHASES[9].team);
        suffix = "(DECIDER)";
      }

      text += `MAP${pickCount}  **${m.ja}**  (__**${sideTeamName} : ${sideLabel}**__${sideEmoji}) , ${suffix}\n\n`;
      pickCount++;
    });

    navigator.clipboard.writeText(text.trimEnd()).then(() => {
      const origText = "結果をコピーする";
      el.btnCopy.textContent = "コピーしました！";
      setTimeout(() => {
        el.btnCopy.textContent = origText;
      }, 2000);
    });
  }

  // チーム名入力時に先攻選択ボタンのラベルを同期
  function updateTeamNames() {
    state.team1 = el.team1.value.trim() || "Team A";
    state.team2 = el.team2.value.trim() || "Team B";
    document.querySelectorAll(".fp-btn").forEach((btn) => {
      if (btn.dataset.val === "1") btn.textContent = `${state.team1} が先攻`;
      if (btn.dataset.val === "2") btn.textContent = `${state.team2} が先攻`;
    });
  }

  async function init() {
    el.team1.addEventListener("input", updateTeamNames);
    el.team2.addEventListener("input", updateTeamNames);
    updateTeamNames();

    const fpBtns = document.querySelectorAll(".fp-btn");
    fpBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        fpBtns.forEach((b) => b.classList.toggle("active", b === btn));
      });
    });

    el.btnStart.addEventListener("click", startVeto);
    el.btnAtk.addEventListener("click", () => selectSide("ATTACK"));
    el.btnDef.addEventListener("click", () => selectSide("DEFENSE"));
    el.btnUndo.addEventListener("click", undoVeto);
    el.btnReset.addEventListener("click", resetVeto);
    if (el.btnCopy) el.btnCopy.addEventListener("click", copyVetoResults);

    // キャッシュがあれば API 通信を待たずに即座に描画
    const cached = loadCachedMaps();
    if (cached) {
      state.maps = cached;
      renderSetupPool();

      // バックグラウンドで最新データを取得してキャッシュを更新
      fetchMaps()
        .then((fresh) => {
          if (fresh.length < REQUIRED_MAP_COUNT) return;
          saveCachedMaps(fresh);
          const isSameIds =
            fresh.length === state.maps.length &&
            fresh.every((m, idx) => m.id === state.maps[idx].id);
          state.maps = fresh;
          if (!isSameIds && state.vetoPhase === 0 && state.enabled.size === 0) {
            renderSetupPool();
          }
        })
        .catch(() => {});
      return;
    }

    // 初回アクセス時（キャッシュなし）は API から取得して保存
    try {
      state.maps = await fetchMaps();
      saveCachedMaps(state.maps);
    } catch (err) {
      console.warn("マップ取得に失敗したためフォールバックを使用:", err);
      state.maps = FALLBACK_MAPS;
    }

    renderSetupPool();
  }

  init();
})();

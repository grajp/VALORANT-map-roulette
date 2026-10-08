const API_URL = "https://valorant-api.com/v1/maps?language=";

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

const PHASES = [
  { action: 'ban', team: 1 },
  { action: 'ban', team: 2 },
  { action: 'pick', team: 1 },
  { action: 'side', team: 2 },
  { action: 'pick', team: 2 },
  { action: 'side', team: 1 },
  { action: 'ban', team: 1 },
  { action: 'ban', team: 2 },
  { action: 'decider', team: 0 },
  { action: 'side', team: 1 }
];

const $ = (id) => document.getElementById(id);
const el = {
  poolGrid: $("pool-grid"), poolCount: $("pool-count"),
  team1: $("team1-name"), team2: $("team2-name"),
  btnCoin: $("btn-coinflip"), btnStart: $("btn-start-veto"),
  vetoSetup: $("veto-setup"), vetoActive: $("veto-active"),
  vetoError: $("veto-error"),
  turnText: $("veto-turn-text"),
  slots: $("veto-slots"),
  pool: $("veto-pool"),
  sideSelect: $("side-select"),
  sideText: $("side-select-text"),
  btnAtk: $("btn-atk"), btnDef: $("btn-def"),
  resultScreen: $("veto-result-screen"),
};

async function fetchMaps() {
  const [ja, en] = await Promise.all(
    ["ja-JP", "en-US"].map((l) => fetch(API_URL + l).then((r) => r.json()))
  );
  const enMap = new Map(en.data.map((m) => [m.uuid, m]));
  return ja.data
    .filter((m) => m.tacticalDescription && m.listViewIconTall)
    .map((m) => ({
      id: m.uuid, ja: m.displayName, en: (enMap.get(m.uuid) || m).displayName,
      tall: m.listViewIconTall, splash: m.splash,
    }))
    .sort((a, b) => a.ja.localeCompare(b.ja, 'ja'));
}

function renderSetupPool() {
  el.poolGrid.innerHTML = "";
  let selectedMaps = [];

  state.maps.forEach((m) => {
    const on = state.enabled.has(m.id);
    if (on) selectedMaps.push(m);

    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.className = "pool-item" + (m.tall ? "" : " noimg") + (on ? " on" : "");
    b.dataset.id = m.id;
    b.innerHTML = `<span class="bg" ${m.tall ? `style="background-image:url('${m.tall}')"` : ""}></span>
      <span class="check">✓</span><span class="nm">${m.ja}<small>${m.en.toUpperCase()}</small></span>`;
    b.addEventListener("click", () => {
      if (state.vetoPhase > 0) return;
      if (on) state.enabled.delete(m.id);
      else {

        if (state.enabled.size >= 7) return;
        state.enabled.add(m.id);
      }
      el.vetoError.textContent = "";
      renderSetupPool();
    });
    li.appendChild(b);
    el.poolGrid.appendChild(li);
  });

  if (el.poolCount) el.poolCount.textContent = `${state.enabled.size} / 13`;
  $("setup-map-count").textContent = state.enabled.size;

  el.btnStart.disabled = state.enabled.size !== 7;

  const grid = $("selected-7-grid");
  grid.innerHTML = "";
  for (let i = 0; i < 7; i++) {
    const m = selectedMaps[i];
    const li = document.createElement("li");
    li.style.aspectRatio = "3 / 4";
    li.style.width = "100%";
    li.style.display = "block";

    if (m) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pool-item on" + (m.tall ? "" : " noimg");
      b.dataset.id = m.id;
      b.innerHTML = `<span class="bg" ${m.tall ? `style="background-image:url('${m.tall}')"` : ""}></span>
        <span class="nm">${m.ja}<small>${m.en.toUpperCase()}</small></span>`;
      b.onclick = () => {
        state.enabled.delete(m.id);
        renderSetupPool();
      };
      li.appendChild(b);
    } else {
      const div = document.createElement("div");
      div.className = "pool-item noimg";
      div.style.border = "1px dashed rgba(255,255,255,0.2)";
      div.style.background = "rgba(0,0,0,0.2)";
      div.style.height = "100%";
      div.innerHTML = "&nbsp;";
      li.appendChild(div);
    }
    grid.appendChild(li);
  }
}

function getTeamName(t) {
  if (t === 1) return state.team1 || "Team A";
  if (t === 2) return state.team2 || "Team B";
  return "";
}

function startVeto() {
  state.team1 = el.team1.value || "Team A";
  state.team2 = el.team2.value || "Team B";

  let fpVal = "random";
  document.querySelectorAll(".fp-btn").forEach(b => {
    if (b.classList.contains("active")) fpVal = b.dataset.val;
  });
  if (fpVal === "random") {
    state.coinFlipWinner = Math.random() > 0.5 ? 1 : 2;
  } else {
    state.coinFlipWinner = parseInt(fpVal, 10);
  }

  if (state.coinFlipWinner === 2) {
    [state.team1, state.team2] = [state.team2, state.team1];
  }
  state.poolWhenVetoStarted = state.maps.filter(m => state.enabled.has(m.id));
  state.vetoState = [];
  state.vetoPhase = 1;
  el.vetoSetup.hidden = true;
  el.vetoSetup.style.display = "none";
  el.vetoActive.hidden = false;
  $("pool-panel").style.display = "none";
  document.querySelector(".layout").classList.add("veto-active-mode");
  renderVeto();
}

function renderVeto() {
  const p = PHASES[Math.min(state.vetoPhase - 1, 9)];
  const tName = getTeamName(p.team);

  el.slots.innerHTML = "";
  for (let i = 0; i < 7; i++) {
    const s = state.vetoState[i];
    const div = document.createElement("div");
    const pAction = p ? p.action : '';
    const isActiveEmpty = (state.vetoPhase <= 10 && i === state.vetoState.length && pAction !== 'side' && pAction !== 'decider');
    const isActiveSide = (state.vetoPhase <= 10 && i === state.vetoState.length - 1 && pAction === 'side');
    div.className = "veto-slot" + (s ? " filled" : "") + (isActiveEmpty || isActiveSide ? " active-slot" : "");
    if (s) {
      const m = state.maps.find(x => x.id === s.map);
      div.style.backgroundImage = `url('${m.tall}')`;
      if (s.action === 'ban') {
        div.classList.add("ban");
        let isLatestBan = (i === 0 && state.vetoPhase === 2) ||
          (i === 1 && state.vetoPhase === 3) ||
          (i === 4 && state.vetoPhase === 8) ||
          (i === 5 && state.vetoPhase === 10);
        if (isLatestBan) {
          div.classList.add("latest-ban");
        }
        div.innerHTML = `<div class="veto-slot-name">${m.en.toUpperCase()}</div><div class="veto-slot-bottom">${getTeamName(s.team)}<br>VETO MAP</div>`;
      } else if (s.action === 'pick' || s.action === 'decider') {
        div.classList.add("pick");
        let lbl = "";
        if (s.action === 'decider') {
          lbl = s.side ? `${getTeamName(PHASES[9].team)} PICKS` : "";
        } else {
          lbl = `${getTeamName(s.team)} PICKS`;
        }
        let sideText = s.side ? `${s.side}` : "";
        let btmText = s.action === 'decider' ? "DECIDER<br>MAP" : `${getTeamName(s.team)}<br>SELECT MAP`;
        div.innerHTML = `<div class="veto-slot-pick-info"><div class="veto-slot-label">${lbl}</div><div class="veto-slot-side">${sideText}</div></div><div class="veto-slot-name">${m.en.toUpperCase()}</div><div class="veto-slot-bottom">${btmText}</div>`;

        let isLatestSide = s.side && (
          (i === 2 && state.vetoPhase === 5) ||
          (i === 3 && state.vetoPhase === 7) ||
          (i === 6 && state.vetoPhase === 11)
        );
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

  const actionWrapper = $("veto-action-wrapper");
  if (state.vetoPhase <= 1) {
    $("btn-veto-undo").style.display = "none";
  } else {
    $("btn-veto-undo").style.display = "block";
  }

  if (state.vetoPhase > 10) {
    el.turnText.style.visibility = "visible";
    $("veto-instruction-text").style.visibility = "visible";
    el.turnText.textContent = "BAN / PICK 結果";
    $("veto-instruction-text").textContent = "\u00A0";
    if (actionWrapper) {
      actionWrapper.style.gridTemplateRows = "0fr";
      actionWrapper.style.marginBottom = "0";
      actionWrapper.style.opacity = "0";
    }
    if ($("btn-veto-copy")) $("btn-veto-copy").style.display = "block";
    return;
  }

  if ($("btn-veto-copy")) $("btn-veto-copy").style.display = "none";
  if (actionWrapper) {
    actionWrapper.style.gridTemplateRows = "1fr";
    actionWrapper.style.marginBottom = "32px";
    actionWrapper.style.opacity = "1";
  }

  if (state.vetoPhase <= 10) {
    state.poolWhenVetoStarted.forEach(m => {
      const used = state.vetoState.some(v => v.map === m.id);

      const b = document.createElement("button");
      b.className = "pool-item on" + (m.tall ? "" : " noimg") + (used ? " used" : "");
      b.dataset.id = m.id;
      if (used) {
        b.style.filter = "grayscale(1) brightness(0.3)";
        b.style.pointerEvents = "none";
      }
      b.innerHTML = `<span class="bg" ${m.tall ? `style="background-image:url('${m.tall}')"` : ""}></span>
        <span class="nm">${m.ja}<small>${m.en.toUpperCase()}</small></span>`;

      if (!used && p.action !== 'side' && p.action !== 'decider') {
        b.onclick = () => {
          state.vetoState.push({ map: m.id, action: p.action, team: p.team });
          state.vetoPhase++;
          renderVeto();
        };
      }
      el.pool.appendChild(b);
    });
  }

  el.pool.style.opacity = "1";
  el.pool.style.pointerEvents = "auto";

  if (p.action === 'side') {
    el.turnText.style.visibility = "visible";
    if (state.vetoPhase === 10) {
      el.turnText.innerHTML = `DECIDER MAP <span style="font-size: 24px; color: #ddd; margin-left: 8px;">(${tName}: 陣営を選択)</span>`;
    } else {
      el.turnText.textContent = `${tName}: 陣営を選択`;
    }
    $("veto-instruction-text").style.visibility = "hidden";
    el.sideText.style.display = "none";
    el.sideSelect.hidden = false;
    el.pool.style.opacity = "0";
    el.pool.style.pointerEvents = "none";
  } else if (p.action === 'decider') {
    el.turnText.style.visibility = "visible";
    $("veto-instruction-text").style.visibility = "visible";
    el.turnText.textContent = "DECIDER マップ (自動決定)";
    $("veto-instruction-text").textContent = "\u00A0";
    const remaining = state.poolWhenVetoStarted.filter(m => !state.vetoState.some(v => v.map === m.id));
    state.vetoState.push({ map: remaining[0].id, action: 'decider', team: 0 });
    state.vetoPhase++;
    renderVeto();
  } else {
    el.turnText.style.visibility = "visible";
    $("veto-instruction-text").style.visibility = "visible";
    el.turnText.textContent = `${tName} の ${p.action.toUpperCase()} フェーズ`;
    if (p.action === 'ban') {
      $("veto-instruction-text").textContent = "BANするマップを選んでください。";
    } else if (p.action === 'pick') {
      $("veto-instruction-text").textContent = "PICKするマップを選んでください。";
    }
  }
}

function selectSide(side) {
  const lastPick = state.vetoState[state.vetoState.length - 1];
  lastPick.side = side;
  state.vetoPhase++;
  renderVeto();
}

function undoVeto() {
  if (state.vetoPhase <= 1) return;

  if (state.vetoPhase === 11) {
    state.vetoPhase = 10;
    delete state.vetoState[state.vetoState.length - 1].side;
  } else if (state.vetoPhase === 10) {
    state.vetoState.pop(); // remove decider
    state.vetoState.pop(); // remove T2 ban
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

function showConfirm(msg, onOk) {
  $("confirm-msg").textContent = msg;
  $("confirm-modal").hidden = false;

  const okBtn = $("btn-confirm-ok");
  const cancelBtn = $("btn-confirm-cancel");

  const newOk = okBtn.cloneNode(true);
  const newCancel = cancelBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(newOk, okBtn);
  cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

  newCancel.onclick = () => { $("confirm-modal").hidden = true; };
  newOk.onclick = () => {
    $("confirm-modal").hidden = true;
    onOk();
  };
}

function resetVeto() {
  showConfirm("最初からやり直しますか？", () => {
    state.enabled.clear();
    state.vetoState = [];
    state.vetoPhase = 0;
    el.vetoActive.hidden = true;
    el.vetoSetup.style.display = "flex";
    el.vetoSetup.hidden = false;
    $("pool-panel").style.display = "block";
    document.querySelector(".layout").classList.remove("veto-active-mode");
    renderSetupPool();
    $("btn-veto-copy").style.display = "none";
  });
}

function copyVetoResults() {
  const line = "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━";
  let text = "**BO3 BAN/PICK 結果**\n\n" + line + "\n";
  let pickCount = 1;

  const bans = state.vetoState.filter(s => s.action === 'ban');
  const picks = state.vetoState.filter(s => s.action === 'pick' || s.action === 'decider');

  bans.forEach(s => {
    const m = state.maps.find(x => x.id === s.map);
    const tName = getTeamName(s.team);
    text += `:no_entry_sign: ${tName} BAN : **${m.ja}**\n`;
  });
  text += line + "\n";

  picks.forEach(s => {
    const m = state.maps.find(x => x.id === s.map);

    let sideTeamName, sideLabel, sideEmoji, suffix;

    if (s.side === 'ATTACK') {
      sideLabel = 'アタッカー';
      sideEmoji = ':red_circle:';
    } else {
      sideLabel = 'ディフェンダー';
      sideEmoji = ':blue_circle:';
    }

    if (s.action === 'pick') {
      const pickTeamName = getTeamName(s.team);
      sideTeamName = getTeamName(s.team === 1 ? 2 : 1);
      suffix = `(${pickTeamName} PICK)`;
    } else {
      sideTeamName = getTeamName(PHASES[9].team);
      suffix = `(DECIDER)`;
    }

    text += `MAP${pickCount}  **${m.ja}**  (__**${sideTeamName} : ${sideLabel}**__${sideEmoji}) , ${suffix}\n\n`;
    pickCount++;
  });

  navigator.clipboard.writeText(text.trimEnd()).then(() => {
    const btn = $("btn-veto-copy");
    const orig = "結果をコピーする";
    btn.textContent = "コピーしました！";
    setTimeout(() => { btn.textContent = orig; }, 2000);
  });
}

function updateTeamNames() {
  state.team1 = el.team1.value.trim() || "Team A";
  state.team2 = el.team2.value.trim() || "Team B";
  document.querySelectorAll(".fp-btn").forEach(b => {
    if (b.dataset.val === "1") b.textContent = `${state.team1} が先攻`;
    if (b.dataset.val === "2") b.textContent = `${state.team2} が先攻`;
  });
}

async function init() {
  try {
    state.maps = await fetchMaps();
  } catch (err) { console.error(err); }

  el.team1.addEventListener("input", updateTeamNames);
  el.team2.addEventListener("input", updateTeamNames);
  updateTeamNames();

  document.querySelectorAll(".fp-btn").forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll(".fp-btn").forEach(b => {
        b.classList.remove("active");
        b.style.background = "var(--surface-2)";
        b.style.borderColor = "var(--line)";
        b.style.color = "var(--text)";
      });
      btn.classList.add("active");
      btn.style.background = "rgba(255, 70, 85, 0.18)";
      btn.style.borderColor = "var(--accent)";
      btn.style.color = "#fff";
    };
  });

  renderSetupPool();
  el.btnStart.onclick = startVeto;
  el.btnAtk.onclick = () => selectSide('ATTACK');
  el.btnDef.onclick = () => selectSide('DEFENSE');
  $("btn-veto-undo").onclick = undoVeto;
  $("btn-veto-reset").onclick = resetVeto;
  if ($("btn-veto-copy")) $("btn-veto-copy").onclick = copyVetoResults;
}
init();

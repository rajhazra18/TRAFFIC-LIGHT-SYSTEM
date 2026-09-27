const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const ASSET = "assets/";
const images = {
  off: `${ASSET}signal-off.png`,
  red: `${ASSET}signal-red.png`,
  yellow: `${ASSET}signal-yellow.png`,
  green: `${ASSET}signal-green.png`
};

const defaults = { red: 10, yellow: 3, green: 8 };

const presets = {
  normal: { red: 10, yellow: 3, green: 8 },
  peak: { red: 8, yellow: 3, green: 15 }
};


// 3-Phase Cycle: 0: RED -> 1: YELLOW -> 2: GREEN -> (Back to RED)


const cycleSequence = ["red", "yellow", "green"];

const state = {
  signal: "off",
  mode: "manual", 
  paused: false,
  emergency: false,
  night: false,
  phaseIndex: 0, 
  remaining: 0,
  totalPhase: 0,
  timer: null,
  runtimeTimer: null,
  runtime: 0,
  cycles: 0,
  nightCycles: 0,
  activations: { red: 0, yellow: 0, green: 0 },
  changes: 0,
  logs: [],
  timings: { ...defaults },
  settings: { rememberTiming: true, shortcutsEnabled: true },
  sceneLayer: "a"
};


/* --- Helpers --- */


function formatState(signal) {
  if (signal === "red") return "RED";
  if (signal === "yellow") return "YELLOW";
  if (signal === "green") return "GREEN";
  return "OFF";
}

function modeLabel() {
  if (state.emergency) return "Emergency";
  if (state.mode === "auto") return "Auto";
  if (state.mode === "night") return "Night";
  return "Manual";
}

function formatRuntime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function timeNow() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
}

function updateClock() {
  const now = new Date();
  const dateEl = $("#dateText");
  const timeEl = $("#timeText");
  if (dateEl) {
    dateEl.textContent = now.toLocaleDateString([], {
      weekday: "short",
      day: "2-digit",
      month: "short"
    });
  }
  if (timeEl) {
    timeEl.textContent = now.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    });
  }
}


/* --- Asset & Scene Handling --- */


function preloadImages() {
  Object.values(images).forEach((src) => {
    const img = new Image();
    img.src = src;
  });
}

function swapScene(signal) {
  // Update ambient background layers
  const bgTarget = state.sceneLayer === "b" ? $(".scene-a") : $(".scene-b");
  const bgCurrent = state.sceneLayer === "b" ? $(".scene-b") : $(".scene-a");
  
  // Update card scene layers
  const cardTarget = state.sceneLayer === "b" ? $(".card-scene-a") : $(".card-scene-b");
  const cardCurrent = state.sceneLayer === "b" ? $(".card-scene-b") : $(".card-scene-a");

  const imageUrl = `url("${images[signal] || images.off}")`;
  
  if (bgTarget) {
    bgTarget.style.backgroundImage = imageUrl;
    bgTarget.classList.add("visible");
  }
  if (bgCurrent) {
    bgCurrent.classList.remove("visible");
  }

  if (cardTarget) {
    cardTarget.style.backgroundImage = imageUrl;
    cardTarget.classList.add("visible");
  }
  if (cardCurrent) {
    cardCurrent.classList.remove("visible");
  }

  state.sceneLayer = state.sceneLayer === "b" ? "a" : "b";
}


/* --- Logging & Analytics --- */


function addLog(message, signal = state.signal) {
  const item = { time: timeNow(), message, signal };
  state.logs.unshift(item);
  state.logs = state.logs.slice(0, 15);
  renderActivity();
}

function renderActivity() {
  const list = $("#activityList");
  if (!list) return;
  if (!state.logs.length) {
    list.innerHTML = `<div class="empty-log">No activity recorded yet.</div>`;
    return;
  }
  list.innerHTML = state.logs
    .map((item) => {
      const cls = ["red", "yellow", "green"].includes(item.signal) ? item.signal : "";
      return `
      <div class="activity-row">
        <i class="activity-dot ${cls}"></i>
        <span class="activity-time">${item.time}</span>
        <span class="activity-text ${cls}">${item.message}</span>
      </div>`;
    })
    .join("");
}

function updateProgress() {
  const bar = $("#progressBar");
  if (!bar) return;
  if (!state.totalPhase || state.remaining <= 0 || state.mode !== "auto") {
    bar.style.width = "0%";
    return;
  }
  const elapsed = state.totalPhase - state.remaining;
  const pct = Math.min(100, Math.max(0, (elapsed / state.totalPhase) * 100));
  bar.style.width = `${pct}%`;
}


/* --- Timers --- */


function stopSignalTimer() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

function startRuntime() {
  if (state.runtimeTimer) return;
  state.runtimeTimer = setInterval(() => {
    state.runtime += 1;
    const runtimeEl = $("#runtime");
    const analyticsRuntimeEl = $("#analyticsRuntime");
    if (runtimeEl) runtimeEl.textContent = formatRuntime(state.runtime);
    if (analyticsRuntimeEl) analyticsRuntimeEl.textContent = formatRuntime(state.runtime);
  }, 1000);
}


/* --- Signal Control Core --- */


function setSignal(signal, { log = true, automatic = false, preserveTimer = false } = {}) {
  if (state.emergency && signal !== "red") return;

  const previous = state.signal;
  state.signal = signal;

  if (!preserveTimer) {
    state.remaining = signal === "off" ? 0 : (state.timings[signal] || 0);
    state.totalPhase = state.remaining;
  }

  if (signal !== "off" && previous !== signal) {
    state.changes += 1;
    if (state.activations[signal] !== undefined) {
      state.activations[signal] += 1;
    }
  }

  if (signal === "off") {
    stopSignalTimer();
    state.totalPhase = 0;
  }

  swapScene(signal);
  updateUI();

  if (log) {
    addLog(
      signal === "off" ? "System set to OFF" : `${formatState(signal)} activated${automatic ? " automatically" : ""}`,
      signal
    );
  }
}


/* --- Automatic Cycling Logic (RED -> YELLOW -> GREEN -> RED) --- */


function beginAuto({ log = true } = {}) {
  if (state.emergency) return;
  stopSignalTimer();

  state.mode = "auto";
  state.paused = false;
  state.night = false;


  // Initialize at Red (Phase 0) if currently OFF
  if (state.signal === "off") {
    state.phaseIndex = 0;
    setSignal("red", { automatic: true });
  } else {

    // Sync current signal with phaseIndex
    const currentIdx = cycleSequence.indexOf(state.signal);
    state.phaseIndex = currentIdx !== -1 ? currentIdx : 0;
    state.remaining = state.timings[state.signal];
    state.totalPhase = state.remaining;
  }

  updateUI();
  if (log) addLog("Auto mode started");

  state.timer = setInterval(() => {
    if (state.paused || state.emergency || state.mode !== "auto") return;

    state.remaining -= 1;
    updateUI();

    if (state.remaining <= 0) {
      const prevPhase = state.phaseIndex;

      // Sequence: 0: RED -> 1: YELLOW -> 2: GREEN -> 0: RED
      state.phaseIndex = (state.phaseIndex + 1) % cycleSequence.length;

      // When GREEN (index 2) transitions back to RED (index 0), completed cycle count increments
      if (prevPhase === 2 && state.phaseIndex === 0) {
        state.cycles += 1;
      }

      const nextSignalName = cycleSequence[state.phaseIndex];
      setSignal(nextSignalName, { automatic: true });
    }
  }, 1000);
}

function stopAuto({ log = true } = {}) {
  if (state.mode !== "auto") return;
  stopSignalTimer();
  state.mode = "manual";
  state.paused = false;
  updateUI();
  if (log) addLog("Auto mode stopped");
}

function togglePause() {
  if (state.mode !== "auto" || state.emergency) return;
  state.paused = !state.paused;
  updateUI();
  addLog(state.paused ? "Auto mode paused" : "Auto mode resumed");
}

function manualSignal(signal) {
  if (state.emergency) return;
  stopAuto({ log: false });
  state.mode = "manual";
  state.paused = false;
  state.night = false;

  // Sync phaseIndex with manual choice
  const idx = cycleSequence.indexOf(signal);
  if (idx !== -1) state.phaseIndex = idx;

  setSignal(signal);
}


/* --- Operating Presets --- */


function startNightMode() {
  if (state.emergency) return;
  stopSignalTimer();
  state.mode = "night";
  state.paused = false;
  state.night = true;
  state.signal = "yellow";
  state.remaining = 0;
  state.totalPhase = 0;
  state.nightCycles += 1;
  swapScene("yellow");
  updateUI();
  addLog("Night mode enabled · Blinking Yellow", "yellow");
}

function activateEmergency() {
  stopSignalTimer();
  state.emergency = true;
  state.mode = "emergency";
  state.paused = false;
  state.night = false;
  state.remaining = 0;
  state.totalPhase = 0;
  state.signal = "red";
  state.changes += 1;
  state.activations.red += 1;
  swapScene("red");
  updateUI();
  addLog("Emergency mode triggered · RED locked", "red");
}

function resumeNormal() {
  state.emergency = false;
  state.mode = "manual";
  state.paused = false;
  state.night = false;
  stopSignalTimer();
  setSignal("off", { log: false });
  updatePresetButtons("normal");
  updateUI();
  addLog("Emergency mode cleared · System ready");
}

function applyPreset(name) {
  updatePresetButtons(name);
  if (name === "emergency") {
    activateEmergency();
    return;
  }
  if (name === "night") {
    startNightMode();
    return;
  }

  state.emergency = false;
  state.mode = "manual";
  state.paused = false;
  state.night = false;
  state.timings = { ...presets[name] };
  syncTimingInputs();

  if (state.mode === "auto") beginAuto({ log: false });
  else updateUI();

  addLog(name === "peak" ? "Peak Hour preset applied" : "Normal preset applied");
}

function updatePresetButtons(active) {
  $$(".preset-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.preset === active);
  });
}


/* --- Custom Timing --- */


function syncTimingInputs() {
  const redIn = $("#redTiming");
  const yellowIn = $("#yellowTiming");
  const greenIn = $("#greenTiming");
  if (redIn) redIn.value = state.timings.red;
  if (yellowIn) yellowIn.value = state.timings.yellow;
  if (greenIn) greenIn.value = state.timings.green;
}

function readTimingInputs() {
  const redIn = $("#redTiming");
  const yellowIn = $("#yellowTiming");
  const greenIn = $("#greenTiming");
  if (!redIn || !yellowIn || !greenIn) return null;

  const values = {
    red: Number(redIn.value),
    yellow: Number(yellowIn.value),
    green: Number(greenIn.value)
  };
  if (![values.red, values.yellow, values.green].every(Number.isInteger)) return null;
  if (
    values.red < 1 || values.red > 300 ||
    values.yellow < 1 || values.yellow > 120 ||
    values.green < 1 || values.green > 300
  ) {
    return null;
  }
  return values;
}

function applyTiming() {
  const values = readTimingInputs();
  const msg = $("#timingMessage");
  if (!values) {
    if (msg) {
      msg.textContent = "Please enter valid durations within specified ranges.";
      msg.style.color = "var(--red)";
    }
    return;
  }

  state.timings = values;
  if (msg) {
    msg.textContent = "Timing applied successfully.";
    msg.style.color = "var(--green)";
  }

  if (state.settings.rememberTiming) {
    localStorage.setItem("signalflow-timing", JSON.stringify(state.timings));
  }

  addLog(`Timing updated: R:${values.red}s, Y:${values.yellow}s, G:${values.green}s`);
  updateUI();
  setTimeout(() => { if (msg) msg.textContent = ""; }, 3000);
}

function resetSystem({ keepStats = true } = {}) {
  stopSignalTimer();
  state.signal = "off";
  state.mode = "manual";
  state.paused = false;
  state.emergency = false;
  state.night = false;
  state.remaining = 0;
  state.totalPhase = 0;
  state.phaseIndex = 0;

  if (!keepStats) {
    state.cycles = 0;
    state.changes = 0;
    state.nightCycles = 0;
    state.activations = { red: 0, yellow: 0, green: 0 };
    state.runtime = 0;
  }

  updatePresetButtons("normal");
  swapScene("off");
  updateUI();
  addLog("System reset to initial state");
}


/* --- UI Synchronizer --- */


function updateUI() {
  // Mode label & hint
  const hintEl = $("#signalModeHint");
  if (hintEl) hintEl.textContent = `${modeLabel()} mode`;

  const currentEl = $("#currentState");
  if (currentEl) {
    currentEl.textContent = state.emergency
      ? "EMERGENCY"
      : state.signal === "off"
      ? "SYSTEM OFF"
      : formatState(state.signal);
  }

  const sceneStateEl = $("#sceneState");
  if (sceneStateEl) {
    sceneStateEl.textContent = state.signal === "off" ? "OFF" : formatState(state.signal);
  }


  // Countdown timer
  const cd = $("#countdown");
  if (cd) {
    if (state.mode === "auto") {
      cd.textContent = `${String(Math.max(0, state.remaining)).padStart(2, "0")}s`;
    } else if (state.mode === "night") {
      cd.textContent = "BLINK";
    } else {
      cd.textContent = "—";
    }
  }


  // Next State determination: RED -> YELLOW -> GREEN -> RED
  let nextTarget = "—";
  if (state.mode === "auto") {
    const nextIdx = (state.phaseIndex + 1) % cycleSequence.length;
    nextTarget = cycleSequence[nextIdx].toUpperCase();
  } else if (state.mode === "manual") {
    if (state.signal === "red") nextTarget = "YELLOW";
    else if (state.signal === "yellow") nextTarget = "GREEN";
    else if (state.signal === "green") nextTarget = "RED";
    else nextTarget = "—";
  } else if (state.mode === "night") {
    nextTarget = "YELLOW";
  }

  const nextStateEl = $("#nextState");
  if (nextStateEl) nextStateEl.textContent = nextTarget;

  // State Light Indicator
  const stateLight = $("#stateLight");
  if (stateLight) {
    stateLight.className = "state-light";
    if (state.mode === "night") {
      stateLight.classList.add("yellow", "blinking");
    } else if (["red", "yellow", "green"].includes(state.signal)) {
      stateLight.classList.add(state.signal);
    }
  }

  updateProgress();

  // Control Buttons State
  ["red", "yellow", "green"].forEach((sig) => {
    const btn = $(`#${sig}Btn`);
    if (btn) {
      btn.classList.toggle("active", state.signal === sig && state.mode !== "night");
      btn.disabled = state.emergency;
    }
  });

  $("#manualMode")?.classList.toggle("active", state.mode === "manual");
  $("#autoMode")?.classList.toggle("active", state.mode === "auto");


  // Auto Button Text & Icon Update
  const autoText = $("#autoText");
  if (autoText) autoText.textContent = state.mode === "auto" ? "Stop Auto" : "Start Auto";
  const autoIcon = $("#autoIcon");
  if (autoIcon) {
    autoIcon.innerHTML = state.mode === "auto"
      ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="6" y="6" width="12" height="12"></rect></svg>`
      : `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>`;
  }


  // Pause Button Text & Icon Update
  const pauseText = $("#pauseText");
  if (pauseText) pauseText.textContent = state.paused ? "Resume" : "Pause";
  const pauseIcon = $("#pauseIcon");
  if (pauseIcon) {
    pauseIcon.innerHTML = state.paused
      ? `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><polygon points="6 4 20 12 6 20 6 4"></polygon></svg>`
      : `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect></svg>`;
  }

  const pauseBtn = $("#pauseBtn");
  if (pauseBtn) pauseBtn.disabled = state.mode !== "auto" || state.emergency;

  const autoBtn = $("#autoBtn");
  if (autoBtn) autoBtn.disabled = state.emergency;


  // Emergency banner & Status
  $("#emergencyBanner")?.classList.toggle("hidden", !state.emergency);
  
  const statusDot = $("#statusDot");
  const systemStatusEl = $("#systemStatus");

  if (statusDot) {
    statusDot.className = "online-dot";
    if (state.emergency) {
      statusDot.classList.add("emergency");
      if (systemStatusEl) systemStatusEl.textContent = "Emergency Mode";
    } else if (state.paused) {
      statusDot.classList.add("paused");
      if (systemStatusEl) systemStatusEl.textContent = "System Paused";
    } else if (state.mode === "auto") {
      if (systemStatusEl) systemStatusEl.textContent = "Auto Mode Running";
    } else if (state.mode === "night") {
      statusDot.classList.add("paused");
      if (systemStatusEl) systemStatusEl.textContent = "Night Mode";
    } else {
      if (systemStatusEl) systemStatusEl.textContent = "System Online";
    }
  }

  
  // Statistics Display
  const cycleCountEl = $("#cycleCount");
  if (cycleCountEl) cycleCountEl.textContent = state.cycles;

  const redCountEl = $("#redCount");
  if (redCountEl) redCountEl.textContent = state.activations.red;

  const yellowCountEl = $("#yellowCount");
  if (yellowCountEl) yellowCountEl.textContent = state.activations.yellow;

  const greenCountEl = $("#greenCount");
  if (greenCountEl) greenCountEl.textContent = state.activations.green;

  const runtimeEl = $("#runtime");
  if (runtimeEl) runtimeEl.textContent = formatRuntime(state.runtime);

  const modeStatEl = $("#modeStat");
  if (modeStatEl) modeStatEl.textContent = modeLabel();

  const emergencyCountEl = $("#emergencyCount");
  if (emergencyCountEl) emergencyCountEl.textContent = state.emergency ? 1 : 0;

  const nightCountEl = $("#nightCount");
  if (nightCountEl) nightCountEl.textContent = state.nightCycles;

  updateAnalytics();
}

function updateAnalytics() {
  const cChanges = $("#analyticsChanges");
  if (cChanges) cChanges.textContent = state.changes;

  const cCycles = $("#analyticsCycles");
  if (cCycles) cCycles.textContent = state.cycles;

  const cRuntime = $("#analyticsRuntime");
  if (cRuntime) cRuntime.textContent = formatRuntime(state.runtime);

  const cMode = $("#analyticsMode");
  if (cMode) cMode.textContent = modeLabel();

  const cRed = $("#analyticsRed");
  if (cRed) cRed.textContent = state.activations.red;

  const cYellow = $("#analyticsYellow");
  if (cYellow) cYellow.textContent = state.activations.yellow;

  const cGreen = $("#analyticsGreen");
  if (cGreen) cGreen.textContent = state.activations.green;

  const max = Math.max(1, state.activations.red, state.activations.yellow, state.activations.green);
  const redBar = $("#redBar");
  if (redBar) redBar.style.width = `${(state.activations.red / max) * 100}%`;

  const yellowBar = $("#yellowBar");
  if (yellowBar) yellowBar.style.width = `${(state.activations.yellow / max) * 100}%`;

  const greenBar = $("#greenBar");
  if (greenBar) greenBar.style.width = `${(state.activations.green / max) * 100}%`;
}


/* --- View Routing --- */


function openView(viewName) {
  $$(".view").forEach((panel) => {
    panel.classList.toggle("active-view", panel.dataset.viewPanel === viewName);
  });
  $$(".nav-link").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === viewName);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}


/* --- Storage & Settings --- */


function loadSettings() {
  try {
    const savedTiming = JSON.parse(localStorage.getItem("signalflow-timing"));
    if (
      savedTiming &&
      Number.isFinite(savedTiming.red) &&
      Number.isFinite(savedTiming.yellow) &&
      Number.isFinite(savedTiming.green)
    ) {
      state.timings = savedTiming;
    }
    const savedPrefs = JSON.parse(localStorage.getItem("signalflow-prefs"));
    if (savedPrefs) {
      state.settings = { ...state.settings, ...savedPrefs };
    }
  } catch (_) {}

  syncTimingInputs();
  const remEl = $("#rememberTiming");
  if (remEl) remEl.checked = state.settings.rememberTiming;

  const shortEl = $("#shortcutsEnabled");
  if (shortEl) shortEl.checked = state.settings.shortcutsEnabled;
}


/* --- Event Listeners Setup --- */


$("#brandHome")?.addEventListener("click", () => openView("simulator"));
$$(".nav-link").forEach((btn) => btn.addEventListener("click", () => openView(btn.dataset.view)));
$("#analyticsBackBtn")?.addEventListener("click", () => openView("simulator"));
$("#settingsBackBtn")?.addEventListener("click", () => openView("simulator"));

$("#manualMode")?.addEventListener("click", () => {
  if (!state.emergency) {
    stopAuto({ log: false });
    state.mode = "manual";
    state.paused = false;
    updateUI();
    addLog("Manual mode activated");
  }
});

$("#autoMode")?.addEventListener("click", () => {
  if (!state.emergency) beginAuto();
});

$("#redBtn")?.addEventListener("click", () => manualSignal("red"));
$("#yellowBtn")?.addEventListener("click", () => manualSignal("yellow"));
$("#greenBtn")?.addEventListener("click", () => manualSignal("green"));

$("#autoBtn")?.addEventListener("click", () => (state.mode === "auto" ? stopAuto() : beginAuto()));
$("#pauseBtn")?.addEventListener("click", togglePause);
$("#resetBtn")?.addEventListener("click", () => resetSystem({ keepStats: true }));

$$(".preset-btn").forEach((button) =>
  button.addEventListener("click", () => applyPreset(button.dataset.preset))
);

$("#applyTimingBtn")?.addEventListener("click", applyTiming);
$("#restoreTimingBtn")?.addEventListener("click", () => {
  state.timings = { ...defaults };
  syncTimingInputs();
  const msg = $("#timingMessage");
  if (msg) {
    msg.textContent = "Default timing restored. Click Apply.";
    msg.style.color = "var(--cream)";
  }
});


$("#resumeNormalBtn")?.addEventListener("click", resumeNormal);
$("#resetStatsBtn")?.addEventListener("click", () => {
  state.cycles = 0;
  state.changes = 0;
  state.nightCycles = 0;
  state.activations = { red: 0, yellow: 0, green: 0 };
  state.runtime = 0;
  updateUI();
  addLog("Session statistics reset");
});

$("#clearActivityBtn")?.addEventListener("click", () => {
  state.logs = [];
  renderActivity();
});

$("#saveSettingsBtn")?.addEventListener("click", () => {
  const remEl = $("#rememberTiming");
  const shortEl = $("#shortcutsEnabled");
  if (remEl) state.settings.rememberTiming = remEl.checked;
  if (shortEl) state.settings.shortcutsEnabled = shortEl.checked;

  localStorage.setItem("signalflow-prefs", JSON.stringify(state.settings));

  if (state.settings.rememberTiming) {
    localStorage.setItem("signalflow-timing", JSON.stringify(state.timings));
  } else {
    localStorage.removeItem("signalflow-timing");
  }

  const msg = $("#settingsMessage");
  if (msg) {
    msg.textContent = "Preferences saved successfully.";
    msg.style.color = "var(--green)";
  }
  addLog("Preferences saved");
  setTimeout(() => { if (msg) msg.textContent = ""; }, 3000);
});


/* --- Keyboard Handling --- */


document.addEventListener("keydown", (event) => {
  if (!state.settings.shortcutsEnabled) return;


  const tag = document.activeElement?.tagName;
  if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return;

  const key = event.key.toLowerCase();

  if (key === "r") $("#redBtn")?.click();
  else if (key === "y") $("#yellowBtn")?.click();
  else if (key === "g") $("#greenBtn")?.click();
  else if (key === "a") $("#autoBtn")?.click();
  else if (key === "s") stopAuto();
  else if (key === "e") $(".preset-btn[data-preset='emergency']")?.click();
  else if (event.code === "Space") {
    event.preventDefault();
    $("#pauseBtn")?.click();
  } else if (event.key === "Escape") {
    $("#resetBtn")?.click();
  }
});



preloadImages();
loadSettings();
swapScene("off");
renderActivity();
addLog("System initialized · Ready", "off");
startRuntime();
updateClock();
setInterval(updateClock, 1000);
updateUI();
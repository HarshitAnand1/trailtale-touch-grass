/**
 * Trailtale Main App
 * Orchestrates the walk flow: start → sense → play → end → log.
 * Design rule: if a feature needs the screen during a walk, cut it.
 */

(function () {
  "use strict";

  // ── Global state ─────────────────────────────────────────────
  window.trailtaleState = {
    walkId: null,
    storyId: null,
    genre: "mystery",
    isWalking: false,
    isMoving: false,
    segmentsPlayed: 0,
    questsFound: 0,
    distance: 0,
    startTime: null,
    lastMotionTimestamp: null,
    noMovementTimer: null,
    AUTO_END_MINUTES: 10,
  };

  const state = window.trailtaleState;

  // ── DOM refs ─────────────────────────────────────────────────
  const $ = (sel) => document.querySelector(sel);
  const screens = {
    home: $("#screen-home"),
    walk: $("#screen-walk"),
    log: $("#screen-log"),
  };

  // ── Components ───────────────────────────────────────────────
  let walkGate = null;
  let audioQueue = null;
  let questUI = null;

  // ── Init ─────────────────────────────────────────────────────
  function init() {
    // Register service worker
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .catch((e) => console.warn("SW registration failed:", e));
    }

    // Request wake lock to keep screen from sleeping during walk
    requestWakeLock();

    // Genre selection
    document.querySelectorAll(".genre-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document
          .querySelectorAll(".genre-btn")
          .forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        state.genre = btn.dataset.genre;
      });
    });

    // Start walk
    $("#btn-start").addEventListener("click", startWalk);

    // End walk
    $("#btn-end-walk").addEventListener("click", endWalk);

    // New walk
    $("#btn-new-walk").addEventListener("click", () => showScreen("home"));

    // Photo capture handler
    $("#photo-capture").addEventListener("change", handlePhotoCapture);

    // Online/offline status
    updateOnlineStatus();
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);

    // Init quest UI
    questUI = new QuestUI($("#walk-quests"));
  }

  // ── Screen management ────────────────────────────────────────
  function showScreen(name) {
    Object.values(screens).forEach((s) => s.classList.remove("active"));
    screens[name].classList.add("active");
    document.body.classList.remove("dimmed");
  }

  // ── Start walk ───────────────────────────────────────────────
  async function startWalk() {
    showLoading(true);

    try {
      const resp = await fetch("/api/walk/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ genre: state.genre }),
      });

      if (!resp.ok) throw new Error("Failed to start walk");
      const data = await resp.json();

      state.walkId = data.walk_id;
      state.storyId = data.story_id;
      state.isWalking = true;
      state.segmentsPlayed = 0;
      state.questsFound = 0;
      state.distance = 0;
      state.startTime = Date.now();

      // Set quests
      questUI.setQuests(data.quests);

      // Show quest flash for 5 seconds
      showQuestFlash(data.quests);

      // Init walk gate
      walkGate = new WalkGate(onMotionStateChange);
      await walkGate.start();

      // Init audio queue
      audioQueue = new AudioQueue();
      audioQueue.onSegmentStart = onSegmentStart;
      audioQueue.onSegmentEnd = onSegmentEnd;
      audioQueue.onQueueEmpty = onQueueEmpty;

      // Show walk screen
      showScreen("walk");
      startWalkTimer();

      // Pre-fetch the first segment
      fetchNextSegment();

      // Set auto-end timer
      resetAutoEndTimer();

      showToast("Walk started! Put your phone in your pocket.");
    } catch (e) {
      console.error("Start walk error:", e);
      showToast("Could not start walk. Check the server.");
    } finally {
      showLoading(false);
    }
  }

  // ── End walk ─────────────────────────────────────────────────
  async function endWalk() {
    if (!state.isWalking) return;
    state.isWalking = false;

    // Stop components
    if (walkGate) walkGate.stop();
    if (audioQueue) audioQueue.stop();
    clearAutoEndTimer();
    stopWalkTimer();

    showLoading(true);
    try {
      const resp = await apiFetch(
        `/api/walk/end?walk_id=${encodeURIComponent(state.walkId)}`,
        {
          method: "POST",
        },
      );
      if (!resp.ok) throw new Error("Failed to end walk");
      const data = await resp.json();

      renderWalkLog(data.walk_log);
      showScreen("log");
    } catch (e) {
      console.error("End walk error:", e);
      // Show a basic log even without server
      renderFallbackLog();
      showScreen("log");
    } finally {
      showLoading(false);
    }
  }

  // ── Motion state changes ─────────────────────────────────────
  function onMotionStateChange(isMoving, speed) {
    state.isMoving = isMoving;
    const dot = $("#walk-state-dot");
    const label = $("#walk-state-label");
    const wave = $("#sound-wave");

    if (isMoving) {
      dot.className = "walk-state-indicator moving";
      label.textContent = `Moving · ${speed.toFixed(1)} m/s`;
      wave.classList.remove("paused");
      audioQueue.play();
      resetAutoEndTimer();

      // Update distance estimate
      state.distance += speed;
      $("#stat-distance").textContent = Math.round(state.distance);

      // If queue is low, fetch next segment
      if (audioQueue.queue.length === 0) {
        fetchNextSegment();
      }
    } else {
      dot.className = "walk-state-indicator still";
      label.textContent = "Paused";
      wave.classList.add("paused");
      audioQueue.pause();
    }

    // Dim screen after state change (keep screen use minimal)
    clearTimeout(state._dimTimeout);
    state._dimTimeout = setTimeout(() => {
      if (state.isWalking) document.body.classList.add("dimmed");
    }, 8000);
  }

  // ── Story segment management ─────────────────────────────────
  async function fetchNextSegment() {
    if (!state.isWalking) return;
    try {
      const resp = await apiFetch("/api/story/segment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walk_id: state.walkId }),
      });
      if (!resp.ok) return;
      const segment = await resp.json();

      audioQueue.enqueue(segment);
    } catch (e) {
      console.warn("Segment fetch failed:", e);
    }
  }

  function onSegmentStart(segment) {
    const text = segment.text || "";
    $("#now-playing-text").textContent = text;
    $("#now-playing-segment").textContent =
      `Segment ${segment.segment_number || segment.segmentNumber}`;
    state.segmentsPlayed++;
    $("#stat-segments").textContent = state.segmentsPlayed;

    // Pre-fetch next while this one plays
    fetchNextSegment();
  }

  function onSegmentEnd(_segment) {
    // Will auto-play next from queue
  }

  function onQueueEmpty() {
    // Ambient pause plays automatically via AudioQueue
    $("#now-playing-text").textContent = "The trail is quiet for a moment…";
    $("#now-playing-segment").textContent = "";
  }

  // ── Quest photo capture ──────────────────────────────────────
  let pendingQuestId = null;

  window.trailtaleApp = {
    captureQuestPhoto(questId) {
      pendingQuestId = questId;
      $("#photo-capture").click();
    },
  };

  async function handlePhotoCapture(event) {
    const file = event.target.files[0];
    if (!file || !pendingQuestId) return;

    const formData = new FormData();
    formData.append("photo", file);

    showToast("Checking photo…");

    try {
      const resp = await fetch(
        `/api/photo/check?walk_id=${encodeURIComponent(state.walkId)}&quest_id=${encodeURIComponent(pendingQuestId)}`,
        { method: "POST", body: formData },
      );
      if (!resp.ok) throw new Error("Photo check failed");
      const result = await resp.json();

      if (result.confirmed) {
        questUI.markFound(pendingQuestId, true);
        state.questsFound++;
        $("#stat-quests").textContent = state.questsFound;
        showToast(`✅ Found! ${result.reason}`);
        // Haptic
        if (navigator.vibrate) navigator.vibrate(200);
      } else {
        showToast(`❌ Not a match: ${result.reason}`);
      }
    } catch (e) {
      console.warn("Photo check error:", e);
      // Manual fallback
      if (
        confirm(`Vision model unavailable. Count "${pendingQuestId}" as found?`)
      ) {
        manualQuestFind(pendingQuestId);
      }
    }

    // Reset
    pendingQuestId = null;
    event.target.value = "";
  }

  async function manualQuestFind(questId) {
    try {
      await fetch(
        `/api/quest/find?walk_id=${encodeURIComponent(state.walkId)}&quest_id=${encodeURIComponent(questId)}`,
        {
          method: "POST",
        },
      );
    } catch (e) {
      /* offline */
    }
    questUI.markFound(questId, false);
    state.questsFound++;
    $("#stat-quests").textContent = state.questsFound;
    showToast(`📝 Manually counted: ${questId}`);
  }

  // ── Walk timer ───────────────────────────────────────────────
  let timerInterval = null;

  function startWalkTimer() {
    timerInterval = setInterval(() => {
      if (!state.startTime) return;
      const elapsed = Math.floor((Date.now() - state.startTime) / 1000);
      const min = String(Math.floor(elapsed / 60)).padStart(2, "0");
      const sec = String(elapsed % 60).padStart(2, "0");
      $("#walk-timer").textContent = `${min}:${sec}`;
    }, 1000);
  }

  function stopWalkTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  // ── Auto-end after 10 minutes of no movement ────────────────
  function resetAutoEndTimer() {
    clearAutoEndTimer();
    state.noMovementTimer = setTimeout(
      () => {
        if (state.isWalking && !state.isMoving) {
          showToast("No movement for 10 minutes — ending walk.");
          endWalk();
        }
      },
      state.AUTO_END_MINUTES * 60 * 1000,
    );
  }

  function clearAutoEndTimer() {
    if (state.noMovementTimer) {
      clearTimeout(state.noMovementTimer);
      state.noMovementTimer = null;
    }
  }

  // ── Quest flash (5-second display on walk start) ─────────────
  function showQuestFlash(quests) {
    const today = new Date().toISOString().slice(0, 10);
    const active = quests.filter(
      (q) => q.starts <= today && q.expires >= today,
    );
    if (active.length === 0) return;

    const flash = document.createElement("div");
    flash.className = "quest-flash";
    flash.innerHTML = `
      <h2>This Week's Quests</h2>
      <ul class="quest-list">
        ${active
          .map(
            (q) => `
          <li class="quest-item">
            <span class="quest-icon">🔍</span>
            <div class="quest-info">
              <span class="quest-title">${q.title}</span>
              <span class="quest-hint">${q.hint}</span>
            </div>
          </li>
        `,
          )
          .join("")}
      </ul>
    `;
    document.body.appendChild(flash);

    // Remove after animation completes
    setTimeout(() => flash.remove(), 5500);
  }

  // ── Walk log rendering ───────────────────────────────────────
  function renderWalkLog(log) {
    const statsGrid = $("#log-stats");
    statsGrid.innerHTML = `
      <div class="log-stat">
        <span class="log-stat-label">Distance</span>
        <span class="log-stat-value">${Math.round(log.distance_m)} m</span>
      </div>
      <div class="log-stat">
        <span class="log-stat-label">Moving</span>
        <span class="log-stat-value">${log.moving_minutes} min</span>
      </div>
      <div class="log-stat">
        <span class="log-stat-label">Still</span>
        <span class="log-stat-value">${log.still_minutes} min</span>
      </div>
      <div class="log-stat">
        <span class="log-stat-label">Segments</span>
        <span class="log-stat-value">${log.segments_played}</span>
      </div>
    `;

    $("#log-story-title").textContent = `Story: ${log.story_title}`;

    const questsList = $("#log-quests-list");
    if (log.quests_found.length > 0) {
      questsList.innerHTML = log.quests_found
        .map((qid) => `<li>✅ ${qid}</li>`)
        .join("");
    } else {
      questsList.innerHTML =
        "<li>None this walk — there's always next time!</li>";
    }
  }

  function renderFallbackLog() {
    const elapsed = state.startTime
      ? Math.floor((Date.now() - state.startTime) / 1000)
      : 0;
    renderWalkLog({
      distance_m: state.distance,
      moving_minutes: Math.round(elapsed / 60),
      still_minutes: 0,
      segments_played: state.segmentsPlayed,
      story_title: `${state.genre} — ${state.storyId || "unknown"}`,
      quests_found: [],
    });
  }

  // ── Utilities ────────────────────────────────────────────────
  function showLoading(visible) {
    const el = $("#loading");
    el.classList.toggle("visible", visible);
  }

  function showToast(msg, duration = 3000) {
    const el = $("#toast");
    el.textContent = msg;
    el.classList.add("visible");
    setTimeout(() => el.classList.remove("visible"), duration);
  }

  function updateOnlineStatus() {
    const dot = $("#status-dot");
    const text = $("#status-text");
    if (navigator.onLine) {
      dot.classList.remove("offline");
      text.textContent = "Ready";
    } else {
      dot.classList.add("offline");
      text.textContent = "Offline";
    }
  }

  async function requestWakeLock() {
    if ("wakeLock" in navigator) {
      try {
        await navigator.wakeLock.request("screen");
      } catch (e) {
        console.warn("Wake lock failed:", e);
      }
    }
  }

  // ── API helpers ──────────────────────────────────────────────
  const API_BASES = [
    window.location.origin,
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://0.0.0.0:8000",
  ].filter((value, index, arr) => value && arr.indexOf(value) === index);

  async function apiFetch(path, options = {}) {
    const init = { ...options, headers: { ...(options.headers || {}) } };

    const candidateUrls = [
      path,
      ...API_BASES.map(
        (base) => `${base}${path.startsWith("/") ? path : `/${path}`}`,
      ),
    ].filter((value, index, arr) => value && arr.indexOf(value) === index);

    let lastError = null;

    for (const url of candidateUrls) {
      try {
        const resp = await fetch(url, init);
        if (resp.ok || resp.status === 404 || resp.status === 500) {
          return resp;
        }
      } catch (error) {
        lastError = error;
      }
    }

    if (lastError) throw lastError;
    throw new Error(`API request failed for ${path}`);
  }

  async function fetchJson(path, options = {}) {
    const resp = await apiFetch(path, options);
    return resp.json();
  }

  // ── Boot ─────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", init);
})();

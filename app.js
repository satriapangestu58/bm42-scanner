(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const state = {
    scanner: null,
    scanning: false,
    lastToken: "",
    lastScanAt: 0,
    currentEvent: null,
    requestSeq: 0,
  };

  $("scannerId").value = BM42_DEFAULT_SCANNER_ID;

  function ensureApiConfigured() {
    if (!BM42_API_URL || BM42_API_URL.includes("PASTE_YOUR")) {
      throw new Error("BM42_API_URL belum diisi di config.js");
    }
  }

  function setBadge(text, kind="neutral") {
    const el = $("connectionBadge");
    el.textContent = text;
    el.className = "badge " + kind;
  }

  function setResult(kind, title, detail="") {
    const card = $("resultCard");
    card.className = "card result " + (kind === "ok" ? "ok-result" :
      kind === "warn" ? "warn-result" :
      kind === "bad" ? "bad-result" : "neutral-result");
    $("resultTitle").textContent = title;
    $("resultDetail").textContent = detail;
  }

  function escapeJsonpCallback(name) {
    return /^[A-Za-z_$][0-9A-Za-z_$]*$/.test(name);
  }

  function jsonp(params, timeoutMs=10000) {
    return new Promise((resolve, reject) => {
      const name = "__bm42_jsonp_" + Date.now() + "_" + (++state.requestSeq);
      const callbackParam = "prefix";
      const url = new URL(BM42_API_URL);
      Object.entries(params).forEach(([k,v]) => url.searchParams.set(k, v));
      url.searchParams.set(callbackParam, name);

      if (!escapeJsonpCallback(name)) {
        reject(new Error("Invalid JSONP callback"));
        return;
      }

      let finished = false;
      const script = document.createElement("script");
      const cleanup = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        delete window[name];
        script.remove();
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error("Timeout saat menghubungi backend Apps Script."));
      }, timeoutMs);

      window[name] = (payload) => {
        cleanup();
        resolve(payload);
      };
      script.onerror = () => {
        cleanup();
        reject(new Error("Backend tidak dapat dihubungi."));
      };
      script.src = url.toString();
      document.body.appendChild(script);
    });
  }

  async function refreshState() {
    try {
      ensureApiConfigured();
      const payload = await jsonp({action: "state"});
      if (!payload || !payload.ok) {
        throw new Error(payload?.message || "State API gagal.");
      }

      $("serverTime").textContent = payload.serverTime
        ? payload.serverTime.split(" ")[1]
        : "--:--:--";

      state.currentEvent = payload.event || null;
      if (payload.event) {
        $("checkpoint").textContent = payload.event.label || payload.event.id;
        setBadge("CONNECTED • EVENT ACTIVE", "ok");
      } else {
        $("checkpoint").textContent = "Tidak ada checkpoint aktif";
        setBadge("CONNECTED • NO EVENT", "neutral");
      }
    } catch (err) {
      setBadge("BACKEND ERROR", "bad");
      $("checkpoint").textContent = "Backend tidak dapat dihubungi";
      setResult("bad", "Backend error", err.message);
    }
  }

  async function submitToken(token) {
    const clean = String(token || "").trim();
    if (!clean) return;

    const now = Date.now();
    if (clean === state.lastToken && now - state.lastScanAt < BM42_SCAN_COOLDOWN_MS) {
      return;
    }
    state.lastToken = clean;
    state.lastScanAt = now;

    try {
      ensureApiConfigured();
      const scannerId = $("scannerId").value.trim() || BM42_DEFAULT_SCANNER_ID;

      const payload = await jsonp({
        action: "scan",
        token: clean,
        scanner: scannerId
      }, 12000);

      renderScanResult(payload);
      await refreshState();
    } catch (err) {
      setResult("bad", "Scan gagal", err.message);
    }
  }

  function renderScanResult(payload) {
    if (!payload) {
      setResult("bad", "Tidak ada respons", "Backend tidak mengembalikan data.");
      return;
    }

    if (payload.status === "ACCEPTED") {
      const p = payload.participant || {};
      setResult(
        "ok",
        p.drug || p.name || "SCAN BERHASIL",
        `${p.id || ""} • ${p.group || ""} • ${payload.event?.label || ""} • ${payload.statusLabel || payload.event?.status || ""}`
      );
      return;
    }

    if (payload.code === "DUPLICATE" || payload.status === "DUPLICATE") {
      const p = payload.participant || {};
      setResult(
        "warn",
        "ALREADY RECORDED",
        `${p.drug || p.name || p.id || ""} • Peserta sudah tercatat pada checkpoint ini.`
      );
      return;
    }

    if (payload.code === "UNKNOWN_QR" || payload.status === "UNKNOWN_QR") {
      setResult("bad", "QR TIDAK TERDAFTAR", payload.message || "Token tidak ditemukan.");
      return;
    }

    if (payload.code === "NO_ACTIVE_EVENT" || payload.status === "NO_ACTIVE_EVENT") {
      setResult("warn", "Tidak ada checkpoint aktif", payload.message || "");
      return;
    }

    if (payload.status === "LATE") {
      const p = payload.participant || {};
      setResult(
        "warn",
        p.drug || p.name || "TERCATAT TERLAMBAT",
        `${p.id || ""} • ${p.group || ""} • ${payload.event?.label || ""} • LATE`
      );
      return;
    }

    if (payload.ok === false) {
      setResult("bad", payload.code || "SCAN DITOLAK", payload.message || "");
      return;
    }

    setResult("neutral", "Respons backend", JSON.stringify(payload));
  }

  async function startCamera() {
    try {
      ensureApiConfigured();

      if (!window.Html5Qrcode) {
        throw new Error("Library html5-qrcode tidak termuat.");
      }

      if (state.scanning) return;

      state.scanner = new Html5Qrcode("reader");
      const config = {
        fps: 10,
        qrbox: {width: 260, height: 260},
        aspectRatio: 1.333334,
        rememberLastUsedCamera: true
      };

      await state.scanner.start(
        {facingMode: "environment"},
        config,
        decodedText => {
          submitToken(decodedText);
        },
        () => {}
      );

      state.scanning = true;
      $("startBtn").disabled = true;
      $("stopBtn").disabled = false;
      setResult("neutral", "Camera aktif", "Arahkan QR peserta ke area scan.");
    } catch (err) {
      state.scanning = false;
      setResult("bad", "Camera gagal dibuka", String(err?.message || err));
    }
  }

  async function stopCamera() {
    if (!state.scanner || !state.scanning) return;
    try {
      await state.scanner.stop();
      state.scanner.clear();
    } catch (_) {}
    state.scanning = false;
    state.scanner = null;
    $("startBtn").disabled = false;
    $("stopBtn").disabled = true;
    setResult("neutral", "Camera berhenti", "Tekan Start Camera untuk melanjutkan.");
  }

  $("startBtn").addEventListener("click", startCamera);
  $("stopBtn").addEventListener("click", stopCamera);
  $("refreshBtn").addEventListener("click", refreshState);
  $("processBtn").addEventListener("click", () => submitToken($("tokenInput").value));
  $("tokenInput").addEventListener("keydown", e => {
    if (e.key === "Enter") submitToken(e.target.value);
  });

  refreshState();
  setInterval(refreshState, BM42_STATE_POLL_MS);
})();

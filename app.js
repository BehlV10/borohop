/**
 * BoroHop — Modern NYC Events Finder
 * Standalone, privacy-first, zero-tracking web application.
 */
(function() {
  "use strict";

  // Register PWA Service Worker for offline subway use
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch((err) => {
        console.warn("ServiceWorker registration failed:", err);
      });
    });
  }

  /* ============ State & Data ============ */
  let ALL_EVENTS = [];
  let lastFiltered = [];
  let userCoords = null; // { lat, lng } from Geolocation
  let filterNearMeActive = false;
  let filterSavedActive = false;
  let imagesEnabled = true;
  let dateMode = "upcoming"; // "upcoming" | "past"
  let searchText = "";
  let pageIndex = 0;
  const EVENTS_PER_PAGE = 4;
  let pageBreaks = [0];

  /* ============ Saved / Starred Events (localStorage) ============ */
  const SAVED_STORAGE_KEY = "borohop_saved_events";
  function getSavedEventKeys() {
    try {
      return new Set(JSON.parse(localStorage.getItem(SAVED_STORAGE_KEY) || "[]"));
    } catch {
      return new Set();
    }
  }
  function saveEventKeys(set) {
    try {
      localStorage.setItem(SAVED_STORAGE_KEY, JSON.stringify([...set]));
    } catch (e) {
      console.warn("Could not write to localStorage:", e);
    }
    updateSavedCountBadge();
  }
  function eventKey(ev) {
    return ev.rsvpUrl || `${ev.name}_${ev.start}`;
  }
  function isSaved(ev) {
    return getSavedEventKeys().has(eventKey(ev));
  }
  function toggleSaved(ev) {
    const keys = getSavedEventKeys();
    const k = eventKey(ev);
    if (keys.has(k)) {
      keys.delete(k);
      showToast("Removed from Saved");
    } else {
      keys.add(k);
      showToast("⭐ Added to Saved events");
    }
    saveEventKeys(keys);
    renderList(lastFiltered);
    if (filterSavedActive) applyFilters();
  }
  function updateSavedCountBadge() {
    const el = document.getElementById("savedCountBadge");
    if (el) el.textContent = getSavedEventKeys().size;
  }

  /* ============ Dark Mode Theme ============ */
  const THEME_KEY = "borohop_theme";
  const themeToggleBtn = document.getElementById("themeToggleBtn");
  const themeIcon = document.getElementById("themeIcon");
  const themeText = document.getElementById("themeText");

  function initTheme() {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") {
      applyTheme(saved === "dark");
    } else {
      const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      applyTheme(prefersDark);
    }

    if (window.matchMedia) {
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => {
        if (!localStorage.getItem(THEME_KEY)) {
          applyTheme(e.matches);
        }
      });
    }
  }
  function applyTheme(isDark) {
    document.documentElement.setAttribute("data-theme", isDark ? "dark" : "light");
    if (themeIcon) themeIcon.textContent = isDark ? "☀️" : "🌙";
    if (themeText) themeText.textContent = isDark ? "Light" : "Dark";
  }
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") === "dark";
      const next = !current;
      applyTheme(next);
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    });
  }
  initTheme();

  /* ============ Toast Feedback ============ */
  let toastTimer = null;
  function showToast(msg) {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = msg;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 2600);
  }

  /* ============ Share View & Deep Linking ============ */
  const shareBtn = document.getElementById("shareBtn");
  if (shareBtn) {
    shareBtn.addEventListener("click", () => {
      updateUrlState();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(window.location.href).then(() => {
          showToast("🔗 Link copied to clipboard!");
        }).catch(() => {
          showToast("URL updated in address bar");
        });
      } else {
        showToast("URL updated in address bar");
      }
    });
  }

  function updateUrlState() {
    const params = new URLSearchParams();
    if (dateMode !== "upcoming") params.set("mode", dateMode);
    if (searchText) params.set("q", searchText);
    if (filterSavedActive) params.set("saved", "1");
    if (typeMulti.values.size > 0) params.set("types", [...typeMulti.values].join(","));
    if (locMulti.values.size > 0) params.set("locs", [...locMulti.values].join(","));
    if (priceMulti.values.size > 0) params.set("prices", [...priceMulti.values].join(","));
    const viewMode = document.body.classList.contains("view-map") ? "map" : "list";
    if (viewMode !== "list") params.set("view", viewMode);

    const newUrl = window.location.pathname + (params.toString() ? "?" + params.toString() : "");
    window.history.replaceState({}, "", newUrl);
  }

  function applyUrlParams() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("mode")) {
      dateMode = params.get("mode") === "past" ? "past" : "upcoming";
      document.querySelectorAll(".dms-btn").forEach(b => {
        b.classList.toggle("active", b.dataset.mode === dateMode);
      });
    }
    if (params.get("q")) {
      searchText = params.get("q");
      document.getElementById("searchBox").value = searchText;
    }
    if (params.get("saved") === "1") {
      filterSavedActive = true;
      document.getElementById("chipSaved").classList.add("active");
    }
    if (params.get("types")) {
      const types = params.get("types").split(",");
      types.forEach(t => typeMulti.values.add(t));
      typeMulti.refreshLabel();
    }
    if (params.get("locs")) {
      const locs = params.get("locs").split(",");
      locs.forEach(l => locMulti.values.add(l));
      locMulti.refreshLabel();
    }
    if (params.get("prices")) {
      const prices = params.get("prices").split(",");
      prices.forEach(p => priceMulti.values.add(p));
      priceMulti.refreshLabel();
    }
    if (params.get("view") === "map") {
      const mapRadio = document.querySelector('input[name="viewMode"][value="map"]');
      if (mapRadio) {
        mapRadio.checked = true;
        mapRadio.dispatchEvent(new Event("change"));
      }
    }
  }

  /* ============ Category Colors & Emojis ============ */
  const TYPE_COLORS = {
    "Board Games": "#8D6E63",
    "Concerts": "#6A1B9A",
    "Culture": "#B8860B",
    "Dance": "#D81B60",
    "EDM": "#7C4DFF",
    "Field Trip": "#EF6C00",
    "Film": "#37474F",
    "Food": "#E64A19",
    "Museums": "#1A237E",
    "Nature": "#2E7D32",
    "Sports": "#1565C0",
    "Theatre": "#AD1457"
  };
  const TYPE_EMOJIS = {
    "Board Games": "🎲",
    "Concerts": "🎤",
    "Culture": "🎨",
    "Dance": "💃",
    "EDM": "🎧",
    "Field Trip": "🚌",
    "Film": "🎬",
    "Food": "🍔",
    "Museums": "🏛️",
    "Nature": "🌳",
    "Sports": "⚽",
    "Theatre": "🎭"
  };
  function typeColor(t) { return TYPE_COLORS[t] || "#5B584F"; }
  function typeEmoji(t) { return TYPE_EMOJIS[t] || "📍"; }
  function primaryType(ev) { return [...(ev.types || ["Culture"])].sort()[0]; }

  /* ============ Real MTA Subway Bullet Colors ============ */
  const LINE_COLORS = {
    "1":{bg:"#EE352E",fg:"#fff",group:1}, "2":{bg:"#EE352E",fg:"#fff",group:1}, "3":{bg:"#EE352E",fg:"#fff",group:1},
    "4":{bg:"#00933C",fg:"#fff",group:2}, "5":{bg:"#00933C",fg:"#fff",group:2}, "6":{bg:"#00933C",fg:"#fff",group:2},
    "7":{bg:"#B933AD",fg:"#fff",group:3},
    "A":{bg:"#0039A6",fg:"#fff",group:4}, "C":{bg:"#0039A6",fg:"#fff",group:4}, "E":{bg:"#0039A6",fg:"#fff",group:4},
    "B":{bg:"#FF6319",fg:"#fff",group:5}, "D":{bg:"#FF6319",fg:"#fff",group:5}, "F":{bg:"#FF6319",fg:"#fff",group:5}, "M":{bg:"#FF6319",fg:"#fff",group:5},
    "G":{bg:"#6CBE45",fg:"#000",group:6},
    "J":{bg:"#996633",fg:"#fff",group:7}, "Z":{bg:"#996633",fg:"#fff",group:7},
    "L":{bg:"#A7A9AC",fg:"#000",group:8},
    "N":{bg:"#FCCC0A",fg:"#000",group:9}, "Q":{bg:"#FCCC0A",fg:"#000",group:9}, "R":{bg:"#FCCC0A",fg:"#000",group:9}, "W":{bg:"#FCCC0A",fg:"#000",group:9},
    "S":{bg:"#808183",fg:"#fff",group:10}
  };
  function subwayBullets(lines) {
    if (!lines || !lines.length) return "";
    const sorted = [...lines].sort((a,b) => (LINE_COLORS[a]?.group || 99) - (LINE_COLORS[b]?.group || 99) || a.localeCompare(b));
    return sorted.map(l => {
      const c = LINE_COLORS[l] || {bg:"#5B584F",fg:"#fff"};
      return `<span class="subway-bullet" style="background:${c.bg};color:${c.fg}">${escapeAttr(l)}</span>`;
    }).join("");
  }

  /* ============ Directions: Google Maps ============ */
  function googleMapsDirectionsUrl(ev) {
    const dest = (ev.locationName ? ev.locationName + ", " : "") + (ev.address || "");
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`;
  }

  /* ============ Date & Time Formatting ============ */
  const pad = n => String(n).padStart(2,"0");
  const ymd = (y,m,d) => `${y}-${pad(m+1)}-${pad(d)}`;
  const todayObj = new Date();
  const todayISO = ymd(todayObj.getFullYear(), todayObj.getMonth(), todayObj.getDate());
  const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sept","Oct","Nov","Dec"];
  const DOW_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

  function ordinalSuffix(n) {
    const v = n % 100;
    if (v >= 11 && v <= 13) return "th";
    switch(n % 10) {
      case 1: return "st";
      case 2: return "nd";
      case 3: return "rd";
      default: return "th";
    }
  }
  function fmtDayCompact(iso) {
    if (!iso) return "";
    const [y,m,d] = iso.split("-").map(Number);
    const dow = DOW_FULL[new Date(y,m-1,d).getDay()];
    return `${dow}, ${MONTH_SHORT[m-1]} ${d}${ordinalSuffix(d)}`;
  }
  function to12(hhmm) {
    if (!hhmm) return { h12: 12, mm: "", period: "pm" };
    const [h,m] = hhmm.split(":").map(Number);
    const period = h >= 12 ? "pm" : "am";
    let h12 = h % 12; if (h12 === 0) h12 = 12;
    const mm = m === 0 ? "" : ":" + pad(m);
    return { h12, mm, period };
  }
  function timeCell(ev) {
    if (!ev.startTime || !ev.endTime) return "";
    const s = to12(ev.startTime), e = to12(ev.endTime);
    const startStr = `${s.h12}${s.mm}`;
    const endStr = `${e.h12}${e.mm}${e.period}`;
    return s.period === e.period ? `${startStr} to ${endStr}` : `${startStr}${s.period} to ${endStr}`;
  }
  function isUpcoming(ev) {
    const evEnd = ev.end || ev.start;
    if (evEnd > todayISO) return true;
    if (evEnd < todayISO) return false;
    // same day: compare time + 1 hr
    if (!ev.endTime) return true;
    const [h, m] = ev.endTime.split(":").map(Number);
    const endMinutes = h * 60 + m + 60;
    const nowMinutes = todayObj.getHours() * 60 + todayObj.getMinutes();
    return endMinutes >= nowMinutes;
  }

  /* ============ Calendar Export (Google & Apple .ics) ============ */
  function nyWallTimeToUTC(y, mo, d, hh, mm) {
    const guess = new Date(Date.UTC(y, mo-1, d, hh, mm));
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hour12: false,
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
    const p = Object.fromEntries(fmt.formatToParts(guess).map(x=>[x.type,x.value]));
    const nyReadAsUTC = Date.UTC(+p.year, +p.month-1, +p.day, (+p.hour)%24, +p.minute, +p.second);
    const diff = nyReadAsUTC - guess.getTime();
    return new Date(guess.getTime() - diff);
  }

  function getEventUTCRange(ev) {
    const [y, mo, d] = ev.start.split("-").map(Number);
    const [ey, emo, ed] = (ev.end || ev.start).split("-").map(Number);
    const [sh, sm] = (ev.startTime || "19:00").split(":").map(Number);
    const [eh, em] = (ev.endTime || "21:00").split(":").map(Number);
    return {
      startUTC: nyWallTimeToUTC(y, mo, d, sh, sm),
      endUTC: nyWallTimeToUTC(ey, emo, ed, eh, em)
    };
  }

  function googleCalendarUrl(ev) {
    const { startUTC, endUTC } = getEventUTCRange(ev);
    const fmt = dt => dt.toISOString().replace(/[-:]/g,"").split(".")[0] + "Z";
    const details = [
      ev.name,
      "",
      `Location: ${ev.locationName ? ev.locationName + ' - ' : ''}${ev.address}`,
      ev.thingsToKnow ? `Note: ${ev.thingsToKnow}` : "",
      ev.rsvpUrl ? `RSVP: ${ev.rsvpUrl}` : "",
      `Google Maps: ${googleMapsDirectionsUrl(ev)}`
    ].filter(Boolean).join("\n");

    const params = new URLSearchParams({
      action: "TEMPLATE",
      text: ev.name,
      dates: `${fmt(startUTC)}/${fmt(endUTC)}`,
      details,
      location: ev.address || ""
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  function downloadIcsFile(ev) {
    const { startUTC, endUTC } = getEventUTCRange(ev);
    const fmt = dt => dt.toISOString().replace(/[-:]/g,"").split(".")[0] + "Z";
    const uid = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}@borohop.org`;
    const cleanStr = str => (str || "").replace(/[,;\\]/g, "\\$&").replace(/\n/g, "\\n");

    const icsContent = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//BoroHop//Events Finder//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${fmt(new Date())}`,
      `DTSTART:${fmt(startUTC)}`,
      `DTEND:${fmt(endUTC)}`,
      `SUMMARY:${cleanStr(ev.name)}`,
      `DESCRIPTION:${cleanStr((ev.thingsToKnow ? ev.thingsToKnow + "\\n\\n" : "") + (ev.rsvpUrl ? "RSVP: " + ev.rsvpUrl : ""))}`,
      `LOCATION:${cleanStr(ev.address || ev.locationName)}`,
      ev.rsvpUrl ? `URL:${ev.rsvpUrl}` : "",
      "END:VEVENT",
      "END:VCALENDAR"
    ].filter(Boolean).join("\r\n");

    const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${ev.name.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30)}.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    showToast("Downloaded .ics for Apple / Outlook Calendar");
  }

  /* ============ Geolocation: Haversine Distance ============ */
  function haversineMiles(lat1, lon1, lat2, lon2) {
    const R = 3958.8; // Radius in miles
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  function toggleNearMe() {
    if (filterNearMeActive) {
      filterNearMeActive = false;
      document.getElementById("chipNearMe").classList.remove("active");
      applyFilters();
      return;
    }
    if (!navigator.geolocation) {
      showToast("Geolocation is not supported by your browser");
      return;
    }
    showToast("Finding your location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        filterNearMeActive = true;
        document.getElementById("chipNearMe").classList.add("active");
        showToast("📍 Sorted by closest distance!");
        applyFilters();
      },
      (err) => {
        showToast("Location access denied or unavailable");
        console.warn(err);
      },
      { timeout: 8000 }
    );
  }

  /* ============ Quick Preset Chips Handler ============ */
  function updatePresetChipsUI() {
    const chipAll = document.getElementById("chipAll");
    const anyPresetActive = filterSavedActive || filterNearMeActive || (priceMulti.values.size > 0 && priceMulti.values.has("free")) || (typeMulti.values.size > 0 && (typeMulti.values.has("Food") || typeMulti.values.has("Board Games"))) || datesPicker.selected.size > 0;
    if (chipAll) chipAll.classList.toggle("active", !anyPresetActive);
  }

  function initPresetChips() {
    const chipAll = document.getElementById("chipAll");
    const chipSaved = document.getElementById("chipSaved");
    const chipWeekend = document.getElementById("chipWeekend");
    const chipFree = document.getElementById("chipFree");
    const chipFood = document.getElementById("chipFood");
    const chipGames = document.getElementById("chipGames");
    const chipNearMe = document.getElementById("chipNearMe");

    if (chipAll) {
      chipAll.addEventListener("click", () => {
        filterSavedActive = false;
        filterNearMeActive = false;
        datesPicker.clear();
        typeMulti.clear();
        priceMulti.clear();
        locMulti.clear();
        searchText = "";
        const sb = document.getElementById("searchBox");
        if (sb) sb.value = "";
        const csb = document.getElementById("clearSearchBtn");
        if (csb) csb.hidden = true;
        document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
        chipAll.classList.add("active");
        applyFiltersBtnEl?.classList.remove("has-pending");
        applyFilters();
        updateUrlState();
        showToast("✨ Showing all events");
      });
    }

    if (chipSaved) {
      chipSaved.addEventListener("click", () => {
        filterSavedActive = !filterSavedActive;
        chipSaved.classList.toggle("active", filterSavedActive);
        updatePresetChipsUI();
        applyFilters();
      });
    }

    if (chipWeekend) {
      chipWeekend.addEventListener("click", () => {
        datesPicker.selectWeekend();
        chipWeekend.classList.add("active");
        applyFiltersBtnEl?.classList.remove("has-pending");
        updatePresetChipsUI();
        applyFilters();
      });
    }

    if (chipFree) {
      chipFree.addEventListener("click", () => {
        priceMulti.values.clear();
        priceMulti.values.add("free");
        priceMulti.refreshLabel();
        chipFree.classList.add("active");
        applyFiltersBtnEl?.classList.remove("has-pending");
        updatePresetChipsUI();
        applyFilters();
      });
    }

    if (chipFood) {
      chipFood.addEventListener("click", () => {
        typeMulti.values.clear();
        typeMulti.values.add("Food");
        typeMulti.refreshLabel();
        chipFood.classList.add("active");
        applyFiltersBtnEl?.classList.remove("has-pending");
        updatePresetChipsUI();
        applyFilters();
      });
    }

    if (chipGames) {
      chipGames.addEventListener("click", () => {
        typeMulti.values.clear();
        typeMulti.values.add("Board Games");
        typeMulti.refreshLabel();
        chipGames.classList.add("active");
        applyFiltersBtnEl?.classList.remove("has-pending");
        updatePresetChipsUI();
        applyFilters();
      });
    }

    if (chipNearMe) {
      chipNearMe.addEventListener("click", () => {
        toggleNearMe();
        updatePresetChipsUI();
      });
    }
  }

  /* ============ Multi-Select Component ============ */
  function makeMultiSelect({ btn, pop, title, allLabel, sections, onChange }) {
    const selected = new Set();

    function refreshLabel() {
      if (selected.size === 0) {
        btn.textContent = allLabel;
      } else if (selected.size <= 2) {
        const labels = [];
        sections.forEach(s => s.items.forEach(it => {
          if (selected.has(it.value)) labels.push(it.label);
        }));
        btn.textContent = labels.join(", ") || allLabel;
      } else {
        btn.textContent = `${selected.size} selected`;
      }
    }

    function renderPop() {
      let html = `<div class="pop-header">
        <span class="pop-title">${title || allLabel}</span>
        <button type="button" class="pop-close-btn" aria-label="Close">×</button>
      </div><div class="ms-list">`;

      sections.forEach(sec => {
        if (sec.title) html += `<div style="font-size:11px;font-weight:700;color:var(--ink-soft);margin-top:6px;">${sec.title}</div>`;
        sec.items.forEach(it => {
          const checked = selected.has(it.value) ? "checked" : "";
          const emoji = it.emoji ? `<span style="margin-right:4px;">${it.emoji}</span>` : "";
          html += `<label class="ms-item">
            <input type="checkbox" value="${escapeAttr(it.value)}" ${checked}>
            <span>${emoji}${escapeAttr(it.label)}</span>
          </label>`;
        });
      });

      html += `</div>
      <div style="margin-top:14px;display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="pop-apply-btn pill-btn primary">Apply</button>
      </div>`;

      pop.innerHTML = html;

      pop.querySelector(".pop-close-btn")?.addEventListener("click", close);
      pop.querySelector(".pop-apply-btn")?.addEventListener("click", close);

      pop.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener("change", () => {
          if (cb.checked) selected.add(cb.value);
          else selected.delete(cb.value);
          refreshLabel();
          applyFilters();
          updateUrlState();
          updatePresetChipsUI();
          if (onChange) onChange();
        });
      });
    }

    function open() {
      renderPop();
      pop.hidden = false;
      btn.setAttribute("aria-expanded", "true");
    }
    function close() {
      pop.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (pop.hidden) {
        if (closeActivePopover) closeActivePopover();
        open();
        closeActivePopover = close;
      } else {
        close();
        closeActivePopover = null;
      }
    });

    document.addEventListener("click", (e) => {
      if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) {
        close();
        if (closeActivePopover === close) closeActivePopover = null;
      }
    });

    return {
      get values() { return selected; },
      clear() { selected.clear(); refreshLabel(); },
      refreshLabel
    };
  }

  /* ============ Calendar Date Picker Component ============ */
  let closeActivePopover = null;

  function makeDateRangeCalendar({ btn, pop, onChange }) {
    const selected = new Set();
    let currentYear = todayObj.getFullYear();
    let currentMonth = todayObj.getMonth();

    function refreshLabel() {
      if (selected.size === 0) {
        btn.textContent = "Any dates";
      } else if (selected.size <= 2) {
        const sorted = [...selected].sort();
        btn.textContent = sorted.map(fmtDayCompact).join(", ");
      } else {
        btn.textContent = `${selected.size} days selected`;
      }
    }

    function selectWeekend() {
      selected.clear();
      let d = new Date();
      // find next Friday (or today if Fri/Sat/Sun)
      while (d.getDay() !== 5) {
        d.setDate(d.getDate() + 1);
      }
      for (let i = 0; i < 3; i++) {
        const cd = new Date(d);
        cd.setDate(cd.getDate() + i);
        selected.add(ymd(cd.getFullYear(), cd.getMonth(), cd.getDate()));
      }
      refreshLabel();
      showToast("Selected this coming weekend");
    }

    function renderCalendar() {
      let html = `<div class="pop-header">
        <span class="pop-title">Select Dates</span>
        <button type="button" class="pop-close-btn" aria-label="Close">×</button>
      </div>
      <div class="cal-presets">
        <button type="button" class="cal-preset-btn" id="calTodayBtn">Today</button>
        <button type="button" class="cal-preset-btn" id="calWeekendBtn">This Weekend</button>
        <button type="button" class="cal-preset-btn" id="calNextTwoWeeksBtn">Next 2 Weeks</button>
        <button type="button" class="cal-preset-btn" id="calClearBtn">Clear Dates</button>
      </div>
      <div class="cal-grid-header">
        <button type="button" class="cal-nav-btn" id="calPrevMonthBtn">‹</button>
        <span class="cal-month-title">${MONTH_SHORT[currentMonth]} ${currentYear}</span>
        <button type="button" class="cal-nav-btn" id="calNextMonthBtn">›</button>
      </div>
      <table class="cal-table">
        <thead>
          <tr><th>Su</th><th>Mo</th><th>Tu</th><th>We</th><th>Th</th><th>Fr</th><th>Sa</th></tr>
        </thead>
        <tbody>`;

      const firstDay = new Date(currentYear, currentMonth, 1).getDay();
      const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
      let dateNum = 1;

      for (let w = 0; w < 6; w++) {
        html += "<tr>";
        for (let dow = 0; dow < 7; dow++) {
          if ((w === 0 && dow < firstDay) || dateNum > daysInMonth) {
            html += '<td class="cal-day-cell empty-day"></td>';
          } else {
            const iso = ymd(currentYear, currentMonth, dateNum);
            const isSel = selected.has(iso) ? "selected" : "";
            html += `<td class="cal-day-cell ${isSel}" data-date="${iso}">${dateNum}</td>`;
            dateNum++;
          }
        }
        html += "</tr>";
        if (dateNum > daysInMonth) break;
      }

      html += `</tbody></table>
      <div style="margin-top:14px;display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="pill-btn primary" id="calDoneBtn">Apply</button>
      </div>`;

      pop.innerHTML = html;

      pop.querySelector(".pop-close-btn")?.addEventListener("click", close);
      pop.querySelector("#calDoneBtn")?.addEventListener("click", close);

      pop.querySelector("#calPrevMonthBtn")?.addEventListener("click", () => {
        currentMonth--;
        if (currentMonth < 0) { currentMonth = 11; currentYear--; }
        renderCalendar();
      });
      pop.querySelector("#calNextMonthBtn")?.addEventListener("click", () => {
        currentMonth++;
        if (currentMonth > 11) { currentMonth = 0; currentYear++; }
        renderCalendar();
      });

      pop.querySelector("#calTodayBtn")?.addEventListener("click", () => {
        selected.clear();
        selected.add(todayISO);
        refreshLabel();
        applyFilters();
        updateUrlState();
        updatePresetChipsUI();
        if (onChange) onChange();
        renderCalendar();
      });

      pop.querySelector("#calWeekendBtn")?.addEventListener("click", () => {
        selectWeekend();
        applyFilters();
        updateUrlState();
        updatePresetChipsUI();
        if (onChange) onChange();
        renderCalendar();
      });

      pop.querySelector("#calNextTwoWeeksBtn")?.addEventListener("click", () => {
        selected.clear();
        for (let i = 0; i < 14; i++) {
          const d = new Date();
          d.setDate(d.getDate() + i);
          selected.add(ymd(d.getFullYear(), d.getMonth(), d.getDate()));
        }
        refreshLabel();
        applyFilters();
        updateUrlState();
        updatePresetChipsUI();
        if (onChange) onChange();
        renderCalendar();
      });

      pop.querySelector("#calClearBtn")?.addEventListener("click", () => {
        selected.clear();
        refreshLabel();
        applyFilters();
        updateUrlState();
        updatePresetChipsUI();
        if (onChange) onChange();
        renderCalendar();
      });

      pop.querySelectorAll(".cal-day-cell[data-date]").forEach(cell => {
        cell.addEventListener("click", () => {
          const iso = cell.dataset.date;
          if (selected.has(iso)) selected.delete(iso);
          else selected.add(iso);
          refreshLabel();
          applyFilters();
          updateUrlState();
          updatePresetChipsUI();
          if (onChange) onChange();
          renderCalendar();
        });
      });
    }

    function open() {
      renderCalendar();
      pop.hidden = false;
      btn.setAttribute("aria-expanded", "true");
    }
    function close() {
      pop.hidden = true;
      btn.setAttribute("aria-expanded", "false");
    }

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (pop.hidden) {
        if (closeActivePopover) closeActivePopover();
        open();
        closeActivePopover = close;
      } else {
        close();
        closeActivePopover = null;
      }
    });

    document.addEventListener("click", (e) => {
      if (!pop.hidden && !pop.contains(e.target) && e.target !== btn) {
        close();
        if (closeActivePopover === close) closeActivePopover = null;
      }
    });

    return {
      get selected() { return selected; },
      clear() { selected.clear(); refreshLabel(); },
      selectWeekend,
      refreshLabel
    };
  }

  /* ============ Filter Initialization ============ */
  const applyFiltersBtnEl = document.getElementById("applyFiltersBtn");
  const clearAllFiltersBtnEl = document.getElementById("clearAllFiltersBtn");
  function markFiltersPending() {
    if (applyFiltersBtnEl) applyFiltersBtnEl.classList.add("has-pending");
  }

  const datesPicker = makeDateRangeCalendar({
    btn: document.getElementById("datesBtn"),
    pop: document.getElementById("datesPop"),
    onChange: markFiltersPending
  });

  const typeMulti = makeMultiSelect({
    btn: document.getElementById("typeBtn"),
    pop: document.getElementById("typePop"),
    title: "Categories",
    allLabel: "All categories",
    onChange: markFiltersPending,
    sections: [{
      items: Object.keys(TYPE_COLORS).map(t => ({
        value: t, label: t, emoji: typeEmoji(t)
      }))
    }]
  });

  const PRICE_BUCKETS = [
    { value: "free", label: "Free", test: p => p === 0 },
    { value: "u20",  label: "Under $20",  test: p => p < 20 },
    { value: "u40",  label: "Under $40",  test: p => p < 40 },
    { value: "u60",  label: "Under $60",  test: p => p < 60 },
    { value: "u100", label: "Under $100", test: p => p < 100 }
  ];
  const priceMulti = makeMultiSelect({
    btn: document.getElementById("priceBtn"),
    pop: document.getElementById("pricePop"),
    title: "Expenses",
    allLabel: "All expenses",
    onChange: markFiltersPending,
    sections: [{
      items: PRICE_BUCKETS.map(b => ({ value: b.value, label: b.label }))
    }]
  });

  const BOROUGHS = ["Manhattan", "Brooklyn", "Queens", "Bronx", "Staten Island", "Outside NYC"];
  const locMulti = makeMultiSelect({
    btn: document.getElementById("locBtn"),
    pop: document.getElementById("locPop"),
    title: "Locations",
    allLabel: "All locations",
    onChange: markFiltersPending,
    sections: [{
      items: BOROUGHS.map(b => ({ value: b, label: b }))
    }]
  });

  if (applyFiltersBtnEl) {
    applyFiltersBtnEl.addEventListener("click", () => {
      applyFiltersBtnEl.classList.remove("has-pending");
      applyFilters();
      updateUrlState();
    });
  }

  if (clearAllFiltersBtnEl) {
    clearAllFiltersBtnEl.addEventListener("click", () => {
      datesPicker.clear();
      typeMulti.clear();
      locMulti.clear();
      priceMulti.clear();
      searchText = "";
      filterSavedActive = false;
      filterNearMeActive = false;
      document.querySelectorAll(".chip").forEach(c => c.classList.remove("active"));
      document.getElementById("searchBox").value = "";
      applyFiltersBtnEl?.classList.remove("has-pending");
      applyFilters();
      updateUrlState();
    });
  }

  /* ============ Date Mode Segmented Control (Upcoming / Past) ============ */
  document.querySelectorAll(".dms-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".dms-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      dateMode = btn.dataset.mode === "past" ? "past" : "upcoming";
      applyFilters();
      updateUrlState();
    });
  });

  /* ============ Mobile Filters Drawer Toggle ============ */
  const toggleFiltersBtn = document.getElementById("toggleFiltersBtn");
  const filtersSection = document.getElementById("filtersSection");
  const filterActions = document.getElementById("filterActions");
  const filtersActiveBadge = document.getElementById("filtersActiveBadge");

  function updateActiveFilterBadge() {
    let count = 0;
    if (datesPicker && datesPicker.selected && datesPicker.selected.size > 0) count++;
    if (typeMulti && typeMulti.values && typeMulti.values.size > 0) count += typeMulti.values.size;
    if (locMulti && locMulti.values && locMulti.values.size > 0) count += locMulti.values.size;
    if (priceMulti && priceMulti.values && priceMulti.values.size > 0) count += priceMulti.values.size;

    if (filtersActiveBadge) {
      if (count > 0) {
        filtersActiveBadge.textContent = `${count} active`;
        filtersActiveBadge.hidden = false;
      } else {
        filtersActiveBadge.hidden = true;
      }
    }
  }

  if (toggleFiltersBtn && filtersSection) {
    toggleFiltersBtn.addEventListener("click", () => {
      const isOpen = filtersSection.classList.toggle("is-open");
      filterActions?.classList.toggle("is-open", isOpen);
      toggleFiltersBtn.classList.toggle("is-open", isOpen);
      toggleFiltersBtn.setAttribute("aria-expanded", String(isOpen));
    });
  }

  /* ============ Search Input with Quick-Clear ============ */
  const searchBox = document.getElementById("searchBox");
  const clearSearchBtn = document.getElementById("clearSearchBtn");
  let searchTimer = null;
  if (searchBox) {
    searchBox.addEventListener("input", () => {
      if (clearSearchBtn) clearSearchBtn.hidden = !searchBox.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        searchText = searchBox.value.trim().toLowerCase();
        applyFilters();
        updateUrlState();
      }, 250);
    });
  }
  if (clearSearchBtn) {
    clearSearchBtn.addEventListener("click", () => {
      searchBox.value = "";
      clearSearchBtn.hidden = true;
      searchText = "";
      applyFilters();
      updateUrlState();
    });
  }

  /* ============ View Toggle (List / Map) & Photos Toggle ============ */
  const listLabel = document.getElementById("viewListLabel");
  const mapLabel = document.getElementById("viewMapLabel");
  document.querySelectorAll('input[name="viewMode"]').forEach(r => {
    r.addEventListener("change", () => {
      const mode = r.value;
      document.body.classList.toggle("view-map", mode === "map");
      document.body.classList.toggle("view-list", mode === "list");
      listLabel.classList.toggle("active", mode === "list");
      mapLabel.classList.toggle("active", mode === "map");
      if (mode === "map") ensureMapAndRender(lastFiltered);
      updateUrlState();
    });
  });

  const imagesToggle = document.getElementById("imagesToggle");
  if (imagesToggle) {
    imagesToggle.addEventListener("change", () => {
      imagesEnabled = imagesToggle.checked;
      renderList(lastFiltered);
    });
  }

  /* ============ Filtering Engine ============ */
  function matchesSearch(ev) {
    if (!searchText) return true;
    const q = searchText;
    if (ev.name && ev.name.toLowerCase().includes(q)) return true;
    if (ev.locationName && ev.locationName.toLowerCase().includes(q)) return true;
    if (ev.neighborhood && ev.neighborhood.toLowerCase().includes(q)) return true;
    if (ev.borough && ev.borough.toLowerCase().includes(q)) return true;
    if (ev.address && ev.address.toLowerCase().includes(q)) return true;
    if (ev.thingsToKnow && ev.thingsToKnow.toLowerCase().includes(q)) return true;
    return false;
  }

  function applyFilters() {
    const selDates = datesPicker.selected;
    const types = typeMulti.values;
    const prices = priceMulti.values;
    const locs = locMulti.values;

    lastFiltered = ALL_EVENTS.filter(ev => {
      // Date mode (Upcoming vs Past)
      const upcoming = isUpcoming(ev);
      if (dateMode === "upcoming" && !upcoming) return false;
      if (dateMode === "past" && upcoming) return false;

      // Saved filter
      if (filterSavedActive && !isSaved(ev)) return false;

      // Specific dates picker
      if (selDates.size > 0) {
        const evEnd = ev.end || ev.start;
        const overlaps = [...selDates].some(d => d >= ev.start && d <= evEnd);
        if (!overlaps) return false;
      }

      // Categories
      if (types.size > 0) {
        const hasType = ev.types && ev.types.some(t => types.has(t));
        if (!hasType) return false;
      }

      // Expenses
      if (prices.size > 0) {
        const matchesPrice = [...prices].some(pVal => {
          const bucket = PRICE_BUCKETS.find(b => b.value === pVal);
          return bucket ? bucket.test(ev.price) : false;
        });
        if (!matchesPrice) return false;
      }

      // Locations
      if (locs.size > 0) {
        let matchesLoc = false;
        if (locs.has("Outside NYC") && (ev.region === "outside" || ev.region === "nearby")) matchesLoc = true;
        if (ev.borough && locs.has(ev.borough)) matchesLoc = true;
        if (!matchesLoc) return false;
      }

      // Text search
      if (!matchesSearch(ev)) return false;

      return true;
    });

    // Sorting
    if (filterNearMeActive && userCoords) {
      lastFiltered.sort((a, b) => {
        const da = (a.lat && a.lng) ? haversineMiles(userCoords.lat, userCoords.lng, a.lat, a.lng) : 9999;
        const db = (b.lat && b.lng) ? haversineMiles(userCoords.lat, userCoords.lng, b.lat, b.lng) : 9999;
        return da - db;
      });
    } else {
      // Chronological sort
      lastFiltered.sort((a, b) => {
        const ka = (a.start || "") + "T" + (a.startTime || "00:00");
        const kb = (b.start || "") + "T" + (b.startTime || "00:00");
        return dateMode === "upcoming" ? ka.localeCompare(kb) : kb.localeCompare(ka);
      });
    }

    updateActiveFilterBadge();
    displayList(lastFiltered);
    if (document.body.classList.contains("view-map")) {
      ensureMapAndRender(lastFiltered);
    }
  }

  function displayList(list) {
    const countEl = document.getElementById("countLine");
    if (countEl) {
      const modeLabel = dateMode === "past" ? "past" : "upcoming";
      const freeCount = list.filter(e => e.price === 0).length;
      const freeTag = freeCount > 0 ? ` • ${freeCount} Free` : "";
      countEl.textContent = `Showing ${list.length} ${modeLabel} event${list.length === 1 ? "" : "s"}${freeTag}`;
    }
    renderList(list);
    recomputePageBreaks();
    goToPage(0);
  }

  /* ============ Card Generation & Rendering ============ */
  function escapeAttr(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function resolveImageUrl(img) {
    if (!img) return "";
    if (img.startsWith("http://") || img.startsWith("https://") || img.startsWith("data:")) return img;
    return `https://borohop.org/${img}`;
  }

  function buildBadges(ev) {
    let badges = [];

    // Urgency / Spots
    if (ev.spotsLeft !== null && ev.spotsLeft !== undefined) {
      if (ev.spotsLeft === 0) {
        badges.push('<span class="badge badge-urgency">🚫 Full / Waitlist</span>');
      } else if (ev.spotsLeft <= 5) {
        badges.push(`<span class="badge badge-urgency">⚠️ Only ${ev.spotsLeft} spots left</span>`);
      } else {
        badges.push(`<span class="badge badge-timing">🎫 ${ev.spotsLeft} spots left</span>`);
      }
    }

    // Price
    if (ev.price === 0) {
      badges.push('<span class="badge badge-free">🟢 Free</span>');
    } else if (ev.priceDetail && ev.priceDetail.length) {
      badges.push(`<span class="badge badge-timing">💲 ${escapeAttr(ev.priceDetail[0])}</span>`);
    } else if (ev.price) {
      badges.push(`<span class="badge badge-timing">💲 $${ev.price}</span>`);
    }

    // Timing (Today, Tomorrow, Weekend)
    if (ev.start === todayISO) {
      badges.push('<span class="badge badge-urgency">🔥 Happening Today</span>');
    } else {
      const nextDay = new Date();
      nextDay.setDate(nextDay.getDate() + 1);
      const nextISO = ymd(nextDay.getFullYear(), nextDay.getMonth(), nextDay.getDate());
      if (ev.start === nextISO) {
        badges.push('<span class="badge badge-timing">⚡ Tomorrow</span>');
      }
    }

    // Outdoor detection
    const isOutdoor = (ev.types && (ev.types.includes("Nature") || ev.types.includes("Field Trip"))) ||
      (ev.name && /park|garden|walk|hike|island|preserve|trail|parade|outdoor/i.test(ev.name));
    if (isOutdoor) {
      badges.push('<span class="badge badge-timing">🌳 Outdoor</span>');
    }

    // Distance
    if (filterNearMeActive && userCoords && ev.lat && ev.lng) {
      const dist = haversineMiles(userCoords.lat, userCoords.lng, ev.lat, ev.lng).toFixed(1);
      badges.push(`<span class="badge badge-distance">📍 ${dist} mi away</span>`);
    }

    return badges.length ? `<div class="badges-row">${badges.join("")}</div>` : "";
  }

  function buildRowHtml(ev) {
    const starred = isSaved(ev);
    const starClass = starred ? "star-btn is-starred" : "star-btn";
    const starLabel = starred ? "Remove from saved" : "Save event";

    const header = `
      <div class="row-header">
        <div class="l1"><span class="swatch" aria-hidden="true">${typeEmoji(primaryType(ev))}</span>${escapeAttr(ev.name)}</div>
        <button type="button" class="${starClass}" data-ev-id="${ev.id}" aria-label="${starLabel}" title="${starLabel}">⭐</button>
      </div>
      ${buildBadges(ev)}
    `;

    const dateTime = `
      <div class="l2">${fmtDayCompact(ev.start)}</div>
      <div class="l2b">${timeCell(ev)}</div>
    `;

    const where = `
      <div class="l3">${escapeAttr(ev.locationName ? ev.locationName + ' — ' : '')}${escapeAttr(ev.region === "nyc" ? (ev.neighborhood ? ev.neighborhood + ', ' : '') + ev.borough : (ev.town || 'Nearby'))}</div>
      <div class="l4" style="color:var(--ink-soft);font-size:11.5px;">${escapeAttr(ev.address)}</div>
    `;

    const tagsHtml = (ev.types && ev.types.length) ? `
      <div class="event-tags-list">
        ${ev.types.map(t => `<button type="button" class="event-tag" data-type="${escapeAttr(t)}" title="Filter by ${escapeAttr(t)}">${typeEmoji(t)} ${escapeAttr(t)}</button>`).join("")}
      </div>
    ` : "";

    const mtaIssue = getMtaAlertForEvent(ev);
    const mtaAlertHtml = mtaIssue
      ? `<a class="pill-btn mta-alert-btn" href="https://new.mta.info/alerts" target="_blank" rel="noopener noreferrer" title="${escapeAttr(mtaIssue.summary)}">⚠️ ${escapeAttr(mtaIssue.route)} Train: ${escapeAttr(mtaIssue.type)} ↗</a>`
      : "";

    const transit = `
      <div class="l4" style="margin-top:4px;display:flex;align-items:center;flex-wrap:wrap;gap:6px;">
        ${ev.transitLines && ev.transitLines.length ? `${subwayBullets(ev.transitLines)} <span class="station-name">to ${escapeAttr(ev.transitStation)}</span>${mtaAlertHtml}` : escapeAttr(ev.transitText || '')}
        ${ev.ferryNote ? ` <span style="font-size:11px;color:var(--ink-soft);">(${escapeAttr(ev.ferryNote)})</span>` : ''}
      </div>
    `;

    const note = ev.thingsToKnow ? `<div class="things-to-know">ℹ️ ${escapeAttr(ev.thingsToKnow)}</div>` : "";

    let attendeesHtml = "";
    const hasAttendees = ev.attendees && ev.attendees.length > 0;
    const rsvps = ev.rsvpCount || (hasAttendees ? ev.attendees.length : 0);

    if (hasAttendees || rsvps > 0) {
      const displayAvatars = (ev.attendees || []).slice(0, 5).map(a => {
        const photo = a.photo || "";
        const name = escapeAttr(a.name || "Member");
        if (photo) {
          return `<img class="attendee-avatar" src="${escapeAttr(photo)}" alt="${name}" title="${name}" referrerpolicy="no-referrer" loading="lazy">`;
        }
        return `<span class="attendee-avatar" title="${name}" style="display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:var(--ink-soft);background:var(--line);">${name.charAt(0)}</span>`;
      }).join("");

      const countLabel = rsvps > 0 ? `${rsvps} going` : `${ev.attendees.length} going`;

      attendeesHtml = `
        <div class="attendees-wrap">
          <button type="button" class="attendees-btn" data-attendee-ev-id="${ev.id}" title="Click to view who is going" aria-label="View who is going (${countLabel})">
            ${displayAvatars ? `<span class="attendee-avatars">${displayAvatars}</span>` : ''}
            <span class="attendees-label">${countLabel} ↗</span>
          </button>
        </div>
      `;
    }

    // Action links
    const gmapsUrl = googleMapsDirectionsUrl(ev);
    const isPast = dateMode === "past";
    const rsvpText = isPast ? "Link to Event" : "Link to RSVP";
    const weatherUrl = (ev.lat && ev.lng) ? `https://forecast.weather.gov/MapClick.php?lat=${ev.lat}&lon=${ev.lng}` : null;

    const actions = `
      <div class="action-links">
        <a class="pill-btn" href="${gmapsUrl}" target="_blank" rel="noopener noreferrer">🗺️ Directions</a>
        ${weatherUrl ? `<a class="pill-btn" href="${weatherUrl}" target="_blank" rel="noopener noreferrer" title="View National Weather Service forecast">🌤️ Forecast ↗</a>` : ''}
        ${!isPast ? `
          <a class="pill-btn" href="${googleCalendarUrl(ev)}" target="_blank" rel="noopener noreferrer">📅 Google Cal</a>
          <button type="button" class="pill-btn ics-btn" data-ev-id="${ev.id}">🍏 Apple / .ics</button>
        ` : ''}
        ${ev.rsvpUrl ? `<a class="pill-btn primary" href="${ev.rsvpUrl}" target="_blank" rel="noopener noreferrer">${rsvpText} ↗</a>` : ''}
        <button type="button" class="pill-btn share-event-btn" data-ev-id="${ev.id}" title="Copy direct link to this event">🔗 Share</button>
      </div>
    `;

    const imgUrl = resolveImageUrl(ev.customImage);
    const photoHtml = (imagesEnabled && imgUrl) ? `
      <div class="thumb-wrap">
        <img class="thumb" src="${escapeAttr(imgUrl)}" alt="${escapeAttr(ev.name)}" referrerpolicy="no-referrer" loading="lazy">
      </div>
    ` : "";

    return `
      <li class="row" data-id="${ev.id}">
        ${header}
        <div class="row-grid">
          <div class="col-left">
            ${dateTime}
            ${photoHtml}
          </div>
          <div class="col-right">
            <div class="col-right-top">
              ${where}
              ${tagsHtml}
              ${transit}
              ${note}
              ${attendeesHtml}
            </div>
            <div class="col-right-bottom">
              ${actions}
            </div>
          </div>
        </div>
      </li>
    `;
  }

  function renderList(list) {
    const resultsEl = document.getElementById("results");
    if (!resultsEl) return;

    if (list.length === 0) {
      resultsEl.innerHTML = `
        <li class="empty">
          <strong>Nothing found in this view.</strong>
          Try clearing search, widening dates, or deselecting a category.
        </li>
      `;
      return;
    }

    resultsEl.innerHTML = list.map(buildRowHtml).join("");

    // Attach Star buttons
    resultsEl.querySelectorAll(".star-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = Number(btn.dataset.evId);
        const ev = ALL_EVENTS.find(e => e.id === id);
        if (ev) toggleSaved(ev);
      });
    });

    // Attach .ics calendar download buttons
    resultsEl.querySelectorAll(".ics-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = Number(btn.dataset.evId);
        const ev = ALL_EVENTS.find(e => e.id === id);
        if (ev) downloadIcsFile(ev);
      });
    });

    // Attach Category Tag filter buttons
    resultsEl.querySelectorAll(".event-tag").forEach(tagBtn => {
      tagBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const t = tagBtn.dataset.type;
        typeMulti.values.clear();
        typeMulti.values.add(t);
        typeMulti.refreshLabel();
        applyFilters();
        updateUrlState();
        showToast(`Filtered by ${t}`);
      });
    });

    // Attach direct Share Event buttons
    resultsEl.querySelectorAll(".share-event-btn").forEach(sBtn => {
      sBtn.addEventListener("click", () => {
        const id = sBtn.dataset.evId;
        const shareUrl = `${window.location.origin}${window.location.pathname}?event=${id}`;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(shareUrl).then(() => {
            showToast("🔗 Direct link to event copied!");
          });
        } else {
          showToast("🔗 Event URL copied");
        }
      });
    });

    // Attach Attendees modal popup buttons
    resultsEl.querySelectorAll(".attendees-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const id = Number(btn.dataset.attendeeEvId);
        const ev = ALL_EVENTS.find(e => e.id === id);
        if (ev) openAttendeesModal(ev);
      });
    });
  }

  /* ============ Pager Logic ============ */
  const prevBtn = document.getElementById("prevPageBtn");
  const nextBtn = document.getElementById("nextPageBtn");
  const pagerLabel = document.getElementById("pagerLabel");

  function recomputePageBreaks() {
    pageBreaks = [0];
    if (!lastFiltered.length) return;
    for (let i = EVENTS_PER_PAGE; i < lastFiltered.length; i += EVENTS_PER_PAGE) {
      pageBreaks.push(i);
    }
  }
  function totalPages() { return Math.max(1, pageBreaks.length); }

  function updatePager() {
    const tp = totalPages();
    if (pagerLabel) pagerLabel.textContent = `Page ${pageIndex + 1} of ${tp}`;
    if (prevBtn) prevBtn.disabled = pageIndex <= 0;
    if (nextBtn) nextBtn.disabled = pageIndex >= tp - 1;
  }

  function goToPage(idx) {
    const tp = totalPages();
    pageIndex = Math.max(0, Math.min(idx, tp - 1));
    const rows = document.querySelectorAll("#results .row");
    const target = rows[pageBreaks[pageIndex]];
    if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    updatePager();
  }

  if (prevBtn) prevBtn.addEventListener("click", () => goToPage(pageIndex - 1));
  if (nextBtn) nextBtn.addEventListener("click", () => goToPage(pageIndex + 1));
  document.getElementById("backToFiltersBtn")?.addEventListener("click", () => {
    document.querySelector(".filters")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  document.getElementById("randomBtn")?.addEventListener("click", () => {
    if (!lastFiltered.length) return;
    const randIdx = Math.floor(Math.random() * lastFiltered.length);
    const pIdx = Math.floor(randIdx / EVENTS_PER_PAGE);
    goToPage(pIdx);
    const rows = document.querySelectorAll("#results .row");
    if (rows[randIdx]) {
      rows[randIdx].style.outline = "2px solid var(--accent)";
      rows[randIdx].scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => { rows[randIdx].style.outline = ""; }, 2000);
    }
    showToast(`🎲 Jumped to: ${lastFiltered[randIdx].name}`);
  });

  /* ============ Map View (Leaflet + OpenStreetMap) ============ */
  let mapInstance = null;
  let mapMarkers = [];
  let mapIndex = 0;
  const MAPTILER_KEY = "ca8JsbHWnCygPqpohfcm";

  function loadLeaflet() {
    if (window.L) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css";
      document.head.appendChild(link);

      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Could not load Leaflet."));
      document.body.appendChild(script);
    });
  }

  function ensureMapAndRender(list) {
    loadLeaflet().then(() => {
      if (!mapInstance) {
        mapInstance = L.map("mapEl").setView([40.73, -73.98], 11);
        const tileUrl = `https://api.maptiler.com/maps/streets-v4/256/{z}/{x}/{y}.png?key=${MAPTILER_KEY}`;
        L.tileLayer(tileUrl, {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.maptiler.com">MapTiler</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        }).addTo(mapInstance);
      }
      renderMapPins(list);
    }).catch(err => {
      console.warn("Map load failed:", err);
      const note = document.getElementById("mapNote");
      if (note) note.textContent = "Map tiles could not be loaded offline.";
    });
  }

  function renderMapPins(list) {
    if (!mapInstance) return;
    mapMarkers.forEach(m => mapInstance.removeLayer(m));
    mapMarkers = [];

    const withCoords = list.filter(e => e.lat && e.lng);
    if (!withCoords.length) {
      document.getElementById("mapSelectedInfo").innerHTML = "<p class='empty'>No geocoded events found for this filter.</p>";
      return;
    }

    const bounds = L.latLngBounds();

    withCoords.forEach((ev, idx) => {
      const emoji = typeEmoji(primaryType(ev));
      const icon = L.divIcon({
        className: "custom-map-pin",
        html: `<div style="background:#fff;border:2px solid var(--ink);border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.3);font-size:16px;">${emoji}</div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      const marker = L.marker([ev.lat, ev.lng], { icon }).addTo(mapInstance);
      marker.on("click", () => {
        selectMapEvent(idx, withCoords);
      });
      mapMarkers.push(marker);
      bounds.extend([ev.lat, ev.lng]);
    });

    mapInstance.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
    selectMapEvent(0, withCoords);

    // Map pager handlers
    const mapPrev = document.getElementById("mapPrevBtn");
    const mapNext = document.getElementById("mapNextBtn");
    const mapRandom = document.getElementById("mapRandomBtn");
    const mapHome = document.getElementById("mapHomeBtn");

    if (mapPrev) mapPrev.onclick = () => selectMapEvent(mapIndex - 1, withCoords);
    if (mapNext) mapNext.onclick = () => selectMapEvent(mapIndex + 1, withCoords);
    if (mapRandom) mapRandom.onclick = () => selectMapEvent(Math.floor(Math.random() * withCoords.length), withCoords);
    if (mapHome) mapHome.onclick = () => {
      document.querySelector(".filters")?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
  }

  function selectMapEvent(idx, list) {
    if (!list.length) return;
    mapIndex = Math.max(0, Math.min(idx, list.length - 1));
    const ev = list[mapIndex];

    const label = document.getElementById("mapPagerLabel");
    if (label) label.textContent = `${mapIndex + 1} of ${list.length}: ${ev.name}`;

    const prev = document.getElementById("mapPrevBtn");
    const next = document.getElementById("mapNextBtn");
    if (prev) prev.disabled = mapIndex <= 0;
    if (next) next.disabled = mapIndex >= list.length - 1;

    if (mapInstance && ev.lat && ev.lng) {
      mapInstance.panTo([ev.lat, ev.lng], { animate: true });
    }

    const info = document.getElementById("mapSelectedInfo");
    if (info) {
      info.innerHTML = `<ul class="results" style="margin-top:0;">${buildRowHtml(ev)}</ul>`;
      info.querySelectorAll(".star-btn").forEach(b => b.addEventListener("click", () => toggleSaved(ev)));
      info.querySelectorAll(".ics-btn").forEach(b => b.addEventListener("click", () => downloadIcsFile(ev)));
      info.querySelectorAll(".attendees-btn").forEach(b => b.addEventListener("click", () => openAttendeesModal(ev)));
    }
  }

  /* ============ Who's Going Attendees Modal ============ */
  const attendeesModal = document.getElementById("attendeesModal");
  const modalBackdrop = document.getElementById("modalBackdrop");
  const attendeesModalTitle = document.getElementById("attendeesModalTitle");
  const attendeesModalSub = document.getElementById("attendeesModalSub");
  const attendeesModalList = document.getElementById("attendeesModalList");
  const attendeesModalFooter = document.getElementById("attendeesModalFooter");
  const attendeesCloseBtn = document.getElementById("attendeesCloseBtn");

  function closeAttendeesModal() {
    if (attendeesModal) attendeesModal.hidden = true;
    if (modalBackdrop) modalBackdrop.hidden = true;
    document.body.classList.remove("modal-open");
  }

  function openAttendeesModal(ev) {
    if (!attendeesModal) return;
    const attendees = ev.attendees || [];
    const rsvps = ev.rsvpCount || attendees.length;

    if (attendeesModalTitle) attendeesModalTitle.textContent = ev.name;
    if (attendeesModalSub) {
      const parts = [];
      if (rsvps > 0) parts.push(`${rsvps} Going`);
      if (ev.start) parts.push(fmtDayCompact(ev.start));
      if (ev.locationName || ev.borough) parts.push(ev.locationName || ev.borough);
      attendeesModalSub.textContent = parts.join(" · ");
    }

    if (!attendees.length) {
      attendeesModalList.innerHTML = `
        <div style="grid-column:1/-1;text-align:center;padding:32px 14px;color:var(--ink-soft);font-size:13px;">
          <div style="font-size:28px;margin-bottom:8px;">👥</div>
          <div>No attendee photos preview available for this listing.</div>
          ${ev.rsvpUrl ? `<div style="margin-top:12px;"><a class="pill-btn primary" href="${escapeAttr(ev.rsvpUrl)}" target="_blank" rel="noopener noreferrer">View RSVPs on Meetup ↗</a></div>` : ''}
        </div>
      `;
    } else {
      attendeesModalList.innerHTML = attendees.map(a => {
        const photo = a.photo;
        const name = escapeAttr(a.name || "Member");
        const avatarHtml = photo
          ? `<img class="attendee-card-avatar" src="${escapeAttr(photo)}" alt="${name}" referrerpolicy="no-referrer" loading="lazy">`
          : `<span class="attendee-card-initial">${name.charAt(0)}</span>`;
        return `
          <div class="attendee-card">
            ${avatarHtml}
            <div class="attendee-card-info">
              <div class="attendee-card-name" title="${name}">${name}</div>
              <div class="attendee-card-badge">Going ✓</div>
            </div>
          </div>
        `;
      }).join("");
    }

    let footerNote = `${attendees.length} ${attendees.length === 1 ? 'member' : 'members'} listed`;
    if (rsvps > attendees.length) {
      footerNote = `Showing ${attendees.length} of ${rsvps} RSVPs`;
    }

    let footerHtml = "";
    if (ev.rsvpUrl) {
      footerHtml = `
        <span class="attendees-modal-footer-note">${footerNote}</span>
        <div style="display:flex;gap:8px;">
          <button type="button" class="pill-btn" id="attendeesModalDoneBtn">Close</button>
          <a class="pill-btn primary" href="${escapeAttr(ev.rsvpUrl)}" target="_blank" rel="noopener noreferrer">RSVP on Meetup ↗</a>
        </div>
      `;
    } else {
      footerHtml = `
        <span class="attendees-modal-footer-note">${footerNote}</span>
        <button type="button" class="pill-btn" id="attendeesModalDoneBtn">Close</button>
      `;
    }
    if (attendeesModalFooter) {
      attendeesModalFooter.innerHTML = footerHtml;
      document.getElementById("attendeesModalDoneBtn")?.addEventListener("click", closeAttendeesModal);
    }

    if (modalBackdrop) modalBackdrop.hidden = false;
    attendeesModal.hidden = false;
    document.body.classList.add("modal-open");
  }

  attendeesCloseBtn?.addEventListener("click", closeAttendeesModal);
  modalBackdrop?.addEventListener("click", closeAttendeesModal);

  // Global event delegation for all .attendees-btn elements
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".attendees-btn");
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      const id = Number(btn.dataset.attendeeEvId);
      const ev = ALL_EVENTS.find(item => item.id === id);
      if (ev) openAttendeesModal(ev);
      return;
    }
    if (attendeesModal && !attendeesModal.hidden && !attendeesModal.contains(e.target) && e.target === modalBackdrop) {
      closeAttendeesModal();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (attendeesModal && !attendeesModal.hidden) {
        closeAttendeesModal();
      }
      if (pdfModal && !pdfModal.hidden) {
        pdfModal.hidden = true;
      }
    }
  });

  /* ============ PDF Export Feature ============ */
  function loadJsPDF() {
    if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
      s.onload = resolve;
      s.onerror = () => reject(new Error("Could not load jsPDF library."));
      document.body.appendChild(s);
    });
  }

  const pdfModal = document.getElementById("pdfModal");
  let pdfMode = "filtered"; // "filtered" | "all"

  document.getElementById("pdfFilteredBtn")?.addEventListener("click", () => {
    pdfMode = "filtered";
    pdfModal.hidden = false;
  });
  document.getElementById("pdfShowAllBtn")?.addEventListener("click", () => {
    pdfMode = "all";
    pdfModal.hidden = false;
  });
  document.getElementById("pdfCancelBtn")?.addEventListener("click", () => {
    pdfModal.hidden = true;
  });
  document.getElementById("pdfCloseBtn")?.addEventListener("click", () => {
    pdfModal.hidden = true;
  });

  document.getElementById("pdfConfirmBtn")?.addEventListener("click", () => {
    pdfModal.hidden = true;
    showToast("Generating PDF…");
    const title = document.getElementById("pdfTitleInput").value || "NYC Events";
    const list = pdfMode === "all" ? ALL_EVENTS : lastFiltered;

    loadJsPDF().then(() => {
      const { jsPDF } = window.jspdf;
      const doc = new jsPDF({ unit: "pt", format: "letter" });
      const pageW = doc.internal.pageSize.getWidth();
      let y = 50;

      doc.setFont("helvetica", "bold");
      doc.setFontSize(20);
      doc.text(title, 40, y);
      y += 24;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text(`Exported on ${fmtDayCompact(todayISO)} • ${list.length} events listed`, 40, y);
      y += 20;
      doc.line(40, y, pageW - 40, y);
      y += 20;

      list.forEach((ev, i) => {
        if (y > 700) {
          doc.addPage();
          y = 50;
        }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(13);
        doc.setTextColor(0);
        doc.text(`${i + 1}. ${ev.name}`, 40, y);
        y += 16;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(60);
        doc.text(`When: ${fmtDayCompact(ev.start)} ${timeCell(ev)}`, 50, y);
        y += 14;
        doc.text(`Where: ${ev.locationName ? ev.locationName + ' - ' : ''}${ev.address}`, 50, y);
        y += 14;
        if (ev.transitLines?.length) {
          doc.text(`Transit: Subway ${ev.transitLines.join(", ")} to ${ev.transitStation}`, 50, y);
          y += 14;
        }
        if (ev.rsvpUrl) {
          doc.setTextColor(0, 57, 166);
          doc.textWithLink("RSVP on Meetup", 50, y, { url: ev.rsvpUrl });
          y += 16;
        } else {
          y += 6;
        }
        y += 8;
      });

      doc.save(`${title.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`);
      showToast("PDF downloaded successfully!");
    }).catch(err => {
      showToast("Could not generate PDF: " + err.message);
    });
  });

  /* ============ Real-time MTA Subway Alerts ============ */
  const MTA_ALERTS_URL = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/camsys%2Fsubway-alerts.json";
  let activeMtaAlerts = new Map(); // routeId -> { route, type, summary }

  function getMtaAlertForEvent(ev) {
    if (!ev.transitLines || !ev.transitLines.length || activeMtaAlerts.size === 0) return null;
    for (const rawLine of ev.transitLines) {
      const clean = String(rawLine).replace(/X$/, "").toUpperCase();
      if (activeMtaAlerts.has(clean)) {
        return activeMtaAlerts.get(clean);
      }
    }
    return null;
  }

  function loadMtaAlerts() {
    fetch(MTA_ALERTS_URL)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(data => {
        const criticalTypes = new Set([
          "Delays", "Expect Delays", "Suspension", "Planned - Suspended",
          "Planned - Part Suspended", "Planned - Reroute", "Service Change", "Slow Speeds"
        ]);
        const map = new Map();
        (data.entity || []).forEach(ent => {
          const alert = ent.alert;
          if (!alert) return;
          const header = alert.header_text?.translation?.[0]?.text || "";
          const mercury = alert["transit_realtime.mercury_alert"] || {};
          const alertType = mercury.alert_type || "";
          const isIssue = criticalTypes.has(alertType) || /delay|suspend|reroute|slow speed|no trains/i.test(header);
          if (!isIssue) return;

          (alert.informed_entity || []).forEach(inf => {
            const raw = inf.route_id;
            if (!raw) return;
            const route = raw.replace(/X$/, "").toUpperCase();
            if (!map.has(route)) {
              let labelType = alertType.replace(/^Planned - /, "");
              map.set(route, {
                route,
                type: labelType || "Alert",
                summary: header.replace(/\[|\]/g, "")
              });
            }
          });
        });
        activeMtaAlerts = map;
        // Re-render list if alerts found so specific warning badges show up
        if (activeMtaAlerts.size > 0 && lastFiltered && lastFiltered.length) {
          renderList(lastFiltered);
        }
      })
      .catch(err => {
        console.warn("MTA alerts feed unavailable:", err);
      });
  }

  /* ============ Data Bootstrap ============ */
  async function loadEventsData() {
    try {
      const resp = await fetch("data/events.json");
      if (!resp.ok) throw new Error("Could not load data/events.json");
      ALL_EVENTS = await resp.json();
    } catch (e) {
      console.warn("Fetch failed, falling back to empty:", e);
      ALL_EVENTS = [];
    }

    ALL_EVENTS.forEach((ev, idx) => { ev.id = idx; });
    updateSavedCountBadge();
    initPresetChips();
    applyUrlParams();
    applyFilters();
    loadMtaAlerts();

    // Check for deep-linked event (?event=ID)
    const params = new URLSearchParams(window.location.search);
    const targetEventId = params.get("event");
    if (targetEventId !== null) {
      const targetIdNum = Number(targetEventId);
      const targetEv = ALL_EVENTS.find(e => e.id === targetIdNum);
      if (targetEv) {
        if (!isUpcoming(targetEv) && dateMode === "upcoming") {
          dateMode = "past";
          document.querySelectorAll(".dms-btn").forEach(b => b.classList.toggle("active", b.dataset.mode === "past"));
          applyFilters();
        }
        setTimeout(() => {
          const row = document.querySelector(`.row[data-id="${targetIdNum}"]`);
          if (row) {
            row.classList.add("highlighted");
            row.scrollIntoView({ behavior: "smooth", block: "center" });
            showToast(`📍 Found: ${targetEv.name}`);
          }
        }, 400);
      }
    }
  }

  loadEventsData();

})();

/* ============================================================
50 States Gallery — GitHub Contents API edition
============================================================ */

/* ---------- 1. Config ---------- */
const GH_CONFIG = {
    owner: "donavinredding",
    repo: "donavin-tianna-50-states",
    branch: "main",
    dataPath: "data.json",
    imagesDir: "images",
    tokenKey: "gh_publish_token"
};

/* ---------- Web3Forms Config ---------- */
const WEB3FORMS_ACCESS_KEY = "8dcb7dd9-d91a-4e2e-93c3-4f41f18a5050";

const FAV_CATEGORIES = {
    food:       { label: "Food",          emoji: "🍔", color: "#B75109" },
    park:       { label: "National Park", emoji: "🏞️", color: "#6B8071" },
    museum:     { label: "Museum",        emoji: "🏛️", color: "#8c7b6c" },
    event:      { label: "Event",         emoji: "🎉", color: "#7d4b9b" },
    dutchbros:  { label: "Dutch Bros",    emoji: "☕", color: "#156299" }, // Note: Logo is forced in render
    hotel:      { label: "Hotel",         emoji: "🛏️", color: "#1a73e8" },
    monument:   { label: "Monument",      emoji: "🗿", color: "#6b7280" },
    beach:      { label: "Beach",         emoji: "🏖️", color: "#0d9488" },
    hiking:     { label: "Hiking",        emoji: "🥾", color: "#166534" },
    shop:       { label: "Shop",          emoji: "🛒", color: "#eab308" },
    other:      { label: "Other",         emoji: "📍", color: "#66021E" }
};

const TOTAL_STATES = 50;

const ALL_STATES = [
    "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut",
    "Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa",
    "Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan",
    "Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire",
    "New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio",
    "Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota",
    "Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia",
    "Wisconsin","Wyoming"
];

/* ---------- 2. App state ---------- */
let stateGalleries = {}; 
let tripNotesText = "";
let nextStateTargets = new Set();
let savedTrips = {};
let savedVehicles = {};
let favoriteLocations = [];

let lastDataUpdatedAt = null;
let activeStateName = null;
let intervalId = null;
let draggedIndex = null;
let isEditMode = false;
let uploadQueue = [];

function resetFirstRefuelAutoOpen() {
  hasAutoOpenedFirstRefuel = false;
}

function esc(str) {
    return String(str ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;",
        '"': "&quot;", "'": "&#39;"
    }[c]));
}

/* ============================================================
Last data push display
============================================================ */
function updateLastUpdatedDisplay() {
  const el = document.getElementById("last-updated-text");
  if (!el) return;

  if (!lastDataUpdatedAt) {
    el.textContent = "Last data push: not yet tracked";
    return;
  }

  const d = new Date(lastDataUpdatedAt);
  if (isNaN(d.getTime())) {
    el.textContent = "Last data push: unknown";
    return;
  }

  const formatted = d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
  el.textContent = `Last data push: ${formatted}`;
}

/* ============================================================
3. GitHub Contents API helpers
============================================================ */

const ghApiBase = () => `https://api.github.com/repos/${GH_CONFIG.owner}/${GH_CONFIG.repo}/contents`;

function ghHeaders(extra = {}) {
    const headers = { Accept: "application/vnd.github+json", ...extra };
    const token = localStorage.getItem(GH_CONFIG.tokenKey);
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
}

function encodeGhPath(path) {
    return path.split("/").map(encodeURIComponent).join("/");
}

async function ghGetFile(path) {
    const res = await fetch(`${ghApiBase()}/${encodeGhPath(path)}?ref=${GH_CONFIG.branch}`, { 
        headers: ghHeaders() 
    });
    if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`GitHub GET ${path} failed (${res.status})`);
    }
    return res.json();
}

async function ghPutFile(path, base64Content, message, sha) {
    const body = { message, content: base64Content, branch: GH_CONFIG.branch };
    if (sha) body.sha = sha;
    const res = await fetch(`${ghApiBase()}/${encodeGhPath(path)}`, { 
        method: "PUT", 
        headers: ghHeaders({ "Content-Type": "application/json" }), 
        body: JSON.stringify(body) 
    }); 
    if (!res.ok) { 
        let detail = ""; 
        try { detail = (await res.json()).message || ""; } catch {} 
        throw new Error(`GitHub PUT ${path} failed (${detail ? ": " + detail : ""})`);
    }
    return res.json();
}

async function ghDeleteFile(path, message) {
    const file = await ghGetFile(path);
    if (!file) return;
    const res = await fetch(`${ghApiBase()}/${encodeGhPath(path)}`, {
        method: "DELETE",
        headers: ghHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ message, sha: file.sha, branch: GH_CONFIG.branch })
    });
    if (!res.ok) throw new Error(`GitHub DELETE ${path} failed (${res.status})`);
}

function toBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}

/* ============================================================
4. Loading & saving data.json
============================================================ */

async function loadSiteData() {
    try {
        const res = await fetch(`./data.json?t=${Date.now()}`, { cache: "no-store" }); 
        if (!res.ok) throw new Error(`data.json (${res.status})`);
        const data = await res.json();
        stateGalleries = data.states || {};
        tripNotesText = data.tripNotes || "";
        nextStateTargets = new Set(data.nextStateTargets || []);
        savedTrips = data.savedTrips || {}; 
        savedVehicles = data.savedVehicles || {}; // 🆕 Load global vehicles
        favoriteLocations = data.favoriteLocations || []; // 🆕 Load Favorites
      lastDataUpdatedAt = data.updatedAt || null;
    } catch (err) {
        console.warn("Could not load data.json — starting empty.", err);
        stateGalleries = {};
        tripNotesText = "";
        nextStateTargets = new Set();
        savedTrips = {}; // 🆕 Fallback
        savedVehicles = {};
        favoriteLocations = [];
      lastDataUpdatedAt = null;
    }

    // 🆕 Automatically migrate old localStorage trips to the website
    const localTrips = JSON.parse(localStorage.getItem("savedTrips") || "{}");
    let migrated = false;
    for (const [id, trip] of Object.entries(localTrips)) {
        if (!savedTrips[id]) {
            savedTrips[id] = trip;
            migrated = true;
        }
    }
    if (migrated) {
        console.log("Migrated local trips to global website data.");
        localStorage.removeItem("savedTrips"); // Clean up local storage
        queueSave("Migrate local trips to website");
    }

    const notesEl = document.getElementById("plan-notes");
    if (notesEl && document.activeElement !== notesEl) notesEl.value = tripNotesText;

    paintStatePatterns();
    updateChecklists();
    populateVehicleDropdown();
  updateLastUpdatedDisplay();

    if (activeStateName) {
        const container = document.getElementById("polaroid-container");
        if (container) renderGallery(activeStateName, container);
    }
}

let hasUnsavedChanges = false;
let pendingSaveMessage = "Update site data";

function queueSave(message) {
    hasUnsavedChanges = true;
    pendingSaveMessage = message;
    
    const banner = document.getElementById("unsaved-banner");
    if (banner) {
        banner.classList.remove("hidden");
        banner.classList.remove("expanded");
    }
}

function toggleBanner(expand) {
    const banner = document.getElementById("unsaved-banner");
    if (!banner || banner.classList.contains("hidden")) return;
    if (expand) {
        banner.classList.add("expanded");
    } else {
        banner.classList.remove("expanded");
    }
}

async function commitSave(event) {
    if (event) event.stopPropagation(); 
    if (!hasUnsavedChanges) return;

    const btn = document.getElementById("save-btn");
    const originalText = btn.textContent;
    
    btn.textContent = "Saving...";
    btn.disabled = true;

    try {
        await saveSiteData(pendingSaveMessage);
        hasUnsavedChanges = false;
        const banner = document.getElementById("unsaved-banner");
        banner.classList.add("hidden");
        banner.classList.remove("expanded");
        setPublishStatus("✅ All changes saved!");
    } catch (err) {
        alert("Failed to save: " + err.message);
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

async function saveSiteData(message = "Update site data") {
  const pushedAt = new Date().toISOString();
    const payload = JSON.stringify(
        {
            version: 1,
            updatedAt: pushedAt,
            nextStateTargets: [...nextStateTargets],
            tripNotes: tripNotesText,
            savedTrips: savedTrips,
            savedVehicles: savedVehicles,
            favoriteLocations: favoriteLocations, 
            states: stateGalleries
        },
        null,
        2
    );

    const token = localStorage.getItem(GH_CONFIG.tokenKey);
    const url = `${ghApiBase()}/${GH_CONFIG.dataPath}?ref=${GH_CONFIG.branch}`;
    
    const res = await fetch(url, { 
        headers: { 
            Accept: "application/vnd.github+json", 
            Authorization: `Bearer ${token}` 
        },
        cache: "no-store" 
    });

    let sha = null;
    if (res.ok) {
        const data = await res.json();
        sha = data.sha;
    }

    await ghPutFile(GH_CONFIG.dataPath, toBase64(payload), message, sha);
  lastDataUpdatedAt = pushedAt;
updateLastUpdatedDisplay();
    setPublishStatus("✅ Saved to GitHub — live site updates in ~30–60 s.");
}

/* ============================================================
5. Image upload
============================================================ */

function compressImage(file, maxDim = 1400, quality = 0.82) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
            URL.revokeObjectURL(url);
            let { width, height } = img;
            const scale = Math.min(1, maxDim / Math.max(width, height));
            width = Math.round(width * scale);
            height = Math.round(height * scale);

            const canvas = document.createElement("canvas");
            canvas.width = width;
            canvas.height = height;
            canvas.getContext("2d").drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL("image/jpeg", quality));
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Could not read image")); };
        img.src = url;
    });
}

async function uploadImageToRepo(file, stateName) {
    const dataUrl = await compressImage(file);
    const base64 = dataUrl.split(",")[1];
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`; 
    const path = `${GH_CONFIG.imagesDir}/${name}`; 
    await ghPutFile(path, base64, `Add photo — ${stateName}`, null);
    return path;
}

function openVehicleModal() {
    document.getElementById("vehicle-modal").classList.remove("hidden");
    renderVehicles();
}

function renderVehicles() {
    const list = document.getElementById("vehicle-list");
    if (!list) return console.error("Vehicle list container not found.");

    list.innerHTML = "";
    Object.values(savedVehicles || {}).forEach(veh => {
        const range = (veh.mpg * veh.gallons).toFixed(0);
        list.innerHTML += `
            <div style="display: flex; justify-content: space-between; align-items: center; background: #fff; padding: 8px; border: 1px solid #ddd; border-radius: 4px; margin-bottom: 8px;">
                <div>
                    <strong>${esc(veh.name)}</strong><br>
                    <span style="font-size: 0.8rem; color: #666;">${veh.mpg} MPG • ${veh.gallons} Gal • ~${range} miles</span>
                </div>
                <button onclick="deleteVehicle('${veh.id}')" style="background: none; border: none; color: var(--primary-red); font-size: 1.2rem; cursor: pointer;">🗑️</button>
            </div>
        `;
    });
    populateVehicleDropdown();
}

function addVehicle() {
    // 1. Grab elements safely
    const nameInput = document.getElementById("veh-name");
    const mpgInput = document.getElementById("veh-mpg");
    const gallonsInput = document.getElementById("veh-tank");

    // 2. Check if elements actually exist in the HTML
    if (!nameInput || !mpgInput || !gallonsInput) {
        alert("Critical Error: The vehicle form inputs are missing from the HTML.");
        return;
    }

    const name = nameInput.value.trim();
    const mpg = parseFloat(mpgInput.value);
    const gallons = parseFloat(gallonsInput.value);

    // 3. Validate numbers correctly
    if (!name || isNaN(mpg) || isNaN(gallons)) {
        alert("Please fill out all fields with valid text/numbers.");
        return;
    }

    // 4. Ensure the state object exists
    if (!savedVehicles) savedVehicles = {};

    // 5. Save the vehicle
    const id = `veh-${Date.now()}`;
    savedVehicles[id] = { id, name, mpg, gallons };

    // 6. Clear inputs
    nameInput.value = "";
    mpgInput.value = "";
    gallonsInput.value = "";

    // 7. Update UI
    renderVehicles();
    alert(`✅ ${name} saved!`);
    
    // 8. Trigger global save
    if (typeof queueSave === 'function') {
        queueSave(`Add vehicle: ${name}`);
    }
}

function deleteVehicle(id) {
    if (!confirm("Delete this vehicle?")) return;
    if (savedVehicles) delete savedVehicles[id];
    renderVehicles();
    if (typeof queueSave === 'function') queueSave(`Delete vehicle`);
}

function populateVehicleDropdown() {
    const select = document.getElementById("tripVehicleSelect");
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="">-- Select Vehicle for Fuel Calc --</option>';
    
    Object.values(savedVehicles || {}).forEach(veh => {
        const opt = document.createElement("option");
        opt.value = veh.id;
        opt.textContent = `${veh.name} (${veh.mpg} MPG)`;
        select.appendChild(opt);
    });
    if ([...select.options].some(o => o.value === current)) select.value = current;
}

/* ============================================================
6. Admin panel
============================================================ */

function setPublishStatus(text) {
    const el = document.getElementById("publish-status");
    if (el) el.textContent = text;
    console.log("[publisher]", text);
}

let isAdminUnlocked = false;

function isAdmin() {
    return isAdminUnlocked;
}

function updateAdminUI() {
    const hasToken = !!localStorage.getItem(GH_CONFIG.tokenKey);
    const statusEl = document.getElementById("admin-status");

    if (isAdminUnlocked) {
        if (statusEl) statusEl.textContent = "🔓 Unlocked on this browser";
        document.getElementById("btn-unlock").style.display = "none";
        document.getElementById("btn-lock").style.display = "block";
        document.getElementById("btn-forget").style.display = "block";
        document.body.classList.add("admin-unlocked");
    } else {
        if (statusEl) statusEl.textContent = hasToken ? "🔒 Locked (Token Saved)" : "🔒 Locked (No Token)";
        document.getElementById("btn-unlock").style.display = "block";
        document.getElementById("btn-lock").style.display = "none";
        document.getElementById("btn-forget").style.display = hasToken ? "block" : "none";
        document.body.classList.remove("admin-unlocked");
        
        unlockScroll();
    }

    const notesEl = document.getElementById("plan-notes");
    if (notesEl) notesEl.readOnly = !isAdminUnlocked;

    if (!isAdminUnlocked) {
        isEditMode = false;
        const btn = document.getElementById("toggle-edit-btn");
        if (btn) { btn.classList.remove("active"); btn.textContent = "Edit Mode ✏️"; }
        populateSavedTripsSelect();
    }

    // 🆕 Instantly redraw the checklists and gallery to strip admin buttons
    updateChecklists(); 
    if (activeStateName) {
        const container = document.getElementById("polaroid-container");
        if (container) renderGallery(activeStateName, container);
    }
}

function toggleAdminPanel() {
    const panel = document.getElementById("admin-panel");
    if (!panel) return;
    const opening = panel.classList.contains("hidden");
    panel.classList.toggle("hidden");
    if (opening) updateAdminUI();
}

function openTokenModal() {
    // Hide the admin panel first
    document.getElementById("admin-panel").classList.add("hidden");

    const savedToken = localStorage.getItem(GH_CONFIG.tokenKey);
    
    if (savedToken) {
        isAdminUnlocked = true;
        updateAdminUI();
        loadSiteData();
    } else {
        document.getElementById("token-input").value = "";
        document.getElementById("token-modal").classList.remove("hidden");
    }
}

function saveToken() {
    const token = document.getElementById("token-input").value.trim();
    if (!token) return alert("Please enter a valid token.");
    localStorage.setItem(GH_CONFIG.tokenKey, token);
    isAdminUnlocked = true;
    document.getElementById("token-modal").classList.add("hidden");
    updateAdminUI();
    loadSiteData(); 
}

function lockAdmin() {
    isAdminUnlocked = false;
    updateAdminUI();
    setPublishStatus("🔒 Locked for this session. Token is safely saved.");
    
    // Hide the admin panel
    document.getElementById("admin-panel").classList.add("hidden");
}

function confirmForgetToken() {
    if (confirm("Are you sure you want to completely remove the GitHub token from this browser? You will have to paste it again next time.")) {
        localStorage.removeItem(GH_CONFIG.tokenKey);
        isAdminUnlocked = false;
        updateAdminUI();
        setPublishStatus("🗑️ Token removed from this browser.");
        
        // Hide the admin panel
        document.getElementById("admin-panel").classList.add("hidden");
    }
}

/* ============================================================
7. Map painting, checklists, progress
============================================================ */

function lockScroll() { document.body.classList.add("scroll-lock"); }
function unlockScroll() {
    if (document.querySelectorAll(".modal.active, .modal-overlay.active, .lightbox-modal.active").length === 0) {
        document.body.classList.remove("scroll-lock");
    }
}

function getOrCreateDefs(svgMap) {
    let defs = svgMap.querySelector("defs");
    if (!defs) {
        defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        defs.id = "state-patterns";
        svgMap.prepend(defs);
    }
    return defs;
}

function updateStatePattern(stateId, imgUrl, svgDefs) {
    const patternId = `pattern-${stateId}`;
    let pattern = document.getElementById(patternId);
    const statePath = document.getElementById(stateId);
    if (!statePath) return patternId;

    const bbox = statePath.getBBox();

    if (!pattern) {
        pattern = document.createElementNS("http://www.w3.org/2000/svg", "pattern");
        pattern.setAttribute("id", patternId);
        pattern.setAttribute("patternUnits", "userSpaceOnUse");
        const image = document.createElementNS("http://www.w3.org/2000/svg", "image");
        image.setAttribute("preserveAspectRatio", "xMidYMid slice");
        pattern.appendChild(image);
        svgDefs.appendChild(pattern);
    }

    pattern.setAttribute("x", bbox.x);
    pattern.setAttribute("y", bbox.y);
    pattern.setAttribute("width", bbox.width);
    pattern.setAttribute("height", bbox.height);

    const image = pattern.querySelector("image");
    if (image) {
        image.setAttribute("x", "0");
        image.setAttribute("y", "0");
        image.setAttribute("width", bbox.width);
        image.setAttribute("height", bbox.height);
        image.setAttribute("href", imgUrl);
    }
    return patternId;
}

function paintStatePatterns() {
    const svgMap = document.querySelector(".us-map");
    if (!svgMap) return;
    const svgDefs = getOrCreateDefs(svgMap);

    document.querySelectorAll(".state").forEach(state => {
        const stateName = state.getAttribute("data-name") || state.id;
        const photos = stateGalleries[stateName];
        if (photos && photos.length && svgDefs) {
            const pid = updateStatePattern(state.id, photos[0].img, svgDefs);
            state.style.fill = `url(#${pid})`;
        } else {
            state.style.fill = "";
        }
    });
}

function updateProgress(completedCount) {
    const percentage = Math.round((completedCount / TOTAL_STATES) * 100);
    const progressText = document.getElementById("progress-text");
    if (progressText) progressText.textContent = `${completedCount} / ${TOTAL_STATES} (${percentage}%)`; 
    const progressBar = document.getElementById("progress-bar"); 
    if (progressBar) progressBar.style.width = `${percentage}%`;
}

function updateChecklists() {
    const nextList = document.getElementById("next-states-list");
    const notVisitedList = document.getElementById("not-visited-list");
    const visitedList = document.getElementById("visited-list");
    if (!nextList || !notVisitedList || !visitedList) return;

    nextList.innerHTML = "";
    notVisitedList.innerHTML = "";
    visitedList.innerHTML = "";

    const admin = isAdmin();
    let visitedCount = 0;

    ALL_STATES.forEach(stateName => {
        const photos = stateGalleries[stateName] || [];
        const hasMemories = photos.length > 0;
        const isNext = nextStateTargets.has(stateName);
        if (hasMemories) visitedCount++;

        const li = document.createElement("li");

        if (isNext) {
            li.innerHTML = `<span>${stateName}</span>` + (admin ? `<span style="display:flex;gap:6px;">
                <button class="btn-action" onclick="openPlanTripModal('${stateName}')">Plan 🗺️</button>
                ${hasMemories ? `<button class="btn-action btn-finish" onclick="finishTrip('${stateName}')">End Trip 🏁</button>` : ""}
                <button class="btn-action" onclick="toggleNextTarget('${stateName}')">Cancel</button>
            </span>` : "");
            nextList.appendChild(li);

        } else if (hasMemories) {
            li.innerHTML = `<span>${stateName} (${photos.length} photo${photos.length === 1 ? "" : "s"})</span>` + (admin ? `<span style="display:flex;gap:6px;">
                <button class="btn-action" onclick="openPlanTripModal('${stateName}')">Plan 🗺️</button>
            </span>` : "");
            visitedList.appendChild(li);

        } else {
            li.innerHTML = `<span>${stateName}</span>` + (admin ? `<span style="display:flex;gap:6px;">
                <button class="btn-action" onclick="openPlanTripModal('${stateName}')">Plan 🗺️</button>
                <button class="btn-action" onclick="toggleNextTarget('${stateName}')">+ Next</button>
            </span>` : "");
            notVisitedList.appendChild(li);
        }
    });

    updateProgress(visitedCount);
}

window.toggleNextTarget = function (stateName) {
    if (!isAdmin()) return;
    if (nextStateTargets.has(stateName)) nextStateTargets.delete(stateName);
    else nextStateTargets.add(stateName);
    updateChecklists();
    queueSave(`Toggle next-trip target: ${stateName}`);
};

window.finishTrip = function (stateName) {
    if (!isAdmin()) return;
    nextStateTargets.delete(stateName);
    updateChecklists();
    queueSave(`Finish trip: ${stateName}`);
};

/* ============================================================
8. Gallery rendering
============================================================ */

function renderGallery(stateName, container) {
    if (!container) return;
    container.innerHTML = "";
    const data = stateGalleries[stateName] || [];

    container.classList.toggle("edit-mode-active", isEditMode);

    if (data.length === 0) {
        container.innerHTML = '<p style="text-align:center; width:100%;">No memories yet for this state!</p>';
        return;
    }

    data.forEach((item, index) => {
        const polaroidDiv = document.createElement("div");
        polaroidDiv.className = "polaroid";
        polaroidDiv.dataset.index = index;

        if (item.rotation === undefined) item.rotation = 0;

        const rotationClass = (item.rotation === 90 || item.rotation === 270) ? `rotated-${item.rotation}` : "";

        polaroidDiv.innerHTML = `
            <div class="drag-handle" title="Drag to reorder">⋮⋮</div>
            <button class="delete-btn" title="Delete Memory">✕</button>
            <div class="img-wrapper">
                <img src="${item.img}" class="polaroid-img ${rotationClass}" style="transform: rotate(${item.rotation}deg);" alt="">
            </div>
            <p class="caption-text">${esc(item.desc || "")}</p>
            <button class="rotate-btn" title="Rotate Image">↻</button>
            <button class="edit-btn">Edit</button>
        `;

        const imgElement = polaroidDiv.querySelector(".polaroid-img");
        imgElement.addEventListener("click", (e) => {
            e.stopPropagation();
            openLightbox(item.img, item.desc, item.rotation);
        });

        polaroidDiv.querySelector(".rotate-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            if (!isAdmin()) return;
            item.rotation = ((item.rotation || 0) + 90) % 360;
            renderGallery(stateName, container);
            queueSave(`Rotate photo in ${stateName}`);
        });

        const handle = polaroidDiv.querySelector(".drag-handle");
        handle.addEventListener("mousedown", () => { if (isEditMode) polaroidDiv.setAttribute("draggable", "true"); });
        handle.addEventListener("mouseup", () => polaroidDiv.setAttribute("draggable", "false"));
        handle.addEventListener("touchstart", () => { if (isEditMode) polaroidDiv.setAttribute("draggable", "true"); }, { passive: true });
        handle.addEventListener("touchend", () => polaroidDiv.setAttribute("draggable", "false"));

        polaroidDiv.addEventListener("dragstart", (e) => {
            if (!isEditMode) { e.preventDefault(); return; }
            draggedIndex = index;
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", String(index));
            polaroidDiv.classList.add("dragging");
        });

        polaroidDiv.addEventListener("dragend", () => {
            polaroidDiv.classList.remove("dragging");
            polaroidDiv.setAttribute("draggable", "false");
            container.querySelectorAll(".polaroid").forEach(c => c.classList.remove("drag-over"));
        });

        polaroidDiv.addEventListener("dragover", (e) => {
            if (!isEditMode) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            polaroidDiv.classList.add("drag-over");
        });

        polaroidDiv.addEventListener("dragleave", () => polaroidDiv.classList.remove("drag-over"));

        polaroidDiv.addEventListener("drop", (e) => {
            if (!isEditMode) return;
            e.preventDefault();
            e.stopPropagation();
            polaroidDiv.classList.remove("drag-over");

            const targetIndex = parseInt(polaroidDiv.dataset.index, 10);
            if (draggedIndex === null || draggedIndex === targetIndex) return;

            const arr = stateGalleries[stateName];
            const [moved] = arr.splice(draggedIndex, 1);
            arr.splice(targetIndex, 0, moved);
            draggedIndex = null;

            renderGallery(stateName, container);
            queueSave(`Reorder photos in ${stateName}`);
        });

        polaroidDiv.querySelector(".delete-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            if (!isAdmin()) return;
            if (!confirm("Are you sure you want to delete this memory?")) return;

            const arr = stateGalleries[stateName] || [];
            const [removed] = arr.splice(index, 1);

            renderGallery(stateName, container);
            paintStatePatterns();
            updateChecklists();
            queueSave(`Delete memory from ${stateName}`);

            if (removed && removed.img && !/^https?:/i.test(removed.img)) {
                ghDeleteFile(removed.img, `Delete image ${removed.img}`).catch(err => console.warn(err));
            }
        });

        const editBtn = polaroidDiv.querySelector(".edit-btn");
        const captionText = polaroidDiv.querySelector(".caption-text");

        editBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (!isAdmin()) return;

            captionText.style.display = "none";
            editBtn.style.display = "none";

            const editContainer = document.createElement("div");
            editContainer.className = "edit-container";
            editContainer.innerHTML = `
                <input type="text" class="edit-input" value="${(item.desc || "").replace(/"/g, "&quot;")}" />
                <div class="edit-actions">
                    <button class="save-btn">Save</button>
                    <button class="cancel-btn">Cancel</button>
                </div>
            `;
            polaroidDiv.appendChild(editContainer);

            editContainer.querySelector(".save-btn").addEventListener("click", (ev) => {
                ev.stopPropagation();
                item.desc = editContainer.querySelector(".edit-input").value.trim();
                renderGallery(stateName, container);
                queueSave(`Edit caption in ${stateName}`);
            });

            editContainer.querySelector(".cancel-btn").addEventListener("click", (ev) => {
                ev.stopPropagation();
                editContainer.remove();
                captionText.style.display = "block";
                editBtn.style.display = "block";
            });
        });

        container.appendChild(polaroidDiv);
    });
}

/* ============================================================
9. Lightbox, maps, Dutch Bros
============================================================ */

function openLightbox(imgUrl, caption, rotation = 0) {
    let lightbox = document.getElementById("lightbox-modal");
    if (!lightbox) {
        lightbox = document.createElement("div");
        lightbox.id = "lightbox-modal";
        lightbox.className = "lightbox-modal";
        lightbox.innerHTML = `
            <span class="lightbox-close">&times;</span>
            <img class="lightbox-content" id="lightbox-img">
            <div id="lightbox-caption"></div>
        `;
        document.body.appendChild(lightbox);

        lightbox.addEventListener("click", (e) => {
            if (e.target.id === "lightbox-modal" || e.target.className === "lightbox-close") {
                lightbox.classList.remove("active");
                unlockScroll();
            }
        });
    }

    const img = document.getElementById("lightbox-img");
    img.src = imgUrl;
    img.style.transform = `rotate(${rotation}deg)`;
    document.getElementById("lightbox-caption").textContent = caption || "";
    lightbox.classList.add("active");
    lockScroll();
}

function loadDefaultDutchMap(iframeEl, linkEl) {
    iframeEl.src = "https://maps.google.com/maps?q=Dutch+Bros&z=10&output=embed";
    linkEl.href = "https://www.google.com/maps/dir/?api=1&destination=Dutch+Bros&travelmode=driving";
    linkEl.style.display = "inline-flex";
}

window.addEventListener("beforeunload", (e) => {
    if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = "";
    }
});

/* ============================================================
10. DOM wiring
============================================================ */

document.addEventListener("DOMContentLoaded", () => {
    isAdminUnlocked = false;
    updateAdminUI();

    const states = document.querySelectorAll(".state");
    const hoverPreview = document.getElementById("hover-preview");
    const previewImg = document.getElementById("preview-img");
    const previewTitle = document.getElementById("preview-title");

    const modal = document.getElementById("gallery-modal");
    const closeModal = document.getElementById("close-modal");
    const toggleEditBtn = document.getElementById("toggle-edit-btn");
    const modalStateTitle = document.getElementById("modal-state-title");
    const polaroidContainer = document.getElementById("polaroid-container");

    const addMemoryForm = document.getElementById("add-memory-form");
    const fileInput = document.getElementById("image-file-input");
    const dropZone = document.getElementById("drop-zone");
    const queueContainer = document.getElementById("upload-queue-container");
    const activePreviewImg = document.getElementById("active-preview-img");
    const captionInput = document.getElementById("caption-input");
    const queueThumbnails = document.getElementById("queue-thumbnails");
    const queueCountText = document.getElementById("queue-count-text");

    const planNotes = document.getElementById("plan-notes");
    if (planNotes) {
        let t;
        planNotes.addEventListener("input", (e) => {
            if (!isAdmin()) return;
            clearTimeout(t);
            t = setTimeout(() => {
                tripNotesText = e.target.value;
                queueSave("Update trip notes");
            }, 1000);
        });
    }

    const mapSearchInput = document.getElementById("map-search-input");
    const mapSearchBtn = document.getElementById("map-search-btn");
    const mapIframe = document.getElementById("map-embed-iframe");

    function performMapSearch() {
        if (!mapSearchInput || !mapIframe) return;
        const q = mapSearchInput.value.trim();
        if (q) mapIframe.src = `https://maps.google.com/maps?q=${encodeURIComponent(q)}&t=&z=13&ie=UTF8&iwloc=&output=embed`;
    }
    if (mapSearchBtn) mapSearchBtn.addEventListener("click", performMapSearch);
    if (mapSearchInput) mapSearchInput.addEventListener("keypress", (e) => {
        if (e.key === "Enter") { e.preventDefault(); performMapSearch(); }
    });

    if (toggleEditBtn) {
        toggleEditBtn.addEventListener("click", () => {
            if (!isAdmin()) return;
            isEditMode = !isEditMode;
            toggleEditBtn.classList.toggle("active", isEditMode);
            toggleEditBtn.textContent = isEditMode ? "Done Editing ✓" : "Edit Mode ✏️";
            if (activeStateName && polaroidContainer) renderGallery(activeStateName, polaroidContainer);
        });
    }

    states.forEach(state => {
        const stateName = state.getAttribute("data-name") || state.id;

        state.addEventListener("mouseenter", () => {
            if (!hoverPreview || !previewImg || !previewTitle) return;
            previewTitle.textContent = stateName;

            const photos = stateGalleries[stateName] || [];
            if (photos.length === 0) return;

            let i = 0;
            previewImg.src = photos[i].img;
            hoverPreview.style.display = "block";

            if (photos.length > 1) {
                intervalId = setInterval(() => {
                    i = (i + 1) % photos.length;
                    previewImg.src = photos[i].img;
                }, 1500);
            }
        });

        state.addEventListener("mousemove", (e) => {
            if (!hoverPreview) return;
            hoverPreview.style.position = "fixed";
            hoverPreview.style.left = `${e.clientX + 40}px`;
            hoverPreview.style.top = e.clientY - 170 < 0 ? `${e.clientY + 12}px` : `${e.clientY - 80}px`;
        });

        state.addEventListener("mouseleave", () => {
            if (hoverPreview) hoverPreview.style.display = "none";
            if (intervalId) { clearInterval(intervalId); intervalId = null; }
        });

        state.addEventListener("click", () => {
            activeStateName = stateName;

            isEditMode = false;
            if (toggleEditBtn) {
                toggleEditBtn.classList.remove("active");
                toggleEditBtn.textContent = "Edit Mode ✏️";
            }

            if (modalStateTitle) modalStateTitle.textContent = `${stateName} Gallery`;
            if (polaroidContainer) renderGallery(stateName, polaroidContainer);

            const planTripBtn = document.getElementById("modal-plan-trip-btn");
            if (planTripBtn) {
                planTripBtn.onclick = () => {
                    modal.classList.remove("active");
                    openPlanTripModal(stateName);
                };
            }

            if (modal) { modal.classList.add("active"); lockScroll(); }
        });
    });

    if (closeModal && modal) {
        closeModal.addEventListener("click", () => { modal.classList.remove("active"); unlockScroll(); });
        modal.addEventListener("click", (e) => {
            if (e.target === modal) { modal.classList.remove("active"); unlockScroll(); }
        });
    }

    function handleFiles(files) {
        if (!isAdmin()) return;
        const imgs = files.filter(f => f.type.startsWith("image/"));
        if (!imgs.length) return;
        uploadQueue = uploadQueue.concat(imgs);
        updateQueueUI();
    }

    function updateQueueUI() {
        if (!queueContainer) return;

        if (uploadQueue.length === 0) {
            queueContainer.style.display = "none";
            if (fileInput) fileInput.value = "";
            return;
        }

        queueContainer.style.display = "flex";
        if (queueCountText) queueCountText.textContent = `Images remaining: ${uploadQueue.length}`;

        if (activePreviewImg) activePreviewImg.src = URL.createObjectURL(uploadQueue[0]);
        if (captionInput) { captionInput.value = ""; captionInput.focus(); }

        if (queueThumbnails) {
            queueThumbnails.innerHTML = "";
            uploadQueue.slice(1).forEach((file, index) => {
                const card = document.createElement("div");
                card.className = "thumbnail-card";

                const img = document.createElement("img");
                img.src = URL.createObjectURL(file);

                const removeBtn = document.createElement("button");
                removeBtn.className = "remove-thumb";
                removeBtn.textContent = "✕";
                removeBtn.addEventListener("click", (e) => {
                    e.stopPropagation();
                    uploadQueue.splice(index + 1, 1);
                    updateQueueUI();
                });

                card.append(img, removeBtn);
                queueThumbnails.appendChild(card);
            });
        }
    }

    if (fileInput) fileInput.addEventListener("change", (e) => handleFiles(Array.from(e.target.files)));

    if (dropZone) {
        dropZone.addEventListener("dragover", (e) => { e.preventDefault(); dropZone.classList.add("dragover"); });
        dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
        dropZone.addEventListener("drop", (e) => {
            e.preventDefault();
            dropZone.classList.remove("dragover");
            if (e.dataTransfer.files.length) handleFiles(Array.from(e.dataTransfer.files));
        });
    }

    if (addMemoryForm) {
        addMemoryForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            if (!isAdmin()) return alert("Unlock admin first (⚙️).");
            if (!activeStateName || uploadQueue.length === 0) return;

            const submitBtn = addMemoryForm.querySelector('button[type="submit"]');
            const originalText = submitBtn ? submitBtn.textContent : "";
            if (submitBtn) { submitBtn.textContent = "Uploading…"; submitBtn.disabled = true; }

            const currentFile = uploadQueue[0];
            const caption = captionInput ? captionInput.value.trim() : "";

            try {
                const path = await uploadImageToRepo(currentFile, activeStateName);

                if (!stateGalleries[activeStateName]) stateGalleries[activeStateName] = [];
                stateGalleries[activeStateName].push({ img: path, desc: caption, rotation: 0 });

                renderGallery(activeStateName, polaroidContainer);
                paintStatePatterns();
                updateChecklists();
                await queueSave(`Add memory for ${activeStateName}`);

                uploadQueue.shift();
                updateQueueUI();
            } catch (err) {
                console.error(err);
                alert("Upload failed: " + err.message);
            } finally {
                if (submitBtn) { submitBtn.textContent = originalText; submitBtn.disabled = false; }
            }
        });
    }

    const locateBtn = document.getElementById("locate-btn");
    const dutchMap = document.getElementById("dutch-map");
    const geoStatus = document.getElementById("geo-status");
    const dirLink = document.getElementById("directions-link");

    if (locateBtn && dutchMap && geoStatus && dirLink) {
        locateBtn.addEventListener("click", () => {
            if (dutchMap.src !== "about:blank" && dutchMap.src !== "") return;

            if (!navigator.geolocation) {
                geoStatus.textContent = "Geolocation is not supported by your browser.";
                loadDefaultDutchMap(dutchMap, dirLink);
                return;
            }

            geoStatus.textContent = "Locating…";
            navigator.geolocation.getCurrentPosition(
                (pos) => {
                    const { latitude: lat, longitude: lng } = pos.coords;
                    dutchMap.src = `https://maps.google.com/maps?q=Dutch+Bros&ll=${lat},${lng}&z=12&output=embed`;
                    dirLink.href = `https://www.google.com/maps/dir/?api=1&destination=Dutch+Bros&travelmode=driving`;
                    dirLink.style.display = "inline-flex";
                    geoStatus.textContent = "";
                },
                () => {
                    geoStatus.textContent = "Unable to retrieve location. Showing general map.";
                    loadDefaultDutchMap(dutchMap, dirLink);
                }
            );
        });
    }

    let autoScrollFrame = null;
    let currentDragY = null;

    function getScrollableParent(element) {
        if (!element) return document.scrollingElement || document.documentElement;
        const style = window.getComputedStyle(element);
        const oy = style.getPropertyValue("overflow-y");
        if ((oy === "auto" || oy === "scroll") && element.scrollHeight > element.clientHeight) return element;
        return getScrollableParent(element.parentElement);
    }

    function startAutoScroll(container) {
        if (autoScrollFrame) return;
        (function loop() {
            if (!container || currentDragY === null) { autoScrollFrame = null; return; }
            const rect = (container === document.documentElement || container === document.body)
                ? { top: 0, bottom: window.innerHeight }
                : container.getBoundingClientRect();
            const threshold = 150, maxSpeed = 25;
            const fromTop = currentDragY - rect.top;
            const fromBottom = rect.bottom - currentDragY;

            if (fromTop < threshold) {
                const intensity = Math.min(1.5, Math.max(0.1, (threshold - fromTop) / threshold));
                container.scrollTop -= Math.ceil(intensity * maxSpeed);
                autoScrollFrame = requestAnimationFrame(loop);
            } else if (fromBottom < threshold) {
                const intensity = Math.min(1.5, Math.max(0.1, (threshold - fromBottom) / threshold));
                container.scrollTop += Math.ceil(intensity * maxSpeed);
                autoScrollFrame = requestAnimationFrame(loop);
            } else {
                autoScrollFrame = null;
            }
        })();
    }

    function stopAutoScroll() {
        if (autoScrollFrame) { cancelAnimationFrame(autoScrollFrame); autoScrollFrame = null; }
        currentDragY = null;
    }

    window.addEventListener("dragover", (e) => {
        if (isEditMode && draggedIndex !== null) {
            e.preventDefault();
            currentDragY = e.clientY;
            const container = getScrollableParent(document.getElementById("polaroid-container"));
            if (container) startAutoScroll(container);
        }
    });
    document.addEventListener("dragend", stopAutoScroll);
    document.addEventListener("mouseleave", stopAutoScroll);
    document.addEventListener("drop", stopAutoScroll);

    loadSiteData();
    addStateLabels();
});

/* ============================================================
Trip Planner 
============================================================ */

const STATE_NAME_TO_CODE = {
    "Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA",
    "Colorado":"CO","Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA",
    "Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA","Kansas":"KS",
    "Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD","Massachusetts":"MA",
    "Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO","Montana":"MT",
    "Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM",
    "New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH","Oklahoma":"OK",
    "Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC",
    "South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT",
    "Virginia":"VA","Washington":"WA","West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY"
};

const STATE_VIEWS = {
    AL:{name:"Alabama",coords:[32.8067,-86.7911],zoom:7}, AK:{name:"Alaska",coords:[63.5887,-154.4930],zoom:4},
    AZ:{name:"Arizona",coords:[33.7298,-111.4312],zoom:6}, AR:{name:"Arkansas",coords:[34.9697,-92.3731],zoom:7},
    CA:{name:"California",coords:[36.1162,-119.6815],zoom:6}, CO:{name:"Colorado",coords:[39.0598,-105.3111],zoom:6},
    CT:{name:"Connecticut",coords:[41.5978,-72.7554],zoom:8}, DE:{name:"Delaware",coords:[39.3185,-75.5071],zoom:9},
    FL:{name:"Florida",coords:[27.7663,-81.6868],zoom:6}, GA:{name:"Georgia",coords:[33.0406,-83.6431],zoom:7},
    HI:{name:"Hawaii",coords:[21.0943,-157.4983],zoom:7}, ID:{name:"Idaho",coords:[44.2405,-114.4788],zoom:6},
    IL:{name:"Illinois",coords:[40.3495,-88.9861],zoom:6}, IN:{name:"Indiana",coords:[39.8494,-86.2583],zoom:7},
    IA:{name:"Iowa",coords:[42.0115,-93.2105],zoom:7}, KS:{name:"Kansas",coords:[38.5266,-96.7265],zoom:7},
    KY:{name:"Kentucky",coords:[37.6681,-84.6701],zoom:7}, LA:{name:"Louisiana",coords:[31.1695,-91.8678],zoom:7},
    ME:{name:"Maine",coords:[44.6939,-69.3819],zoom:7}, MD:{name:"Maryland",coords:[39.0639,-76.8021],zoom:8},
    MA:{name:"Massachusetts",coords:[42.2302,-71.5301],zoom:8}, MI:{name:"Michigan",coords:[43.3266,-84.5361],zoom:6},
    MN:{name:"Minnesota",coords:[45.6945,-93.9002],zoom:6}, MS:{name:"Mississippi",coords:[32.7416,-89.6787],zoom:7},
    MO:{name:"Missouri",coords:[38.4561,-92.2884],zoom:7}, MT:{name:"Montana",coords:[46.9219,-110.4544],zoom:6},
    NE:{name:"Nebraska",coords:[41.1254,-98.2681],zoom:7}, NV:{name:"Nevada",coords:[38.3135,-117.0554],zoom:6},
    NH:{name:"New Hampshire",coords:[43.4525,-71.5639],zoom:8}, NJ:{name:"New Jersey",coords:[40.2989,-74.5210],zoom:8},
    NM:{name:"New Mexico",coords:[34.8405,-106.2485],zoom:6}, NY:{name:"New York",coords:[42.1657,-74.9481],zoom:6},
    NC:{name:"North Carolina",coords:[35.6301,-79.8064],zoom:7}, ND:{name:"North Dakota",coords:[47.5289,-99.7840],zoom:6},
    OH:{name:"Ohio",coords:[40.3888,-82.7649],zoom:7}, OK:{name:"Oklahoma",coords:[35.5653,-96.9289],zoom:7},
    OR:{name:"Oregon",coords:[44.5720,-122.0709],zoom:7}, PA:{name:"Pennsylvania",coords:[40.5908,-77.2098],zoom:7},
    RI:{name:"Rhode Island",coords:[41.6809,-71.5118],zoom:9}, SC:{name:"South Carolina",coords:[33.8569,-80.9450],zoom:7},
    SD:{name:"South Dakota",coords:[44.2998,-99.4388],zoom:6}, TN:{name:"Tennessee",coords:[35.7478,-86.6923],zoom:7},
    TX:{name:"Texas",coords:[31.0545,-97.5635],zoom:5}, UT:{name:"Utah",coords:[40.1500,-111.8624],zoom:6},
    VT:{name:"Vermont",coords:[44.0459,-72.7107],zoom:7}, VA:{name:"Virginia",coords:[37.7693,-78.1700],zoom:7},
    WA:{name:"Washington",coords:[47.4009,-121.4905],zoom:7}, WV:{name:"West Virginia",coords:[38.4912,-80.9545],zoom:7},
    WI:{name:"Wisconsin",coords:[44.2685,-89.6165],zoom:6}, WY:{name:"Wyoming",coords:[42.7559,-107.3025],zoom:6}
};

const TRIPS_STORAGE_KEY = "savedTrips";

let map, routingControl, tempMarker, pendingLatLng;
let currentStateCode = "AL";
let currentStops = [];
let editingStopIndex = null;
let hasAutoOpenedFirstRefuel = false;
let editingFavoriteId = null;

/* ============================================================
Batch 4: Open Hours editor (stops only, 12h display, 5-min steps)
============================================================ */
const OH_DAYS_LIST = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const OH_DAY_RANGES_LIST = ["Monday - Friday","Saturday - Sunday","Monday - Sunday"];
const OH_MINUTES_LIST = ["00","05","10","15","20","25","30","35","40","45","50","55"];
const OH_HOURS_LIST = ["1","2","3","4","5","6","7","8","9","10","11","12"];

let openHoursDraft = [];
let favOpenHoursDraft = [];

function format12h(hhmm) {
  if (!hhmm || typeof hhmm !== "string" || !/^\d{2}:\d{2}$/.test(hhmm)) return "";
  const [hStr, mStr] = hhmm.split(":");
  const h24 = parseInt(hStr, 10);
  let ampm = "AM", h12 = h24;
  if (h24 === 0) { h12 = 12; ampm = "AM"; }
  else if (h24 < 12) { h12 = h24; ampm = "AM"; }
  else if (h24 === 12) { h12 = 12; ampm = "PM"; }
  else { h12 = h24 - 12; ampm = "PM"; }
  return `${h12}:${mStr} ${ampm}`;
}

function _partsFrom24(hhmm) {
  if (!hhmm || !/^\d{2}:\d{2}$/.test(hhmm)) return { hour: "9", minute: "00", ampm: "AM" };
  const [hStr, mStr] = hhmm.split(":");
  const h24 = parseInt(hStr, 10);
  let h12 = h24, ampm = "AM";
  if (h24 === 0) { h12 = 12; ampm = "AM"; }
  else if (h24 < 12) { h12 = h24; ampm = "AM"; }
  else if (h24 === 12) { h12 = 12; ampm = "PM"; }
  else { h12 = h24 - 12; ampm = "PM"; }
  return { hour: String(h12), minute: mStr, ampm };
}

function _to24(hourStr, minuteStr, ampm) {
  let h = parseInt(hourStr, 10);
  if (ampm === "AM") { if (h === 12) h = 0; }
  else { if (h !== 12) h += 12; }
  return `${String(h).padStart(2, "0")}:${minuteStr}`;
}

function _ohSelect(cls, options, selected) {
  const optHtml = options.map(o => {
    const val = typeof o === "string" ? o : o.value;
    const label = typeof o === "string" ? o : o.label;
    return `<option value="${esc(val)}"${val === selected ? " selected" : ""}>${esc(label)}</option>`;
  }).join("");
  return `<select class="${cls}">${optHtml}</select>`;
}

/* ============================================================
Shared Open Hours editor (stops + favorites)
============================================================ */
function _ohGetDraft(kind) {
  return kind === "fav" ? favOpenHoursDraft : openHoursDraft;
}
function _ohGetContainerId(kind) {
  return kind === "fav" ? "favOpenHoursList" : "openHoursList";
}
function _ohRender(kind) {
  renderOpenHoursEditorShared(_ohGetContainerId(kind), _ohGetDraft(kind), kind);
}

function renderOpenHoursEditorShared(containerId, draft, kind) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (draft.length === 0) {
    container.innerHTML = '<p class="oh-empty">No open hours set. Click "+ Add Day" to add one.</p>';
    return;
  }

  const allDayOptions = OH_DAYS_LIST.concat(OH_DAY_RANGES_LIST);
  let html = "";

  draft.forEach((day, dIdx) => {
    html += `<div class="oh-day-row" data-day-idx="${dIdx}">`;
    html += `<div class="oh-day-header">`;
    html += `<select class="oh-day-select" onchange="updateOpenHoursDay('${kind}', ${dIdx}, this.value)">`;
    allDayOptions.forEach(opt => {
      html += `<option value="${esc(opt)}"${opt === day.days ? " selected" : ""}>${esc(opt)}</option>`;
    });
    html += `</select>`;
    html += `<button type="button" class="oh-btn oh-add-tf" onclick="addOpenHoursTimeframe('${kind}', ${dIdx})">+ Time</button>`;
    html += `<button type="button" class="oh-btn oh-remove-day" onclick="removeOpenHoursDay('${kind}', ${dIdx})" title="Remove day">🗑️</button>`;
    html += `</div>`;

    html += `<div class="oh-timeframes">`;
    day.timeframes.forEach((tf, tIdx) => {
      const s = _partsFrom24(tf.start);
      const e = _partsFrom24(tf.end);
      const canRemove = day.timeframes.length > 1;
      html += `<div class="oh-timeframe-row" data-tf-idx="${tIdx}" onchange="syncOpenHoursTimeframe('${kind}', ${dIdx}, ${tIdx})">`;
      html += _ohSelect("oh-start-hour", OH_HOURS_LIST, s.hour);
      html += _ohSelect("oh-start-min", OH_MINUTES_LIST, s.minute);
      html += _ohSelect("oh-start-ampm", ["AM","PM"], s.ampm);
      html += `<span class="oh-sep">to</span>`;
      html += _ohSelect("oh-end-hour", OH_HOURS_LIST, e.hour);
      html += _ohSelect("oh-end-min", OH_MINUTES_LIST, e.minute);
      html += _ohSelect("oh-end-ampm", ["AM","PM"], e.ampm);
      if (canRemove) {
        html += `<button type="button" class="oh-btn oh-remove-tf" onclick="event.stopPropagation(); removeOpenHoursTimeframe('${kind}', ${dIdx}, ${tIdx})" title="Remove timeframe">✕</button>`;
      } else {
        html += `<span class="oh-remove-tf-placeholder"></span>`;
      }
      html += `</div>`;
    });
    html += `</div></div>`;
  });

  container.innerHTML = html;
}

function addOpenHoursDay(kind) {
  _ohGetDraft(kind).push({ days: "Monday", timeframes: [{ start: "09:00", end: "17:00" }] });
  _ohRender(kind);
}
function removeOpenHoursDay(kind, dayIdx) {
  _ohGetDraft(kind).splice(dayIdx, 1);
  _ohRender(kind);
}
function updateOpenHoursDay(kind, dayIdx, newDays) {
  const d = _ohGetDraft(kind);
  if (!d[dayIdx]) return;
  d[dayIdx].days = newDays;
}
function addOpenHoursTimeframe(kind, dayIdx) {
  const d = _ohGetDraft(kind);
  if (!d[dayIdx]) return;
  const list = d[dayIdx].timeframes;
  const last = list[list.length - 1] || { start: "09:00", end: "17:00" };
  list.push({ start: last.start, end: last.end });
  _ohRender(kind);
}
function removeOpenHoursTimeframe(kind, dayIdx, tfIdx) {
  const d = _ohGetDraft(kind);
  if (!d[dayIdx]) return;
  if (d[dayIdx].timeframes.length <= 1) return;
  d[dayIdx].timeframes.splice(tfIdx, 1);
  _ohRender(kind);
}
function syncOpenHoursTimeframe(kind, dayIdx, tfIdx) {
  const d = _ohGetDraft(kind);
  if (!d[dayIdx] || !d[dayIdx].timeframes[tfIdx]) return;
  const containerId = _ohGetContainerId(kind);
  const row = document.querySelector(
    `#${containerId} .oh-day-row[data-day-idx="${dayIdx}"] .oh-timeframe-row[data-tf-idx="${tfIdx}"]`
  );
  if (!row) return;
  const sh = row.querySelector(".oh-start-hour").value;
  const sm = row.querySelector(".oh-start-min").value;
  const sap = row.querySelector(".oh-start-ampm").value;
  const eh = row.querySelector(".oh-end-hour").value;
  const em = row.querySelector(".oh-end-min").value;
  const eap = row.querySelector(".oh-end-ampm").value;
  d[dayIdx].timeframes[tfIdx] = {
    start: _to24(sh, sm, sap),
    end: _to24(eh, em, eap)
  };
}

/* Wrapper preserving the stop-editor API — all existing callers unchanged */
function renderOpenHoursEditor() {
  renderOpenHoursEditorShared("openHoursList", openHoursDraft, "stop");
}

/* ============================================================
Batch 7: Stop edit + shared geocoding
============================================================ */
async function geocodeAddress(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&email=your_email@example.com&q=${encodeURIComponent(address)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Geocoding failed (${res.status})`);
  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
}

window.startEditStop = function (index) {
  if (!isAdmin()) return;
  const stop = currentStops[index];
  if (!stop) return;

  editingStopIndex = index;

  const form = document.getElementById("locationFormCard");
  form.style.display = "block";
  document.getElementById("locationFormCard").classList.add("active-form");

  document.getElementById("locName").value = stop.name || "";
  document.getElementById("locNotes").value = stop.notes || "";
  document.getElementById("costTickets").value = stop.costs?.tickets || 0;
  document.getElementById("costParking").value = stop.costs?.parking || 0;
  document.getElementById("costFood").value = stop.costs?.food || 0;
  document.getElementById("costMerch").value = stop.costs?.merch || 0;
  document.getElementById("locDuration").value = stop.duration || 1;
  document.getElementById("locPreferredTime").value = stop.preferredTime || "";

  // Open hours + toggles
  openHoursDraft = stop.openHours ? JSON.parse(JSON.stringify(stop.openHours)) : [];
  renderOpenHoursEditor();
  setFieldVisibilityForm(stop);

  // Address row (refuel only)
  const addrRow = document.getElementById("edit-address-row");
  const addrInput = document.getElementById("edit-refuel-address");
  if (stop.isRefuel) {
    addrRow.style.display = "flex";
    addrInput.value = stop.address || "";
  } else {
    addrRow.style.display = "none";
    addrInput.value = "";
  }

  // Buttons + title
  document.getElementById("form-title-text").textContent = "Edit Stop Details";
  document.getElementById("save-stop-btn").textContent = "Update Stop";
  document.getElementById("cancel-edit-btn").style.display = "inline-block";
  document.getElementById("fav-star-btn").style.display = "none";

  // Scroll into view (form may be off-screen in the itinerary column)
  form.scrollIntoView({ behavior: "smooth", block: "nearest" });
};

window.cancelEditStop = function () {
  editingStopIndex = null;

  document.getElementById("locationFormCard").style.display = "none";
  document.getElementById("locationFormCard").classList.remove("active-form");
  document.getElementById("form-title-text").textContent = "New Stop Details";
  document.getElementById("save-stop-btn").textContent = "+ Add Location to Itinerary";
  document.getElementById("cancel-edit-btn").style.display = "none";
  document.getElementById("fav-star-btn").style.display = "";

  const addrRow = document.getElementById("edit-address-row");
  if (addrRow) addrRow.style.display = "none";
  const addrInput = document.getElementById("edit-refuel-address");
  if (addrInput) addrInput.value = "";

  // Clear form fields
  ["locName", "locNotes"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
  const dur = document.getElementById("locDuration");
  if (dur) dur.value = 1;
  const pref = document.getElementById("locPreferredTime");
  if (pref) pref.value = "";
  ["costTickets", "costParking", "costFood", "costMerch"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = 0;
  });

  openHoursDraft = [];
  renderOpenHoursEditor();
  resetFieldVisibilityForm();
};

async function saveEditedStop() {
  const idx = editingStopIndex;
  const existing = currentStops[idx];
  if (!existing) { cancelEditStop(); return; }

  const name = document.getElementById("locName").value.trim() || existing.name || "Unnamed Stop";
  const notes = document.getElementById("locNotes").value;
  const tickets = parseFloat(document.getElementById("costTickets").value) || 0;
  const parking = parseFloat(document.getElementById("costParking").value) || 0;
  const food = parseFloat(document.getElementById("costFood").value) || 0;
  const merch = parseFloat(document.getElementById("costMerch").value) || 0;
  const duration = parseFloat(document.getElementById("locDuration").value) || 1;
  const preferredTime = document.getElementById("locPreferredTime").value || "";
  const openHours = openHoursDraft.length ? JSON.parse(JSON.stringify(openHoursDraft)) : [];
  const fieldVisibility = getFieldVisibilityFromForm();

  let newLat = existing.lat;
  let newLng = existing.lng;
  let newAddress = existing.address || "";

  // Geocode address only for refuel stops when changed
  if (existing.isRefuel) {
    const addrInput = document.getElementById("edit-refuel-address");
    const newAddr = (addrInput?.value || "").trim();
    if (newAddr && newAddr !== (existing.address || "")) {
      try {
        const geo = await geocodeAddress(newAddr);
        if (!geo) {
          alert("Could not find that address. Refuel location was not updated.");
          return;
        }
        newLat = geo.lat;
        newLng = geo.lng;
        newAddress = newAddr;
      } catch (err) {
        alert("Error finding address: " + err.message);
        return;
      }
    } else if (!newAddr && existing.address) {
      // User cleared the address — keep old coords, clear string
      newAddress = "";
    }
  }

  currentStops[idx] = {
    ...existing,
    name,
    notes,
    lat: newLat,
    lng: newLng,
    address: newAddress,
    duration,
    preferredTime,
    costs: {
      ...existing.costs,
      tickets,
      parking,
      food,
      merch
    },
    openHours,
    fieldVisibility
  };

  cancelEditStop();
  renderItinerary();
  updateRoute();
}

/* ============================================================
Batch 5: Field visibility helpers
============================================================ */
const FIELD_VIS_DEFAULTS = {
  tickets: true,
  parking: true,
  food: true,
  merch: true,
  duration: true,
  preferredTime: true
};

function getFieldVisibilityFromForm() {
  return {
    tickets: document.getElementById("vis-tickets")?.checked ?? true,
    parking: document.getElementById("vis-parking")?.checked ?? true,
    food: document.getElementById("vis-food")?.checked ?? true,
    merch: document.getElementById("vis-merch")?.checked ?? true,
    duration: document.getElementById("vis-duration")?.checked ?? true,
    preferredTime: document.getElementById("vis-preferredTime")?.checked ?? true
  };
}

function resetFieldVisibilityForm() {
  ["vis-tickets","vis-parking","vis-food","vis-merch","vis-duration","vis-preferredTime"]
    .forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = true;
    });
}

function setFieldVisibilityForm(stop) {
  const vis = getStopVisibility(stop);
  const map = {
    tickets: "vis-tickets",
    parking: "vis-parking",
    food: "vis-food",
    merch: "vis-merch",
    duration: "vis-duration",
    preferredTime: "vis-preferredTime"
  };
  Object.entries(map).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.checked = vis[key] !== false;
  });
}

function getStopVisibility(stop) {
  if (!stop || !stop.fieldVisibility) return { ...FIELD_VIS_DEFAULTS };
  return { ...FIELD_VIS_DEFAULTS, ...stop.fieldVisibility };
}

function openPlanTripModal(stateNameOrCode) {
    hasAutoOpenedFirstRefuel = false;
    const code = STATE_NAME_TO_CODE[stateNameOrCode] || stateNameOrCode;
    const info = STATE_VIEWS[code] || { name: stateNameOrCode, coords: [39.8283, -98.5795], zoom: 4 };

    currentStateCode = code;
    document.getElementById("modalStateTitle").innerText = `Plan Trip: ${info.name}`;
    document.getElementById("planTripModal").classList.remove("hidden");
    lockScroll();

    populateSavedTripsSelect();
    updateHomeUI();
    populateVehicleDropdown();

    setTimeout(() => {
        if (!map) {
            map = L.map("tripMap", { doubleClickZoom: false }).setView(info.coords, info.zoom);
            L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                attribution: "© OpenStreetMap contributors"
            }).addTo(map);

                        // 🆕 Added email parameter to satisfy Nominatim's usage policy
            const provider = new window.GeoSearch.OpenStreetMapProvider({
                params: {
                    'accept-language': 'en-US',
                    email: 'dredding2000@gmail.com' // You can put any real-looking email here
                }
            });
            const searchControl = new window.GeoSearch.GeoSearchControl({
                provider: provider,
                style: 'bar',
                showMarker: false,
                showPopup: false,
            });
            map.addControl(searchControl);

            map.on("dblclick", (e) => {
                if (editingStopIndex !== null) return;
                window.pendingManualRefuelIndex = undefined; 
                  pendingLatLng = e.latlng;
                  if (tempMarker) map.removeLayer(tempMarker);
                  tempMarker = L.marker(pendingLatLng).addTo(map);
                  const tempGmapsUrl = `https://www.google.com/maps?q=${pendingLatLng.lat},${pendingLatLng.lng}&z=15`;
                  tempMarker.bindPopup(`
                    <div style="text-align:center; min-width:160px;">
                      <strong>New Stop Location</strong>
                      <a href="${tempGmapsUrl}" target="_blank" rel="noopener" style="display: block; background: #1a73e8; color: white; padding: 6px 10px; border-radius: 4px; text-decoration: none; font-weight: bold; font-size: 0.82rem; margin-top: 8px;">📍 View on Google Maps</a>
                    </div>
                  `).openPopup();
                  document.getElementById("locationFormCard").style.display = "block";
                  document.getElementById("locationFormCard").classList.add("active-form");
                openHoursDraft = [];
              renderOpenHoursEditor();
              resetFieldVisibilityForm();

                fetch(`https://nominatim.openstreetmap.org/reverse?format=json&email=your_email@example.com&lat=${e.latlng.lat}&lon=${e.latlng.lng}`)
                    .then((r) => r.json())
                    .then((data) => {
                        const fallback = (data.display_name || "").split(",")[0];
                        document.getElementById("locName").value = data.name || fallback || "New Stop";
                    })
                    .catch(() => { document.getElementById("locName").value = "New Stop"; });
            });

            new Sortable(document.getElementById("itineraryList"), {
                animation: 150,
                disabled: !isAdmin(),
                onEnd(evt) {
                    const [moved] = currentStops.splice(evt.oldIndex, 1);
                    currentStops.splice(evt.newIndex, 0, moved);
                    renderItinerary();
                    updateRoute();
                }
            });
        } else {
            map.setView(info.coords, info.zoom);
        }
        map.invalidateSize();
        setupFavoritesUI(); 
        renderFavoriteMarkers();
    }, 100); 
}

function closeTripModal() {
    document.getElementById("planTripModal").classList.add("hidden");
    unlockScroll();
    if (tempMarker && map) { map.removeLayer(tempMarker); tempMarker = null; }
    pendingLatLng = null;
    document.getElementById("locationFormCard").style.display = "none";
    document.getElementById("locationFormCard").classList.remove("active-form");
    openHoursDraft = [];
    renderOpenHoursEditor();
    editingStopIndex = null;
    // Restore form UI to "new stop" mode without clearing hidden fields twice
    document.getElementById("form-title-text").textContent = "New Stop Details";
    document.getElementById("save-stop-btn").textContent = "+ Add Location to Itinerary";
    document.getElementById("cancel-edit-btn").style.display = "none";
    document.getElementById("fav-star-btn").style.display = "";
    const addrRow = document.getElementById("edit-address-row");
    if (addrRow) addrRow.style.display = "none";
    hasAutoOpenedFirstRefuel = false;
}

function populateSavedTripsSelect() {
    const select = document.getElementById("savedTripsSelect");
    if (!select) return;
    const current = select.value;
    select.innerHTML = isAdmin() 
        ? '<option value="new">+ Create New Trip</option>'
        : '';

    // 🆕 Read from global savedTrips
    Object.values(savedTrips)
        .filter((t) => t.stateCode === currentStateCode)
        .forEach((trip) => {
            const opt = document.createElement("option");
            opt.value = trip.id;
            opt.textContent = trip.name;
            select.appendChild(opt);
        });

    if ([...select.options].some((o) => o.value === current)) select.value = current;
}

function loadSelectedTrip() {
    hasAutoOpenedFirstRefuel = false;
    const id = document.getElementById("savedTripsSelect").value;
    if (id === "new") {
        currentStops = [];
        document.getElementById("tripNameInput").value = "";
    } else {
        // 🆕 Read from global savedTrips
        const trip = savedTrips[id];
        if (trip) {
            currentStops = (trip.stops || []).map((s) => ({ ...s }));
            document.getElementById("tripNameInput").value = trip.name || "";
        }
    }
    renderItinerary();
    updateRoute();
}

function saveAndCloseTrip() {
    if (currentStops.length > 0) {
        saveFullTrip(); 
    }
    closeTripModal();
}

function markTripVisited() {
    // 🆕 Check if admin is locked before allowing this
    if (!isAdmin()) {
        alert("You must unlock the Site Admin to modify the State Gallery.");
        return;
    }
    
    if (currentStops.length > 0) {
        saveFullTrip();
    }
    if (!stateGalleries[currentStateCode]) {
        stateGalleries[currentStateCode] = [];
    }
    nextStateTargets.delete(currentStateCode);
    updateChecklists();
    queueSave(`Mark ${currentStateCode} as visited`);
    closeTripModal();
}

function saveFullTrip() {
    if (currentStops.length === 0) {
        alert("Add some stops first!");
        return;
    }
    const name = document.getElementById("tripNameInput").value.trim() || `Trip ${new Date().toLocaleDateString()}`;

    let id = document.getElementById("savedTripsSelect").value;
    if (id === "new") {
        id = `${currentStateCode}-${Date.now()}`;
    }

    // 🆕 Save to global object
    savedTrips[id] = {
        id, stateCode: currentStateCode, name, stops: currentStops, updatedAt: new Date().toISOString()
    };
    
    populateSavedTripsSelect();
    document.getElementById("savedTripsSelect").value = id;
    
    // 🆕 Trigger the "Save to Website" banner
    queueSave(`Save trip: ${name}`);
}

function deleteSelectedTrip() {
    const id = document.getElementById("savedTripsSelect").value;
    if (id === "new") {
        alert("Please select a saved trip from the dropdown first to delete it.");
        return;
    }
    if (!confirm("Are you sure you want to delete this trip? This cannot be undone.")) {
        return;
    }
    
    // 🆕 Delete from global object
    delete savedTrips[id];
    
    document.getElementById("savedTripsSelect").value = "new";
    loadSelectedTrip(); 
    populateSavedTripsSelect(); 
    
    // 🆕 Trigger the "Save to Website" banner
    queueSave(`Delete trip`);
    alert("Trip deleted.");
}

function saveLocationAsFavorite() {
    if (!pendingLatLng) return;

    const newFav = {
        id: "fav-" + Date.now(),
        name: document.getElementById("locName").value || "Favorite",
        notes: document.getElementById("locNotes").value,
        lat: pendingLatLng.lat,
        lng: pendingLatLng.lng,
        category: "other",
        customEmoji: "",
        costs: {
            tickets: parseFloat(document.getElementById("costTickets").value) || 0,
            parking: parseFloat(document.getElementById("costParking").value) || 0,
            food:    parseFloat(document.getElementById("costFood").value) || 0,
            merch:   parseFloat(document.getElementById("costMerch").value) || 0,
            fuel:    0
        }
        ,openHours: openHoursDraft.length ? JSON.parse(JSON.stringify(openHoursDraft)) : []
    };

    favoriteLocations.push(newFav);
    renderFavoriteMarkers();
    renderFavoritesUI(); 
    queueSave(`Saved favorite location: ${newFav.name}`);
    
    // Optional: Close the form after saving
    if (tempMarker) map.removeLayer(tempMarker);
    document.getElementById("locationFormCard").style.display = "none";
    pendingLatLng = null;
}

function saveLocationToTrip() {
    if (editingStopIndex !== null) {
        saveEditedStop();
        return;
    }
    if (!pendingLatLng) return;

    const isRefuel = window.pendingManualRefuelIndex !== undefined;
    const targetIndex = window.pendingManualRefuelIndex;

    const newStop = {
        id: Date.now(),
        name: document.getElementById("locName").value || (isRefuel ? "⛽ Refuel Stop" : "Unnamed Stop"),
        notes: document.getElementById("locNotes").value,
        lat: pendingLatLng.lat,
        lng: pendingLatLng.lng,
        completed: false,
        duration: parseFloat(document.getElementById("locDuration").value) || (isRefuel ? 0.25 : 1),
        preferredTime: document.getElementById("locPreferredTime").value || "",
        costs: {
            tickets: parseFloat(document.getElementById("costTickets").value) || 0,
            parking: parseFloat(document.getElementById("costParking").value) || 0,
            food:    parseFloat(document.getElementById("costFood").value) || 0,
            merch:   parseFloat(document.getElementById("costMerch").value) || 0,
            fuel:    isRefuel ? 40 : 0 // 🆕 Automatically apply $40 if it's a refuel stop
        },
        isRefuel: isRefuel,
        openHours: openHoursDraft.length ? JSON.parse(JSON.stringify(openHoursDraft)) : [],
        fieldVisibility: getFieldVisibilityFromForm() // 🆕 Flag it so the math resets the tank
    };

    if (isRefuel) {
        // Insert the gas station exactly where the Refuel Point was
        currentStops.splice(targetIndex, 0, newStop);
        window.pendingManualRefuelIndex = undefined; // Reset flag
    } else {
        currentStops.push(newStop);
    }

    if (tempMarker) map.removeLayer(tempMarker);
    document.getElementById("locationFormCard").style.display = "none";
    ["locName", "locNotes"].forEach((id) => (document.getElementById(id).value = ""));
    document.getElementById("locDuration").value = 1;
    document.getElementById("locPreferredTime").value = "";
    ["costTickets", "costParking", "costFood", "costMerch"].forEach(
        (id) => (document.getElementById(id).value = 0)
    );
  openHoursDraft = [];
  renderOpenHoursEditor();
  resetFieldVisibilityForm();

    renderItinerary();
    updateRoute();
}

function renderItinerary() {
    const list = document.getElementById("itineraryList");
    list.innerHTML = "";
    let grandTotal = 0;

    currentStops.forEach((stop, index) => {
        const t = stop.costs || {};
        const vis = getStopVisibility(stop);
        
        let stopTotal = 0;
        if (vis.tickets) stopTotal += t.tickets || 0;
        if (vis.parking) stopTotal += t.parking || 0;
        if (vis.food) stopTotal += t.food || 0;
        if (vis.merch) stopTotal += t.merch || 0;
        if (t.fuel) stopTotal += t.fuel;
        grandTotal += stopTotal;
        
        const summaryParts = [];
        if (vis.tickets) summaryParts.push(`🎟️ $${t.tickets || 0}`);
        if (vis.parking) summaryParts.push(`🅿️ $${t.parking || 0}`);
        if (vis.food) summaryParts.push(`🍔 $${t.food || 0}`);
        if (vis.merch) summaryParts.push(`🛍️ $${t.merch || 0}`);
        if (t.fuel) summaryParts.push(`⛽ $${t.fuel}`);
        if (vis.duration && stop.duration) summaryParts.push(`⏱️ ${stop.duration}h`);
        if (vis.preferredTime && stop.preferredTime) summaryParts.push(`🕒 ${stop.preferredTime}`);
        const summaryHtml = summaryParts.length ? `<small>${summaryParts.join(" | ")}</small>` : "";

        const li = document.createElement("li");
        li.className = `stop-item ${stop.completed ? "completed" : ""}`;
        li.innerHTML = `
            <div class="stop-header">
                ${isAdmin() ? `<span class="drag-handle">☰</span>` : ""}
                ${isAdmin() ? `<input type="checkbox" ${stop.completed ? "checked" : ""} onchange="toggleStopComplete(${index})">` : ""}
                <strong>${index + 1}. ${esc(stop.name)}</strong>
                <span>$${stopTotal.toFixed(2)}</span>
                <button class="edit-stop-btn admin-only" onclick="startEditStop(${index})" title="Edit stop" aria-label="Edit this stop">✏️</button>
                <button class="admin-only" onclick="removeStop(${index})" title="Delete stop" aria-label="Delete this stop">🗑️</button>
            </div>
            <p class="stop-notes">${esc(stop.notes)}</p>
            ${summaryHtml}
        `;
        list.appendChild(li);
    });

    document.getElementById("tripGrandTotal").innerText = grandTotal.toFixed(2);
}

function setHomeLocation(e) {
    if(e) e.preventDefault();
    const address = prompt("Enter your home address or city (e.g., Oklahoma City, OK):");
    if (!address) return;

    // 🆕 Added email parameter
    fetch(`https://nominatim.openstreetmap.org/search?format=json&email=smallonlysomemail@gmail.com&q=${encodeURIComponent(address)}`)
        .then(res => res.json())
        .then(data => {
            if (data && data.length > 0) {
                const lat = parseFloat(data[0].lat);
                const lng = parseFloat(data[0].lon);
                
                // 🆕 Save the text address too!
                localStorage.setItem("user_home_coords", JSON.stringify({ lat, lng, address }));
                
                alert("✅ Home base saved privately to this browser!");
                updateHomeUI(); // 🆕 Refresh the text next to the radio button
                updateRoute(); 
            } else {
                alert("❌ Could not find that address. Try being more specific.");
            }
        })
        .catch(err => alert("Error finding address: " + err.message));
}

function updateHomeUI() {
    const displaySpan = document.getElementById("home-address-display");
    if (!displaySpan) return;
    
    const savedHome = localStorage.getItem("user_home_coords");
    if (savedHome) {
        try {
            const home = JSON.parse(savedHome);
            // Show the address if we have it, otherwise show coordinates
            displaySpan.textContent = home.address ? `(${home.address})` : `(${home.lat.toFixed(2)}, ${home.lng.toFixed(2)})`;
        } catch (e) {
            displaySpan.textContent = "";
        }
    } else {
        displaySpan.textContent = "";
    }
}

let refuelMarkers = [];
let gasStationMarkers = [];
let previewRouteControl = null;

function updateRoute() {
    if (!map) return;
    if (routingControl) map.removeControl(routingControl);
    
    // Clear refuel markers
    refuelMarkers.forEach(m => map.removeLayer(m));
    refuelMarkers = [];

    if (currentStops.length === 0) {
        document.getElementById("tripTotalDistance").innerText = "0.0 miles";
        return;
    }

    // 🆕 Read from the start-route dropdown
    const startSelect = document.getElementById("startRouteSelect");
    const startType = startSelect ? startSelect.value : "home";
    let startCoords = null;
    if (startType === 'home') {
        const savedHome = localStorage.getItem("user_home_coords");
        if (savedHome) {
            const home = JSON.parse(savedHome);
            startCoords = L.latLng(home.lat, home.lng);
        } else {
            startCoords = L.latLng(currentStops[0].lat, currentStops[0].lng);
        }
    } else if (startType === 'first') {
        startCoords = L.latLng(currentStops[0].lat, currentStops[0].lng);
    } else if (startType === 'gps') {
        navigator.geolocation.getCurrentPosition(pos => {
            drawLeafletRoute(L.latLng(pos.coords.latitude, pos.coords.longitude));
        });
        return;
    }
    drawLeafletRoute(startCoords);
}

function drawLeafletRoute(startCoords) {
    let waypoints = [];
    if (startCoords) {
        if (currentStops.length > 0 && (startCoords.lat !== currentStops[0].lat || startCoords.lng !== currentStops[0].lng)) {
            waypoints.push(startCoords);
        }
    }
    
    // Add stops. If a stop is a Refuel Point, it acts as a reset.
    currentStops.forEach(s => waypoints.push(L.latLng(s.lat, s.lng)));

    if (waypoints.length < 2) return;

        routingControl = L.Routing.control({
        waypoints, 
        serviceUrl: 'https://router.project-osrm.org/route/v1', // 🆕 Forces the use of the public OSRM server, bypassing the warning
        routeWhileDragging: false, 
        addWaypoints: false, 
        show: false,
        lineOptions: { styles: [{ color: '#1a73e8', weight: 5 }] }
    }).addTo(map);

    // 🆕 Listen for the route to be calculated so we can do fuel math
    routingControl.on('routesfound', function(e) {
        const route = e.routes[0];
        const totalMiles = route.summary.totalDistance * 0.000621371; // meters to miles
        document.getElementById("tripTotalDistance").innerText = `${totalMiles.toFixed(1)} miles`;

        calculateFuelAndPlaceMarker(route, startCoords);
    });
}

function calculateFuelAndPlaceMarker(route, startCoords) {
    const vehId = document.getElementById("tripVehicleSelect").value;
    let currentMiles = parseFloat(document.getElementById("currentFuelMiles").value);

    if (!vehId || isNaN(currentMiles) || currentMiles <= 0) return;

    const veh = savedVehicles[vehId];
    const totalRange = veh.mpg * veh.gallons;
    const reserveSelect = document.getElementById("fuelReserveSelect");
    const reservePct = reserveSelect ? parseInt(reserveSelect.value, 10) / 100 : 0.25;
    const warningThreshold = totalRange * reservePct;
    const coords = route.coordinates;

    const stopIndices = currentStops.map(stop => {
        let minDist = Infinity;
        let bestIdx = 0;
        const stopLatLng = L.latLng(stop.lat, stop.lng);
        coords.forEach((coord, idx) => {
            const d = coord.distanceTo(stopLatLng);
            if (d < minDist) {
                minDist = d;
                bestIdx = idx;
            }
        });
        return bestIdx;
    });

    let segmentStartIdx = 0;
    let currentFuel = currentMiles;

    stopIndices.forEach((stopIdx, stopArrayIndex) => {
        if (stopIdx > segmentStartIdx) {
            let segmentDistMiles = 0;
            for (let k = segmentStartIdx; k < stopIdx; k++) {
                segmentDistMiles += coords[k].distanceTo(coords[k+1]) * 0.000621371;
            }

            let distanceRemaining = segmentDistMiles;
            let currentIdx = segmentStartIdx;

            while (distanceRemaining > currentFuel) {
                let distToWarning = currentFuel - warningThreshold;
                if (distToWarning < 0) distToWarning = 0; 

                let gasIdx = currentIdx;
                let acc = 0;
                while (gasIdx < stopIdx) {
                    let d = coords[gasIdx].distanceTo(coords[gasIdx+1]) * 0.000621371;
                    if (acc + d >= distToWarning) break;
                    acc += d;
                    gasIdx++;
                }

                placeRefuelMarker(coords[gasIdx], warningThreshold, stopArrayIndex);

                currentFuel = totalRange; // Auto-refuel tank behind the scenes
                distanceRemaining -= distToWarning;
                currentIdx = gasIdx;
                
                if (totalRange <= 0) break; 
            }

            currentFuel -= distanceRemaining;
            segmentStartIdx = stopIdx;
        }

        // 🆕 If the stop we just reached is a gas station, reset the internal tank to full
        if (currentStops[stopArrayIndex] && currentStops[stopArrayIndex].isRefuel) {
            currentFuel = totalRange; 
        }
    });

    // Auto-open first refuel popup once per fresh calculation
  if (!hasAutoOpenedFirstRefuel && refuelMarkers.length > 0 && map) {
    map.closePopup();
    refuelMarkers[0].openPopup();
    hasAutoOpenedFirstRefuel = true;
  }
}

async function addManualRefuel(btn) {
  const popupEl = btn.closest('.refuel-popup');
  if (!popupEl) return;
  const input = popupEl.querySelector('.refuel-address-input');
  const address = input ? input.value.trim() : "";
  if (!address) {
    alert("Please enter a gas station address or name.");
    return;
  }
  const targetStopId = btn.dataset.targetStopId || "";

  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Searching…";

  try {
    const geo = await geocodeAddress(address);   // reuses Batch 7 helper
    if (!geo) {
      alert("Could not find that address. Please try again.");
      btn.disabled = false;
      btn.textContent = originalText;
      return;
    }

    const newStop = {
      id: Date.now(),
      name: "⛽ Refuel Stop",
      notes: "",
      lat: geo.lat,
      lng: geo.lng,
      address: address,
      completed: false,
      duration: 0.25,
      preferredTime: "",
      costs: { tickets: 0, parking: 0, food: 0, merch: 0, fuel: 40 },
      isRefuel: true,
      openHours: [],
      fieldVisibility: { tickets: true, parking: true, food: true, merch: true, duration: true, preferredTime: true }
    };

    let insertIdx = -1;
    if (targetStopId) {
      insertIdx = currentStops.findIndex(s => String(s.id) === String(targetStopId));
    }
    if (insertIdx < 0) insertIdx = currentStops.length;
    currentStops.splice(insertIdx, 0, newStop);

    if (map) map.closePopup();
    renderItinerary();
    updateRoute();
  } catch (err) {
    alert("Error finding address: " + err.message);
    btn.disabled = false;
    btn.textContent = originalText;
  }
}

// 🆕 Helper function to create the marker so we can place multiple
function placeRefuelMarker(latLng, warningThreshold, targetStopIndex) {
  const gasIcon = L.divIcon({
    className: 'custom-div-icon',
    html: `<div style="background-color: #B75109; color: white; border-radius: 50%; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.5); font-size: 18px;">⛽</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });

  const marker = L.marker(latLng, { icon: gasIcon, bubblingMouseEvents: false }).addTo(map);
  const markerIndex = refuelMarkers.length;
  refuelMarkers.push(marker);

  const targetStopId = currentStops[targetStopIndex]?.id ?? "";
  const gmapsSearchUrl = `https://www.google.com/maps/search/gas+station/@${latLng.lat},${latLng.lng},10z`;
  const gmapsPinUrl = `https://www.google.com/maps?q=${latLng.lat},${latLng.lng}&z=15`;

  marker.bindPopup(`
    <div class="refuel-popup" style="text-align: center; min-width: 240px;">
      <strong style="font-size: 1rem;">⛽ Refuel Point</strong><br>
      <span style="font-size: 0.8rem; color: #555;">You'll hit ${Math.round((warningThreshold / (savedVehicles[document.getElementById("tripVehicleSelect").value]?.mpg * savedVehicles[document.getElementById("tripVehicleSelect").value]?.gallons || 1)) * 100)}% fuel (${warningThreshold.toFixed(0)} miles left) here.</span>
      <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 12px;">
        <a href="${gmapsSearchUrl}" target="_blank" rel="noopener" style="display: block; background: #1a73e8; color: white; padding: 8px 10px; border-radius: 4px; text-decoration: none; font-weight: bold; font-size: 0.82rem;">🔍 Find Gas Nearby</a>
        <a href="${gmapsPinUrl}" target="_blank" rel="noopener" style="display: block; background: #3c2f2f; color: white; padding: 8px 10px; border-radius: 4px; text-decoration: none; font-weight: bold; font-size: 0.82rem;">📍 View Refuel Point</a>
      </div>
      <div style="margin-top: 12px; padding-top: 12px; border-top: 1px dashed #ccc; text-align: left;">
        <label style="display: block; font-size: 0.8rem; font-weight: bold; margin-bottom: 4px;">Add manual refuel stop</label>
        <input type="text" class="refuel-address-input" placeholder="Gas station address..." style="width: 100%; padding: 6px 8px; border: 1px solid #ccc; border-radius: 4px; font-size: 0.82rem; box-sizing: border-box; margin-bottom: 6px;">
        <button type="button" onclick="addManualRefuel(this)" data-target-stop-id="${esc(String(targetStopId))}" style="background: #6B8071; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; width: 100%; font-size: 0.82rem; font-weight: bold;">Add Refuel Here</button>
      </div>
    </div>
  `);
}

function toggleStopComplete(i) {
    currentStops[i].completed = !currentStops[i].completed;
    renderItinerary();
}

function removeStop(i) {
    currentStops.splice(i, 1);
    renderItinerary();
    updateRoute();
}

function openInGoogleMaps() {
    if (currentStops.length === 0) {
        alert("Add some stops to your itinerary first!");
        return;
    }

    const startSelect = document.getElementById("startRouteSelect");
    const startType = startSelect ? startSelect.value : "home";
    
    const processLink = (originStr) => {
        const destinationStop = currentStops[currentStops.length - 1];
        const destination = `${destinationStop.lat},${destinationStop.lng}`;
        let url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(originStr)}&destination=${encodeURIComponent(destination)}`;
        
        // If we started from the first stop, we don't need it as a waypoint
        const waypointStops = startType === 'first' ? currentStops.slice(1, -1) : currentStops.slice(0, -1);
        
        if (waypointStops.length > 0) {
            url += `&waypoints=${encodeURIComponent(waypointStops.map(s => `${s.lat},${s.lng}`).join("|"))}`;
        }
        
        const link = document.createElement("a");
        link.href = url; link.target = "_blank";
        document.body.appendChild(link); link.click(); document.body.removeChild(link);
    };

    if (startType === 'home') {
        const savedHome = localStorage.getItem("user_home_coords");
        if (savedHome) {
            const home = JSON.parse(savedHome);
            
            // 🆕 If we have the text address, send that to Google Maps (it's way more accurate than OSM coordinates)
            if (home.address) {
                processLink(home.address); 
            } else {
                processLink(`${home.lat},${home.lng}`);
            }
        } else {
            alert("No home set! Defaulting to First Stop.");
            processLink(`${currentStops[0].lat},${currentStops[0].lng}`);
        }
    } else if (startType === 'first') {
        processLink(`${currentStops[0].lat},${currentStops[0].lng}`);
    } else if (startType === 'gps') {
        navigator.geolocation.getCurrentPosition(
            pos => processLink(`${pos.coords.latitude},${pos.coords.longitude}`),
            () => {
                alert("Could not get GPS location. Defaulting to First Stop.");
                processLink(`${currentStops[0].lat},${currentStops[0].lng}`);
            }
        );
    }
}

/* ============================================================
Favorite Locations
============================================================ */
let favoriteMarkers = [];
let isFavExpanded = false;

function setupFavoritesUI() {
    let favPanel = document.getElementById("favorites-panel");
    if (!favPanel) {
        favPanel = document.createElement("div");
        favPanel.id = "favorites-panel";
        // We remove the default padding so the header looks like a button
        favPanel.style.marginBottom = "4px";
        favPanel.style.border = "1px solid #d3c5b4";
        favPanel.style.borderRadius = "6px";
        favPanel.style.overflow = "hidden";
        
        // Insert it above the map section
        const mapSection = document.querySelector(".map-section");
        if (mapSection) {
            mapSection.insertBefore(favPanel, mapSection.firstChild);
        }
    }
    renderFavoritesUI();
}

function toggleFavPanel(e) {
    if (e) e.stopPropagation();
    isFavExpanded = !isFavExpanded;
    renderFavoritesUI();
}

function renderFavoritesUI() {
    const panel = document.getElementById("favorites-panel");
    if (!panel) return;
    
    // Header (Always visible)
    let html = `
        <div onclick="toggleFavPanel(event)" style="background: #e9e3d5; padding: 12px 16px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; user-select: none;">
            <strong style="font-family: 'Special Elite', cursive; color: #3c2f2f; font-size: 1.1rem;">⭐ Favorite Locations</strong>
            <span style="font-size: 0.8rem; color: #666;">${isFavExpanded ? '▲' : '▼'}</span>
        </div>
    `;

    // Dropdown Content (Only visible if expanded)
    if (isFavExpanded) {
        html += `
            <div style="padding: 16px; background: #f4efe6; border-top: 1px solid #d3c5b4;">
                <div style="display: flex; gap: 8px; margin-bottom: 12px;">
                    <input type="text" id="fav-address-input" placeholder="Address or City..." style="flex: 1; padding: 6px; border: 1px solid #ccc; border-radius: 4px; font-family: inherit;">
                    <button onclick="addFavoriteByAddress()" style="background: #f1c40f; color: #333; border: none; padding: 6px 12px; border-radius: 4px; font-weight: bold; cursor: pointer;">Save</button>
                </div>
                <ul style="list-style: none; padding: 0; margin: 0; max-height: 150px; overflow-y: auto;">
        `;
        
        if (favoriteLocations.length === 0) {
            html += `<li style="color: #777; font-style: italic; font-size: 0.9rem;">No favorites saved yet. (Double-click map to add)</li>`;
        } else {
            favoriteLocations.forEach(fav => {
                if (fav.isHidden) return; // 🆕 Skip drawing this marker
                const catKey = fav.category || "other";
                const cat = FAV_CATEGORIES[catKey] || FAV_CATEGORIES.other;
                const displayEmoji = fav.customEmoji || cat.emoji;
                const listIcon = catKey === "dutchbros" 
                    ? `<svg class="dutch-bros-icon" style="width: 16px; height: 16px; fill: #156299; flex-shrink: 0;" viewBox="0 0 1131 1539">
                        <g transform="matrix(1.50293,0,0,1.50293,0,0)">
                          <path
                    d="M751.999,160.5L751.999,162.5C711.079,172.336 645.385,203.055 636.56,208.61C634.18,210.108 617.242,218.864 610.398,223.347C603.61,227.793 591.428,234.931 589.76,235.908C585.255,238.548 581.135,241.813 580.423,242.378C576.344,245.61 575.841,244.846 569.304,250.252C568.196,250.7 568.286,250.694 567.445,251.416C557.485,259.069 557.016,258.329 547.235,266.184C524.534,284.416 494.493,308.376 458.201,351.348C456.315,353.582 458.854,353.763 532.621,431.382C532.782,431.541 533.624,432.374 534.62,433.381C534.951,433.718 535.282,434.055 535.613,434.392C535.934,434.738 536.254,435.084 536.575,435.43C536.899,435.771 537.224,436.113 537.549,436.454C537.883,436.788 538.216,437.121 538.55,437.455C540.053,438.419 540.837,438.206 540.224,439.362C539.574,440.59 521.103,443.923 519.421,444.226C512.248,445.521 511.259,444.929 511.496,446.501C511.583,447.079 518.005,450.487 521.389,453.657C522.395,454.598 522.632,454.26 535.277,463.832C535.754,464.759 535.759,464.656 536.613,465.362C550.541,475.035 549.729,475.972 566.268,488.82C566.782,489.812 566.811,489.695 567.613,490.367C573.319,494.621 573.147,494.713 578.479,499.528C579.562,500.534 579.497,500.474 580.553,501.441C581.142,501.858 581.731,502.275 582.32,502.692C588.517,508.528 592.949,511.47 607.833,526.156C621.233,539.38 621.46,538.998 634.694,552.308C651.245,568.953 670.458,590.178 670.582,591.491C670.87,594.54 641.106,674.981 614.132,724.312C599.787,750.548 598.372,756.014 597.583,751.453C597.255,749.558 596.319,744.146 590.719,728.413C588.637,722.563 575.668,686.128 561.307,656.588C549.476,632.252 533.415,606.375 532.295,602.731C531.957,602.722 531.838,602.111 531.5,602.102C531.5,602.102 530.85,603.44 530.794,603.556C534.616,619.138 553.059,760.939 555.674,776.469C555.884,777.483 556.094,778.498 556.304,779.513C556.621,785.081 556.72,785.002 557.628,790.477C557.859,791.821 558.089,793.166 558.32,794.51C558.498,796.517 559.122,803.54 561.677,819.469C561.885,820.483 562.092,821.498 562.3,822.512C562.476,825.752 562.304,825.719 562.789,828.453C564.912,840.438 566.529,855.539 567.666,862.471C567.875,863.485 568.084,864.499 568.293,865.513C568.518,869.595 568.613,869.524 569.242,873.56C570.951,884.519 570.578,884.514 570.753,885.457C572.509,894.9 576.698,928.734 577.683,934.469L577.916,937.455C578.175,938.719 578.384,940.264 578.417,940.509C578.624,942.048 579.542,947.839 579.643,948.476L579.959,952.45C582.158,964.958 581.758,964.942 583.677,977.471L583.902,980.458C584.18,981.819 584.485,984.172 584.527,984.496C584.698,985.824 585.527,990.923 585.618,991.481L585.938,995.453C586.896,1001.074 587.106,1001.996 587.235,1002.559C588.144,1006.546 585.107,1005.108 542.431,1014.245C502.184,1022.863 501.978,1021.774 498.611,1022.975C498.136,1023.144 497.974,1023.83 497.5,1023.999L264.5,1023.999C262.952,1023.299 263.127,1023.026 261.463,1022.625C253.794,1020.779 174.89,1005.856 174.48,1004.509C174.055,1003.113 179.235,970.185 179.469,967.497C179.535,966.744 200.532,817.844 200.755,816.561C201.039,814.926 203.882,793.126 204.723,788.554C206.661,778.021 208.717,761.749 209.012,759.411C216.182,702.661 228.387,624.16 229.605,610.508C229.745,608.948 233.492,598.403 228.367,604.354C227.26,605.641 227.134,605.5 213.354,619.346C210.573,622.141 167.233,660.656 164.34,662.166C163.044,662.843 99.125,642.927 17.755,601.023C8.52,596.267 8.093,594.677 0,592.5L0,590.5C12.759,587.834 86.104,566.472 166.269,514.157C197.138,494.012 224.857,469.913 229.674,465.725C234.765,461.299 234.789,461.434 239.687,456.693C240.263,456.265 240.84,455.836 241.416,455.408C247.63,449.54 253.573,445.895 248.399,444.954C246.314,444.575 222.997,440.334 222.476,439.514C222.396,439.388 222.497,439.377 222.763,437.676C223.77,437.228 223.659,437.195 224.423,436.427C224.747,436.085 225.07,435.743 225.394,435.4C225.827,434.83 226.26,434.26 226.693,433.689C230.298,430.015 260.765,398.97 271.468,387.474C271.802,387.14 272.137,386.806 272.471,386.473C272.797,386.132 273.123,385.792 273.449,385.451C273.779,385.114 274.109,384.777 274.439,384.44C274.765,384.1 275.091,383.76 275.417,383.42C275.749,383.084 276.08,382.748 276.411,382.412C276.739,382.074 277.067,381.736 277.395,381.398C277.726,381.062 278.058,380.727 278.389,380.391C278.823,379.823 279.256,379.255 279.69,378.687C284.911,373.376 304.519,354.129 304.358,352.536C304.277,351.732 227.198,306.218 159.504,244.495C158.419,243.481 158.491,243.548 157.439,242.566C156.854,242.147 156.27,241.727 155.685,241.307C153.695,239.377 143.642,229.627 130.497,217.503C130.168,217.165 129.839,216.828 129.509,216.49C129.168,216.165 128.826,215.841 128.484,215.516C128.151,215.183 127.818,214.849 127.485,214.515C127.144,214.189 126.804,213.863 126.464,213.537C126.131,213.203 125.798,212.87 125.465,212.536C124.445,211.556 123.606,210.715 123.447,210.554C123.107,210.228 122.767,209.901 122.427,209.574C122.094,209.241 121.761,208.907 121.428,208.573C121.265,208.417 120.407,207.595 119.409,206.593C119.069,206.265 118.73,205.938 118.391,205.611C118.057,205.278 117.724,204.944 117.391,204.611C117.228,204.453 116.376,203.625 115.382,202.616C115.051,202.281 114.719,201.945 114.387,201.609L113.713,201.294C113.283,200.721 112.852,200.148 112.422,199.575L111.726,199.282C111.239,198.219 111.233,198.323 110.46,197.538C110.137,197.195 109.814,196.852 109.491,196.509C109.159,196.174 108.828,195.839 108.496,195.503C108.172,195.162 107.847,194.82 107.523,194.478C106.467,193.42 106.536,193.489 105.525,192.479C93.013,179.469 93.368,179.218 80.959,166.068C75.805,160.605 78.557,159.691 80.342,153.463C81.928,147.926 93.257,118.357 93.645,117.542C93.707,117.412 93.958,117.456 94.02,117.326L94.705,114.613C96.385,110.919 96.27,110.955 98.016,107.32L98.717,104.623C107.948,84.549 113.134,67.227 147.6,3.543C147.904,2.866 148.208,2.189 148.512,1.512L149.461,1.05C150.144,1.753 150.529,1.385 150.764,2.392C150.805,2.567 150.938,3.135 151.355,4.559C157.467,25.444 167.439,49.833 169.02,53.699C172.516,62.249 172.609,62.122 176.241,70.606C198.914,123.573 237.231,178.511 246.864,190.22C248.267,191.926 258.555,204.432 264.098,211.786C273.874,224.759 274.559,224.098 304.544,255.446C304.878,255.782 305.212,256.117 305.545,256.453C305.882,256.782 306.22,257.112 306.557,257.442C306.891,257.774 307.225,258.107 307.56,258.44C307.898,258.768 308.236,259.096 308.575,259.424C308.909,259.756 309.243,260.089 309.578,260.421C309.916,260.749 310.254,261.077 310.593,261.405C310.928,261.736 311.263,262.068 311.599,262.399C312.17,262.83 312.742,263.261 313.314,263.692C321.222,271.407 321.275,271.195 329.481,278.525C330.559,279.509 330.499,279.455 331.574,280.417C335.618,283.879 335.578,283.798 339.666,287.296C353.782,299.374 353.901,299.561 355.493,299.442C356.627,299.358 368.383,286.624 369.455,285.462C369.791,285.13 370.127,284.797 370.462,284.465C371.451,283.451 372.292,282.614 372.453,282.454C372.776,282.111 373.099,281.768 373.422,281.425C373.747,281.084 374.072,280.743 374.397,280.403C374.722,280.06 375.047,279.718 375.372,279.375C375.811,278.813 376.251,278.25 376.69,277.687C380.292,274.069 380.177,273.892 380.614,273.851C381.546,273.762 381.66,273.883 389.288,281.703C389.72,282.275 390.152,282.846 390.584,283.417C390.911,283.757 391.239,284.096 391.566,284.435C391.897,284.771 392.229,285.107 392.56,285.443L393.265,285.726C393.738,286.786 393.738,286.694 394.517,287.484C394.839,287.828 395.162,288.171 395.484,288.515C395.821,288.844 396.159,289.174 396.496,289.503C405.282,299.12 405.374,299.279 406.491,299.268C407.275,299.26 407.274,299.05 412.331,291.402C413.923,288.995 428.95,266.271 432.619,261.577C433.544,260.521 433.501,260.581 434.333,259.385C439.784,251.884 475.521,202.71 507.415,169.424C507.841,168.845 508.267,168.266 508.694,167.687C522.973,152.932 522.8,152.852 537.236,138.241C554.056,121.217 566.181,110.417 570.922,105.95C576.624,100.579 576.877,100.943 582.602,95.627C586.731,91.792 587.3,89.561 592.466,91.63C593.472,91.935 594.478,92.241 595.484,92.546C596.977,93.229 598.215,93.565 598.46,93.631C601.147,94.361 608.423,97.338 609.477,97.581C616.25,99.146 663.075,117.901 678.279,124.949C707.836,138.65 707.9,138.432 710.426,139.709C719.977,144.537 719.887,144.685 720.721,145.096C749.543,159.282 749.246,160.053 751.999,160.5Z"
                    fill="#006098" />
                  <path
                    d="M105.525,192.479C106.536,193.489 106.467,193.42 107.523,194.478C106.793,193.954 106.65,194.584 105.966,194.093C105.858,194.015 105.934,193.974 105.525,192.479Z"
                    fill="#006098" />
                  <path d="M585.618,991.481C586.218,993.472 586.255,993.405 585.938,995.453L585.618,991.481Z"
                    fill="#006098" />
                  <path
                    d="M434.333,259.385C433.501,260.581 433.544,260.521 432.619,261.577C432.958,260.031 432.913,259.932 434.333,259.385Z"
                    fill="#006098" />
                  <path
                    d="M372.453,282.454C372.292,282.614 371.451,283.451 370.462,284.465L370.734,283.725C371.307,283.301 371.88,282.878 372.453,282.454Z"
                    fill="#006098" />
                  <path
                    d="M578.479,499.528C579.976,499.954 580.065,499.93 580.553,501.441C579.497,500.474 579.562,500.534 578.479,499.528Z"
                    fill="#006098" />
                  <path
                    d="M123.447,210.554C123.606,210.715 124.445,211.556 125.465,212.536L124.723,212.271C124.298,211.699 123.872,211.127 123.447,210.554Z"
                    fill="#006098" />
                  <path
                    d="M557.628,790.477C557.859,791.821 558.089,793.166 558.32,794.51C558.089,793.166 557.859,791.821 557.628,790.477Z"
                    fill="#006098" />
                  <path d="M579.643,948.476C580.228,950.488 580.253,950.44 579.959,952.45L579.643,948.476Z"
                    fill="#006098" />
                  <path
                    d="M329.481,278.525C330.989,278.963 331.066,278.948 331.574,280.417C330.499,279.455 330.559,279.509 329.481,278.525Z"
                    fill="#006098" />
                  <path
                    d="M157.439,242.566C158.491,243.548 158.419,243.481 159.504,244.495C158.025,244.04 157.942,244.061 157.439,242.566Z"
                    fill="#006098" />
                  <path
                    d="M119.409,206.593C120.407,207.595 121.265,208.417 121.428,208.573L120.711,208.283C120.277,207.719 119.843,207.156 119.409,206.593Z"
                    fill="#006098" />
                  <path
                    d="M115.382,202.616C116.376,203.625 117.228,204.453 117.391,204.611L116.699,204.297C116.366,203.965 116.034,203.633 115.701,203.301L115.382,202.616Z"
                    fill="#006098" />
                  <path
                    d="M532.621,431.382C533.181,431.821 533.74,432.26 534.299,432.699L534.62,433.381C533.624,432.374 532.782,431.541 532.621,431.382Z"
                    fill="#006098" />
                  <path
                    d="M107.523,194.478C107.847,194.82 108.172,195.162 108.496,195.503L108.737,196.263C108.333,195.668 107.928,195.073 107.523,194.478Z"
                    fill="#006098" />
                  <path
                    d="M108.496,195.503C108.828,195.839 109.159,196.174 109.491,196.509L109.738,197.271C109.404,196.935 109.071,196.599 108.737,196.263L108.496,195.503Z"
                    fill="#006098" />
                  <path d="M98.717,104.623L98.016,107.32C97.9,105.834 98.102,105.926 98.717,104.623Z" fill="#006098" />
                  <path
                    d="M126.729,214.265L127.485,214.515C127.818,214.849 128.151,215.183 128.484,215.516L127.735,215.267C127.4,214.933 127.064,214.599 126.729,214.265Z"
                    fill="#006098" />
                  <path
                    d="M127.735,215.267L128.484,215.516C128.826,215.841 129.168,216.165 129.509,216.49L128.733,216.253C128.4,215.924 128.068,215.595 127.735,215.267Z"
                    fill="#006098" />
                  <path
                    d="M394.264,286.735C394.592,287.069 394.921,287.402 395.249,287.736L395.484,288.515C395.162,288.171 394.839,287.828 394.517,287.484L394.264,286.735Z"
                    fill="#006098" />
                  <path d="M94.705,114.613L94.02,117.326C93.902,115.83 94.103,115.913 94.705,114.613Z" fill="#006098" />
                  <path
                    d="M393.265,285.726C393.598,286.062 393.931,286.399 394.264,286.735L394.517,287.484C393.738,286.694 393.738,286.786 393.265,285.726Z"
                    fill="#006098" />
                  <path
                    d="M395.249,287.736C396.057,288.616 396.182,288.44 396.496,289.503C396.159,289.174 395.821,288.844 395.484,288.515L395.249,287.736Z"
                    fill="#006098" />
                  <path
                    d="M125.73,213.272L126.464,213.537C126.804,213.863 127.144,214.189 127.485,214.515L126.729,214.265C126.396,213.934 126.063,213.603 125.73,213.272Z"
                    fill="#006098" />
                  <path
                    d="M124.723,212.271L125.465,212.536C125.798,212.87 126.131,213.203 126.464,213.537L125.73,213.272C125.394,212.938 125.059,212.605 124.723,212.271Z"
                    fill="#006098" />
                  <path
                    d="M109.491,196.509C109.814,196.852 110.137,197.195 110.46,197.538L110.728,198.273C110.398,197.939 110.068,197.605 109.738,197.271L109.491,196.509Z"
                    fill="#006098" />
                  <path
                    d="M128.733,216.253L129.509,216.49C129.839,216.828 130.168,217.165 130.497,217.503C129.446,217.186 129.619,217.065 128.733,216.253Z"
                    fill="#006098" />
                  <path
                    d="M537.274,435.72C537.699,436.299 538.125,436.877 538.55,437.455C538.216,437.121 537.883,436.788 537.549,436.454L537.274,435.72Z"
                    fill="#006098" />
                  <path
                    d="M569.304,250.252C569.004,250.511 569.316,250.942 567.445,251.416C568.286,250.694 568.196,250.7 569.304,250.252Z"
                    fill="#006098" />
                  <path
                    d="M110.46,197.538C111.233,198.323 111.239,198.219 111.726,199.282C111.394,198.945 111.061,198.609 110.728,198.273L110.46,197.538Z"
                    fill="#006098" />
                  <path
                    d="M273.724,384.722L273.449,385.451C273.123,385.792 272.797,386.132 272.471,386.473L272.736,385.725C273.065,385.391 273.395,385.056 273.724,384.722Z"
                    fill="#006098" />
                  <path
                    d="M305.545,256.453L306.278,256.731C306.611,257.061 306.945,257.392 307.278,257.722L306.557,257.442C306.22,257.112 305.882,256.782 305.545,256.453Z"
                    fill="#006098" />
                  <path
                    d="M274.719,383.714L274.439,384.44C274.109,384.777 273.779,385.114 273.449,385.451L273.724,384.722C274.056,384.386 274.388,384.05 274.719,383.714Z"
                    fill="#006098" />
                  <path
                    d="M306.557,257.442L307.278,257.722C307.613,258.055 307.948,258.388 308.283,258.721L307.56,258.44C307.225,258.107 306.891,257.774 306.557,257.442Z"
                    fill="#006098" />
                  <path
                    d="M391.279,283.717C391.706,284.292 392.133,284.867 392.56,285.443C392.229,285.107 391.897,284.771 391.566,284.435L391.279,283.717Z"
                    fill="#006098" />
                  <path
                    d="M373.712,280.707L373.422,281.425C373.099,281.768 372.776,282.111 372.453,282.454C372.873,281.872 373.292,281.289 373.712,280.707Z"
                    fill="#006098" />
                  <path
                    d="M536.283,434.707C536.613,435.045 536.944,435.383 537.274,435.72L537.549,436.454C537.224,436.113 536.899,435.771 536.575,435.43L536.283,434.707Z"
                    fill="#006098" />
                  <path
                    d="M121.718,209.283L122.427,209.574C122.767,209.901 123.107,210.228 123.447,210.554C122.871,210.131 122.294,209.707 121.718,209.283Z"
                    fill="#006098" />
                  <path
                    d="M120.711,208.283L121.428,208.573C121.761,208.907 122.094,209.241 122.427,209.574L121.718,209.283C121.383,208.949 121.047,208.616 120.711,208.283Z"
                    fill="#006098" />
                  <path
                    d="M307.56,258.44L308.283,258.721C308.617,259.053 308.951,259.384 309.284,259.716L308.575,259.424C308.236,259.096 307.898,258.768 307.56,258.44Z"
                    fill="#006098" />
                  <path
                    d="M535.277,463.832C535.382,463.924 535.858,463.425 536.613,465.362C535.759,464.656 535.754,464.759 535.277,463.832Z"
                    fill="#006098" />
                  <path
                    d="M566.268,488.82C566.374,488.914 566.849,488.421 567.613,490.367C566.811,489.695 566.782,489.812 566.268,488.82Z"
                    fill="#006098" />
                  <path
                    d="M275.713,382.712L275.417,383.42C275.091,383.76 274.765,384.1 274.439,384.44L274.719,383.714C275.05,383.38 275.382,383.046 275.713,382.712Z"
                    fill="#006098" />
                  <path
                    d="M272.736,385.725L272.471,386.473C272.137,386.806 271.802,387.14 271.468,387.474C271.805,386.47 271.905,386.635 272.736,385.725Z"
                    fill="#006098" />
                  <path
                    d="M308.575,259.424L309.284,259.716C309.619,260.049 309.954,260.382 310.289,260.715L309.578,260.421C309.243,260.089 308.909,259.756 308.575,259.424Z"
                    fill="#006098" />
                  <path
                    d="M390.284,282.716C390.616,283.049 390.947,283.383 391.279,283.717L391.566,284.435C391.239,284.096 390.911,283.757 390.584,283.417L390.284,282.716Z"
                    fill="#006098" />
                  <path
                    d="M370.734,283.725L370.462,284.465C370.127,284.797 369.791,285.13 369.455,285.462C369.8,284.472 369.894,284.637 370.734,283.725Z"
                    fill="#006098" />
                  <path
                    d="M112.422,199.575C112.852,200.148 113.283,200.721 113.713,201.294C113.283,200.721 112.852,200.148 112.422,199.575Z"
                    fill="#006098" />
                  <path
                    d="M224.423,436.427C223.659,437.195 223.77,437.228 222.763,437.676C223.028,437.413 222.7,437.021 224.423,436.427Z"
                    fill="#006098" />
                  <path
                    d="M276.709,381.705L276.411,382.412C276.08,382.748 275.749,383.084 275.417,383.42L275.713,382.712C276.045,382.376 276.377,382.041 276.709,381.705Z"
                    fill="#006098" />
                  <path
                    d="M389.288,281.703C389.62,282.041 389.952,282.378 390.284,282.716L390.584,283.417C390.152,282.846 389.72,282.275 389.288,281.703Z"
                    fill="#006098" />
                  <path
                    d="M309.578,260.421L310.289,260.715C310.623,261.046 310.957,261.378 311.291,261.709L310.593,261.405C310.254,261.077 309.916,260.749 309.578,260.421Z"
                    fill="#006098" />
                  <path
                    d="M374.703,279.697L374.397,280.403C374.072,280.743 373.747,281.084 373.422,281.425L373.712,280.707C374.042,280.37 374.373,280.034 374.703,279.697Z"
                    fill="#006098" />
                  <path
                    d="M532.295,602.731C531.795,603.006 531.294,603.281 530.794,603.556C530.85,603.44 531.5,602.102 531.5,602.102C531.838,602.111 531.957,602.722 532.295,602.731Z"
                    fill="#006098" />
                  <path
                    d="M304.544,255.446C305.513,255.794 305.351,255.879 306.278,256.731L305.545,256.453C305.212,256.117 304.878,255.782 304.544,255.446Z"
                    fill="#006098" />
                  <path
                    d="M310.593,261.405L311.291,261.709C311.628,262.042 311.965,262.374 312.301,262.706L311.599,262.399C311.263,262.068 310.928,261.736 310.593,261.405Z"
                    fill="#006098" />
                  <path
                    d="M225.703,434.697L225.394,435.4C225.07,435.743 224.747,436.085 224.423,436.427C224.85,435.85 225.276,435.273 225.703,434.697Z"
                    fill="#006098" />
                  <path
                    d="M592.466,91.63C593.472,91.935 594.478,92.241 595.484,92.546C594.478,92.241 593.472,91.935 592.466,91.63Z"
                    fill="#006098" />
                  <path
                    d="M567.666,862.471C567.875,863.485 568.084,864.499 568.293,865.513C568.084,864.499 567.875,863.485 567.666,862.471Z"
                    fill="#006098" />
                  <path
                    d="M277.704,380.703L277.395,381.398C277.067,381.736 276.739,382.074 276.411,382.412L276.709,381.705C277.041,381.371 277.372,381.037 277.704,380.703Z"
                    fill="#006098" />
                  <path d="M583.677,977.471C584.098,979.007 584.107,978.92 583.902,980.458L583.677,977.471Z"
                    fill="#006098" />
                  <path
                    d="M278.701,379.695L278.389,380.391C278.058,380.727 277.726,381.062 277.395,381.398L277.704,380.703C278.036,380.367 278.369,380.031 278.701,379.695Z"
                    fill="#006098" />
                  <path
                    d="M535.296,433.703C535.625,434.038 535.954,434.372 536.283,434.707L536.575,435.43C536.254,435.084 535.934,434.738 535.613,434.392L535.296,433.703Z"
                    fill="#006098" />
                  <path
                    d="M117.704,205.296L118.391,205.611C118.73,205.938 119.069,206.265 119.409,206.593C118.841,206.161 118.273,205.728 117.704,205.296Z"
                    fill="#006098" />
                  <path
                    d="M116.699,204.297L117.391,204.611C117.724,204.944 118.057,205.278 118.391,205.611L117.704,205.296C117.369,204.963 117.034,204.63 116.699,204.297Z"
                    fill="#006098" />
                  <path d="M577.683,934.469C578.104,936.008 578.112,935.92 577.916,937.455L577.683,934.469Z"
                    fill="#006098" />
                  <path
                    d="M561.677,819.469C561.885,820.483 562.092,821.498 562.3,822.512C562.092,821.498 561.885,820.483 561.677,819.469Z"
                    fill="#006098" />
                  <path
                    d="M580.553,501.441C581.142,501.858 581.731,502.275 582.32,502.692C581.731,502.275 581.142,501.858 580.553,501.441Z"
                    fill="#006098" />
                  <path
                    d="M508.694,167.687C508.267,168.266 507.841,168.845 507.415,169.424C507.841,168.845 508.267,168.266 508.694,167.687Z"
                    fill="#006098" />
                  <path
                    d="M155.685,241.307C156.27,241.727 156.854,242.147 157.439,242.566C156.854,242.147 156.27,241.727 155.685,241.307Z"
                    fill="#006098" />
                  <path
                    d="M555.674,776.469C555.884,777.483 556.094,778.498 556.304,779.513C556.094,778.498 555.884,777.483 555.674,776.469Z"
                    fill="#006098" />
                  <path
                    d="M114.387,201.609C114.719,201.945 115.051,202.281 115.382,202.616L115.701,203.301C115.263,202.737 114.825,202.173 114.387,201.609Z"
                    fill="#006098" />
                  <path
                    d="M375.694,278.693L375.372,279.375C375.047,279.718 374.722,280.06 374.397,280.403L374.703,279.697C375.034,279.362 375.364,279.028 375.694,278.693Z"
                    fill="#006098" />
                  <path
                            d="M241.416,455.408C240.84,455.836 240.263,456.265 239.687,456.693C240.263,456.265 240.84,455.836 241.416,455.408Z"
                            fill="#006098" />
                          <path
                            d="M534.299,432.699C534.632,433.034 534.964,433.368 535.296,433.703L535.613,434.392C535.282,434.055 534.951,433.718 534.62,433.381L534.299,432.699Z"
                            fill="#006098" />
                          <path
                            d="M311.599,262.399L312.301,262.706C312.639,263.035 312.976,263.363 313.314,263.692C312.742,263.261 312.17,262.83 311.599,262.399Z"
                            fill="#006098" />
                          <path
                            d="M226.693,433.689C226.26,434.26 225.827,434.83 225.394,435.4L225.703,434.697C226.033,434.361 226.363,434.025 226.693,433.689Z"
                            fill="#006098" />
                          <path
                            d="M279.69,378.687C279.256,379.255 278.823,379.823 278.389,380.391L278.701,379.695C279.031,379.359 279.36,379.023 279.69,378.687Z"
                            fill="#006098" />
                          <path
                            d="M376.69,277.687C376.251,278.25 375.811,278.813 375.372,279.375L375.694,278.693C376.026,278.358 376.358,278.022 376.69,277.687Z"
                            fill="#006098" />
                          <path
                            d="M148.512,1.512C148.208,2.189 147.904,2.866 147.6,3.543C147.904,2.866 148.208,2.189 148.512,1.512Z"
                            fill="#006098" />
                        </g>
                      </svg>` 
                    : displayEmoji;
                
                html += `<li style="display: flex; gap: 8px; align-items: center; margin-bottom: 6px;">
                    <span style="font-size: 1.1rem; flex-shrink: 0;">${listIcon}</span>
                    <span style="flex: 1; font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${esc(fav.name)}</span>
                    <button class="admin-only" onclick="openFavoriteEditModal('${fav.id}')" style="background: transparent; border: none; cursor: pointer; font-size: 1rem;" title="Edit Favorite" aria-label="Edit this favorite">✏️</button>
                    <button class="admin-only" onclick="deleteFavorite('${fav.id}')" style="background: transparent; border: none; cursor: pointer; font-size: 1rem;" title="Delete Favorite" aria-label="Delete this favorite">🗑️</button>
                </li>`;
            });
        }
        html += `</ul></div>`;
    }
    
    panel.innerHTML = html;
}

function renderFavoriteMarkers() {
    if (!map) return;
    favoriteMarkers.forEach(m => map.removeLayer(m));
    favoriteMarkers = [];

    favoriteLocations.forEach(fav => {
        const catKey = fav.category || "other";
        const cat = FAV_CATEGORIES[catKey] || FAV_CATEGORIES.other;
        const displayEmoji = fav.customEmoji || cat.emoji;

        // Build the internal HTML for the pin
        let pinInnerHtml = "";
        let pinBgColor = cat.color;
        let pinBorderColor = cat.color;
        let pinTextColor = "white";

        if (catKey === "dutchbros") {
          // Dutch Bros Special Case: White pin, Blue border, Logo inside
          pinBgColor = "#ffffff";
          pinBorderColor = "#156299";
          pinTextColor = "#156299";
          
          // Adjust the SVG sizing and color to fit inside the 30x30 pin
          pinInnerHtml = `<svg class="dutch-bros-icon" style="width: 18px; height: 18px; fill: #156299;" viewBox="0 0 1131 1539" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
            <g transform="matrix(1.50293,0,0,1.50293,0,0)">
              <path
                    d="M751.999,160.5L751.999,162.5C711.079,172.336 645.385,203.055 636.56,208.61C634.18,210.108 617.242,218.864 610.398,223.347C603.61,227.793 591.428,234.931 589.76,235.908C585.255,238.548 581.135,241.813 580.423,242.378C576.344,245.61 575.841,244.846 569.304,250.252C568.196,250.7 568.286,250.694 567.445,251.416C557.485,259.069 557.016,258.329 547.235,266.184C524.534,284.416 494.493,308.376 458.201,351.348C456.315,353.582 458.854,353.763 532.621,431.382C532.782,431.541 533.624,432.374 534.62,433.381C534.951,433.718 535.282,434.055 535.613,434.392C535.934,434.738 536.254,435.084 536.575,435.43C536.899,435.771 537.224,436.113 537.549,436.454C537.883,436.788 538.216,437.121 538.55,437.455C540.053,438.419 540.837,438.206 540.224,439.362C539.574,440.59 521.103,443.923 519.421,444.226C512.248,445.521 511.259,444.929 511.496,446.501C511.583,447.079 518.005,450.487 521.389,453.657C522.395,454.598 522.632,454.26 535.277,463.832C535.754,464.759 535.759,464.656 536.613,465.362C550.541,475.035 549.729,475.972 566.268,488.82C566.782,489.812 566.811,489.695 567.613,490.367C573.319,494.621 573.147,494.713 578.479,499.528C579.562,500.534 579.497,500.474 580.553,501.441C581.142,501.858 581.731,502.275 582.32,502.692C588.517,508.528 592.949,511.47 607.833,526.156C621.233,539.38 621.46,538.998 634.694,552.308C651.245,568.953 670.458,590.178 670.582,591.491C670.87,594.54 641.106,674.981 614.132,724.312C599.787,750.548 598.372,756.014 597.583,751.453C597.255,749.558 596.319,744.146 590.719,728.413C588.637,722.563 575.668,686.128 561.307,656.588C549.476,632.252 533.415,606.375 532.295,602.731C531.957,602.722 531.838,602.111 531.5,602.102C531.5,602.102 530.85,603.44 530.794,603.556C534.616,619.138 553.059,760.939 555.674,776.469C555.884,777.483 556.094,778.498 556.304,779.513C556.621,785.081 556.72,785.002 557.628,790.477C557.859,791.821 558.089,793.166 558.32,794.51C558.498,796.517 559.122,803.54 561.677,819.469C561.885,820.483 562.092,821.498 562.3,822.512C562.476,825.752 562.304,825.719 562.789,828.453C564.912,840.438 566.529,855.539 567.666,862.471C567.875,863.485 568.084,864.499 568.293,865.513C568.518,869.595 568.613,869.524 569.242,873.56C570.951,884.519 570.578,884.514 570.753,885.457C572.509,894.9 576.698,928.734 577.683,934.469L577.916,937.455C578.175,938.719 578.384,940.264 578.417,940.509C578.624,942.048 579.542,947.839 579.643,948.476L579.959,952.45C582.158,964.958 581.758,964.942 583.677,977.471L583.902,980.458C584.18,981.819 584.485,984.172 584.527,984.496C584.698,985.824 585.527,990.923 585.618,991.481L585.938,995.453C586.896,1001.074 587.106,1001.996 587.235,1002.559C588.144,1006.546 585.107,1005.108 542.431,1014.245C502.184,1022.863 501.978,1021.774 498.611,1022.975C498.136,1023.144 497.974,1023.83 497.5,1023.999L264.5,1023.999C262.952,1023.299 263.127,1023.026 261.463,1022.625C253.794,1020.779 174.89,1005.856 174.48,1004.509C174.055,1003.113 179.235,970.185 179.469,967.497C179.535,966.744 200.532,817.844 200.755,816.561C201.039,814.926 203.882,793.126 204.723,788.554C206.661,778.021 208.717,761.749 209.012,759.411C216.182,702.661 228.387,624.16 229.605,610.508C229.745,608.948 233.492,598.403 228.367,604.354C227.26,605.641 227.134,605.5 213.354,619.346C210.573,622.141 167.233,660.656 164.34,662.166C163.044,662.843 99.125,642.927 17.755,601.023C8.52,596.267 8.093,594.677 0,592.5L0,590.5C12.759,587.834 86.104,566.472 166.269,514.157C197.138,494.012 224.857,469.913 229.674,465.725C234.765,461.299 234.789,461.434 239.687,456.693C240.263,456.265 240.84,455.836 241.416,455.408C247.63,449.54 253.573,445.895 248.399,444.954C246.314,444.575 222.997,440.334 222.476,439.514C222.396,439.388 222.497,439.377 222.763,437.676C223.77,437.228 223.659,437.195 224.423,436.427C224.747,436.085 225.07,435.743 225.394,435.4C225.827,434.83 226.26,434.26 226.693,433.689C230.298,430.015 260.765,398.97 271.468,387.474C271.802,387.14 272.137,386.806 272.471,386.473C272.797,386.132 273.123,385.792 273.449,385.451C273.779,385.114 274.109,384.777 274.439,384.44C274.765,384.1 275.091,383.76 275.417,383.42C275.749,383.084 276.08,382.748 276.411,382.412C276.739,382.074 277.067,381.736 277.395,381.398C277.726,381.062 278.058,380.727 278.389,380.391C278.823,379.823 279.256,379.255 279.69,378.687C284.911,373.376 304.519,354.129 304.358,352.536C304.277,351.732 227.198,306.218 159.504,244.495C158.419,243.481 158.491,243.548 157.439,242.566C156.854,242.147 156.27,241.727 155.685,241.307C153.695,239.377 143.642,229.627 130.497,217.503C130.168,217.165 129.839,216.828 129.509,216.49C129.168,216.165 128.826,215.841 128.484,215.516C128.151,215.183 127.818,214.849 127.485,214.515C127.144,214.189 126.804,213.863 126.464,213.537C126.131,213.203 125.798,212.87 125.465,212.536C124.445,211.556 123.606,210.715 123.447,210.554C123.107,210.228 122.767,209.901 122.427,209.574C122.094,209.241 121.761,208.907 121.428,208.573C121.265,208.417 120.407,207.595 119.409,206.593C119.069,206.265 118.73,205.938 118.391,205.611C118.057,205.278 117.724,204.944 117.391,204.611C117.228,204.453 116.376,203.625 115.382,202.616C115.051,202.281 114.719,201.945 114.387,201.609L113.713,201.294C113.283,200.721 112.852,200.148 112.422,199.575L111.726,199.282C111.239,198.219 111.233,198.323 110.46,197.538C110.137,197.195 109.814,196.852 109.491,196.509C109.159,196.174 108.828,195.839 108.496,195.503C108.172,195.162 107.847,194.82 107.523,194.478C106.467,193.42 106.536,193.489 105.525,192.479C93.013,179.469 93.368,179.218 80.959,166.068C75.805,160.605 78.557,159.691 80.342,153.463C81.928,147.926 93.257,118.357 93.645,117.542C93.707,117.412 93.958,117.456 94.02,117.326L94.705,114.613C96.385,110.919 96.27,110.955 98.016,107.32L98.717,104.623C107.948,84.549 113.134,67.227 147.6,3.543C147.904,2.866 148.208,2.189 148.512,1.512L149.461,1.05C150.144,1.753 150.529,1.385 150.764,2.392C150.805,2.567 150.938,3.135 151.355,4.559C157.467,25.444 167.439,49.833 169.02,53.699C172.516,62.249 172.609,62.122 176.241,70.606C198.914,123.573 237.231,178.511 246.864,190.22C248.267,191.926 258.555,204.432 264.098,211.786C273.874,224.759 274.559,224.098 304.544,255.446C304.878,255.782 305.212,256.117 305.545,256.453C305.882,256.782 306.22,257.112 306.557,257.442C306.891,257.774 307.225,258.107 307.56,258.44C307.898,258.768 308.236,259.096 308.575,259.424C308.909,259.756 309.243,260.089 309.578,260.421C309.916,260.749 310.254,261.077 310.593,261.405C310.928,261.736 311.263,262.068 311.599,262.399C312.17,262.83 312.742,263.261 313.314,263.692C321.222,271.407 321.275,271.195 329.481,278.525C330.559,279.509 330.499,279.455 331.574,280.417C335.618,283.879 335.578,283.798 339.666,287.296C353.782,299.374 353.901,299.561 355.493,299.442C356.627,299.358 368.383,286.624 369.455,285.462C369.791,285.13 370.127,284.797 370.462,284.465C371.451,283.451 372.292,282.614 372.453,282.454C372.776,282.111 373.099,281.768 373.422,281.425C373.747,281.084 374.072,280.743 374.397,280.403C374.722,280.06 375.047,279.718 375.372,279.375C375.811,278.813 376.251,278.25 376.69,277.687C380.292,274.069 380.177,273.892 380.614,273.851C381.546,273.762 381.66,273.883 389.288,281.703C389.72,282.275 390.152,282.846 390.584,283.417C390.911,283.757 391.239,284.096 391.566,284.435C391.897,284.771 392.229,285.107 392.56,285.443L393.265,285.726C393.738,286.786 393.738,286.694 394.517,287.484C394.839,287.828 395.162,288.171 395.484,288.515C395.821,288.844 396.159,289.174 396.496,289.503C405.282,299.12 405.374,299.279 406.491,299.268C407.275,299.26 407.274,299.05 412.331,291.402C413.923,288.995 428.95,266.271 432.619,261.577C433.544,260.521 433.501,260.581 434.333,259.385C439.784,251.884 475.521,202.71 507.415,169.424C507.841,168.845 508.267,168.266 508.694,167.687C522.973,152.932 522.8,152.852 537.236,138.241C554.056,121.217 566.181,110.417 570.922,105.95C576.624,100.579 576.877,100.943 582.602,95.627C586.731,91.792 587.3,89.561 592.466,91.63C593.472,91.935 594.478,92.241 595.484,92.546C596.977,93.229 598.215,93.565 598.46,93.631C601.147,94.361 608.423,97.338 609.477,97.581C616.25,99.146 663.075,117.901 678.279,124.949C707.836,138.65 707.9,138.432 710.426,139.709C719.977,144.537 719.887,144.685 720.721,145.096C749.543,159.282 749.246,160.053 751.999,160.5Z"
                    fill="#006098" />
                  <path
                    d="M105.525,192.479C106.536,193.489 106.467,193.42 107.523,194.478C106.793,193.954 106.65,194.584 105.966,194.093C105.858,194.015 105.934,193.974 105.525,192.479Z"
                    fill="#006098" />
                  <path d="M585.618,991.481C586.218,993.472 586.255,993.405 585.938,995.453L585.618,991.481Z"
                    fill="#006098" />
                  <path
                    d="M434.333,259.385C433.501,260.581 433.544,260.521 432.619,261.577C432.958,260.031 432.913,259.932 434.333,259.385Z"
                    fill="#006098" />
                  <path
                    d="M372.453,282.454C372.292,282.614 371.451,283.451 370.462,284.465L370.734,283.725C371.307,283.301 371.88,282.878 372.453,282.454Z"
                    fill="#006098" />
                  <path
                    d="M578.479,499.528C579.976,499.954 580.065,499.93 580.553,501.441C579.497,500.474 579.562,500.534 578.479,499.528Z"
                    fill="#006098" />
                  <path
                    d="M123.447,210.554C123.606,210.715 124.445,211.556 125.465,212.536L124.723,212.271C124.298,211.699 123.872,211.127 123.447,210.554Z"
                    fill="#006098" />
                  <path
                    d="M557.628,790.477C557.859,791.821 558.089,793.166 558.32,794.51C558.089,793.166 557.859,791.821 557.628,790.477Z"
                    fill="#006098" />
                  <path d="M579.643,948.476C580.228,950.488 580.253,950.44 579.959,952.45L579.643,948.476Z"
                    fill="#006098" />
                  <path
                    d="M329.481,278.525C330.989,278.963 331.066,278.948 331.574,280.417C330.499,279.455 330.559,279.509 329.481,278.525Z"
                    fill="#006098" />
                  <path
                    d="M157.439,242.566C158.491,243.548 158.419,243.481 159.504,244.495C158.025,244.04 157.942,244.061 157.439,242.566Z"
                    fill="#006098" />
                  <path
                    d="M119.409,206.593C120.407,207.595 121.265,208.417 121.428,208.573L120.711,208.283C120.277,207.719 119.843,207.156 119.409,206.593Z"
                    fill="#006098" />
                  <path
                    d="M115.382,202.616C116.376,203.625 117.228,204.453 117.391,204.611L116.699,204.297C116.366,203.965 116.034,203.633 115.701,203.301L115.382,202.616Z"
                    fill="#006098" />
                  <path
                    d="M532.621,431.382C533.181,431.821 533.74,432.26 534.299,432.699L534.62,433.381C533.624,432.374 532.782,431.541 532.621,431.382Z"
                    fill="#006098" />
                  <path
                    d="M107.523,194.478C107.847,194.82 108.172,195.162 108.496,195.503L108.737,196.263C108.333,195.668 107.928,195.073 107.523,194.478Z"
                    fill="#006098" />
                  <path
                    d="M108.496,195.503C108.828,195.839 109.159,196.174 109.491,196.509L109.738,197.271C109.404,196.935 109.071,196.599 108.737,196.263L108.496,195.503Z"
                    fill="#006098" />
                  <path d="M98.717,104.623L98.016,107.32C97.9,105.834 98.102,105.926 98.717,104.623Z" fill="#006098" />
                  <path
                    d="M126.729,214.265L127.485,214.515C127.818,214.849 128.151,215.183 128.484,215.516L127.735,215.267C127.4,214.933 127.064,214.599 126.729,214.265Z"
                    fill="#006098" />
                  <path
                    d="M127.735,215.267L128.484,215.516C128.826,215.841 129.168,216.165 129.509,216.49L128.733,216.253C128.4,215.924 128.068,215.595 127.735,215.267Z"
                    fill="#006098" />
                  <path
                    d="M394.264,286.735C394.592,287.069 394.921,287.402 395.249,287.736L395.484,288.515C395.162,288.171 394.839,287.828 394.517,287.484L394.264,286.735Z"
                    fill="#006098" />
                  <path d="M94.705,114.613L94.02,117.326C93.902,115.83 94.103,115.913 94.705,114.613Z" fill="#006098" />
                  <path
                    d="M393.265,285.726C393.598,286.062 393.931,286.399 394.264,286.735L394.517,287.484C393.738,286.694 393.738,286.786 393.265,285.726Z"
                    fill="#006098" />
                  <path
                    d="M395.249,287.736C396.057,288.616 396.182,288.44 396.496,289.503C396.159,289.174 395.821,288.844 395.484,288.515L395.249,287.736Z"
                    fill="#006098" />
                  <path
                    d="M125.73,213.272L126.464,213.537C126.804,213.863 127.144,214.189 127.485,214.515L126.729,214.265C126.396,213.934 126.063,213.603 125.73,213.272Z"
                    fill="#006098" />
                  <path
                    d="M124.723,212.271L125.465,212.536C125.798,212.87 126.131,213.203 126.464,213.537L125.73,213.272C125.394,212.938 125.059,212.605 124.723,212.271Z"
                    fill="#006098" />
                  <path
                    d="M109.491,196.509C109.814,196.852 110.137,197.195 110.46,197.538L110.728,198.273C110.398,197.939 110.068,197.605 109.738,197.271L109.491,196.509Z"
                    fill="#006098" />
                  <path
                    d="M128.733,216.253L129.509,216.49C129.839,216.828 130.168,217.165 130.497,217.503C129.446,217.186 129.619,217.065 128.733,216.253Z"
                    fill="#006098" />
                  <path
                    d="M537.274,435.72C537.699,436.299 538.125,436.877 538.55,437.455C538.216,437.121 537.883,436.788 537.549,436.454L537.274,435.72Z"
                    fill="#006098" />
                  <path
                    d="M569.304,250.252C569.004,250.511 569.316,250.942 567.445,251.416C568.286,250.694 568.196,250.7 569.304,250.252Z"
                    fill="#006098" />
                  <path
                    d="M110.46,197.538C111.233,198.323 111.239,198.219 111.726,199.282C111.394,198.945 111.061,198.609 110.728,198.273L110.46,197.538Z"
                    fill="#006098" />
                  <path
                    d="M273.724,384.722L273.449,385.451C273.123,385.792 272.797,386.132 272.471,386.473L272.736,385.725C273.065,385.391 273.395,385.056 273.724,384.722Z"
                    fill="#006098" />
                  <path
                    d="M305.545,256.453L306.278,256.731C306.611,257.061 306.945,257.392 307.278,257.722L306.557,257.442C306.22,257.112 305.882,256.782 305.545,256.453Z"
                    fill="#006098" />
                  <path
                    d="M274.719,383.714L274.439,384.44C274.109,384.777 273.779,385.114 273.449,385.451L273.724,384.722C274.056,384.386 274.388,384.05 274.719,383.714Z"
                    fill="#006098" />
                  <path
                    d="M306.557,257.442L307.278,257.722C307.613,258.055 307.948,258.388 308.283,258.721L307.56,258.44C307.225,258.107 306.891,257.774 306.557,257.442Z"
                    fill="#006098" />
                  <path
                    d="M391.279,283.717C391.706,284.292 392.133,284.867 392.56,285.443C392.229,285.107 391.897,284.771 391.566,284.435L391.279,283.717Z"
                    fill="#006098" />
                  <path
                    d="M373.712,280.707L373.422,281.425C373.099,281.768 372.776,282.111 372.453,282.454C372.873,281.872 373.292,281.289 373.712,280.707Z"
                    fill="#006098" />
                  <path
                    d="M536.283,434.707C536.613,435.045 536.944,435.383 537.274,435.72L537.549,436.454C537.224,436.113 536.899,435.771 536.575,435.43L536.283,434.707Z"
                    fill="#006098" />
                  <path
                    d="M121.718,209.283L122.427,209.574C122.767,209.901 123.107,210.228 123.447,210.554C122.871,210.131 122.294,209.707 121.718,209.283Z"
                    fill="#006098" />
                  <path
                    d="M120.711,208.283L121.428,208.573C121.761,208.907 122.094,209.241 122.427,209.574L121.718,209.283C121.383,208.949 121.047,208.616 120.711,208.283Z"
                    fill="#006098" />
                  <path
                    d="M307.56,258.44L308.283,258.721C308.617,259.053 308.951,259.384 309.284,259.716L308.575,259.424C308.236,259.096 307.898,258.768 307.56,258.44Z"
                    fill="#006098" />
                  <path
                    d="M535.277,463.832C535.382,463.924 535.858,463.425 536.613,465.362C535.759,464.656 535.754,464.759 535.277,463.832Z"
                    fill="#006098" />
                  <path
                    d="M566.268,488.82C566.374,488.914 566.849,488.421 567.613,490.367C566.811,489.695 566.782,489.812 566.268,488.82Z"
                    fill="#006098" />
                  <path
                    d="M275.713,382.712L275.417,383.42C275.091,383.76 274.765,384.1 274.439,384.44L274.719,383.714C275.05,383.38 275.382,383.046 275.713,382.712Z"
                    fill="#006098" />
                  <path
                    d="M272.736,385.725L272.471,386.473C272.137,386.806 271.802,387.14 271.468,387.474C271.805,386.47 271.905,386.635 272.736,385.725Z"
                    fill="#006098" />
                  <path
                    d="M308.575,259.424L309.284,259.716C309.619,260.049 309.954,260.382 310.289,260.715L309.578,260.421C309.243,260.089 308.909,259.756 308.575,259.424Z"
                    fill="#006098" />
                  <path
                    d="M390.284,282.716C390.616,283.049 390.947,283.383 391.279,283.717L391.566,284.435C391.239,284.096 390.911,283.757 390.584,283.417L390.284,282.716Z"
                    fill="#006098" />
                  <path
                    d="M370.734,283.725L370.462,284.465C370.127,284.797 369.791,285.13 369.455,285.462C369.8,284.472 369.894,284.637 370.734,283.725Z"
                    fill="#006098" />
                  <path
                    d="M112.422,199.575C112.852,200.148 113.283,200.721 113.713,201.294C113.283,200.721 112.852,200.148 112.422,199.575Z"
                    fill="#006098" />
                  <path
                    d="M224.423,436.427C223.659,437.195 223.77,437.228 222.763,437.676C223.028,437.413 222.7,437.021 224.423,436.427Z"
                    fill="#006098" />
                  <path
                    d="M276.709,381.705L276.411,382.412C276.08,382.748 275.749,383.084 275.417,383.42L275.713,382.712C276.045,382.376 276.377,382.041 276.709,381.705Z"
                    fill="#006098" />
                  <path
                    d="M389.288,281.703C389.62,282.041 389.952,282.378 390.284,282.716L390.584,283.417C390.152,282.846 389.72,282.275 389.288,281.703Z"
                    fill="#006098" />
                  <path
                    d="M309.578,260.421L310.289,260.715C310.623,261.046 310.957,261.378 311.291,261.709L310.593,261.405C310.254,261.077 309.916,260.749 309.578,260.421Z"
                    fill="#006098" />
                  <path
                    d="M374.703,279.697L374.397,280.403C374.072,280.743 373.747,281.084 373.422,281.425L373.712,280.707C374.042,280.37 374.373,280.034 374.703,279.697Z"
                    fill="#006098" />
                  <path
                    d="M532.295,602.731C531.795,603.006 531.294,603.281 530.794,603.556C530.85,603.44 531.5,602.102 531.5,602.102C531.838,602.111 531.957,602.722 532.295,602.731Z"
                    fill="#006098" />
                  <path
                    d="M304.544,255.446C305.513,255.794 305.351,255.879 306.278,256.731L305.545,256.453C305.212,256.117 304.878,255.782 304.544,255.446Z"
                    fill="#006098" />
                  <path
                    d="M310.593,261.405L311.291,261.709C311.628,262.042 311.965,262.374 312.301,262.706L311.599,262.399C311.263,262.068 310.928,261.736 310.593,261.405Z"
                    fill="#006098" />
                  <path
                    d="M225.703,434.697L225.394,435.4C225.07,435.743 224.747,436.085 224.423,436.427C224.85,435.85 225.276,435.273 225.703,434.697Z"
                    fill="#006098" />
                  <path
                    d="M592.466,91.63C593.472,91.935 594.478,92.241 595.484,92.546C594.478,92.241 593.472,91.935 592.466,91.63Z"
                    fill="#006098" />
                  <path
                    d="M567.666,862.471C567.875,863.485 568.084,864.499 568.293,865.513C568.084,864.499 567.875,863.485 567.666,862.471Z"
                    fill="#006098" />
                  <path
                    d="M277.704,380.703L277.395,381.398C277.067,381.736 276.739,382.074 276.411,382.412L276.709,381.705C277.041,381.371 277.372,381.037 277.704,380.703Z"
                    fill="#006098" />
                  <path d="M583.677,977.471C584.098,979.007 584.107,978.92 583.902,980.458L583.677,977.471Z"
                    fill="#006098" />
                  <path
                    d="M278.701,379.695L278.389,380.391C278.058,380.727 277.726,381.062 277.395,381.398L277.704,380.703C278.036,380.367 278.369,380.031 278.701,379.695Z"
                    fill="#006098" />
                  <path
                    d="M535.296,433.703C535.625,434.038 535.954,434.372 536.283,434.707L536.575,435.43C536.254,435.084 535.934,434.738 535.613,434.392L535.296,433.703Z"
                    fill="#006098" />
                  <path
                    d="M117.704,205.296L118.391,205.611C118.73,205.938 119.069,206.265 119.409,206.593C118.841,206.161 118.273,205.728 117.704,205.296Z"
                    fill="#006098" />
                  <path
                    d="M116.699,204.297L117.391,204.611C117.724,204.944 118.057,205.278 118.391,205.611L117.704,205.296C117.369,204.963 117.034,204.63 116.699,204.297Z"
                    fill="#006098" />
                  <path d="M577.683,934.469C578.104,936.008 578.112,935.92 577.916,937.455L577.683,934.469Z"
                    fill="#006098" />
                  <path
                    d="M561.677,819.469C561.885,820.483 562.092,821.498 562.3,822.512C562.092,821.498 561.885,820.483 561.677,819.469Z"
                    fill="#006098" />
                  <path
                    d="M580.553,501.441C581.142,501.858 581.731,502.275 582.32,502.692C581.731,502.275 581.142,501.858 580.553,501.441Z"
                    fill="#006098" />
                  <path
                    d="M508.694,167.687C508.267,168.266 507.841,168.845 507.415,169.424C507.841,168.845 508.267,168.266 508.694,167.687Z"
                    fill="#006098" />
                  <path
                    d="M155.685,241.307C156.27,241.727 156.854,242.147 157.439,242.566C156.854,242.147 156.27,241.727 155.685,241.307Z"
                    fill="#006098" />
                  <path
                    d="M555.674,776.469C555.884,777.483 556.094,778.498 556.304,779.513C556.094,778.498 555.884,777.483 555.674,776.469Z"
                    fill="#006098" />
                  <path
                    d="M114.387,201.609C114.719,201.945 115.051,202.281 115.382,202.616L115.701,203.301C115.263,202.737 114.825,202.173 114.387,201.609Z"
                    fill="#006098" />
                  <path
                    d="M375.694,278.693L375.372,279.375C375.047,279.718 374.722,280.06 374.397,280.403L374.703,279.697C375.034,279.362 375.364,279.028 375.694,278.693Z"
                    fill="#006098" />
                  <path
                    d="M241.416,455.408C240.84,455.836 240.263,456.265 239.687,456.693C240.263,456.265 240.84,455.836 241.416,455.408Z"
                    fill="#006098" />
                  <path
                    d="M534.299,432.699C534.632,433.034 534.964,433.368 535.296,433.703L535.613,434.392C535.282,434.055 534.951,433.718 534.62,433.381L534.299,432.699Z"
                    fill="#006098" />
                  <path
                    d="M311.599,262.399L312.301,262.706C312.639,263.035 312.976,263.363 313.314,263.692C312.742,263.261 312.17,262.83 311.599,262.399Z"
                    fill="#006098" />
                  <path
                    d="M226.693,433.689C226.26,434.26 225.827,434.83 225.394,435.4L225.703,434.697C226.033,434.361 226.363,434.025 226.693,433.689Z"
                    fill="#006098" />
                  <path
                    d="M279.69,378.687C279.256,379.255 278.823,379.823 278.389,380.391L278.701,379.695C279.031,379.359 279.36,379.023 279.69,378.687Z"
                    fill="#006098" />
                  <path
                    d="M376.69,277.687C376.251,278.25 375.811,278.813 375.372,279.375L375.694,278.693C376.026,278.358 376.358,278.022 376.69,277.687Z"
                    fill="#006098" />
                  <path
                    d="M148.512,1.512C148.208,2.189 147.904,2.866 147.6,3.543C147.904,2.866 148.208,2.189 148.512,1.512Z"
                    fill="#006098" />
            </g>
          </svg>`;
      } else {
            // Standard Emoji Case
            pinInnerHtml = `<div style="font-size: 14px; color: ${pinTextColor};">${displayEmoji}</div>`;
        }

        const customPin = L.divIcon({
            className: 'custom-div-icon',
            html: `<div style="background-color: ${pinBgColor}; color: ${pinTextColor}; border-radius: 50% 50% 50% 0; width: 30px; height: 30px; transform: rotate(-45deg); border: 3px solid ${pinBorderColor}; box-shadow: 0 2px 5px rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center;"><div style="transform: rotate(45deg); display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;">${pinInnerHtml}</div></div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 30],
            popupAnchor: [0, -30]
        });

        const marker = L.marker([fav.lat, fav.lng], { icon: customPin, bubblingMouseEvents: false }).addTo(map);
        
        // ... (keep your existing editBtnHtml variable, just make sure it's defined above here) ...
        const editBtnHtml = isAdmin()
            ? `<button onclick="openFavoriteEditModal('${fav.id}')" style="background: #BC9E84; color: white; border: none; padding: 6px 10px; border-radius: 4px; cursor: pointer; width: 100%; margin-bottom: 4px; font-weight: bold;">✏️ Edit</button>`
            : "";

        const favGmapsUrl = `https://www.google.com/maps?q=${fav.lat},${fav.lng}&z=15`;
        
        // Hide GMaps link for Dutch Bros
        const gmapsBtnHtml = catKey === "dutchbros" ? "" : 
            `<a href="${favGmapsUrl}" target="_blank" rel="noopener" style="display: block; background: #1a73e8; color: white; padding: 8px 12px; border-radius: 4px; text-decoration: none; font-weight: bold; font-size: 0.85rem; margin-bottom: 6px;">📍 View on Google Maps</a>`;

        marker.bindPopup(`<div style="text-align:center; min-width: 160px;">
            <strong>${esc(fav.name)}</strong>
            <p style="font-size: 0.8rem; color: #666; margin: 4px 0 8px 0;">${esc(fav.notes || "")}</p>
            ${gmapsBtnHtml}
            ${editBtnHtml}
            <button onclick="addFavoriteToRoute('${fav.id}')" style="background: #6B8071; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; width: 100%; font-weight: bold;">+ Add to Route</button>
        </div>`);
        
        favoriteMarkers.push(marker);
    });
}

/* ============================================================
Batch 6: Favorite edit modal
============================================================ */
function openFavoriteEditModal(favId) {
  if (!isAdmin()) return;
  const fav = favoriteLocations.find(f => f.id === favId);
  if (!fav) return;

  editingFavoriteId = favId;

  document.getElementById("fav-edit-name").value = fav.name || "";
  document.getElementById("fav-edit-notes").value = fav.notes || ""; // 🆕 Added
  document.getElementById("fav-edit-tickets").value = fav.costs?.tickets || 0;
  document.getElementById("fav-edit-parking").value = fav.costs?.parking || 0;
  document.getElementById("fav-edit-food").value = fav.costs?.food || 0;
  document.getElementById("fav-edit-merch").value = fav.costs?.merch || 0;
  document.getElementById("fav-edit-category").value = fav.category || "other";
  document.getElementById("fav-edit-emoji").value = fav.customEmoji || "";
  document.getElementById("fav-edit-hidden").checked = fav.isHidden || false;

  favOpenHoursDraft = fav.openHours ? JSON.parse(JSON.stringify(fav.openHours)) : [];
  renderOpenHoursEditorShared("favOpenHoursList", favOpenHoursDraft, "fav");

  document.getElementById("favorite-edit-modal").classList.remove("hidden");
}

function closeFavoriteEditModal() {
  document.getElementById("favorite-edit-modal").classList.add("hidden");
  editingFavoriteId = null;
  favOpenHoursDraft = [];
  renderOpenHoursEditorShared("favOpenHoursList", favOpenHoursDraft, "fav");
}

function saveFavoriteEdit() {
  if (!editingFavoriteId) return;
  const fav = favoriteLocations.find(f => f.id === editingFavoriteId);
  if (!fav) { closeFavoriteEditModal(); return; }

  fav.name = document.getElementById("fav-edit-name").value.trim() || "Favorite";
  fav.notes = document.getElementById("fav-edit-notes").value.trim(); // 🆕 Added
  fav.costs = {
    tickets: parseFloat(document.getElementById("fav-edit-tickets").value) || 0,
    parking: parseFloat(document.getElementById("fav-edit-parking").value) || 0,
    food: parseFloat(document.getElementById("fav-edit-food").value) || 0,
    merch: parseFloat(document.getElementById("fav-edit-merch").value) || 0,
    fuel: 0
  };
  fav.category = document.getElementById("fav-edit-category").value;
  fav.customEmoji = document.getElementById("fav-edit-emoji").value.trim();
  fav.isHidden = document.getElementById("fav-edit-hidden").checked;

  fav.openHours = favOpenHoursDraft.length ? JSON.parse(JSON.stringify(favOpenHoursDraft)) : [];

  const savedName = fav.name;
  renderFavoriteMarkers();
  renderFavoritesUI(); // You may want to append the category emoji to the list view as well
  closeFavoriteEditModal();
  queueSave(`Edit favorite: ${savedName}`);
}

function addFavoriteToRoute(id) {
    const fav = favoriteLocations.find(f => f.id === id);
    if (!fav) return;

    const newStop = {
        id: Date.now(),
        name: fav.name,
        notes: fav.notes || "",
        lat: fav.lat,
        lng: fav.lng,
        completed: false,
        duration: 1, // 🆕 Defaults to 1 hour since we don't save Time Spent
        preferredTime: "",
        costs: fav.costs || { tickets: 0, parking: 0, food: 0, merch: 0, fuel: 0 },
        openHours: fav.openHours ? JSON.parse(JSON.stringify(fav.openHours)) : [],
        fieldVisibility: { tickets: true, parking: true, food: true, merch: true, duration: true, preferredTime: true }
    };

    currentStops.push(newStop);
    renderItinerary();
    updateRoute();
    map.closePopup();
}

function updateFavoriteName(id, newName) {
    const fav = favoriteLocations.find(f => f.id === id);
    if (fav) {
        fav.name = newName.trim() || "Favorite"; // 🆕 Reverts to "Favorite" if empty
        renderFavoriteMarkers();
        renderFavoritesUI();
        queueSave(`Update favorite name`);
    }
}

function deleteFavorite(id) {
    if (!confirm("Delete this favorite location?")) return;
    favoriteLocations = favoriteLocations.filter(f => f.id !== id);
    renderFavoriteMarkers();
    renderFavoritesUI();
    queueSave(`Delete favorite location`);
}

function addFavoriteByAddress() {
    const input = document.getElementById("fav-address-input");
    const address = input.value.trim();
    if (!address) return;

    fetch(`https://nominatim.openstreetmap.org/search?format=json&email=your_email@example.com&q=${encodeURIComponent(address)}`)
        .then(res => res.json())
        .then(data => {
            if (data && data.length > 0) {
                const lat = parseFloat(data[0].lat);
                const lng = parseFloat(data[0].lon);
                favoriteLocations.push({
                    id: "fav-" + Date.now(),
                    name: "Favorite",
                    lat: lat,
                    lng: lng
                });
                input.value = "";
                renderFavoriteMarkers();
                renderFavoritesUI();
                queueSave(`Add favorite location via address`);
            } else {
                alert("❌ Could not find that address.");
            }
        })
        .catch(err => alert("Error finding address: " + err.message));
}

/* ============================================================
Map Labels
============================================================ */
function addStateLabels() {
    const statesGroup = document.getElementById("states-group");
    if (!statesGroup) return;

    let labelGroup = document.getElementById("state-labels");
    if (!labelGroup) {
        labelGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        labelGroup.id = "state-labels";
        statesGroup.appendChild(labelGroup);
    }

    document.querySelectorAll(".state").forEach(state => {
        const stateId = state.id; 
        const bbox = state.getBBox();
        let cx = bbox.x + bbox.width / 2;
        let cy = bbox.y + bbox.height / 2;

        // Manual tweaks for weirdly shaped states
        if (stateId === "FL") { cy -= 30; cx += 30; }
        if (stateId === "MI") { cy += 40; cx += 30; }
        if (stateId === "LA") { cx -= 20; }
        if (stateId === "ME") { cx -= 5; cy -= 10; }
        if (stateId === "CA") { cx -= 15; cy += 10; }
        if (stateId === "KY") { cx += 10; cy += 3; }
        if (stateId === "OK") { cx += 20; }
        if (stateId === "TX") { cx += 20; }
        if (stateId === "NV") { cy -= 13; }
        if (stateId === "MN") { cx -= 20; cy += 10; }
        if (stateId === "ID") { cy += 40; }
        if (stateId === "VA") { cx += 20; cy += 10; }
        if (stateId === "WV") { cy += 10; cx -= 10; }
        if (stateId === "AK") { cx += 10; cy -= 10; }
        if (stateId === "HI") { cy += 10; }
        if (stateId === "MS") { cx += 5; }
        if (stateId === "SC") { cy -= 5; cx += 5; }
        if (stateId === "RI") { cx += 13; cy += 13; }
        if (stateId === "VT") { cy -= 10; }
        if (stateId === "NH") { cy += 15; }
        if (stateId === "MA") { cx += 28; cy -= 5; }
        if (stateId === "CT") { cy += 15; cx += 3; }
        if (stateId === "DE") { cy += 10; cx += 22; }
        if (stateId === "GA") { cy += 10; }
        if (stateId === "MD") { cy += 25; cx += 30; }
        if (stateId === "NJ") { cy += 5; cx += 23; }
        if (stateId === "MN") { cx += 5; }
        if (stateId === "IL") { cy += 0; cx += 0; }
      
          //           Y-
          //           ▲
          //           │
          //        -  │
          // X- ◄─────┼──────► X+
          //           │  +
          //           │
          //           ▼
          //           Y+

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", cx);
        text.setAttribute("y", cy);

        const transform = state.getAttribute("transform");
        if (transform) text.setAttribute("transform", transform);

        text.setAttribute("text-anchor", "middle");
        text.setAttribute("dominant-baseline", "central");
        text.setAttribute("font-family", "'Courier Prime', monospace");
        text.setAttribute("font-size", "16px"); 
        text.setAttribute("font-weight", "bold");
        text.setAttribute("fill", "#ffffff");
        text.setAttribute("stroke", "#2b2b2b");
        text.setAttribute("stroke-width", "4px");
        text.setAttribute("stroke-linejoin", "round");
        text.setAttribute("paint-order", "stroke"); 
        text.setAttribute("pointer-events", "none"); 
        
        text.textContent = stateId;
        labelGroup.appendChild(text);
    });
}

/* ============================================================
Batch 13: Suggestion / Comment System UI
============================================================ */
const SUGGESTIONS_STORAGE_KEY = "local_suggestions";

// Load local history from storage
function getLocalSuggestions() {
    try {
        return JSON.parse(localStorage.getItem(SUGGESTIONS_STORAGE_KEY) || "[]");
    } catch {
        return [];
    }
}

function saveLocalSuggestions(arr) {
    localStorage.setItem(SUGGESTIONS_STORAGE_KEY, JSON.stringify(arr));
}

// Populate the history lists on page load
function renderSuggestionHistories() {
    const suggestions = getLocalSuggestions();
    
    ["home", "trip"].forEach(context => {
        const listEl = document.getElementById(`suggestion-history-${context}`);
        if (!listEl) return;
        
        if (suggestions.length === 0) {
            listEl.innerHTML = `<li style="text-align:center; color:#888; font-style:italic; border:none; background:transparent;">No suggestions sent yet.</li>`;
            return;
        }

        // Sort newest first
        const sorted = [...suggestions].sort((a, b) => new Date(b.date) - new Date(a.date));
        
        listEl.innerHTML = sorted.map(s => `
            <li>
                <strong>${esc(s.topic)}</strong>: ${esc(s.text)}
                <span class="status-tag">Sent ✅</span>
                <span class="date-tag">${new Date(s.date).toLocaleDateString()} • by ${esc(s.name)}</span>
            </li>
        `).join("");
    });
}

// Toggle the accordion
window.toggleSuggestionHistory = function(context) {
    const list = document.getElementById(`suggestion-history-${context}`);
    const arrow = list.previousElementSibling.querySelector(".arrow");
    if (!list) return;
    
    if (list.style.display === "none") {
        list.style.display = "block";
        if (arrow) arrow.textContent = "▲";
    } else {
        list.style.display = "none";
        if (arrow) arrow.textContent = "▼";
    }
};

// Character counter
function setupCharCounter(context) {
    const textarea = document.getElementById(`suggestion-text-${context}`);
    const counter = document.getElementById(`suggestion-char-count-${context}`);
    if (!textarea || !counter) return;
    
    textarea.addEventListener("input", () => {
        const len = textarea.value.length;
        counter.textContent = `${len} / 500`;
        counter.style.color = len > 450 ? "var(--primary-orange)" : "#888";
    });
}

// Submit logic
window.submitSuggestion = async function(context) {
    const nameInput = document.getElementById(`suggestion-name-${context}`);
    const topicSelect = document.getElementById(`suggestion-topic-${context}`);
    const textInput = document.getElementById(`suggestion-text-${context}`);
    const submitBtn = document.getElementById(`suggestion-submit-${context}`);

    let name = nameInput.value.trim() || "Anonymous";
    let topic = topicSelect.value;
    let text = textInput.value.trim();

    if (!text) {
        alert("Please type a suggestion first!");
        return;
    }

    // Save name to localStorage for next time
    localStorage.setItem("user_suggestion_name", name === "Anonymous" ? "" : name);

    submitBtn.textContent = "Sending...";
    submitBtn.disabled = true;

    try {
    // 1. Strip URLs for safety
    const safeText = text.replace(/https?:\/\/[^\s]+/gi, "[link removed]");
    const safeName = name.replace(/https?:\/\/[^\s]+/gi, "");

    // 2. Build the payload
    const payload = {
        access_key: WEB3FORMS_ACCESS_KEY,
        subject: `[50 States] New Suggestion: ${topic}`,
        from_name: "50 States Gallery",
        Name: safeName,
        Topic: topic,
        Suggestion: safeText,
        botcheck: false // Honeypot for bots
    };

    // 3. Send to Web3Forms
    const response = await fetch("https://api.web3forms.com/submit", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json"
        },
        body: JSON.stringify(payload)
    });

    const result = await response.json();
    
    if (!result.success) {
        throw new Error(result.message || "Failed to send to Web3Forms.");
    }

    // 4. Save to local history (Use original text, so the user sees what they typed)
    const suggestions = getLocalSuggestions();
    suggestions.push({
        id: Date.now(),
        name: name,
        topic: topic,
        text: text,
        date: new Date().toISOString()
    });
    saveLocalSuggestions(suggestions);
    renderSuggestionHistories();

    // 5. Clear form
    textInput.value = "";
    if (document.getElementById(`suggestion-char-count-${context}`)) {
        document.getElementById(`suggestion-char-count-${context}`).textContent = "0 / 500";
    }

    // 6. Show Thank You Modal
    document.getElementById("thankyou-modal").classList.remove("hidden");

    } catch (err) {
        alert("Error sending suggestion: " + err.message);
    } finally {
        submitBtn.textContent = "Send Suggestion";
        submitBtn.disabled = false;
    }
};

// Close thank you modal
window.closeThankYouModal = function() {
    document.getElementById("thankyou-modal").classList.add("hidden");
    
    // Close the trip planner if it's open
    const tripModal = document.getElementById("planTripModal");
    if (tripModal && !tripModal.classList.contains("hidden")) {
        closeTripModal();
    }
};

// Initialize on load
document.addEventListener("DOMContentLoaded", () => {
    renderSuggestionHistories();
    setupCharCounter("home");
    setupCharCounter("trip");

    // Pre-fill remembered name
    const savedName = localStorage.getItem("user_suggestion_name");
    if (savedName) {
        const nameHome = document.getElementById("suggestion-name-home");
        const nameTrip = document.getElementById("suggestion-name-trip");
        if (nameHome) nameHome.value = savedName;
        if (nameTrip) nameTrip.value = savedName;
    }
});
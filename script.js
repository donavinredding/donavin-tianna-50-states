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
let favoriteLocations = []

let activeStateName = null;
let intervalId = null;
let draggedIndex = null;
let isEditMode = false;
let uploadQueue = [];

function esc(str) {
    return String(str ?? "").replace(/[&<>"']/g, c => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;",
        '"': "&quot;", "'": "&#39;"
    }[c]));
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
    } catch (err) {
        console.warn("Could not load data.json — starting empty.", err);
        stateGalleries = {};
        tripNotesText = "";
        nextStateTargets = new Set();
        savedTrips = {}; // 🆕 Fallback
        savedVehicles = {};
        favoriteLocations = [];
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
    const payload = JSON.stringify(
        {
            version: 1,
            updatedAt: new Date().toISOString(),
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
        
        // 🆕 Force-close any open modals so the user can't keep editing
        document.getElementById("gallery-modal").classList.remove("active");
        document.getElementById("planTripModal").classList.add("hidden");
        unlockScroll();
    }

    const notesEl = document.getElementById("plan-notes");
    if (notesEl) notesEl.readOnly = !isAdminUnlocked;

    if (!isAdminUnlocked) {
        isEditMode = false;
        const btn = document.getElementById("toggle-edit-btn");
        if (btn) { btn.classList.remove("active"); btn.textContent = "Edit Mode ✏️"; }
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

function openPlanTripModal(stateNameOrCode) {
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
                window.pendingManualRefuelIndex = undefined; 
                pendingLatLng = e.latlng;
                if (tempMarker) map.removeLayer(tempMarker);
                tempMarker = L.marker(pendingLatLng).addTo(map);
                document.getElementById("locationFormCard").style.display = "block";

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
}

function populateSavedTripsSelect() {
    const select = document.getElementById("savedTripsSelect");
    if (!select) return;
    const current = select.value;
    select.innerHTML = '<option value="new">+ Create New Trip</option>';

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
        costs: {
            tickets: parseFloat(document.getElementById("costTickets").value) || 0,
            parking: parseFloat(document.getElementById("costParking").value) || 0,
            food:    parseFloat(document.getElementById("costFood").value) || 0,
            merch:   parseFloat(document.getElementById("costMerch").value) || 0,
            fuel:    0
        }
        // Notice: We skip duration and preferredTime entirely here
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
        isRefuel: isRefuel // 🆕 Flag it so the math resets the tank
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

    renderItinerary();
    updateRoute();
}

function renderItinerary() {
    const list = document.getElementById("itineraryList");
    list.innerHTML = "";
    let grandTotal = 0;

    currentStops.forEach((stop, index) => {
        const t = stop.costs || {};
        const stopTotal = (t.tickets || 0) + (t.parking || 0) + (t.food || 0) + (t.merch || 0) + (t.fuel || 0);
        grandTotal += stopTotal;

        const extras = [
            stop.duration ? `⏱️ ${stop.duration}h` : "",
            stop.preferredTime ? `🕒 ${stop.preferredTime}` : ""
        ].filter(Boolean).join(" | ");

        const li = document.createElement("li");
        li.className = `stop-item ${stop.completed ? "completed" : ""}`;
        li.innerHTML = `
            <div class="stop-header">
                <span class="drag-handle">☰</span>
                <input type="checkbox" ${stop.completed ? "checked" : ""} onchange="toggleStopComplete(${index})">
                <strong>${index + 1}. ${esc(stop.name)}</strong>
                <span>$${stopTotal.toFixed(2)}</span>
                <button onclick="removeStop(${index})">🗑️</button>
            </div>
            <p class="stop-notes">${esc(stop.notes)}</p>
            <small>🎟️ $${t.tickets || 0} | 🅿️ $${t.parking || 0} | 🍔 $${t.food || 0} | 🛍️ $${t.merch || 0}${t.fuel ? ` | ⛽ $${t.fuel}` : ""}${extras ? " | " + extras : ""}</small>
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
    const warningThreshold = totalRange * 0.25; 
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

    // 🆕 Generate the Google Maps search link for this exact location
    const gmapsUrl = `https://www.google.com/maps/search/gas+station/@${latLng.lat},${latLng.lng},12z`;

    marker.bindPopup(`
        <div style="text-align: center; min-width: 220px;">
            <strong>⛽ Refuel Point</strong><br>
            <span style="font-size: 0.8rem;">You will hit 25% fuel (${warningThreshold.toFixed(0)} miles left) here.</span><br><br>
            
            <!-- Google Maps Link -->
            <a href="${gmapsUrl}" target="_blank" style="display: block; background: #1a73e8; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; text-decoration: none; font-weight: bold; margin-bottom: 8px; font-size: 0.9rem;">
                🔍 Find Gas on Google Maps
            </a>
            
            <!-- Manual Add Button -->
            <button onclick="prepManualRefuel(${targetStopIndex})" style="background: #6B8071; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; width: 100%; font-size: 0.85rem; font-weight: bold;">
                📍 Add Refuel Stop Manually
            </button>
        </div>
    `).openPopup();
}

function prepManualRefuel(targetStopIndex) {
    map.closePopup();
    window.pendingManualRefuelIndex = targetStopIndex;
    
    // Pre-fill the name
    const nameInput = document.getElementById("locName");
    if (nameInput) {
        nameInput.value = "⛽ Refuel Stop";
    }
    
    alert("Double-click the map on the gas station you want to add. The $40 fuel cost will be applied automatically.");
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
        favPanel.style.marginBottom = "16px";
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
                html += `
                    <li style="display: flex; gap: 8px; align-items: center; margin-bottom: 6px;">
                        <input type="text" value="${esc(fav.name)}" onchange="updateFavoriteName('${fav.id}', this.value)" style="flex: 1; padding: 4px 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.85rem; font-family: inherit;">
                        <button onclick="deleteFavorite('${fav.id}')" style="background: transparent; border: none; cursor: pointer; font-size: 1rem;" title="Delete Favorite">🗑️</button>
                    </li>
                `;
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

    // Yellow Drop Pin
    const yellowPin = L.divIcon({
        className: 'custom-div-icon',
        html: `<div style="background-color: white; color: black; border-radius: 50% 50% 50% 0; width: 28px; height: 28px; transform: rotate(-45deg); border: 3px solid #f1c40f; box-shadow: 0 2px 5px rgba(0,0,0,0.5); display: flex; align-items: center; justify-content: center;"><div style="transform: rotate(45deg); font-size: 14px;">⭐</div></div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 28],
        popupAnchor: [0, -28]
    });

    favoriteLocations.forEach(fav => {
        const marker = L.marker([fav.lat, fav.lng], { icon: yellowPin, bubblingMouseEvents: false }).addTo(map);
        
        // 🆕 Updated Popup with "Add to Route" button
        marker.bindPopup(`
            <div style="text-align:center; min-width: 160px;">
                <strong>⭐ ${esc(fav.name)}</strong>
                <p style="font-size: 0.8rem; color: #666; margin: 4px 0 8px 0;">${esc(fav.notes || "")}</p>
                <button onclick="addFavoriteToRoute('${fav.id}')" style="background: #6B8071; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; width: 100%; font-weight: bold;">
                    + Add to Route
                </button>
            </div>
        `);
        favoriteMarkers.push(marker);
    });
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
        costs: fav.costs || { tickets: 0, parking: 0, food: 0, merch: 0, fuel: 0 }
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

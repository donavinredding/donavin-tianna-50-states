/* ============================================================
50 States Gallery — GitHub Contents API edition
Reads ./data.json on load. Admin writes go straight to the repo.
============================================================ */

/* ---------- 1. Config ---------- */
const GH_CONFIG = {
    owner: "donavinredding",
    repo: "donavin-tianna-50-states", // ← CHANGE THIS to your repo name
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
let stateGalleries = {}; // { "Texas": [ {img, desc, rotation} ] }
let tripNotesText = "";
let nextStateTargets = new Set();

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

/* UTF-8 safe base64 (handles emoji, accents, etc.) */
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
    } catch (err) {
        console.warn("Could not load data.json — starting empty.", err);
        stateGalleries = {};
        tripNotesText = "";
        nextStateTargets = new Set();
    }

    const notesEl = document.getElementById("plan-notes");
    if (notesEl && document.activeElement !== notesEl) notesEl.value = tripNotesText;

    paintStatePatterns();
    updateChecklists();

    if (activeStateName) {
        const container = document.getElementById("polaroid-container");
        if (container) renderGallery(activeStateName, container);
    }
}

/* Serialize saves so two quick edits can't fight over the same SHA */
let saveChain = Promise.resolve();

function queueSave(message) {
    saveChain = saveChain
        .catch(() => {})
        .then(() => saveSiteData(message))
        .catch(err => {
            console.error("Save failed:", err);
            setPublishStatus(`❌ ${err.message}`);
        });
    return saveChain;
}

async function saveSiteData(message = "Update site data") {
    const payload = JSON.stringify(
        {
            version: 1,
            updatedAt: new Date().toISOString(),
            nextStateTargets: [...nextStateTargets],
            tripNotes: tripNotesText,
            states: stateGalleries
        },
        null,
        2
    );

    // 1. Force a fresh request straight to the GitHub API (no cache) to get the newest SHA
    const token = localStorage.getItem(GH_CONFIG.tokenKey);
    const url = `${ghApiBase()}/${GH_CONFIG.dataPath}?ref=${GH_CONFIG.branch}`;
    
    const res = await fetch(url, { 
        headers: { 
            Accept: "application/vnd.github+json", 
            Authorization: `Bearer ${token}` 
        },
        cache: "no-store" // Prevents browser from reusing an old SHA
    });

    let sha = null;
    if (res.ok) {
        const data = await res.json();
        sha = data.sha;
    }

    // 2. Send the write request with the freshly retrieved SHA
    await ghPutFile(GH_CONFIG.dataPath, toBase64(payload), message, sha);
    setPublishStatus("✅ Saved to GitHub — live site updates in ~30–60 s.");
}

/* ============================================================
5. Image upload (compress → base64 → PUT into /images)
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
    }

    const notesEl = document.getElementById("plan-notes");
    if (notesEl) notesEl.readOnly = !isAdminUnlocked;

    if (!isAdminUnlocked) {
        isEditMode = false;
        const btn = document.getElementById("toggle-edit-btn");
        if (btn) { btn.classList.remove("active"); btn.textContent = "Edit Mode ✏️"; }
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
    const savedToken = localStorage.getItem(GH_CONFIG.tokenKey);
    
    if (savedToken) {
        // If they already saved a token, just unlock it immediately
        isAdminUnlocked = true;
        updateAdminUI();
        loadSiteData();
    } else {
        // If no token saved, show the input modal
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
    loadSiteData(); // Reload to ensure admin features render
}

function lockAdmin() {
    isAdminUnlocked = false;
    updateAdminUI();
    setPublishStatus("🔒 Locked for this session. Token is safely saved.");
}

function confirmForgetToken() {
    if (confirm("Are you sure you want to completely remove the GitHub token from this browser? You will have to paste it again next time.")) {
        localStorage.removeItem(GH_CONFIG.tokenKey);
        isAdminUnlocked = false;
        updateAdminUI();
        setPublishStatus("🗑️ Token removed from this browser.");
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
            ${hasMemories ? `<button class="btn-action btn-finish" onclick="finishTrip('${stateName}')">End Trip 🏁</button>` : ""}
            <button class="btn-action" onclick="toggleNextTarget('${stateName}')">Cancel</button>
        </span>` : "");
        nextList.appendChild(li);

        } else if (hasMemories) {
        li.innerHTML = `<span>${stateName} (${photos.length} photo${photos.length === 1 ? "" : "s"})</span>`;
        visitedList.appendChild(li);

        } else {
        li.innerHTML = `<span>${stateName}</span>` + (admin ? `<button class="btn-action" onclick="toggleNextTarget('${stateName}')">+ Next</button>` : "");
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

        /* Rotate */
        polaroidDiv.querySelector(".rotate-btn").addEventListener("click", (e) => {
            e.stopPropagation();
            if (!isAdmin()) return;
            item.rotation = ((item.rotation || 0) + 90) % 360;
            renderGallery(stateName, container);
            queueSave(`Rotate photo in ${stateName}`);
        });

        /* Drag handle */
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

        /* Delete */
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

        /* Edit caption */
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

    /* ---- Trip notes ---- */
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

    /* ---- Map search ---- */
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

    /* ---- Edit mode toggle ---- */
    if (toggleEditBtn) {
        toggleEditBtn.addEventListener("click", () => {
            if (!isAdmin()) return;
            isEditMode = !isEditMode;
            toggleEditBtn.classList.toggle("active", isEditMode);
            toggleEditBtn.textContent = isEditMode ? "Done Editing ✓" : "Edit Mode ✏️";
            if (activeStateName && polaroidContainer) renderGallery(activeStateName, polaroidContainer);
        });
    }

    /* ---- State hover + click ---- */
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

            // 🆕 Wire the Plan Trip button to open the trip planner for this state
            const planTripBtn = document.getElementById("modal-plan-trip-btn");
            if (planTripBtn) {
                planTripBtn.onclick = () => {
                    modal.classList.remove("active");
                    // Skip unlockScroll — we're immediately opening another modal
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

    /* ---- Upload queue ---- */
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

    /* ---- Add memory ---- */
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

    /* ---- Dutch Bros "near me" ---- */
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

    /* ---- Drag auto-scroll ---- */
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

    /* ---- Boot ---- */
    loadSiteData();
});

/* ============================================================
   Trip Planner — full state map, name↔code, persistence
   ============================================================ */

const HOME_COORDS = [36.7213545, -97.0531794];

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
  AL:{name:"Alabama",coords:[32.8067,-86.7911],zoom:7},
  AK:{name:"Alaska",coords:[63.5887,-154.4930],zoom:4},
  AZ:{name:"Arizona",coords:[33.7298,-111.4312],zoom:6},
  AR:{name:"Arkansas",coords:[34.9697,-92.3731],zoom:7},
  CA:{name:"California",coords:[36.1162,-119.6815],zoom:6},
  CO:{name:"Colorado",coords:[39.0598,-105.3111],zoom:6},
  CT:{name:"Connecticut",coords:[41.5978,-72.7554],zoom:8},
  DE:{name:"Delaware",coords:[39.3185,-75.5071],zoom:9},
  FL:{name:"Florida",coords:[27.7663,-81.6868],zoom:6},
  GA:{name:"Georgia",coords:[33.0406,-83.6431],zoom:7},
  HI:{name:"Hawaii",coords:[21.0943,-157.4983],zoom:7},
  ID:{name:"Idaho",coords:[44.2405,-114.4788],zoom:6},
  IL:{name:"Illinois",coords:[40.3495,-88.9861],zoom:6},
  IN:{name:"Indiana",coords:[39.8494,-86.2583],zoom:7},
  IA:{name:"Iowa",coords:[42.0115,-93.2105],zoom:7},
  KS:{name:"Kansas",coords:[38.5266,-96.7265],zoom:7},
  KY:{name:"Kentucky",coords:[37.6681,-84.6701],zoom:7},
  LA:{name:"Louisiana",coords:[31.1695,-91.8678],zoom:7},
  ME:{name:"Maine",coords:[44.6939,-69.3819],zoom:7},
  MD:{name:"Maryland",coords:[39.0639,-76.8021],zoom:8},
  MA:{name:"Massachusetts",coords:[42.2302,-71.5301],zoom:8},
  MI:{name:"Michigan",coords:[43.3266,-84.5361],zoom:6},
  MN:{name:"Minnesota",coords:[45.6945,-93.9002],zoom:6},
  MS:{name:"Mississippi",coords:[32.7416,-89.6787],zoom:7},
  MO:{name:"Missouri",coords:[38.4561,-92.2884],zoom:7},
  MT:{name:"Montana",coords:[46.9219,-110.4544],zoom:6},
  NE:{name:"Nebraska",coords:[41.1254,-98.2681],zoom:7},
  NV:{name:"Nevada",coords:[38.3135,-117.0554],zoom:6},
  NH:{name:"New Hampshire",coords:[43.4525,-71.5639],zoom:8},
  NJ:{name:"New Jersey",coords:[40.2989,-74.5210],zoom:8},
  NM:{name:"New Mexico",coords:[34.8405,-106.2485],zoom:6},
  NY:{name:"New York",coords:[42.1657,-74.9481],zoom:6},
  NC:{name:"North Carolina",coords:[35.6301,-79.8064],zoom:7},
  ND:{name:"North Dakota",coords:[47.5289,-99.7840],zoom:6},
  OH:{name:"Ohio",coords:[40.3888,-82.7649],zoom:7},
  OK:{name:"Oklahoma",coords:[35.5653,-96.9289],zoom:7},
  OR:{name:"Oregon",coords:[44.5720,-122.0709],zoom:7},
  PA:{name:"Pennsylvania",coords:[40.5908,-77.2098],zoom:7},
  RI:{name:"Rhode Island",coords:[41.6809,-71.5118],zoom:9},
  SC:{name:"South Carolina",coords:[33.8569,-80.9450],zoom:7},
  SD:{name:"South Dakota",coords:[44.2998,-99.4388],zoom:6},
  TN:{name:"Tennessee",coords:[35.7478,-86.6923],zoom:7},
  TX:{name:"Texas",coords:[31.0545,-97.5635],zoom:5},
  UT:{name:"Utah",coords:[40.1500,-111.8624],zoom:6},
  VT:{name:"Vermont",coords:[44.0459,-72.7107],zoom:7},
  VA:{name:"Virginia",coords:[37.7693,-78.1700],zoom:7},
  WA:{name:"Washington",coords:[47.4009,-121.4905],zoom:7},
  WV:{name:"West Virginia",coords:[38.4912,-80.9545],zoom:7},
  WI:{name:"Wisconsin",coords:[44.2685,-89.6165],zoom:6},
  WY:{name:"Wyoming",coords:[42.7559,-107.3025],zoom:6}
};

const TRIPS_STORAGE_KEY = "savedTrips";

let map, routingControl, tempMarker, pendingLatLng;
let currentStateCode = "AL";
let currentStops = [];

/* Open the modal by name OR code */
function openPlanTripModal(stateNameOrCode) {
  const code = STATE_NAME_TO_CODE[stateNameOrCode] || stateNameOrCode;
  const info = STATE_VIEWS[code] || { name: stateNameOrCode, coords: [39.8283, -98.5795], zoom: 4 };

  currentStateCode = code;
  document.getElementById("modalStateTitle").innerText = `Plan Trip: ${info.name}`;
  document.getElementById("planTripModal").classList.remove("hidden");
  lockScroll();

  populateSavedTripsSelect();

  if (!map) {
    map = L.map("tripMap").setView(info.coords, info.zoom);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors"
    }).addTo(map);

    // 🆕 Setup the Free OpenStreetMap Search Provider
    const provider = new window.GeoSearch.OpenStreetMapProvider();
    const searchControl = new window.GeoSearch.GeoSearchControl({
      provider: provider,
      style: 'bar',
      showMarker: false,
      showPopup: false,
      autoClose: true,
      retainZoomLevel: false,
      animateZoom: true,
      keepResult: true,
    });

    document.getElementById("map-search-container").appendChild(searchControl.getContainer());
    searchControl.onAdd(map);

    map.on("click", (e) => {
      pendingLatLng = e.latlng;
      if (tempMarker) map.removeLayer(tempMarker);
      tempMarker = L.marker(pendingLatLng).addTo(map);
      document.getElementById("locationFormCard").style.display = "block";

      fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${e.latlng.lat}&lon=${e.latlng.lng}`)
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
    setTimeout(() => {
      map.invalidateSize();
      map.setView(info.coords, info.zoom);
    }, 100);
  }
}

/* Called by the ✖ button in the trip modal */
function closeTripModal() {
  document.getElementById("planTripModal").classList.add("hidden");
  unlockScroll();

  // Discard any half-finished pin
  if (tempMarker && map) { map.removeLayer(tempMarker); tempMarker = null; }
  pendingLatLng = null;
  document.getElementById("locationFormCard").style.display = "none";
}

/* Populate the trip dropdown for the currently-open state */
function populateSavedTripsSelect() {
  const select = document.getElementById("savedTripsSelect");
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="new">+ Create New Trip</option>';

  const all = JSON.parse(localStorage.getItem(TRIPS_STORAGE_KEY) || "{}");
  Object.values(all)
    .filter((t) => t.stateCode === currentStateCode)
    .forEach((trip) => {
      const opt = document.createElement("option");
      opt.value = trip.id;
      opt.textContent = trip.name;
      select.appendChild(opt);
    });

  if ([...select.options].some((o) => o.value === current)) select.value = current;
}

/* Called by #savedTripsSelect onchange */
function loadSelectedTrip() {
  const id = document.getElementById("savedTripsSelect").value;
  if (id === "new") {
    currentStops = [];
    document.getElementById("tripNameInput").value = "";
  } else {
    const all = JSON.parse(localStorage.getItem(TRIPS_STORAGE_KEY) || "{}");
    const trip = all[id];
    if (trip) {
      currentStops = (trip.stops || []).map((s) => ({ ...s }));
      document.getElementById("tripNameInput").value = trip.name || "";
    }
  }
  renderItinerary();
  updateRoute();
}

/* Called by the Save Trip button */
function saveFullTrip() {
  if (currentStops.length === 0) {
    alert("Add some stops first!");
    return;
  }
  const name = document.getElementById("tripNameInput").value.trim()
    || `Trip ${new Date().toLocaleDateString()}`;
  const all = JSON.parse(localStorage.getItem(TRIPS_STORAGE_KEY) || "{}");

  const id = `${currentStateCode}-${Date.now()}`;
  all[id] = {
    id,
    stateCode: currentStateCode,
    name,
    stops: currentStops,
    updatedAt: new Date().toISOString()
  };
  localStorage.setItem(TRIPS_STORAGE_KEY, JSON.stringify(all));
  populateSavedTripsSelect();
  document.getElementById("savedTripsSelect").value = id;
  alert(`Trip "${name}" saved!`);
}

/* Stop CRUD */
function saveLocationToTrip() {
  if (!pendingLatLng) return;

  currentStops.push({
    id: Date.now(),
    name: document.getElementById("locName").value || "Unnamed Stop",
    notes: document.getElementById("locNotes").value,
    lat: pendingLatLng.lat,
    lng: pendingLatLng.lng,
    completed: false,
    duration: parseFloat(document.getElementById("locDuration").value) || 1.5,
    preferredTime: document.getElementById("locPreferredTime").value || "",
    costs: {
      tickets: parseFloat(document.getElementById("costTickets").value) || 0,
      parking: parseFloat(document.getElementById("costParking").value) || 0,
      food:    parseFloat(document.getElementById("costFood").value) || 0,
      merch:   parseFloat(document.getElementById("costMerch").value) || 0
    }
  });

  if (tempMarker) map.removeLayer(tempMarker);
  document.getElementById("locationFormCard").style.display = "none";
  ["locName", "locNotes"].forEach((id) => (document.getElementById(id).value = ""));
  document.getElementById("locDuration").value = 1.5;
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
    const t = stop.costs;
    const stopTotal = t.tickets + t.parking + t.food + t.merch;
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
      <small>🎟️ $${t.tickets} | 🅿️ $${t.parking} | 🍔 $${t.food} | 🛍️ $${t.merch}${extras ? " | " + extras : ""}</small>
    `;
    list.appendChild(li);
  });

  document.getElementById("tripGrandTotal").innerText = grandTotal.toFixed(2);
}

function updateRoute() {
  if (routingControl) map.removeControl(routingControl);
  if (currentStops.length === 0) return;

  const waypoints = [];
  if (document.getElementById("startFromHomeToggle").checked) {
    waypoints.push(L.latLng(HOME_COORDS[0], HOME_COORDS[1]));
  }
  currentStops.forEach((s) => waypoints.push(L.latLng(s.lat, s.lng)));

  routingControl = L.Routing.control({
    waypoints,
    routeWhileDragging: false,
    addWaypoints: false,
    show: false
  }).addTo(map);
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

  const useHome = document.getElementById("startFromHomeToggle").checked;
  let origin, waypointStops, destinationStop;

  if (useHome) {
    origin = "Ponca City, OK";
    destinationStop = currentStops[currentStops.length - 1];
    waypointStops = currentStops.slice(0, -1);
  } else {
    origin = `${currentStops[0].lat},${currentStops[0].lng}`;
    destinationStop = currentStops[currentStops.length - 1];
    waypointStops = currentStops.slice(1, -1);
  }

  const destination = `${destinationStop.lat},${destinationStop.lng}`;
  let url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`;

  if (waypointStops.length > 0) {
    url += `&waypoints=${encodeURIComponent(waypointStops.map((s) => `${s.lat},${s.lng}`).join("|"))}`;
  }
  window.open(url, "_blank");
}
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
    const existing = await ghGetFile(GH_CONFIG.dataPath);
    await ghPutFile(GH_CONFIG.dataPath, toBase64(payload), message, existing ? existing.sha : null);
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
            li.innerHTML = `<span>${stateName}</span>` + (admin ? `<button class="btn-action" onclick="toggleNextTarget('${stateName}')">+ Plan Trip</button>` : "");
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
            <p class="caption-text">${item.desc || ""}</p>
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

function getGoogleMapsEmbedUrl(url) {
    if (!url) return null;
    if (url.includes("/maps/embed")) return url;
    try {
        const parsed = new URL(url);
        if (parsed.searchParams.has("q")) {
            return `https://maps.google.com/maps?q=${encodeURIComponent(parsed.searchParams.get("q"))}&output=embed`;
        }
        const segs = parsed.pathname.split("/");
        const i = segs.indexOf("place");
        if (i !== -1 && segs[i + 1]) {
            const place = decodeURIComponent(segs[i + 1].replace(/\+/g, " "));
            return `https://maps.google.com/maps?q=${encodeURIComponent(place)}&output=embed`;
        }
        return `https://maps.google.com/maps?q=${encodeURIComponent(url)}&output=embed`;
    } catch { return null; }
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

// --- 1. Configurations & State ---

const SUPABASE_URL = 'https://mxkawqbvtckdfffddeey.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14a2F3cWJ2dGNrZGZmZmRkZWV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1Mzc5NjQsImV4cCI6MjEwNDExMzk2NH0.39RyTqPylHgSq0J_aqbzxqvyL_eM9KWkLKkwtSsSFrc';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const defaultGallery = [];

let stateGalleries = {};
let activeStateName = null;
let activeStatePath = null;
let intervalId = null;

// Track dragged element index across drag operations
let draggedIndex = null;

// Multi-file Queue State
let uploadQueue = [];

// Local tracking set for states designated as "The Next State(s)"
let nextStateTargets = new Set(JSON.parse(localStorage.getItem('nextStateTargets') || '[]'));

// All US States array for checking full list
const ALL_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
  "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
  "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia",
  "Wisconsin", "Wyoming"
];

const TOTAL_STATES = 50;

function updateProgress(completedCount) {
  const percentage = Math.round((completedCount / TOTAL_STATES) * 100);

  // Update the header text
  const progressText = document.getElementById('progress-text');
  if (progressText) {
    progressText.textContent = `${completedCount} / ${TOTAL_STATES} (${percentage}%)`;
  }

  // Update the progress bar width
  const progressBar = document.getElementById('progress-bar');
  if (progressBar) {
    progressBar.style.width = `${percentage}%`;
  }
}

// --- 2. Core Functions ---

function getOrCreateDefs(svgMap) {
  let defs = svgMap.querySelector('defs');
  if (!defs) {
    defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.id = 'state-patterns';
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
    pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
    pattern.setAttribute('id', patternId);
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');

    const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
    image.setAttribute('preserveAspectRatio', 'xMidYMid slice');

    pattern.appendChild(image);
    svgDefs.appendChild(pattern);
  }

  pattern.setAttribute('x', bbox.x);
  pattern.setAttribute('y', bbox.y);
  pattern.setAttribute('width', bbox.width);
  pattern.setAttribute('height', bbox.height);

  const image = pattern.querySelector('image');
  if (image) {
    image.setAttribute('x', '0');
    image.setAttribute('y', '0');
    image.setAttribute('width', bbox.width);
    image.setAttribute('height', bbox.height);
    image.setAttribute('href', imgUrl);
  }

  return patternId;
}

function updateChecklists() {
  const nextList = document.getElementById('next-states-list');
  const notVisitedList = document.getElementById('not-visited-list');
  const visitedList = document.getElementById('visited-list');

  if (!nextList || !notVisitedList || !visitedList) return;

  nextList.innerHTML = '';
  notVisitedList.innerHTML = '';
  visitedList.innerHTML = '';

  let completedCount = 0;

  ALL_STATES.forEach(stateName => {
    const hasMemories = stateGalleries[stateName] && stateGalleries[stateName].length > 0;
    const isNext = nextStateTargets.has(stateName);

    const li = document.createElement('li');

    if (isNext) {
      li.innerHTML = `<span>${stateName}</span> ${hasMemories ? `<button class="btn-action btn-finish" onclick="finishTrip('${stateName}')">End Trip 🏁</button>` : ''} <button class="btn-action" onclick="toggleNextTarget('${stateName}')">Cancel</button>`;
      nextList.appendChild(li); 
    } else if (hasMemories) { 
      completedCount++;
      li.innerHTML = `<span>${stateName} (${stateGalleries[stateName].length} photos)</span>`; 
      visitedList.appendChild(li); 
    } else { 
      li.innerHTML = `<span>${stateName}</span> <button class="btn-action" onclick="toggleNextTarget('${stateName}')">+ Plan Trip</button>`;
      notVisitedList.appendChild(li);
    }
  });

  // Dynamically update progress text & progress bar
  updateProgress(completedCount);
}

// Global action handlers for checklist UI buttons
window.toggleNextTarget = function(stateName) {
  if (nextStateTargets.has(stateName)) {
    nextStateTargets.delete(stateName);
  } else {
    nextStateTargets.add(stateName);
  }
  localStorage.setItem('nextStateTargets', JSON.stringify([...nextStateTargets]));
  updateChecklists();
};

window.finishTrip = function(stateName) {
  nextStateTargets.delete(stateName);
  localStorage.setItem('nextStateTargets', JSON.stringify([...nextStateTargets]));
  updateChecklists();
};

// --- Modal Visibility & Handlers ---

window.openStatePlanModal = function() {
  const modal = document.getElementById('state-plan-modal');
  const stateInput = document.getElementById('modal-state-name');

  if (modal) {
    if (stateInput && activeStateName) {
      stateInput.value = activeStateName;
    }
    modal.classList.add('active');
  }
};

window.closeStatePlanModal = function() {
  const modal = document.getElementById('state-plan-modal');
  if (modal) {
    modal.classList.remove('active');
  }
};

window.handleModalBackdropClick = function(event) {
  if (event.target.id === 'state-plan-modal') {
    window.closeStatePlanModal();
  }
};

window.submitStatePlan = async function(event) {
  event.preventDefault();

  const stateNameInput = document.getElementById('modal-state-name');
  const locationInput = document.getElementById('modal-location');
  const detailsInput = document.getElementById('modal-details');

  const rawStateName = stateNameInput ? stateNameInput.value.trim() : '';
  const location = locationInput ? locationInput.value.trim() : '';
  const details = detailsInput ? detailsInput.value.trim() : '';

  if (!rawStateName) {
    alert('Please enter a state name.');
    return;
  }

  const formattedStateName = rawStateName.charAt(0).toUpperCase() + rawStateName.slice(1);

  let planTextCombined = '';
  if (location && details) {
    planTextCombined = `📍 ${location}: ${details}`;
  } else if (location) {
    planTextCombined = `📍 ${location}`;
  } else {
    planTextCombined = details;
  }

  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) {
    alert('Please log in to save trip plans!');
    return;
  }

  const { error } = await supabaseClient.from('state_plans').insert([{
    user_id: user.id,
    state_name: formattedStateName,
    plan_text: planTextCombined
  }]);

  if (!error) {
    nextStateTargets.add(formattedStateName);
    localStorage.setItem('nextStateTargets', JSON.stringify([...nextStateTargets]));
    updateChecklists();

    if (activeStateName && activeStateName.toLowerCase() === formattedStateName.toLowerCase()) {
      if (typeof loadStatePlans === 'function') {
        loadStatePlans(activeStateName);
      }
    }

    if (event.target && typeof event.target.reset === 'function') {
      event.target.reset();
    }
    window.closeStatePlanModal();
  } else {
    alert(`Error saving plan: ${error.message}`);
  }
};

function renderGallery(stateName, container) {
  if (!container) return;
  container.innerHTML = '';
  const data = stateGalleries[stateName] || defaultGallery;

  if (data.length === 0) {
    container.innerHTML = '<p style="text-align:center; width:100%;">No memories yet for this state!</p>';
    return;
  }

  data.forEach((item, index) => {
    const polaroidDiv = document.createElement('div');
    polaroidDiv.className = 'polaroid';
    polaroidDiv.dataset.index = index;

    if (item.rotation === undefined) item.rotation = 0;

    let topButtonsHTML = '';
    let bottomRotateHTML = '';

    if (item.id) {
      topButtonsHTML = `<div class="drag-handle" title="Drag to reorder">⋮⋮</div> <button class="delete-btn" data-id="${item.id}" title="Delete Memory">✕</button>`;
      bottomRotateHTML = `<button class="rotate-btn" data-id="${item.id}" title="Rotate Image">↻</button>`;
    }

    const rotationClass = (item.rotation === 90 || item.rotation === 270) ? `rotated-${item.rotation}` : '';

    polaroidDiv.innerHTML = `
      ${topButtonsHTML}
      <div class="img-wrapper">
        <img src="${item.img}" class="polaroid-img ${rotationClass}" style="transform: rotate(${item.rotation}deg);" alt="${stateName} photo">
      </div>
      <p class="caption-text">${item.desc || ''}</p>
      ${bottomRotateHTML}
      ${item.id ? `<button class="edit-btn" data-id="${item.id}">Edit</button>` : ''}
    `;

    const imgElement = polaroidDiv.querySelector('.polaroid-img');

    if (imgElement) {
      imgElement.addEventListener('click', (e) => {
        e.stopPropagation();
        openLightbox(item.img, item.desc, item.rotation);
      });
    }

    if (item.id) {
      const rotateBtn = polaroidDiv.querySelector('.rotate-btn');
      if (rotateBtn) {
        rotateBtn.addEventListener('click', async (e) => {
          e.stopPropagation();

          item.rotation = (item.rotation + 90) % 360;
          imgElement.style.transform = `rotate(${item.rotation}deg)`;

          imgElement.classList.remove('rotated-90', 'rotated-270');
          if (item.rotation === 90 || item.rotation === 270) {
            imgElement.classList.add(`rotated-${item.rotation}`);
          }

          const { error } = await supabaseClient
            .from('state_memories')
            .update({ rotation: item.rotation })
            .eq('id', item.id);

          if (error) {
            console.error("Error updating rotation:", error.message);
          }
        });
      }
    }

    const handle = polaroidDiv.querySelector('.drag-handle');
    if (handle) {
      handle.addEventListener('mousedown', () => polaroidDiv.setAttribute('draggable', 'true'));
      handle.addEventListener('mouseup', () => polaroidDiv.setAttribute('draggable', 'false'));
      handle.addEventListener('touchstart', () => polaroidDiv.setAttribute('draggable', 'true'), { passive: true });
      handle.addEventListener('touchend', () => polaroidDiv.setAttribute('draggable', 'false'));
    }

    polaroidDiv.addEventListener('dragstart', (e) => {
      draggedIndex = index;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', index.toString());
      polaroidDiv.classList.add('dragging');
    });

    polaroidDiv.addEventListener('dragend', () => {
      polaroidDiv.classList.remove('dragging');
      polaroidDiv.setAttribute('draggable', 'false');
      container.querySelectorAll('.polaroid').forEach(card => card.classList.remove('drag-over'));
    });

    polaroidDiv.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      polaroidDiv.classList.add('drag-over');
    });

    polaroidDiv.addEventListener('dragleave', () => {
      polaroidDiv.classList.remove('drag-over');
    });

    polaroidDiv.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      polaroidDiv.classList.remove('drag-over');

      const targetIndex = parseInt(polaroidDiv.dataset.index, 10);

      if (draggedIndex !== null && draggedIndex !== targetIndex) {
        const galleryArray = stateGalleries[stateName];
        const [movedItem] = galleryArray.splice(draggedIndex, 1);
        galleryArray.splice(targetIndex, 0, movedItem);

        galleryArray.forEach((item, idx) => item.order_index = idx);

        renderGallery(stateName, container);

        const updates = galleryArray.map((item, idx) => ({
          id: item.id,
          order_index: idx,
          rotation: item.rotation || 0
        }));

        await supabaseClient.rpc('update_memory_positions', { payload: updates });
      }
    });

    if (item.id) {
      const delBtn = polaroidDiv.querySelector('.delete-btn');
      const editBtn = polaroidDiv.querySelector('.edit-btn');
      const captionText = polaroidDiv.querySelector('.caption-text');

      if (delBtn) {
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm("Are you sure you want to delete this memory?")) {
            const { error } = await supabaseClient.from('state_memories').delete().eq('id', item.id);
            if (!error) {
              await window.loadUserMemories();
              renderGallery(stateName, container);
            }
          }
        });
      }

      if (editBtn) {
        editBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          captionText.style.display = 'none';
          editBtn.style.display = 'none';

          const editContainer = document.createElement('div');
          editContainer.className = 'edit-container';
          editContainer.innerHTML = `
            <input type="text" class="edit-input" value="${item.desc || ''}" />
            <div class="edit-actions">
              <button class="save-btn">Save</button>
              <button class="cancel-btn">Cancel</button>
            </div>
          `;

          polaroidDiv.appendChild(editContainer);

          editContainer.querySelector('.save-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            const newCaption = editContainer.querySelector('.edit-input').value.trim();

            const { error } = await supabaseClient.from('state_memories').update({ caption: newCaption }).eq('id', item.id);
            if (!error) {
              await window.loadUserMemories();
              renderGallery(stateName, container);
            }
          });

          editContainer.querySelector('.cancel-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            editContainer.remove();
            captionText.style.display = 'block';
            editBtn.style.display = 'block';
          });
        });
      }
    }

    container.appendChild(polaroidDiv);
  });
}

function openLightbox(imgUrl, caption, rotation = 0) {
  let lightbox = document.getElementById('lightbox-modal');
  if (!lightbox) {
    lightbox = document.createElement('div');
    lightbox.id = 'lightbox-modal';
    lightbox.className = 'lightbox-modal';
    lightbox.innerHTML = `<span class="lightbox-close">&times;</span> <img class="lightbox-content" id="lightbox-img"> <div id="lightbox-caption"></div>`;
    document.body.appendChild(lightbox);

    lightbox.addEventListener('click', (e) => {
      if (e.target.id === 'lightbox-modal' || e.target.className === 'lightbox-close') {
        lightbox.classList.remove('active');
      }
    });
  }

  const img = document.getElementById('lightbox-img');
  img.src = imgUrl;
  img.style.transform = `rotate(${rotation}deg)`;
  document.getElementById('lightbox-caption').textContent = caption || '';
  lightbox.classList.add('active');
}

function getGoogleMapsEmbedUrl(url) {
  if (!url) return null;

  if (url.includes('/maps/embed')) return url;

  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.searchParams.has('q')) {
      const query = parsedUrl.searchParams.get('q');
      return `https://maps.google.com/maps?q=${encodeURIComponent(query)}&output=embed`;
    }

    const pathSegments = parsedUrl.pathname.split('/');
    const placeIndex = pathSegments.indexOf('place');

    if (placeIndex !== -1 && pathSegments[placeIndex + 1]) {
      const placeName = decodeURIComponent(pathSegments[placeIndex + 1].replace(/\+/g, ' '));
      return `https://maps.google.com/maps?q=${encodeURIComponent(placeName)}&output=embed`;
    }

    return `https://maps.google.com/maps?q=${encodeURIComponent(url)}&output=embed`;
  } catch (e) {
    console.error("Invalid URL format:", e);
    return null;
  }
}

// Interactive Map Search Controls
const mapSearchInput = document.getElementById('map-search-input');
const mapSearchBtn = document.getElementById('map-search-btn');
const mapIframe = document.getElementById('map-embed-iframe');

function performMapSearch() {
  if (!mapSearchInput || !mapIframe) return;
  const query = mapSearchInput.value.trim();
  if (query) {
    mapIframe.src = `https://maps.google.com/maps?q=${encodeURIComponent(query)}&t=&z=13&ie=UTF8&iwloc=&output=embed`;
  }
}

if (mapSearchBtn) {
  mapSearchBtn.addEventListener('click', performMapSearch);
}

if (mapSearchInput) {
  mapSearchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      performMapSearch();
    }
  });
}

// --- Supabase Trip Notes Handlers ---

async function loadTripNotes() {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  const { data, error } = await supabaseClient
    .from('trip_notes')
    .select('note_text')
    .eq('user_id', user.id)
    .maybeSingle();

  if (error) {
    console.error('Error fetching notes:', error.message);
    return;
  }

  const notesTextarea = document.getElementById('plan-notes');
  if (notesTextarea) {
    notesTextarea.value = data ? (data.note_text || '') : '';
  }
}

async function saveTripNotes(noteText) {
  const { data: { user } } = await supabaseClient.auth.getUser();
  if (!user) return;

  const { error } = await supabaseClient
    .from('trip_notes')
    .upsert({
      user_id: user.id,
      note_text: noteText,
      updated_at: new Date()
    }, { onConflict: 'user_id' });

  if (error) {
    console.error('Error saving notes:', error.message);
  }
}

// --- 3. DOM Initialization & Event Listeners ---

document.addEventListener("DOMContentLoaded", () => {
  // Trip Notes Autosave Listener
  const planNotes = document.getElementById('plan-notes');
  if (planNotes) {
    let debounceTimer;
    planNotes.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        saveTripNotes(e.target.value);
      }, 800);
    });
  }

  const svgMap = document.querySelector('.us-map');
  const states = document.querySelectorAll('.state');
  const svgDefs = svgMap ? getOrCreateDefs(svgMap) : null;

  const hoverPreview = document.getElementById('hover-preview');
  const previewImg = document.getElementById('preview-img');
  const previewTitle = document.getElementById('preview-title');
  const modal = document.getElementById('gallery-modal');
  const closeModal = document.getElementById('close-modal');
  const modalStateTitle = document.getElementById('modal-state-title');
  const polaroidContainer = document.getElementById('polaroid-container');

  const addMemoryForm = document.getElementById('add-memory-form');
  const authForm = document.getElementById('auth-form');

  // Queue Elements
  const fileInput = document.getElementById('image-file-input');
  const dropZone = document.getElementById('drop-zone');
  const queueContainer = document.getElementById('upload-queue-container');
  const activePreviewImg = document.getElementById('active-preview-img');
  const captionInput = document.getElementById('caption-input');
  const queueThumbnails = document.getElementById('queue-thumbnails');
  const queueCountText = document.getElementById('queue-count-text');

  // Side-by-Side Map Preview Input Listener
  const mapInput = document.getElementById('map-url-input');
  const mapPlaceholder = document.getElementById('map-placeholder');

  if (mapInput && mapIframe && mapPlaceholder) {
    mapInput.addEventListener('input', (e) => {
      const url = e.target.value.trim();
      if (url.includes('http')) {
        const embedUrl = getGoogleMapsEmbedUrl(url);
        mapIframe.src = embedUrl || url;
        mapIframe.classList.add('active');
        mapPlaceholder.style.display = 'none';
      } else {
        mapIframe.src = 'about:blank';
        mapIframe.classList.remove('active');
        mapPlaceholder.style.display = 'flex';
      }
    });
  }

  window.loadUserMemories = async function() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    const { data, error } = await supabaseClient
      .from('state_memories')
      .select('*')
      .order('order_index', { ascending: true });

    if (error) return console.error("Database fetch error:", error);

    stateGalleries = {};

    data.forEach(item => {
      if (!stateGalleries[item.state_name]) stateGalleries[item.state_name] = [];
      stateGalleries[item.state_name].push({
        id: item.id,
        img: item.image_url,
        desc: item.caption,
        order_index: item.order_index,
        rotation: item.rotation || 0
      });
    });

    states.forEach(state => {
      const stateId = state.id;
      const stateName = state.getAttribute('data-name') || stateId;
      const stateData = stateGalleries[stateName];

      if (stateData && stateData.length > 0 && svgDefs) {
        const patternId = updateStatePattern(stateId, stateData[0].img, svgDefs);
        state.style.fill = `url(#${patternId})`;
      } else {
        state.style.fill = "";
      }
    });

    updateChecklists();
  };

  states.forEach(state => {
    const stateId = state.id;
    const stateName = state.getAttribute('data-name') || stateId;

    state.addEventListener('mouseenter', () => {
      if(!hoverPreview || !previewImg || !previewTitle) return;
      previewTitle.textContent = stateName;

      const currentData = stateGalleries[stateName] || defaultGallery;
      let currentIndex = 0;
      if(currentData.length > 0) {
        previewImg.src = currentData[currentIndex].img;
        hoverPreview.style.display = 'block';

        if (currentData.length > 1) {
          intervalId = setInterval(() => {
            currentIndex = (currentIndex + 1) % currentData.length;
            previewImg.src = currentData[currentIndex].img;
          }, 1500);
        }
      }
    });

    state.addEventListener('mousemove', (e) => {
      if (hoverPreview) {
        const offset = 12;
        hoverPreview.style.position = 'fixed';
        hoverPreview.style.left = `${e.clientX + 40}px`;

        if (e.clientY - 170 < 0) {
          hoverPreview.style.top = `${e.clientY + offset}px`; 
        } else { 
          hoverPreview.style.top = `${e.clientY - 80}px`;
        }
      }
    });

    state.addEventListener('mouseleave', () => {
      if(hoverPreview) hoverPreview.style.display = 'none';
      if (intervalId) clearInterval(intervalId);
    });

    state.addEventListener('click', () => {
      activeStateName = stateName;
      activeStatePath = state;
      if(modalStateTitle) modalStateTitle.textContent = `${stateName} Gallery`;
      if(polaroidContainer) renderGallery(stateName, polaroidContainer);

      loadStatePlans(stateName);

      if(modal) modal.classList.add('active');
    });
  });

  if (authForm) {
    authForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const emailInput = document.getElementById('auth-email');
      const passwordInput = document.getElementById('auth-password');
      if (!emailInput || !passwordInput) return;

      const { error } = await supabaseClient.auth.signInWithPassword({
        email: emailInput.value,
        password: passwordInput.value
      });

      if (error) {
        alert(error.message);
      } else {
        const authModal = document.getElementById('auth-modal');
        if(authModal) authModal.classList.remove('active');
        await window.loadUserMemories();
        await loadTripNotes();
      }
    });
  }

  async function loadStatePlans(stateName) {
    const plansList = document.getElementById('plans-list');
    if (!plansList) return;

    plansList.innerHTML = '<p style="font-size:0.85rem; color:#777;">Loading plans... </p>';

    const { data, error } = await supabaseClient
      .from('state_plans')
      .select('*')
      .eq('state_name', stateName)
      .order('created_at', { ascending: true });

    if (error) {
      console.error("Error loading plans:", error);
      plansList.innerHTML = '';
      return;
    }

    if (!data || data.length === 0) {
      plansList.innerHTML = '<p style="font-size:0.85rem; color:#777;">No plans added yet for this state.</p>';
      return;
    }

    plansList.innerHTML = '';

    data.forEach(plan => {
      const card = document.createElement('div');
      card.className = 'plan-card';

      let linksHTML = '';
      if (plan.link_url) {
        linksHTML += `<a href="${plan.link_url}" target="_blank" rel="noopener">🌐 Website Link</a>`; 
      } 
      if (plan.map_url) { 
        linksHTML += `<a href="${plan.map_url}" target="_blank" rel="noopener">📍 Open in Google Maps</a>`;
      }

      const embedMapUrl = getGoogleMapsEmbedUrl(plan.map_url);
      let mapIframeHTML = '';
      if (embedMapUrl) {
        mapIframeHTML = `<iframe class="map-preview-frame" src="${embedMapUrl}" loading="lazy" allowfullscreen></iframe>`;
      }

      card.innerHTML = `
        <button class="delete-plan-btn" title="Delete Plan">✕</button> 
        <p>${plan.plan_text}</p>
        ${linksHTML ? `<div class="plan-links">${linksHTML}</div>` : ''} 
        ${mapIframeHTML}
      `;

      const delPlanBtn = card.querySelector('.delete-plan-btn');
      if (delPlanBtn) {
        delPlanBtn.addEventListener('click', async () => {
          if (confirm("Delete this plan item?")) {
            await supabaseClient.from('state_plans').delete().eq('id', plan.id);
            loadStatePlans(stateName);
          }
        });
      }

      plansList.appendChild(card);
    });
  }

  const addPlanForm = document.getElementById('add-plan-form');
  if (addPlanForm) {
    addPlanForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const planTextInput = document.getElementById('plan-text-input');
      const planLinkInput = document.getElementById('plan-link-input');
      const planMapInput = document.getElementById('plan-map-input');

      const planText = planTextInput ? planTextInput.value.trim() : '';
      const linkUrl = planLinkInput ? planLinkInput.value.trim() : '';
      const mapUrl = planMapInput ? planMapInput.value.trim() : '';

      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) return alert("Please log in to save trip plans!");

      const { error } = await supabaseClient.from('state_plans').insert([{
        user_id: user.id,
        state_name: activeStateName,
        plan_text: planText,
        link_url: linkUrl,
        map_url: mapUrl
      }]);

      if (!error) {
        addPlanForm.reset();
        loadStatePlans(activeStateName);
      } else {
        alert(error.message);
      }
    });
  }

  function handleFiles(files) {
    const imageFiles = files.filter(file => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;

    uploadQueue = uploadQueue.concat(imageFiles);
    updateQueueUI();
  }

  function updateQueueUI() {
    if (!queueContainer) return;

    if (uploadQueue.length === 0) {
      queueContainer.style.display = 'none';
      if(fileInput) fileInput.value = '';
      return;
    }

    queueContainer.style.display = 'flex';
    if (queueCountText) queueCountText.textContent = `Images remaining: ${uploadQueue.length}`;

    const activeFile = uploadQueue[0];
    if (activePreviewImg) activePreviewImg.src = URL.createObjectURL(activeFile);
    if (captionInput) {
      captionInput.value = '';
      captionInput.focus();
    }

    if (queueThumbnails) {
      queueThumbnails.innerHTML = '';
      uploadQueue.slice(1).forEach((file, index) => {
        const thumbDiv = document.createElement('div');
        thumbDiv.className = 'thumbnail-card';

        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-thumb';
        removeBtn.innerHTML = '✕';
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          uploadQueue.splice(index + 1, 1);
          updateQueueUI();
        });

        thumbDiv.appendChild(img);
        thumbDiv.appendChild(removeBtn);
        queueThumbnails.appendChild(thumbDiv);
      });
    }
  }

  if (fileInput) {
    fileInput.addEventListener('change', (e) => handleFiles(Array.from(e.target.files)));
  }

  if (dropZone) {
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));

    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files.length > 0) {
        handleFiles(Array.from(e.dataTransfer.files));
      }
    });
  }

  if (addMemoryForm) {
    addMemoryForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (uploadQueue.length === 0) return;

      const submitBtn = addMemoryForm.querySelector('button[type="submit"]');
      const originalBtnText = submitBtn ? submitBtn.textContent : '';
      if (submitBtn) {
        submitBtn.textContent = "Uploading...";
        submitBtn.disabled = true;
      }

      const currentFile = uploadQueue[0];
      const caption = captionInput ? captionInput.value.trim() : '';

      const { data: { user } } = await supabaseClient.auth.getUser();
      if (!user) {
        alert('Please log in first!');
        if (submitBtn) {
          submitBtn.textContent = originalBtnText;
          submitBtn.disabled = false;
        }
        return;
      }

      const filePath = `${user.id}/${Date.now()}_${currentFile.name}`;
      const { error: storageError } = await supabaseClient.storage.from('memories').upload(filePath, currentFile);

      if (storageError) {
        alert(storageError.message);
        if (submitBtn) {
          submitBtn.textContent = originalBtnText;
          submitBtn.disabled = false;
        }
        return;
      }

      const { data: { publicUrl } } = supabaseClient.storage.from('memories').getPublicUrl(filePath);

      const { error: dbError } = await supabaseClient.from('state_memories').insert([{
        user_id: user.id,
        state_name: activeStateName,
        image_url: publicUrl,
        caption: caption
      }]);

      if (!dbError) {
        await window.loadUserMemories();
        renderGallery(activeStateName, polaroidContainer);
        uploadQueue.shift();
        updateQueueUI();
      } else {
        alert(dbError.message);
      }

      if (submitBtn) {
        submitBtn.textContent = originalBtnText;
        submitBtn.disabled = false;
      }
    });
  }

  if(closeModal && modal) {
    closeModal.addEventListener('click', () => modal.classList.remove('active'));
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.remove('active');
    });
  }

  // Auth State Observer
  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (session?.user) {
      await loadTripNotes();
      await window.loadUserMemories();
    }
  });

  // Initial check on page load
  supabaseClient.auth.getUser().then(({ data: { user } }) => {
    if (user) {
      const authModal = document.getElementById('auth-modal');
      if (authModal) authModal.classList.remove('active');
      window.loadUserMemories();
      loadTripNotes();
    } else {
      updateChecklists();
    }
  });
});

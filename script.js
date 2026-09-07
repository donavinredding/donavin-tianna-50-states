// --- 1. Configurations & State ---

const SUPABASE_URL = 'https://mxkawqbvtckdfffddeey.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14a2F3cWJ2dGNrZGZmZmRkZWV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1Mzc5NjQsImV4cCI6MjEwNDExMzk2NH0.39RyTqPylHgSq0J_aqbzxqvyL_eM9KWkLKkwtSsSFrc';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

function getBaseGalleries() {
    return {
        "California": [],
        "Texas": []
    };
}

const defaultGallery = [];

let stateGalleries = getBaseGalleries();
let activeStateName = null;
let activeStatePath = null;
let intervalId = null;

// Track dragged element index across drag operations
let draggedIndex = null;

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

    if (!pattern) {
        pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
        pattern.setAttribute('id', patternId);
        pattern.setAttribute('patternUnits', 'objectBoundingBox');
        pattern.setAttribute('width', '1');
        pattern.setAttribute('height', '1');

        const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');
        image.setAttribute('x', '0');
        image.setAttribute('y', '0');
        image.setAttribute('width', '1');
        image.setAttribute('height', '1');
        image.setAttribute('preserveAspectRatio', 'xMidYMid slice');

        pattern.appendChild(image);
        svgDefs.appendChild(pattern);
    }

    pattern.querySelector('image').setAttribute('href', imgUrl);
    return patternId;
}

// Rotates an image asset using Canvas to preserve aspect ratios before cropping
function getRotatedImageDataUrl(src, angleDegrees, callback) {
    if (!angleDegrees || angleDegrees === 0) {
        callback(src);
        return;
    }

    const img = new Image();
    img.crossOrigin = "anonymous"; // Prevents CORS issues with external images
    img.onload = () => {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        // Swap width/height for 90/270 degree orientations
        if (angleDegrees === 90 || angleDegrees === 270) {
            canvas.width = img.height;
            canvas.height = img.width;
        } else {
            canvas.width = img.width;
            canvas.height = img.height;
        }

        // Translate and rotate canvas context
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((angleDegrees * Math.PI) / 180);

        // Draw image centered
        ctx.drawImage(img, -img.width / 2, -img.height / 2);

        callback(canvas.toDataURL());
    };
    img.src = src;
}

// --- Updated renderGallery Function with Rotation ---
function renderGallery(stateName, container) {
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
            // Drag handle top-left, Delete top-right
            topButtonsHTML = `
                <div class="drag-handle" title="Drag to reorder">⋮⋮</div>
                <button class="delete-btn" data-id="${item.id}" title="Delete Memory">✕</button>
            `;
            // Rotate button bottom-left
            bottomRotateHTML = `
                <button class="rotate-btn" data-id="${item.id}" title="Rotate Image">↻</button>
            `;
        }

        // Helper class to adjust image scale when sideways
        const rotationClass = (item.rotation === 90 || item.rotation === 270) ? `rotated-${item.rotation}` : '';

        polaroidDiv.innerHTML = `
            ${topButtonsHTML}
            <div class="img-wrapper">
                <img src="${item.img}" 
                     class="polaroid-img ${rotationClass}" 
                     style="transform: rotate(${item.rotation}deg);" 
                     alt="${stateName} photo">
                ${bottomRotateHTML}
            </div>
            <p class="caption-text">${item.desc || ''}</p>
            ${item.id ? `<button class="edit-btn" data-id="${item.id}">Edit</button>` : ''}
        `;

        const imgElement = polaroidDiv.querySelector('.polaroid-img');

        // Lightbox Full-Size View
        imgElement.addEventListener('click', (e) => {
            e.stopPropagation();
            openLightbox(item.img, item.desc, item.rotation);
        });

        // Rotation Logic
        if (item.id) {
            const rotateBtn = polaroidDiv.querySelector('.rotate-btn');
            rotateBtn.addEventListener('click', async (e) => {
                e.stopPropagation();

                item.rotation = (item.rotation + 90) % 360;
                imgElement.style.transform = `rotate(${item.rotation}deg)`;

                // Toggle aspect adjustment classes for sideways orientations
                imgElement.classList.remove('rotated-90', 'rotated-270');
                if (item.rotation === 90 || item.rotation === 270) {
                    imgElement.classList.add(`rotated-${item.rotation}`);
                }

                // Update database
                const { error } = await supabaseClient
                    .from('state_memories')
                    .update({ rotation: item.rotation })
                    .eq('id', item.id);

                if (error) {
                    console.error("Error updating rotation:", error.message);
                }
            });
        }

        // --- Drag & Drop Setup ---
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
            e.dataTransfer.setData('text/plain', index);
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

        // --- Delete & Edit Event Listeners ---
        if (item.id) {
            const delBtn = polaroidDiv.querySelector('.delete-btn');
            const editBtn = polaroidDiv.querySelector('.edit-btn');
            const captionText = polaroidDiv.querySelector('.caption-text');

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

        container.appendChild(polaroidDiv);
    });
}

// --- Lightbox Helper with Rotation ---
function openLightbox(imgUrl, caption, rotation = 0) {
    let lightbox = document.getElementById('lightbox-modal');
    if (!lightbox) {
        lightbox = document.createElement('div');
        lightbox.id = 'lightbox-modal';
        lightbox.className = 'lightbox-modal';
        lightbox.innerHTML = `
            <span class="lightbox-close">&times;</span>
            <img class="lightbox-content" id="lightbox-img">
            <div id="lightbox-caption"></div>
        `;
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

// Lightbox helper function to open full uncropped image
function openLightbox(imgUrl, caption) {
    let lightbox = document.getElementById('lightbox-modal');
    if (!lightbox) {
        lightbox = document.createElement('div');
        lightbox.id = 'lightbox-modal';
        lightbox.className = 'lightbox-modal';
        lightbox.innerHTML = `
            <span class="lightbox-close">&times;</span>
            <img class="lightbox-content" id="lightbox-img">
            <div id="lightbox-caption"></div>
        `;
        document.body.appendChild(lightbox);

        lightbox.addEventListener('click', (e) => {
            if (e.target.id === 'lightbox-modal' || e.target.className === 'lightbox-close') {
                lightbox.classList.remove('active');
            }
        });
    }

    document.getElementById('lightbox-img').src = imgUrl;
    document.getElementById('lightbox-caption').textContent = caption || '';
    lightbox.classList.add('active');
}

// --- 3. DOM Initialization & Database Logic ---

document.addEventListener("DOMContentLoaded", () => {
    const svgMap = document.querySelector('.us-map');
    const states = document.querySelectorAll('.state');
    const svgDefs = getOrCreateDefs(svgMap);

    const hoverPreview = document.getElementById('hover-preview');
    const previewImg = document.getElementById('preview-img');
    const previewTitle = document.getElementById('preview-title');
    const modal = document.getElementById('gallery-modal');
    const closeModal = document.getElementById('close-modal');
    const modalStateTitle = document.getElementById('modal-state-title');
    const polaroidContainer = document.getElementById('polaroid-container');

    const addMemoryForm = document.getElementById('add-memory-form');
    const authForm = document.getElementById('auth-form');

    window.loadUserMemories = async function() {
    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) return;

    // Fetch memories sorted by order_index ascending
    const { data, error } = await supabaseClient
        .from('state_memories')
        .select('*')
        .order('order_index', { ascending: true });

    if (error) return console.error("Database fetch error:", error);

    stateGalleries = getBaseGalleries();

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

        if (stateData && stateData.length > 0) {
            const patternId = updateStatePattern(stateId, stateData[0].img, svgDefs);
            state.style.fill = `url(#${patternId})`;
        } else {
            state.style.fill = "";
        }
    });
}

    states.forEach(state => {
        const stateId = state.id;
        const stateName = state.getAttribute('data-name') || stateId;
        const data = stateGalleries[stateName] || defaultGallery;

        if (data.length > 0) {
            const patternId = updateStatePattern(stateId, data[0].img, svgDefs);
            state.style.fill = `url(#${patternId})`;
        }

        state.addEventListener('mouseenter', () => {
            if(!hoverPreview || !previewImg || !previewTitle) return;
            previewTitle.textContent = stateName;
            
            const currentData = stateGalleries[stateName] || defaultGallery;
            let currentIndex = 0;
            previewImg.src = currentData[currentIndex].img;
            hoverPreview.style.display = 'block';

            if (currentData.length > 1) {
                intervalId = setInterval(() => {
                    currentIndex = (currentIndex + 1) % currentData.length;
                    previewImg.src = currentData[currentIndex].img;
                }, 1500);
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
            if(modal) modal.classList.add('active');
        });
    });

    if (authForm) {
        authForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('auth-email').value;
            const password = document.getElementById('auth-password').value;

            const { error } = await supabaseClient.auth.signInWithPassword({ email, password });

            if (error) {
                alert(error.message);
            } else {
                const authModal = document.getElementById('auth-modal');
                if(authModal) authModal.classList.remove('active');
                await loadUserMemories();
            }
        });
    }

    if (addMemoryForm) {
        addMemoryForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const submitBtn = e.target.querySelector('button[type="submit"]');
            const originalBtnText = submitBtn.textContent;
            submitBtn.textContent = "Uploading...";
            submitBtn.disabled = true;

            const imageFileInput = document.getElementById('image-file-input');
            const captionInput = document.getElementById('caption-input');
            const file = imageFileInput.files[0];
            const caption = captionInput.value.trim();

            const { data: { user } } = await supabaseClient.auth.getUser();
            if (!user) {
                alert('Please log in first!');
                submitBtn.textContent = originalBtnText;
                submitBtn.disabled = false;
                return;
            }

            const filePath = `${user.id}/${Date.now()}_${file.name}`;
            const { error: storageError } = await supabaseClient.storage.from('memories').upload(filePath, file);
            
            if (storageError) {
                alert(storageError.message);
                submitBtn.textContent = originalBtnText;
                submitBtn.disabled = false;
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
                addMemoryForm.reset();
            } else {
                alert(dbError.message);
            }

            submitBtn.textContent = originalBtnText;
            submitBtn.disabled = false;
        });
    }

    if(closeModal && modal) {
        closeModal.addEventListener('click', () => modal.classList.remove('active'));
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.remove('active');
        });
    }

    supabaseClient.auth.getUser().then(({ data: { user } }) => {
        if (user) {
            const authModal = document.getElementById('auth-modal');
            if (authModal) authModal.classList.remove('active');
            window.loadUserMemories();
        }
    });
});
// --- 1. Configurations & State ---

const SUPABASE_URL = 'https://mxkawqbvtckdfffddeey.supabase.co';

const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14a2F3cWJ2dGNrZGZmZmRkZWV5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1Mzc5NjQsImV4cCI6MjEwNDExMzk2NH0.39RyTqPylHgSq0J_aqbzxqvyL_eM9KWkLKkwtSsSFrc';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);



// Factory function to always return a fresh copy of your default data

function getBaseGalleries() {

    return {

        "California": [

            { img: "https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=600&q=80", desc: "Yosemite family camping trip!" },

            { img: "https://images.unsplash.com/photo-1449824913935-59a10b8d2000?auto=format&fit=crop&w=600&q=80", desc: "San Francisco cable car ride." }

        ],

        "Texas": [

            { img: "https://images.unsplash.com/photo-1531219434158-a578ca3275f1?auto=format&fit=crop&w=600&q=80", desc: "Austin barbecue weekend." }

        ]

    };

}



const defaultGallery = [

    { img: "https://images.unsplash.com/photo-1469854523086-cc02fe5d8800?auto=format&fit=crop&w=600&q=80", desc: "Exploring scenic backroads!" }

];



let stateGalleries = getBaseGalleries();

let activeStateName = null;

let activeStatePath = null;

let intervalId = null;



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

        pattern.setAttribute('patternContentUnits', 'userSpaceOnUse');

        pattern.setAttribute('width', '1');

        pattern.setAttribute('height', '1');



        const image = document.createElementNS('http://www.w3.org/2000/svg', 'image');

        image.setAttribute('x', '0');

        image.setAttribute('y', '0');

        image.setAttribute('width', '100%');

        image.setAttribute('height', '100%');

        image.setAttribute('preserveAspectRatio', 'xMidYMid slice');



        pattern.appendChild(image);

        svgDefs.appendChild(pattern);

    }



    pattern.querySelector('image').setAttribute('href', imgUrl);

    return patternId;

}



// Handles rendering polaroids, edit buttons, and delete buttons
function renderGallery(stateName, container) {
    container.innerHTML = '';
    const data = stateGalleries[stateName] || defaultGallery;

    if (data.length === 0) {
        container.innerHTML = '<p style="text-align:center; width:100%;">No memories yet for this state!</p>';
        return;
    }

    data.forEach(item => {
        const polaroidDiv = document.createElement('div');
        polaroidDiv.className = 'polaroid';
        
        let actionButtonsHTML = '';
        if (item.id) {
            // Delete at top-right, Edit at bottom-right
            actionButtonsHTML = `
                <button class="delete-btn" data-id="${item.id}" title="Delete Memory">✕</button>
                <button class="edit-btn" data-id="${item.id}">Edit</button>
            `;
        }

        polaroidDiv.innerHTML = `
            ${actionButtonsHTML}
            <img src="${item.img}" alt="${stateName} photo">
            <p class="caption-text">${item.desc || ''}</p>
        `;

        if (item.id) {
            const delBtn = polaroidDiv.querySelector('.delete-btn');
            const editBtn = polaroidDiv.querySelector('.edit-btn');
            const captionText = polaroidDiv.querySelector('.caption-text');

            // --- Delete Handler ---
            delBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                
                if (confirm("Are you sure you want to delete this memory?")) {
                    const { error } = await supabaseClient
                        .from('state_memories')
                        .delete()
                        .eq('id', item.id);

                    if (error) {
                        alert("Error deleting image: " + error.message);
                    } else {
                        await window.loadUserMemories();
                        renderGallery(stateName, container);
                    }
                }
            });

            // --- Edit Handler ---
            editBtn.addEventListener('click', (e) => {
                e.stopPropagation();

                // Swap caption text with inline edit form
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

                const saveBtn = editContainer.querySelector('.save-btn');
                const cancelBtn = editContainer.querySelector('.cancel-btn');
                const editInput = editContainer.querySelector('.edit-input');

                // Save Update to Supabase
                saveBtn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const newCaption = editInput.value.trim();

                    saveBtn.textContent = "Saving...";
                    saveBtn.disabled = true;

                    const { error } = await supabaseClient
                        .from('state_memories')
                        .update({ caption: newCaption })
                        .eq('id', item.id);

                    if (error) {
                        alert("Error updating memory: " + error.message);
                        saveBtn.textContent = "Save";
                        saveBtn.disabled = false;
                    } else {
                        await window.loadUserMemories();
                        renderGallery(stateName, container);
                    }
                });

                // Cancel Edit
                cancelBtn.addEventListener('click', (e) => {
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

// --- Inline Edit Logic ---
async function editMemory(item, stateName, container) {
    const newCaption = prompt("Update caption:", item.desc);
    if (newCaption === null) return; // User canceled

    // Optional: Ask if they want to update the image URL
    const changeImage = confirm("Do you also want to update the image URL?");
    let newImageUrl = item.img;
    
    if (changeImage) {
        const urlInput = prompt("Enter new image URL:", item.img);
        if (urlInput) newImageUrl = urlInput.trim();
    }

    const { error } = await supabaseClient
        .from('state_memories')
        .update({ 
            caption: newCaption.trim(),
            image_url: newImageUrl 
        })
        .eq('id', item.id);

    if (error) {
        alert("Error updating memory: " + error.message);
    } else {
        await window.loadUserMemories();
        renderGallery(stateName, container);
    }
}

// --- 3. DOM Initialization & Database Logic ---

document.addEventListener("DOMContentLoaded", () => {

    const svgMap = document.querySelector('.us-map');

    const states = document.querySelectorAll('.state');

    const svgDefs = getOrCreateDefs(svgMap);

   

    // UI Elements

    const hoverPreview = document.getElementById('hover-preview');

    const previewImg = document.getElementById('preview-img');

    const previewTitle = document.getElementById('preview-title');

    const modal = document.getElementById('gallery-modal');

    const closeModal = document.getElementById('close-modal');

    const modalStateTitle = document.getElementById('modal-state-title');

    const polaroidContainer = document.getElementById('polaroid-container');

   

    // Forms

    const addMemoryForm = document.getElementById('add-memory-form');

    const authForm = document.getElementById('auth-form');



    // Make loadUserMemories globally accessible

    window.loadUserMemories = async function() {

        const { data: { user } } = await supabaseClient.auth.getUser();

        if (!user) return;



        const { data, error } = await supabaseClient.from('state_memories').select('*');

        if (error) return console.error("Database fetch error:", error);



        // Reset state from factory before adding database items to prevent duplicates

        stateGalleries = getBaseGalleries();



        data.forEach(item => {

            if (!stateGalleries[item.state_name]) stateGalleries[item.state_name] = [];

            stateGalleries[item.state_name].unshift({

                id: item.id,

                img: item.image_url,

                desc: item.caption

            });

        });



        // Update map visuals

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



    // --- Map Interactions ---

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
                // Keeps the preview card stuck closely to the cursor regardless of screen size
                const offset = 12; // Tightly controlled distance in pixels
                
                hoverPreview.style.position = 'fixed';
                hoverPreview.style.left = `${e.clientX + 40}px`;
                
                // Positions preview directly above cursor; flips below if near top of screen
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



    // --- Auth Handling ---

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



    // --- Memory Upload Handling ---

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



    // --- Modal Utilities & Session Boot ---

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


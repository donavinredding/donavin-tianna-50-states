// Sample Data Store for each state's images and descriptions
// You can expand this with actual paths to your family photos for each state code (e.g., 'CA', 'NY', etc.)
const stateData = {
    "AL": { name: "Alabama", images: [{ url: "./images/alabama1.jpg", caption: "Sweet Home Alabama trip" }] },
    "AK": { name: "Alaska", images: [{ url: "./images/alaska1.jpg", caption: "Glacier exploring!" }] },
    "CA": { 
        name: "California", 
        images: [
            { url: "./images/california1.jpg", caption: "Sunset at Santa Monica Pier" },
            { url: "./images/california2.jpg", caption: "Redwoods National Park adventure" },
            { url: "./images/california3.jpg", caption: "Big Sur coastal drive" }
        ] 
    },
    "NY": { 
        name: "New York", 
        images: [
            { url: "./images/ny1.jpg", caption: "Central Park autumn walk" },
            { url: "./images/ny2.jpg", caption: "Times Square lights" }
        ] 
    },
    // Default fallback for any state without explicit custom photos yet
    "DEFAULT": {
        name: "Our Memory",
        images: [
            { url: "./images/default1.jpg", caption: "Memories made along the way." },
            { url: "./images/default2.jpg", caption: "Exploring the USA together!" }
        ]
    }
};

document.addEventListener("DOMContentLoaded", () => {
    const svgObject = document.getElementById("us-map-object");
    const modal = document.getElementById("gallery-modal");
    const closeModalBtn = document.getElementById("close-modal");
    const modalTitle = document.getElementById("modal-state-title");
    const polaroidGrid = document.getElementById("polaroid-grid");

    // Wait for external SVG object to load fully
    svgObject.addEventListener("load", () => {
        const svgDoc = svgObject.contentDocument;
        if (!svgDoc) return;

        // Select all state elements (assuming standard SVG paths/g tags have state IDs like id="CA")
        const states = svgDoc.querySelectorAll("path, g[id]");

        states.forEach(state => {
            const stateId = state.id ? state.id.toUpperCase() : null;
            if (!stateId || stateId.length !== 2) return; // Skip non-state elements

            // Styling injection for retro appearance
            state.style.fill = "#3b5336"; // Dark pastel green base
            state.style.stroke = "#faf6f0";
            state.style.strokeWidth = "1.5";
            state.style.cursor = "pointer";
            state.style.transition = "all 0.3s ease";

            let fadeInterval = null;
            let currentImgIdx = 0;
            const data = stateData[stateId] || { 
                name: stateId, 
                images: [{ url: "./images/placeholder.jpg", caption: `Adventures in ${stateId}` }] 
            };

            // Hover: increase size / highlight & fade through photos inside state styling
            state.addEventListener("mouseenter", () => {
                state.style.fill = "#d97742"; // Pastel orange highlight
                state.style.transform = "scale(1.02)";
                
                // Optional: Cycle colors/images or visual effect on hover
                let colors = ["#d97742", "#8c3b32", "#3b5336"];
                let cIdx = 0;
                fadeInterval = setInterval(() => {
                    cIdx = (cIdx + 1) % colors.length;
                    state.style.fill = colors[cIdx];
                }, 800);
            });

            state.addEventListener("mouseleave", () => {
                state.style.fill = "#3b5336"; // Revert to dark pastel green
                state.style.transform = "scale(1)";
                clearInterval(fadeInterval);
            });

            // Click: Open Polaroid gallery modal
            state.addEventListener("click", () => {
                openGallery(data);
            });
        });
    });

    function openGallery(data) {
        modalTitle.textContent = data.name;
        polaroidGrid.innerHTML = "";

        data.images.forEach((img, index) => {
            // Random slight rotation for vintage polaroid scattered stack effect (-3deg to 3deg)
            const randomRotation = (Math.random() * 6 - 3).toFixed(1);

            const card = document.createElement("div");
            card.className = "polaroid-card";
            card.style.setProperty('--rot', `${randomRotation}deg`);

            card.innerHTML = `
                <div class="polaroid-image-container">
                    <img src="${img.url}" alt="${img.caption}" onerror="this.src='https://via.placeholder.com/300x200/3b5336/faf6f0?text=Family+Memory'">
                </div>
                <div class="polaroid-caption">${img.caption}</div>
            `;
            polaroidGrid.appendChild(card);
        });

        modal.classList.remove("hidden");
    }

    // Close Modal Event Listeners
    closeModalBtn.addEventListener("click", () => {
        modal.classList.add("hidden");
    });

    modal.addEventListener("click", (e) => {
        if (e.target === modal) {
            modal.classList.add("hidden");
        }
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            modal.classList.add("hidden");
        }
    });
});
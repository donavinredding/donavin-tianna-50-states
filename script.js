// List of all 50 US States with sample data for family memories
const statesData = [
    { name: "Alabama", code: "AL", images: [
        { url: "https://picsum.photos/id/1015/400/300", desc: "Family trip to Gulf Shores." },
        { url: "https://picsum.photos/id/1025/400/300", desc: "Exploring Huntsville Space Center." }
    ]},
    { name: "Alaska", code: "AK", images: [
        { url: "https://picsum.photos/id/1039/400/300", desc: "Glacier sightseeing adventure." },
        { url: "https://picsum.photos/id/1043/400/300", desc: "Spotting wildlife in Denali." }
    ]},
    { name: "Arizona", code: "AZ", images: [
        { url: "https://picsum.photos/id/1050/400/300", desc: "Grand Canyon sunset hike." },
        { url: "https://picsum.photos/id/1069/400/300", desc: "Sedona red rocks." }
    ]},
    { name: "Arkansas", code: "AR", images: [
        { url: "https://picsum.photos/id/1074/400/300", desc: "Hot Springs National Park soaking." }
    ]},
    { name: "California", code: "CA", images: [
        { url: "https://picsum.photos/id/1011/400/300", desc: "Pacific Coast Highway drive." },
        { url: "https://picsum.photos/id/1012/400/300", desc: "Yosemite camping weekend." },
        { url: "https://picsum.photos/id/1016/400/300", desc: "Golden Gate Bridge walk." }
    ]},
    { name: "Colorado", code: "CO", images: [
        { url: "https://picsum.photos/id/1020/400/300", desc: "Rocky Mountain snow trip." },
        { url: "https://picsum.photos/id/1024/400/300", desc: "Hiking in Boulder." }
    ]},
    { name: "Connecticut", code: "CT", images: [
        { url: "https://picsum.photos/id/1031/400/300", desc: "Mystic Seaport Museum visit." }
    ]},
    { name: "Delaware", code: "DE", images: [
        { url: "https://picsum.photos/id/1035/400/300", desc: "Rehoboth Beach boardwalk day." }
    ]},
    { name: "Florida", code: "FL", images: [
        { url: "https://picsum.photos/id/1041/400/300", desc: "Key West family vacation." },
        { url: "https://picsum.photos/id/1042/400/300", desc: "Everglades airboat ride." }
    ]},
    { name: "Georgia", code: "GA", images: [
        { url: "https://picsum.photos/id/1055/400/300", desc: "Savannah historic square walk." },
        { url: "https://picsum.photos/id/1057/400/300", desc: "Atlanta botanical gardens." }
    ]},
    { name: "Hawaii", code: "HI", images: [
        { url: "https://picsum.photos/id/1062/400/300", desc: "Waikiki beach snorkeling." },
        { url: "https://picsum.photos/id/1067/400/300", desc: "Road to Hana roadtrip." }
    ]},
    { name: "Idaho", code: "ID", images: [
        { url: "https://picsum.photos/id/1070/400/300", desc: "Sun Valley hiking retreat." }
    ]},
    { name: "Illinois", code: "IL", images: [
        { url: "https://picsum.photos/id/1080/400/300", desc: "Chicago deep-dish pizza & Millennium Park." }
    ]},
    { name: "Indiana", code: "IN", images: [
        { url: "https://picsum.photos/id/1081/400/300", desc: "Indianapolis Motor Speedway tour." }
    ]},
    { name: "Iowa", code: "IA", images: [
        { url: "https://picsum.photos/id/1082/400/300", desc: "State Fair family fun." }
    ]},
    { name: "Kansas", code: "KS", images: [
        { url: "https://picsum.photos/id/1083/400/300", desc: "Sunflower fields road trip." }
    ]},
    { name: "Kentucky", code: "KY", images: [
        { url: "https://picsum.photos/id/1084/400/300", desc: "Mammoth Cave exploration." }
    ]},
    { name: "Louisiana", code: "LA", images: [
        { url: "https://picsum.photos/id/100/400/300", desc: "New Orleans French Quarter jazz night." }
    ]},
    { name: "Maine", code: "ME", images: [
        { url: "https://picsum.photos/id/101/400/300", desc: "Acadia National Park lighthouse hike." }
    ]},
    { name: "Maryland", code: "MD", images: [
        { url: "https://picsum.photos/id/102/400/300", desc: "Annapolis harbor crab feast." }
    ]},
    { name: "Massachusetts", code: "MA", images: [
        { url: "https://picsum.photos/id/103/400/300", desc: "Boston Freedom Trail walk." }
    ]},
    { name: "Michigan", code: "MI", images: [
        { url: "https://picsum.photos/id/104/400/300", desc: "Mackinac Island bike ride." }
    ]},
    { name: "Minnesota", code: "MN", images: [
        { url: "https://picsum.photos/id/106/400/300", desc: "Canoeing the Boundary Waters." }
    ]},
    { name: "Mississippi", code: "MS", images: [
        { url: "https://picsum.photos/id/108/400/300", desc: "Natchez Trace Parkway drive." }
    ]},
    { name: "Missouri", code: "MO", images: [
        { url: "https://picsum.photos/id/109/400/300", desc: "St. Louis Gateway Arch view." }
    ]},
    { name: "Montana", code: "MT", images: [
        { url: "https://picsum.photos/id/111/400/300", desc: "Glacier National Park camping." }
    ]},
    { name: "Nebraska", code: "NE", images: [
        { url: "https://picsum.photos/id/112/400/300", desc: "Chimney Rock historic stop." }
    ]},
    { name: "Nevada", code: "NV", images: [
        { url: "https://picsum.photos/id/113/400/300", desc: "Lake Tahoe summer weekend." }
    ]},
    { name: "New Hampshire", code: "NH", images: [
        { url: "https://picsum.photos/id/114/400/300", desc: "White Mountains autumn foliage." }
    ]},
    { name: "New Jersey", code: "NJ", images: [
        { url: "https://picsum.photos/id/115/400/300", desc: "Cape May Victorian beach getaway." }
    ]},
    { name: "New Mexico", code: "NM", images: [
        { url: "https://picsum.photos/id/116/400/300", desc: "Santa Fe art market & balloon fiesta." }
    ]},
    { name: "New York", code: "NY", images: [
        { url: "https://picsum.photos/id/119/400/300", desc: "Central Park autumn walk." },
        { url: "https://picsum.photos/id/120/400/300", desc: "Niagara Falls boat tour." }
    ]},
    { name: "North Carolina", code: "NC", images: [
        { url: "https://picsum.photos/id/121/400/300", desc: "Outer Banks lighthouse tour." }
    ]},
    { name: "North Dakota", code: "ND", images: [
        { url: "https://picsum.photos/id/122/400/300", desc: "Theodore Roosevelt National Park." }
    ]},
    { name: "Ohio", code: "OH", images: [
        { url: "https://picsum.photos/id/123/400/300", desc: "Hocking Hills State Park trails." }
    ]},
    { name: "Oklahoma", code: "OK", images: [
        { url: "https://picsum.photos/id/124/400/300", desc: "Route 66 historic road trip." }
    ]},
    { name: "Oregon", code: "OR", images: [
        { url: "https://picsum.photos/id/125/400/300", desc: "Multnomah Falls & coast exploration." }
    ]},
    { name: "Pennsylvania", code: "PA", images: [
        { url: "https://picsum.photos/id/129/400/300", desc: "Philadelphia Liberty Bell visit." }
    ]},
    { name: "Rhode Island", code: "RI", images: [
        { url: "https://picsum.photos/id/131/400/300", desc: "Newport Cliff Walk mansions." }
    ]},
    { name: "South Carolina", code: "SC", images: [
        { url: "https://picsum.photos/id/132/400/300", desc: "Charleston historic walking tour." }
    ]},
    { name: "South Dakota", code: "SD", images: [
        { url: "https://picsum.photos/id/133/400/300", desc: "Badlands National Park sightseeing." }
    ]},
    { name: "Tennessee", code: "TN", images: [
        { url: "https://picsum.photos/id/134/400/300", desc: "Great Smoky Mountains cabin trip." }
    ]},
    { name: "Texas", code: "TX", images: [
        { url: "https://picsum.photos/id/135/400/300", desc: "Austin live music & BBQ weekend." }
    ]},
    { name: "Utah", code: "UT", images: [
        { url: "https://picsum.photos/id/136/400/300", desc: "Zion National Park red rock hike." }
    ]},
    { name: "Vermont", code: "VT", images: [
        { url: "https://picsum.photos/id/137/400/300", desc: "Maple syrup tasting & farm tour." }
    ]},
    { name: "Virginia", code: "VA", images: [
        { url: "https://picsum.photos/id/139/400/300", desc: "Shenandoah National Park skyline drive." }
    ]},
    { name: "Washington", code: "WA", images: [
        { url: "https://picsum.photos/id/140/400/300", desc: "Olympic National Park rainforest." }
    ]},
    { name: "West Virginia", code: "WV", images: [
        { url: "https://picsum.photos/id/142/400/300", desc: "New River Gorge bridge rafting." }
    ]},
    { name: "Wisconsin", code: "WI", images: [
        { url: "https://picsum.photos/id/143/400/300", desc: "Door County cherry picking weekend." }
    ]},
    { name: "Wyoming", code: "WY", images: [
        { url: "https://picsum.photos/id/144/400/300", desc: "Yellowstone geysers & bison spotting." }
    ]}
];

// DOM Elements
const statesGrid = document.getElementById('states-grid');
const modal = document.getElementById('gallery-modal');
const closeModalBtn = document.getElementById('close-modal');
const modalStateTitle = document.getElementById('modal-state-title');
const polaroidGallery = document.getElementById('polaroid-gallery');

// Render State Cards onto the Grid
function renderStates() {
    statesGrid.innerHTML = '';
    statesData.forEach(state => {
        const card = document.createElement('div');
        card.className = 'state-card';
        card.setAttribute('data-code', state.code);

        // Background container for hover fade effect
        const bgSlider = document.createElement('div');
        bgSlider.className = 'state-bg-slider';
        // Use the first image for hover background preview
        if (state.images && state.images.length > 0) {
            bgSlider.style.backgroundImage = `url('${state.images[0].url}')`;
        }

        const titleSpan = document.createElement('span');
        titleSpan.textContent = `${state.name} (${state.code})`;

        card.appendChild(bgSlider);
        card.appendChild(titleSpan);

        // Click event to open modal gallery
        card.addEventListener('click', () => {
            openStateGallery(state);
        });

        statesGrid.appendChild(card);
    });
}

// Open and populate Polaroid Gallery Modal
function openStateGallery(state) {
    modalStateTitle.textContent = `${state.name} Gallery`;
    polaroidGallery.innerHTML = '';

    if (state.images && state.images.length > 0) {
        state.images.forEach(img => {
            const polaroid = document.createElement('div');
            polaroid.className = 'polaroid-item';

            polaroid.innerHTML = `
                <div class="polaroid-img-wrapper">
                    <img src="${img.url}" alt="${state.name} Memory" loading="lazy">
                </div>
                <div class="polaroid-caption">${img.desc}</div>
            `;
            polaroidGallery.appendChild(polaroid);
        });
    } else {
        polaroidGallery.innerHTML = `<p style="text-align:center; grid-column: 1/-1;">No family memories added for this state yet!</p>`;
    }

    modal.classList.remove('hidden');
}

// Close Modal Events
closeModalBtn.addEventListener('click', () => {
    modal.classList.add('hidden');
});

window.addEventListener('click', (e) => {
    if (e.target === modal) {
        modal.classList.add('hidden');
    }
});

// Initialize App
document.addEventListener('DOMContentLoaded', () => {
    renderStates();
});
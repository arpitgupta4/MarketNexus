/* * MarketNexus - SaaS Logic Core
 * Handles API fetching, dynamic cross-filtering, deep searching, Pipeline view, Drawer management, and Visual Analytics.
 */

const API_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRqVXr4sXzLjAkI3Y-EranuAYbVJKAmgdEebtnaaUOx1czymzNVf8liZOu4KwJFPDBJYHcKU1MBg0oT/pub?output=csv';

// Master Sequence for the Supply Chain Pipeline
const STAGE_ORDER = [
    "Raw Material Extraction",
    "Processing & Refining",
    "Component Manufacturing",
    "Assembly / OEM",
    "Software & Integration",
    "Distribution & Logistics",
    "Service Provider",
    "End Consumer"
];

let rawData = [];
let filteredData = [];

// Chart Instances (Stored globally to destroy/redraw cleanly)
let sectorChartInstance = null;
let stageChartInstance = null;

// Hierarchical & Layout State Management
let currentView = 'stages'; // 'stages' | 'stocks'
let activeStageName = null;
let activeLayout = 'grid'; // 'grid' | 'pipeline' | 'analytics'

// DOM References
const DOM = {
    search: document.getElementById('searchInput'),
    sort: document.getElementById('sortSelect'),
    theme: document.getElementById('themeSelect'),
    sector: document.getElementById('sectorSelect'),
    industry: document.getElementById('industrySelect'),
    stage: document.getElementById('stageSelect'),
    resetBtn: document.getElementById('resetFilters'),

    loader: document.getElementById('loader'),
    errorState: document.getElementById('errorState'),
    noResults: document.getElementById('noResults'),
    grid: document.getElementById('grid'),
    pipeline: document.getElementById('pipeline'),
    analytics: document.getElementById('analytics'),
    resultCount: document.getElementById('resultCount'),
    retryBtn: document.getElementById('retryBtn'),

    // View Controls
    viewControls: document.getElementById('viewControls'),
    viewBtns: document.querySelectorAll('.view-btn'),

    // Breadcrumb Navigation
    breadcrumb: document.getElementById('breadcrumb'),
    backBtn: document.getElementById('backBtn'),
    activeSectorTitle: document.getElementById('activeSectorTitle'),

    // Drawer Details
    drawer: document.getElementById('drawerBackdrop'),
    closeDrawer: document.getElementById('closeDrawer'),
};

function init() {
    bindEvents();
    fetchData();
}

/**
 * Executes async API call via PapaParse
 */
function fetchData() {
    setUIState('loading');

    Papa.parse(API_URL, {
        download: true,
        header: true,
        skipEmptyLines: true,
        complete: function (results) {
            rawData = results.data.filter(item => item['Company Name'] || item['Stock Symbol']);
            processData(); // This handles dynamic dropdowns & initial render
        },
        error: function (err) {
            console.error("Data Pipeline Error:", err);
            setUIState('error');
        }
    });
}

/**
 * Multi-layer logic: Dynamic Cross-Filtering, Deep Search, and Sorting
 */
function processData() {
    const q = DOM.search.value.toLowerCase().trim();
    const searchTerms = q.split(' ').filter(t => t !== '');

    let themeVal = DOM.theme.value;
    let sectorVal = DOM.sector.value;
    let industryVal = DOM.industry.value;
    let stageVal = DOM.stage.value;

    // Helper to evaluate text search match
    const matchesSearch = (item) => {
        if (searchTerms.length === 0) return true;
        const masterString = [
            String(item['Search Tags / Aliases'] || ""),
            String(item['Specific Products'] || ""),
            String(item['Specific Services'] || ""),
            String(item['Company Name'] || ""),
            String(item['Stock Symbol'] || "")
        ].join(" ").toLowerCase();
        return searchTerms.every(term => masterString.includes(term));
    };

    // ==============================================================
    // 1. DYNAMIC DROPDOWN CALCULATION (Cascading Cross-Filters)
    // ==============================================================
    const themes = new Set();
    const sectors = new Set();
    const industries = new Set();
    const stages = new Set();

    rawData.forEach(item => {
        if (!matchesSearch(item)) return;

        const t = item['Parent Theme'] ? String(item['Parent Theme']).trim() : '';
        const sec = item['Sector'] ? String(item['Sector']).trim() : '';
        const ind = item['Industry'] ? String(item['Industry']).trim() : '';
        const stg = item['Supply Chain Stage'] ? String(item['Supply Chain Stage']).trim() : '';

        const matchT = themeVal === 'All' || t === themeVal;
        const matchSec = sectorVal === 'All' || sec === sectorVal;
        const matchInd = industryVal === 'All' || ind === industryVal;
        const matchStg = stageVal === 'All' || stg === stageVal;

        // Populate options based on the OTHER active filters
        if (matchSec && matchInd && matchStg && t) themes.add(t);
        if (matchT && matchInd && matchStg && sec) sectors.add(sec);
        if (matchT && matchSec && matchStg && ind) industries.add(ind);
        if (matchT && matchSec && matchInd && stg) stages.add(stg);
    });

    fillSelect(DOM.theme, themes, "Themes", themeVal);
    fillSelect(DOM.sector, sectors, "Sectors", sectorVal);
    fillSelect(DOM.industry, industries, "Industries", industryVal);
    fillSelect(DOM.stage, stages, "Stages", stageVal);

    themeVal = DOM.theme.value;
    sectorVal = DOM.sector.value;
    industryVal = DOM.industry.value;
    stageVal = DOM.stage.value;

    // ==============================================================
    // 2. CORE FILTERING 
    // ==============================================================
    filteredData = rawData.filter(item => {
        if (!matchesSearch(item)) return false;
        if (themeVal !== 'All' && String(item['Parent Theme']).trim() !== themeVal) return false;
        if (sectorVal !== 'All' && String(item['Sector']).trim() !== sectorVal) return false;
        if (industryVal !== 'All' && String(item['Industry']).trim() !== industryVal) return false;
        if (stageVal !== 'All' && String(item['Supply Chain Stage']).trim() !== stageVal) return false;
        return true;
    });

    // ==============================================================
    // 3. DATA SORTING
    // ==============================================================
    const sortVal = DOM.sort.value;
    filteredData.sort((a, b) => {
        const rawCapA = String(a['Market Cap (INR)'] || '0').replace(/[^0-9.-]+/g, "");
        const rawCapB = String(b['Market Cap (INR)'] || '0').replace(/[^0-9.-]+/g, "");
        const capA = Number(rawCapA) || 0;
        const capB = Number(rawCapB) || 0;

        const nameA = String(a['Company Name'] || "");
        const nameB = String(b['Company Name'] || "");

        if (sortVal === 'cap-desc') return capB - capA;
        if (sortVal === 'cap-asc') return capA - capB;
        if (sortVal === 'name-asc') return nameA.localeCompare(nameB);
        if (sortVal === 'name-desc') return nameB.localeCompare(nameA);
        return 0;
    });

    // Auto-reset UI to stage view
    currentView = 'stages';
    activeStageName = null;

    renderCurrentView();
}

/**
 * Populates dropdowns & maintains active selections
 */
function fillSelect(element, itemsSet, labelPlural, currentVal) {
    element.innerHTML = `<option value="All">All ${labelPlural}</option>`;

    Array.from(itemsSet).sort().forEach(item => {
        const opt = document.createElement('option');
        opt.value = item;
        opt.textContent = item;
        element.appendChild(opt);
    });

    if (itemsSet.has(currentVal)) {
        element.value = currentVal;
    } else {
        element.value = 'All';
    }
}

/**
 * Routing Controller
 */
function renderCurrentView() {
    if (filteredData.length === 0) {
        setUIState('empty');
        DOM.resultCount.textContent = "0 entities found";
        DOM.viewControls.classList.add('hidden');
        return;
    }

    setUIState('data');
    DOM.viewControls.classList.remove('hidden');

    if (activeLayout === 'analytics') {
        DOM.breadcrumb.classList.add('hidden');
        renderAnalyticsView();
    } else if (activeLayout === 'pipeline') {
        DOM.breadcrumb.classList.add('hidden');
        renderPipelineView();
    } else {
        DOM.pipeline.classList.add('hidden');
        DOM.analytics.classList.add('hidden');
        DOM.grid.classList.remove('hidden');

        if (currentView === 'stages') {
            DOM.breadcrumb.classList.add('hidden');
            renderStageCards();
        } else {
            DOM.breadcrumb.classList.remove('hidden');
            DOM.activeSectorTitle.textContent = activeStageName;
            renderStockCards();
        }
    }
    /**
 * Routing Controller
 */
    function renderCurrentView() {
        if (filteredData.length === 0) {
            setUIState('empty');
            DOM.resultCount.textContent = "0 entities found";
            DOM.viewControls.classList.add('hidden');
            return;
        }

        setUIState('data');
        DOM.viewControls.classList.remove('hidden');

        if (activeLayout === 'analytics') {
            DOM.breadcrumb.classList.add('hidden');
            renderAnalyticsView();
        } else if (activeLayout === 'pipeline') {
            DOM.breadcrumb.classList.add('hidden');
            renderPipelineView();
        } else {
            DOM.pipeline.classList.add('hidden');
            DOM.analytics.classList.add('hidden');
            DOM.grid.classList.remove('hidden');

            if (currentView === 'stages') {
                DOM.breadcrumb.classList.add('hidden');
                renderStageCards();
            } else {
                DOM.breadcrumb.classList.remove('hidden');
                DOM.activeSectorTitle.textContent = activeStageName;
                renderStockCards();
            }
        }

        // NEW: Re-bind the 3D hover physics to newly generated DOM elements
        setTimeout(init3DTilt, 100);
    }
}

/**
 * Render Stage Folders (Grid Mode)
 */
function renderStageCards() {
    DOM.grid.innerHTML = '';
    const fragment = document.createDocumentFragment();

    const stageMap = {};
    filteredData.forEach(item => {
        const stage = item['Supply Chain Stage'] || 'Unclassified Stage';
        if (!stageMap[stage]) {
            stageMap[stage] = { name: stage, count: 0, totalCap: 0 };
        }
        stageMap[stage].count += 1;
        const cap = Number(String(item['Market Cap (INR)'] || '0').replace(/[^0-9.-]+/g, "")) || 0;
        stageMap[stage].totalCap += cap;
    });

    const stageArray = Object.values(stageMap).sort((a, b) => b.totalCap - a.totalCap);

    DOM.resultCount.textContent = `Found ${filteredData.length} assets across ${stageArray.length} supply chain stages`;

    stageArray.forEach(stg => {
        const card = document.createElement('div');
        card.className = 'sector-card';

        card.innerHTML = `
            <div>
                <div class="sector-icon-wrap">
                    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
                        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
                    </svg>
                </div>
                <h3>${stg.name}</h3>
            </div>
            
            <div class="sector-stats">
                <div class="stat-block">
                    <span class="lbl">Total Assets</span>
                    <span class="val">${stg.count}</span>
                </div>
                <div class="stat-block">
                    <span class="lbl">Combined Cap</span>
                    <span class="val">${formatINR(stg.totalCap)}</span>
                </div>
            </div>
        `;

        card.addEventListener('click', () => {
            currentView = 'stocks';
            activeStageName = stg.name;
            renderCurrentView();
        });

        fragment.appendChild(card);
    });

    DOM.grid.appendChild(fragment);
}

/**
 * Render Stock Cards inside a Stage (Grid Mode)
 */
function renderStockCards() {
    DOM.grid.innerHTML = '';
    const fragment = document.createDocumentFragment();

    const stageStocks = filteredData.filter(item => (item['Supply Chain Stage'] || 'Unclassified Stage') === activeStageName);
    DOM.resultCount.textContent = `Viewing ${stageStocks.length} assets in ${activeStageName}`;

    stageStocks.forEach(item => {
        const card = document.createElement('div');
        card.className = 'card';

        const symbol = item['Stock Symbol'] || 'N/A';
        const name = item['Company Name'] || 'Unknown Entity';
        const capFormat = formatINR(item['Market Cap (INR)']);
        const sector = item['Sector'] || '';

        let tagsHTML = '';
        if (sector) tagsHTML += `<span class="minimal-tag">${sector}</span>`;

        card.innerHTML = `
            <div class="card-top">
                <div class="card-header-main">
                    <h3 class="card-title" title="${name}">${name}</h3>
                    <span class="card-ticker">${symbol}</span>
                </div>
                ${tagsHTML ? `<div class="card-tags">${tagsHTML}</div>` : ''}
            </div>
            
            <div class="card-bottom">
                <div class="card-metric">
                    <span class="metric-lbl">Market Cap</span>
                    <span class="metric-val">${capFormat}</span>
                </div>
                <button class="btn-minimal" aria-label="Deep dive into ${name}">
                    Deep Dive
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                        <polyline points="12 5 19 12 12 19"></polyline>
                    </svg>
                </button>
            </div>
        `;

        card.querySelector('.btn-minimal').addEventListener('click', () => openDrawer(item));
        fragment.appendChild(card);
    });

    DOM.grid.appendChild(fragment);
}

/**
 * Render Chronological Value Chain (Pipeline Mode)
 */
function renderPipelineView() {
    DOM.grid.classList.add('hidden');
    DOM.analytics.classList.add('hidden');
    DOM.pipeline.classList.remove('hidden');
    DOM.pipeline.innerHTML = '';

    const pipelineMap = {};
    filteredData.forEach(item => {
        const stage = item['Supply Chain Stage'] || 'Uncategorized';
        if (!pipelineMap[stage]) pipelineMap[stage] = [];
        pipelineMap[stage].push(item);
    });

    const discoveredStages = Object.keys(pipelineMap);
    discoveredStages.sort((a, b) => {
        let indexA = STAGE_ORDER.indexOf(a);
        let indexB = STAGE_ORDER.indexOf(b);
        if (indexA === -1) indexA = 999;
        if (indexB === -1) indexB = 999;
        return indexA - indexB;
    });

    DOM.resultCount.textContent = `Mapping ${filteredData.length} assets across the value chain.`;
    const fragment = document.createDocumentFragment();

    discoveredStages.forEach((stageName, index) => {
        const items = pipelineMap[stageName];

        items.sort((a, b) => {
            const capA = Number(String(a['Market Cap (INR)'] || '0').replace(/[^0-9.-]+/g, "")) || 0;
            const capB = Number(String(b['Market Cap (INR)'] || '0').replace(/[^0-9.-]+/g, "")) || 0;
            return capB - capA;
        });

        const column = document.createElement('div');
        column.className = 'pipeline-stage';
        column.style.animationDelay = `${index * 0.1}s`;

        let cardsHTML = '';
        items.forEach(item => {
            const symbol = item['Stock Symbol'] || 'N/A';
            const name = item['Company Name'] || 'Unknown Entity';
            const capFormat = formatINR(item['Market Cap (INR)']);
            const dataIndex = filteredData.indexOf(item);

            cardsHTML += `
                <div class="pipe-card" onclick="openDrawerFromIndex(${dataIndex})">
                    <div class="pipe-top">
                        <span class="pipe-title">${name}</span>
                        <span class="pipe-ticker">${symbol}</span>
                    </div>
                    <span class="pipe-cap">${capFormat}</span>
                </div>
            `;
        });

        column.innerHTML = `
            <div class="stage-header">
                <h3>${stageName}</h3>
                <span class="stage-count">${items.length}</span>
            </div>
            <div class="pipeline-cards">
                ${cardsHTML}
            </div>
        `;

        fragment.appendChild(column);
    });

    DOM.pipeline.appendChild(fragment);
}

// Global hook for inline HTML execution in Pipeline mode
window.openDrawerFromIndex = function (index) {
    openDrawer(filteredData[index]);
};

/**
 * Render Visual Analytics Dashboard (Analytics Mode)
 */
function renderAnalyticsView() {
    DOM.grid.classList.add('hidden');
    DOM.pipeline.classList.add('hidden');
    DOM.analytics.classList.remove('hidden');
    DOM.resultCount.textContent = `Visualizing data across ${filteredData.length} assets.`;

    // Setup Custom Dark Theme Defaults
    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = "'Inter', sans-serif";
    Chart.defaults.plugins.tooltip.backgroundColor = '#1e293b';
    Chart.defaults.plugins.tooltip.titleColor = '#f8fafc';
    Chart.defaults.plugins.tooltip.padding = 12;
    Chart.defaults.plugins.tooltip.cornerRadius = 8;
    Chart.defaults.plugins.tooltip.borderColor = 'rgba(255,255,255,0.1)';
    Chart.defaults.plugins.tooltip.borderWidth = 1;

    const palette = ['#38bdf8', '#818cf8', '#34d399', '#fbbf24', '#f87171', '#c084fc', '#f472b6', '#2dd4bf'];

    // Aggregate Data: Sector Cap
    const sectorMap = {};
    filteredData.forEach(item => {
        const sector = item['Sector'] || 'Unclassified';
        const cap = Number(String(item['Market Cap (INR)'] || '0').replace(/[^0-9.-]+/g, "")) || 0;
        sectorMap[sector] = (sectorMap[sector] || 0) + cap;
    });

    const sortedSectors = Object.keys(sectorMap).sort((a, b) => sectorMap[b] - sectorMap[a]);
    const sectorLabels = sortedSectors;
    const sectorData = sortedSectors.map(s => sectorMap[s]);

    // Aggregate Data: Stage Count
    const stageMap = {};
    filteredData.forEach(item => {
        const stage = item['Supply Chain Stage'] || 'Unclassified';
        stageMap[stage] = (stageMap[stage] || 0) + 1;
    });

    const stageLabels = Object.keys(stageMap).sort((a, b) => {
        let indexA = STAGE_ORDER.indexOf(a);
        let indexB = STAGE_ORDER.indexOf(b);
        if (indexA === -1) indexA = 999;
        if (indexB === -1) indexB = 999;
        return indexA - indexB;
    });
    const stageData = stageLabels.map(s => stageMap[s]);

    // Render Chart 1: Doughnut
    const ctxSector = document.getElementById('chartSectorCap').getContext('2d');
    if (sectorChartInstance) sectorChartInstance.destroy();

    sectorChartInstance = new Chart(ctxSector, {
        type: 'doughnut',
        data: {
            labels: sectorLabels,
            datasets: [{
                data: sectorData,
                backgroundColor: palette,
                borderWidth: 2,
                borderColor: '#151e32',
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '65%',
            plugins: {
                legend: { position: 'right', labels: { boxWidth: 12, usePointStyle: true } },
                tooltip: {
                    callbacks: {
                        label: function (context) { return ' ' + formatINR(context.raw); }
                    }
                }
            }
        }
    });

    // Render Chart 2: Bar
    const ctxStage = document.getElementById('chartStageCount').getContext('2d');
    if (stageChartInstance) stageChartInstance.destroy();

    stageChartInstance = new Chart(ctxStage, {
        type: 'bar',
        data: {
            labels: stageLabels,
            datasets: [{
                label: 'Number of Companies',
                data: stageData,
                backgroundColor: '#38bdf8',
                borderRadius: 4,
                barPercentage: 0.6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { precision: 0 },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                },
                x: {
                    grid: { display: false },
                    ticks: { maxRotation: 45, minRotation: 45 }
                }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

// ==========================================
// Intelligent Drawer Interactivity
// ==========================================

function createSmartList(rawString, fallbackText) {
    if (!rawString || String(rawString).trim() === '') {
        return `<p class="empty-read">${fallbackText}</p>`;
    }
    const items = String(rawString).split(',').map(i => i.trim()).filter(i => i !== '');
    if (items.length === 0) return `<p class="empty-read">${fallbackText}</p>`;
    return `<ul class="smart-list">${items.map(i => `<li>${i}</li>`).join('')}</ul>`;
}

function openDrawer(item) {
    document.getElementById('drawerSymbol').textContent = item['Stock Symbol'] || 'N/A';
    document.getElementById('drawerName').textContent = item['Company Name'] || 'Unknown Entity';
    document.getElementById('drawerCap').textContent = formatINR(item['Market Cap (INR)']);

    document.getElementById('drawerSector').textContent = item['Sector'] || 'Unclassified';
    document.getElementById('drawerIndustry').textContent = item['Industry'] || 'Unclassified';
    document.getElementById('drawerStage').textContent = item['Supply Chain Stage'] || 'Unclassified';

    document.getElementById('drawerProducts').innerHTML = createSmartList(item['Specific Products'], 'No specific individual products catalogued.');
    document.getElementById('drawerServices').innerHTML = createSmartList(item['Specific Services'], 'No specific individual services catalogued.');

    const capText = item['Operational Capacity'] || '';
    document.getElementById('drawerCapacity').textContent = capText.trim() ? capText : 'Operational constraints undocumented at this time.';
    document.getElementById('drawerCapacity').className = capText.trim() ? 'prose-text' : 'empty-read';

    const tagsDiv = document.getElementById('drawerTags');
    tagsDiv.innerHTML = '';
    const tagsRaw = item['Search Tags / Aliases'] || "";

    if (tagsRaw.trim()) {
        String(tagsRaw).split(',').forEach(t => {
            if (!t.trim()) return;
            const span = document.createElement('span');
            span.className = 'tag-pill';
            span.textContent = t.trim();
            tagsDiv.appendChild(span);
        });
    } else {
        tagsDiv.innerHTML = '<span class="empty-read">No search aliases bound to this entity.</span>';
    }

    document.body.style.overflow = 'hidden';
    DOM.drawer.classList.remove('hidden');
}

function closeDrawer() {
    document.body.style.overflow = '';
    DOM.drawer.classList.add('hidden');
}

// ==========================================
// Formatting & Core Event Binding
// ==========================================

function formatINR(number) {
    if (number === null || number === undefined || String(number).trim() === '') return 'N/A';
    const val = Number(String(number).replace(/[^0-9.-]+/g, ""));
    if (isNaN(val) || val === 0) return 'N/A';

    if (val >= 10000000) return `₹ ${(val / 10000000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`;
    if (val >= 100000) return `₹ ${(val / 100000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} L`;
    return `₹ ${val.toLocaleString('en-IN')}`;
}

function setUIState(state) {
    DOM.loader.classList.add('hidden');
    DOM.errorState.classList.add('hidden');
    DOM.noResults.classList.add('hidden');
    DOM.grid.classList.add('hidden');
    DOM.pipeline.classList.add('hidden');
    if (DOM.analytics) DOM.analytics.classList.add('hidden');

    if (state === 'loading') DOM.loader.classList.remove('hidden');
    if (state === 'error') DOM.errorState.classList.remove('hidden');
    if (state === 'empty') DOM.noResults.classList.remove('hidden');
}

function bindEvents() {
    let debounceTimer;

    DOM.search.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(processData, 250);
    });

    [DOM.sort, DOM.theme, DOM.sector, DOM.industry, DOM.stage].forEach(el => {
        el.addEventListener('change', processData);
    });

    DOM.resetBtn.addEventListener('click', () => {
        DOM.search.value = '';
        DOM.sort.value = 'cap-desc';
        DOM.theme.value = 'All';
        DOM.sector.value = 'All';
        DOM.industry.value = 'All';
        DOM.stage.value = 'All';
        processData();
    });

    // View Toggles (Grid, Pipeline, Analytics)
    DOM.viewBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            DOM.viewBtns.forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            activeLayout = e.currentTarget.getAttribute('data-view');
            renderCurrentView();
        });
    });

    if (DOM.backBtn) {
        DOM.backBtn.addEventListener('click', () => {
            currentView = 'stages';
            activeStageName = null;
            renderCurrentView();
        });
    }

    DOM.retryBtn.addEventListener('click', fetchData);

    DOM.closeDrawer.addEventListener('click', closeDrawer);
    DOM.drawer.addEventListener('click', e => {
        if (e.target === DOM.drawer) closeDrawer();
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !DOM.drawer.classList.contains('hidden')) closeDrawer();
    });
}
// ==========================================
// 3D Spatial Interactive Engine
// ==========================================

// ==========================================
// Enhanced 3D Spatial Engine with Glass Sheen
// ==========================================

function init3DTilt() {
    const cards = document.querySelectorAll('.card, .sector-card, .pipe-card, .chart-card');

    cards.forEach(card => {
        card.addEventListener('mousemove', (e) => {
            if (card.classList.contains('expanded')) return;

            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            const centerX = rect.width / 2;
            const centerY = rect.height / 2;

            // 3D Tilt Math
            const rotateX = ((y - centerY) / centerY) * -6;
            const rotateY = ((x - centerX) / centerX) * 6;

            // Apply Tilt
            card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;

            // Apply Glass Sheen Lighting Coordinates
            card.style.setProperty('--mx', `${x}px`);
            card.style.setProperty('--my', `${y}px`);
        });

        card.addEventListener('mouseleave', () => {
            if (card.classList.contains('expanded')) return;
            card.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)`;
            // Reset sheen
            card.style.setProperty('--mx', `50%`);
            card.style.setProperty('--my', `50%`);
        });
    });
}

// ==========================================
// p5.js Ambient Nexus Background
// ==========================================

let particles = [];

function setup() {
    let canvas = createCanvas(windowWidth, windowHeight);
    canvas.parent('p5-canvas-container');

    // Create 80 floating data nodes
    const particleCount = windowWidth < 768 ? 40 : 80;
    for (let i = 0; i < particleCount; i++) {
        particles.push(new Particle());
    }
}

function draw() {
    clear(); // Keeps background transparent so CSS shows through

    for (let i = 0; i < particles.length; i++) {
        particles[i].update();
        particles[i].display();
        particles[i].checkConnections(particles);
    }
}

function windowResized() {
    resizeCanvas(windowWidth, windowHeight);
}

class Particle {
    constructor() {
        this.pos = createVector(random(width), random(height));
        this.vel = createVector(random(-0.3, 0.3), random(-0.3, 0.3));
        this.size = random(1.5, 4);
    }

    update() {
        this.pos.add(this.vel);

        // Softly bounce off screen edges
        if (this.pos.x < 0 || this.pos.x > width) this.vel.x *= -1;
        if (this.pos.y < 0 || this.pos.y > height) this.vel.y *= -1;

        // Subtle mouse repulsion effect
        let mouseDist = dist(mouseX, mouseY, this.pos.x, this.pos.y);
        if (mouseDist < 150) {
            let pushVector = createVector(this.pos.x - mouseX, this.pos.y - mouseY);
            pushVector.setMag(0.5);
            this.pos.add(pushVector);
        }
    }

    display() {
        noStroke();
        fill('rgba(56, 189, 248, 0.4)'); // Accent blue
        circle(this.pos.x, this.pos.y, this.size);
    }

    checkConnections(particles) {
        particles.forEach(particle => {
            const d = dist(this.pos.x, this.pos.y, particle.pos.x, particle.pos.y);
            // Connect nodes that are close to each other
            if (d < 140) {
                // Opacity fades out as distance increases
                const alpha = map(d, 0, 140, 0.15, 0);
                stroke(`rgba(129, 140, 248, ${alpha})`); // Indigo glow
                strokeWidth(1);
                line(this.pos.x, this.pos.y, particle.pos.x, particle.pos.y);
            }
        });
    }
}
// ==========================================
// Chart Expansion Logic
// ==========================================

window.toggleChart = function (cardId) {
    const card = document.getElementById(cardId);
    const btnIcon = card.querySelector('.btn-expand svg');

    if (card.classList.contains('expanded')) {
        // Shrink back
        card.classList.remove('expanded');
        card.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)`;
        btnIcon.innerHTML = `<polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line>`;
    } else {
        // Expand
        card.classList.add('expanded');
        card.style.transform = `translate(-50%, -50%) scale(1)`; // Clear 3D tilt
        btnIcon.innerHTML = `<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>`; // Change to 'X' icon
    }

    // Force Chart.js to recalculate its canvas size smoothly
    setTimeout(() => {
        if (sectorChartInstance) sectorChartInstance.resize();
        if (stageChartInstance) stageChartInstance.resize();
    }, 300); // Wait for CSS transition
};
// Spark ignition
document.addEventListener('DOMContentLoaded', init);
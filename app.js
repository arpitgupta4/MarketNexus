/* * MarketNexus - Value Chain Explorer
 * Features: High-Performance Simple Search, Clean State Routing, Pre-Computed Aggregations, Mobile UX.
 */

const API_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRqVXr4sXzLjAkI3Y-EranuAYbVJKAmgdEebtnaaUOx1czymzNVf8liZOu4KwJFPDBJYHcKU1MBg0oT/pub?gid=236349063&single=true&output=csv';

const STAGE_ORDER = [
    "Raw Material Extraction", "Processing & Refining", "Component Manufacturing",
    "Assembly / OEM", "Software & Integration", "Distribution & Logistics",
    "Service Provider", "End Consumer"
];

const VC_ORDER = [
    "Downstream",
    "Midstream / Downstream",
    "Midstream",
    "Upstream / Downstream",
    "Upstream",
    "Integrated",
    "Diversified",
    "Uncategorized"
];

let currentViewMode = 'grid'; 

let drillState = {
    level: 0, 
    theme: null,
    stage: null,
    subStage: null
};

// ======== PERFORMANCE OPTIMIZATION ========
// Prevents the search engine from firing on every single keystroke
function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

class ExplorerEngine {
    constructor() {
        this.rawData = [];
        this.activeFilters = {
            'Sector': new Set(),
            'Industry': new Set(),
            'Asset Type': new Set(),
            'Customer Type': new Set(),
            'Geographical Exposure': new Set()
        };
    }

    loadData(data) { 
        this.rawData = data.map(item => {
            item._cap = Number(String(item['Market Cap (INR)'] || '0').replace(/[^0-9.-]+/g, "")) || 0;
            return item;
        });
    }

    tokenize(query) {
        if (!query) return [];
        return query.toLowerCase().replace(/[.,;:\/\\]/g, ' ').split(/\s+/).filter(t => t);
    }

    getFilteredData(searchTerm) {
        const tokens = this.tokenize(searchTerm);
        let results = [];

        this.rawData.forEach(item => {
            for (const [key, activeSet] of Object.entries(this.activeFilters)) {
                if (activeSet.size > 0 && !activeSet.has(this.normalizeFacetValue(item, key))) return; 
            }

            if (tokens.length > 0) {
                const searchString = [
                    item['Company Name'], item['Stock Symbol'], 
                    item['Search Tags / Aliases'], item['Parent Theme'],
                    item['Sector'], item['Industry'], item['Supply Chain Stage'], 
                    item['Sub-Stage'], item['Specific Products'], item['Specific Services']
                ].join(" ").toLowerCase();

                const matchesAll = tokens.every(token => searchString.includes(token));
                if (matchesAll) {
                    results.push(item);
                }
            } else {
                results.push(item);
            }
        });

        return results.sort((a, b) => b._cap - a._cap);
    }

    determineRoutingContext(filteredData) {
        if (filteredData.length === 0) return { level: 0, theme: null, stage: null, subStage: null };

        const themeCounts = {};
        filteredData.forEach(item => {
            const theme = item['Parent Theme'] || 'Uncategorized';
            themeCounts[theme] = (themeCounts[theme] || 0) + 1;
        });

        let dominantTheme = 'Uncategorized';
        let maxCount = 0;
        for (const [theme, count] of Object.entries(themeCounts)) {
            if (count > maxCount) {
                maxCount = count;
                dominantTheme = theme;
            }
        }

        return { level: 1, theme: dominantTheme, stage: null, subStage: null };
    }

    normalizeFacetValue(item, key) {
        const raw = String(item[key] || '').trim();
        return raw === '' ? 'Uncategorized' : raw;
    }

    calculateFacets(currentResults) {
        const facets = { 'Sector': {}, 'Industry': {}, 'Asset Type': {}, 'Customer Type': {}, 'Geographical Exposure': {} };
        currentResults.forEach(item => {
            for (const category in facets) {
                const val = this.normalizeFacetValue(item, category);
                if (val !== 'Uncategorized') facets[category][val] = (facets[category][val] || 0) + 1;
            }
        });
        return facets;
    }
}

const Engine = new ExplorerEngine();
let activeData = [];

const DOM = {
    search: document.getElementById('searchInput'),
    grid: document.getElementById('grid'),
    pipeline: document.getElementById('pipeline'),
    facetsContainer: document.getElementById('facetsContainer'),
    resultCount: document.getElementById('resultCount'),
    pageTitle: document.getElementById('pageTitle'),
    breadcrumbNav: document.getElementById('breadcrumbNav'),
    sidebarToggle: document.getElementById('sidebarToggle'),
    sidebar: document.getElementById('sidebar'),
    drawer: document.getElementById('drawerBackdrop'),
    loader: document.getElementById('loader'),
    noResults: document.getElementById('noResults'),
    brandLogo: document.getElementById('brandLogo'),
    viewBtns: document.querySelectorAll('.view-btn')
};

function init() {
    // Auto-collapse sidebar on load for mobile devices
    if (window.innerWidth <= 900) {
        DOM.sidebar.classList.add('collapsed');
    }

    // Initialize the swipe-to-close gesture
    setupMobileDrawerSwipe();

    DOM.grid.classList.remove('hidden');

    Papa.parse(API_URL, {
        download: true, header: true, skipEmptyLines: true,
        complete: (res) => {
            Engine.loadData(res.data.filter(i => i['Company Name']));
            executePipeline();
            DOM.loader.classList.add('hidden');
            pushCustomHistory(); 
        },
        error: () => {
            DOM.loader.classList.add('hidden');
            DOM.noResults.classList.remove('hidden');
            DOM.noResults.querySelector('h2').textContent = 'Failed to load data';
            DOM.noResults.querySelector('p').textContent = 'Please check your network or CSV sheet URL.';
        }
    });

    // Debounced search logic for better performance
    DOM.search.addEventListener('input', debounce(() => {
        drillState = { level: 0, theme: null, stage: null, subStage: null };
        executePipeline();
        pushCustomHistory(); 
    }, 250));
    
    // Close mobile keyboard on "Enter" press
    DOM.search.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault(); // Prevents any weird default mobile behaviors
            DOM.search.blur();  // This is the magic command that hides the keyboard!
        }
    });
    
    document.getElementById('resetFilters').addEventListener('click', resetAllFeatures);
    DOM.brandLogo.addEventListener('click', resetAllFeatures);

    DOM.sidebarToggle.addEventListener('click', () => DOM.sidebar.classList.toggle('collapsed'));
    
    document.getElementById('closeDrawer').addEventListener('click', () => DOM.drawer.classList.add('hidden'));
    
    DOM.drawer.addEventListener('click', (e) => {
        if (e.target.id === 'drawerBackdrop' || e.target.id === 'detailDrawer') {
            DOM.drawer.classList.add('hidden');
        }
    });

    DOM.viewBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            DOM.viewBtns.forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            currentViewMode = e.currentTarget.dataset.view;
            renderDrillDownView();
        });
    });
}

function resetAllFeatures() {
    Object.keys(Engine.activeFilters).forEach(k => Engine.activeFilters[k].clear());
    DOM.search.value = '';
    drillState = { level: 0, theme: null, stage: null, subStage: null };
    
    currentViewMode = 'grid';
    DOM.viewBtns.forEach(b => {
        if (b.dataset.view === 'grid') b.classList.add('active');
        else b.classList.remove('active');
    });

    executePipeline();
    pushCustomHistory();
}

function executePipeline() {
    const searchValue = DOM.search.value.trim();
    activeData = Engine.getFilteredData(searchValue);

    if (!searchValue) {
        drillState = { level: 0, theme: null, stage: null, subStage: null };
    } else if (activeData.length > 0) {
        drillState = Engine.determineRoutingContext(activeData);
    }

    if (activeData.length === 0) {
        DOM.noResults.classList.remove('hidden');
        DOM.grid.classList.add('hidden');
        DOM.pipeline.classList.add('hidden');
    } else {
        DOM.noResults.classList.add('hidden');
        renderSidebar(Engine.calculateFacets(activeData));
        renderDrillDownView();
    }
}

// ======== MODERN DROPDOWN RENDERER ========
function renderSidebar(facets) {
    DOM.facetsContainer.innerHTML = '';
    for (const [category, counts] of Object.entries(facets)) {
        if (Object.keys(counts).length === 0) continue;
        
        const sec = document.createElement('div');
        sec.className = 'filter-group';
        
        const currentSet = Engine.activeFilters[category];
        const currentVal = currentSet.size > 0 ? Array.from(currentSet)[0] : 'All';
        let displayValText = `All ${category}s`;

        let optionsHTML = `<div class="select-option ${currentVal === 'All' ? 'selected' : ''}" data-value="All">All ${category}s</div>`;
        
        Object.entries(counts).sort((a,b) => b[1]-a[1]).forEach(([val, count]) => {
            const isSelected = val === currentVal;
            if (isSelected) displayValText = `${val}`;
            optionsHTML += `<div class="select-option ${isSelected ? 'selected' : ''}" data-value="${val}">${val} <span class="opt-count">${count}</span></div>`;
        });

        sec.innerHTML = `
            <label>${category}</label>
            <div class="custom-select-wrapper dynamic-filter" data-cat="${category}">
                <div class="select-trigger">
                    <span class="trigger-text">${displayValText}</span>
                    <svg class="chevron" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
                <div class="select-options-container">
                    ${optionsHTML}
                </div>
            </div>
        `;
        DOM.facetsContainer.appendChild(sec);
    }

    attachDynamicFilterListeners();
}

function attachDynamicFilterListeners() {
    const dynamicWrappers = document.querySelectorAll('.dynamic-filter');
    
    dynamicWrappers.forEach(wrapper => {
        const trigger = wrapper.querySelector('.select-trigger');
        trigger.addEventListener('click', (e) => {
            e.stopPropagation();
            const wasOpen = wrapper.classList.contains('open');
            document.querySelectorAll('.custom-select-wrapper').forEach(w => w.classList.remove('open'));
            if (!wasOpen) wrapper.classList.add('open');
        });

        wrapper.querySelectorAll('.select-option').forEach(opt => {
            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                const cat = wrapper.dataset.cat;
                const val = e.currentTarget.dataset.value;
                
                Engine.activeFilters[cat].clear();
                if (val !== 'All') Engine.activeFilters[cat].add(val);
                
                wrapper.classList.remove('open');
                activeData = Engine.getFilteredData(DOM.search.value.trim());
                renderDrillDownView();
                
                pushCustomHistory(); 

                // Auto-close the sidebar on mobile so they can see results
                if (window.innerWidth <= 900) {
                    DOM.sidebar.classList.add('collapsed');
                }
            });
        });
    });
}

document.addEventListener('click', (e) => {
    // 1. Close custom dropdowns if clicking anywhere outside them
    document.querySelectorAll('.custom-select-wrapper').forEach(w => w.classList.remove('open'));

    // 2. Close sidebar on mobile if clicking outside of it
    if (window.innerWidth <= 900) {
        const sidebar = DOM.sidebar;
        const toggleBtn = DOM.sidebarToggle;
        
        // If the sidebar is open AND the click wasn't on the sidebar AND wasn't on the toggle button
        if (!sidebar.classList.contains('collapsed') && 
            !sidebar.contains(e.target) && 
            !toggleBtn.contains(e.target)) {
            
            sidebar.classList.add('collapsed');
        }
    }
});

function formatINR(number) {
    const val = Number(String(number || "0").replace(/[^0-9.-]+/g, ""));
    if (!val) return 'N/A';
    if (val >= 10000000) return `₹ ${(val / 10000000).toLocaleString('en-IN', { maximumFractionDigits: 2 })} Cr`;
    return `₹ ${val.toLocaleString('en-IN')}`;
}

// ======== DRILL-DOWN ROUTER ========
function renderDrillDownView() {
    const pipelineBtn = document.querySelector('.view-btn[data-view="pipeline"]');
    if (pipelineBtn) pipelineBtn.style.display = 'flex';

    DOM.grid.classList.add('hidden');
    DOM.pipeline.classList.add('hidden');
    renderBreadcrumbs();

    if (activeData.length === 0) return;

    if (currentViewMode === 'pipeline') {
        renderPipelineOverview();
    } else {
        DOM.grid.classList.remove('hidden');
        if (drillState.level === 0) renderLevel0_Themes();
        else if (drillState.level === 1) renderLevel1_Stages();
        else if (drillState.level === 2) renderLevel2_SubStages();
        else if (drillState.level === 3) renderLevel3_Stocks();
    }
}

function renderBreadcrumbs() {
    let html = `<span class="crumb ${drillState.level === 0 ? 'active' : ''}" onclick="goToLevel(0)">Market Universe</span>`;
    const displayTheme = drillState.theme === 'Any' ? 'All Themes' : drillState.theme;

    if (drillState.level >= 1) html += `<span class="crumb ${drillState.level === 1 ? 'active' : ''}" onclick="goToLevel(1)">${displayTheme}</span>`;
    if (drillState.level >= 2) html += `<span class="crumb ${drillState.level === 2 ? 'active' : ''}" onclick="goToLevel(2)">${drillState.stage}</span>`;
    if (drillState.level === 3) html += `<span class="crumb active">${drillState.subStage}</span>`;
    
    DOM.breadcrumbNav.innerHTML = html;
}

window.goToLevel = function(level) {
    drillState.level = level;
    if(level < 3) drillState.subStage = null;
    if(level < 2) drillState.stage = null;
    if(level < 1) drillState.theme = null;
    
    currentViewMode = 'grid';
    DOM.viewBtns.forEach(b => {
        if (b.dataset.view === 'grid') b.classList.add('active');
        else b.classList.remove('active');
    });

    pushCustomHistory(); 
    renderDrillDownView();
}

// ======== MULTI-LEVEL PIPELINE VIEW ========
function renderPipelineOverview() {
    DOM.pipeline.classList.remove('hidden');
    DOM.pageTitle.textContent = "Pipeline Overview";
    
    let dataToMap = activeData;
    let colField = '';
    let cardType = ''; 

    if (drillState.level === 0) {
        colField = 'Parent Theme';
        cardType = 'stage';
    } else if (drillState.level === 1) {
        dataToMap = dataToMap.filter(i => (i['Parent Theme'] || 'Uncategorized') === drillState.theme);
        colField = 'Supply Chain Stage';
        cardType = 'substage';
    } else if (drillState.level === 2) {
        dataToMap = dataToMap.filter(i => (i['Parent Theme'] || 'Uncategorized') === drillState.theme && (i['Supply Chain Stage'] || 'Uncategorized') === drillState.stage);
        colField = 'Sub-Stage';
        cardType = 'stock';
    } else if (drillState.level === 3) {
        dataToMap = dataToMap.filter(i => (i['Parent Theme'] || 'Uncategorized') === drillState.theme && (i['Supply Chain Stage'] || 'Uncategorized') === drillState.stage && (i['Sub-Stage'] || 'Uncategorized') === drillState.subStage);
        colField = 'Value Chain Direction';
        cardType = 'stock';
    }

    const pipelineMap = {};
    dataToMap.forEach(item => {
        const colKey = String(item[colField] || 'Uncategorized').trim();
        if (!pipelineMap[colKey]) pipelineMap[colKey] = { count: 0, cap: 0, items: {} };
        
        pipelineMap[colKey].count++;
        pipelineMap[colKey].cap += item._cap;
        
        if (cardType === 'stage') {
            const cKey = String(item['Supply Chain Stage'] || 'Uncategorized').trim();
            if (!pipelineMap[colKey].items[cKey]) pipelineMap[colKey].items[cKey] = { count: 0, cap: 0 };
            pipelineMap[colKey].items[cKey].count++;
            pipelineMap[colKey].items[cKey].cap += item._cap;
        } else if (cardType === 'substage') {
            const cKey = String(item['Sub-Stage'] || 'Core Operations').trim();
            if (!pipelineMap[colKey].items[cKey]) pipelineMap[colKey].items[cKey] = { count: 0, cap: 0 };
            pipelineMap[colKey].items[cKey].count++;
            pipelineMap[colKey].items[cKey].cap += item._cap;
        } else if (cardType === 'stock') {
            if (!Array.isArray(pipelineMap[colKey].items)) pipelineMap[colKey].items = [];
            pipelineMap[colKey].items.push(item);
        }
    });

    let orderedCols = Object.keys(pipelineMap);
    const cleanStr = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();

    if (colField === 'Supply Chain Stage') {
        orderedCols.sort((a,b) => {
            let idxA = STAGE_ORDER.indexOf(a); let idxB = STAGE_ORDER.indexOf(b); 
            if (idxA === -1) idxA = 999; if (idxB === -1) idxB = 999;
            return idxA - idxB; 
        });
    } else if (colField === 'Value Chain Direction') {
        orderedCols.sort((a, b) => {
            let idxA = VC_ORDER.findIndex(v => cleanStr(v) === cleanStr(a));
            let idxB = VC_ORDER.findIndex(v => cleanStr(v) === cleanStr(b));
            if (idxA === -1) idxA = 999;
            if (idxB === -1) idxB = 999;
            return idxA - idxB;
        });
    } else if (colField === 'Sub-Stage') {
        const getColRank = (colKey) => {
            let minRank = 999;
            if (Array.isArray(pipelineMap[colKey].items)) {
                pipelineMap[colKey].items.forEach(item => {
                    let rank = VC_ORDER.findIndex(v => cleanStr(v) === cleanStr(item['Value Chain Direction']));
                    if (rank !== -1 && rank < minRank) minRank = rank;
                });
            }
            return minRank;
        };

        orderedCols.sort((a, b) => {
            let rankA = getColRank(a);
            let rankB = getColRank(b);
            if (rankA !== rankB) return rankA - rankB;
            return pipelineMap[b].cap - pipelineMap[a].cap; 
        });
    } else {
        orderedCols.sort((a,b) => pipelineMap[b].cap - pipelineMap[a].cap);
    }

    DOM.resultCount.textContent = `Mapping ${dataToMap.length} assets across ${orderedCols.length} ${colField}s.`;

    DOM.pipeline.innerHTML = orderedCols.map((col, idx) => {
        const colData = pipelineMap[col];
        let cardsHtml = '';

        if (cardType === 'stage' || cardType === 'substage') {
            const cardKeys = Object.keys(colData.items).sort((a,b) => colData.items[b].cap - colData.items[a].cap);
            cardsHtml = cardKeys.map(cKey => {
                const cData = colData.items[cKey];
                let clickHandler = '';
                
                if (cardType === 'stage') clickHandler = `goToPipelineLevel(2, '${encodeURIComponent(col)}', '${encodeURIComponent(cKey)}')`;
                else if (cardType === 'substage') clickHandler = `goToPipelineLevel(3, '${encodeURIComponent(drillState.theme)}', '${encodeURIComponent(col)}', '${encodeURIComponent(cKey)}')`;
                
                return `
                <div class="sub-card" onclick="${clickHandler}">
                    <div class="sub-title">${cKey}</div>
                    <div class="sub-stats">
                        <span>${cData.count} Entities</span>
                        <span style="color:var(--accent-purple); font-weight:600;">${formatINR(cData.cap)}</span>
                    </div>
                </div>`;
            }).join('');
        } else if (cardType === 'stock') {
            const stocks = colData.items.sort((a,b) => b._cap - a._cap);
            
            cardsHtml = stocks.map(item => `
                <div class="pipe-card" data-model="${item['Business Model'] || 'General'}" onclick="window.openDrawerByIndex(${Engine.rawData.indexOf(item)})">
                    <div class="pipe-title-row">
                        <span class="pipe-title">${item['Company Name']}</span>
                        <span class="pipe-ticker">${item['Stock Symbol'] || 'N/A'}</span>
                    </div>
                    <div class="pipe-cap">${formatINR(item['Market Cap (INR)'])}</div>
                    <div class="pipe-meta-row">
                        <span class="pipe-tag">${item['Business Model'] || '-'}</span>
                        <span class="pipe-tag">${item['Asset Type'] || '-'}</span>
                    </div>
                </div>
            `).join('');
        }

        let headerClick = '';
        if (drillState.level === 0) headerClick = `goToPipelineLevel(1, '${encodeURIComponent(col)}')`;
        else if (drillState.level === 1) headerClick = `goToPipelineLevel(2, '${encodeURIComponent(drillState.theme)}', '${encodeURIComponent(col)}')`;
        else if (drillState.level === 2) headerClick = `goToPipelineLevel(3, '${encodeURIComponent(drillState.theme)}', '${encodeURIComponent(drillState.stage)}', '${encodeURIComponent(col)}')`;

        return `
        <div class="pipeline-col" style="animation-delay: ${idx * 0.05}s">
            <div class="col-header interactive-header" onclick="${headerClick}" title="Drill down into ${col}">
                <h3>${col}</h3>
                <span class="col-count">${colData.count}</span>
            </div>
            <div class="col-cap">Total Value: ${formatINR(colData.cap)}</div>
            <div class="col-cards">
                ${cardsHtml}
            </div>
        </div>`;
    }).join('');
}

window.goToPipelineLevel = function(level, themeEncoded=null, stageEncoded=null, subStageEncoded=null) {
    drillState.level = level;
    if(themeEncoded) drillState.theme = decodeURIComponent(themeEncoded);
    if(stageEncoded) drillState.stage = decodeURIComponent(stageEncoded);
    if(subStageEncoded) drillState.subStage = decodeURIComponent(subStageEncoded);
    
    currentViewMode = 'pipeline';
    pushCustomHistory(); 
    renderDrillDownView();
}

// ======== GRID VIEWS ========
function renderLevel0_Themes() {
    DOM.pageTitle.textContent = "Explore by Theme";
    const grouped = {};
    activeData.forEach(item => {
        const key = String(item['Parent Theme'] || 'Uncategorized').trim();
        if (!grouped[key]) grouped[key] = { count: 0, cap: 0 };
        grouped[key].count++;
        grouped[key].cap += item._cap;
    });

    DOM.resultCount.textContent = `${Object.keys(grouped).length} Themes matching criteria.`;
    DOM.grid.innerHTML = Object.entries(grouped).sort((a,b) => b[1].cap - a[1].cap).map(([key, data], idx) => {
        return `
        <div class="node-card" onclick="gridDrillDown(1, '${encodeURIComponent(key)}')" style="animation-delay: ${idx * 0.05}s">
            <h3 class="node-title">${key}</h3>
            <div class="node-stats">
                <div class="n-stat"><span class="n-lbl">Entities</span><span class="n-val">${data.count}</span></div>
                <div class="n-stat"><span class="n-lbl">Total Value</span><span class="n-val highlight">${formatINR(data.cap)}</span></div>
            </div>
        </div>`;
    }).join('');
}

function renderLevel1_Stages() {
    DOM.pageTitle.textContent = "Supply Chain Stages";
    const subset = activeData.filter(i => String(i['Parent Theme'] || 'Uncategorized').trim() === drillState.theme);
    const grouped = {};
    
    subset.forEach(item => {
        const key = String(item['Supply Chain Stage'] || 'Uncategorized').trim();
        if (!grouped[key]) grouped[key] = { count: 0, cap: 0 };
        grouped[key].count++;
        grouped[key].cap += item._cap;
    });

    DOM.resultCount.textContent = `Analyzing ${subset.length} assets across ${Object.keys(grouped).length} stages in ${drillState.theme}.`;

    DOM.grid.innerHTML = Object.entries(grouped).sort((a,b) => {
        let idxA = STAGE_ORDER.indexOf(a[0]);
        let idxB = STAGE_ORDER.indexOf(b[0]);
        
        if (idxA === -1) idxA = 999;
        if (idxB === -1) idxB = 999;
        
        if (idxA !== idxB) return idxA - idxB;
        return b[1].cap - a[1].cap; 
    }).map(([key, data], idx) => {
        return `
        <div class="node-card" onclick="gridDrillDown(2, '${encodeURIComponent(key)}')" style="animation-delay: ${idx * 0.05}s">
            <h3 class="node-title">${key}</h3>
            <div class="node-stats">
                <div class="n-stat"><span class="n-lbl">Entities</span><span class="n-val">${data.count}</span></div>
                <div class="n-stat"><span class="n-lbl">Total Value</span><span class="n-val highlight">${formatINR(data.cap)}</span></div>
            </div>
        </div>`;
    }).join('');
}

function renderLevel2_SubStages() {
    DOM.pageTitle.textContent = "Sub-Stage Analysis";
    const subset = activeData.filter(i => String(i['Parent Theme'] || 'Uncategorized').trim() === drillState.theme && String(i['Supply Chain Stage'] || 'Uncategorized').trim() === drillState.stage);
    const grouped = {};
    
    subset.forEach(item => {
        const key = String(item['Sub-Stage'] || 'Core Processing').trim();
        if (!grouped[key]) grouped[key] = { count: 0, cap: 0, items: [] };
        grouped[key].count++;
        grouped[key].cap += item._cap;
        grouped[key].items.push(item);
    });

    const cleanStr = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();

    const getRank = (items) => {
        let minRank = 999;
        items.forEach(item => {
            let rank = VC_ORDER.findIndex(v => cleanStr(v) === cleanStr(item['Value Chain Direction']));
            if (rank !== -1 && rank < minRank) minRank = rank;
        });
        return minRank;
    };

    DOM.resultCount.textContent = `Analyzing ${subset.length} assets in ${drillState.stage}.`;
    
    DOM.grid.innerHTML = Object.entries(grouped).sort((a,b) => {
        let rankA = getRank(a[1].items);
        let rankB = getRank(b[1].items);

        if (rankA !== rankB) return rankA - rankB;
        return b[1].cap - a[1].cap; 
    }).map(([key, data], idx) => {
        return `
        <div class="node-card" onclick="gridDrillDown(3, '${encodeURIComponent(key)}')" style="animation-delay: ${idx * 0.05}s">
            <h3 class="node-title">${key}</h3>
            <div class="node-stats">
                <div class="n-stat"><span class="n-lbl">Entities</span><span class="n-val">${data.count}</span></div>
                <div class="n-stat"><span class="n-lbl">Total Value</span><span class="n-val highlight">${formatINR(data.cap)}</span></div>
            </div>
        </div>`;
    }).join('');
}

function renderLevel3_Stocks() {
    DOM.pageTitle.textContent = "Identified Equities";
    
    let subset = activeData.filter(i => 
        String(i['Parent Theme'] || 'Uncategorized').trim() === drillState.theme && 
        String(i['Supply Chain Stage'] || 'Uncategorized').trim() === drillState.stage &&
        String(i['Sub-Stage'] || 'Core Processing').trim() === drillState.subStage
    );

    subset.sort((a, b) => b._cap - a._cap); 

    DOM.resultCount.textContent = `Showing ${subset.length} companies operating in ${drillState.subStage}.`;

    DOM.grid.innerHTML = subset.map((item, idx) => {
        let tag = item['Specific Products'] || item['Specific Services'] || 'Diversified Operations';
        if(tag.length > 70) tag = tag.substring(0, 70) + '...';
        
        return `
        <div class="stock-card" onclick="window.openDrawerByIndex(${Engine.rawData.indexOf(item)})" style="animation-delay: ${idx * 0.03}s">
            <div class="stock-header">
                <div class="stock-title">${item['Company Name']}</div>
                <div class="stock-ticker">${item['Stock Symbol'] || 'N/A'}</div>
            </div>
            <div class="stock-tagline" style="margin-top: 8px;">${tag}</div>
            <div class="stock-bottom">
                <div class="n-stat"><span class="n-lbl">Sector</span><span class="n-val" style="font-size: 0.85rem;">${item['Sector'] || '-'}</span></div>
                <div class="n-stat" style="align-items: flex-end;"><span class="n-lbl">Market Cap</span><span class="n-val highlight">${formatINR(item['Market Cap (INR)'])}</span></div>
            </div>
        </div>`;
    }).join('');
}

window.gridDrillDown = function(level, encodedKey) {
    const key = decodeURIComponent(encodedKey);
    if (level === 1) drillState.theme = key;
    if (level === 2) drillState.stage = key;
    if (level === 3) drillState.subStage = key;
    drillState.level = level;
    
    currentViewMode = 'grid';
    DOM.viewBtns.forEach(b => {
        if (b.dataset.view === 'grid') b.classList.add('active');
        else b.classList.remove('active');
    });

    pushCustomHistory(); 
    renderDrillDownView();
}

// ======== LEVEL 4: DETAIL DRAWER ========
window.openDrawerByIndex = function(index) {
    const item = Engine.rawData[index];
    if (!item) return;
    
    document.getElementById('drawerName').textContent = item['Company Name'];
    document.getElementById('drawerSymbol').textContent = item['Stock Symbol'] || 'N/A';
    document.getElementById('drawerCap').textContent = formatINR(item['Market Cap (INR)']);
    
    const fields = ['Business Model', 'Value Chain Direction', 'Revenue Dependency Mapping (%)', 'Asset Type', 'Geographical Exposure', 'Customer Type'];
    document.getElementById('drawerMetaGrid').innerHTML = fields.map(f => {
        let displayValue = item[f] || '-';
        if (f === 'Revenue Dependency Mapping (%)' && displayValue.includes('|')) {
            displayValue = displayValue.split('|').map(str => `<span style="display: block; padding-top: 4px;">${str.trim()}</span>`).join('');
        }
        return `
        <div class="meta-item">
            <span class="meta-label">${f.replace('Mapping (%)', '(%)')}</span>
            <span class="meta-value">${displayValue}</span>
        </div>`;
    }).join('');

    const createList = (str) => { 
        if (!str || !str.trim()) return `<p class="empty-read">Data unavailable.</p>`; 
        return `<ul class="smart-list">${str.split(',').map(i => `<li>${i.trim()}</li>`).join('')}</ul>`; 
    };

    document.getElementById('drawerProducts').innerHTML = createList(item['Specific Products']);
    document.getElementById('drawerServices').innerHTML = createList(item['Specific Services']);
    document.getElementById('drawerCapacity').textContent = item['Operational Capacity'] || 'Data unavailable.';

    const tagsDiv = document.getElementById('drawerTags');
    if (tagsDiv) {
        tagsDiv.innerHTML = '';
        if (item['Search Tags / Aliases']) {
            item['Search Tags / Aliases'].split(',').forEach(t => { 
                if(t.trim()) tagsDiv.innerHTML += `<span class="tag-pill">${t.trim()}</span>`; 
            });
        } else {
            tagsDiv.innerHTML = '<span class="empty-read">No aliases bound.</span>';
        }
    }

    DOM.drawer.classList.remove('hidden');
};

// ======== CUSTOM TRACKPAD HISTORY ENGINE ========
let customHistory = [];
let historyIdx = -1;
let swipeCooldown = false;

function pushCustomHistory() {
    if (historyIdx < customHistory.length - 1) {
        customHistory = customHistory.slice(0, historyIdx + 1);
    }
    
    customHistory.push({
        drillState: JSON.parse(JSON.stringify(drillState)),
        viewMode: currentViewMode
    });
    historyIdx++;
}

function navigateCustomHistory(direction) {
    if (direction === -1 && historyIdx > 0) {
        historyIdx--; // Go Back
    } else if (direction === 1 && historyIdx < customHistory.length - 1) {
        historyIdx++; // Go Forward
    } else {
        return; 
    }

    const state = customHistory[historyIdx];
    drillState = JSON.parse(JSON.stringify(state.drillState));
    currentViewMode = state.viewMode;
    
    DOM.viewBtns.forEach(b => {
        if (b.dataset.view === currentViewMode) b.classList.add('active');
        else b.classList.remove('active');
    });
    
    DOM.drawer.classList.add('hidden'); 
    renderDrillDownView();              
}

window.addEventListener('wheel', (e) => {
    if (e.target.closest('.pipeline') || e.target.closest('.sidebar') || e.target.closest('.drawer')) return;

    if (Math.abs(e.deltaX) > 40 && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();

        if (swipeCooldown) return; 

        if (e.deltaX < 0) {
            navigateCustomHistory(-1); 
            triggerSwipeCooldown();
        } else if (e.deltaX > 0) {
            navigateCustomHistory(1);  
            triggerSwipeCooldown();
        }
    }
}, { passive: false }); 

function triggerSwipeCooldown() {
    swipeCooldown = true;
    setTimeout(() => { swipeCooldown = false; }, 600); 
}

// ======== NATIVE MOBILE SWIPE-TO-CLOSE ========
function setupMobileDrawerSwipe() {
    const drawerEl = document.getElementById('detailDrawer');
    if (!drawerEl) return; // Null safety check

    let startY = 0;
    let currentY = 0;
    let isDragging = false;

    drawerEl.addEventListener('touchstart', (e) => {
        // Only apply on mobile devices
        if (window.innerWidth > 768) return;
        
        // Only allow dragging if the user is at the very top of the drawer's content
        if (drawerEl.scrollTop <= 0) {
            startY = e.touches[0].clientY;
            isDragging = true;
            drawerEl.style.transition = 'none'; // Remove CSS transition for a 1:1 finger drag feel
        }
    }, { passive: true });

    drawerEl.addEventListener('touchmove', (e) => {
        if (!isDragging) return;
        
        currentY = e.touches[0].clientY;
        const deltaY = currentY - startY;

        // If dragging downwards
        if (deltaY > 0) {
            if (e.cancelable) e.preventDefault(); // Prevents the browser's native "pull-to-refresh"
            drawerEl.style.transform = `translateY(${deltaY}px)`;
        }
    }, { passive: false });

    drawerEl.addEventListener('touchend', () => {
        if (!isDragging) return;
        isDragging = false;
        
        drawerEl.style.transition = ''; // Restore the smooth CSS animation
        
        const deltaY = currentY - startY;
        
        // If they dragged it down more than 120 pixels, snap it closed
        if (deltaY > 120) {
            DOM.drawer.classList.add('hidden');
            
            // Clean up the inline transform after the close animation finishes
            setTimeout(() => { drawerEl.style.transform = ''; }, 400);
        } else {
            // Otherwise, snap it back to the top
            drawerEl.style.transform = '';
        }
        
        // Reset variables for the next swipe
        startY = 0;
        currentY = 0;
    });
}

// ======== p5.js Enhanced Constellation Background ========
let particles = [];
function setup() {
    let cvs = createCanvas(windowWidth, windowHeight);
    cvs.parent('p5-canvas-container');
    
    // Optimization: Limit framerate and particle count severely on mobile to save battery
    if (windowWidth < 768) {
        frameRate(30);
        let pCount = 30; 
        for (let i = 0; i < pCount; i++) particles.push(new Particle());
    } else {
        let pCount = 350; 
        for (let i = 0; i < pCount; i++) particles.push(new Particle());
    }
}

function draw() { 
    clear(); 
    // Optimization: Standard loop for index checking
    for (let i = 0; i < particles.length; i++) {
        particles[i].update();
        particles[i].display();
        particles[i].check(particles, i);
    }
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); }

class Particle {
    constructor() { 
        this.pos = createVector(random(width), random(height)); 
        this.vel = p5.Vector.random2D().mult(random(0.05, 0.25)); 
        this.baseSize = random(1.0, 4.0); 
        this.offset = random(1000); 
        this.isNode = this.baseSize > 2.4; 
    }
    
    update() {
        this.pos.add(this.vel);
        if (this.pos.x < -50) this.pos.x = width + 50; 
        if (this.pos.x > width + 50) this.pos.x = -50;
        if (this.pos.y < -50) this.pos.y = height + 50; 
        if (this.pos.y > height + 50) this.pos.y = -50;
    }
    
    display() { 
        noStroke(); 
        let pulse = sin(frameCount * 0.02 + this.offset) * 0.5 + 0.5; 
        let maxAlpha = this.isNode ? 0.7 : 0.3;
        let alpha = 0.1 + (pulse * maxAlpha);
        
        fill(`rgba(168, 85, 247, ${alpha})`);
        circle(this.pos.x, this.pos.y, this.baseSize); 
    }
    
    // Optimization: Only check stars forward in the array to prevent drawing duplicate lines
    check(others, myIndex) {
        if (!this.isNode) return;

        for (let j = myIndex + 1; j < others.length; j++) {
            let o = others[j];
            if (o.isNode) {
                let d = dist(this.pos.x, this.pos.y, o.pos.x, o.pos.y);
                let max = 170; 
                if (d < max) { 
                    stroke(`rgba(168, 85, 247, ${map(d, 0, max, 0.4, 0)})`); 
                    strokeWeight(0.6); 
                    line(this.pos.x, this.pos.y, o.pos.x, o.pos.y); 
                }
            }
        }
    }
}

document.addEventListener('DOMContentLoaded', init);
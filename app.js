/* * MarketNexus - Value Chain Explorer
 * Features: High-Performance Simple Search, Clean State Routing, Pre-Computed Aggregations.
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

let tiltScale = 0.9;
let currentViewMode = 'grid'; 

let drillState = {
    level: 0, 
    theme: null,
    stage: null,
    subStage: null
};

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
    sort: document.getElementById('sortSelect'),
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
    DOM.grid.classList.remove('hidden');

    Papa.parse(API_URL, {
        download: true, header: true, skipEmptyLines: true,
        complete: (res) => {
            Engine.loadData(res.data.filter(i => i['Company Name']));
            executePipeline();
            DOM.loader.classList.add('hidden');
        },
        error: () => {
            DOM.loader.classList.add('hidden');
            DOM.noResults.classList.remove('hidden');
            DOM.noResults.querySelector('h2').textContent = 'Failed to load data';
            DOM.noResults.querySelector('p').textContent = 'Please check your network or CSV sheet URL.';
        }
    });

    DOM.search.addEventListener('input', () => {
        drillState = { level: 0, theme: null, stage: null, subStage: null };
        executePipeline();
    });
    
    DOM.sort.addEventListener('change', () => renderDrillDownView()); 
    document.getElementById('resetFilters').addEventListener('click', resetAllFeatures);
    DOM.brandLogo.addEventListener('click', resetAllFeatures);

    DOM.sidebarToggle.addEventListener('click', () => DOM.sidebar.classList.toggle('collapsed'));
    document.getElementById('closeDrawer').addEventListener('click', () => DOM.drawer.classList.add('hidden'));

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
    DOM.sort.value = 'cap-desc';
    drillState = { level: 0, theme: null, stage: null, subStage: null };
    
    currentViewMode = 'grid';
    DOM.viewBtns.forEach(b => {
        if (b.dataset.view === 'grid') b.classList.add('active');
        else b.classList.remove('active');
    });

    executePipeline();
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

function renderSidebar(facets) {
    DOM.facetsContainer.innerHTML = '';
    for (const [category, counts] of Object.entries(facets)) {
        if (Object.keys(counts).length === 0) continue;
        
        const sec = document.createElement('div');
        sec.className = 'filter-group';
        
        const currentSet = Engine.activeFilters[category];
        const currentVal = currentSet.size > 0 ? Array.from(currentSet)[0] : 'All';

        let optionsHTML = `<option value="All">All ${category}s</option>`;
        
        Object.entries(counts).sort((a,b) => b[1]-a[1]).forEach(([val, count]) => {
            const isSelected = val === currentVal ? 'selected' : '';
            optionsHTML += `<option value="${val}" ${isSelected}>${val} (${count})</option>`;
        });

        sec.innerHTML = `<label>${category}</label><select class="dropdown dynamic-select" data-cat="${category}">${optionsHTML}</select>`;
        DOM.facetsContainer.appendChild(sec);
    }

    DOM.facetsContainer.querySelectorAll('.dynamic-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const cat = e.target.dataset.cat;
            const val = e.target.value;
            Engine.activeFilters[cat].clear();
            if (val !== 'All') Engine.activeFilters[cat].add(val);
            
            activeData = Engine.getFilteredData(DOM.search.value.trim());
            renderDrillDownView();
        });
    });
}

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
    
    setTimeout(init3DTilt, 100);
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
    
    // Helper to clean strings for accurate matching
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
        // NEW LOGIC: Sort Sub-Stage columns by the Value Chain Direction of their items
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
            
            // Primary Sort: Value Chain Direction (Upstream -> Downstream)
            if (rankA !== rankB) return rankA - rankB;
            
            // Secondary Sort: Fallback to Market Cap if they share the same VC rank
            return pipelineMap[b].cap - pipelineMap[a].cap; 
        });
    } else {
        // Fallback for Parent Themes
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
            const sortVal = DOM.sort.value;
            const stocks = colData.items.sort((a,b) => {
                if (sortVal === 'cap-desc') return b._cap - a._cap;
                if (sortVal === 'cap-asc') return a._cap - b._cap;
                if (sortVal === 'name-asc') return String(a['Company Name']).localeCompare(String(b['Company Name']));
                return b._cap - a._cap;
            });
            
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
        const clean = (v) => String(v || '').toLowerCase().replace(/\s+/g, ' ').trim();
        let idxA = VC_ORDER.findIndex(v => clean(v) === clean(a[0]));
        let idxB = VC_ORDER.findIndex(v => clean(v) === clean(b[0]));
        
        if (idxA === -1) idxA = 999;
        if (idxB === -1) idxB = 999;
        
        if (idxA !== idxB) return idxA - idxB;
        return b[1].cap - a[1].cap; // Fallback to Market Cap if they share the same stage
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
        if (!grouped[key]) grouped[key] = { count: 0, cap: 0 };
        grouped[key].count++;
        grouped[key].cap += item._cap;
    });

    DOM.resultCount.textContent = `Analyzing ${subset.length} assets in ${drillState.stage}.`;
    DOM.grid.innerHTML = Object.entries(grouped).sort((a,b) => b[1].cap - a[1].cap).map(([key, data], idx) => {
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

    const sortVal = DOM.sort.value;
    subset.sort((a, b) => {
        if (sortVal === 'cap-desc') return b._cap - a._cap;
        if (sortVal === 'cap-asc') return a._cap - b._cap;
        if (sortVal === 'name-asc') return String(a['Company Name']).localeCompare(String(b['Company Name']));
        return b._cap - a._cap;
    });

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

    renderDrillDownView();
}

// ======== LEVEL 4: DETAIL DRAWER (FIXED) ========

window.openDrawerByIndex = function(index) {
    const item = Engine.rawData[index];
    if (!item) return;
    
    document.getElementById('drawerName').textContent = item['Company Name'];
    document.getElementById('drawerSymbol').textContent = item['Stock Symbol'] || 'N/A';
    document.getElementById('drawerCap').textContent = formatINR(item['Market Cap (INR)']);
    
    const fields = ['Business Model', 'Value Chain Direction', 'Revenue Dependency Mapping (%)', 'Asset Type', 'Geographical Exposure', 'Customer Type'];
    document.getElementById('drawerMetaGrid').innerHTML = fields.map(f => {
        let displayValue = item[f] || '-';
        // FIX: Remove pipe '|' and start new line for each mapped item
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

function init3DTilt() {
    }
    

// p5.js Enhanced Constellation Background
let particles = [];
function setup() {
    let cvs = createCanvas(windowWidth, windowHeight);
    cvs.parent('p5-canvas-container');
    // Dramatically increase particle count
    let pCount = windowWidth < 768 ? 50 : 150; 
    for (let i = 0; i < pCount; i++) particles.push(new Particle());
}

function draw() { 
    clear(); 
    particles.forEach(p => { p.update(); p.display(); p.check(particles); }); 
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); }

class Particle {
    constructor() { 
        this.pos = createVector(random(width), random(height)); 
        // Use random2D to give them true random directions, slightly faster
        this.vel = p5.Vector.random2D().mult(random(0.1, 0.4)); 
        this.baseSize = random(1.5, 3.5); 
        this.offset = random(1000); 
    }
    
    update() {
        this.pos.add(this.vel);
        // Wrap around screen edges smoothly
        if (this.pos.x < -50) this.pos.x = width + 50; 
        if (this.pos.x > width + 50) this.pos.x = -50;
        if (this.pos.y < -50) this.pos.y = height + 50; 
        if (this.pos.y > height + 50) this.pos.y = -50;
    }
    
    display() { 
        noStroke(); 
        // Twinkling effect
        let pulse = sin(frameCount * 0.02 + this.offset) * 0.5 + 0.5; 
        let alpha = 0.15 + (pulse * 0.35);
        fill(`rgba(168, 85, 247, ${alpha})`);
        circle(this.pos.x, this.pos.y, this.baseSize); 
    }
    
    check(others) {
        others.forEach(o => {
            if (this !== o) {
                let d = dist(this.pos.x, this.pos.y, o.pos.x, o.pos.y);
                let max = 120; // Distance at which they connect
                if (d < max) { 
                    // Fade lines out as they get further apart
                    stroke(`rgba(168, 85, 247, ${map(d, 0, max, 0.25, 0)})`); 
                    strokeWeight(0.5); 
                    line(this.pos.x, this.pos.y, o.pos.x, o.pos.y); 
                }
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', init);
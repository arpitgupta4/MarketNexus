/* * MarketNexus - Value Chain Explorer
 * Features: Dynamic Multi-Level Pipeline, Breadcrumbs, Dropdown Filters.
 */

const API_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRqVXr4sXzLjAkI3Y-EranuAYbVJKAmgdEebtnaaUOx1czymzNVf8liZOu4KwJFPDBJYHcKU1MBg0oT/pub?gid=236349063&single=true&output=csv';

const SYNONYMS = {
    'defence': ['defense', 'military', 'aerospace'],
    'energy': ['power', 'renewable', 'solar', 'wind'],
    'ev': ['electric vehicle', 'electric vehicles', 'automotive'],
    'banking': ['finance', 'financial', 'fintech'],
    'ai': ['artificial intelligence', 'machine learning', 'ml']
};

const STAGE_ORDER = [
    "Raw Material Extraction", "Processing & Refining", "Component Manufacturing",
    "Assembly / OEM", "Software & Integration", "Distribution & Logistics",
    "Service Provider", "End Consumer"
];

let tiltScale = 0.9;
let currentViewMode = 'grid'; // 'grid' | 'pipeline'

// Drill-Down State Machine
let drillState = {
    level: 0, // 0: Themes, 1: Stages, 2: Sub-Stages, 3: Stocks
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

    loadData(data) { this.rawData = data; }

    tokenize(query) {
        if (!query) return [];
        return query.toLowerCase().replace(/[.,;:\/\\]/g, ' ').split(/\s+/).filter(t => t);
    }

    expandTokens(tokens) {
        const expanded = new Set(tokens);
        tokens.forEach(tok => {
            for (const [key, syns] of Object.entries(SYNONYMS)) {
                if (tok === key || syns.includes(tok)) {
                    expanded.add(key);
                    syns.forEach(s => expanded.add(s));
                }
            }
        });
        return Array.from(expanded);
    }

    resolveTheme(searchTerm) {
        if (!searchTerm || !searchTerm.trim()) return null;
        const tokens = this.expandTokens(this.tokenize(searchTerm));
        const themeScores = {};

        this.rawData.forEach(item => {
            const theme = String(item['Parent Theme'] || 'Uncategorized').trim();
            const tags = String(item['Search Tags / Aliases'] || '').toLowerCase();
            const combined = `${theme.toLowerCase()} ${tags}`;

            tokens.forEach(token => {
                if (combined.includes(token)) {
                    themeScores[theme] = (themeScores[theme] || 0) + (theme.toLowerCase() === token ? 3 : 1);
                }
            });
        });

        const sorted = Object.entries(themeScores).sort((a, b) => b[1] - a[1]);
        if (sorted.length === 0) return { theme: null, score: 0 };
        return { theme: sorted[0][0], score: sorted[0][1] };
    }

    getFilteredData(searchTerm) {
        let tokens = this.tokenize(searchTerm);
        if (tokens.length > 0) tokens = this.expandTokens(tokens);
        const resolved = this.resolveTheme(searchTerm);
        const bestTheme = resolved ? resolved.theme : null;

        return this.rawData.filter(item => {
            for (const [key, activeSet] of Object.entries(this.activeFilters)) {
                if (activeSet.size > 0) {
                    const itemVal = this.normalizeFacetValue(item, key);
                    if (!activeSet.has(itemVal)) return false;
                }
            }

            if (tokens.length > 0) {
                const theme = String(item['Parent Theme'] || 'Uncategorized').trim();
                if (bestTheme && theme === bestTheme) return true;

                const searchString = [
                    item['Company Name'], item['Stock Symbol'], 
                    item['Search Tags / Aliases'], item['Parent Theme'],
                    item['Sector'], item['Industry'], item['Supply Chain Stage'], item['Sub-Stage']
                ].join(" ").toLowerCase();

                const allTokensMatch = tokens.every(token => searchString.includes(token));
                if (allTokensMatch) return true;

                return tokens.some(token => {
                    return theme.toLowerCase().includes(token)
                        || String(item['Search Tags / Aliases'] || '').toLowerCase().includes(token);
                });
            }
            
            return true;
        });
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
        if (DOM.search.value.trim().length > 0 && drillState.level > 0) {
            drillState = { level: 0, theme: null, stage: null, subStage: null };
        }
        executePipeline();
    });
    
    DOM.sort.addEventListener('change', () => executePipeline());
    
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
    const resolved = Engine.resolveTheme(searchValue);

    activeData = Engine.getFilteredData(searchValue);

    const threshold = 5;
    if (searchValue && resolved && resolved.theme && resolved.score >= threshold && drillState.level === 0) {
        drillState = { level: 1, theme: resolved.theme, stage: null, subStage: null };
    } else if (!searchValue) {
        drillState = { level: 0, theme: null, stage: null, subStage: null };
    }

    DOM.noResults.classList.toggle('hidden', activeData.length > 0);
    renderSidebar(Engine.calculateFacets(activeData));
    renderDrillDownView();
}

// ======== SIDEBAR (DROPDOWNS) ========
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

        sec.innerHTML = `
            <label>${category}</label>
            <select class="dropdown dynamic-select" data-cat="${category}">
                ${optionsHTML}
            </select>
        `;
        DOM.facetsContainer.appendChild(sec);
    }

    DOM.facetsContainer.querySelectorAll('.dynamic-select').forEach(select => {
        select.addEventListener('change', (e) => {
            const cat = e.target.dataset.cat;
            const val = e.target.value;
            Engine.activeFilters[cat].clear();
            if (val !== 'All') {
                Engine.activeFilters[cat].add(val);
            }
            executePipeline();
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
    DOM.grid.classList.add('hidden');
    DOM.pipeline.classList.add('hidden');
    renderBreadcrumbs();

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
    renderDrillDownView();
}

// ======== MULTI-LEVEL KANBAN PIPELINE VIEW ========
function renderPipelineOverview() {
    DOM.pipeline.classList.remove('hidden');
    DOM.pageTitle.textContent = "Pipeline Explorer";
    
    let dataToMap = activeData;
    let colField = '';
    let cardType = ''; 

    // Determine Pipeline Context based on Drill State
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
        colField = 'Business Model';
        cardType = 'stock';
    }

    const pipelineMap = {};
    dataToMap.forEach(item => {
        const colKey = item[colField] || 'Uncategorized';
        if (!pipelineMap[colKey]) pipelineMap[colKey] = { count: 0, cap: 0, items: {} };
        
        pipelineMap[colKey].count++;
        pipelineMap[colKey].cap += (Number(String(item['Market Cap (INR)']||0).replace(/[^0-9.-]+/g,""))||0);
        
        if (cardType === 'stage') {
            const cKey = item['Supply Chain Stage'] || 'Uncategorized';
            if (!pipelineMap[colKey].items[cKey]) pipelineMap[colKey].items[cKey] = { count: 0, cap: 0 };
            pipelineMap[colKey].items[cKey].count++;
            pipelineMap[colKey].items[cKey].cap += (Number(String(item['Market Cap (INR)']||0).replace(/[^0-9.-]+/g,""))||0);
        } else if (cardType === 'substage') {
            const cKey = item['Sub-Stage'] || 'Core Operations';
            if (!pipelineMap[colKey].items[cKey]) pipelineMap[colKey].items[cKey] = { count: 0, cap: 0 };
            pipelineMap[colKey].items[cKey].count++;
            pipelineMap[colKey].items[cKey].cap += (Number(String(item['Market Cap (INR)']||0).replace(/[^0-9.-]+/g,""))||0);
        } else if (cardType === 'stock') {
            if (!Array.isArray(pipelineMap[colKey].items)) pipelineMap[colKey].items = [];
            pipelineMap[colKey].items.push(item);
        }
    });

    let orderedCols = Object.keys(pipelineMap);
    if (colField === 'Supply Chain Stage') {
        orderedCols.sort((a,b) => {
            let idxA = STAGE_ORDER.indexOf(a); let idxB = STAGE_ORDER.indexOf(b); 
            return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB); 
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
                if (cardType === 'stage') clickHandler = `goToPipelineLevel(2, '${col}', '${cKey}')`;
                else if (cardType === 'substage') clickHandler = `goToPipelineLevel(3, '${drillState.theme}', '${col}', '${cKey}')`;
                
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
            const stocks = colData.items.sort((a,b) => (Number(String(b['Market Cap (INR)']||0).replace(/[^0-9.-]+/g,""))||0) - (Number(String(a['Market Cap (INR)']||0).replace(/[^0-9.-]+/g,""))||0));
            cardsHtml = stocks.map(item => `
                <div class="pipe-card" data-model="${item['Business Model'] || 'General'}" onclick="openDrawer('${item['Stock Symbol']}')">
                    <div class="pipe-top">
                        <div class="pipe-title-row" style="display:flex; justify-content:space-between; width:100%; gap: 10px;">
                            <span class="pipe-title">${item['Company Name']}</span>
                            <span class="pipe-ticker">${item['Stock Symbol'] || 'N/A'}</span>
                        </div>
                    </div>
                    <div class="pipe-cap">${formatINR(item['Market Cap (INR)'])}</div>
                    <div class="pipe-meta-row">
                        <span class="pipe-tag">${item['Business Model'] || '-'}</span>
                        <span class="pipe-tag">${item['Asset Type'] || '-'}</span>
                    </div>
                </div>
            `).join('');
        }

        // Logic for clicking the column header
        let headerClick = '';
        if (drillState.level === 0) headerClick = `goToPipelineLevel(1, '${col}')`;
        else if (drillState.level === 1) headerClick = `goToPipelineLevel(2, '${drillState.theme}', '${col}')`;
        else if (drillState.level === 2) headerClick = `goToPipelineLevel(3, '${drillState.theme}', '${drillState.stage}', '${col}')`;

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

window.goToPipelineLevel = function(level, theme=null, stage=null, subStage=null) {
    drillState.level = level;
    if(theme) drillState.theme = theme;
    if(stage) drillState.stage = stage;
    if(subStage) drillState.subStage = subStage;
    
    currentViewMode = 'pipeline';
    renderDrillDownView();
}


// ======== LEVEL 0: THEMES ========
function renderLevel0_Themes() {
    DOM.pageTitle.textContent = "Explore by Theme";
    
    const grouped = {};
    activeData.forEach(item => {
        const key = item['Parent Theme'] || 'Uncategorized';
        if (!grouped[key]) grouped[key] = { count: 0, cap: 0 };
        grouped[key].count++;
        grouped[key].cap += (Number(String(item['Market Cap (INR)']||0).replace(/[^0-9.-]+/g,""))||0);
    });

    DOM.resultCount.textContent = `${Object.keys(grouped).length} Themes matching criteria.`;
    
    DOM.grid.innerHTML = Object.entries(grouped).sort((a,b) => b[1].cap - a[1].cap).map(([key, data], idx) => `
        <div class="node-card" data-theme="${encodeURIComponent(key)}" style="animation-delay: ${idx * 0.05}s">
            <h3 class="node-title">${key}</h3>
            <div class="node-stats">
                <div class="n-stat"><span class="n-lbl">Entities</span><span class="n-val">${data.count}</span></div>
                <div class="n-stat"><span class="n-lbl">Total Value</span><span class="n-val highlight">${formatINR(data.cap)}</span></div>
            </div>
        </div>
    `).join('');

    DOM.grid.querySelectorAll('.node-card').forEach(card => {
        card.addEventListener('click', () => drillDown(1, decodeURIComponent(card.dataset.theme)));
    });
}

// ======== LEVEL 1: STAGES ========
function renderLevel1_Stages() {
    DOM.pageTitle.textContent = "Supply Chain Stages";
    
    const subset = activeData.filter(i => (i['Parent Theme'] || 'Uncategorized') === drillState.theme);
    const grouped = {};
    subset.forEach(item => {
        const key = item['Supply Chain Stage'] || 'Uncategorized';
        if (!grouped[key]) grouped[key] = { count: 0, cap: 0 };
        grouped[key].count++;
        grouped[key].cap += (Number(String(item['Market Cap (INR)']||0).replace(/[^0-9.-]+/g,""))||0);
    });

    DOM.resultCount.textContent = `Analyzing ${subset.length} assets across ${Object.keys(grouped).length} stages in ${drillState.theme}.`;

    DOM.grid.innerHTML = Object.entries(grouped).sort((a,b) => b[1].cap - a[1].cap).map(([key, data], idx) => `
        <div class="node-card" data-stage="${encodeURIComponent(key)}" style="animation-delay: ${idx * 0.05}s">
            <h3 class="node-title">${key}</h3>
            <div class="node-stats">
                <div class="n-stat"><span class="n-lbl">Entities</span><span class="n-val">${data.count}</span></div>
                <div class="n-stat"><span class="n-lbl">Total Value</span><span class="n-val highlight">${formatINR(data.cap)}</span></div>
            </div>
        </div>
    `).join('');

    DOM.grid.querySelectorAll('.node-card').forEach(card => {
        card.addEventListener('click', () => drillDown(2, decodeURIComponent(card.dataset.stage)));
    });
}

// ======== LEVEL 2: SUB-STAGES ========
function renderLevel2_SubStages() {
    DOM.pageTitle.textContent = "Sub-Stage Analysis";
    
    const subset = activeData.filter(i => (i['Parent Theme'] || 'Uncategorized') === drillState.theme && (i['Supply Chain Stage'] || 'Uncategorized') === drillState.stage);
    const grouped = {};
    subset.forEach(item => {
        const key = item['Sub-Stage'] || 'Core Processing';
        if (!grouped[key]) grouped[key] = { count: 0, cap: 0 };
        grouped[key].count++;
        grouped[key].cap += (Number(String(item['Market Cap (INR)']||0).replace(/[^0-9.-]+/g,""))||0);
    });

    DOM.resultCount.textContent = `Analyzing ${subset.length} assets in ${drillState.stage}.`;

    DOM.grid.innerHTML = Object.entries(grouped).sort((a,b) => b[1].cap - a[1].cap).map(([key, data], idx) => `
        <div class="node-card" data-substage="${encodeURIComponent(key)}" style="animation-delay: ${idx * 0.05}s">
            <h3 class="node-title">${key}</h3>
            <div class="node-stats">
                <div class="n-stat"><span class="n-lbl">Entities</span><span class="n-val">${data.count}</span></div>
                <div class="n-stat"><span class="n-lbl">Total Value</span><span class="n-val highlight">${formatINR(data.cap)}</span></div>
            </div>
        </div>
    `).join('');

    DOM.grid.querySelectorAll('.node-card').forEach(card => {
        card.addEventListener('click', () => drillDown(3, decodeURIComponent(card.dataset.substage)));
    });
}

// ======== LEVEL 3: STOCKS ========
function renderLevel3_Stocks() {
    DOM.pageTitle.textContent = "Identified Equities";
    
    let subset = activeData.filter(i => 
        (drillState.theme === 'Any' || (i['Parent Theme'] || 'Uncategorized') === drillState.theme) && 
        (i['Supply Chain Stage'] || 'Uncategorized') === drillState.stage &&
        (i['Sub-Stage'] || 'Core Processing') === drillState.subStage
    );

    const sortVal = DOM.sort.value;
    subset.sort((a, b) => {
        const capA = Number(String(a['Market Cap (INR)'] || '0').replace(/[^0-9.-]+/g, "")) || 0;
        const capB = Number(String(b['Market Cap (INR)'] || '0').replace(/[^0-9.-]+/g, "")) || 0;
        if (sortVal === 'cap-desc' || sortVal === 'relevance') return capB - capA;
        if (sortVal === 'cap-asc') return capA - capB;
        if (sortVal === 'name-asc') return String(a['Company Name']).localeCompare(String(b['Company Name']));
        return 0;
    });

    DOM.resultCount.textContent = `Showing ${subset.length} companies operating in ${drillState.subStage}.`;

    DOM.grid.innerHTML = subset.map((item, idx) => {
        let tag = item['Specific Products'] || item['Specific Services'] || 'Diversified Operations';
        if(tag.length > 70) tag = tag.substring(0, 70) + '...';
        
        return `
        <div class="stock-card" data-symbol="${encodeURIComponent(item['Stock Symbol'] || '')}" style="animation-delay: ${idx * 0.03}s">
            <div class="stock-header">
                <div class="stock-title">${item['Company Name']}</div>
                <div class="stock-ticker">${item['Stock Symbol'] || 'N/A'}</div>
            </div>
            <div class="stock-tagline">${tag}</div>
            <div class="stock-bottom">
                <div class="n-stat"><span class="n-lbl">Sector</span><span class="n-val" style="font-size: 0.85rem;">${item['Sector'] || '-'}</span></div>
                <div class="n-stat" style="align-items: flex-end;"><span class="n-lbl">Market Cap</span><span class="n-val highlight">${formatINR(item['Market Cap (INR)'])}</span></div>
            </div>
        </div>`;
    }).join('');

    DOM.grid.querySelectorAll('.stock-card').forEach(card => {
        card.addEventListener('click', () => {
            const symbol = decodeURIComponent(card.dataset.symbol);
            openDrawer(symbol);
        });
    });
}

window.drillDown = function(level, key) {
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

// ======== LEVEL 4: DETAIL DRAWER ========
window.openDrawer = function(symbol) {
    const item = activeData.find(i => i['Stock Symbol'] === symbol) || activeData[0];
    if(!item) return;
    
    document.getElementById('drawerName').textContent = item['Company Name'];
    document.getElementById('drawerSymbol').textContent = item['Stock Symbol'] || 'N/A';
    document.getElementById('drawerCap').textContent = formatINR(item['Market Cap (INR)']);
    
    const fields = ['Business Model', 'Value Chain Direction', 'Revenue Dependency Mapping (%)', 'Asset Type', 'Geographical Exposure', 'Customer Type'];
    document.getElementById('drawerMetaGrid').innerHTML = fields.map(f => `
        <div class="meta-item">
            <span class="meta-label">${f.replace('Mapping (%)', '(%)')}</span>
            <span class="meta-value">${item[f] || '-'}</span>
        </div>
    `).join('');

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

// 3D Tilt for Nodes & Cards
function init3DTilt() {
    document.querySelectorAll('.node-card, .stock-card, .sub-card, .pipe-card').forEach(card => {
        if (card.dataset.tiltInit === 'true') return;
        card.dataset.tiltInit = 'true';

        card.addEventListener('mousemove', (e) => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left; const y = e.clientY - rect.top;
            const rotateX = ((y - rect.height/2) / (rect.height/2)) * -6 * tiltScale;
            const rotateY = ((x - rect.width/2) / (rect.width/2)) * 6 * tiltScale;
            const scale = 1 + (0.02 * tiltScale);
            card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(${scale}, ${scale}, ${scale})`;
        });

        card.addEventListener('mouseleave', () => {
            card.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)`;
        });
    });
}

// p5.js Galaxy Background
let particles = [];
function setup() {
    let cvs = createCanvas(windowWidth, windowHeight);
    cvs.parent('p5-canvas-container');
    for (let i = 0; i < (windowWidth < 768 ? 40 : 80); i++) particles.push(new Particle());
}
function draw() { clear(); particles.forEach(p => { p.update(); p.display(); p.check(particles); }); }
function windowResized() { resizeCanvas(windowWidth, windowHeight); }

class Particle {
    constructor() { this.pos = createVector(random(width), random(height)); this.vel = createVector(random(-0.15, 0.15), random(-0.15, 0.15)); this.z = random([0.2, 0.6, 1.2]); }
    update() {
        this.pos.add(this.vel);
        if (this.pos.x < -100) this.pos.x = width + 100; if (this.pos.x > width + 100) this.pos.x = -100;
        if (this.pos.y < -100) this.pos.y = height + 100; if (this.pos.y > height + 100) this.pos.y = -100;
    }
    display() { 
        noStroke(); fill(`rgba(168, 85, 247, ${0.15 + (this.z * 0.3)})`);
        circle(this.pos.x - (mouseX - width/2)*(this.z*0.05), this.pos.y - (mouseY - height/2)*(this.z*0.05), 2 * this.z * 1.5); 
    }
    check(others) {
        others.forEach(o => {
            if (this.z === o.z) {
                let px1 = this.pos.x - (mouseX - width/2)*(this.z*0.05), py1 = this.pos.y - (mouseY - height/2)*(this.z*0.05);
                let px2 = o.pos.x - (mouseX - width/2)*(o.z*0.05), py2 = o.pos.y - (mouseY - height/2)*(o.z*0.05);
                let d = dist(px1, py1, px2, py2), max = 100 * this.z; 
                if (d < max) { stroke(`rgba(192, 132, 252, ${map(d, 0, max, 0.2 * this.z, 0)})`); strokeWeight(0.5 * this.z); line(px1, py1, px2, py2); }
            }
        });
    }
}

document.addEventListener('DOMContentLoaded', init);

// ==UserScript==
// @name         Harry Checker - Final Version
// @namespace    http://example.com
// @version      8.8
// @description  Uses login request approach for bonus data, maintains original GUI, auto-navigates to next URL without merchant ID
// @updateURL    https://raw.githubusercontent.com/sinastry123/Bonus-checker/main/Bonus.js
// @downloadURL  https://raw.githubusercontent.com/sinastry123/Bonus-checker/main/Bonus.js
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      *
// ==/UserScript==


(function() {
    'use strict';

    /***********************************************
     *         CONSTANTS & STATE MANAGEMENT        *
     ***********************************************/
    // Right at the top of your script:
if (window._bonusCheckerAlreadyLoaded) {
  // Stop if we’ve already run on this page load
  //("[Bonus Checker] Script already initialized. Skipping...");
  return;
}
window._bonusCheckerAlreadyLoaded = true;
    const BATCH_SIZE = 250;
    const CHECK_DELAY = 10;
    const CLEANUP_INTERVAL = 30000;
    let currentDomainCard = null;
    let isCurrentDomainCardVisible = false;
    let lastValidListedDomain = null;
    let temporaryBonusData = {};
    let domainCredentials = JSON.parse(GM_getValue("domain_credentials", "{}"));
    let isFetchingBonusData = false;

    // Adjust how much of the request body we store.
    const MAX_BODY_LENGTH = 0;
    // Only keep these headers.
    const keepHeaderNames = ['authorization', 'content-type', 'accept', 'x-csrf-token'];

    const eventListeners = [];
    let topObserver = null;
    let statusHideTimeout = null;
    // Core state
    let domainList = JSON.parse(GM_getValue("bonus_checker_domains", '["example.com"]'));
    let merchantIdData = JSON.parse(GM_getValue("merchant_id_data", "{}"));
    let autoNavNonVisited = GM_getValue("autoNavNonVisited", false);
    let autoLogin = GM_getValue("autoLogin", false);
    let autoNavValid = GM_getValue("autoNavValid", false);
    let currentIndex = GM_getValue("currentIndex", 0);
    let activeChecks = new Set();
    let processedCount = 0;
    let totalSites = 0;
   let visitedDomains = GM_getValue("visitedDomains", []);
    // Default credentials for API login
    let defaultPhone = GM_getValue("default_phone", "0412578959");
    let defaultPassword = GM_getValue("default_password", "password");
    let bonusFetchInProgress = {};
    let lastListedDomain = null;
    let lastCapturedDomain = null;
    let lastCapturedBonus = null;
let sortMode = GM_getValue("sortMode", "commission");
let maxWithdrawalBonusType = GM_getValue("maxWithdrawalBonusType", "commission");
let autoValidBonusType = GM_getValue("autoValidBonusType", "commission");
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    const originalSend = XMLHttpRequest.prototype.send;
    let guiElement = null;
    let navigationScheduled = false;
    let checkLiveClickCount = 0; // Track the state of the Check Live button
    let showingLastData = false;


    // Override window.open so that it always redirects in the current tab.
window.open = function(url, name, features) {
  if (url) {
    window.location.href = url;
  }
  return null;
};

// Intercept clicks on any link with target="_blank" and open it in the same tab.
document.addEventListener('click', function(event) {
  let anchor = event.target.closest('a[target="_blank"]');
  if (anchor && anchor.href) {
    event.preventDefault();
    window.location.href = anchor.href;
  }
});
    // Sort mode for bonus sorting
    /***********************************************
     *         HELPER / UTILITY FUNCS              *
     ***********************************************/
    // Disable the competing function to prevent conflicts
    function updateMinimizedState() {
        // Intentionally empty to prevent style conflicts
        return;
    }

    // ====== MINIMIZED STATE FUNCTIONS ======

/***********************************************
 *             MINIMIZED STATE HELPERS         *
 ***********************************************/

function injectMinimizedStylesheet() {
    const existingStyle = document.getElementById('minimized-style');
    if (existingStyle) existingStyle.remove();

    const style = document.createElement('style');
    style.id = 'minimized-style';
    style.textContent = `
        /* Hide header controls, title, status, progress bar, hearts, etc. */
        #bonus-checker-container.minimized #guiContent .header-controls,
        #bonus-checker-container.minimized #bonus-checker-title,
        #bonus-checker-container.minimized #statusMessage,
        #bonus-checker-container.minimized #progressBar,
        #bonus-checker-container.minimized #heart-container {
            display: none !important;
        }
        /* Ensure the results area is visible when minimized (so we see the current domain card) */
        #bonus-checker-container.minimized #resultsArea {
            display: block !important;
        }
        /* Current domain card is shown in minimized mode, but smaller */
        #bonus-checker-container.minimized .current-domain-card {
            width: 100% !important;
            max-height: 80px !important;
            overflow-y: auto !important;
            margin: 0 !important;
            padding: 2px !important;
            font-size: 10px !important;
        }
        /* We do NOT set display:none on #refreshLastMin and #nextDomainMin here! */
        #refreshLastMin, #nextDomainMin {
            position: absolute !important;
            top: 2px !important;
            z-index: 999999 !important;
            padding: 4px 6px !important;
            font-size: 10px !important;
        }
        #refreshLastMin { right: 80px !important; }
        #nextDomainMin { right: 2px !important; }

        /* Maximize button styling */
        #maximizeTracker {
            display: none;
            position: absolute !important;
            top: 2px !important;
            right: 2px !important;
            z-index: 999999 !important;
        }
        #bonus-checker-container.minimized #maximizeTracker {
            display: block !important;
        }
    `;
    document.head.appendChild(style);
}

function applyMinimizedStateEarly() {
    injectMinimizedStylesheet();
    if (GM_getValue("minimized", false)) {
        document.documentElement.classList.add('early-minimized');
        //('[Bonus Checker] Early minimized state prepared');
    }
}

function minimizeResults() {
    //("[Bonus Checker] Minimizing...");
    const container = document.getElementById('bonus-checker-container');
    if (!container) return;
    container.classList.add('minimized');
    GM_setValue("minimized", true);
    try {
        const state = JSON.parse(GM_getValue("guiState", "{}"));
        state.minimized = true;
        GM_setValue("guiState", JSON.stringify(state));
    } catch (e) {
        console.error("[Bonus Checker] Error saving minimized state", e);
    }
    // Hide extra buttons etc.
    const refreshLastMinBtn = document.getElementById('refreshLastMin');
    if (refreshLastMinBtn) refreshLastMinBtn.style.display = 'block';
    const nextDomainMinBtn = document.getElementById('nextDomainMin');
    if (nextDomainMinBtn) nextDomainMinBtn.style.display = 'block';
    const maximizeBtn = document.getElementById('maximizeTracker');
    if (maximizeBtn) maximizeBtn.style.display = 'block';

    // *** NEW CODE: Remove all cards except the current domain card ***
    const resultsArea = document.getElementById('resultsArea');
    if (resultsArea) {
        Array.from(resultsArea.children).forEach(child => {
            if (!child.classList.contains("current-domain-card")) {
                child.remove();
            }
        });
    }
    //("[Bonus Checker] UI minimized");
}

function maximizeResults() {
    //("[Bonus Checker] Maximizing...");
    const container = document.getElementById('bonus-checker-container');
    if (!container) return;
    container.classList.remove('minimized');
    GM_setValue("minimized", false);
    try {
        const state = JSON.parse(GM_getValue("guiState", "{}"));
        state.minimized = false;
        GM_setValue("guiState", JSON.stringify(state));
    } catch (e) {
        console.error("[Bonus Checker] Error saving maximized state", e);
    }
    updateCurrentDomainCard();
    // In maximized mode, hide the extra minimized buttons.
    const refreshLastMinBtn = document.getElementById('refreshLastMin');
    if (refreshLastMinBtn) refreshLastMinBtn.style.display = 'none';
    const nextDomainMinBtn = document.getElementById('nextDomainMin');
    if (nextDomainMinBtn) nextDomainMinBtn.style.display = 'none';
    const maximizeBtn = document.getElementById('maximizeTracker');
    if (maximizeBtn) maximizeBtn.style.display = 'none';
    //("[Bonus Checker] UI maximized");
}
function setupMinimizeMaximizeButtons() {
    //("[Bonus Checker] Setting up minimize/maximize buttons");
    const minimizeBtn = document.getElementById('minimizeTracker');
    const maximizeBtn = document.getElementById('maximizeTracker');
    if (minimizeBtn) {
        minimizeBtn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            minimizeResults();
            return false;
        };
    }
    if (maximizeBtn) {
        maximizeBtn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            maximizeResults();
            return false;
        };
    }
    //("[Bonus Checker] Minimize/maximize buttons set up");
}

function initializeMinimizedState() {
    //("[Bonus Checker] Initializing minimized state");
    const minimized = GM_getValue("minimized", false);
    const container = document.getElementById('bonus-checker-container');
    if (!container) return;
    if (minimized) {
        container.classList.add('minimized');
        //("[Bonus Checker] Container marked as minimized");
    } else {
        container.classList.remove('minimized');
        //("[Bonus Checker] Container not minimized");
    }
    const maximizeBtn = document.getElementById('maximizeTracker');
    if (maximizeBtn) {
        maximizeBtn.style.display = minimized ? 'block' : 'none';
    }
}

/***********************************************
 *               CREATE GUI FUNCTION           *
 ***********************************************/
function createGUI() {
    //("[Bonus Checker] Creating full GUI...");

    // Apply early minimized styling.
    applyMinimizedStateEarly();

    // Main container.
    let container = document.getElementById('bonus-checker-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'bonus-checker-container';
        container.style.position = 'fixed';
        container.style.top = '0';
        container.style.left = '0';
        container.style.right = '0';
        container.style.zIndex = '999999';
        container.style.maxHeight = '80vh';
        container.style.overflowY = 'auto';
        container.style.background = 'rgba(0,0,0,0.9)';
        container.style.color = '#fff';
        container.style.fontFamily = 'Helvetica, Arial, sans-serif';
        container.style.borderBottom = '2px solid #ff1493';
        container.style.boxShadow = '0 4px 8px rgba(0,0,0,0.5)';
    }
    if (GM_getValue("minimized", false)) {
        container.classList.add('minimized');
    }

    // Heart container.
    let heartsDiv = document.getElementById('heart-container');
    if (!heartsDiv) {
        heartsDiv = document.createElement('div');
        heartsDiv.id = 'heart-container';
        container.appendChild(heartsDiv);
    }

    // Main GUI content wrapper - use flex layout
    let guiContent = document.getElementById('guiContent');
    if (!guiContent) {
        guiContent = document.createElement('div');
        guiContent.id = 'guiContent';
        guiContent.style.padding = '5px';
        // Set flex layout for proper ordering
        guiContent.style.display = 'flex';
        guiContent.style.flexDirection = 'column';
        container.appendChild(guiContent);
    }

    // Title header (order: 1)
    let title = document.getElementById('bonus-checker-title');
    if (!title) {
        title = document.createElement('div');
        title.id = 'bonus-checker-title';
        title.textContent = 'ALANNAH';
        title.style.fontSize = '22px';
        title.style.fontWeight = 'bold';
        title.style.textAlign = 'center';
        title.style.marginBottom = '5px';
        title.style.color = '#ff1493';
        title.style.textShadow = '1px 1px 5px rgba(255,20,147,0.7)';
        // Set order
        title.style.order = '1';
        guiContent.appendChild(title);
    }

    // Header controls container (order: 2)
    let headerControls = document.querySelector('.header-controls');
    if (!headerControls) {
        headerControls = document.createElement('div');
        headerControls.className = 'header-controls';
        headerControls.style.width = '100%';
        headerControls.style.boxSizing = 'border-box';
        // Set order
        headerControls.style.order = '2';
        guiContent.appendChild(headerControls);
    }

    // Status message (order: 3) - placed between buttons and domain cards
    let statusMessage = document.getElementById('statusMessage');
    if (!statusMessage) {
        statusMessage = document.createElement('div');
        statusMessage.className = 'status-message';
        statusMessage.id = 'statusMessage';
        statusMessage.style.display = 'none'; // Hidden initially
        // Set order
        statusMessage.style.order = '3';
        guiContent.appendChild(statusMessage);
    }

    // Row 1.
    const row1 = document.createElement('div');
    row1.className = 'header-row';
    row1.innerHTML = `
        <button id="editUrls" class="control-btn">Edit Domains</button>
        <button id="fetchFreshBonusData" class="control-btn">Fetch Fresh Bonus</button>
        <button id="showCachedBonuses" class="control-btn">Show Cached</button>
        <button id="showCurrentDomainOnly" class="control-btn">Show Current</button>
    `;
    headerControls.appendChild(row1);

    // Row 2.
    const row2 = document.createElement('div');
    row2.className = 'header-row';
    row2.innerHTML = `
        <button id="toggleAutoLogin" class="control-btn">Auto Login: OFF</button>
        <button id="toggleAutoNavNonVisited" class="control-btn">Auto Non-Visited: OFF</button>
        <button id="toggleAutoNavValid" class="control-btn">Auto Valid: OFF</button>
        <button id="refreshLastBtn" class="control-btn">Refresh Last</button>
    `;
    headerControls.appendChild(row2);

    // Row 3.
    const row3 = document.createElement('div');
    row3.className = 'header-row';
    row3.innerHTML = `
        <button id="toggleSortBtn" class="control-btn">Sort</button>
        <button id="setDomainCredentials" class="control-btn">Set Domain Creds</button>
        <button id="nextDomainBtn" class="control-btn">Next</button>
        <button id="minimizeTracker" class="control-btn">Minimize</button>
    `;
    headerControls.appendChild(row3);

    // Create minimized-mode extra buttons:
    // Refresh Last (minimized)
    let refreshLastMinBtn = document.getElementById('refreshLastMin');
    if (!refreshLastMinBtn) {
        refreshLastMinBtn = document.createElement('button');
        refreshLastMinBtn.id = 'refreshLastMin';
        refreshLastMinBtn.className = 'control-btn';
        refreshLastMinBtn.textContent = 'Refresh Last';
        refreshLastMinBtn.style.position = 'absolute';
        refreshLastMinBtn.style.top = '2px';
        refreshLastMinBtn.style.right = '110px';  // adjust as needed
        refreshLastMinBtn.style.zIndex = '999999';
        refreshLastMinBtn.style.width = 'auto';
        refreshLastMinBtn.style.display = GM_getValue("minimized", false) ? 'block' : 'none';
        refreshLastMinBtn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            refreshLastVisited();
        };
        container.appendChild(refreshLastMinBtn);
    }
    // Next (minimized)
    let nextDomainMinBtn = document.getElementById('nextDomainMin');
    if (!nextDomainMinBtn) {
        nextDomainMinBtn = document.createElement('button');
        nextDomainMinBtn.id = 'nextDomainMin';
        nextDomainMinBtn.className = 'control-btn';
        nextDomainMinBtn.textContent = 'Next';
        nextDomainMinBtn.style.position = 'absolute';
        nextDomainMinBtn.style.top = '2px';
        nextDomainMinBtn.style.right = '60px';  // adjust as needed
        nextDomainMinBtn.style.zIndex = '999999';
        nextDomainMinBtn.style.width = 'auto';
        nextDomainMinBtn.style.display = GM_getValue("minimized", false) ? 'block' : 'none';
        nextDomainMinBtn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            goToNextDomain();
        };
        container.appendChild(nextDomainMinBtn);
    }
    // Maximize button.
    let maximizeButton = document.getElementById('maximizeTracker');
    if (!maximizeButton) {
        maximizeButton = document.createElement('button');
        maximizeButton.id = 'maximizeTracker';
        maximizeButton.className = 'control-btn';
        maximizeButton.textContent = 'Maximize';
        maximizeButton.style.position = 'absolute';
        maximizeButton.style.top = '2px';
        maximizeButton.style.right = '2px';
        maximizeButton.style.zIndex = '999999';
        maximizeButton.style.width = 'auto';
        maximizeButton.style.display = GM_getValue("minimized", false) ? 'block' : 'none';
        container.appendChild(maximizeButton);
    }

    // Progress bar (order: 4)
    

    // Results area (order: 5)
    let resultsArea = document.getElementById('resultsArea');
    if (!resultsArea) {
        resultsArea = document.createElement('div');
        resultsArea.id = 'resultsArea';
        // Set order
        resultsArea.style.order = '5';
        guiContent.appendChild(resultsArea);
    }

    // Attach container to body.
    if (!document.body.contains(container)) {
        document.body.appendChild(container);
    }
    guiElement = container;

    // Floating hearts.
    for (let i = 0; i < 20; i++) {
        const heart = document.createElement('div');
        heart.className = 'floating-heart';
        heart.style.left = Math.random() * 100 + '%';
        heart.style.animationDelay = (Math.random() * 5) + 's';
        heart.style.animationDuration = (4 + Math.random() * 4) + 's';
        heartsDiv.appendChild(heart);
    }

    // Add CSS so each header row is a 4-column grid.
    const styleTag = document.createElement('style');
    styleTag.textContent = `
        .header-row {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 2px;
            margin-bottom: 4px;
        }
        .control-btn {
            width: 100%;
            box-sizing: border-box;
            padding: 4px 6px;
            font-size: 11px;
            cursor: pointer;
            background: rgba(0,0,0,0.6);
            border: 1px solid #ff1493;
            color: #fff;
            transition: all 0.2s ease;
            text-align: center;
        }
        .control-btn:hover {
            background: #fff;
            color: #ff1493;
        }
    `;
    document.head.appendChild(styleTag);

    // Hook up event listeners.
    addListener(document.getElementById('editUrls'), 'click', openEditModal);
    addListener(document.getElementById('fetchFreshBonusData'), 'click', fetchFreshBonusData);
    addListener(document.getElementById('showCachedBonuses'), 'click', showCachedBonuses);
    addListener(document.getElementById('showCurrentDomainOnly'), 'click', showCurrentDomainOnly);
    addListener(document.getElementById('toggleAutoLogin'), 'click', toggleAutoLogin);
    addListener(document.getElementById('toggleAutoNavNonVisited'), 'click', toggleNavNonVisited);
    addListener(document.getElementById('toggleAutoNavValid'), 'click', toggleNavValid);
    addListener(document.getElementById('refreshLastBtn'), 'click', refreshLastVisited);
    addListener(document.getElementById('toggleSortBtn'), 'click', openSortOptionsPopup);
    addListener(document.getElementById('setDomainCredentials'), 'click', openDomainCredentialsModal);
    addListener(document.getElementById('nextDomainBtn'), 'click', goToNextDomain);
    addListener(document.getElementById('minimizeTracker'), 'click', minimizeResults);
    addListener(maximizeButton, 'click', maximizeResults);

    updateToggleButtons && updateToggleButtons();
    renderLastCapturedInfo && renderLastCapturedInfo();
    updateSortButtonText && updateSortButtonText();

    setupMinimizeMaximizeButtons();
    initializeMinimizedState();

    // Insert the current domain card.
    updateCurrentDomainCard();

    //("[Bonus Checker] GUI created.");
}
//

    // Apply early minimized state


    // Call this very early


    // Simple, reliable minimize/maximize functions
    // Replace your existing minimizeResults function with this one
// Replace your minimizeResults function with this version
// Replace your minimizeResults function with this version


// Add this new function for periodic bonus checks in minimized mode
function startMinimizedBonusCheck() {
    // Clear any existing interval
    if (window.minimizedCheckInterval) {
        clearInterval(window.minimizedCheckInterval);
    }

    // Set up a new interval that runs every 5 seconds
    window.minimizedCheckInterval = setInterval(() => {
        const container = document.getElementById('bonus-checker-container');
        // Only run if we're still minimized
        if (container && container.classList.contains('minimized')) {
            const currentDomain = getCurrentDisplayDomain();
            if (currentDomain) {
                //(`[Bonus Checker] Periodic minimized check for ${currentDomain}`);
                checkDomain(currentDomain).then(() => {
                    updateCurrentDomainCard();
                });
            }
        } else {
            // If we're not minimized anymore, stop checking
            clearInterval(window.minimizedCheckInterval);
            window.minimizedCheckInterval = null;
        }
    }, 5000);
}

// Add this line to replace clearTemporaryData function to prevent data clearing
// when you don't want it to happen
function clearTemporaryData() {
    const container = document.getElementById('bonus-checker-container');
    if (container && container.classList.contains('minimized')) {
        //("[Bonus Checker] Minimised state active—skipping bonus data clearing.");
        return;
    }
    // Optionally, you could also check if the current domain has any bonus data.
    let hasValid = false;
    for (const domain in temporaryBonusData) {
        const bonus = temporaryBonusData[domain];
        if (bonus && ((bonus.commission && bonus.commission.amount > 0) ||
            (bonus.share && bonus.share.amount > 0) ||
            (bonus.referral && bonus.referral.amount > 0))) {
            hasValid = true;
            break;
        }
    }
    if (!hasValid && !autoNavValid) {
        temporaryBonusData = {};
        updateAllCards();
    }
}



    // Setup minimize/maximize buttons with direct event handlers


    // Enhanced persistGUIState function that uses synchronous storage
    function persistGUIState() {
    const container = document.getElementById('bonus-checker-container');
    if (!container) return;
    const minimized = container.classList.contains('minimized');
    GM_setValue("minimized", minimized);

    const resultsArea = document.getElementById('resultsArea');
    // Do not persist the current domain container's HTML
    const state = {
        resultsHTML: resultsArea ? resultsArea.innerHTML : "",
        // currentDomainHTML is intentionally omitted
        scrollTop: container.scrollTop || 0,
        autoLogin: autoLogin,
        autoNavNonVisited: autoNavNonVisited,
        autoNavValid: autoNavValid,
        sortMode: sortMode,
        minimized: minimized,
        checkLiveClickCount: checkLiveClickCount
    };
    GM_setValue("guiState", JSON.stringify(state));
}
    // Force save before any navigation
    function forceStateSaveBeforeNavigate(url) {
        // Create a new function that properly combines the save with navigation
        const container = document.getElementById('bonus-checker-container');
        if (container) {
            // Force save minimized state
            const isMinimized = container.classList.contains('minimized');
            GM_setValue("minimized", isMinimized);

            // Also save merchant ID data and any other critical state
            try {
                GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));
                persistGUIState();
            } catch (e) {
                console.error("Error saving full state before navigation:", e);
            }
        }

        // Now navigate
        window.location.href = url;
    }

    function goToNextValidDomain() {
  // First, try to load the cached bonus data.
  let cachedBonusData = GM_getValue("cached_bonus_data", "{}");
  try {
    cachedBonusData = JSON.parse(cachedBonusData);
  } catch (e) {
    cachedBonusData = {};
  }

  // Use cached bonus data if available; otherwise, fall back to temporaryBonusData.
  const bonusDataSource = Object.keys(cachedBonusData).length > 0 ? cachedBonusData : temporaryBonusData;

  let currentDomain = getCurrentDisplayDomain();

  // Filter domains that have valid bonus data for the chosen autoValidBonusType,
  // and that have NOT been visited in this cycle.
  let validDomains = domainList.filter(domain => {
    if (visitedDomains.includes(domain)) return false;
    let bonusData = bonusDataSource[domain];
    if (!bonusData) return false;
    let bonus;
    if (autoValidBonusType === "maxWithdrawal") {
      bonus = bonusData[maxWithdrawalBonusType]; // e.g. bonusData["commission"] if that's selected
      let value = parseFloat(bonus && bonus.maxWithdrawal || 0);
      return value > 0;
    } else {
      bonus = bonusData[autoValidBonusType];
      let value = parseFloat(bonus && (bonus.amount || bonus.bonusFixed) || 0);
      return value > 0;
    }
  });

  // If no valid domains remain, reset visitedDomains and try again.
  if (validDomains.length === 0) {
    visitedDomains = [];
    GM_setValue("visitedDomains", visitedDomains);
    validDomains = domainList.filter(domain => {
      let bonusData = bonusDataSource[domain];
      if (!bonusData) return false;
      let bonus;
      if (autoValidBonusType === "maxWithdrawal") {
        bonus = bonusData[maxWithdrawalBonusType];
        let value = parseFloat(bonus && bonus.maxWithdrawal || 0);
        return value > 0;
      } else {
        bonus = bonusData[autoValidBonusType];
        let value = parseFloat(bonus && (bonus.amount || bonus.bonusFixed) || 0);
        return value > 0;
      }
    });
    if (validDomains.length === 0) {
      updateStatusWithColor(`No domains have valid ${autoValidBonusType === "maxWithdrawal" ? maxWithdrawalBonusType : autoValidBonusType} bonus data.`, false);
      return;
    }
  }

  // Sort the valid domains in descending order by the proper bonus value.
  validDomains.sort((a, b) => {
    let bonusA, bonusB;
    if (autoValidBonusType === "maxWithdrawal") {
      bonusA = bonusDataSource[a] && bonusDataSource[a][maxWithdrawalBonusType];
      bonusB = bonusDataSource[b] && bonusDataSource[b][maxWithdrawalBonusType];
      let valueA = parseFloat(bonusA && bonusA.maxWithdrawal || 0);
      let valueB = parseFloat(bonusB && bonusB.maxWithdrawal || 0);
      return valueB - valueA;
    } else {
      bonusA = bonusDataSource[a] && bonusDataSource[a][autoValidBonusType];
      bonusB = bonusDataSource[b] && bonusDataSource[b][autoValidBonusType];
      let valueA = parseFloat(bonusA && (bonusA.amount || bonusA.bonusFixed) || 0);
      let valueB = parseFloat(bonusB && (bonusB.amount || bonusB.bonusFixed) || 0);
      return valueB - valueA;
    }
  });

  // Choose the top domain that is not the current one, if possible.
  let nextDomain = validDomains.find(domain => domain !== currentDomain) || validDomains[0];

  // Add this domain to visited list so we won't choose it again until the cache updates.
  visitedDomains.push(nextDomain);
  GM_setValue("visitedDomains", visitedDomains);

  updateStatusWithColor(`Auto-valid navigating to ${nextDomain} with highest ${autoValidBonusType === "maxWithdrawal" ? maxWithdrawalBonusType : autoValidBonusType} bonus.`, true);
  forceStateSaveBeforeNavigate(`https://${nextDomain}`);
}
    // Override all navigation functions to use our enhanced navigation
    function goToNextDomain() {
  // If auto-valid navigation is enabled, use that logic.
  if (GM_getValue("autoNavValid", false)) {
    goToNextValidDomain();
    return;
  }

  // If auto non-visited navigation is enabled, navigate to the first domain without a merchant ID.
  if (autoNavNonVisited) {
    const domainsWithoutMerchantId = domainList.filter(domain => !merchantIdData[domain]?.merchantId);
    if (domainsWithoutMerchantId.length === 0) {
      updateStatusWithColor('All domains now have merchant ID data!', true);
      return;
    }
    const nextDomain = domainsWithoutMerchantId[0];
    updateStatusWithColor(`Navigating to ${nextDomain} to capture merchant ID...`, true);
    forceStateSaveBeforeNavigate(`https://${nextDomain}`);
    return;
  }

  // Otherwise, cycle through the domain list.
  currentIndex++;
  if (currentIndex >= domainList.length) {
    currentIndex = 0;
  }
  GM_setValue("currentIndex", currentIndex);
  const nextDomain = domainList[currentIndex];
  forceStateSaveBeforeNavigate(`https://${nextDomain}`);
}

    function extractBaseDomain(url) {
  if (!url) return null;
  try {
    // Remove protocol (http:// or https://)
    let domain = url.replace(/^https?:\/\//i, "");

    // Remove any leading "www."
    domain = domain.replace(/^www\./i, "");

    // Take everything up to the first slash or colon
    domain = domain.split("/")[0].split(":")[0].toLowerCase();

    return domain;
  } catch (e) {
    console.error("extractBaseDomain error:", e);
    return null;
  }
}



    // Helper function to navigate with page reset
    function navigateWithPageReset(url) {
        // Save any important state
        GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));

        // Force save the minimized state as well
        const container = document.getElementById('bonus-checker-container');
        if (container) {
            const isMinimized = container.classList.contains('minimized');
            GM_setValue("minimized", isMinimized);
            persistGUIState();
        }

        // Clear any pending timers/intervals
        const highestId = window.setTimeout(() => {}, 0);
        for (let i = 0; i < highestId; i++) {
            window.clearTimeout(i);
            window.clearInterval(i);
        }

        // Force page reload instead of replace to clear any stale state
        window.location.href = url;
    }

    // Update checkIfLastDomainAndNavigate function
    function checkIfLastDomainAndNavigate(currentDomain) {
        // Force save minimized state and other state before navigating
        const container = document.getElementById('bonus-checker-container');
        if (container) {
            const isMinimized = container.classList.contains('minimized');
            GM_setValue("minimized", isMinimized);
        }

        // Save merchant data before navigating
        GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));
        persistGUIState();

        // Check if there are more domains to process
        if (autoNavNonVisited) {
            // Find next domain that doesn't have a merchant ID
            const nextDomain = domainList.find(d => !merchantIdData[d]?.merchantId);
            if (nextDomain) {
                updateStatusWithColor(`Moving to next domain without merchant ID: ${nextDomain}`, true);
                forceStateSaveBeforeNavigate(`https://${nextDomain}`);
                return;
            }
        }

        if (autoLogin) {
            // Find the next domain in the list
            const currentIndex = domainList.indexOf(currentDomain);
            let nextIndex = (currentIndex + 1) % domainList.length;

            // If we've gone through all domains
            if (nextIndex === 0) {
                updateStatusWithColor(`Completed auto-login cycle for all domains!`, true);
                // Just refresh the current page
                forceStateSaveBeforeNavigate(window.location.href);
                return;
            }

            const nextDomain = domainList[nextIndex];
            updateStatusWithColor(`Moving to next domain for auto-login: ${nextDomain}`, true);
            forceStateSaveBeforeNavigate(`https://${nextDomain}`);
            return;
        }

        // If no auto-navigation is enabled, just refresh the current page
        forceStateSaveBeforeNavigate(window.location.href);
    }

    // Update findAndNavigateToUnloggedDomain
    function findAndNavigateToUnloggedDomain() {
        if (!autoLogin) return; // Only continue if auto-login is still enabled

        // Save current merchantData state before navigating
        GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));

        // Force save minimized state
        const container = document.getElementById('bonus-checker-container');
        if (container) {
            const isMinimized = container.classList.contains('minimized');
            GM_setValue("minimized", isMinimized);
            persistGUIState();
        }

        const currentDomain = extractBaseDomain(window.location.href);
        updateStatusWithColor(`Finding domains that need login...`, true);

        // Start by showing a progress indicator
        const statusEl = document.getElementById('statusMessage');
        let originalStatus = statusEl?.textContent || '';

        // Create a progress bar for token verification
        let progressDiv = document.createElement('div');
        progressDiv.innerHTML = `
            <div style="margin-top: 10px; font-size: 12px;">
                <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                    <span>Verifying domain tokens...</span>
                    <span id="verification-counter">0/0</span>
                </div>
                <div style="height: 4px; background: #333; border-radius: 2px; overflow: hidden;">
                    <div id="verification-progress" style="height: 100%; background: #ff1493; width: 0%; transition: width 0.3s;"></div>
                </div>
            </div>
        `;
        statusEl?.appendChild(progressDiv);

        // Build a list of domains with merchant IDs that need verification
        const domainsToVerify = domainList.filter(domain =>
            domain !== currentDomain &&
            merchantIdData[domain]?.merchantId &&
            merchantIdData[domain]?.accessId &&
            merchantIdData[domain]?.accessToken
        );

        // Also track domains that need login right away (don't have tokens)
        const domainsNeedingLoginImmediately = domainList.filter(domain =>
            domain !== currentDomain &&
            merchantIdData[domain]?.merchantId &&
            (!merchantIdData[domain]?.accessId || !merchantIdData[domain]?.accessToken)
        );

        // If we find any domains that need login immediately, go to the first one
        if (domainsNeedingLoginImmediately.length > 0) {
            const nextDomain = domainsNeedingLoginImmediately[0];
            updateStatusWithColor(`Found domain needing login (no token): ${nextDomain}`, true);
            forceStateSaveBeforeNavigate(`https://${nextDomain}`);
            return;
        }

        // When navigating, replace window.location.href = url with forceStateSaveBeforeNavigate(url)
    }

    // Update navigateToNextUnloggedDomain
    function navigateToNextUnloggedDomain() {
        if (!autoLogin) return; // Only continue if auto-login is still enabled

        // Save current merchantData state before navigating
        GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));

        // Force save minimized state
        const container = document.getElementById('bonus-checker-container');
        if (container) {
            const isMinimized = container.classList.contains('minimized');
            GM_setValue("minimized", isMinimized);
            persistGUIState();
        }

        // Find current domain index
        const currentDomain = extractBaseDomain(window.location.href);
        let currentIndex = domainList.indexOf(currentDomain);
        if (currentIndex === -1) currentIndex = 0;

        // Get domains that are not logged in yet
        const unloggedDomains = [];

        // Need to check all domains starting from the next one
        for (let i = 1; i <= domainList.length; i++) {
            const idx = (currentIndex + i) % domainList.length;
            const domain = domainList[idx];

            // Skip domains without merchant ID
            if (!merchantIdData[domain]?.merchantId) continue;

            unloggedDomains.push(domain);
        }

        // If no unlogged domains found, check for domains without merchant ID
        if (unloggedDomains.length === 0) {
            const domainsWithoutMerchantId = domainList.filter(d => !merchantIdData[d]?.merchantId);

            if (domainsWithoutMerchantId.length > 0) {
                const nextDomain = domainsWithoutMerchantId[0];
                updateStatusWithColor(`No domains left to login. Going to ${nextDomain} to capture merchant ID...`, true);
                forceStateSaveBeforeNavigate(`https://${nextDomain}`);
                return;
            }

            // If all domains have merchant IDs and we've cycled through all of them
            updateStatusWithColor(`All domains have been processed!`, true);
            return;
        }

        // Navigate to the first unlogged domain
        const nextDomain = unloggedDomains[0];
        updateStatusWithColor(`Navigating to next domain: ${nextDomain}`, true);
        forceStateSaveBeforeNavigate(`https://${nextDomain}`);
    }

    function hasCompleteRequestData(domain) {
        return merchantIdData[domain] && merchantIdData[domain].merchantId;
    }

    function cleanURLList(text) {
    if (!text) return [];
    // Split by newline characters.
    return text.split(/[\n\r]+/)
        .map(line => line.trim())
        // Only keep lines that match a basic URL pattern.
        .filter(line => {
            // This regex matches URLs that may or may not include the protocol.
            // It checks for a valid domain name with a TLD.
            const urlRegex = /^(https?:\/\/)?([\da-z.-]+\.[a-z.]{2,6})([\/\w .-]*)*\/?$/i;
            return urlRegex.test(line);
        })
        // Convert each valid URL to its base domain.
        .map(line => extractBaseDomain(line))
        .filter(Boolean)
        // Remove duplicates.
        .filter((domain, index, self) => self.indexOf(domain) === index);
}

    function addListener(el, evt, cb) {
        if (!el) return;
        el.addEventListener(evt, cb);
        eventListeners.push({ el, evt, cb });
    }

    function storeTemporaryBonusData(domain, bonusData) {
        temporaryBonusData[domain] = bonusData;
    }

    // Clear temporary bonus data if needed

    // Function to update status with color
    // Updated status indicator function with detailed statuses and a modern design.
    // Updated status indicator function with detailed statuses, progress tracking, and proper positioning
function updateStatusWithColor(message, typeOrBoolean, progressData) {
  const statusEl = document.getElementById('statusMessage');
  if (!statusEl) return;

  // Make sure the status container is visible
  statusEl.style.display = 'block';
  statusEl.style.opacity = '1';

  // Clear any existing hide timer
  if (window.statusHideTimeout) {
    clearTimeout(window.statusHideTimeout);
  }

  // Determine type: if boolean true => success, false => error; otherwise use string if valid
  let type = 'info';
  if (typeof typeOrBoolean === 'boolean') {
    type = typeOrBoolean ? 'success' : 'error';
  } else if (typeof typeOrBoolean === 'string') {
    const validTypes = ['success', 'error', 'warning', 'info'];
    if (validTypes.includes(typeOrBoolean)) {
      type = typeOrBoolean;
    }
  }

  // Set styling based on type
  let icon = '';
  let bgColor = '';
  let borderColor = '';
  let textColor = '#fff';
  switch (type) {
    case 'success':
      icon = "✓";
      bgColor = "rgba(255,20,147,0.2)";
      borderColor = "#ff1493";
      break;
    case 'error':
      icon = "✕";
      bgColor = "rgba(0,0,0,0.8)";
      borderColor = "#ff4444";
      break;
    case 'warning':
      icon = "⚠";
      bgColor = "rgba(255,165,0,0.2)";
      borderColor = "orange";
      break;
    case 'info':
    default:
      icon = "ℹ";
      bgColor = "rgba(0,0,0,0.6)";
      borderColor = "#ccc";
      break;
  }

  // Format any progress data if provided
  let progressHtml = '';
  if (progressData) {
    const { processed, total } = progressData;
    if (processed !== undefined && total !== undefined) {
      const percent = Math.min(100, Math.round((processed / total) * 100));
      progressHtml = `
        <div class="status-progress">
          <div class="status-progress-text">${processed}/${total} (${percent}%)</div>
          <div class="status-progress-bar">
            <div class="status-progress-fill" style="width: ${percent}%"></div>
          </div>
        </div>
      `;
    }
  }

  // Update the status element's content and styles
  statusEl.innerHTML = `
    <div class="status-icon">${icon}</div>
    <div class="status-content">
      <div class="status-message-text">${message}</div>
      ${progressHtml}
    </div>
  `;

  // Apply enhanced styling
  statusEl.style.backgroundColor = bgColor;
  statusEl.style.border = `1px solid ${borderColor}`;
  statusEl.style.borderRadius = "5px";
  statusEl.style.padding = "10px";
  statusEl.style.display = "flex";
  statusEl.style.alignItems = "flex-start";
  statusEl.style.gap = "10px";
  statusEl.style.boxShadow = "0 2px 4px rgba(0,0,0,0.3)";
  statusEl.style.color = textColor;
  statusEl.style.fontFamily = "'Helvetica Neue', Helvetica, Arial, sans-serif";
  statusEl.style.margin = "5px 0 10px 0";
  statusEl.style.position = "relative";
  statusEl.style.zIndex = "1000";

  // Find and style the icon
  const iconEl = statusEl.querySelector('.status-icon');
  if (iconEl) {
    iconEl.style.fontSize = "16px";
    iconEl.style.fontWeight = "bold";
    iconEl.style.width = "24px";
    iconEl.style.height = "24px";
    iconEl.style.display = "flex";
    iconEl.style.alignItems = "center";
    iconEl.style.justifyContent = "center";
    iconEl.style.borderRadius = "50%";
    iconEl.style.backgroundColor = borderColor;
    iconEl.style.color = "#fff";
    iconEl.style.flexShrink = "0";
  }

  // Style the content container
  const contentEl = statusEl.querySelector('.status-content');
  if (contentEl) {
    contentEl.style.flex = "1";
    contentEl.style.display = "flex";
    contentEl.style.flexDirection = "column";
    contentEl.style.gap = "5px";
  }

  // Find and style the message text
  const textEl = statusEl.querySelector('.status-message-text');
  if (textEl) {
    textEl.style.fontSize = "14px";
    textEl.style.lineHeight = "1.4";
  }

  // Style the progress bar
  const progressBarEl = statusEl.querySelector('.status-progress-bar');
  if (progressBarEl) {
    progressBarEl.style.height = "4px";
    progressBarEl.style.width = "100%";
    progressBarEl.style.backgroundColor = "rgba(0,0,0,0.3)";
    progressBarEl.style.borderRadius = "2px";
    progressBarEl.style.overflow = "hidden";
  }

  // Style the progress fill
  const progressFillEl = statusEl.querySelector('.status-progress-fill');
  if (progressFillEl) {
    progressFillEl.style.height = "100%";
    progressFillEl.style.backgroundColor = borderColor;
    progressFillEl.style.transition = "width 0.3s ease";
  }

  // Style the progress text
  const progressTextEl = statusEl.querySelector('.status-progress-text');
  if (progressTextEl) {
    progressTextEl.style.fontSize = "12px";
    progressTextEl.style.textAlign = "right";
    progressTextEl.style.marginBottom = "2px";
  }

  // Only auto-hide for success messages, keep others visible
  if (type === 'success') {
    window.statusHideTimeout = setTimeout(() => {
      statusEl.style.transition = "opacity 1s ease-out";
      statusEl.style.opacity = '0';
      setTimeout(() => {
        statusEl.style.display = 'none';
      }, 1000);
    }, 5000); // Show success messages for 5 seconds
  }
}

    // Function to update all cards
    function updateAllCards() {
        // Update current domain card first
        updateCurrentDomainCard();

        // Update all displayed cards in results area
        const cards = document.querySelectorAll('.site-card');
        cards.forEach(card => {
            const domain = card.getAttribute('data-domain');
            if (domain && temporaryBonusData[domain]) {
                updateBonusDisplay(temporaryBonusData[domain], `https://${domain}`);
            }
        });
    }

    function getEffectiveWithdrawals(freeMin, freeMax, globalMin, globalMax) {
        // If free credit values exist (and are > 0), use them; otherwise, use the global ones.
        const effectiveMin = (freeMin != null && freeMin > 0) ? freeMin : (globalMin != null && globalMin > 0 ? globalMin : '--');
        const effectiveMax = (freeMax != null && freeMax > 0) ? freeMax : (globalMax != null && globalMax > 0 ? globalMax : '--');
        return { effectiveMin, effectiveMax };
    }

    // Load GUI state
    function loadGUIState() {
    const stateStr = GM_getValue("guiState", null);
    if (stateStr) {
        try {
            const state = JSON.parse(stateStr);
            // Convert stored sortMode to a string if it’s numeric.
            if (typeof state.sortMode === 'number') {
                const modes = ["commission", "share", "referral", "balance", "errors"];
                state.sortMode = modes[state.sortMode] || "commission";
            }
            // Set global sortMode; default to "commission" if none exists.
            sortMode = state.sortMode || "commission";

            const resultsArea = document.getElementById('resultsArea');
            if (resultsArea) {
                // Remove any previously saved current domain card from the HTML.
                const tempDiv = document.createElement('div');
                tempDiv.innerHTML = state.resultsHTML || "";
                const currentCards = tempDiv.querySelectorAll('.current-domain-card');
                currentCards.forEach(card => card.remove());
                resultsArea.innerHTML = tempDiv.innerHTML;
            }
            // Always force a fresh update of the current domain card.
            updateCurrentDomainCard();

            autoLogin = state.autoLogin;
            autoNavNonVisited = state.autoNavNonVisited;
            autoNavValid = state.autoNavValid;
            checkLiveClickCount = state.checkLiveClickCount || 0;

            const container = document.getElementById('bonus-checker-container');
            if (container) {
                if (state.minimized) {
                    container.classList.add('minimized');
                } else {
                    container.classList.remove('minimized');
                }
            }
            updateCheckLiveButton();

            // Rebind click events for domain cards.
            rebindDomainCardClickEvents();
        } catch (e) {
            console.error("Error parsing persisted GUI state", e);
        }
    }
}

    // Helper function to bind click events to domain cards
    function rebindDomainCardClickEvents() {
    const cards = document.querySelectorAll('.site-card:not(.current-domain-card)');
    cards.forEach(card => {
        const domain = card.getAttribute('data-domain');
        if (!domain) return;
        // Set an inline click handler to always navigate to the domain's URL.
        card.onclick = function(e) {
            e.preventDefault();
            window.location.href = `https://${domain}`;
            return false;
        };
    });
}

    // If you have other control buttons whose event listeners might be lost, you can do something similar:
    function rebindControlButtons() {
        const editUrlsBtn = document.getElementById('editUrls');
        const checkBonusesBtn = document.getElementById('checkBonuses');
        const refreshLastBtn = document.getElementById('refreshLastBtn');
        const nextDomainBtn = document.getElementById('nextDomainBtn');
        const showValidBonusesBtn = document.getElementById('showValidBonusesBtn');
        const toggleAutoLoginBtn = document.getElementById('toggleAutoLogin');
        const toggleAutoNavNonVisitedBtn = document.getElementById('toggleAutoNavNonVisited');
        const toggleAutoNavValidBtn = document.getElementById('toggleAutoNavValid');
        const minimizeTrackerBtn = document.getElementById('minimizeTracker');
        const maximizeTrackerBtn = document.getElementById('maximizeTracker');
        const toggleSortBtn = document.getElementById('toggleSortBtn').addEventListener('click', openSortOptionsPopup);
        const setDomainCredentialsBtn = document.getElementById('setDomainCredentials');
        const clearWithinRangeBtn = document.getElementById('clearWithinRangeBtn');

        if (editUrlsBtn) editUrlsBtn.addEventListener('click', openEditModal);
        if (checkBonusesBtn) checkBonusesBtn.addEventListener('click', checkAllBonuses);
        if (refreshLastBtn) refreshLastBtn.addEventListener('click', refreshLastVisited);
        if (nextDomainBtn) nextDomainBtn.addEventListener('click', goToNextDomain);
        if (showValidBonusesBtn) showValidBonusesBtn.addEventListener('click', showValidBonuses);
        if (toggleAutoLoginBtn) toggleAutoLoginBtn.addEventListener('click', toggleAutoLogin);
        if (toggleAutoNavNonVisitedBtn) toggleAutoNavNonVisitedBtn.addEventListener('click', toggleNavNonVisited);
        if (toggleAutoNavValidBtn) toggleAutoNavValidBtn.addEventListener('click', toggleNavValid);
        if (minimizeTrackerBtn) minimizeTrackerBtn.onclick = minimizeResults;
        if (maximizeTrackerBtn) maximizeTrackerBtn.onclick = maximizeResults;
if (toggleSortBtn) toggleSortBtn.addEventListener('click', openSortOptionsPopup);
        if (setDomainCredentialsBtn) setDomainCredentialsBtn.addEventListener('click', openDomainCredentialsModal);
        if (clearWithinRangeBtn) clearWithinRangeBtn.addEventListener('click', openRangeModal);
    }
function updateCheckLiveButton() {
    const btn = document.getElementById('checkBonuses');
    if (!btn) return;

    // Set text based on the current toggle state:
    // For example:
    // - 0: "Clear (Live Check Mode)"
    // - 1: "Show Cached Bonus Data"
    // - 2: "Fetch Fresh Bonus Data"
    if (checkLiveClickCount === 0) {
        btn.textContent = "Clear (Live Check Mode)";
    } else if (checkLiveClickCount === 1) {
        btn.textContent = "Show Cached Bonus Data";
    } else if (checkLiveClickCount === 2) {
        btn.textContent = "Fetch Fresh Bonus Data";
    }
}
    // Helper functions for formatting.
    function formatCommissionIndicator(c) {
        return c && c.amount > 0
            ? `<span style="color:lime;">Yes</span><strong style="color:#ffd700;"> (${c.amount})</strong>`
            : `<span style="color:red;">No</span>`;
    }
    function formatBonusIndicator(amount) {
        return amount && amount > 0
            ? `<span style="color:lime;">Yes</span><strong style="color:#ffd700;"> (${amount})</strong>`
            : `<span style="color:red;">No</span>`;
    }


    /***********************************************
     *      BONUS DATA TRANSFORMATION FUNC         *
     ***********************************************/
    function filterBonuses(rawData, domain) {
        if (!rawData || !rawData.data) return {};

        const rawBonuses = rawData.data.bonus || [];
        const rawWallets = rawData.data.wallet || [];

        let finalBalance = 0, finalMinW = 0, finalMaxW = 0;
        let freeCreditWallet = null, normalBalanceWallet = null;

        if (Array.isArray(rawWallets)) {
            for (let i = 0; i < rawWallets.length; i++) {
                const wallet = rawWallets[i];
                if (wallet.id == "1") {
                    freeCreditWallet = wallet;
                } else if (wallet.id == 0 || wallet.id == "0") {
                    normalBalanceWallet = wallet;
                }
            }
        }

        if (freeCreditWallet) {
            const fcBal = parseFloat(freeCreditWallet.balance ?? 0) || 0;
            if (fcBal > 0) {
                finalBalance = fcBal;
                if (freeCreditWallet.data && typeof freeCreditWallet.data === 'string') {
                    try {
                        const parsedData = JSON.parse(freeCreditWallet.data);
                        finalMinW = parsedData.minWithdraw ?? 0;
                        finalMaxW = parsedData.maxWithdraw ?? 0;
                    } catch (e) {
                        // Silent error if JSON parsing fails
                    }
                }
            } else if (normalBalanceWallet) {
                const nbBal = parseFloat(normalBalanceWallet.balance ?? 0) || 0;
                if (nbBal > 0) {
                    finalBalance = nbBal;
                }
            }
        } else if (normalBalanceWallet) {
            const nbBal = parseFloat(normalBalanceWallet.balance ?? 0) || 0;
            if (nbBal > 0) {
                finalBalance = nbBal;
            }
        }

        // Capture global withdrawal limits if available in the response data
        const globalMinWithdraw = rawData.data.minWithdraw ?? 0;
        const globalMaxWithdraw = rawData.data.maxWithdraw ?? 0;

        let bonusData = {
            cash: finalBalance,
            freeCreditMinWithdraw: finalMinW,
            freeCreditMaxWithdraw: finalMaxW,
            commission: null,
            share: null,
            referral: null,
            globalMinWithdraw: globalMinWithdraw,
            globalMaxWithdraw: globalMaxWithdraw
        };

        rawBonuses.forEach(b => {
            let name = (b.name || "").toLowerCase();

            if (name.includes("commission")) {
                bonusData.commission = {
                    name: b.name || '',
                    amount: parseFloat(b.amount || 0) || 0,
                    minBet: b.minBet || 'N/A',
                    maxWithdrawal: b.maxWithdraw || 'N/A',
                    id: b.id || null
                };
            } else if (name.includes("share")) {
                let formattedBonus = {
                    name: b.name || '',
                    amount: parseFloat(b.bonusFixed || 0) || 0,
                    minWithdrawal: b.minWithdraw !== undefined ? b.minWithdraw : null,
                    maxWithdrawal: b.maxWithdraw !== undefined ? b.maxWithdraw : null,
                    id: b.id || null
                };

                let isValidBonus = formattedBonus.amount > 0 &&
                               formattedBonus.minWithdrawal !== null &&
                               formattedBonus.maxWithdrawal !== null;

                if (isValidBonus) {
                    bonusData.share = formattedBonus;
                }
            } else if (name.includes("referral")) {
                let formattedBonus = {
                    name: b.name || '',
                    amount: parseFloat(b.bonusFixed || 0) || 0,
                    minWithdrawal: b.minWithdraw !== undefined ? b.minWithdraw : null,
                    maxWithdrawal: b.maxWithdraw !== undefined ? b.maxWithdraw : null,
                    id: b.id || null
                };

                let isValidBonus = formattedBonus.amount > 0 &&
                               formattedBonus.minWithdrawal !== null &&
                               formattedBonus.maxWithdrawal !== null;

                if (isValidBonus) {
                    bonusData.referral = formattedBonus;
                }
            }
        });

        return bonusData;
    }

    // New function: checks every second (up to 5 times) whether bonus data is present for the current domain.
    // If not, it calls fetchBonusDataForDomain to force a new fetch.
    function checkBonusDataIfMissing() {
    const currentDomain = getCurrentDisplayDomain();
    let attempts = 0;
    function tryFetch() {
        attempts++;
        if (temporaryBonusData[currentDomain]) {
            updateStatusWithColor(`Bonus data found for ${currentDomain} on attempt ${attempts}`, true);
            return;
        }
        updateStatusWithColor(`No bonus data for ${currentDomain} yet — attempt ${attempts} of 5. Refreshing...`, true);
        checkDomain(currentDomain).then(() => {
            if (!temporaryBonusData[currentDomain] && attempts < 5) {
                setTimeout(tryFetch, 0); // Removed delay
            } else if (!temporaryBonusData[currentDomain]) {
                updateStatusWithColor(`After ${attempts} attempts, still no bonus data for ${currentDomain}.`, false);
            }
        });
    }
    setTimeout(tryFetch, 0); // Start immediately
}

    // Function to claim a bonus for a specific domain
    function claimBonus(domain, bonusType) {
        // 1) Get the necessary merchant ID info for this domain
        const domainData = merchantIdData[domain];
        if (!domainData || !domainData.merchantId) {
            updateStatusWithColor(`Error: No merchant ID for ${domain}`, false);
            return;
        }

        // 2) Pull out parameters from the saved data
        const merchantId = domainData.merchantId;
        const accessId = domainData.accessId || "";
        const accessToken = domainData.accessToken || "";
        const domainId = domainData.domainId || "0";
        const walletIsAdmin = domainData.walletIsAdmin || "";

        if (!merchantId || !accessId || !accessToken) {
            updateStatusWithColor(`Error: Missing access info for ${domain}`, false);
            return;
        }

        // 3) Figure out which bonus ID to claim
        const bonusData = temporaryBonusData[domain];
        if (!bonusData) {
            updateStatusWithColor(`Error: No bonus data for ${domain}`, false);
            return;
        }

        let bonusId = null;
        let bonusName = '(unknown)';
        if (bonusType === 'commission' && bonusData.commission?.id) {
            bonusId = bonusData.commission.id;
            bonusName = bonusData.commission.name || 'Commission';
        } else if (bonusType === 'share' && bonusData.share?.id) {
            bonusId = bonusData.share.id;
            bonusName = bonusData.share.name || 'Share Bonus';
        } else if (bonusType === 'referral' && bonusData.referral?.id) {
            bonusId = bonusData.referral.id;
            bonusName = bonusData.referral.name || 'Referral Bonus';
        }

        if (!bonusId) {
            updateStatusWithColor(`Error: No ${bonusType} bonus found for ${domain}`, false);
            return;
        }

        // 4) Prepare the POST data using /promotions/apply
        const claimData = new URLSearchParams({
            id: bonusId,
            transactionId: 'null',
            angpaoId: 'undefined',
            luckyId: 'undefined',
            trackingCode: 'dummyTrackingCode',
            callback: '1',
            module: '/promotions/apply',
            merchantId: merchantId,
            domainId: domainId,
            accessId: accessId,
            accessToken: accessToken,
            walletIsAdmin: walletIsAdmin
        }).toString();

        // 5) API endpoint
        const apiUrl = `https://${domain}/api/v1/index.php`;

        updateStatusWithColor(`Claiming ${bonusName} on ${domain} ...`, true);

        // 6) Send the request with retry logic
        sendClaimRequestWithRetry(apiUrl, claimData, 0);

        function sendClaimRequestWithRetry(url, data, attempt) {
            if (attempt >= 3) {
                updateStatusWithColor(`Failed to claim ${bonusType} bonus on ${domain} after 3 attempts`, false);
                return;
            }
            GM_xmlhttpRequest({
                method: "POST",
                url: url,
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "Accept": "*/*"
                },
                data: data,
                timeout: 10000 + (attempt * 2000),
                onload: function(response) {
                    try {
                        const result = JSON.parse(response.responseText) || {};
                        // Check success condition
                        if (result.status === 'SUCCESS') {
                            updateStatusWithColor(`Successfully claimed [${bonusName}] at ${domain}`, true);
                            // Refresh data after claiming
                            setTimeout(() => checkDomain(domain), 1000);
                        } else {
                            // Parse error message
                            const msg = result.message || result.data?.Message || result.status;
                            if (attempt < 2) {
                                setTimeout(() => {
                                    sendClaimRequestWithRetry(url, data, attempt + 1);
                                }, 1000);
                            } else {
                                updateStatusWithColor(`Error claiming ${bonusType} on ${domain}: ${msg}`, false);
                            }
                        }
                    } catch (e) {
                        if (attempt < 2) {
                            setTimeout(() => {
                                sendClaimRequestWithRetry(url, data, attempt + 1);
                            }, 1000);
                        } else {
                            updateStatusWithColor(`Claim parse error for ${domain}: ${e.message}`, false);
                        }
                    }
                },
                onerror: function() {
                    if (attempt < 2) {
                        setTimeout(() => {
                            sendClaimRequestWithRetry(url, data, attempt + 1);
                        }, 1000);
                    } else {
                        updateStatusWithColor(`Network error claiming ${bonusType} on ${domain}`, false);
                    }
                },
                ontimeout: function() {
                    if (attempt < 2) {
                        setTimeout(() => {
                            sendClaimRequestWithRetry(url, data, attempt + 1);
                        }, 1000);
                    } else {
                        updateStatusWithColor(`Timeout claiming ${bonusType} on ${domain}`, false);
                    }
                }
            });
        }
    }

    /***********************************************
     *            CLEANUP / SHUTDOWN               *
     ***********************************************/
    // Optimized cleanup before navigate function
    function cleanupBeforeNavigate() {
        // Restore original XHR methods
        XMLHttpRequest.prototype.open = originalOpen;
        XMLHttpRequest.prototype.setRequestHeader = originalSetRequestHeader;
        XMLHttpRequest.prototype.send = originalSend;

        // Disconnect observer
        if (topObserver) {
            topObserver.disconnect();
            topObserver = null;
        }

        // Remove event listeners
        eventListeners.forEach(({ el, evt, cb }) => {
            if (el && typeof el.removeEventListener === 'function') {
                el.removeEventListener(evt, cb);
            }
        });
        eventListeners.length = 0;

        // Clean merchant data
        cleanMerchantData();
    }

    // Optimized clean saved data function
    function cleanMerchantData() {
        // Use a Set for faster lookups
        const validDomains = new Set(domainList);

        // Find domains to remove
        const domainsToRemove = [];
        for (const domain in merchantIdData) {
            if (Object.prototype.hasOwnProperty.call(merchantIdData, domain)) {
                if (!validDomains.has(domain)) {
                    domainsToRemove.push(domain);
                }
            }
        }

        // Remove them all at once
        if (domainsToRemove.length > 0) {
            domainsToRemove.forEach(domain => {
                delete merchantIdData[domain];
            });

            // Save the cleaned data
            GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));
        }
    }

    /***********************************************
     *           BONUS VALIDATION LOGIC            *
     ***********************************************/
    function domainHasValidBonus(domain) {
        const bonusData = temporaryBonusData[domain];
        if (!bonusData) return false;

        // Commission/Share/Referral
        const c = bonusData.commission;
        const s = bonusData.share;
        const r = bonusData.referral;

        return (
            (c && c.amount > 0) ||
            (s && s.amount > 0) ||
            (r && r.amount > 0)
        );
    }

    /***********************************************
     *                   STYLES                    *
     ***********************************************/

  GM_addStyle(`
/* MAIN CONTAINER (barely transparent) */
#bonus-checker-container {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: rgba(0,0,0,0.9); /* mostly opaque */
    color: #fff;
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    z-index: 2147483647;
    border-bottom: 2px solid #ff1493;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 4px 8px rgba(0,0,0,0.5);
    padding: 0;
}

/* HEART CONTAINER inside main container */
#heart-container {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 0; /* behind the GUI content */
    overflow: hidden;
}

/* The actual GUI content sits above hearts */
#guiContent {
    position: relative;
    z-index: 1;
    padding: 5px;
}

/* TITLE HEADER (ALANNAH) */
#bonus-checker-title {
    font-size: 22px;
    font-weight: bold;
    text-align: center;
    margin-bottom: 5px;
    color: #ff1493;
    text-shadow: 1px 1px 5px rgba(255,20,147,0.7);
}

/* SITE CARDS - Extremely compact */
.site-card {
    padding: 2px;
    border-radius: 3px;
    margin-bottom: 2px;
    color: #fff;
    background: rgba(0,0,0,0.6);
    border: 1px solid #ff1493;
    box-shadow: 0 1px 2px rgba(0,0,0,0.5);
    font-size: 10px;
    line-height: 1.1;
    position: relative;
}
.valid-bonus {
    background: rgba(255,20,147,0.2) !important;
    border-color: #ff1493 !important;
}
.invalid-bonus {
    background: rgba(255,20,147,0.05) !important;
    border-color: #ff1493 !important;
}

/* Grid rows within each card */
.site-card .top-row,
.site-card .bottom-row {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 1px;
    text-align: center;
    margin-bottom: 1px;
}
.site-card .top-row > div,
.site-card .bottom-row > div {
    background: transparent !important;
    border-radius: 0 !important;
    padding: 0 !important;
}

/* BONUS INFO */
.bonus-info {
    display: none;
}

/* PROGRESS BAR */
.progress-bar {
    height: 2px;
    background: #333;
    margin: 3px 0;
}
.progress-fill {
    height: 100%;
    background: #ff1493;
    width: 0%;
    transition: width 0.3s ease;
}

/* LAST CAPTURED INFO */
#lastCapturedInfo {
    font-size: 0.75em;
    color: #ff1493;
    max-width: 50vw;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}

/* FLOATING HEARTS */
.floating-heart {
    position: absolute;
    width: 30px;
    height: 30px;
    background: #ff1493;
    transform: rotate(45deg);
    animation: floatHeart 6s linear infinite;
    opacity: 0;
    border-radius: 50% 50% 0 0;
}
.floating-heart:before,
.floating-heart:after {
    content: '';
    position: absolute;
    width: 30px;
    height: 30px;
    background: #ff1493;
    border-radius: 50%;
}
.floating-heart:before {
    left: -15px;
    top: 0;
}
.floating-heart:after {
    top: -15px;
    left: 0;
}
@keyframes floatHeart {
    0% {
        opacity: 0;
        transform: rotate(45deg) translateY(100%);
    }
    10% {
        opacity: 1;
    }
    100% {
        opacity: 0;
        transform: rotate(45deg) translateY(-200%);
    }
}

/* RANGE MODAL STYLES */
#rangeModal {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0,0,0,0.9);
    padding: 20px;
    border-radius: 8px;
    border: 2px solid #ff1493;
    z-index: 2147483650;
    display: none;
    width: 300px;
    text-align: center;
}
#rangeModal.active {
    display: block;
}
#rangeModal h3 {
    color: #ff1493;
    margin-top: 0;
    margin-bottom: 15px;
}
#rangeValue {
    width: 100%;
    background: #111;
    color: #fff;
    border: 1px solid #ff1493;
    padding: 8px;
    border-radius: 4px;
    margin-bottom: 15px;
    font-size: 16px;
    text-align: center;
}
.range-buttons {
    display: flex;
    justify-content: space-between;
    gap: 10px;
}
.range-button {
    flex: 1;
    background: #ff1493;
    color: #fff;
    border: 1px solid #ff1493;
    padding: 8px 15px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    transition: all 0.3s ease;
}
.range-button:hover {
    background: #fff;
    color: #ff1493;
}
#clearResults {
    margin-top: 15px;
    padding: 10px;
    background: rgba(0,0,0,0.7);
    border-radius: 4px;
    max-height: 150px;
    overflow-y: auto;
    display: none;
}
#clearResults.active {
    display: block;
}
.clear-result-item {
    padding: 5px;
    border-bottom: 1px solid #333;
    text-align: left;
}
.clear-result-item.success {
    color: #4CAF50;
}
.clear-result-item.error {
    color: #f44336;
}
.clear-progress {
    height: 4px;
    background: #333;
    margin-top: 10px;
    border-radius: 2px;
    overflow: hidden;
    display: none;
}
.clear-progress.active {
    display: block;
}
.clear-progress-fill {
    height: 100%;
    background: #ff1493;
    width: 0%;
    transition: width 0.3s ease;
}

/* Status message styling - ENHANCED WITH POSITIONING */
#statusMessage {
    padding: 0;
    margin: 8px 0;
    transition: all 0.3s ease;
    position: relative;
    z-index: 1001;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    order: 3; /* Ensures it appears below the header controls */
}

#statusMessage.active {
    padding: 10px;
    background-color: rgba(255, 20, 147, 0.2);
    border: 1px solid #ff1493;
    border-radius: 5px;
}

/* Status icon styling */
.status-icon {
    font-size: 16px;
    font-weight: bold;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background-color: #ff1493;
    color: #fff;
    flex-shrink: 0;
}

/* Status content container */
.status-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 5px;
}

/* Status message text styling */
.status-message-text {
    font-size: 14px;
    line-height: 1.4;
}

/* Status progress bar styling */
.status-progress {
    margin-top: 2px;
}

.status-progress-text {
    font-size: 12px;
    text-align: right;
    margin-bottom: 2px;
}

.status-progress-bar {
    height: 4px;
    width: 100%;
    background-color: rgba(0,0,0,0.3);
    border-radius: 2px;
    overflow: hidden;
}

.status-progress-fill {
    height: 100%;
    background-color: #ff1493;
    transition: width 0.3s ease;
}

/* Hide any status indicators at the bottom right */
.status-indicator {
    display: none !important;
}

/* MODAL OVERLAY STYLES */
.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.8);
    z-index: 21474836468;
    display: none;
    justify-content: center;
    align-items: center;
}
.modal-overlay.active {
    display: flex !important;
}
.url-modal {
    background: rgba(0,0,0,0.9);
    border: 2px solid #ff1493;
    border-radius: 8px;
    padding: 20px;
    width: 80%;
    max-width: 600px;
    z-index: 2147483649;
}
.url-modal.active {
    display: block;
}
.url-textarea {
    width: 100%;
    height: 200px;
    background: #111;
    color: #fff;
    border: 1px solid #ff1493;
    border-radius: 4px;
    padding: 10px;
    margin-bottom: 10px;
    font-family: monospace;
}

/* Credentials section */
.credentials-section {
    margin-top: 10px;
    padding: 10px;
    background: rgba(255, 20, 147, 0.1);
    border-radius: 5px;
    border: 1px solid rgba(255, 20, 147, 0.3);
}
.credentials-section input {
    background: #111;
    color: #fff;
    border: 1px solid #ff1493;
    padding: 5px;
    border-radius: 3px;
    margin: 5px 0;
    width: 100%;
}
.credentials-section label {
    display: block;
    margin-bottom: 2px;
    color: #ff1493;
}

/* CLAIM BUTTONS */
.claim-btn {
    margin-top: 4px;
    display: inline-block;
}

/* UNIFIED .control-btn STYLING */
.control-btn {
    background: rgba(0,0,0,0.6) !important;
    color: #fff !important;
    border: 1px solid #ff1493 !important;
    padding: 2px 4px !important;
    font-size: 10px !important;
    line-height: 1.2 !important;
    border-radius: 3px !important;
    cursor: pointer !important;
    transition: all 0.3s ease !important;
    text-align: center !important;
    box-shadow: 0 1px 2px rgba(0,0,0,0.5) !important;
}
.control-btn:hover {
    background: #fff !important;
    color: #ff1493 !important;
    box-shadow: 0 0 6px rgba(255,20,147,0.7) !important;
}

/* CURRENT DOMAIN CARD SPECIFIC STYLES */
#currentDomainCardContainer {
    position: relative !important;
    z-index: 999 !important; /* Lower than status message */
    margin-top: 8px !important;
    margin-bottom: 8px !important;
    background: rgba(0,0,0,0.1);
    border-bottom: 1px solid #ff1493;
    padding-bottom: 5px;
}
.current-domain-card {
    padding: 4px !important;
    margin: 0 !important;
    border-left: 3px solid #ff1493 !important;
}
.current-domain-card .top-row,
.current-domain-card .bottom-row {
    gap: 1px !important;
    margin: 2px 0 !important;
}

/* MINIMIZED MODE STYLES */
#bonus-checker-container.minimized #currentDomainCardContainer {
    display: block !important;
    position: relative !important;
    margin: 0 !important;
    padding: 0 !important;
    max-width: 100% !important;
    z-index: 2 !important;
}
/* Ensure that in minimized mode the current domain card remains visible even though other parts are hidden */
#bonus-checker-container.minimized .current-domain-card {
    width: 100% !important;
    max-height: 80px !important;
    overflow-y: auto !important;
    margin: 0 !important;
    padding: 2px !important;
    font-size: 10px !important;
}

/* Hide these elements when minimized */
#bonus-checker-container.minimized #guiContent .header-controls,
#bonus-checker-container.minimized #resultsArea,
#bonus-checker-container.minimized #statusMessage,
#bonus-checker-container.minimized #bonus-checker-title,
#bonus-checker-container.minimized #progressBar,
#bonus-checker-container.minimized #heart-container {
    display: none !important;
}

/* MAXIMIZE BUTTON */
#maximizeTracker {
    display: none;
    position: absolute !important;
    top: 2px !important;
    right: 2px !important;
    z-index: 999999 !important;
}
#bonus-checker-container.minimized #maximizeTracker {
    display: block !important;
}

#maximizeTracker,
#refreshLastMin,
#nextDomainMin {
    width: auto !important;
    position: absolute !important;
    top: 2px !important;
    z-index: 999999 !important;
    padding: 4px 6px !important;
    font-size: 10px !important;
}

/* NEW RULE: Always display the next button in minimized mode */
#bonus-checker-container.minimized #nextDomainMin {
    display: block !important;
    /* Adjusted spacing */
    right: 70px !important;
}

/* Positioning for maximize, next, and refresh buttons */
#maximizeTracker {
    right: 2px !important;
}
/* Global rule for refreshLastMin when not in minimized mode */
#refreshLastMin {
    right: 130px !important;
}
/* Override: in minimized mode, move refresh button just a little bit closer to next button */
#bonus-checker-container.minimized #refreshLastMin {
    right: 135px !important;
}
#nextDomainMin {
    right: 70px !important;
}

/* Make sure these buttons are not hidden by the global .control-btn rule */
.control-btn {
    width: auto !important;
}

/* Force the status message to appear BETWEEN buttons and domain cards */
#guiContent {
    display: flex;
    flex-direction: column;
}

.header-controls {
    order: 2;
}

#statusMessage {
    order: 3;
}

#currentDomainCardContainer {
    order: 4;
}

#resultsArea {
    order: 5;
}
`);
    /***********************************************
     *               GUI CREATION                  *
     ***********************************************/


    // 4. Add these functions for the domain-specific credentials modal
    function createDomainCredentialsModal() {
        const currentDomain = extractBaseDomain(window.location.href);
        if (!currentDomain) return;

        // Remove existing modal if it exists
        const existingModal = document.getElementById('domainCredentialsModal');
        if (existingModal) {
            existingModal.remove();
        }

        // Get current credentials for this domain
        const currentCreds = domainCredentials[currentDomain] || { phone: defaultPhone, password: defaultPassword };

        // Create modal overlay
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay';
        modalOverlay.id = 'domainCredentialsOverlay';

        // Create modal content
        const modal = document.createElement('div');
        modal.className = 'url-modal';
        modal.id = 'domainCredentialsModal';

        modal.innerHTML = `
            <h3 style="color: #ff1493; margin-bottom: 15px; text-align: center;">Credentials for ${currentDomain}</h3>

            <div class="credentials-section">
                <label for="domainPhone">Phone Number:</label>
                <input type="text" id="domainPhone" placeholder="Phone Number" value="${currentCreds.phone}">

                <label for="domainPassword">Password:</label>
                <input type="password" id="domainPassword" placeholder="Password" value="${currentCreds.password}">
            </div>

            <div style="display: flex; justify-content: space-between; gap: 8px; margin-top: 15px;">
                <button id="saveDomainCreds" class="control-btn">Save for ${currentDomain}</button>
                <button id="resetDomainCreds" class="control-btn">Reset to Default</button>
                <button id="cancelDomainCreds" class="control-btn">Cancel</button>
            </div>
        `;

        modalOverlay.appendChild(modal);
        document.body.appendChild(modalOverlay);

        // Add event listeners
        addListener(document.getElementById('saveDomainCreds'), 'click', saveDomainCredentials);
        addListener(document.getElementById('resetDomainCreds'), 'click', resetDomainCredentials);
        addListener(document.getElementById('cancelDomainCreds'), 'click', closeDomainCredentialsModal);
        addListener(modalOverlay, 'click', (e) => {
            if (e.target === modalOverlay) {
                closeDomainCredentialsModal();
            }
        });
    }

    function openDomainCredentialsModal() {
        createDomainCredentialsModal();
        const overlay = document.getElementById('domainCredentialsOverlay');
        if (overlay) {
            overlay.style.display = 'flex';
        }
    }

    function closeDomainCredentialsModal() {
        const overlay = document.getElementById('domainCredentialsOverlay');
        if (overlay) {
            overlay.style.display = 'none';
            overlay.remove();
        }
    }

    function saveDomainCredentials() {
        const currentDomain = extractBaseDomain(window.location.href);
        if (!currentDomain) return;

        const phoneInput = document.getElementById('domainPhone');
        const passwordInput = document.getElementById('domainPassword');

        if (phoneInput && passwordInput) {
            domainCredentials[currentDomain] = {
                phone: phoneInput.value.trim(),
                password: passwordInput.value
            };

            GM_setValue("domain_credentials", JSON.stringify(domainCredentials));
            updateStatusWithColor(`Saved specific credentials for ${currentDomain}`, true);

            // Remove the USER key so auto-login will be performed again with new credentials
            closeDomainCredentialsModal();

            // Ask if user wants to login now with new credentials
            if (confirm(`Do you want to login with the new credentials for ${currentDomain} now?`)) {
                tryDomainLogin();
            }
        }
    }

    function resetDomainCredentials() {
        const currentDomain = extractBaseDomain(window.location.href);
        if (!currentDomain) return;

        // Delete domain-specific credentials
        if (domainCredentials[currentDomain]) {
            delete domainCredentials[currentDomain];
            GM_setValue("domain_credentials", JSON.stringify(domainCredentials));
        }

        // Update inputs to show default credentials
        const phoneInput = document.getElementById('domainPhone');
        const passwordInput = document.getElementById('domainPassword');

        if (phoneInput && passwordInput) {
            phoneInput.value = defaultPhone;
            passwordInput.value = defaultPassword;
        }

        updateStatusWithColor(`Reset to default credentials for ${currentDomain}`, true);

        // Remove the USER key so auto-login will be performed again with default credentials
        localStorage.removeItem("USER");
    }

    // Create the range modal - fixes the issue
    function createRangeModal() {
        // Remove existing modal if it exists
        const existingModal = document.getElementById('rangeModal');
        if (existingModal) {
            existingModal.remove();
        }

        const modal = document.createElement('div');
        modal.id = 'rangeModal';

        modal.innerHTML = `
            <h3>Clear Balances Within Range</h3>
            <input type="number" id="rangeValue" placeholder="Enter maximum balance" min="0" step="0.01" value="${GM_getValue('lastRangeValue', '1')}">
            <div class="range-buttons">
                <button id="saveRangeBtn" class="range-button">Save</button>
                <button id="clearRangeBtn" class="range-button">Clear Now</button>
                <button id="cancelRangeBtn" class="range-button">Cancel</button>
            </div>
            <div class="clear-progress" id="clearProgress">
                <div class="clear-progress-fill" id="clearProgressFill"></div>
            </div>
            <div id="clearResults"></div>
        `;

        document.body.appendChild(modal);

        // Add event listeners
        addListener(document.getElementById('saveRangeBtn'), 'click', saveRangeValue);
        addListener(document.getElementById('clearRangeBtn'), 'click', clearWithinRange);
        addListener(document.getElementById('cancelRangeBtn'), 'click', closeRangeModal);
    }

    // Open the range modal
    function openRangeModal() {
        const modal = document.getElementById('rangeModal');
        if (modal) {
            modal.classList.add('active');
            document.getElementById('rangeValue').focus();
        } else {
            // If modal doesn't exist, create it and then open
            createRangeModal();
            setTimeout(openRangeModal, 100);
        }
    }

    // Close the range modal
    function closeRangeModal() {
        const modal = document.getElementById('rangeModal');
        if (modal) {
            modal.classList.remove('active');

            // Reset results and progress
            const results = document.getElementById('clearResults');
            const progress = document.getElementById('clearProgress');
            if (results) {
                results.innerHTML = '';
                results.classList.remove('active');
            }
            if (progress) {
                progress.classList.remove('active');
            }
        }
    }

    // Save the range value
    function saveRangeValue() {
        const input = document.getElementById('rangeValue');
        if (input && input.value) {
            const value = parseFloat(input.value);
            if (!isNaN(value) && value >= 0) {
                GM_setValue('lastRangeValue', value.toString());
                updateStatusWithColor(`Saved maximum balance: $${value}`, true);
                closeRangeModal();
            } else {
                alert('Please enter a valid positive number');
            }
        } else {
            alert('Please enter a value');
        }
    }

    // Clear balances within range
    async function clearWithinRange() {
        // This is just a placeholder since we're focusing on merchant ID and bonus functionality
        updateStatusWithColor("Clear balances functionality is not implemented in this version", false);
        closeRangeModal();
    }

    /***********************************************
     *               MODAL HANDLING                 *
     ***********************************************/
    function openEditModal() {
        const overlay = document.getElementById('modalOverlay');
        const modal = document.getElementById('urlModal');
        const textarea = document.getElementById('urlList');
        const phoneInput = document.getElementById('apiPhone');
        const passwordInput = document.getElementById('apiPassword');

        if (!overlay || !modal) {
            createModalElements();
            return setTimeout(openEditModal, 100); // Try again after elements are created
        }

        // Make sure we have the latest domain list and credentials
        textarea.value = domainList.join('\n');
        phoneInput.value = defaultPhone;
        passwordInput.value = defaultPassword;

        // Force display
        overlay.style.display = 'flex';
        overlay.classList.add('active');
        modal.classList.add('active');

        // Focus the textarea
        textarea.focus();
    }

    // Function to create modal elements if they don't exist
    function createModalElements() {
        // Remove existing elements if they exist but are broken
        const existingOverlay = document.getElementById('modalOverlay');
        if (existingOverlay) existingOverlay.remove();

        const existingModal = document.getElementById('urlModal');
        if (existingModal) existingModal.remove();

        // Create new modal overlay
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay';
        modalOverlay.id = 'modalOverlay';

        const urlModal = document.createElement('div');
        urlModal.className = 'url-modal';
        urlModal.id = 'urlModal';

        urlModal.innerHTML = `
            <textarea id="urlList" class="url-textarea" placeholder="Enter domains (one per line)"></textarea>

            <div class="credentials-section">
                <label for="apiPhone">Phone Number for API Login:</label>
                <input type="text" id="apiPhone" placeholder="Phone Number" value="${defaultPhone}">

                <label for="apiPassword">Password for API Login:</label>
                <input type="password" id="apiPassword" placeholder="Password" value="${defaultPassword}">
            </div>

            <div style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px;">
                <button id="saveUrls" class="control-btn">Save</button>
                <button id="cancelUrls" class="control-btn">Cancel</button>
            </div>
        `;

        modalOverlay.appendChild(urlModal);
        document.body.appendChild(modalOverlay);

        // Hook up event listeners
        modalOverlay.addEventListener('click', (e) => {
            if (e.target === modalOverlay) {
                closeEditModal();
            }
        });

        document.getElementById('saveUrls').addEventListener('click', saveEditedUrls);
        document.getElementById('cancelUrls').addEventListener('click', closeEditModal);
    }

    // Updated closeEditModal function
    function closeEditModal() {
        const overlay = document.getElementById('modalOverlay');
        const modal = document.getElementById('urlModal');

        if (overlay) {
            overlay.classList.remove('active');
            overlay.style.display = 'none';
        }

        if (modal) {
            modal.classList.remove('active');
        }
    }

    // Updated saveEditedUrls function to save credentials also
    function saveEditedUrls() {
    const textarea = document.getElementById('urlList');
    const phoneInput = document.getElementById('apiPhone');
    const passwordInput = document.getElementById('apiPassword');

    if (!textarea) {
        updateStatusWithColor("Textarea not found. Unable to save.", false);
        return;
    }

    try {
        // Clean and save domains
        domainList = cleanURLList(textarea.value);
        GM_setValue("bonus_checker_domains", JSON.stringify(domainList));

        // Verify domains were saved properly by reloading them
        const savedDomainsStr = GM_getValue("bonus_checker_domains", "[]");
        const savedDomains = JSON.parse(savedDomainsStr);
        if (savedDomains.length !== domainList.length) {
            updateStatusWithColor("Error: Not all domains were saved. Please try again.", false);
            return;
        }

        // Save API credentials if provided
        if (phoneInput && passwordInput) {
            defaultPhone = phoneInput.value.trim();
            defaultPassword = passwordInput.value;
            GM_setValue("default_phone", defaultPhone);
            GM_setValue("default_password", defaultPassword);
        }

        closeEditModal();
        updateStatusWithColor(`Saved ${domainList.length} domains and updated API credentials.`, true);
    } catch (e) {
        console.error("Error saving URLs:", e);
        updateStatusWithColor("Error saving URLs, please try again.", false);
    }
}

    // Cycle through sort modes when the sort button is clicked.
// Cycle through sort modes (0: Commission, 1: Share, 2: Referral, 3: Balance, 4: Errors)
function cycleSortMode() {
  const modes = ["commission", "share", "referral", "balance", "errors"];
  let idx = modes.indexOf(sortMode);
  if (idx === -1) {
    idx = 0;
  }
  idx = (idx + 1) % modes.length;
  sortMode = modes[idx];
  GM_setValue("sortMode", sortMode);
  sortDomainCards();
  updateSortButtonText();
}

// Update the sort button’s text to show the current mode.
function updateSortButtonText() {
  const btn = document.getElementById('toggleSortBtn');
  if (!btn) return;
  let displayText;
  switch (sortMode) {
    case 'commission':
      displayText = 'Commission';
      break;
    case 'share':
      displayText = 'Share';
      break;
    case 'referral':
      displayText = 'Referral';
      break;
    case 'balance':
      displayText = 'Balance';
      break;
    case 'errors':
      displayText = 'Errors';
      break;
    case 'maxWithdrawal':
      displayText = `Max Withdrawal (${maxWithdrawalBonusType || 'commission'})`;
      break;
    default:
      displayText = 'Commission';
      sortMode = 'commission';
  }
  btn.textContent = `Sort: ${displayText}`;
}

// Reorder the non-current domain cards based on the chosen sort mode.
function sortDomainCards() {
  const results = document.getElementById('resultsArea');
  if (!results) return;

  // Get the current domain card container so it stays in place.
  const currentContainer = document.getElementById('currentDomainCardContainer');
  // Get all non-current domain cards.
  const otherCards = Array.from(results.querySelectorAll('.site-card:not(.current-domain-card)'));

  // Debug: log each card's domain and bonus info from temporaryBonusData
  otherCards.forEach(card => {
    const domain = card.getAttribute('data-domain');
    const info = temporaryBonusData[domain];
    //("Sorting domain:", domain, "Info:", info);
  });

  otherCards.sort((a, b) => {
    const domainA = a.getAttribute('data-domain') || '';
    const domainB = b.getAttribute('data-domain') || '';
    const infoA = temporaryBonusData[domainA];
    const infoB = temporaryBonusData[domainB];

    // If neither card has bonus data, leave them in place.
    if (!infoA && !infoB) return 0;
    if (!infoA) return 1;
    if (!infoB) return -1;

    if (sortMode === 'maxWithdrawal') {
      // Use the selected bonus type for maxWithdrawal sorting.
      let bonusA = infoA[maxWithdrawalBonusType];
      let bonusB = infoB[maxWithdrawalBonusType];
      const maxA = bonusA && bonusA.maxWithdrawal ? parseFloat(bonusA.maxWithdrawal) : 0;
      const maxB = bonusB && bonusB.maxWithdrawal ? parseFloat(bonusB.maxWithdrawal) : 0;
      return maxB - maxA;
    } else if (sortMode === 'commission') {
      return compareNumbers(infoA?.commission?.amount, infoB?.commission?.amount);
    } else if (sortMode === 'share') {
      return compareNumbers(infoA?.share?.amount, infoB?.share?.amount);
    } else if (sortMode === 'referral') {
      return compareNumbers(infoA?.referral?.amount, infoB?.referral?.amount);
    } else if (sortMode === 'balance') {
      return compareNumbers(infoA?.cash, infoB?.cash);
    } else if (sortMode === 'errors') {
      return isErrorDomain(infoB) - isErrorDomain(infoA);
    } else {
      return 0;
    }
  });

  // Clear the results area and reassemble the cards.
  results.innerHTML = '';
  if (currentContainer) {
    results.appendChild(currentContainer);
  }
  otherCards.forEach(card => results.appendChild(card));
  updateStatusWithColor(
    `Sorted domains by ${sortMode === 'maxWithdrawal' ? 'Max Withdrawal (' + (maxWithdrawalBonusType || 'commission') + ')' : sortMode}`,
    true
  );
}

    /* 1) Define or update your CSS so pink buttons look correct. */
GM_addStyle(`
  .pink-button {
    background-color: #ff1493 !important;
    border: 1px solid #ff1493 !important;
    color: #fff !important;
    cursor: pointer;
    transition: all 0.3s ease;
    margin: 2px;
  }
  .pink-button:hover {
    background-color: #fff !important;
    color: #ff1493 !important;
  }
`);

/* 2) Provide the functions to open & close the Sort Options popup. */
function openAutoValidOptionsPopup() {
  let overlay = document.getElementById('autoValidOptionsOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'autoValidOptionsOverlay';
    overlay.className = 'modal-overlay';
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div id="autoValidOptionsModal" style="background: rgba(0,0,0,0.9);
         color: #fff;
         padding: 20px;
         border: 2px solid #ff1493;
         border-radius: 8px;
         width: 320px;
         text-align: center;
         position: relative;">
      <h3 style="color: #ff1493; margin-bottom: 15px;">Auto Valid Options</h3>
      <p>Select bonus type for auto-valid navigation:</p>
      <div class="auto-valid-options" style="margin-bottom: 10px;">
        <button class="control-btn pink-button auto-valid-option" data-type="commission" ${autoValidBonusType==="commission"?"class='active'":""}>Commission</button>
        <button class="control-btn pink-button auto-valid-option" data-type="share" ${autoValidBonusType==="share"?"class='active'":""}>Share</button>
        <button class="control-btn pink-button auto-valid-option" data-type="referral" ${autoValidBonusType==="referral"?"class='active'":""}>Referral</button>
        <button class="control-btn pink-button auto-valid-option" data-type="maxWithdrawal" ${autoValidBonusType==="maxWithdrawal"?"class='active'":""}>Max Withdrawal</button>
      </div>
      <div id="maxWithdrawalBonusSelection" style="display: none; margin-bottom: 10px;">
        <p style="color: #fff; font-weight: bold;">Select bonus type for Max Withdrawal:</p>
        <label style="margin-right: 10px; color: #fff;">
          <input type="radio" name="maxWithdrawalBonus" value="commission" ${maxWithdrawalBonusType==="commission"?"checked":""}>
          Commission
        </label>
        <label style="margin-right: 10px; color: #fff;">
          <input type="radio" name="maxWithdrawalBonus" value="share" ${maxWithdrawalBonusType==="share"?"checked":""}>
          Share
        </label>
        <label style="margin-right: 10px; color: #fff;">
          <input type="radio" name="maxWithdrawalBonus" value="referral" ${maxWithdrawalBonusType==="referral"?"checked":""}>
          Referral
        </label>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button id="applyAutoValidOptions" class="control-btn pink-button">Apply</button>
        <button id="cancelAutoValidOptions" class="control-btn pink-button">Cancel</button>
      </div>
    </div>
  `;

  overlay.style.display = 'flex';
  overlay.classList.add('active');

  let selectedType = autoValidBonusType;
  const optionButtons = overlay.querySelectorAll('.auto-valid-option');
  optionButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      // Remove active class from all options, then add to clicked button.
      optionButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedType = btn.getAttribute('data-type');
      // If Max Withdrawal is selected, show the radio group; otherwise hide it.
      const radioContainer = overlay.querySelector('#maxWithdrawalBonusSelection');
      radioContainer.style.display = (selectedType === "maxWithdrawal") ? 'block' : 'none';
    });
  });

  overlay.querySelector('#applyAutoValidOptions').onclick = function(e) {
    e.stopPropagation();
    // If "Max Withdrawal" is selected, read the chosen radio value.
    if (selectedType === "maxWithdrawal") {
      const radios = overlay.querySelectorAll('input[name="maxWithdrawalBonus"]');
      let selectedRadio;
      radios.forEach(radio => {
        if (radio.checked) {
          selectedRadio = radio.value;
        }
      });
      autoValidBonusType = "maxWithdrawal";
      maxWithdrawalBonusType = selectedRadio || "commission";
      GM_setValue("maxWithdrawalBonusType", maxWithdrawalBonusType);
    } else {
      autoValidBonusType = selectedType;
    }
    GM_setValue("autoValidBonusType", autoValidBonusType);
    // Enable auto-valid navigation flag.
    GM_setValue("autoNavValid", true);
    updateStatusWithColor(`Auto Valid enabled for bonus type: ${autoValidBonusType}${autoValidBonusType==="maxWithdrawal" ? " ("+maxWithdrawalBonusType+")" : ""}`, true);
    closeAutoValidOptionsPopup();
  };

  overlay.querySelector('#cancelAutoValidOptions').onclick = function(e) {
    e.stopPropagation();
    closeAutoValidOptionsPopup();
  };

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeAutoValidOptionsPopup();
    }
  });

  // When first shown, display the radio group if autoValidBonusType is already "maxWithdrawal".
  const initialRadioContainer = overlay.querySelector('#maxWithdrawalBonusSelection');
  initialRadioContainer.style.display = (autoValidBonusType === "maxWithdrawal") ? 'block' : 'none';
}

function closeAutoValidOptionsPopup() {
  const overlay = document.getElementById('autoValidOptionsOverlay');
  if (overlay) {
    overlay.classList.remove('active');
    overlay.style.display = 'none';
  }
}



function openSortOptionsPopup() {
  let overlay = document.getElementById('sortOptionsOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'sortOptionsOverlay';
    overlay.className = 'modal-overlay';
    document.body.appendChild(overlay);
  }

  // Build the modal's inner HTML.
  overlay.innerHTML = `
    <div id="sortOptionsModal" style="background: rgba(0,0,0,0.9);
         color: #fff;
         padding: 20px;
         border: 2px solid #ff1493;
         border-radius: 8px;
         width: 320px;
         text-align: center;
         position: relative;">
      <h3 style="color: #ff1493; margin-bottom: 15px;">Sort Options</h3>
      <div class="sort-options" style="margin-bottom: 10px;">
        <button class="control-btn pink-button sort-option" data-mode="commission" ${sortMode==="commission"?"class='active'":""}>Commission</button>
        <button class="control-btn pink-button sort-option" data-mode="share" ${sortMode==="share"?"class='active'":""}>Share</button>
        <button class="control-btn pink-button sort-option" data-mode="referral" ${sortMode==="referral"?"class='active'":""}>Referral</button>
        <button class="control-btn pink-button sort-option" data-mode="balance" ${sortMode==="balance"?"class='active'":""}>Balance</button>
        <button class="control-btn pink-button sort-option" data-mode="errors" ${sortMode==="errors"?"class='active'":""}>Errors</button>
        <button class="control-btn pink-button sort-option" data-mode="maxWithdrawal" ${sortMode==="maxWithdrawal"?"class='active'":""}>Max Withdrawal</button>
      </div>
      <div id="maxWithdrawalBonusSelection" style="display: ${sortMode==="maxWithdrawal"?"block":"none"}; margin-bottom: 10px;">
        <p style="color: #fff; font-weight: bold;">Select bonus type for Max Withdrawal:</p>
        <label style="margin-right: 10px; color: #fff;">
          <input type="radio" name="maxWithdrawalBonus" value="commission" ${maxWithdrawalBonusType==="commission"?"checked":""}>
          Commission
        </label>
        <label style="margin-right: 10px; color: #fff;">
          <input type="radio" name="maxWithdrawalBonus" value="share" ${maxWithdrawalBonusType==="share"?"checked":""}>
          Share
        </label>
        <label style="margin-right: 10px; color: #fff;">
          <input type="radio" name="maxWithdrawalBonus" value="referral" ${maxWithdrawalBonusType==="referral"?"checked":""}>
          Referral
        </label>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button id="applySortOptions" class="control-btn pink-button">Apply</button>
        <button id="cancelSortOptions" class="control-btn pink-button">Cancel</button>
      </div>
    </div>
  `;

  overlay.style.display = 'flex';
  overlay.classList.add('active');

  // Use overlay.querySelector to scope the search within the overlay.
  const optionButtons = overlay.querySelectorAll('.sort-option');
  optionButtons.forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      // Remove 'active' from all buttons in the overlay.
      optionButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      sortMode = btn.getAttribute('data-mode');
      GM_setValue("sortMode", sortMode);
      const radioContainer = overlay.querySelector('#maxWithdrawalBonusSelection');
      radioContainer.style.display = (sortMode === "maxWithdrawal") ? 'block' : 'none';
    });
  });

  // Set up the apply button
  const applyBtn = overlay.querySelector('#applySortOptions');
  applyBtn.onclick = function(e) {
    e.stopPropagation();
    if (sortMode === "maxWithdrawal") {
      const radios = overlay.querySelectorAll('input[name="maxWithdrawalBonus"]');
      radios.forEach(radio => {
        if (radio.checked) {
          maxWithdrawalBonusType = radio.value;
          GM_setValue("maxWithdrawalBonusType", maxWithdrawalBonusType);
        }
      });
    }
    sortDomainCards();
    updateSortButtonText();
    closeSortOptionsPopup();
  };

  // Set up the cancel button
  const cancelBtn = overlay.querySelector('#cancelSortOptions');
  cancelBtn.onclick = function(e) {
    e.stopPropagation();
    closeSortOptionsPopup();
  };

  // Clicking outside the modal closes the popup.
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) {
      closeSortOptionsPopup();
    }
  });
}

function closeSortOptionsPopup() {
  const overlay = document.getElementById('sortOptionsOverlay');
  if (overlay) {
    overlay.classList.remove('active');
    overlay.style.display = 'none';
  }
}



function applySearchFilter() {
    const searchValue = document.getElementById('sortSearchInput').value.toLowerCase().trim();
    const cards = document.querySelectorAll('.site-card');
    cards.forEach(card => {
        const domain = card.getAttribute('data-domain') || "";
        if (domain.toLowerCase().includes(searchValue)) {
            card.style.display = "block";
        } else {
            card.style.display = "none";
        }
    });
}

    function compareNumbers(a, b) {
    const valA = parseFloat(a) || 0;
    const valB = parseFloat(b) || 0;
    return valB - valA;
}

// Helper: Return 1 for missing bonus data (to push error domains to the bottom), 0 otherwise.
function isErrorDomain(info) {
    return info ? 0 : 1;
}

     // Update toggle buttons appearance
    function updateToggleButtons() {
        const navBtn = document.getElementById('toggleAutoNavNonVisited');
        const validBtn = document.getElementById('toggleAutoNavValid');
        const autoLoginBtn = document.getElementById('toggleAutoLogin');

        if (navBtn) {
            navBtn.textContent = `Auto Non-Visited: ${autoNavNonVisited ? 'ON' : 'OFF'}`;
            navBtn.classList.remove('red', 'green');
            navBtn.classList.add(autoNavNonVisited ? 'green' : 'red');
        }

        if (validBtn) {
            validBtn.textContent = `Auto Valid: ${autoNavValid ? 'ON' : 'OFF'}`;
            validBtn.classList.remove('red', 'green');
            validBtn.classList.add(autoNavValid ? 'green' : 'red');
        }

        if (autoLoginBtn) {
            autoLoginBtn.textContent = `Auto Login: ${autoLogin ? 'ON' : 'OFF'}`;
            autoLoginBtn.classList.remove('red', 'green');
            autoLoginBtn.classList.add(autoLogin ? 'green' : 'red');
        }
    }

    // Updated toggleNavNonVisited to immediately start navigation
    function toggleNavNonVisited() {
    autoNavNonVisited = !autoNavNonVisited;
    GM_setValue("autoNavNonVisited", autoNavNonVisited);

    // When autoNavNonVisited is enabled, force autoNavValid to false.
    if (autoNavNonVisited) {
        autoNavValid = false;
        GM_setValue("autoNavValid", false);
    }

    updateToggleButtons();

    if (autoNavNonVisited) {
        updateStatusWithColor("Auto navigation enabled - will automatically move to next non-visited domain", true);

        // Check if current domain already has merchant ID
        const currentDomain = extractBaseDomain(window.location.href);
        if (currentDomain && merchantIdData[currentDomain]?.merchantId) {
            // We already have merchant ID, go to next domain that needs it
            setTimeout(goToNextDomain, 1000);
        } else if (currentDomain && domainList.includes(currentDomain)) {
            // Current domain needs merchant ID - wait for it to be captured
            updateStatusWithColor(`Waiting for merchant ID on ${currentDomain}`, true);
        }
    } else {
        updateStatusWithColor("Auto navigation disabled", false);
    }
}

    function toggleNavValid() {
  openAutoValidOptionsPopup();
}

    // Replace the toggleAutoLogin function with this enhanced version
function toggleAutoLogin() {
    autoLogin = !autoLogin;
    GM_setValue("autoLogin", autoLogin);
    updateToggleButtons();

    if (autoLogin) {
        updateStatusWithColor("Auto-login enabled - will now login, save data, and navigate through domains", true);

        // Start auto-login process immediately if we're on a domain in our list
        const currentDomain = extractBaseDomain(window.location.href);
        if (currentDomain && domainList.includes(currentDomain)) {
            // Check if we have merchant ID for this domain
            if (merchantIdData[currentDomain]?.merchantId) {
                setTimeout(tryAutoLogin, 500);
            } else {
                updateStatusWithColor(`Waiting for merchant ID capture for ${currentDomain} before auto-login`, false);
            }
        }
    } else {
        updateStatusWithColor("Auto-login disabled", false);
    }
}

    /***********************************************
     *             DOMAIN CARDS & UI               *
     ***********************************************/
    // Create and update the current domain card

function createCurrentDomainCard() {
    let container = document.getElementById('currentDomainCardContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'currentDomainCardContainer';
        // Insert this container at the top of the main GUI content.
        const guiContent = document.getElementById('guiContent');
        guiContent.insertBefore(container, guiContent.firstChild);
    }
    // Always update the current domain card.
    updateCurrentDomainCard();
}


    function checkAndCaptureBonusDataAfterLoad() {
    const currentDomain = extractBaseDomain(window.location.href);
    if (!domainList.includes(currentDomain)) {
        //(`[Bonus Checker] ${currentDomain} is not in the list. Skipping bonus capture.`);
        updateCurrentDomainCard();
        return;
    }
    let attempts = 0;
    const maxAttempts = 5;

    function attemptCapture() {
        attempts++;
        //(`[Bonus Checker] Attempt ${attempts}/${maxAttempts} to capture bonus data for ${currentDomain}`);
        if (temporaryBonusData[currentDomain]) {
            //(`[Bonus Checker] Bonus data already exists for ${currentDomain}`);
            return;
        }
        if (!merchantIdData[currentDomain]?.merchantId) {
            //(`[Bonus Checker] No merchant ID for ${currentDomain} yet, retrying immediately...`);
            if (attempts < maxAttempts) {
                attemptCapture(); // Call immediately with no delay
            }
            return;
        }
        // We have a merchant ID; try to fetch bonus data.
        const merchantId = merchantIdData[currentDomain].merchantId;
        const accessId = merchantIdData[currentDomain].accessId || "";
        const accessToken = merchantIdData[currentDomain].accessToken || "";
        if (accessId && accessToken) {
            //(`[Bonus Checker] Using tokens to fetch bonus data for ${currentDomain}`);
            forceSyncDataCapture(currentDomain, merchantId, accessId, accessToken);
        } else if (attempts < maxAttempts) {
            //(`[Bonus Checker] No tokens available, attempting login for ${currentDomain}`);
            tryDomainLogin(currentDomain, attemptCapture);
        }
    }
    attemptCapture();
}

// Helper function to force a syncData capture using existing tokens
function forceSyncDataCapture(domain, merchantId, accessId, accessToken) {
    let syncParams = new URLSearchParams();
    syncParams.set("module", "/users/syncData");
    syncParams.set("merchantId", merchantId);
    syncParams.set("domainId", "0");
    syncParams.set("accessId", accessId);
    syncParams.set("accessToken", accessToken);
    syncParams.set("walletIsAdmin", "");

    let apiUrl = `https://${domain}/api/v1/index.php`;

    GM_xmlhttpRequest({
        method: "POST",
        url: apiUrl,
        headers: {
            "Accept": "*/*",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
        },
        data: syncParams.toString(),
        timeout: 5000,
        onload: function(response) {
            try {
                let parsed = JSON.parse(response.responseText);
                if (parsed.status === "SUCCESS" && parsed.data) {
                    //(`[Bonus Checker] Successfully captured bonus data for ${domain}`);
                    const bonusData = filterBonuses(parsed, domain);
                    temporaryBonusData[domain] = bonusData;

                    // Update UI
                    updateCurrentDomainCard();

                    // Update last captured info
                    lastCapturedDomain = domain;
                    lastCapturedBonus = parsed.data;
                    renderLastCapturedInfo();
                } else {
                    //(`[Bonus Checker] Failed to capture bonus data: ${parsed.message || 'Unknown error'}`);
                    if (parsed.message && parsed.message.toLowerCase().includes("token")) {
                        // Token is likely invalid, clear it for future login attempt
                        delete merchantIdData[domain].accessId;
                        delete merchantIdData[domain].accessToken;
                        GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));
                    }
                }
            } catch(e) {
                console.error(`[Bonus Checker] Error parsing syncData response: ${e.message}`);
            }
        },
        onerror: function() {
            console.error(`[Bonus Checker] Network error during forceSyncDataCapture for ${domain}`);
        },
        ontimeout: function() {
            console.error(`[Bonus Checker] Timeout during forceSyncDataCapture for ${domain}`);
        }
    });
}

// Helper function to attempt login for a domain
function tryDomainLogin(domain, callback) {
    const merchantId = merchantIdData[domain]?.merchantId;
    if (!merchantId) {
        console.error(`[Bonus Checker] Cannot login - no merchant ID for ${domain}`);
        if (callback) callback();
        return;
    }

    // Use domain-specific credentials if available
    const creds = domainCredentials[domain] || { phone: defaultPhone, password: defaultPassword };

    let params = new URLSearchParams();
    params.set("mobile", creds.phone);
    params.set("password", creds.password);
    params.set("module", "/users/login");
    params.set("merchantId", merchantId);
    params.set("domainId", "0");
    params.set("accessId", "");
    params.set("accessToken", "");
    params.set("walletIsAdmin", "");

    let loginUrl = `https://${domain}/api/v1/index.php`;

    GM_xmlhttpRequest({
        method: "POST",
        url: loginUrl,
        headers: {
            "Accept": "*/*",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
        },
        data: params.toString(),
        timeout: 5000,
        onload: function(response) {
            try {
                let resp = JSON.parse(response.responseText);
                if (resp.status === "SUCCESS" && resp.data.token && resp.data.id) {
                    //(`[Bonus Checker] Login successful for ${domain}`);

                    // Store the credentials
                    merchantIdData[domain].accessId = resp.data.id;
                    merchantIdData[domain].accessToken = resp.data.token;
                    GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));

                    // Now immediately make a syncData request
                    forceSyncDataCapture(domain, merchantId, resp.data.id, resp.data.token);
                } else {
                    console.error(`[Bonus Checker] Login failed for ${domain}: ${resp.message || 'Unknown error'}`);
                }
            } catch(e) {
                console.error(`[Bonus Checker] Error parsing login response: ${e.message}`);
            }

            if (callback) callback();
        },
        onerror: function() {
            console.error(`[Bonus Checker] Network error during login for ${domain}`);
            if (callback) callback();
        },
        ontimeout: function() {
            console.error(`[Bonus Checker] Timeout during login for ${domain}`);
            if (callback) callback();
        }
    });
}
// Update the updateCurrentDomainCard function for better compactness

    // Setup a periodic check to ensure UI state is consistent
    function setupPeriodicStateCheck() {
        // Check every 2 seconds
        const checkInterval = setInterval(() => {
            // 1. Ensure current domain card is on top


            // 2. Ensure minimized state is applied correctly
            const container = document.getElementById('bonus-checker-container');
            if (container) {
                const isMinimized = GM_getValue("minimized", false);

                // If the stored state says minimized but the container isn't minimized, fix it
                if (isMinimized && !container.classList.contains('minimized')) {
                    container.classList.add('minimized');
                }
                // If the stored state says not minimized but the container is minimized, fix it
                else if (!isMinimized && container.classList.contains('minimized')) {
                    container.classList.remove('minimized');
                }
            }

            // 3. Ensure maximize button is visible in minimized mode
            const maximizeBtn = document.getElementById('maximizeTracker');
            if (maximizeBtn && container && container.classList.contains('minimized')) {
                maximizeBtn.style.display = 'block';
            }

        }, 2000);

        // Store the interval ID so we can clear it later if needed
        window.stateCheckInterval = checkInterval;
    }

    // Display last captured info
    function renderLastCapturedInfo() {
        const el = document.getElementById('lastCapturedInfo');
        if (!el) return;

        if (!lastCapturedDomain || !lastCapturedBonus) {
            el.textContent = 'No bonus captured yet';
            return;
        }

        el.textContent = `${lastCapturedDomain} - Last bonus captured`;
    }

    // Update progress bar
    // Updated progress bar function with smooth animation and 100% fill on completion


    /***********************************************
     *               SORT FUNCTIONALITY            *
     ***********************************************/
    // Only sorting the current card - not storing multiple domain data
    // Replace the sortDomainCards function with this version that actually sorts cards
    function updateLastValidDomain(domain) {
        if (domainList.includes(domain)) {
            lastValidListedDomain = domain;
            GM_setValue("lastValidDomain", domain);
        }
    }

    function getCurrentDisplayDomain() {
    const currentDomain = extractBaseDomain(window.location.href);
    if (domainList.includes(currentDomain)) {
        // Save this as the last valid domain.
        GM_setValue("lastValidDomain", currentDomain);
        return currentDomain;
    } else {
        // Not listed – fall back to the stored last valid domain (if any)
        const storedLast = GM_getValue("lastValidDomain", null);
        return storedLast || currentDomain;
    }
}

    // Replace the showValidBonuses function to actually filter cards
    function showValidBonuses() {
        const cards = document.querySelectorAll('.site-card');
        let count = 0;

        cards.forEach(card => {
            const domain = card.getAttribute('data-domain');
            if (!domain) return;

            const bonusData = temporaryBonusData[domain];
            const hasValid = bonusData && (
                (bonusData.commission && bonusData.commission.amount > 0) ||
                (bonusData.share && bonusData.share.amount > 0) ||
                (bonusData.referral && bonusData.referral.amount > 0)
            );

            if (hasValid || card.classList.contains('current-domain-card')) {
                card.style.display = 'block';
                count++;
            } else {
                card.style.display = 'none';
            }
        });

        sortDomainCards();
        updateStatusWithColor(`Showing ${count} site(s) with valid bonus.`, true);
    }

    function refreshLastVisited() {
    // If current URL is in the list, use it; otherwise, use the stored last valid domain.
    let currentDomain = extractBaseDomain(window.location.href);
    let domainToRefresh = domainList.includes(currentDomain)
        ? currentDomain
        : GM_getValue("lastValidDomain", null);

    if (!domainToRefresh) {
        updateStatusWithColor('No last valid domain to refresh.', false);
        return;
    }

    updateStatusWithColor(`Refreshing bonus data for ${domainToRefresh}...`, true);

    // Clear cached data and force a refresh.
    temporaryBonusData[domainToRefresh] = null;
    checkDomain(domainToRefresh, true).then(() => {
         // Pass the refreshed domain into updateCurrentDomainCard.
         updateCurrentDomainCard(domainToRefresh);
         updateStatusWithColor(`Updated bonus data for ${domainToRefresh}`, true);
    });
}
    // Replace the tryAutoLogin function with this enhanced version
    // Fixed version - checks if USER key already exists with valid token
    // Simplified version - just checks if USER key exists with any data
    // Updated version that uses domain-specific credentials if available
    function tryAutoLogin(domain, callback) {
  domain = domain || getCurrentDisplayDomain();

  // Check if USER already exists in localStorage.
  const storedUser = localStorage.getItem("USER");
  if (storedUser) {
    try {
      const userData = JSON.parse(storedUser);
      if (userData && userData.token) {
        updateStatusWithColor(`[AutoLogin] Already logged in for ${domain}. Skipping auto-login.`, 'success');
        if (callback) callback();
        return;
      }
    } catch (e) {
      updateStatusWithColor(`[AutoLogin] Error parsing stored USER data: ${e.message}. Proceeding with login.`, 'error');
    }
  }

  const merchantData = merchantIdData[domain];
  if (!merchantData || !merchantData.merchantId) {
    updateStatusWithColor(`[AutoLogin] Missing merchant ID for ${domain}. Cannot auto-login.`, 'error');
    if (callback) callback();
    return;
  }

  // If tokens are already stored, use them.
  if (merchantData.accessToken && merchantData.accessId) {
    updateStatusWithColor(`[AutoLogin] Found stored tokens for ${domain}. Using them.`, 'info');
    const userData = {
      token: merchantData.accessToken,
      id: merchantData.accessId,
      timestamp: Date.now()
    };
    localStorage.setItem("USER", JSON.stringify(userData));
    updateStatusWithColor(`[AutoLogin] USER object set in localStorage for ${domain}.`, 'info');
    forceSyncDataCapture(domain, merchantData.merchantId, merchantData.accessId, merchantData.accessToken);
    updateStatusWithColor(`[AutoLogin] Sent syncData request with stored tokens for ${domain}.`, 'info');
    setTimeout(() => {
      updateStatusWithColor(`[AutoLogin] Reloading page for ${domain} to update login state.`, 'info');
      window.location.reload();
    }, 1000);
    if (callback) callback();
    return;
  }

  // Otherwise, proceed to perform the login request.
  updateStatusWithColor(`[AutoLogin] No stored tokens for ${domain}. Initiating login request...`, 'info');
  const domainCreds = domainCredentials[domain] || { phone: defaultPhone, password: defaultPassword };
  let params = new URLSearchParams();
  params.set("mobile", domainCreds.phone);
  params.set("password", domainCreds.password);
  params.set("module", "/users/login");
  params.set("merchantId", merchantData.merchantId);
  params.set("domainId", "0");
  params.set("accessId", "");
  params.set("accessToken", "");
  params.set("walletIsAdmin", "");

  let loginUrl = `https://${domain}/api/v1/index.php`;
  updateStatusWithColor(`[AutoLogin] Sending login request to ${loginUrl} for ${domain}.`, 'info');

  GM_xmlhttpRequest({
    method: "POST",
    url: loginUrl,
    headers: {
      "Accept": "*/*",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
    },
    data: params.toString(),
    timeout: 10000,
    onload: function(response) {
      updateStatusWithColor(`[AutoLogin] Received login response for ${domain}.`, 'info');
      try {
        let resp = JSON.parse(response.responseText);
        if (String(resp.status).toUpperCase() === "SUCCESS" && resp.data && resp.data.token && resp.data.id) {
          updateStatusWithColor(`[AutoLogin] Login successful for ${domain}. Capturing tokens...`, 'success');
          merchantData.accessId = resp.data.id;
          merchantData.accessToken = resp.data.token;
          GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));
          // Store login state in localStorage.
          const userData = {
            token: resp.data.token,
            id: resp.data.id,
            timestamp: Date.now()
          };
          localStorage.setItem("USER", JSON.stringify(userData));
          updateStatusWithColor(`[AutoLogin] Tokens stored. Requesting syncData for ${domain}.`, 'info');
          forceSyncDataCapture(domain, merchantData.merchantId, resp.data.id, resp.data.token);
          setTimeout(() => {
            updateStatusWithColor(`[AutoLogin] Reloading page for ${domain} after login.`, 'info');
            window.location.reload();
          }, 1000);
        } else {
          updateStatusWithColor(`[AutoLogin] Login failed for ${domain}: ${resp.message || 'Unknown error'}`, 'error');
        }
      } catch (e) {
        updateStatusWithColor(`[AutoLogin] Parse error during login for ${domain}: ${e.message}`, 'error');
      }
      if (callback) callback();
    },
    onerror: function() {
      updateStatusWithColor(`[AutoLogin] Network error during login for ${domain}.`, 'error');
      if (callback) callback();
    },
    ontimeout: function() {
      updateStatusWithColor(`[AutoLogin] Login request timed out for ${domain}.`, 'error');
      if (callback) callback();
    }
  });
}

    // Function to verify if a domain's token is valid
    // Returns a promise that resolves with a boolean indicating validity
    function verifyDomainToken(domain) {
        return new Promise((resolve) => {
            // Check if we have stored tokens
            const merchantData = merchantIdData[domain];
            if (!merchantData || !merchantData.merchantId || !merchantData.accessId || !merchantData.accessToken) {
                resolve(false);
                return;
            }

            // We have tokens, but we need to check if they're valid
            // by making a syncData request
            const merchantId = merchantData.merchantId;
            const accessId = merchantData.accessId;
            const accessToken = merchantData.accessToken;

            let syncParams = new URLSearchParams();
            syncParams.set("module", "/users/syncData");
            syncParams.set("merchantId", merchantId);
            syncParams.set("domainId", "0");
            syncParams.set("accessId", accessId);
            syncParams.set("accessToken", accessToken);
            syncParams.set("walletIsAdmin", "");

            let apiUrl = `https://${domain}/api/v1/index.php`;

            // Make a lightweight request just to test the token
            GM_xmlhttpRequest({
                method: "POST",
                url: apiUrl,
                headers: {
                    "Accept": "*/*",
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
                },
                data: syncParams.toString(),
                timeout: 5000, // short timeout since we're just checking validity
                onload: function(response) {
                    try {
                        let parsed = JSON.parse(response.responseText);
                        // Token is valid if the request succeeds
                        if (parsed.status === "SUCCESS") {
                            // Update our stored bonus data while we're at it
                            if (parsed.data) {
                                const bonusData = filterBonuses(parsed, domain);
                                if (bonusData) {
                                    temporaryBonusData[domain] = bonusData;
                                    // Update the display if this is the current domain
                                    const currentDomain = extractBaseDomain(window.location.href);
                                    if (domain === currentDomain) {
                                        updateCurrentDomainCard();
                                    }
                                }
                            }
                            // Token is valid
                            resolve(true);
                        } else {
                            // Check for token-related errors
                            if (parsed.message && (
                                parsed.message.toLowerCase().includes("token") ||
                                parsed.message.toLowerCase().includes("auth") ||
                                parsed.message.toLowerCase().includes("login")
                            )) {
                                // Token is invalid - remove it
                                delete merchantData.accessId;
                                delete merchantData.accessToken;
                                GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));
                                resolve(false);
                            } else {
                                // Other error, but token might still be valid
                                resolve(true);
                            }
                        }
                    } catch(e) {
                        // Error parsing response - assume token is invalid
                        resolve(false);
                    }
                },
                onerror: function() {
                    // Network error - can't determine token validity
                    // In this case, we'll assume it's valid to avoid unnecessary logins
                    resolve(true);
                },
                ontimeout: function() {
                    // Timeout - can't determine token validity
                    // In this case, we'll assume it's valid to avoid unnecessary logins
                    resolve(true);
                }
            });
        });
    }

    // Add this new function to handle auto syncData after login
    // Fixed version - instant refresh, no auto-navigation
    function performAutoSyncDataRequestSafely(domain, loginUrl, accessId, accessToken, merchantId) {
        updateStatusWithColor(`Performing syncData request for ${domain}...`, true);

        let syncParams = new URLSearchParams();
        syncParams.set("module", "/users/syncData");
        syncParams.set("merchantId", merchantId);
        syncParams.set("domainId", "0");
        syncParams.set("accessId", accessId);
        syncParams.set("accessToken", accessToken);
        syncParams.set("walletIsAdmin", "");

        GM_xmlhttpRequest({
            method: "POST",
            url: loginUrl,
            headers: {
                "Accept": "*/*",
                "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
            },
            data: syncParams.toString(),
            timeout: 10000,
            onload: function(response) {
                try {
                    let parsed = JSON.parse(response.responseText);
                    if (parsed.status === "SUCCESS" && parsed.data) {
                        updateStatusWithColor(`SyncData successful for ${domain}`, true);

                        const existingUserData = localStorage.getItem("USER");
                        if (!existingUserData || existingUserData.length < 5) {
                            const userData = {
                                token: accessToken,
                                id: accessId,
                                syncData: parsed.data,
                                timestamp: Date.now()
                            };
                            localStorage.setItem("USER", JSON.stringify(userData));
                            updateStatusWithColor(`USER data stored for ${domain}`, true);
                        } else {
                            updateStatusWithColor(`Existing USER data detected for ${domain}, not overwriting.`, true);
                        }

                        // Dispatch events to inform the page about the USER data change
                        window.location.reload();
                    } else {
                        updateStatusWithColor(`SyncData failed for ${domain}: ${parsed.message || 'Unknown error'}`, false);
                    }
                } catch(e) {
                    updateStatusWithColor(`Parse error during syncData for ${domain}: ${e.message}`, false);
                }
            },
            onerror: function() {
                updateStatusWithColor(`Network error during syncData for ${domain}`, false);
            }
        });
    }

    /***********************************************
     *           CHECK BONUSES FUNCTIONALITY       *
     ***********************************************/
    // Main function to check all bonuses
    // Replace the checkAllBonuses function to create and display cards for all domains
    // Modified checkAllBonuses function with current domain card always shown
    // Modified checkAllBonuses function with current domain card always shown
   async function checkAllBonuses() {
    // In this updated version, we simply call fetchFreshBonusData().
    fetchFreshBonusData();
}


    async function fetchNewBonusData() {
    // Clear previous state
    activeChecks.clear();
    processedCount = 0;

    // Ensure current domain card exists
    createCurrentDomainCard();

    // Process every domain from your list (even if merchant data is missing)
    const validDomains = domainList;
    totalSites = validDomains.length;
    

    if (totalSites === 0) {
        updateStatusWithColor('No domains found in your list.', 'warning');
        isFetchingBonusData = false;
        return;
    }

    // Create batches based on BATCH_SIZE defined at the top
    const batches = [];
    for (let i = 0; i < validDomains.length; i += BATCH_SIZE) {
        batches.push(validDomains.slice(i, i + BATCH_SIZE));
    }

    updateStatusWithColor(
        `Processing ${validDomains.length} domains in ${batches.length} batches of up to ${BATCH_SIZE} domains each`,
        'info',
        { processed: 0, total: totalSites }
    );

    // Process each batch
    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        const batchStart = Date.now();

        updateStatusWithColor(
            `Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} domains)`,
            'info',
            { processed: processedCount, total: totalSites }
        );

        // Process all domains in this batch concurrently
        await Promise.all(batch.map(domain =>
            checkDomain(domain, true).then(() => {
                // Update UI immediately for this domain
                updateBonusDisplay(temporaryBonusData[domain], `https://${domain}`);
                processedCount++;
                
            }).catch(error => {
                console.error(`Error checking domain ${domain}:`, error);
                updateBonusDisplay(null, `https://${domain}`, `Error: ${error.message || 'Unknown error'}`);
                processedCount++;
                
            })
        ));

        const batchDuration = ((Date.now() - batchStart) / 1000).toFixed(1);
        updateStatusWithColor(
            `Completed batch ${batchIndex + 1}/${batches.length} in ${batchDuration}s`,
            'success',
            { processed: processedCount, total: totalSites }
        );
    }

    // Save fresh bonus data for domains that returned data
    const freshBonusData = {};
    validDomains.forEach(domain => {
        if (temporaryBonusData[domain]) {
            freshBonusData[domain] = temporaryBonusData[domain];
        }
    });

    try {
        GM_setValue("cached_bonus_data", JSON.stringify(freshBonusData));
        GM_setValue("cached_bonus_timestamp", Date.now().toString());
        updateStatusWithColor(
            'All checks completed. Data saved for next time.',
            'success',
            { processed: totalSites, total: totalSites }
        );
        visitedDomains = [];
        GM_setValue("visitedDomains", visitedDomains);
    } catch (e) {
        console.error("Error saving bonus data:", e);
        updateStatusWithColor(
            'Error saving bonus data to cache.',
            'error',
            { processed: processedCount, total: totalSites }
        );
    }

    sortDomainCards();
    updateCurrentDomainCard();
}

// Improved checkDomain function with better retry logic and timeout handling


    // Main function that triggers the batch processing
// Global variable to track if a fetch operation is in progress

async function fetchFreshBonusData() {
  if (isFetchingBonusData) {
    updateStatusWithColor(`[FetchBonus] Bonus data fetch already in progress. Please wait...`, 'warning');
    return;
  }
  isFetchingBonusData = true;
  showingLastData = false;
  activeChecks.clear();
  processedCount = 0;
  totalSites = domainList.length;

  updateStatusWithColor(`[FetchBonus] Initiating bonus data fetch for ${totalSites} domains.`, 'info', { processed: 0, total: totalSites });

  // Ensure GUI is in live-check mode.
  const container = document.getElementById('bonus-checker-container');
  if (container) container.classList.remove('live-check-mode');

  // Divide domains into batches.
  const batches = [];
  for (let i = 0; i < domainList.length; i += BATCH_SIZE) {
    batches.push(domainList.slice(i, i + BATCH_SIZE));
  }
  updateStatusWithColor(`[FetchBonus] Divided domains into ${batches.length} batch(es).`, 'info');

  // Process each batch sequentially.
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const batchStartTime = Date.now();
    updateStatusWithColor(`[FetchBonus] Starting batch ${batchIndex + 1}/${batches.length} (${batch.length} domains).`, 'info', { processed: processedCount, total: totalSites });

    await Promise.all(batch.map(domain =>
      checkDomain(domain, true)
        .then(() => {
          processedCount++;
          updateBonusDisplay(temporaryBonusData[domain], `https://${domain}`);
          updateStatusWithColor(`[FetchBonus] Processed ${processedCount}/${totalSites} domains so far.`, 'info', { processed: processedCount, total: totalSites });
        })
        .catch(error => {
          console.error(`[FetchBonus] Error checking ${domain}:`, error);
          processedCount++;
          updateBonusDisplay(null, `https://${domain}`, `Error: ${error.message || 'Unknown error'}`);
          updateStatusWithColor(`[FetchBonus] Processed ${processedCount}/${totalSites} domains (with errors).`, 'warning', { processed: processedCount, total: totalSites });
        })
    ));

    const batchDuration = ((Date.now() - batchStartTime) / 1000).toFixed(1);
    updateStatusWithColor(`[FetchBonus] Completed batch ${batchIndex + 1}/${batches.length} in ${batchDuration}s.`, 'success', { processed: processedCount, total: totalSites });
  }

  // Save fresh bonus data to persistent cache.
  const freshBonusData = {};
  domainList.forEach(domain => {
    if (temporaryBonusData[domain]) {
      freshBonusData[domain] = temporaryBonusData[domain];
    }
  });

  try {
    GM_setValue("cached_bonus_data", JSON.stringify(freshBonusData));
    GM_setValue("cached_bonus_timestamp", Date.now().toString());
    updateStatusWithColor(`[FetchBonus] Bonus data saved to cache. Proceeding to sort domains.`, 'info', { processed: totalSites, total: totalSites });
  } catch (e) {
    console.error(`[FetchBonus] Error saving bonus data:`, e);
    updateStatusWithColor(`[FetchBonus] Error saving bonus data to cache.`, 'error', { processed: processedCount, total: totalSites });
  }

  updateStatusWithColor(`[FetchBonus] Sorting domain cards by ${sortMode}...`, 'info');
  sortDomainCards();
  updateCurrentDomainCard();

  // Count the errors by checking domains with an "error" property.
  const errorCount = domainList.filter(domain =>
    temporaryBonusData[domain] && temporaryBonusData[domain].error
  ).length;

  updateStatusWithColor(`[FetchBonus] Fetch complete. Processed ${totalSites} domains with ${errorCount} error(s). Domains are now sorted by ${sortMode}.`, 'success', { processed: totalSites, total: totalSites });

  isFetchingBonusData = false;
}

// Wrapper function to handle any errors during batch processing
async function showCurrentDomainOnly() {
    const results = document.getElementById('resultsArea');
    if (!results) return;

    // Keep only the current domain card
    const currentDomain = getCurrentDisplayDomain();
    const cards = document.querySelectorAll('.site-card');
    let count = 0;

    cards.forEach(card => {
        const domain = card.getAttribute('data-domain');
        if (!domain || domain !== currentDomain) {
            if (!card.classList.contains('current-domain-card')) {
                card.style.display = 'none';
            }
        } else {
            count++;
            card.style.display = 'block';
        }
    });

    updateStatusWithColor(`Showing only current domain: ${currentDomain}`, true);

    // Force update of the current domain card
    updateCurrentDomainCard();
}

    // New function: "showCachedBonuses" loads cached bonus data and displays it.
function showCachedBonuses() {
    try {
        // Use stored minimized state to decide what to display.
        const isMinimized = GM_getValue("minimized", false);
        const savedData = GM_getValue("cached_bonus_data", "{}");
        const storedBonusData = JSON.parse(savedData);
        const resultsArea = document.getElementById("resultsArea");

        if (isMinimized) {
            updateStatusWithColor("GUI minimized – showing only current domain bonus data.", true);
            if (resultsArea) {
                resultsArea.innerHTML = "";
            }
            updateCurrentDomainCard();
            return;
        }

        // If not minimized, proceed to display cached bonus data for all domains.
        if (Object.keys(storedBonusData).length > 0) {
            showingLastData = true;
            updateStatusWithColor("Displaying cached bonus data.", true);
            if (resultsArea) {
                // Clear the results area completely.
                resultsArea.innerHTML = "";
            }
            // Add the current domain card.
            updateCurrentDomainCard();
            const currentDomain = getCurrentDisplayDomain();
            // Loop through the cached data for domains other than the current one.
            for (const domain in storedBonusData) {
                if (domain === currentDomain) continue;
                let bonusData = storedBonusData[domain];
                bonusData.isStoredData = true;
                temporaryBonusData[domain] = bonusData;
                updateBonusDisplay(bonusData, `https://${domain}`);
            }
            sortDomainCards();
        } else {
            showingLastData = false;
            updateStatusWithColor("No cached bonus data found.", false);
        }
    } catch (e) {
        showingLastData = false;
        console.error("Error loading cached bonus data:", e);
        updateStatusWithColor("Error loading cached data.", false);
    }
}

// New helper function to bind claim button and card clicks.
function setupCardAndClaimClicks(card, domain) {
  // Bind claim buttons: stop propagation and call claimBonus.
  const claimButtons = card.querySelectorAll('.claim-btn');
  claimButtons.forEach(function(button) {
    button.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      const bonusType = button.getAttribute('data-type');
      claimBonus(domain, bonusType);
    });
  });
  // Bind card click: if the click did not come from a claim button, navigate to the domain.
  card.addEventListener('click', function(e) {
    if (!e.target.closest('.claim-btn')) {
      window.location.href = `https://${domain}`;
    }
  });
}

// Full updated updateBonusDisplay function.
function updateBonusDisplay(bonusData, url, error, forceShowAll = false) {
    const results = document.getElementById('resultsArea');
    if (!results) return;

    const domain = extractBaseDomain(url);
    if (!domain) return;

    // If not forcing full update and in live-check mode, only update the current domain card
    const container = document.getElementById('bonus-checker-container');
    if (!forceShowAll && container && container.classList.contains('live-check-mode') && domain !== getCurrentDisplayDomain()) {
         return;
    }

    // Skip update if this domain is the current one (its card is handled separately)
    const currentDomain = getCurrentDisplayDomain();
    if (domain === currentDomain) {
         return;
    }

    // If bonusData is provided, store it for later use.
    if (bonusData) {
        temporaryBonusData[domain] = bonusData;
    }

    // Look for an existing card for this domain (but not the current domain card)
    let card = document.querySelector(`.site-card[data-domain="${domain}"]:not(.current-domain-card)`);
    if (!card) {
        card = document.createElement('div');
        card.className = 'site-card';
        card.setAttribute('data-domain', domain);
        card.style.cursor = 'pointer';
        // When clicking the card (outside of any claim button), navigate to the domain.
        card.addEventListener('click', (e) => {
            if (e.target.closest('.claim-btn')) return;
            window.location.href = `https://${domain}`;
        });
        results.appendChild(card);
    }

    // If there's an error, display it and mark the card as invalid.
    if (error) {
        card.innerHTML = `
            <div style="font-weight: bold;">${domain}</div>
            <div class="error-message" style="color: #ff4444; font-weight: bold; margin-top: 5px;">
                Error: ${error}
            </div>
        `;
        card.classList.remove('valid-bonus', 'invalid-bonus');
        card.classList.add('invalid-bonus');
    } else if (bonusData) {
        // Destructure bonus data (ensure these keys exist in your bonusData object)
        const {
            cash,
            freeCreditMinWithdraw,
            freeCreditMaxWithdraw,
            commission,
            share,
            referral,
            globalMinWithdraw,
            globalMaxWithdraw
        } = bonusData;

        // Local helper functions to format bonus information.
        function formatBonusIndicator(amount) {
            return amount && amount > 0
                ? `<span style="color:lime;">Yes</span><strong style="color:#ffd700;"> (${amount})</strong>`
                : `<span style="color:red;">No</span>`;
        }

        function formatCommissionIndicator(c) {
            return c && c.amount > 0
                ? `<span style="color:lime;">Yes</span><strong style="color:#ffd700;"> (${c.amount})</strong>`
                : `<span style="color:red;">No</span>`;
        }

        // Calculate effective withdrawal limits.
        const { effectiveMin, effectiveMax } = getEffectiveWithdrawals(
            freeCreditMinWithdraw,
            freeCreditMaxWithdraw,
            globalMinWithdraw,
            globalMaxWithdraw
        );

        // Determine if any bonus is valid.
        const hasValidBonus = (
            (commission && commission.amount > 0) ||
            (share && share.amount > 0) ||
            (referral && referral.amount > 0)
        );
        card.classList.toggle('valid-bonus', hasValidBonus);
        card.classList.toggle('invalid-bonus', !hasValidBonus);

        // Build the inner HTML for the card.
        card.innerHTML = `
            <div style="font-weight: bold;">${domain}</div>
            <div class="top-row">
                <div>Bal: <strong style="color:#ffd700;">${cash ?? 0}</strong></div>
                <div>Comm: ${formatCommissionIndicator(commission)}</div>
                <div>Share: ${formatBonusIndicator(share?.amount)}</div>
                <div>Ref: ${formatBonusIndicator(referral?.amount)}</div>
            </div>
            <div class="bottom-row">
                <div>
                    <div>Withdrawals: <span style="color:#fff;">Min: ${effectiveMin}</span> / <span style="color:#fff;">Max: ${effectiveMax}</span></div>
                </div>
                <div>
                    ${
                        (commission && commission.amount > 0)
                            ? `
                                <div>Min: <span style="color:#fff;">${commission.minBet ?? '--'}</span>,
                                     Max: <span style="color:#fff;">${commission.maxWithdrawal ?? '--'}</span>
                                </div>
                                <button class="control-btn claim-btn" data-domain="${domain}" data-type="commission">
                                    Claim Comm
                                </button>
                              `
                            : `<div>&nbsp;</div>`
                    }
                </div>
                <div>
                    ${
                        (share && share.amount > 0)
                            ? `
                                <div>Min: <span style="color:#fff;">${share.minWithdrawal ?? '--'}</span>,
                                     Max: <span style="color:#fff;">${share.maxWithdrawal ?? '--'}</span>
                                </div>
                                <button class="control-btn claim-btn" data-domain="${domain}" data-type="share">
                                    Claim Share
                                </button>
                              `
                            : `<div>&nbsp;</div>`
                    }
                </div>
                <div>
                    ${
                        (referral && referral.amount > 0)
                            ? `
                                <div>MinW: <span style="color:#fff;">${referral.minWithdrawal ?? '--'}</span>,
                                     MaxW: <span style="color:#fff;">${referral.maxWithdrawal ?? '--'}</span>
                                </div>
                                <button class="control-btn claim-btn" data-domain="${domain}" data-type="referral">
                                    Claim Ref
                                </button>
                              `
                            : `<div>&nbsp;</div>`
                    }
                </div>
            </div>
        `;
    }

    // In cached mode, add a cache indicator; otherwise, remove any existing one.
    if (showingLastData) {
        addCacheIndicator(card);
    } else {
        const existingIndicator = card.querySelector('.cache-indicator');
        if (existingIndicator) {
            existingIndicator.remove();
        }
    }

    // Bind event listeners to the claim buttons so they do not trigger card navigation.
    const claimBtns = card.querySelectorAll(".claim-btn");
    claimBtns.forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            e.preventDefault();
            const d = btn.getAttribute('data-domain');
            const bonusType = btn.getAttribute('data-type');
            claimBonus(d, bonusType);
        });
    });

    // Persist the updated GUI state.
    persistGUIState();
}
    // Function to update bonus display with styling for cached/fresh data
       // Helper function to add cache indicator to cards
  function updateCurrentDomainCard(domainOverride) {
  const displayDomain = domainOverride || getCurrentDisplayDomain();
  if (!displayDomain) return;
  const resultsArea = document.getElementById('resultsArea');
  if (!resultsArea) return;

  // Remove any existing current domain card by id.
  const existingCard = resultsArea.querySelector('#currentDomainCardContainer');
  if (existingCard) {
    existingCard.remove();
  }

  let card = document.createElement('div');
  card.id = 'currentDomainCardContainer';
  card.className = 'site-card current-domain-card';
  card.setAttribute('data-domain', displayDomain);

  // Prepare merchant ID display.
  let merchantIdStatus = "";
  if (merchantIdData[displayDomain] && merchantIdData[displayDomain].merchantId) {
    merchantIdStatus = `<div style="color: #4CAF50;">Merchant ID: ${merchantIdData[displayDomain].merchantId}</div>`;
  } else {
    merchantIdStatus = `<div style="color: #ff4444;">Waiting for merchant ID...</div>`;
  }

  const bonusData = temporaryBonusData[displayDomain];

  // Local helper functions to format bonus info.
  function formatCommissionIndicator(c) {
    return c && c.amount > 0
      ? `<span style="color:lime;">Yes</span><strong style="color:#ffd700;"> (${c.amount})</strong>`
      : `<span style="color:red;">No</span>`;
  }
  function formatBonusIndicator(amount) {
    return amount && amount > 0
      ? `<span style="color:lime;">Yes</span><strong style="color:#ffd700;"> (${amount})</strong>`
      : `<span style="color:red;">No</span>`;
  }

  if (!bonusData) {
    card.innerHTML = `
      <div style="font-weight: bold;">${displayDomain} (Current)</div>
      ${merchantIdStatus}
      <div>Waiting for bonus data...</div>
    `;
    card.style.background = "rgba(0,0,0,0.2)";
    card.style.border = "1px solid #333";
  } else {
    const { cash, freeCreditMinWithdraw, freeCreditMaxWithdraw, commission, share, referral, globalMinWithdraw, globalMaxWithdraw } = bonusData;
    const { effectiveMin, effectiveMax } = getEffectiveWithdrawals(
      freeCreditMinWithdraw,
      freeCreditMaxWithdraw,
      globalMinWithdraw,
      globalMaxWithdraw
    );
    const hasValidBonus = (
      (commission && commission.amount > 0) ||
      (share && share.amount > 0) ||
      (referral && referral.amount > 0)
    );
    if (hasValidBonus) {
      card.style.background = "rgba(255,20,147,0.2)";
      card.style.border = "1px solid #ff1493";
      card.style.boxShadow = "0 0 12px rgba(255,20,147,0.8)";
    } else {
      card.style.background = "rgba(0,0,0,0.2)";
      card.style.border = "1px solid #333";
      card.style.boxShadow = "0 0 4px rgba(0,0,0,0.5)";
    }
    card.innerHTML = `
      <div style="font-weight: bold;">${displayDomain} (Current)</div>
      ${merchantIdStatus}
      <div class="top-row">
        <div><span>Bal:</span> <strong style="color:#ffd700;">${cash ?? 0}</strong></div>
        <div><span>Comm:</span> ${formatCommissionIndicator(commission)}</div>
        <div><span>Share:</span> ${formatBonusIndicator(share && share.amount)}</div>
        <div><span>Ref:</span> ${formatBonusIndicator(referral && referral.amount)}</div>
      </div>
      <div class="bottom-row">
        <div>
          <div>Withdrawals: <span style="color:#fff;">Min: ${effectiveMin}</span> / <span style="color:#fff;">Max: ${effectiveMax}</span></div>
        </div>
        ${
          (commission && commission.amount > 0)
            ? `<div>
                  <div>Min: <span style="color:#fff;">${commission.minBet ?? '--'}</span>,
                       Max: <span style="color:#fff;">${commission.maxWithdrawal ?? '--'}</span>
                  </div>
                  <button class="control-btn claim-btn" data-domain="${displayDomain}" data-type="commission">
                    Claim Comm
                  </button>
                </div>`
            : `<div>&nbsp;</div>`
        }
        ${
          (share && share.amount > 0)
            ? `<div>
                  <div>Min: <span style="color:#fff;">${share.minWithdrawal ?? '--'}</span>,
                       Max: <span style="color:#fff;">${share.maxWithdrawal ?? '--'}</span>
                  </div>
                  <button class="control-btn claim-btn" data-domain="${displayDomain}" data-type="share">
                    Claim Share
                  </button>
                </div>`
            : `<div>&nbsp;</div>`
        }
        ${
          (referral && referral.amount > 0)
            ? `<div>
                  <div>MinW: <span style="color:#fff;">${referral.minWithdrawal ?? '--'}</span>,
                       MaxW: <span style="color:#fff;">${referral.maxWithdrawal ?? '--'}</span>
                  </div>
                  <button class="control-btn claim-btn" data-domain="${displayDomain}" data-type="referral">
                    Claim Ref
                  </button>
                </div>`
            : `<div>&nbsp;</div>`
        }
      </div>
    `;
  }

  // Bind both claim buttons and overall card click events using the helper.
  setupCardAndClaimClicks(card, displayDomain);

  // Insert the current domain card at the top.
  resultsArea.insertBefore(card, resultsArea.firstChild);
  persistGUIState();
}


    function addCacheIndicator(card) {
    // First, remove any existing cache indicator.
    const existingIndicator = card.querySelector('.cache-indicator');
    if (existingIndicator) {
        existingIndicator.remove();
    }
    let cachedTime = "Cached";
    try {
        const timestamp = GM_getValue("cached_bonus_timestamp", null);
        if (timestamp) {
            const date = new Date(parseInt(timestamp));
            cachedTime = `Cached: ${date.toLocaleTimeString()}`;
        }
    } catch (e) {}
    card.style.borderLeftWidth = '4px';
    card.style.borderLeftColor = '#ff9800';
    card.style.position = 'relative';
    const cachedIndicator = document.createElement('div');
    cachedIndicator.className = 'cache-indicator';
    cachedIndicator.textContent = cachedTime;
    cachedIndicator.style.position = 'absolute';
    cachedIndicator.style.top = '2px';
    cachedIndicator.style.right = '2px';
    cachedIndicator.style.fontSize = '9px';
    cachedIndicator.style.padding = '2px 4px';
    cachedIndicator.style.backgroundColor = '#ff9800';
    cachedIndicator.style.color = 'white';
    cachedIndicator.style.borderRadius = '2px';
    card.appendChild(cachedIndicator);
}


    // Function to check a single domain using login approach from first script
    /**
     * Checks a single domain.
     * This version first clears any stored bonus data so that a fresh API call is forced.
     */
    // Modified checkDomain function that updates status with progress
// Build the dynamic request body from merchantIdData (if available)
function buildSyncRequestBody(domain) {
  const data = merchantIdData[domain] || {};
  // Use dynamic values if available; otherwise, empty strings
  const merchantId = data.merchantId || "";
  const accessId = data.accessId || "";
  const accessToken = data.accessToken || "";
  const walletIsAdmin = data.walletIsAdmin || "";
  return new URLSearchParams({
    module: "/users/syncData",
    merchantId: merchantId,
    domainId: "0",
    accessId: accessId,
    accessToken: accessToken,
    walletIsAdmin: walletIsAdmin
  }).toString();
}

function checkDomain(domain, forceRefresh = false, retry = false) {
  return new Promise((resolve) => {
    updateStatusWithColor(`[CheckDomain] Checking ${domain}. ForceRefresh: ${forceRefresh} | Retry: ${retry}`, 'info');
    // Clear any previous bonus data for this domain.
    temporaryBonusData[domain] = null;
    activeChecks.add(domain);

    // Set an overall timeout (e.g., 100 seconds).
    const overallTimeoutId = setTimeout(() => {
      activeChecks.delete(domain);
      const errorMsg = `[CheckDomain] Timeout (100s) reached for ${domain}`;
      // Always set an error property so our final error count sees it.
      temporaryBonusData[domain] = { error: errorMsg };
      if (domain === getCurrentDisplayDomain()) {
        updateCurrentDomainCard();
      } else {
        updateBonusDisplay(null, `https://${domain}`, errorMsg);
      }
      updateStatusWithColor(errorMsg, 'error');
      resolve();
    }, 100000);

    const merchantData = merchantIdData[domain];
    if (!merchantData || !merchantData.merchantId || !merchantData.accessId || !merchantData.accessToken) {
      clearTimeout(overallTimeoutId);
      activeChecks.delete(domain);
      const errorMsg = `[CheckDomain] Missing required token data for ${domain}`;
      // Always set an error property
      temporaryBonusData[domain] = { error: errorMsg };
      if (domain === getCurrentDisplayDomain()) {
        updateCurrentDomainCard();
      } else {
        updateBonusDisplay(null, `https://${domain}`, errorMsg);
      }
      updateStatusWithColor(errorMsg, 'error');
      resolve();
      return;
    }

    const { accessId, accessToken, merchantId } = merchantData;
    let syncParams = new URLSearchParams();
    syncParams.set("module", "/users/syncData");
    syncParams.set("merchantId", merchantId);
    syncParams.set("domainId", "0");
    syncParams.set("accessId", accessId);
    syncParams.set("accessToken", accessToken);
    syncParams.set("walletIsAdmin", "");

    let apiUrl = `https://${domain}/api/v1/index.php`;
    updateStatusWithColor(`[CheckDomain] Sending syncData request for ${domain} to ${apiUrl}.`, 'info');

    GM_xmlhttpRequest({
      method: "POST",
      url: apiUrl,
      headers: {
        "Accept": "*/*",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
      },
      data: syncParams.toString(),
      timeout: 100000,
      onload: function(response) {
        updateStatusWithColor(`[CheckDomain] Received response for ${domain}.`, 'info');
        try {
          let parsed = JSON.parse(response.responseText);
          if (String(parsed.status).toUpperCase() === "SUCCESS" && parsed.data) {
            updateStatusWithColor(`[CheckDomain] Successfully retrieved bonus data for ${domain}.`, 'success');
            let bonusData = filterBonuses(parsed, domain);
            temporaryBonusData[domain] = bonusData;
            if (domain === getCurrentDisplayDomain()) {
              updateCurrentDomainCard();
            } else {
              updateBonusDisplay(bonusData, `https://${domain}`);
            }
            lastCapturedDomain = domain;
            lastCapturedBonus = parsed.data;
            renderLastCapturedInfo();
            clearTimeout(overallTimeoutId);
            activeChecks.delete(domain);
            resolve();
            return;
          } else {
            // If error indicates token issues, attempt token refresh.
            if (parsed.message && parsed.message.toLowerCase().includes("token")) {
              updateStatusWithColor(`[CheckDomain] Token error for ${domain}: ${parsed.message}. Initiating token refresh via auto-login.`, 'warning');
              delete merchantData.accessId;
              delete merchantData.accessToken;
              GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));
              tryAutoLogin(domain, function() {
                setTimeout(() => {
                  checkDomain(domain, forceRefresh, true).then(resolve);
                }, 1000);
              });
              return;
            }
            clearTimeout(overallTimeoutId);
            activeChecks.delete(domain);
            const errMsg = `[CheckDomain] API error for ${domain}: ${parsed.message || 'Unknown error'}`;
            // Always set an error property
            temporaryBonusData[domain] = { error: errMsg };
            if (domain === getCurrentDisplayDomain()) {
              updateCurrentDomainCard();
            } else {
              updateBonusDisplay(null, `https://${domain}`, errMsg);
            }
            updateStatusWithColor(errMsg, 'error');
            resolve();
          }
        } catch (e) {
          clearTimeout(overallTimeoutId);
          activeChecks.delete(domain);
          const errMsg = `[CheckDomain] Parse error for ${domain}: ${e.message}`;
          // Always set an error property
          temporaryBonusData[domain] = { error: errMsg };
          if (domain === getCurrentDisplayDomain()) {
            updateCurrentDomainCard();
          } else {
            updateBonusDisplay(null, `https://${domain}`, errMsg);
          }
          updateStatusWithColor(errMsg, 'error');
          resolve();
        }
      },
      onerror: function() {
        clearTimeout(overallTimeoutId);
        activeChecks.delete(domain);
        const errMsg = `[CheckDomain] Network error for ${domain}`;
        // Always set an error property
        temporaryBonusData[domain] = { error: errMsg };
        if (domain === getCurrentDisplayDomain()) {
          updateCurrentDomainCard();
        } else {
          updateBonusDisplay(null, `https://${domain}`, errMsg);
        }
        updateStatusWithColor(errMsg, 'error');
        resolve();
      },
      ontimeout: function() {
        clearTimeout(overallTimeoutId);
        activeChecks.delete(domain);
        const errMsg = `[CheckDomain] Request timeout for ${domain}`;
        // Always set an error property
        temporaryBonusData[domain] = { error: errMsg };
        if (domain === getCurrentDisplayDomain()) {
          updateCurrentDomainCard();
        } else {
          updateBonusDisplay(null, `https://${domain}`, errMsg);
        }
        updateStatusWithColor(errMsg, 'error');
        resolve();
      }
    });
  });
}

// Also update the token-based sync request function for consistent status updates
function performSyncRequestWithToken(domain, accessId, accessToken, merchantId, resolve, retryCount = 0) {
    // Minimized retry to speed up processing
    const maxRetries = 0; // No retries for maximum speed

    // Create request parameters
    let syncParams = new URLSearchParams();
    syncParams.set("module", "/users/syncData");
    syncParams.set("merchantId", merchantId);
    syncParams.set("domainId", "0");
    syncParams.set("accessId", accessId);
    syncParams.set("accessToken", accessToken);
    syncParams.set("walletIsAdmin", "");

    // API endpoint
    let apiUrl = `https://${domain}/api/v1/index.php`;

    // Update internal tracking
    if (!window.domainProgress) {
        window.domainProgress = {};
    }
    window.domainProgress[domain] = "processing";

    // Show token request status
    updateStatusWithColor(
        `Fetching data for ${domain} using token...`,
        'info',
        { processed: processedCount, total: totalSites }
    );

    // Make the API request
    GM_xmlhttpRequest({
        method: "POST",
        url: apiUrl,
        headers: {
            "Accept": "*/*",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
        },
        data: syncParams.toString(),
        timeout: 4000, // Even shorter timeout (4 seconds) to fail faster
        onload: function(response) {
            try {
                let parsed = JSON.parse(response.responseText);
                if (parsed.status === "SUCCESS" && parsed.data) {
                    // Success - process the bonus data
                    let bonusData = filterBonuses(parsed, domain);
                    temporaryBonusData[domain] = bonusData;

                    // Update UI if needed
                    if (domain === getCurrentDisplayDomain()) {
                        updateCurrentDomainCard();
                    } else {
                        updateBonusDisplay(bonusData, `https://${domain}`);
                    }

                    // Update last captured info
                    lastCapturedDomain = domain;
                    lastCapturedBonus = parsed.data;
                    renderLastCapturedInfo();

                    // Mark as completed in tracking
                    window.domainProgress[domain] = "success";

                    // Update status with success
                    updateStatusWithColor(
                        `Successfully fetched data for ${domain}`,
                        'success',
                        { processed: processedCount, total: totalSites }
                    );

                    // Done - resolve the promise
                    resolve();
                    return;
                } else {
                    // Token might be invalid, clear it for future login attempts
                    if (parsed.message && parsed.message.toLowerCase().includes("token")) {
                        delete merchantIdData[domain].accessId;
                        delete merchantIdData[domain].accessToken;
                        GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));
                    }

                    // Mark failure in tracking
                    window.domainProgress[domain] = "token_error";

                    // Show error in UI
                    updateBonusDisplay(null, `https://${domain}`, `API Error: ${parsed.message || 'Unknown error'}`);

                    // Update status with error
                    updateStatusWithColor(
                        `API error for ${domain}: ${parsed.message || 'Unknown error'}`,
                        'error',
                        { processed: processedCount, total: totalSites }
                    );
                }
            } catch(e) {
                // Parse error - mark in tracking
                window.domainProgress[domain] = "parse_error";

                // Show error in UI
                updateBonusDisplay(null, `https://${domain}`, 'Parse error in bonus response');

                // Update status with parse error
                updateStatusWithColor(
                    `Parse error for ${domain}: ${e.message}`,
                    'error',
                    { processed: processedCount, total: totalSites }
                );
            }

            // Always complete the promise, even on error
            activeChecks.delete(domain);
            resolve();
        },
        onerror: function() {
            // Network error - mark in tracking
            window.domainProgress[domain] = "network_error";

            // Show error in UI
            updateBonusDisplay(null, `https://${domain}`, 'Network error in bonus fetch');

            // Update status with network error
            updateStatusWithColor(
                `Network error for ${domain}`,
                'error',
                { processed: processedCount, total: totalSites }
            );

            // Complete the promise
            activeChecks.delete(domain);
            resolve();
        },
        ontimeout: function() {
            // Timeout error - mark in tracking
            window.domainProgress[domain] = "timeout";

            // Show error in UI
            updateBonusDisplay(null, `https://${domain}`, 'Request timeout');

            // Update status with timeout
            updateStatusWithColor(
                `Request timeout for ${domain}`,
                'error',
                { processed: processedCount, total: totalSites }
            );

            // Complete the promise
            activeChecks.delete(domain);
            resolve();
        }
    });
}

// Update the SyncData request after login to include status updates
function performSyncDataRequest(domain, loginUrl, accessId, accessToken, merchantId, resolve) {
    let syncParams = new URLSearchParams();
    syncParams.set("module", "/users/syncData");
    syncParams.set("merchantId", merchantId);
    syncParams.set("domainId", "0");
    syncParams.set("accessId", accessId);
    syncParams.set("accessToken", accessToken);
    syncParams.set("walletIsAdmin", "");

    // Show sync data request status
    updateStatusWithColor(
        `Fetching data for ${domain} after login...`,
        'info',
        { processed: processedCount, total: totalSites }
    );

    GM_xmlhttpRequest({
        method: "POST",
        url: loginUrl,
        headers: {
            "Accept": "*/*",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
        },
        data: syncParams.toString(),
        timeout: 8000, // Reduced timeout
        onload: function(response) {
            try {
                let parsed = JSON.parse(response.responseText);
                if (parsed.status === "SUCCESS" && parsed.data) {
                    let bonusData = filterBonuses(parsed, domain);
                    temporaryBonusData[domain] = bonusData;
                    updateBonusDisplay(bonusData, `https://${domain}`);
                    updateCurrentDomainCard();
                    lastCapturedDomain = domain;
                    lastCapturedBonus = parsed.data;

                    // Update status with success
                    updateStatusWithColor(
                        `Successfully fetched data for ${domain} after login`,
                        'success',
                        { processed: processedCount, total: totalSites }
                    );
                } else {
                    updateBonusDisplay(null, `https://${domain}`, `SyncData failed: ${parsed.message || 'Unknown error'}`);

                    // Update status with error
                    updateStatusWithColor(
                        `Failed to fetch data for ${domain}: ${parsed.message || 'Unknown error'}`,
                        'error',
                        { processed: processedCount, total: totalSites }
                    );
                }
            } catch(e) {
                updateBonusDisplay(null, `https://${domain}`, `Parse error during syncData after login`);

                // Update status with parse error
                updateStatusWithColor(
                    `Parse error for ${domain} after login: ${e.message}`,
                    'error',
                    { processed: processedCount, total: totalSites }
                );
            }
            processedCount++;
            activeChecks.delete(domain);
            
            resolve();
        },
        onerror: function() {
            updateBonusDisplay(null, `https://${domain}`, 'Network error during syncData after login');

            // Update status with network error
            updateStatusWithColor(
                `Network error for ${domain} during syncData`,
                'error',
                { processed: processedCount, total: totalSites }
            );

            processedCount++;
            activeChecks.delete(domain);
            
            resolve();
        },
        ontimeout: function() {
            updateBonusDisplay(null, `https://${domain}`, 'Timeout during syncData after login');

            // Update status with timeout
            updateStatusWithColor(
                `Timeout for ${domain} during syncData`,
                'error',
                { processed: processedCount, total: totalSites }
            );

            processedCount++;
            activeChecks.delete(domain);
            
            resolve();
        }
    });
}

// Optimized version that uses fewer retries and faster fail behavior

    /**
     * Performs a syncData request using an existing token.
     * This function always makes the API call to /users/syncData, forcing a fresh bonus data update.
     */

    // Enhanced bonus data caching and bulk processing system
// This system improves performance by intelligently processing and caching data

// === BULK DATA PROCESSOR CLASS ===
class BulkDataProcessor {
    constructor(options = {}) {
        this.batchSize = options.batchSize || 100;
        this.timeout = options.timeout || 4500;
        this.maxRetries = options.maxRetries || 2;
        this.retryDelay = options.retryDelay || 500;
        this.processedDomains = new Set();
        this.inProgress = false;
        this.abortController = null;
    }

    /**
     * Process all domains in optimized batches
     * @param {Array} domains - List of domains to process
     * @param {Function} processDomain - Function to process each domain
     * @param {Function} updateStatus - Function to update status
     * @param {Function} onProgress - Progress callback
     * @param {Function} onComplete - Completion callback
     */
    async processAll(domains, processDomain, updateStatus, onProgress, onComplete) {
        if (this.inProgress) {
            updateStatus("Bulk processing already in progress", false);
            return;
        }

        this.inProgress = true;
        this.abortController = new AbortController();
        const signal = this.abortController.signal;
        this.processedDomains.clear();

        try {
            // Split domains into batches
            const batches = [];
            for (let i = 0; i < domains.length; i += this.batchSize) {
                batches.push(domains.slice(i, i + this.batchSize));
            }

            updateStatus(`Processing ${domains.length} domains in ${batches.length} batches`, true);

            let processedCount = 0;
            let errorCount = 0;

            // Process each batch sequentially
            for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
                if (signal.aborted) break;

                const batch = batches[batchIndex];
                updateStatus(`Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} domains)`, true);

                // Process all domains in this batch concurrently
                const batchResults = await Promise.allSettled(
                    batch.map(domain =>
                        this._processWithTimeout(domain, processDomain, signal)
                    )
                );

                // Count successes and failures
                batchResults.forEach(result => {
                    processedCount++;
                    if (result.status === 'rejected') {
                        errorCount++;
                    } else {
                        this.processedDomains.add(result.value.domain);
                    }
                });

                // Report progress
                if (onProgress) {
                    onProgress(processedCount, domains.length, errorCount);
                }
            }

            updateStatus(`Completed processing ${processedCount} domains (${errorCount} errors)`, true);

            if (onComplete) {
                onComplete(this.processedDomains, errorCount);
            }
        } catch (error) {
            console.error("Error in bulk processing:", error);
            updateStatus(`Bulk processing error: ${error.message}`, false);
        } finally {
            this.inProgress = false;
            this.abortController = null;
        }
    }

    /**
     * Abort any in-progress operations
     */
    abort() {
        if (this.abortController) {
            this.abortController.abort();
            this.inProgress = false;
            return true;
        }
        return false;
    }

    /**
     * Process a single domain with timeout protection
     * @private
     */
    _processWithTimeout(domain, processDomain, signal) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error(`Timeout processing domain: ${domain}`));
            }, this.timeout);

            processDomain(domain, signal)
                .then(result => {
                    clearTimeout(timeoutId);
                    resolve({
                        domain,
                        result
                    });
                })
                .catch(error => {
                    clearTimeout(timeoutId);
                    reject(error);
                });
        });
    }
}

// === BONUS DATA CACHE SYSTEM ===
class BonusDataCache {
    constructor() {
        this.memoryCache = {};
        this.lastCacheTime = Date.now();
        this.cacheLifetime = 30 * 60 * 1000; // 30 minutes
    }

    /**
     * Initialize the cache from persistent storage
     */
    initialize() {
        try {
            const cachedData = GM_getValue("cached_bonus_data", "{}");
            const cacheTime = parseInt(GM_getValue("cached_bonus_timestamp", "0"));

            this.memoryCache = JSON.parse(cachedData);
            this.lastCacheTime = cacheTime || Date.now();

            //(`[BonusCache] Loaded ${Object.keys(this.memoryCache).length} cached domain records`);
            return true;
        } catch (error) {
            console.error("[BonusCache] Failed to initialize cache:", error);
            this.memoryCache = {};
            this.lastCacheTime = Date.now();
            return false;
        }
    }

    /**
     * Get data for a specific domain
     * @param {string} domain - Domain to retrieve
     * @returns {object|null} - Cached bonus data or null if not found
     */
    getDomain(domain) {
        return this.memoryCache[domain] || null;
    }

    /**
     * Store data for a domain
     * @param {string} domain - Domain to store
     * @param {object} data - Bonus data to cache
     */
    storeDomain(domain, data) {
        if (!domain || !data) return false;
        this.memoryCache[domain] = data;
        return true;
    }

    /**
     * Save the entire cache to persistent storage
     */
    persistCache() {
        try {
            GM_setValue("cached_bonus_data", JSON.stringify(this.memoryCache));
            GM_setValue("cached_bonus_timestamp", Date.now().toString());
            this.lastCacheTime = Date.now();
            return true;
        } catch (error) {
            console.error("[BonusCache] Failed to persist cache:", error);
            return false;
        }
    }

    /**
     * Check if the cache is expired
     */
    isExpired() {
        return (Date.now() - this.lastCacheTime) > this.cacheLifetime;
    }

    /**
     * Get all domains that match a specific criteria
     * @param {Function} filterFn - Filter function
     */
    getMatchingDomains(filterFn) {
        const result = [];

        for (const domain in this.memoryCache) {
            const data = this.memoryCache[domain];
            if (filterFn(data, domain)) {
                result.push(domain);
            }
        }

        return result;
    }

    /**
     * Clear cache for specific domains
     * @param {Array} domains - Domains to clear
     */
    clearDomains(domains) {
        if (!domains || !domains.length) return 0;

        let cleared = 0;
        domains.forEach(domain => {
            if (this.memoryCache[domain]) {
                delete this.memoryCache[domain];
                cleared++;
            }
        });

        if (cleared > 0) {
            this.persistCache();
        }

        return cleared;
    }
}

// === INTEGRATION WITH BONUS CHECKER ===

// Create instances of our enhanced systems
const bonusDataCache = new BonusDataCache();
const bulkProcessor = new BulkDataProcessor({
    batchSize: 100, // Process 25 domains at a time
    timeout: 5000, // 20 second timeout per domain
    maxRetries: 2,
    retryDelay: 500
});

// Initialize during page load
function initializeEnhancedSystems() {
    // Initialize the bonus data cache
    bonusDataCache.initialize();

    // Extend the global temporary storage with cached data
    for (const domain in bonusDataCache.memoryCache) {
        if (!temporaryBonusData[domain]) {
            temporaryBonusData[domain] = bonusDataCache.memoryCache[domain];
        }
    }
}

// Enhanced fetchFreshBonusData using our new systems


// Initialize our enhanced systems
document.addEventListener('DOMContentLoaded', initializeEnhancedSystems);

// Add a function to show only high-value bonuses
function showHighValueBonuses(minAmount = 5) {
    const cards = document.querySelectorAll('.site-card');
    let count = 0;

    cards.forEach(card => {
        const domain = card.getAttribute('data-domain');
        if (!domain) return;

        const bonusData = temporaryBonusData[domain];
        const hasHighValue = bonusData && (
            (bonusData.commission && bonusData.commission.amount >= minAmount) ||
            (bonusData.share && bonusData.share.amount >= minAmount) ||
            (bonusData.referral && bonusData.referral.amount >= minAmount)
        );

        if (hasHighValue || card.classList.contains('current-domain-card')) {
            card.style.display = 'block';
            count++;
        } else {
            card.style.display = 'none';
        }
    });

    sortDomainCards();
    updateStatusWithColor(`Showing ${count} site(s) with bonuses ≥${minAmount}.`, true);
}
    /***********************************************
     *       XHR INTERCEPTION (CAPTURE MERCHANT ID) *
     ***********************************************/
    function setupXHRInterception() {
        XMLHttpRequest.prototype.open = function(method, url) {
            this._method = method;
            this._url = url;
            this._requestHeaders = {};
            return originalOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
            this._requestHeaders[name.toLowerCase()] = value;
            return originalSetRequestHeader.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function(body) {
            let xhr = this;
            let requestBody = body ? body.toString() : "";

            // Look for any /api/v1/index.php requests that might contain merchantId
            let isApiRequest =
                xhr._url.includes("/api/v1/index.php") &&
                requestBody &&
                (requestBody.includes("merchantId=") || requestBody.includes("module="));

            if (isApiRequest) {
                try {
                    // Extract the merchantId parameter - handle both direct param and URL-encoded
                    let merchantId = null;

                    // Try direct param first
                    try {
                        let params = new URLSearchParams(requestBody);
                        merchantId = params.get("merchantId");

                        // Also capture access id and token if present
                        const accessId = params.get("accessId");
                        const accessToken = params.get("accessToken");
                        const domainId = params.get("domainId");
                        const walletIsAdmin = params.get("walletIsAdmin");

                        if (accessId && accessToken) {
                            // We'll save these later if we have a valid merchantId
                            xhr._accessId = accessId;
                            xhr._accessToken = accessToken;
                            xhr._domainId = domainId;
                            xhr._walletIsAdmin = walletIsAdmin;
                        }
                    } catch (e) {
                        console.error("Error parsing params:", e);
                    }

                    // If that didn't work, try to extract from the raw string
                    if (!merchantId) {
                        const merchantIdRegex = /merchantId=([^&]+)/;
                        const match = requestBody.match(merchantIdRegex);
                        if (match && match[1]) {
                            merchantId = decodeURIComponent(match[1]);
                        }
                    }

                    // Only capture if the current domain is in our list and doesn't already have a merchant ID
                    const currentDomain = extractBaseDomain(window.location.href);
                    if (currentDomain && domainList.includes(currentDomain) && (!merchantIdData[currentDomain] || !merchantIdData[currentDomain].merchantId)) {
                        if (merchantId && merchantId !== "" && merchantId !== "undefined") {
                            // Store the merchantId and additional data
                            merchantIdData[currentDomain] = {
                                merchantId: merchantId,
                                capturedAt: new Date().toISOString()
                            };

                            // Add access credentials if available
                            if (xhr._accessId && xhr._accessToken) {
                                merchantIdData[currentDomain].accessId = xhr._accessId;
                                merchantIdData[currentDomain].accessToken = xhr._accessToken;
                                merchantIdData[currentDomain].domainId = xhr._domainId || "0";
                                merchantIdData[currentDomain].walletIsAdmin = xhr._walletIsAdmin || "";
                            }

                            GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));
                            updateStatusWithColor(`Captured merchantId=${merchantId} for ${currentDomain}!`, true);
                            updateCurrentDomainCard();

                            // If auto-navigation is enabled, go to next domain without merchant ID
                            if (autoNavNonVisited && !navigationScheduled) {
                                navigationScheduled = true;
                                updateStatusWithColor("Going to next domain without merchant ID in 1 second...", true);

                                setTimeout(() => {
                                    navigationScheduled = false;
                                    goToNextDomain();
                                }, 1000);
                            }
                        }
                    }
                } catch (e) {
                    console.error('[Merchant Monitor] Error processing request:', e);
                }
            }

            // Look for login responses to extract accessId and accessToken
            if (isApiRequest && requestBody.includes("login") && !xhr._alreadyAddedLoginHandler) {
                xhr._alreadyAddedLoginHandler = true;
                xhr.addEventListener('load', function() {
                    if (xhr.readyState === 4) {
                        try {
                            const data = JSON.parse(xhr.responseText);
                            if (data && data.status === "SUCCESS" && data.data?.id && data.data?.token) {
                                const currentDomain = extractBaseDomain(window.location.href);
                                if (currentDomain && domainList.includes(currentDomain) && merchantIdData[currentDomain]) {
                                    // Save login credentials in merchant data
                                    merchantIdData[currentDomain].accessId = data.data.id;
                                    merchantIdData[currentDomain].accessToken = data.data.token;
                                    GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));

                                    updateStatusWithColor(`Captured login credentials for ${currentDomain}!`, true);
                                    updateCurrentDomainCard();
                                }
                            }
                        } catch (e) {
                            console.error('[Merchant Monitor] Error processing login response:', e);
                        }
                    }
                });
            }

            // Look for syncData responses that might contain bonus info
            if (isApiRequest && (requestBody.includes("syncData") || requestBody.includes("%2FsyncData"))) {
                xhr.addEventListener('load', function() {
                    if (xhr.readyState === 4) {
                        try {
                            const data = JSON.parse(xhr.responseText);
                            if (data && data.status === "SUCCESS" && data.data) {
                                const currentDomain = extractBaseDomain(window.location.href);
                                if (currentDomain && domainList.includes(currentDomain)) {
                                    // Process and store bonus data
                                    if (Array.isArray(data.data.bonus) || data.data.bonus) {
                                        const bonusData = filterBonuses(data, currentDomain);

                                        // Store bonus data for current domain only (not in saved state)
                                        temporaryBonusData[currentDomain] = bonusData;

                                        // Update UI
                                        updateCurrentDomainCard();

                                        // Update last captured info
                                        lastCapturedDomain = currentDomain;
                                        lastCapturedBonus = data.data;
                                        renderLastCapturedInfo();
                                    }
                                }
                            }
                        } catch (e) {
                            console.error('[Merchant Monitor] Error processing syncData response:', e);
                        }
                    }
                });
            }

            return originalSend.apply(xhr, arguments);
        };

        // Also monitor fetch requests for merchant IDs
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
            const [resource, config] = args;

            // Only intercept API requests
            if (resource && resource.includes && resource.includes('/api/v1/index.php')) {
                try {
                    // If there's a request body in the config
                    if (config && config.body) {
                        const body = config.body.toString();
                        if (body.includes('merchantId=')) {
                            // Extract merchant ID
                            const merchantIdRegex = /merchantId=([^&]+)/;
                            const match = body.match(merchantIdRegex);
                            if (match && match[1]) {
                                const merchantId = decodeURIComponent(match[1]);
                                const currentDomain = extractBaseDomain(window.location.href);

                                // Only capture for domains in our list that don't have merchant ID
                                if (currentDomain && domainList.includes(currentDomain) &&
                                    (!merchantIdData[currentDomain] || !merchantIdData[currentDomain].merchantId) &&
                                    merchantId && merchantId !== "" && merchantId !== "undefined") {

                                    merchantIdData[currentDomain] = {
                                        merchantId: merchantId,
                                        capturedAt: new Date().toISOString()
                                    };
                                    GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));

                                    updateStatusWithColor(`Captured merchantId=${merchantId} from fetch for ${currentDomain}!`, true);
                                    updateCurrentDomainCard();

                                    // If auto-navigation is enabled, go to next domain without merchant ID
                                    if (autoNavNonVisited && !navigationScheduled) {
                                        navigationScheduled = true;
                                        updateStatusWithColor("Going to next domain without merchant ID in 1 second...", true);

                                        setTimeout(() => {
                                            navigationScheduled = false;
                                            goToNextDomain();
                                        }, 1000);
                                    }
                                }
                            }
                        }
                    }
                } catch (e) {
                    console.error('[Merchant Monitor] Error processing fetch request:', e);
                }
            }

            // Continue with the original fetch
            return originalFetch.apply(window, args);
        };
    }

    /***********************************************
     *                   INIT                      *
     ***********************************************/
    // Replace the init function with this enhanced version
    function init() {
  // First inject styles and create the GUI.
  injectMinimizedStylesheet();
  applyMinimizedStateEarly();
  createGUI();
  loadGUIState();
  setupXHRInterception();
  keepOnTop();
  createCurrentDomainCard();
  initializeMinimizedState();
  setupMinimizeMaximizeButtons();

  const currentDomain = extractBaseDomain(window.location.href);
  if (domainList.includes(currentDomain)) {
    // Normal processing if on a listed domain.
    if (merchantIdData[currentDomain]?.merchantId) {
      updateStatusWithColor(`Merchant ID already captured for ${currentDomain}: ${merchantIdData[currentDomain].merchantId}`, true);
      if (autoLogin) {
        setTimeout(tryAutoLogin, 1000);
      } else if (autoNavNonVisited && !navigationScheduled) {
        navigationScheduled = true;
        setTimeout(() => {
          navigationScheduled = false;
          const domainsWithoutMerchantId = domainList.filter(d => !merchantIdData[d]?.merchantId);
          if (domainsWithoutMerchantId.length > 0) {
            updateStatusWithColor(`Moving to next domain without merchant ID: ${domainsWithoutMerchantId[0]}`, true);
            goToNextDomain();
          } else {
            updateStatusWithColor("All domains have merchant IDs captured!", true);
          }
        }, 1500);
      }
    } else {
      updateStatusWithColor(`Waiting for merchant ID capture for ${currentDomain}...`, false);
    }
    // Start bonus data capture.
    checkAndCaptureBonusDataAfterLoad();
  } else {
    // If current domain isn’t in the list, load the stored current domain card.
    updateStatusWithColor(`Current domain is not listed. Displaying data for last valid domain: ${getCurrentDisplayDomain()}`, true);
    updateCurrentDomainCard();

    // Automatically trigger refreshLastVisited() immediately and every 5 seconds.
    refreshLastVisited();
    setInterval(refreshLastVisited, 25000);
  }

  // Continue with state checking and cleanup.
  setupPeriodicStateCheck();
  setInterval(cleanup, CLEANUP_INTERVAL);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      initializeMinimizedState();
    } else {
      persistGUIState();
      clearTemporaryData();
    }
  });
  window.addEventListener('beforeunload', persistGUIState);
  //("[Bonus Checker] Init complete");
}

    function cleanup() {
        cleanMerchantData();
    }

    function keepOnTop() {
        topObserver = new MutationObserver(() => {
            if (!document.contains(guiElement)) {
                document.body.appendChild(guiElement);
            }
            guiElement.style.zIndex = '2147483647';
        });
        topObserver.observe(document.documentElement, { childList: true, subtree: true });
    }

    // Clear temporary bonus data when leaving the page
    window.addEventListener('beforeunload', clearTemporaryData);
    window.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            clearTemporaryData();
        }
    });

    if (document.readyState === "complete" || document.readyState === "interactive") {
        init();
    } else {
        document.addEventListener("DOMContentLoaded", () => {
            init();
        });
    }

})();

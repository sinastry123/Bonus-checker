// ==UserScript==
// @name         kkkonus Checker - Final Version
// @namespace    http://example.com
// @version      8.1
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
  console.log("[Bonus Checker] Script already initialized. Skipping...");
  return;
}
window._bonusCheckerAlreadyLoaded = true;
    const BATCH_SIZE = 130;
    const CHECK_DELAY = 10;
    const CLEANUP_INTERVAL = 30000;
    let currentDomainCard = null;
    let isCurrentDomainCardVisible = false;
    let lastValidListedDomain = null;
    let temporaryBonusData = {};
    let domainCredentials = JSON.parse(GM_getValue("domain_credentials", "{}"));
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
    // Default credentials for API login
    let defaultPhone = GM_getValue("default_phone", "0412578959");
    let defaultPassword = GM_getValue("default_password", "password");
    let bonusFetchInProgress = {};
    let lastListedDomain = null;
    let lastCapturedDomain = null;
    let lastCapturedBonus = null;

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    const originalSend = XMLHttpRequest.prototype.send;

    let guiElement = null;
    let navigationScheduled = false;
    let checkLiveClickCount = 0; // Track the state of the Check Live button
    let showingLastData = false;
    // Sort mode for bonus sorting
    let sortMode = GM_getValue("sortMode", 0);

    /***********************************************
     *         HELPER / UTILITY FUNCS              *
     ***********************************************/
    // Disable the competing function to prevent conflicts
    function updateMinimizedState() {
        // Intentionally empty to prevent style conflicts
        return;
    }

    function injectMinimizedStylesheet() {
        // Remove any existing stylesheet
        const existingStyle = document.getElementById('minimized-style');
        if (existingStyle) existingStyle.remove();

        // Create a new stylesheet
        const style = document.createElement('style');
        style.id = 'minimized-style';
        style.textContent = `
            /* Hide these elements when minimized */
            #bonus-checker-container.minimized #guiContent .header-controls,
            #bonus-checker-container.minimized #resultsArea,
            #bonus-checker-container.minimized #statusMessage,
            #bonus-checker-container.minimized #bonus-checker-title,
            #bonus-checker-container.minimized #progressBar,
            #bonus-checker-container.minimized #heart-container {
                display: none !important;
            }

            /* Show only the current domain card when minimized */
            #bonus-checker-container.minimized {
                height: auto !important;
                width: auto !important;
                max-height: none !important;
                overflow: visible !important;
                padding: 0 !important;
                background: rgba(0,0,0,0.9) !important;
            }

            #bonus-checker-container.minimized #currentDomainCardContainer {
                display: block !important;
                position: relative !important;
                margin: 0 !important;
                max-width: 100% !important;
            }

            #bonus-checker-container.minimized .current-domain-card {
                width: 100% !important;
                max-height: 80px !important;
                overflow-y: auto !important;
                margin: 0 !important;
            }

            /* Make maximize button visible and properly positioned */
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

    // Apply early minimized state
    function applyMinimizedStateEarly() {
        // Read the minimized state before any other processing
        const minimized = GM_getValue("minimized", false);

        // Inject minimized stylesheet early
        injectMinimizedStylesheet();

        // If minimized, add an early indicator class to body
        if (minimized) {
            document.documentElement.classList.add('early-minimized');
            console.log('[Bonus Checker] Early minimized state prepared');
        }
    }

    // Call this very early


    // Simple, reliable minimize/maximize functions
    // Replace your existing minimizeResults function with this one
// Replace your minimizeResults function with this version
// Replace your minimizeResults function with this version
function minimizeResults() {
    console.log("[Bonus Checker] Minimizing...");
    const container = document.getElementById('bonus-checker-container');
    if (!container) {
        console.error("[Bonus Checker] Container not found for minimize");
        return;
    }

    // First force update of current domain card
    createCurrentDomainCard();
    updateCurrentDomainCard();

    // Add the minimized class to change UI layout
    container.classList.add('minimized');

    // Make sure the current domain container is visible and properly styled
    const currentDomainContainer = document.getElementById('currentDomainCardContainer');
    if (currentDomainContainer) {
        currentDomainContainer.style.display = 'block !important';
        currentDomainContainer.style.visibility = 'visible';
        currentDomainContainer.style.opacity = '1';
        currentDomainContainer.style.zIndex = '9999';
    }

    // Make sure that the maximize and refresh buttons are visible
    const maximizeBtn = document.getElementById('maximizeTracker');
    if (maximizeBtn) {
        maximizeBtn.style.display = 'block';
    }
    const refreshLastMinBtn = document.getElementById('refreshLastMin');
    if (refreshLastMinBtn) {
        refreshLastMinBtn.style.display = 'block';
    }

    // Save minimized state
    GM_setValue("minimized", true);
    try {
        const state = JSON.parse(GM_getValue("guiState", "{}"));
        state.minimized = true;
        GM_setValue("guiState", JSON.stringify(state));
    } catch (e) {
        console.error("[Bonus Checker] Error saving minimized state to guiState", e);
    }

    console.log("[Bonus Checker] UI minimized and state saved");
    startMinimizedBonusCheck();

    // Final check - wait a brief moment then ensure the card is visible again
    setTimeout(function() {
        const currentDomainContainer = document.getElementById('currentDomainCardContainer');
        if (currentDomainContainer) {
            currentDomainContainer.style.display = 'block !important';
            currentDomainContainer.style.visibility = 'visible';
        }
    }, 100);
}

// Replace your maximizeResults function with this version
function maximizeResults() {
    console.log("[Bonus Checker] Maximizing...");
    const container = document.getElementById('bonus-checker-container');
    if (!container) {
        console.error("[Bonus Checker] Container not found for maximize");
        return;
    }
    window.preventDataClearing = true;
    container.classList.remove('minimized');
    GM_setValue("minimized", false);
    try {
        const state = JSON.parse(GM_getValue("guiState", "{}"));
        state.minimized = false;
        GM_setValue("guiState", JSON.stringify(state));
    } catch (e) {
        console.error("[Bonus Checker] Error saving maximized state to guiState", e);
    }
    updateCurrentDomainCard();
    // NEW: Hide the refresh-last button when maximized.
    const refreshLastMinBtn = document.getElementById('refreshLastMin');
    if (refreshLastMinBtn) {
        refreshLastMinBtn.style.display = 'none';
    }
    setTimeout(() => {
        window.preventDataClearing = false;
    }, 2000);
    console.log("[Bonus Checker] UI maximized and state saved");
}

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
                console.log(`[Bonus Checker] Periodic minimized check for ${currentDomain}`);
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
        console.log("[Bonus Checker] Minimised state active—skipping bonus data clearing.");
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
    function setupMinimizeMaximizeButtons() {
        console.log("[Bonus Checker] Setting up minimize/maximize buttons");

        // Get references to buttons
        const minimizeBtn = document.getElementById('minimizeTracker');
        const maximizeBtn = document.getElementById('maximizeTracker');

        if (!minimizeBtn) {
            console.error("[Bonus Checker] Minimize button not found in DOM");
        }

        if (!maximizeBtn) {
            console.error("[Bonus Checker] Maximize button not found in DOM");
        }

        // Clear and rebind minimize button
        if (minimizeBtn) {
            minimizeBtn.onclick = function(e) {
                console.log("[Bonus Checker] Minimize button clicked");
                e.preventDefault();
                e.stopPropagation();
                minimizeResults();
                return false;
            };
        }

        // Clear and rebind maximize button
        if (maximizeBtn) {
            maximizeBtn.onclick = function(e) {
                console.log("[Bonus Checker] Maximize button clicked");
                e.preventDefault();
                e.stopPropagation();
                maximizeResults();
                return false;
            };
        }

        console.log("[Bonus Checker] Minimize/maximize buttons setup complete");
    }

    // Apply the proper minimized state on initialization
    function initializeMinimizedState() {
    console.log("[Bonus Checker] Initializing minimized state");
    const minimized = GM_getValue("minimized", false);
    console.log(`[Bonus Checker] Stored minimized state: ${minimized}`);
    const container = document.getElementById('bonus-checker-container');
    if (!container) {
        console.error("[Bonus Checker] Container not found - cannot initialize minimized state");
        return;
    }
    if (minimized) {
        container.classList.add('minimized');
        // Start the periodic bonus data check for minimized mode
        startMinimizedBonusCheck();
        // Force an immediate bonus data check for the current domain
        const currentDomain = extractBaseDomain(window.location.href);
        if (currentDomain) {
            checkDomain(currentDomain).then(() => {
                updateCurrentDomainCard();
            });
        }
        console.log("[Bonus Checker] Applied minimized class to container");
    } else {
        container.classList.remove('minimized');
        console.log("[Bonus Checker] Removed minimized class from container");
    }
    const maximizeBtn = document.getElementById('maximizeTracker');
    if (maximizeBtn) {
        maximizeBtn.style.display = minimized ? 'block' : 'none';
    } else {
        console.error("[Bonus Checker] Maximize button not found during minimized state init");
    }
}

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

    // Override all navigation functions to use our enhanced navigation
    function goToNextDomain() {
        // Reset any active checks
        activeChecks.clear();
        processedCount = 0;

        // If autoNavValid is on, find a domain with a valid bonus
        if (autoNavValid) {
            // Since we only store current domain bonus data, this feature is limited
            updateStatusWithColor('Auto Valid navigation requires running "Check Live" first', false);
            return;
        }

        // If autoNavNonVisited is on, find a domain without merchant ID data
        if (autoNavNonVisited) {
            const domainsWithoutMerchantId = domainList.filter(domain => !merchantIdData[domain]?.merchantId);

            if (domainsWithoutMerchantId.length === 0) {
                updateStatusWithColor('All domains now have merchant ID data!', true);
                return;
            }

            // Go to the first domain without merchant ID
            const nextDomain = domainsWithoutMerchantId[0];
            updateStatusWithColor(`Navigating to ${nextDomain} to capture merchant ID...`, true);
            forceStateSaveBeforeNavigate(`https://${nextDomain}`);
            return;
        }

        // Otherwise just go to next in list
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
            let domain = url.replace(/^(?:https?:\/\/)?(?:www\.)?/i, "");
            domain = domain.split('/')[0].split(':')[0].toLowerCase();
            if (!domain.includes('.')) return null;
            return domain;
        } catch (e) {
            console.error('Domain extraction error:', e);
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
        return text.split(/[\n\s,]+/)
            .map(line => extractBaseDomain(line.trim()))
            .filter(Boolean)
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
    function updateStatusWithColor(message, typeOrBoolean) {
    const statusEl = document.getElementById('statusMessage');
    if (!statusEl) return;

    // Ensure the status container is visible each time we set a new message.
    statusEl.style.display = 'block';
    statusEl.style.opacity = '1';  // Reset opacity in case it was 0 from a previous fade.

    // Clear any existing hide timer.
    if (window.statusHideTimeout) {
        clearTimeout(window.statusHideTimeout);
    }

    // Interpret the second argument:
    // - If it's a boolean, treat true => success, false => error.
    // - If it's a recognized string, use that. Otherwise default to 'info'.
    let type = 'info';
    if (typeof typeOrBoolean === 'boolean') {
        type = typeOrBoolean ? 'success' : 'error';
    } else if (typeof typeOrBoolean === 'string') {
        const validTypes = ['success','error','warning','info'];
        if (validTypes.includes(typeOrBoolean)) {
            type = typeOrBoolean;
        }
    }

    // Choose icon and colors based on the final type.
    let icon = '';
    let bgColor = '';
    let borderColor = '';
    switch (type) {
        case 'success':
            icon = "✔️";
            bgColor = "rgba(76, 175, 80, 0.2)";
            borderColor = "#4CAF50";
            break;
        case 'error':
            icon = "❌";
            bgColor = "rgba(255, 69, 58, 0.2)";
            borderColor = "#ff4444";
            break;
        case 'warning':
            icon = "⚠️";
            bgColor = "rgba(255, 165, 0, 0.2)";
            borderColor = "orange";
            break;
        case 'info':
        default:
            icon = "ℹ️";
            bgColor = "rgba(0, 0, 0, 0.6)";
            borderColor = "#ccc";
            break;
    }

    // Replace the old message content.
    statusEl.innerHTML = `
        <div style="font-size: 16px; font-weight: bold; margin-bottom: 5px;">
            Status: ${icon}
        </div>
        <div style="font-size: 14px;">${message}</div>
    `;
    statusEl.style.backgroundColor = bgColor;
    statusEl.style.border = `1px solid ${borderColor}`;
    statusEl.style.borderRadius = "5px";
    statusEl.style.padding = "10px";
    statusEl.style.boxShadow = "0 2px 4px rgba(0,0,0,0.3)";
    statusEl.style.color = "#fff";
    statusEl.style.fontFamily = "'Helvetica Neue', Helvetica, Arial, sans-serif";

    // Hide the status message after 3 seconds (fade out).
    window.statusHideTimeout = setTimeout(() => {
        statusEl.style.transition = "opacity 1s ease-out";
        statusEl.style.opacity = '0';

        setTimeout(() => {
            statusEl.style.display = 'none';
        }, 1000);
    }, 3000);
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
            sortMode = state.sortMode;
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

            // **Rebind click events for domain cards**
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
        const toggleSortBtn = document.getElementById('toggleSortBtn');
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
        if (toggleSortBtn) toggleSortBtn.addEventListener('click', cycleSortMode);
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

    function updateCurrentDomainCard(domainOverride) {
    // Use the override if provided; otherwise, use the default current display domain.
    const displayDomain = domainOverride || getCurrentDisplayDomain();
    if (!displayDomain) return;

    // Always use the dedicated container.
    const container = document.getElementById('currentDomainCardContainer');
    if (!container) return;

    // Ensure the container is visible, especially important in minimized mode
    container.style.display = 'block';

    // Check if we're in minimized mode
    const mainContainer = document.getElementById('bonus-checker-container');
    const isMinimized = mainContainer && mainContainer.classList.contains('minimized');

    // If minimized, ensure the container has proper styling
    if (isMinimized) {
        container.style.position = 'relative';
        container.style.zIndex = '1000';
        container.style.margin = '0';
        container.style.maxWidth = '100%';
    }

    // Clear the container so that no duplicate current cards exist.
    container.innerHTML = '';

    // Create the current domain card.
    let card = document.createElement('div');
    card.className = 'site-card current-domain-card';
    card.setAttribute('data-domain', displayDomain);

    // Bind click so that clicking navigates to the domain.
    card.onclick = function(e) {
        e.preventDefault();
        window.location.href = `https://${displayDomain}`;
    };

    // Build merchant ID status.
    let merchantIdStatus = "";
    if (merchantIdData[displayDomain]?.merchantId) {
        merchantIdStatus = `<div style="color: #4CAF50;">Merchant ID: ${merchantIdData[displayDomain].merchantId}</div>`;
    } else {
        merchantIdStatus = `<div style="color: #ff4444;">Waiting for merchant ID...</div>`;
    }

    // Get bonus data.
    const bonusData = temporaryBonusData[displayDomain];
    if (!bonusData) {
        card.innerHTML = `
            <div style="font-weight: bold;">${displayDomain} (Current)</div>
            ${merchantIdStatus}
            <div>Waiting for bonus data...</div>
        `;
        card.style.background = "rgba(0,0,0,0.2)";
        card.style.border = "1px solid #333";
        container.appendChild(card);
        persistGUIState();
        return;
    }

    // Otherwise, format the bonus data.
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
    card.style.background = hasValidBonus ? "rgba(0, 128, 0, 0.3)" : "rgba(255, 0, 0, 0.3)";
    card.style.border = hasValidBonus ? "1px solid #4CAF50" : "1px solid red";

    card.innerHTML = `
        <div style="font-weight: bold;">${displayDomain} (Current)</div>
        ${merchantIdStatus}
        <div class="top-row">
            <div>
                <span>Bal:</span>
                <strong style="color:#ffd700;">${cash ?? 0}</strong>
            </div>
            <div><span>Comm:</span> ${formatCommissionIndicator(commission)}</div>
            <div><span>Share:</span> ${formatBonusIndicator(share?.amount)}</div>
            <div><span>Ref:</span> ${formatBonusIndicator(referral?.amount)}</div>
        </div>
        <div class="bottom-row">
            <div>
                <div>Withdrawals: <span style="color:#fff;">Min: ${effectiveMin}</span> / <span style="color:#fff;">Max: ${effectiveMax}</span></div>
            </div>
            ${
                (commission && commission.amount > 0) ? `
                <div>
                    <div>minBet: <span style="color:#fff;">${commission.minBet ?? '--'}</span>,
                    maxW: <span style="color:#fff;">${commission.maxWithdrawal ?? '--'}</span></div>
                    <button class="control-btn claim-btn claim-commission-btn"
                            data-domain="${displayDomain}"
                            data-type="commission">
                        Claim Comm
                    </button>
                </div>` : `<div>&nbsp;</div>`
            }
            ${
                (share && share.amount > 0) ? `
                <div>
                    <div>MinW: <span style="color:#fff;">${share.minWithdrawal ?? '--'}</span>,
                    MaxW: <span style="color:#fff;">${share.maxWithdrawal ?? '--'}</span></div>
                    <button class="control-btn claim-btn claim-share-btn"
                            data-domain="${displayDomain}"
                            data-type="share">
                        Claim Share
                    </button>
                </div>` : `<div>&nbsp;</div>`
            }
            ${
                (referral && referral.amount > 0) ? `
                <div>
                    <div>MinW: <span style="color:#fff;">${referral.minWithdrawal ?? '--'}</span>,
                    MaxW: <span style="color:#fff;">${referral.maxWithdrawal ?? '--'}</span></div>
                    <button class="control-btn claim-btn claim-referral-btn"
                            data-domain="${displayDomain}"
                            data-type="referral">
                        Claim Ref
                    </button>
                </div>` : `<div>&nbsp;</div>`
            }
        </div>
    `;

    container.appendChild(card);

    // Add event listeners to claim buttons
    const claimBtns = card.querySelectorAll(".claim-btn");
    claimBtns.forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const d = btn.getAttribute('data-domain');
            const bonusType = btn.getAttribute('data-type');
            claimBonus(d, bonusType);
        });
    });

    persistGUIState();
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
            // If bonus data is available, we're done.
            if (temporaryBonusData[currentDomain]) {
                updateStatusWithColor(`Bonus data found for ${currentDomain} on attempt ${attempts}`, true);
                return;
            }
            updateStatusWithColor(`No bonus data for ${currentDomain} yet — attempt ${attempts} of 5. Refreshing...`, true);

            // Use the same method as your Refresh Last button:
            checkDomain(currentDomain).then(() => {
                // If still missing and we haven't exceeded our attempts, try again in 1 second.
                if (!temporaryBonusData[currentDomain] && attempts < 5) {
                    setTimeout(tryFetch, 1000);
                } else if (!temporaryBonusData[currentDomain]) {
                    updateStatusWithColor(`After ${attempts} attempts, still no bonus data for ${currentDomain}.`, false);
                }
            });
        }

        setTimeout(tryFetch, 1000);
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

/* HEADER CONTROLS (grid) */
.header-controls {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 2px;
    margin-bottom: 4px;
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

/* Status message styling */
#statusMessage {
    padding: 0;
    margin-bottom: 10px;
    transition: all 0.3s ease;
}
#statusMessage.active {
    padding: 10px;
    background-color: rgba(255, 20, 147, 0.2);
    border: 1px solid #ff1493;
    border-radius: 5px;
}

/* MODAL OVERLAY STYLES */
.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.8);
    z-index: 2147483648;
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
    z-index: 1000 !important;
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

`);

    /***********************************************
     *               GUI CREATION                  *
     ***********************************************/
    function createGUI() {
    console.log("[Bonus Checker] Creating GUI...");
    if (guiElement) {
        console.log("[Bonus Checker] GUI already exists, skipping creation");
        return;
    }

    // Check if we should start minimized
    const startMinimized = GM_getValue("minimized", false);
    console.log(`[Bonus Checker] Start minimized setting: ${startMinimized}`);

    // Main container
    let container = document.getElementById('bonus-checker-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'bonus-checker-container';
    }

    // Apply minimized class if needed
    if (startMinimized) {
        container.classList.add('minimized');
        console.log("[Bonus Checker] Added minimized class to container during creation");
    }

    // Create heart container
    let heartsDiv = document.getElementById('heart-container');
    if (!heartsDiv) {
        heartsDiv = document.createElement('div');
        heartsDiv.id = 'heart-container';
        container.appendChild(heartsDiv);
    }

    // Create main GUI content wrapper
    let guiContent = document.getElementById('guiContent');
    if (!guiContent) {
        guiContent = document.createElement('div');
        guiContent.id = 'guiContent';
        container.appendChild(guiContent);
    }

    // Create title
    let title = document.getElementById('bonus-checker-title');
    if (!title) {
        title = document.createElement('div');
        title.id = 'bonus-checker-title';
        title.textContent = 'ALANNAH';
        guiContent.appendChild(title);
    }

    // Create header controls
    let headerControls = document.querySelector('.header-controls');
    if (!headerControls) {
        headerControls = document.createElement('div');
        headerControls.className = 'header-controls';
        headerControls.innerHTML = `
            <button id="editUrls" class="control-btn">Edit Domains</button>
            <button id="checkBonuses" class="control-btn">Check Live</button>
            <button id="refreshLastBtn" class="control-btn">Refresh Last</button>
            <button id="nextDomainBtn" class="control-btn">Next</button>
            <button id="showValidBonusesBtn" class="control-btn">Show Valid</button>
            <button id="toggleAutoLogin" class="control-btn">Auto Login: OFF</button>
            <button id="toggleAutoNavNonVisited" class="control-btn">Auto Non-Visited: OFF</button>
            <button id="toggleAutoNavValid" class="control-btn">Auto Valid: OFF</button>
            <button id="minimizeTracker" class="control-btn">_</button>
            <button id="toggleSortBtn" class="control-btn">Sort</button>
            <button id="setDomainCredentials" class="control-btn">Set Domain Creds</button>
            <button id="clearWithinRangeBtn" class="control-btn">Clear Range</button>
        `;
        guiContent.appendChild(headerControls);
    }

    // Create the maximize button - add directly on container for accessibility.
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
        maximizeButton.style.display = startMinimized ? 'block' : 'none';
        container.appendChild(maximizeButton);
    }

    // Create a refresh-last button for minimized mode.
    let refreshLastMinBtn = document.getElementById('refreshLastMin');
    if (!refreshLastMinBtn) {
        refreshLastMinBtn = document.createElement('button');
        refreshLastMinBtn.id = 'refreshLastMin';
        refreshLastMinBtn.className = 'control-btn';
        refreshLastMinBtn.textContent = 'Refresh Last';
        refreshLastMinBtn.style.position = 'absolute';
        refreshLastMinBtn.style.top = '2px';
        refreshLastMinBtn.style.right = '80px';
        refreshLastMinBtn.style.zIndex = '999999';
        refreshLastMinBtn.style.display = startMinimized ? 'block' : 'none';
        refreshLastMinBtn.onclick = function(e) {
            e.preventDefault();
            e.stopPropagation();
            refreshLastVisited();
            return false;
        };
        container.appendChild(refreshLastMinBtn);
    }

    // Create progress bar
    let progressBar = document.getElementById('progressBar');
    if (!progressBar) {
        progressBar = document.createElement('div');
        progressBar.className = 'progress-bar';
        progressBar.id = 'progressBar';
        progressBar.innerHTML = '<div class="progress-fill" id="progressFill"></div>';
        guiContent.appendChild(progressBar);
    }

    // Create status message
    let statusMessage = document.getElementById('statusMessage');
    if (!statusMessage) {
        statusMessage = document.createElement('div');
        statusMessage.className = 'status-message';
        statusMessage.id = 'statusMessage';
        guiContent.appendChild(statusMessage);
    }

    // Create results area
    let resultsArea = document.getElementById('resultsArea');
    if (!resultsArea) {
        resultsArea = document.createElement('div');
        resultsArea.id = 'resultsArea';
        guiContent.appendChild(resultsArea);
    }

    // Create or reuse the dedicated current domain card container.
    let currentDomainContainer = document.getElementById('currentDomainCardContainer');
    if (!currentDomainContainer) {
        currentDomainContainer = document.createElement('div');
        currentDomainContainer.id = 'currentDomainCardContainer';
        // Insert this container at the top of the guiContent.
        guiContent.insertBefore(currentDomainContainer, resultsArea);
    }

    // Attach container to document body if not already attached.
    if (!document.body.contains(container)) {
        document.body.appendChild(container);
    }
    guiElement = container;
    console.log("[Bonus Checker] Main container added to body");

    // Create floating hearts
    for (let i = 0; i < 20; i++) {
        const heart = document.createElement('div');
        heart.className = 'floating-heart';
        heart.style.left = Math.random() * 100 + '%';
        heart.style.animationDelay = (Math.random() * 5) + 's';
        heart.style.animationDuration = (4 + Math.random() * 4) + 's';
        heartsDiv.appendChild(heart);
    }
    console.log("[Bonus Checker] Hearts created");

    // CREATE AND APPEND THE MODAL OVERLAY & DIALOG OUTSIDE MAIN GUI
    let modalOverlay = document.getElementById('modalOverlay');
    if (!modalOverlay) {
        modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay';
        modalOverlay.id = 'modalOverlay';
        document.body.appendChild(modalOverlay);
    }
    let urlModal = document.getElementById('urlModal');
    if (!urlModal) {
        urlModal = document.createElement('div');
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
            <div style="display: flex; justify-content: flex-end; gap: 8px;">
                <button id="saveUrls" class="control-btn">Save</button>
                <button id="cancelUrls" class="control-btn">Cancel</button>
            </div>
        `;
        modalOverlay.appendChild(urlModal);
    }

    // Create range modal
    createRangeModal();

    // Direct event handlers for minimize/maximize buttons
    const minBtn = document.getElementById('minimizeTracker');
    if (minBtn) {
        minBtn.onclick = function(e) {
            console.log("[Bonus Checker] Minimize button clicked");
            e.preventDefault();
            e.stopPropagation();
            minimizeResults();
            return false;
        };
        console.log("[Bonus Checker] Minimize button handler added");
    } else {
        console.error("[Bonus Checker] Minimize button not found!");
    }

    if (maximizeButton) {
        maximizeButton.onclick = function(e) {
            console.log("[Bonus Checker] Maximize button clicked");
            e.preventDefault();
            e.stopPropagation();
            maximizeResults();
            return false;
        };
        console.log("[Bonus Checker] Maximize button handler added");
    } else {
        console.error("[Bonus Checker] Maximize button not found!");
    }

    // Hook up event listeners for the modal overlay and URL modal buttons.
    addListener(document.getElementById('modalOverlay'), 'click', (e) => {
        if (e.target === modalOverlay) {
            closeEditModal();
        }
    });
    addListener(document.getElementById('saveUrls'), 'click', saveEditedUrls);
    addListener(document.getElementById('cancelUrls'), 'click', closeEditModal);

    // Hook up event listeners for the header control buttons.
    addListener(guiContent.querySelector('#editUrls'), 'click', openEditModal);
    addListener(guiContent.querySelector('#checkBonuses'), 'click', checkAllBonuses);
    addListener(guiContent.querySelector('#refreshLastBtn'), 'click', refreshLastVisited);
    addListener(guiContent.querySelector('#nextDomainBtn'), 'click', goToNextDomain);
    addListener(guiContent.querySelector('#showValidBonusesBtn'), 'click', showValidBonuses);
    addListener(guiContent.querySelector('#toggleAutoLogin'), 'click', toggleAutoLogin);
    addListener(guiContent.querySelector('#toggleAutoNavNonVisited'), 'click', toggleNavNonVisited);
    addListener(guiContent.querySelector('#toggleAutoNavValid'), 'click', toggleNavValid);
    addListener(guiContent.querySelector('#toggleSortBtn'), 'click', cycleSortMode);
    addListener(guiContent.querySelector('#setDomainCredentials'), 'click', openDomainCredentialsModal);
    addListener(guiContent.querySelector('#clearWithinRangeBtn'), 'click', openRangeModal);

    // Perform final UI updates
    updateToggleButtons();
    renderLastCapturedInfo();
    updateSortButtonText();

    console.log(`[Bonus Checker] GUI created. Starting minimized: ${startMinimized}`);
}

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
    sortMode = (sortMode + 1) % 5;
    GM_setValue("sortMode", sortMode);
    sortDomainCards();
    updateSortButtonText();
}

// Update the sort button’s text to show the current mode.
function updateSortButtonText() {
    const btn = document.getElementById('toggleSortBtn');
    if (!btn) return;
    const sortTypes = ["Commission", "Share", "Referral", "Balance", "Errors"];
    btn.textContent = `Sort: ${sortTypes[sortMode]}`;
}

// Reorder the non-current domain cards based on the chosen sort mode.
function sortDomainCards() {
    const results = document.getElementById('resultsArea');
    if (!results) return;

    // Get the dedicated current domain card container so it remains in place.
    const currentContainer = document.getElementById('currentDomainCardContainer');

    // Get all non-current domain cards.
    const otherCards = Array.from(results.querySelectorAll('.site-card:not(.current-domain-card)'));

    // Sort the cards based on the bonus data in temporaryBonusData.
    otherCards.sort((a, b) => {
        const domainA = a.getAttribute('data-domain') || '';
        const domainB = b.getAttribute('data-domain') || '';
        const infoA = temporaryBonusData[domainA];
        const infoB = temporaryBonusData[domainB];

        // If both lack bonus data, keep their order.
        if (!infoA && !infoB) return 0;
        // If one is missing data, push it toward the bottom.
        if (!infoA) return 1;
        if (!infoB) return -1;

        // Compare based on the selected sort mode.
        switch (sortMode) {
            case 0: // Commission – higher commission amounts come first.
                return compareNumbers(infoA?.commission?.amount, infoB?.commission?.amount);
            case 1: // Share – higher share amounts come first.
                return compareNumbers(infoA?.share?.amount, infoB?.share?.amount);
            case 2: // Referral – higher referral amounts come first.
                return compareNumbers(infoA?.referral?.amount, infoB?.referral?.amount);
            case 3: // Balance – higher cash balance comes first.
                return compareNumbers(infoA?.cash, infoB?.cash);
            case 4: // Errors – domains with missing bonus data (errors) go to the bottom.
                return isErrorDomain(infoB) - isErrorDomain(infoA);
            default:
                return 0;
        }
    });

    // Clear the results area and append the current domain container followed by sorted cards.
    results.innerHTML = '';
    if (currentContainer) {
        results.appendChild(currentContainer);
    }
    otherCards.forEach(card => results.appendChild(card));

    updateStatusWithColor(`Sorted domains by ${["Commission", "Share", "Referral", "Balance", "Errors"][sortMode]}`, true);
}

// Helper: Compare two numbers (or fallback to 0) so that higher values come first.
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

                // Already being captured by the XHR interception
            }
        } else {
            updateStatusWithColor("Auto navigation disabled", false);
        }
    }

    function toggleNavValid() {
        autoNavValid = !autoNavValid;
        GM_setValue("autoNavValid", autoNavValid);
        updateToggleButtons();
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
        console.log(`[Bonus Checker] Current domain (${currentDomain}) is not in the list. Skipping bonus capture.`);
        // Update the UI with the last valid domain’s bonus data.
        updateCurrentDomainCard();
        return;
    }
    // Otherwise, proceed with capture logic.
    let attempts = 0;
    const maxAttempts = 5;

    function attemptCapture() {
        attempts++;
        console.log(`[Bonus Checker] Attempt ${attempts}/${maxAttempts} to capture bonus data for ${currentDomain}`);
        if (temporaryBonusData[currentDomain]) {
            console.log(`[Bonus Checker] Bonus data already exists for ${currentDomain}`);
            return;
        }
        if (!merchantIdData[currentDomain]?.merchantId) {
            console.log(`[Bonus Checker] No merchant ID for ${currentDomain} yet, waiting...`);
            if (attempts < maxAttempts) {
                setTimeout(attemptCapture, 1000);
            }
            return;
        }
        // Force capture via syncData.
        const merchantId = merchantIdData[currentDomain].merchantId;
        const accessId = merchantIdData[currentDomain].accessId || "";
        const accessToken = merchantIdData[currentDomain].accessToken || "";
        if (accessId && accessToken) {
            console.log(`[Bonus Checker] Using tokens to fetch bonus data for ${currentDomain}`);
            forceSyncDataCapture(currentDomain, merchantId, accessId, accessToken);
        } else if (attempts < maxAttempts) {
            console.log(`[Bonus Checker] No tokens available, attempting login for ${currentDomain}`);
            tryDomainLogin(currentDomain, () => {
                setTimeout(attemptCapture, 1000);
            });
        }
    }
    setTimeout(attemptCapture, 1000);
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
                    console.log(`[Bonus Checker] Successfully captured bonus data for ${domain}`);
                    const bonusData = filterBonuses(parsed, domain);
                    temporaryBonusData[domain] = bonusData;

                    // Update UI
                    updateCurrentDomainCard();

                    // Update last captured info
                    lastCapturedDomain = domain;
                    lastCapturedBonus = parsed.data;
                    renderLastCapturedInfo();
                } else {
                    console.log(`[Bonus Checker] Failed to capture bonus data: ${parsed.message || 'Unknown error'}`);
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
                    console.log(`[Bonus Checker] Login successful for ${domain}`);

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
    function updateProgress() {
    const bar = document.getElementById('progressBar');
    const fill = document.getElementById('progressFill');
    if (!bar || !fill) return;

    // If there are no valid domains, hide the bar.
    if (totalSites <= 0) {
        bar.style.display = "none";
        fill.style.width = "0%";
        return;
    }

    // Always show the bar if there is work to do.
    bar.style.display = "block";

    // Calculate progress based on only valid responses.
    let progress = (processedCount / totalSites) * 100;
    if (progress > 100) progress = 100;

    // Animate the fill smoothly.
    fill.style.transition = "width 0.5s ease-out";
    fill.style.width = `${progress}%`;
}

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
    function tryAutoLogin() {
        if (!autoLogin) return false;

        const currentDomain = extractBaseDomain(window.location.href);
        if (!currentDomain || !domainList.includes(currentDomain)) {
            updateStatusWithColor(`Current domain is not in your list. Auto-login skipped.`, false);
            return false;
        }

        // Check if there is already valid USER data in localStorage.
        const userDataStr = localStorage.getItem("USER");
        let userData = null;
        if (userDataStr && userDataStr.trim().length > 0) {
            try {
                userData = JSON.parse(userDataStr);
            } catch (e) {
                console.error("Error parsing USER data:", e);
                userData = null;
            }
        }
        if (userData && userData.token && userData.id) {
            updateStatusWithColor(`Already logged in for ${currentDomain}.`, true);
            return true;
        }

        // No valid USER data, so perform login.
        const merchantId = merchantIdData[currentDomain]?.merchantId;
        if (!merchantId) {
            updateStatusWithColor(`Cannot auto-login on ${currentDomain} - no merchant ID captured yet.`, false);
            return false;
        }

        // Use domain-specific credentials if available, otherwise use defaults.
        const domainCreds = domainCredentials[currentDomain] || { phone: defaultPhone, password: defaultPassword };
        let params = new URLSearchParams();
        params.set("mobile", domainCreds.phone);
        params.set("password", domainCreds.password);
        params.set("module", "/users/login");
        params.set("merchantId", merchantId);
        params.set("domainId", "0");
        params.set("accessId", "");
        params.set("accessToken", "");
        params.set("walletIsAdmin", "");

        let loginUrl = `https://${currentDomain}/api/v1/index.php`;
        updateStatusWithColor(`Performing auto-login for ${currentDomain}...`, true);

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
                try {
                    let resp = JSON.parse(response.responseText);
                    if (resp.status === "SUCCESS" && resp.data.token && resp.data.id) {
                        updateStatusWithColor(`Auto-login successful for ${currentDomain}. Refreshing page...`, true);
                        // Store USER data in localStorage.
                        const newUserData = {
                            token: resp.data.token,
                            id: resp.data.id,
                            timestamp: Date.now()
                        };
                        localStorage.setItem("USER", JSON.stringify(newUserData));
                        // Refresh page after a short delay.
                        setTimeout(() => {
                            window.location.reload();
                        }, 1000);
                    } else {
                        updateStatusWithColor(`Auto-login failed for ${currentDomain}: ${resp.message || 'Unknown error'}`, false);
                    }
                } catch (e) {
                    updateStatusWithColor(`Parse error during auto-login for ${currentDomain}: ${e.message}`, false);
                }
            },
            onerror: function() {
                updateStatusWithColor(`Network error during auto-login for ${currentDomain}`, false);
            },
            ontimeout: function() {
                updateStatusWithColor(`Login timeout for ${currentDomain}`, false);
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
    // Cycle the click count (0, 1, 2)
    checkLiveClickCount = (checkLiveClickCount + 1) % 3;
    updateCheckLiveButton();

    const results = document.getElementById('resultsArea');
    const container = document.getElementById('bonus-checker-container');
    const currentDomain = getCurrentDisplayDomain();
    const isMinimized = container && container.classList.contains('minimized');

    // CRITICAL FIX: Always ensure current domain card exists and is visible before doing anything else
    createCurrentDomainCard();
    updateCurrentDomainCard();

    // Force current domain container to be visible with important styles when minimized
    if (isMinimized) {
        const currentDomainContainer = document.getElementById('currentDomainCardContainer');
        if (currentDomainContainer) {
            currentDomainContainer.setAttribute('style',
                'display: block !important; visibility: visible !important; opacity: 1 !important; position: relative !important; z-index: 9999 !important;');
        }
    }

    if (checkLiveClickCount === 1) {
        // FIRST CLICK: Show cached bonus data if available.
        if (container) container.classList.remove('live-check-mode');
        try {
            const savedData = GM_getValue("cached_bonus_data", "{}");
            const storedBonusData = JSON.parse(savedData);
            if (Object.keys(storedBonusData).length > 0) {
                showingLastData = true;
                updateStatusWithColor(`Showing cached bonus data. Click "Check Live" again to fetch fresh data.`, true);

                // Remove all children except the current domain container.
                if (results) {
                    Array.from(results.children).forEach(child => {
                        if (child.id !== 'currentDomainCardContainer') {
                            child.remove();
                        }
                    });
                }

                // Ensure current domain card is visible and updated
                updateCurrentDomainCard(currentDomain);

                // Process cached bonus data for other domains.
                for (const domain in storedBonusData) {
                    if (domain === currentDomain) continue;
                    const bonusData = storedBonusData[domain];
                    bonusData.isStoredData = true;
                    temporaryBonusData[domain] = bonusData;
                    updateBonusDisplay(bonusData, `https://${domain}`);
                }

                const timestamp = GM_getValue("cached_bonus_timestamp", "Unknown");
                const dateStr = timestamp !== "Unknown" ? new Date(parseInt(timestamp)).toLocaleString() : "Unknown";
                updateStatusWithColor(`Displaying cached bonus data saved at ${dateStr}. Click "Check Live" again to fetch fresh data.`, true);

                sortDomainCards();

                // CRITICAL FIX: Re-ensure visibility of current domain container after all operations
                if (isMinimized) {
                    const currentDomainContainer = document.getElementById('currentDomainCardContainer');
                    if (currentDomainContainer) {
                        currentDomainContainer.setAttribute('style',
                            'display: block !important; visibility: visible !important; opacity: 1 !important; position: relative !important; z-index: 9999 !important;');
                    }
                }

                return;
            } else {
                updateStatusWithColor(`No cached bonus data found. Fetching fresh data...`, true);
                checkLiveClickCount = 2;
                updateCheckLiveButton();
            }
        } catch (e) {
            console.error("Error loading cached bonus data:", e);
            updateStatusWithColor(`Error loading cached data. Fetching fresh data...`, false);
            checkLiveClickCount = 2;
            updateCheckLiveButton();
        }
    }

    if (checkLiveClickCount === 2) {
        // SECOND CLICK: Fetch fresh bonus data.
        if (container) container.classList.remove('live-check-mode');
        showingLastData = false;
        updateStatusWithColor(`Fetching fresh bonus data...`, true);
        await fetchNewBonusData();

        // CRITICAL FIX: Re-ensure current domain card visibility after fetching data
        if (isMinimized) {
            const currentDomainContainer = document.getElementById('currentDomainCardContainer');
            if (currentDomainContainer) {
                currentDomainContainer.setAttribute('style',
                    'display: block !important; visibility: visible !important; opacity: 1 !important; position: relative !important; z-index: 9999 !important;');
                updateCurrentDomainCard();
            }
        }

        return;
    }

    if (checkLiveClickCount === 0) {
        // THIRD CLICK: Enable live-check mode so only the current domain container remains visible.
        showingLastData = false;
        if (container) container.classList.add('live-check-mode');
        if (results) {
            Array.from(results.children).forEach(child => {
                if (child.id !== 'currentDomainCardContainer') {
                    child.remove();
                }
            });
        }

        // Ensure current domain card is visible
        updateCurrentDomainCard();

        // CRITICAL FIX: Re-ensure current domain card visibility
        if (isMinimized) {
            const currentDomainContainer = document.getElementById('currentDomainCardContainer');
            if (currentDomainContainer) {
                currentDomainContainer.setAttribute('style',
                    'display: block !important; visibility: visible !important; opacity: 1 !important; position: relative !important; z-index: 9999 !important;');
            }
        }

        updateStatusWithColor("Cleared bonus cards (current domain remains visible).", true);
    }

    // CRITICAL FIX: Add one final check with a timeout to ensure visibility
    setTimeout(() => {
        if (isMinimized) {
            const currentDomainContainer = document.getElementById('currentDomainCardContainer');
            if (currentDomainContainer) {
                currentDomainContainer.setAttribute('style',
                    'display: block !important; visibility: visible !important; opacity: 1 !important; position: relative !important; z-index: 9999 !important;');
            }
        }
    }, 500);
}

    async function fetchNewBonusData() {
    activeChecks.clear();
    processedCount = 0;
    totalSites = domainList.length;

    // Create and update current domain card first
    createCurrentDomainCard();
    updateCurrentDomainCard();

    // Clear out the temporary bonus data before fetching fresh data.
    temporaryBonusData = {};

    // Create a new object to hold fresh data.
    let freshBonusData = {};

    // Only check domains that have a merchant ID captured.
    const domainsWithMerchantId = domainList.filter(domain => merchantIdData[domain]?.merchantId);

    if (domainsWithMerchantId.length === 0) {
        updateStatusWithColor("No domains have merchant IDs captured yet. Please visit and capture merchant IDs first.", false);
        return;
    }

    updateStatusWithColor(`Checking ${domainsWithMerchantId.length} domains with merchant IDs...`, true);

    // Clear the results area but preserve the current domain container.
    const resultsArea = document.getElementById('resultsArea');
    if (resultsArea) {
        Array.from(resultsArea.children).forEach(child => {
            if (child.id !== 'currentDomainCardContainer') {
                child.remove();
            }
        });
    }

    // Check if minimized
    const container = document.getElementById('bonus-checker-container');
    const isMinimized = container && container.classList.contains('minimized');

    // If minimized, ensure current domain container is visible
    if (isMinimized) {
        const currentDomainContainer = document.getElementById('currentDomainCardContainer');
        if (currentDomainContainer) {
            currentDomainContainer.style.display = 'block';
        }
    }

    // Process domains in batches, forcing refresh each time.
    for (let i = 0; i < domainsWithMerchantId.length; i += BATCH_SIZE) {
        const batch = domainsWithMerchantId.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(domain => {
            activeChecks.add(domain);
            // Force refresh the bonus data.
            return checkDomain(domain, true).then(() => {
                if (temporaryBonusData[domain]) {
                    freshBonusData[domain] = temporaryBonusData[domain];
                }
            });
        }));

        // Ensure current domain card remains updated and visible, especially in minimized mode
        updateCurrentDomainCard();
        if (isMinimized) {
            const currentDomainContainer = document.getElementById('currentDomainCardContainer');
            if (currentDomainContainer) {
                currentDomainContainer.style.display = 'block';
            }
        }

        await new Promise(resolve => setTimeout(resolve, CHECK_DELAY));
    }

    // For domains without merchant IDs, show an error.
    const domainsWithoutMerchantId = domainList.filter(domain => !merchantIdData[domain]?.merchantId);
    domainsWithoutMerchantId.forEach(domain => {
        updateBonusDisplay(null, `https://${domain}`, 'No merchant ID data');
    });

    // Save the fresh bonus data to storage.
    try {
        GM_setValue("cached_bonus_data", JSON.stringify(freshBonusData));
        GM_setValue("cached_bonus_timestamp", Date.now().toString());
        updateStatusWithColor('All checks completed. Data saved for next time.', true);
    } catch (e) {
        console.error("Error saving bonus data:", e);
        updateStatusWithColor('Error saving bonus data to cache.', false);
    }

    sortDomainCards();

    // Final check to ensure current domain card is visible
    updateCurrentDomainCard();
    if (isMinimized) {
        const currentDomainContainer = document.getElementById('currentDomainCardContainer');
        if (currentDomainContainer) {
            currentDomainContainer.style.display = 'block';
        }
    }
}
    // Function to update bonus display with styling for cached/fresh data
   function updateBonusDisplay(bonusData, url, error) {
    const results = document.getElementById('resultsArea');
    if (!results) return;

    const domain = extractBaseDomain(url);
    if (!domain) return;

    // If in live-check mode, only update if this is the current domain.
    const container = document.getElementById('bonus-checker-container');
    if (container && container.classList.contains('live-check-mode') && domain !== getCurrentDisplayDomain()) {
         return;
    }

    // Also, if this domain is the current one, skip updating because the current domain card is handled separately.
    const currentDomain = getCurrentDisplayDomain();
    if (domain === currentDomain) {
        return;
    }

    // Store bonus data if provided.
    if (bonusData) {
        temporaryBonusData[domain] = bonusData;
    }

    // Look for an existing card for this domain.
    let card = document.querySelector(`.site-card[data-domain="${domain}"]:not(.current-domain-card)`);
    if (!card) {
        card = document.createElement('div');
        card.className = 'site-card';
        card.setAttribute('data-domain', domain);
        card.style.cursor = 'pointer';
        card.addEventListener('click', () => {
            window.location.href = `https://${domain}`;
        });
        results.appendChild(card);
    }

    if (error) {
        card.innerHTML = `
            <div style="font-weight: bold;">${domain}</div>
            <div class="error-message" style="color: #ff4444; font-weight: bold; margin-top: 5px;">
                Error: ${error}
            </div>
        `;
        card.classList.remove('valid-bonus', 'invalid-bonus');
        card.classList.add('invalid-bonus');
        // Only add the cache indicator if in cached mode.
        if (showingLastData && bonusData && bonusData.isStoredData) {
            addCacheIndicator(card);
        } else {
            const existingIndicator = card.querySelector('.cache-indicator');
            if (existingIndicator) {
                existingIndicator.remove();
            }
        }
        return;
    }

    const {
        cash,
        freeCreditMinWithdraw,
        freeCreditMaxWithdraw,
        commission,
        share,
        referral,
        globalMinWithdraw,
        globalMaxWithdraw
    } = bonusData || {};

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
    card.classList.toggle('valid-bonus', hasValidBonus);
    card.classList.toggle('invalid-bonus', !hasValidBonus);

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
                            <div> Min <span style="color:#fff;">${commission.minBet ?? '--'}</span>,
                                 Max <span style="color:#fff;">${commission.maxWithdrawal ?? '--'}</span>
                            </div>
                            <button class="control-btn claim-btn claim-commission-btn"
                                    data-domain="${domain}"
                                    data-type="commission">
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
                            <div>Min <span style="color:#fff;">${share.minWithdrawal ?? '--'}</span>,
                                 Max <span style="color:#fff;">${share.maxWithdrawal ?? '--'}</span>
                            </div>
                            <button class="control-btn claim-btn claim-share-btn"
                                    data-domain="${domain}"
                                    data-type="share">
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
                            <button class="control-btn claim-btn claim-referral-btn"
                                    data-domain="${domain}"
                                    data-type="referral">
                                Claim Ref
                            </button>
                          `
                        : `<div>&nbsp;</div>`
                }
            </div>
        </div>
    `;

    // Add cache indicator only if we're in cached mode.
    if (showingLastData && bonusData && bonusData.isStoredData) {
        addCacheIndicator(card);
    } else {
        const existingIndicator = card.querySelector('.cache-indicator');
        if (existingIndicator) {
            existingIndicator.remove();
        }
    }

    // Bind the claim button events.
    const claimBtns = card.querySelectorAll(".claim-btn");
    claimBtns.forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const d = btn.getAttribute('data-domain');
            const bonusType = btn.getAttribute('data-type');
            claimBonus(d, bonusType);
        });
    });

    persistGUIState();
}    // Helper function to add cache indicator to cards
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
    function checkDomain(domain, forceRefresh = false) {
    return new Promise((resolve) => {
        // --- MODIFICATION: Force a refresh by always clearing old data
        // Comment out or remove the early exit that uses cached data.
        // Original code:
        // if (!forceRefresh && temporaryBonusData[domain]) {
        //     if (domain === getCurrentDisplayDomain()) {
        //         updateCurrentDomainCard();
        //     } else {
        //         updateBonusDisplay(temporaryBonusData[domain], `https://${domain}`);
        //     }
        //     resolve();
        //     return;
        // }
        // Instead, if forceRefresh is true, clear cached bonus data:
        if (forceRefresh) {
            temporaryBonusData[domain] = null;
        }
        // --- End modification

        // Proceed with fetching new data.
        const merchantData = merchantIdData[domain];
        if (!merchantData || !merchantData.merchantId) {
            updateBonusDisplay(null, `https://${domain}`, 'No merchant ID');
            processedCount++;
            activeChecks.delete(domain);
            updateProgress();
            resolve();
            return;
        }
        const accessId = merchantData.accessId;
        const accessToken = merchantData.accessToken;
        if (accessId && accessToken) {
            performSyncRequestWithToken(domain, accessId, accessToken, merchantData.merchantId, resolve);
            return;
        }
        // No valid token; perform login.
        const creds = domainCredentials[domain] || { phone: defaultPhone, password: defaultPassword };
        let params = new URLSearchParams();
        params.set("mobile", creds.phone);
        params.set("password", creds.password);
        params.set("module", "/users/login");
        params.set("merchantId", merchantData.merchantId);
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
            timeout: 10000,
            onload: function(response) {
                try {
                    let resp = JSON.parse(response.responseText);
                    if (resp.status === "SUCCESS" && resp.data.token && resp.data.id) {
                        merchantData.accessId = resp.data.id;
                        merchantData.accessToken = resp.data.token;
                        GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));
                        performSyncDataRequest(domain, loginUrl, resp.data.id, resp.data.token, merchantData.merchantId, resolve);
                    } else {
                        let msg = resp.message || "Invalid login";
                        updateBonusDisplay(null, `https://${domain}`, `Login failed: ${msg}`);
                        processedCount++;
                        activeChecks.delete(domain);
                        updateProgress();
                        resolve();
                    }
                } catch (e) {
                    updateBonusDisplay(null, `https://${domain}`, `Parse error during login`);
                    processedCount++;
                    activeChecks.delete(domain);
                    updateProgress();
                    resolve();
                }
            },
            onerror: function() {
                updateBonusDisplay(null, `https://${domain}`, 'Network error during login');
                processedCount++;
                activeChecks.delete(domain);
                updateProgress();
                resolve();
            },
            ontimeout: function() {
                updateBonusDisplay(null, `https://${domain}`, 'Login timeout');
                processedCount++;
                activeChecks.delete(domain);
                updateProgress();
                resolve();
            }
        });
    });
}
    /**
     * Performs a syncData request using an existing token.
     * This function always makes the API call to /users/syncData, forcing a fresh bonus data update.
     */
    function performSyncRequestWithToken(domain, accessId, accessToken, merchantId, resolve) {
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
        timeout: 10000,
        onload: function(response) {
            try {
                let parsed = JSON.parse(response.responseText);
                if (parsed.status === "SUCCESS" && parsed.data) {
                    let bonusData = filterBonuses(parsed, domain);
                    temporaryBonusData[domain] = bonusData;
                    // Instead of calling updateBonusDisplay, check if this is the current domain:
                    if (domain === getCurrentDisplayDomain()) {
                        updateCurrentDomainCard();
                    } else {
                        updateBonusDisplay(bonusData, `https://${domain}`);
                    }
                    lastCapturedDomain = domain;
                    lastCapturedBonus = parsed.data;
                    renderLastCapturedInfo();
                    updateStatusWithColor(`Captured bonus data for ${domain} using existing token`, true);
                } else {
                    if (parsed.message && parsed.message.toLowerCase().includes("token")) {
                        // Token invalid—clear it and re‑try.
                        delete merchantIdData[domain].accessId;
                        delete merchantIdData[domain].accessToken;
                        GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));
                        checkDomain(domain).then(resolve);
                        return;
                    } else {
                        let errorMsg = parsed.message || 'Invalid bonus response';
                        updateBonusDisplay(null, `https://${domain}`, `syncData failed: ${errorMsg}`);
                    }
                }
            } catch(e) {
                updateBonusDisplay(null, `https://${domain}`, 'Parse error in bonus response');
            }
            processedCount++;
            activeChecks.delete(domain);
            updateProgress();
            resolve();
        },
        onerror: function() {
            updateBonusDisplay(null, `https://${domain}`, 'Network error in bonus fetch');
            processedCount++;
            activeChecks.delete(domain);
            updateProgress();
            resolve();
        },
        ontimeout: function() {
            updateBonusDisplay(null, `https://${domain}`, 'Bonus data timeout');
            processedCount++;
            activeChecks.delete(domain);
            updateProgress();
            resolve();
        }
    });
}
    /**
     * Performs a syncData request immediately after a successful login.
     */
    function performSyncDataRequest(domain, loginUrl, accessId, accessToken, merchantId, resolve) {
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
                        let bonusData = filterBonuses(parsed, domain);
                        temporaryBonusData[domain] = bonusData;
                        updateBonusDisplay(bonusData, `https://${domain}`);
                        updateCurrentDomainCard();
                        lastCapturedDomain = domain;
                        lastCapturedBonus = parsed.data;
                        renderLastCapturedInfo();
                        updateStatusWithColor(`Captured bonus data for ${domain} after login`, true);
                    } else {
                        let msg = parsed.message || "Invalid bonus data after login";
                        updateBonusDisplay(null, `https://${domain}`, `SyncData failed: ${msg}`);
                    }
                } catch(e) {
                    updateBonusDisplay(null, `https://${domain}`, `Parse error during syncData after login`);
                }
                processedCount++;
                activeChecks.delete(domain);
                updateProgress();
                resolve();
            },
            onerror: function() {
                updateBonusDisplay(null, `https://${domain}`, 'Network error during syncData after login');
                processedCount++;
                activeChecks.delete(domain);
                updateProgress();
                resolve();
            },
            ontimeout: function() {
                updateBonusDisplay(null, `https://${domain}`, 'Timeout during syncData after login');
                processedCount++;
                activeChecks.delete(domain);
                updateProgress();
                resolve();
            }
        });
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
        // If current domain isn’t in the list, load the stored current domain card
        updateStatusWithColor(`Current domain is not listed. Displaying data for last valid domain: ${getCurrentDisplayDomain()}`, true);
        updateCurrentDomainCard();
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
    console.log("[Bonus Checker] Init complete");
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

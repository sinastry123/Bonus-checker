
 // ==UserScript==
// @name         aaaaharry Checker - Final Version (License Fixed)
// @namespace    http://example.com
// @version      9.14
// @description  Uses Gumroad license verification correctly, maintains GUI, auto-navigation
// @updateURL    https://raw.githubusercontent.com/sinastry123/Bonus-checker/main/Bonus.js
// @downloadURL  https://raw.githubusercontent.com/sinastry123/Bonus-checker/main/Bonus.js
// @match        *://*/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      *
// ==/UserScript==

(async function () {
    'use strict';



     // Use this function instead of the inline code at the beginning
function setupEarlyMerchantIdCapture() {
    let merchantIdSaved = false;
    const getDomain = () => location.hostname.replace(/^www\./,'');

    // Override XMLHttpRequest
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
        this._url = url;
        return origOpen.apply(this, arguments);
    };

    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(body) {
        if (this._url?.includes('/api/v1/index.php') && body?.includes('merchantId=')) {
            const id = new URLSearchParams(body.toString()).get('merchantId');
            if (id) {
                try {
                    const data = JSON.parse(GM_getValue('merchant_id_data','{}'));
                    data[getDomain()] = { merchantId: id, capturedAt: new Date().toISOString() };
                    GM_setValue('merchant_id_data', JSON.stringify(data));
                    merchantIdSaved = true;
                } catch (e) {
                    console.error("Error saving merchant ID:", e);
                }
            }
        }
        return origSend.apply(this, arguments);
    };

    // Override fetch
    const origFetch = window.fetch;
    window.fetch = function(resource, config) {
        if (typeof resource === 'string' && resource.includes('/api/v1/index.php') && config?.body) {
            const id = new URLSearchParams(config.body.toString()).get('merchantId');
            if (id) {
                try {
                    const data = JSON.parse(GM_getValue('merchant_id_data','{}'));
                    data[getDomain()] = { merchantId: id, capturedAt: new Date().toISOString() };
                    GM_setValue('merchant_id_data', JSON.stringify(data));
                    merchantIdSaved = true;
                } catch (e) {
                    console.error("Error saving merchant ID from fetch:", e);
                }
            }
        }
        return origFetch.apply(this, arguments);
    };

    // Auto‑navigate once DOM is ready and merchantId is saved
    document.addEventListener('DOMContentLoaded', () => {
        if (GM_getValue("autoNavNonVisited", false) && merchantIdSaved && !window.navigationScheduled) {
            window.navigationScheduled = true;
            window.goToNextDomain && window.goToNextDomain();
        }
    });

    return true;
}
    // Use this as a standalone function for license verification
async function verifyAndContinueWithScript() {
    // Check if already loaded to prevent double initialization
    if (window._bonusCheckerAlreadyLoaded) return true;
    window._bonusCheckerAlreadyLoaded = true;

    // Helper to save license key with verification
    const forceSaveLicenseKey = (key) => {
        if (!key || key.trim() === '') return false;

        try {
            // Save in GM storage
            GM_setValue('license_key', key.trim());

            // Double check the save worked correctly
            const savedKey = GM_getValue('license_key', '');
            if (savedKey !== key.trim()) {
                // If storage failed, retry with a delay
                setTimeout(() => GM_setValue('license_key', key.trim()), 100);
                setTimeout(() => GM_setValue('license_key', key.trim()), 500);
            }

            return true;
        } catch (e) {
            // Failed to save
            return false;
        }
    };

    async function verifyLicense(key) {
        // Don't attempt verification with empty key
        if (!key || key.trim() === '') {
            return { success: false, explicitlyInvalid: true };
        }

        const params = new URLSearchParams({
            product_id: 'VX6UFEDLvsb64iKcq9_hAA==',
            license_key: key.trim()
        });

        return new Promise(resolve => {
            GM_xmlhttpRequest({
                method: 'POST',
                url: 'https://api.gumroad.com/v2/licenses/verify',
                headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                data: params.toString(),
                onload(response) {
                    try {
                        const json = JSON.parse(response.responseText);
                        const success = json.success === true && json.purchase && !json.purchase.refunded && !json.purchase.chargebacked;

                        // Save the verification state and timestamp if successful
                        if (success) {
                            try {
                                const verificationState = {
                                    verified: true,
                                    timestamp: Date.now(),
                                    key: key.trim()
                                };
                                GM_setValue('license_verification', JSON.stringify(verificationState));
                            } catch (e) {}
                        }

                        resolve({success, explicitlyInvalid: json.success === false});
                    } catch(e) {
                        resolve({success: false, explicitlyInvalid: false});
                    }
                },
                onerror() { resolve({success: false, explicitlyInvalid: false}); },
                ontimeout() { resolve({success: false, explicitlyInvalid: false}); }
            });
        });
    }

    // First, check if we have a successful verification state from the past month
    try {
        const verificationState = JSON.parse(GM_getValue('license_verification', '{}'));
        const now = Date.now();
        const oneMonth = 30 * 24 * 60 * 60 * 1000; // milliseconds in 30 days

        // If we verified the license in the last month, proceed without checking again
        if (verificationState.verified &&
            verificationState.timestamp &&
            (now - verificationState.timestamp < oneMonth) &&
            verificationState.key) {

            // Ensure the key is saved
            forceSaveLicenseKey(verificationState.key);

            // Setup early merchant ID capture
            setupEarlyMerchantIdCapture();
            return true;
        }
    } catch (e) {}

    // Get stored key
    let key = GM_getValue('license_key', '');
    let result = { success: false, explicitlyInvalid: false };

    // If we have a key, verify it
    if (key && key.trim() !== '') {
        result = await verifyLicense(key);

        // If the key is valid, proceed
        if (result.success) {
            // Ensure our storage has the key
            forceSaveLicenseKey(key);

            // Setup early merchant ID capture
            setupEarlyMerchantIdCapture();
            return true;
        } else {
            // Only clear if explicitly invalid
            if (result.explicitlyInvalid) {
                GM_setValue('license_key', '');
            }
        }
    }

    // At this point, we need to prompt for a key - unlimited attempts
    while (true) {
        key = prompt("Enter your Gumroad license key:");

        // User canceled
        if (key === null) {
            // Don't accept cancellation - force them to enter a valid key
            alert("License key required. Please enter a valid license key to continue.");
            continue;
        }

        // Skip empty inputs
        if (!key || key.trim() === '') {
            alert('Please enter a valid license key.');
            continue;
        }

        // Verify the entered key
        result = await verifyLicense(key);

        if (result.success) {
            // Save the valid key with verification
            forceSaveLicenseKey(key);
            alert('License verified successfully!');
            break;
        } else if (result.explicitlyInvalid) {
            alert('Invalid license key — please try again.');
        } else {
            alert('Unable to verify due to network or temporary issue. Try again shortly.');
        }
    }

    // Setup early merchant ID capture
    setupEarlyMerchantIdCapture();
    return true;
}

    // Add this at the start of your IIFE to properly sequence the startup flow
// Replace your current startScript function with this simpler version
async function startScript() {
  console.log("Starting script initialization...");

  // First, verify the license
  const licenseVerified = await verifyAndContinueWithScript();
  if (!licenseVerified) return; // Stop if license verification fails

  // Initialize required global variables
  window._bonusCheckerInitialized = false;
  window.navigationScheduled = false;

  // Setup early merchant ID capture
  setupEarlyMerchantIdCapture();

  // Initialize the GUI
  console.log("Initializing GUI...");
  init();

  console.log("Script initialization complete!");
}




    const BATCH_SIZE = 25;
    const CHECK_DELAY = 10;
    const CLEANUP_INTERVAL = 30000;
    let currentDomainCard = null;
    let isCurrentDomainCardVisible = false;
    let lastValidListedDomain = null;
    let temporaryBonusData = {};
    let domainCredentials = JSON.parse(GM_getValue("domain_credentials", "{}"));
    let isFetchingBonusData = false;
    const MAX_BODY_LENGTH = 0;
    const keepHeaderNames = ['authorization', 'content-type', 'accept', 'x-csrf-token'];
    const eventListeners = [];
    let topObserver = null;
    let statusHideTimeout = null;
    let domainList = JSON.parse(GM_getValue("bonus_checker_domains", '["example.com"]'));
    let merchantIdData = JSON.parse(GM_getValue("merchant_id_data", "{}"));
    let gameSlotData = {};
    let gameSelectorMode = false;
    let gameSlotsVisible = true; // default value; persists the hidden/shown state for game slots
    let selectorSlotMode = false;
    let selectedSlot = -1;
    let activeSlot = -1;
    let autoNavNonVisited = GM_getValue("autoNavNonVisited", false);
    let autoLogin = GM_getValue("autoLogin", false);
    let autoNavValid = GM_getValue("autoNavValid", false);
    let currentIndex = GM_getValue("currentIndex", 0);
    let activeChecks = new Set();
    let processedCount = 0;
    let totalSites = 0;
    let visitedDomains = GM_getValue("visitedDomains", []);
    let defaultPhone = GM_getValue("default_phone", "");
    let defaultPassword = GM_getValue("default_password", "");
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
    let checkLiveClickCount = 0;
    let showingLastData = false;
    // Global variables (define these once at the top of your script)
let domainGameMapping = JSON.parse(GM_getValue("domainGameMapping", "{}") || "{}");

let domainForGameSelection = null;
    window.open = function(url) {
      if (url) {
        window.location.href = url;
      }
      return null;
    };

    document.addEventListener('click', function(event) {
      let anchor = event.target.closest('a[target="_blank"]');
      if (anchor && anchor.href) {
        event.preventDefault();
        window.location.href = anchor.href;
      }
    });

    function updateMinimizedState() {
  const container = document.getElementById('bonus-checker-container');
  if (!container) return;

  // Check if we're minimized
  const isMinimized = container.classList.contains('minimized');

  // 1) Always hide the four slot buttons (both minimized and normal)
  for (let i = 0; i < 4; i++) {
    const slotBtn = document.getElementById(`slotBtn${i}`);
    if (slotBtn) {
      slotBtn.style.display = 'none';
      // Use !important override:
      slotBtn.style.cssText = 'display: none !important;';
    }
  }

  // 2) Keep the main game slots container visible, even when minimized
  const slotsContainer = document.getElementById('gameSlotsContainer');
  if (slotsContainer) {
    slotsContainer.style.display = 'block';
    // Use !important override to defeat any CSS that was hiding it:
    slotsContainer.style.cssText = 'display: block !important;';
  }
}

    function injectMinimizedStylesheet() {
  const existingStyle = document.getElementById('minimized-style');
  if (existingStyle) existingStyle.remove();

  const style = document.createElement('style');
  style.id = 'minimized-style';
  style.textContent = `
    #bonus-checker-container.minimized #guiContent .header-controls,
    #bonus-checker-container.minimized #bonus-checker-title,
    #bonus-checker-container.minimized #statusMessage,
    #bonus-checker-container.minimized #progressBar,
    #bonus-checker-container.minimized #heart-container {
      display: none !important;
    }

    #bonus-checker-container.minimized #gameSlotsContainer {
      display: flex !important; /* or block !important */
    }

    #bonus-checker-container.minimized #resultsArea {
      display: block !important;
    }

    #bonus-checker-container.minimized .current-domain-card {
      width: 100% !important;
      max-height: 80px !important;
      overflow-y: auto !important;
      margin: 0 !important;
      padding: 2px !important;
      font-size: 10px !important;
    }

    /* Make sure hidden cards stay hidden regardless of other styles */
    #bonus-checker-container.minimized #currentDomainCardContainer[style*="display: none"] {
      display: none !important;
    }

    /* Fix for slot buttons in minimized mode - CRITICAL FIX */
    #slotBtn0, #slotBtn1, #slotBtn2, #slotBtn3 {
      display: none !important;
    }

    /* Only show slot buttons when explicitly controlled by JavaScript */
    #bonus-checker-container.minimized #slotBtn0[style*="display: block"],
    #bonus-checker-container.minimized #slotBtn1[style*="display: block"],
    #bonus-checker-container.minimized #slotBtn2[style*="display: block"],
    #bonus-checker-container.minimized #slotBtn3[style*="display: block"] {
      display: block !important;
      position: absolute !important;
      top: 2px !important;
      z-index: 999999 !important;
      padding: 4px 6px !important;
      font-size: 10px !important;
    }

    #refreshLastMin, #nextDomainMin, #toggleCurrentCardMin, #themeCustomizeBtn {
      position: absolute !important;
      top: 2px !important;
      z-index: 999999 !important;
      padding: 4px 6px !important;
      font-size: 10px !important;
      background: var(--buttonBackground, rgba(0,0,0,0.6)) !important;
      color: var(--buttonText, #fff) !important;
      border: 1px solid var(--buttonBorder, #ff1493) !important;
    }

    #refreshLastMin:hover, #nextDomainMin:hover, #toggleCurrentCardMin:hover, #themeCustomizeBtn:hover {
      background: var(--buttonHoverBackground, #fff) !important;
      color: var(--buttonHoverText, #ff1493) !important;
    }

    #toggleCurrentCardMin {
      left: 65px !important;
    }

    #themeCustomizeBtn {
      left: 10px !important;
    }

    #nextDomainMin { right: 2px !important; }

    #maximizeTracker {
      display: none;
      position: absolute !important;
      top: 2px !important;
      right: 2px !important;
      z-index: 999999 !important;
      background: var(--buttonBackground, rgba(0,0,0,0.6)) !important;
      color: var(--buttonText, #fff) !important;
      border: 1px solid var(--buttonBorder, #ff1493) !important;
    }

    #maximizeTracker:hover {
      background: var(--buttonHoverBackground, #fff) !important;
      color: var(--buttonHoverText, #ff1493) !important;
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
            return;
        }
    }


    function setupMinimizeMaximizeButtons() {
  const minimizeBtn = document.getElementById('minimizeTracker');
  const maximizeBtn = document.getElementById('maximizeTracker');

  // First, remove any existing event listeners to prevent duplicates
  if (minimizeBtn) {
    const newMinBtn = minimizeBtn.cloneNode(true);
    if (minimizeBtn.parentNode) {
      minimizeBtn.parentNode.replaceChild(newMinBtn, minimizeBtn);
    }
    newMinBtn.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      minimizeResults();
      return false;
    };
  }

  if (maximizeBtn) {
    const newMaxBtn = maximizeBtn.cloneNode(true);
    if (maximizeBtn.parentNode) {
      maximizeBtn.parentNode.replaceChild(newMaxBtn, maximizeBtn);
    }
    newMaxBtn.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      maximizeResults();
      return false;
    };
  }
}


    // Add a helper function to toggle the current domain card’s visibility in minimized mode
// Helper function to toggle the current domain card’s visibility (minimized mode only)
// Global flag to track whether the current domain card is hidden in minimized mode



/**
 * Whether the current domain card is currently hidden in minimized mode
 * Persisted via GM storage so the state is saved across reloads.
 */
let minimizedCardHidden = false;

/**
 * Toggles the visibility of the current domain card (when minimized).
 * Persists the “hidden” state in GM storage.
 */
function toggleCurrentDomainCardVisibility() {
  // Flip the flag
  minimizedCardHidden = !minimizedCardHidden;

  // Update the button text
  const btn = document.getElementById('toggleCurrentCardMin');
  if (btn) {
    btn.textContent = minimizedCardHidden ? 'Show Card' : 'Hide Card';
  }

  // Save state directly to GM storage only, not to guiState
  GM_setValue("minimizedCardHidden", minimizedCardHidden);

  // Apply the visibility changes
  applyCurrentDomainVisibility();
}


    // Function to add the Theme button to the minimized mode
function addThemeButton() {
  // Check if the Theme button already exists
  let themeBtn = document.getElementById('themeCustomizeBtn');
  if (themeBtn) {
    return; // Button already exists
  }

  // Create the Theme button
  themeBtn = document.createElement('button');
  themeBtn.id = 'themeCustomizeBtn';
  themeBtn.className = 'control-btn';
  themeBtn.textContent = 'Theme';
  themeBtn.style.position = 'absolute';
  themeBtn.style.top = '2px';
  themeBtn.style.left = '65px'; // Position it to the left of other buttons
  themeBtn.style.zIndex = '999999';
  themeBtn.style.width = 'auto';
  themeBtn.style.padding = '4px 6px';
  themeBtn.style.fontSize = '10px';

  // Initially hide the button - it will only be shown in minimized mode
  themeBtn.style.display = 'none';

  // Add click event handler
  themeBtn.onclick = function(e) {
    e.preventDefault();
    e.stopPropagation();
    openThemeCustomizer();
    return false;
  };

  // Add the button to the container
  const container = document.getElementById('bonus-checker-container');
  if (container) {
    container.appendChild(themeBtn);
  }

  // Update the button visibility based on current minimized state
  updateThemeButtonVisibility();
}

// Function to update Theme button visibility based on minimized state
function updateThemeButtonVisibility() {
  const container = document.getElementById('bonus-checker-container');
  const themeBtn = document.getElementById('themeCustomizeBtn');

  if (!container || !themeBtn) return;

  // Only show in minimized mode
  if (container.classList.contains('minimized')) {
    themeBtn.style.display = 'block';
  } else {
    themeBtn.style.display = 'none';
  }
}

// Add hooks to the existing minimize/maximize functions to update button visibility
const originalMinimizeResults = minimizeResults;
minimizeResults = function() {
  originalMinimizeResults.apply(this, arguments);
  updateThemeButtonVisibility();
};

const originalMaximizeResults = maximizeResults;
maximizeResults = function() {
  originalMaximizeResults.apply(this, arguments);
  updateThemeButtonVisibility();
};

// Call during initialization
addThemeButton();

// Make sure the button gets added whenever the GUI is recreated
const originalCreateGUI = createGUI;
createGUI = function() {
  originalCreateGUI.apply(this, arguments);
  addThemeButton();
};
/**
 * Reads and applies the “minimized” + “hide card” states from GM storage,
 * so they persist across page refreshes.
 */
function initializeMinimizedState() {
    // Get visibility state ONLY from direct GM storage, not from guiState
    try {
        minimizedCardHidden = GM_getValue("minimizedCardHidden", false);
        gameSlotsVisible = GM_getValue("gameSlotsVisible", true);
    } catch (e) {
        minimizedCardHidden = false;
        gameSlotsVisible = true;
    }

    const minimized = GM_getValue("minimized", false);
    const container = document.getElementById('bonus-checker-container');
    if (!container) return;

    // Apply minimized or not
    if (minimized) {
        container.classList.add('minimized');
    } else {
        container.classList.remove('minimized');
    }

    // Configure the toggle button
    const toggleBtn = document.getElementById('toggleCurrentCardMin');
    if (toggleBtn) {
        // Update button text from our loaded state
        toggleBtn.textContent = minimizedCardHidden ? 'Show Card' : 'Hide Card';

        // Only show the toggle button if we're minimized
        toggleBtn.style.display = minimized ? 'block' : 'none';
    }

    // Apply the card visibility state
    applyCurrentDomainVisibility();

    // Apply the game slots visibility state
    const slotsContainer = document.getElementById('gameSlotsContainer');
    if (slotsContainer) {
        if (gameSlotsVisible) {
            slotsContainer.style.display = 'flex';
            slotsContainer.style.cssText = "display: flex !important;";
        } else {
            slotsContainer.style.display = 'none';
            slotsContainer.style.cssText = "display: none !important;";
        }
    }
}



/**
 * Applies the current domain card’s hidden/visible state
 * (called by initializeMinimizedState).
 */
function applyCurrentDomainVisibility() {
    const currentDomainCard = document.getElementById('currentDomainCardContainer');
    const container = document.getElementById('bonus-checker-container');
    if (!currentDomainCard || !container) return;

    // Apply visibility based ONLY on the minimizedCardHidden flag
    // Don't check other conditions that might override it
    if (minimizedCardHidden) {
        currentDomainCard.style.cssText = "display: none !important;";

        // In minimized mode, also shrink container height:
        if (container.classList.contains('minimized')) {
            container.style.minHeight = '30px';
            container.style.paddingTop = '30px';
        } else {
            container.style.minHeight = '';
            container.style.paddingTop = '';
        }
    } else {
        currentDomainCard.style.cssText = "display: block !important;";
        container.style.minHeight = '';
        container.style.paddingTop = '';
    }

    // Also update the toggle button text (if we're in minimized mode)
    const toggleBtn = document.getElementById('toggleCurrentCardMin');
    if (toggleBtn) {
        // Show the toggle button only if minimized
        toggleBtn.style.display = container.classList.contains('minimized') ? 'block' : 'none';
        toggleBtn.textContent = minimizedCardHidden ? 'Show Card' : 'Hide Card';
    }
}
// Global flag to track whether the current domain card is hidden in minimized mode




// Replace your current createGUI function with this updated version

function createGUI() {
  console.log("Creating GUI...");
  // First, check if GUI already exists and is properly initialized
  const existingGUI = document.getElementById('bonus-checker-container');

  // If we're not recreating the GUI and it exists, just update state rather than recreating
  if (existingGUI && existingGUI.querySelector('.header-controls')) {
    console.log("GUI already exists, just updating state");
    // Just update the state but don't recreate elements
    if (GM_getValue("minimized", false)) {
      existingGUI.classList.add('minimized');
    } else {
      existingGUI.classList.remove('minimized');
    }
    setupMinimizeMaximizeButtons();
    initializeMinimizedState();
    updateCurrentDomainCard();
    return;
  }

  console.log("Creating new GUI or rebuilding existing one");

  // If we get here, we need to create or recreate the GUI
  applyMinimizedStateEarly();

  let container = existingGUI;
  if (!container) {
    container = document.createElement('div');
    container.id = 'bonus-checker-container';
    container.style.position = 'fixed';
    container.style.top = '0';
    container.style.left = '0';
    container.style.right = '0';
    container.style.zIndex = '999999';
    container.style.maxHeight = '86vh';
    container.style.overflowY = 'auto';
    container.style.background = 'rgba(0,0,0,0.9)';
    container.style.color = '#fff';
    container.style.fontFamily = 'Helvetica, Arial, sans-serif';
    container.style.borderBottom = '2px solid #ff1493';
    container.style.boxShadow = '0 4px 8px rgba(0,0,0,0.5)';
  } else {
    // Clear existing container to rebuild
    container.innerHTML = '';
  }

  if (GM_getValue("minimized", false)) {
    container.classList.add('minimized');
  } else {
    container.classList.remove('minimized');
  }

  // Create new guiContent
  const guiContent = document.createElement('div');
  guiContent.id = 'guiContent';
  guiContent.style.padding = '5px';
  guiContent.style.display = 'flex';
  guiContent.style.flexDirection = 'column';
  container.appendChild(guiContent);

  // Status message container
  const statusMessage = document.createElement('div');
  statusMessage.className = 'status-message';
  statusMessage.id = 'statusMessage';
  statusMessage.style.display = 'none';
  statusMessage.style.order = '2';
  guiContent.appendChild(statusMessage);

  // Header controls container - FIXED THIS LINE
  const headerControls = document.createElement('div');
  headerControls.className = 'header-controls';
  headerControls.style.width = '100%';
  headerControls.style.boxSizing = 'border-box';
  headerControls.style.order = '1';
  guiContent.appendChild(headerControls);

  // Header rows
  const row1 = document.createElement('div');
  row1.className = 'header-row';
  row1.innerHTML = `
        <button id="editUrls" class="control-btn">Edit Domains</button>
        <button id="fetchFreshBonusData" class="control-btn">Fetch Fresh Bonus</button>
        <button id="showCachedBonuses" class="control-btn">Show Cached</button>
        <button id="showCurrentDomainOnly" class="control-btn">Show Current</button>
  `;
  headerControls.appendChild(row1);

  const row2 = document.createElement('div');
  row2.className = 'header-row';
  row2.innerHTML = `
        <button id="toggleAutoLogin" class="control-btn">Auto Login: OFF</button>
        <button id="toggleAutoNavNonVisited" class="control-btn">Auto Non-Visited: OFF</button>
        <button id="toggleAutoNavValid" class="control-btn">Auto Valid: OFF</button>
        <button id="refreshLastBtn" class="control-btn">Refresh Last</button>
  `;
  headerControls.appendChild(row2);

  const row3 = document.createElement('div');
  row3.className = 'header-row';
  row3.innerHTML = `
        <button id="toggleSortBtn" class="control-btn">Sort</button>
        <button id="setDomainCredentials" class="control-btn">Set Domain Creds</button>
        <button id="nextDomainBtn" class="control-btn">Next</button>
        <button id="minimizeTracker" class="control-btn">Minimize</button>
  `;
  headerControls.appendChild(row3);

  const row4 = document.createElement('div');
  row4.className = 'header-row';
  row4.innerHTML = `
        <button id="registerBtn" class="control-btn">Register</button>
        <button id="registerCredsBtn" class="control-btn">Register Creds</button>
        <button id="exportReferLinksBtn" class="control-btn">Export Refer Links</button>
        <button id="selectorBtn" class="control-btn">Selector</button>
  `;
  headerControls.appendChild(row4);

  // Clean up any existing minimized buttons before creating new ones
  const existingButtons = [
    'refreshLastMin', 'nextDomainMin', 'exportReferLinksMin',
    'maximizeTracker', 'toggleCurrentCardMin'
  ];

  existingButtons.forEach(id => {
    const oldBtn = document.getElementById(id);
    if (oldBtn) oldBtn.remove();
  });

  // Create minimized mode buttons (only visible when minimized)
  const refreshLastMinBtn = document.createElement('button');
  refreshLastMinBtn.id = 'refreshLastMin';
  refreshLastMinBtn.className = 'control-btn';
  refreshLastMinBtn.textContent = 'Refresh Last';
  refreshLastMinBtn.style.position = 'absolute';
  refreshLastMinBtn.style.top = '2px';
  refreshLastMinBtn.style.right = '115px';
  refreshLastMinBtn.style.zIndex = '999999';
  refreshLastMinBtn.style.width = 'auto';
  refreshLastMinBtn.style.display = container.classList.contains('minimized') ? 'block' : 'none';
  refreshLastMinBtn.onclick = function(e) {
    e.preventDefault();
    e.stopPropagation();
    refreshLastVisited();
  };
  container.appendChild(refreshLastMinBtn);

  const nextDomainMinBtn = document.createElement('button');
  nextDomainMinBtn.id = 'nextDomainMin';
  nextDomainMinBtn.className = 'control-btn';
  nextDomainMinBtn.textContent = 'Next';
  nextDomainMinBtn.style.position = 'absolute';
  nextDomainMinBtn.style.top = '2px';
  nextDomainMinBtn.style.right = '70px';
  nextDomainMinBtn.style.zIndex = '999999';
  nextDomainMinBtn.style.width = 'auto';
  nextDomainMinBtn.style.display = container.classList.contains('minimized') ? 'block' : 'none';
  nextDomainMinBtn.onclick = function(e) {
    e.preventDefault();
    e.stopPropagation();
    goToNextDomain();
  };
  container.appendChild(nextDomainMinBtn);

  const exportReferLinksMinBtn = document.createElement('button');
exportReferLinksMinBtn.id = 'exportReferLinksMin';
exportReferLinksMinBtn.className = 'control-btn';
exportReferLinksMinBtn.textContent = 'Toggle Slots'; // Changed label in minimized mode
exportReferLinksMinBtn.style.position = 'absolute';
exportReferLinksMinBtn.style.top = '2px';
exportReferLinksMinBtn.style.right = '197px';
exportReferLinksMinBtn.style.zIndex = '999999';
exportReferLinksMinBtn.style.width = 'auto';
// This button only shows when minimized
exportReferLinksMinBtn.style.display = container.classList.contains('minimized') ? 'block' : 'none';
exportReferLinksMinBtn.onclick = function(e) {
  e.preventDefault();
  e.stopPropagation();
  // In minimized mode, call the toggle game slots function
  toggleGameSlotsVisibility();
};
container.appendChild(exportReferLinksMinBtn);
  const maximizeButton = document.createElement('button');
  maximizeButton.id = 'maximizeTracker';
  maximizeButton.className = 'control-btn';
  maximizeButton.textContent = 'Maximize';
  maximizeButton.style.position = 'absolute';
  maximizeButton.style.top = '2px';
  maximizeButton.style.right = '2px';
  maximizeButton.style.zIndex = '999999';
  maximizeButton.style.width = 'auto';
  maximizeButton.style.display = container.classList.contains('minimized') ? 'block' : 'none';
  container.appendChild(maximizeButton);

  // Create the toggle button for hiding/showing the current domain card
  const toggleCurrentCardMinBtn = document.createElement('button');
  toggleCurrentCardMinBtn.id = 'toggleCurrentCardMin';
  toggleCurrentCardMinBtn.className = 'control-btn';
  // Initially, when minimized the card is visible so the button reads "Hide Card"
  toggleCurrentCardMinBtn.textContent = 'Hide Card';
  toggleCurrentCardMinBtn.style.position = 'absolute';
  toggleCurrentCardMinBtn.style.left = '10px';
  toggleCurrentCardMinBtn.style.top = '2px';
  toggleCurrentCardMinBtn.style.zIndex = '999999';
  toggleCurrentCardMinBtn.style.width = 'auto';
  toggleCurrentCardMinBtn.style.display = container.classList.contains('minimized') ? 'block' : 'none';
  toggleCurrentCardMinBtn.onclick = function(e) {
    e.preventDefault();
    e.stopPropagation();
    toggleCurrentDomainCardVisibility();
  };
  container.appendChild(toggleCurrentCardMinBtn);

  const resultsArea = document.createElement('div');
  resultsArea.id = 'resultsArea';
  resultsArea.style.order = '4';
  guiContent.appendChild(resultsArea);

  if (!document.body.contains(container)) {
    document.body.appendChild(container);
  }

  guiElement = container;

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
          border: 1px solid var(--mainBorder);
          color: #fff;
          transition: all 0.2s ease;
          text-align: center;
      }
      .control-btn:hover {
          background: #fff;
          color: #ff1493;
      }
      /* Override for minimized mode buttons: force Next button right position */
      #bonus-checker-container.minimized #nextDomainMin {
          right: 70px !important;
      }
  `;
  document.head.appendChild(styleTag);

  // Add event listeners to buttons
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
  addListener(document.getElementById('registerBtn'), 'click', handleRegisterButton);
  addListener(document.getElementById('registerCredsBtn'), 'click', handleRegisterCredsButton);
  addListener(document.getElementById('exportReferLinksBtn'), 'click', exportReferLinks);
  addListener(document.getElementById('selectorBtn'), 'click', handleSelectorButton);
  addListener(maximizeButton, 'click', maximizeResults);

  // Update button states
  if (typeof updateToggleButtons !== 'undefined') {
    updateToggleButtons();
  }
  if (typeof updateSortButtonText !== 'undefined') {
    updateSortButtonText();
  }

  // Final setup
  setupMinimizeMaximizeButtons();
  initializeMinimizedState();
  updateCurrentDomainCard();

  // Add game slots after all the controls
  addGameSlotsUI();

  console.log("GUI creation completed successfully");
}



// Update minimizeResults function to properly hide slot buttons
// Update minimizeResults function to properly show slot toggle button
function minimizeResults() {
  const container = document.getElementById('bonus-checker-container');
  if (!container) return;

  // Add minimized class
  container.classList.add('minimized');

  // Add necessary styles for button visibility
  if (minimizedCardHidden) {
    container.style.minHeight = '30px';
    container.style.paddingTop = '30px';
  }

  GM_setValue("minimized", true);

  // Clear all domain cards except the current domain card
  const resultsArea = document.getElementById('resultsArea');
  if (resultsArea) {
    const cards = resultsArea.querySelectorAll('.site-card:not(.current-domain-card)');
    cards.forEach(card => {
      card.remove();
    });
  }

  // CRITICAL FIX: Ensure all individual slot buttons are hidden
  for (let i = 0; i < 4; i++) {
    const slotBtn = document.getElementById(`slotBtn${i}`);
    if (slotBtn) {
      slotBtn.style.display = 'none'; // Force hide
      slotBtn.style.cssText = "display: none !important;"; // Use !important to override
    }
  }

  // Show the minimized-mode buttons
  const refreshLastMinBtn = document.getElementById('refreshLastMin');
  if (refreshLastMinBtn) refreshLastMinBtn.style.display = 'block';

  const nextDomainMinBtn = document.getElementById('nextDomainMin');
  if (nextDomainMinBtn) nextDomainMinBtn.style.display = 'block';

  const maximizeBtn = document.getElementById('maximizeTracker');
  if (maximizeBtn) maximizeBtn.style.display = 'block';

  const exportReferLinksMinBtn = document.getElementById('exportReferLinksMin');
  if (exportReferLinksMinBtn) exportReferLinksMinBtn.style.display = 'block';

  // Show the toggle button for the current domain card
  const toggleBtn = document.getElementById('toggleCurrentCardMin');
  if (toggleBtn) {
    toggleBtn.style.display = 'block';
    toggleBtn.textContent = minimizedCardHidden ? 'Show Card' : 'Hide Card';
  }

  // Also show slot toggle button
  const slotToggleBtn = document.getElementById('slotToggleBtn');
  if (slotToggleBtn) {
    slotToggleBtn.style.display = 'block';
    slotToggleBtn.style.cssText = "display: block !important;";
    slotToggleBtn.classList.add('minimized-visible');
  }

  // Apply current domain card visibility
  applyCurrentDomainVisibility();

  // Apply game slots visibility from saved state - IMPORTANT FOR PERSISTENCE
  const slotsContainer = document.getElementById('gameSlotsContainer');
  if (slotsContainer) {
    // Read directly from GM value to ensure consistency
    const slotsVisible = GM_getValue("gameSlotsVisible", true);

    if (slotsVisible) {
      slotsContainer.style.display = 'flex';
      slotsContainer.style.cssText = "display: flex !important;";
    } else {
      slotsContainer.style.display = 'none';
      slotsContainer.style.cssText = "display: none !important;";
    }

    // Update the global variable to match storage
    gameSlotsVisible = slotsVisible;
  }

  // Add to the end of minimizeResults()
  if (typeof applyThemeToGUI === 'function') {
    applyThemeToGUI();
  }
}

// Update maximizeResults function to properly hide slot toggle button
// Toggle the game slots container’s visibility and persist that state
// Global flag for game slots visibility (default true)


/**
 * Called when you click the export button in minimized mode (which is labeled "Toggle Slots").
 * This function toggles the game slots container’s visibility and saves the state to GM storage.
 */
function toggleGameSlotsVisibility() {
  // Flip the current state
  gameSlotsVisible = !gameSlotsVisible;

  // Apply visibility to the game slots container
  const slotsContainer = document.getElementById('gameSlotsContainer');
  if (slotsContainer) {
    if (gameSlotsVisible) {
      slotsContainer.style.display = 'flex';
      slotsContainer.style.cssText = "display: flex !important;";
    } else {
      slotsContainer.style.display = 'none';
      slotsContainer.style.cssText = "display: none !important;";
    }
  }

  // Store the state directly to GM storage as the single source of truth
  GM_setValue("gameSlotsVisible", gameSlotsVisible);
}


/**
 * Called when you maximize the GUI.
 * This function removes minimized styles and then checks the saved gameSlotsVisible state—
 * if you had toggled slots off in minimized mode, they remain hidden in maximized mode.
 */
function maximizeResults() {
  const container = document.getElementById('bonus-checker-container');
  if (!container) return;

  // Remove minimized class
  container.classList.remove('minimized');

  // Always reset container styles in maximized mode
  container.style.minHeight = '';
  container.style.paddingTop = '';

  GM_setValue("minimized", false);

  // Hide any buttons that are meant only for minimized mode.
  const minimizedButtonIds = [
    'refreshLastMin',
    'nextDomainMin',
    'maximizeTracker',
    'exportReferLinksMin',
    'toggleCurrentCardMin',
    'slotToggleBtn' // Also hide the slot toggle button
  ];

  // Also hide any individual slot buttons
  for (let i = 0; i < 4; i++) {
    minimizedButtonIds.push(`slotBtn${i}`);
  }
  minimizedButtonIds.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.style.display = 'none';
      btn.style.cssText = "display: none !important;";
      if (id === 'exportReferLinksMin' || id === 'slotToggleBtn') {
        btn.classList.remove('minimized-visible');
      }
    }
  });

  // Set current domain card visibility based on minimizedCardHidden flag.
  // In maximized mode we want no extra space even if the card is hidden.
  const currentDomainCard = document.getElementById('currentDomainCardContainer');
  if (currentDomainCard) {
    if (minimizedCardHidden) {
      currentDomainCard.style.cssText = "display: none !important;";
    } else {
      currentDomainCard.style.cssText = "display: block !important;";
    }
  }

  // Apply game slots visibility (maintaining state from GM storage)
  const slotsContainer = document.getElementById('gameSlotsContainer');
  if (slotsContainer) {
    const slotsVisible = GM_getValue("gameSlotsVisible", true);
    if (slotsVisible) {
      slotsContainer.style.display = 'flex';
      slotsContainer.style.cssText = "display: flex !important;";
    } else {
      slotsContainer.style.display = 'none';
      slotsContainer.style.cssText = "display: none !important;";
    }
    gameSlotsVisible = slotsVisible;
  }

  // Apply theme updates if the function exists.
  if (typeof applyThemeToGUI === 'function') {
    applyThemeToGUI();
  }
}

// Function to add the Slot toggle button
function addSlotToggleButton() {
  // Remove existing button if it exists
  const existingBtn = document.getElementById('slotToggleBtn');
  if (existingBtn) existingBtn.remove();

  // Create the Slot button
  const slotToggleBtn = document.createElement('button');
  slotToggleBtn.id = 'slotToggleBtn';
  slotToggleBtn.className = 'control-btn';
  slotToggleBtn.textContent = 'Slot';
  slotToggleBtn.style.position = 'absolute';
  slotToggleBtn.style.top = '2px';
  slotToggleBtn.style.right = '260px';
  slotToggleBtn.style.zIndex = '999999';
  slotToggleBtn.style.padding = '4px 6px';
  slotToggleBtn.style.fontSize = '10px';
  slotToggleBtn.style.display = 'none'; // Initially hidden

  // Add click event handler
  slotToggleBtn.onclick = function(e) {
    e.preventDefault();
    e.stopPropagation();
    toggleGameSlotsVisibility();
    return false;
  };

  // Add to body to ensure it's not affected by container styles
  document.body.appendChild(slotToggleBtn);

  // Update visibility based on current state
  const container = document.getElementById('bonus-checker-container');
  if (container && container.classList.contains('minimized')) {
    slotToggleBtn.style.display = 'block';
    slotToggleBtn.style.cssText = "display: block !important;";
    slotToggleBtn.classList.add('minimized-visible');
  }

  return slotToggleBtn;
}

// Function to add CSS for the slot toggle button
function addSlotToggleStyles() {
  const style = document.createElement('style');
  style.id = 'slot-toggle-styles';
  style.textContent = `
    /* Styles for Slot toggle button */
    #slotToggleBtn {
      position: absolute !important;
      top: 2px !important;
      right: 260px !important;
      z-index: 999999 !important;
      padding: 4px 6px !important;
      font-size: 10px !important;
      background: var(--buttonBackground, rgba(0,0,0,0.6)) !important;
      color: var(--buttonText, #fff) !important;
      border: 1px solid var(--buttonBorder, #ff1493) !important;
    }

    #slotToggleBtn:hover {
      background: var(--buttonHoverBackground, #fff) !important;
      color: var(--buttonHoverText, #ff1493) !important;
    }

    /* Force the button to be visible in minimized mode */
    #bonus-checker-container.minimized ~ #slotToggleBtn,
    body.minimized #slotToggleBtn,
    html.minimized #slotToggleBtn,
    #slotToggleBtn.minimized-visible {
      display: block !important;
    }

    /* Make sure the slot buttons are NEVER visible in minimized mode */
    #bonus-checker-container.minimized #slotBtn0,
    #bonus-checker-container.minimized #slotBtn1,
    #bonus-checker-container.minimized #slotBtn2,
    #bonus-checker-container.minimized #slotBtn3 {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
}




// 3. ADD THIS FUNCTION - Toggles game slots container visibility


    function initializeSlotToggle() {
  // Add CSS styles
  const style = document.createElement('style');
  style.id = 'slot-toggle-styles';
  style.textContent = `
    /* Styles for Slot toggle button */
    #slotToggleBtn {
      position: absolute !important;
      top: 2px !important;
      right: 260px !important;
      z-index: 999999 !important;
      padding: 4px 6px !important;
      font-size: 10px !important;
      background: var(--buttonBackground, rgba(0,0,0,0.6)) !important;
      color: var(--buttonText, #fff) !important;
      border: 1px solid var(--buttonBorder, #ff1493) !important;
    }

    #slotToggleBtn:hover {
      background: var(--buttonHoverBackground, #fff) !important;
      color: var(--buttonHoverText, #ff1493) !important;
    }

    /* Make sure the individual slot buttons are NEVER shown in minimized mode */
    #bonus-checker-container.minimized #slotBtn0,
    #bonus-checker-container.minimized #slotBtn1,
    #bonus-checker-container.minimized #slotBtn2,
    #bonus-checker-container.minimized #slotBtn3 {
      display: none !important;
    }
  `;
  document.head.appendChild(style);

  // Create the slot toggle button
  addSlotToggleButton();

  // Load initial visibility state
  try {
    const state = JSON.parse(GM_getValue("guiState", "{}")) || {};
    gameSlotsVisible = state.gameSlotsVisible !== undefined ? state.gameSlotsVisible : true;
  } catch (e) {
    gameSlotsVisible = true; // Default to visible
  }
}
    // Global variables for game slots
 // No slot selected by default

// Function to load saved game slots from storage
function loadGameSlots() {
  try {
    const savedSlots = GM_getValue("gameSlotData", "{}");
    gameSlotData = JSON.parse(savedSlots);

    // Update UI with stored data
    updateGameSlotUI();
  } catch (e) {
    console.error("Error loading game slots:", e);
    gameSlotData = {};
  }
}

// Function to save game slots to storage
function saveGameSlots() {
  try {
    GM_setValue("gameSlotData", JSON.stringify(gameSlotData));

    // Verify save was successful
    const savedData = GM_getValue("gameSlotData", "{}");
    try {
      const parsed = JSON.parse(savedData);
      if (Object.keys(parsed).length !== Object.keys(gameSlotData).length) {
        // Retry if save wasn't complete
        setTimeout(() => {
          GM_setValue("gameSlotData", JSON.stringify(gameSlotData));
        }, 100);
      }
    } catch (e) {
      // If parsing fails, retry the save
      setTimeout(() => {
        GM_setValue("gameSlotData", JSON.stringify(gameSlotData));
      }, 100);
    }
  } catch (e) {
    console.error("Error saving game slots:", e);
    updateStatusWithColor("Failed to save game slots", "error");
  }
}

// Function to update UI based on stored data
function updateGameSlotUI() {
  // Update each slot with stored image if available
  for (let i = 0; i < 4; i++) {
    const slot = document.getElementById(`gameSlot${i}`);
    if (!slot) continue;

    // Clear existing content
    const label = slot.querySelector('.slot-label');
    const existingThumb = slot.querySelector('.slot-thumbnail');
    if (existingThumb) {
      existingThumb.remove();
    }

    // If we have data for this slot
    if (gameSlotData[i] && gameSlotData[i].imageUrl) {
      // Create the container for the image that will fill the entire slot
      const imgContainer = document.createElement('div');
      imgContainer.className = 'slot-thumbnail';
      imgContainer.style.width = '100%';
      imgContainer.style.height = '100%';
      imgContainer.style.position = 'absolute';
      imgContainer.style.top = '0';
      imgContainer.style.left = '0';
      imgContainer.style.right = '0';
      imgContainer.style.bottom = '0';

      // Set the background image to stretch to fill the entire container
      imgContainer.style.backgroundImage = `url(${gameSlotData[i].imageUrl})`;
      imgContainer.style.backgroundSize = '100% 100%'; // Changed to stretch in both directions
      imgContainer.style.backgroundPosition = 'center center';
      imgContainer.style.backgroundRepeat = 'no-repeat';

      // Insert the thumbnail at the beginning of slot
      slot.insertBefore(imgContainer, slot.firstChild);

      // Empty label
      if (label) {
        label.textContent = ``;
      }
    } else {
      // Empty slot - no text
      if (label) {
        label.textContent = ``;
      }
    }

    // Update active state with a more visible indicator
    if (i === activeSlot) {
      slot.classList.add('active');
      slot.style.border = '2px solid #ff69b4';
      slot.style.boxShadow = '0 0 8px #ff1493';
    } else {
      slot.classList.remove('active');
      slot.style.border = '1px dashed #ff1493';
      slot.style.boxShadow = 'none';
    }
  }

  // Also update minimized slot buttons if they exist
  for (let i = 0; i < 4; i++) {
    const slotBtn = document.getElementById(`slotBtn${i}`);
    if (slotBtn) {
      if (gameSlotData[i] && gameSlotData[i].imageUrl) {
        slotBtn.textContent = `S${i+1}`;
        slotBtn.style.backgroundColor = i === activeSlot ? 'rgba(255,20,147,0.5)' : '';
      } else {
        slotBtn.textContent = `S${i+1}`;
        slotBtn.style.backgroundColor = '';
      }
    }
  }
}
    // Add game slot UI elements to the GUI
// Add game slot UI elements to the GUI - updated to position at the top
function addGameSlotsUI() {
  // Create container for game slots if it doesn't exist
  let slotsContainer = document.getElementById('gameSlotsContainer');
  if (slotsContainer) {
    // Container exists, no need to recreate
    return;
  }

  // Create the container
  slotsContainer = document.createElement('div');
  slotsContainer.id = 'gameSlotsContainer';
  slotsContainer.style.display = 'flex';
  slotsContainer.style.justifyContent = 'space-between';
  slotsContainer.style.gap = '5px';
  slotsContainer.style.margin = '5px 0';
  slotsContainer.style.padding = '5px';
  slotsContainer.style.background = 'rgba(0,0,0,0.3)';
  slotsContainer.style.border = '1px solid #ff1493';
  slotsContainer.style.borderRadius = '3px';
  slotsContainer.style.order = '0'; // Set to 0 to position at the top

  // Add CSS for the slot thumbnails
  const slotStyle = document.createElement('style');
  slotStyle.textContent = `
    .game-slot {
      position: relative;
      overflow: hidden;
    }
    .slot-thumbnail {
      width: 100% !important;
      height: 100% !important;
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-size: 100% 100% !important; /* Force stretch in both directions */
      background-position: center center !important;
    }
    .game-slot.active {
      border: 2px solid #ff69b4 !important;
      box-shadow: 0 0 8px #ff1493 !important;
    }
  `;
  document.head.appendChild(slotStyle);

  // Load visibility state from storage
  gameSlotsVisible = GM_getValue("gameSlotsVisible", true);

  // Apply the visibility setting immediately
  if (!gameSlotsVisible) {
    slotsContainer.style.display = 'none';
    slotsContainer.style.cssText = "display: none !important;";
  }

  // Create 4 game slots
  for (let i = 0; i < 4; i++) {
    const slot = document.createElement('div');
    slot.id = `gameSlot${i}`;
    slot.className = 'game-slot';
    slot.setAttribute('data-slot', i);
    slot.style.flex = '1';
    slot.style.height = '40px';
    slot.style.background = 'rgba(0,0,0,0.5)';
    slot.style.border = '1px dashed #ff1493';
    slot.style.borderRadius = '3px';
    slot.style.display = 'flex';
    slot.style.alignItems = 'center';
    slot.style.justifyContent = 'center';
    slot.style.color = '#fff';
    slot.style.fontSize = '10px';
    slot.style.cursor = 'pointer';
    slot.style.position = 'relative';
    slot.style.overflow = 'hidden';

    // Leave slot empty
    slot.innerHTML = `<span class="slot-label"></span>`;

    // Add click handler
    slot.addEventListener('click', function() {
      selectGameSlot(i);
    });

    slotsContainer.appendChild(slot);
  }

  // Add the slots container to the beginning of guiContent
  const guiContent = document.getElementById('guiContent');
  if (guiContent && guiContent.firstChild) {
    guiContent.insertBefore(slotsContainer, guiContent.firstChild);
  } else if (guiContent) {
    guiContent.appendChild(slotsContainer);
  }

  // Add slot buttons to the minimized mode - FIXED VERSION
  const container = document.getElementById('bonus-checker-container');

  // First, remove any existing slot buttons
  for (let i = 0; i < 4; i++) {
    const existingBtn = document.getElementById(`slotBtn${i}`);
    if (existingBtn) {
      existingBtn.remove();
    }
  }

  // Now create fresh buttons with correct positioning and initial state
  for (let i = 0; i < 4; i++) {
    const slotBtn = document.createElement('button');
    slotBtn.id = `slotBtn${i}`;
    slotBtn.className = 'control-btn';
    slotBtn.textContent = `S${i+1}`; // Use shortened version for buttons
    slotBtn.style.position = 'absolute';
    slotBtn.style.top = '2px';
    slotBtn.style.left = `${140 + i*60}px`;
    slotBtn.style.zIndex = '999999';
    slotBtn.style.padding = '4px 6px';
    slotBtn.style.fontSize = '10px';

    // CRITICAL FIX: Always initialize as hidden
    slotBtn.style.display = 'none';
    slotBtn.style.cssText += "display: none !important;"; // Use !important

    slotBtn.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      handleGameSlotButton(i);
    };

    container.appendChild(slotBtn);
  }

  // Initialize from saved data
  loadGameSlots();
}

// Call this function when creating the GUI
function initializeGameSlots() {
  // Add to createGUI function
  addGameSlotsUI();

  // Load state from storage and apply it
  gameSlotsVisible = GM_getValue("gameSlotsVisible", true);

  // Apply visibility based on loaded state
  const slotsContainer = document.getElementById('gameSlotsContainer');
  if (slotsContainer) {
    if (gameSlotsVisible) {
      slotsContainer.style.display = 'flex';
      slotsContainer.style.cssText = "display: flex !important;";
    } else {
      slotsContainer.style.display = 'none';
      slotsContainer.style.cssText = "display: none !important;";
    }
  }

  // Initialize the toggle control
  if (!document.getElementById('slotToggleBtn')) {
    addSlotToggleButton();
  }

  // Initialize from saved data for slot contents
  loadGameSlots();
}
// Helper function to apply current domain card visibility based on minimizedCardHidden state
// Helper function to apply current domain card visibility based on minimizedCardHidden state


    function handleRegisterCredsButton() {
    // If an overlay is already present, remove it to start fresh
    const existingOverlay = document.getElementById('registerCredsOverlay');
    if (existingOverlay) existingOverlay.remove();

    // Create a full-screen overlay (like your other modals):
    const overlay = document.createElement('div');
    overlay.id = 'registerCredsOverlay';
    overlay.className = 'modal-overlay';  // so it matches your existing .modal-overlay styling
    // We’ll also position it so it’s a bit “lower” on the screen:
    // Instead of perfectly centered, we do alignItems: flex-start + some top padding:
    overlay.style.display = 'flex';
    overlay.style.justifyContent = 'center';
    overlay.style.alignItems = 'flex-start';
    overlay.style.paddingTop = '120px'; // so it appears lower
    // If your .modal-overlay CSS sets "display:none" by default, we can add 'active':
    overlay.classList.add('active');

    // Pull any existing saved creds
    const savedCreds = GM_getValue("registerCreds", {
        name: "",
        mobile: "",
        password: "",
        email: "",
        bankAccountName: "",
        bankBSB: "",
        bankAccountNumber: "",
        payID: ""
    });

    // Create the modal itself:
    const modal = document.createElement('div');
    modal.id = 'registerCredsModal';
    modal.className = 'url-modal';  // same class you use for edit domain, etc.
    // We can also make it scrollable inside:
    modal.style.maxHeight = '70vh';
    modal.style.overflowY = 'auto';

    // This HTML follows the same dark/pink style as your other popups
    modal.innerHTML = `
        <h3 style="color: #ff1493; margin-top: 0; margin-bottom: 10px; text-align: center;">
            Register Credentials
        </h3>
        <label style="color: #fff; margin-bottom: 4px; display:block;">Name:</label>
        <input type="text" id="regName" class="url-textarea"
               style="height:auto; margin-bottom:8px;"
               value="${savedCreds.name || ''}" />

        <label style="color: #fff; margin-bottom: 4px; display:block;">Mobile:</label>
        <input type="text" id="regMobile" class="url-textarea"
               style="height:auto; margin-bottom:8px;"
               value="${savedCreds.mobile || ''}" />

        <label style="color: #fff; margin-bottom: 4px; display:block;">Password:</label>
        <input type="text" id="regPassword" class="url-textarea"
               style="height:auto; margin-bottom:8px;"
               value="${savedCreds.password || ''}" />

        <label style="color: #fff; margin-bottom: 4px; display:block;">Email:</label>
        <input type="text" id="regEmail" class="url-textarea"
               style="height:auto; margin-bottom:8px;"
               value="${savedCreds.email || ''}" />

        <hr style="border:1px solid #ff1493; margin: 12px 0;" />

        <label style="color: #fff; margin-bottom: 4px; display:block;">Bank Account Name:</label>
        <input type="text" id="regBankName" class="url-textarea"
               style="height:auto; margin-bottom:8px;"
               value="${savedCreds.bankAccountName || ''}" />

        <label style="color: #fff; margin-bottom: 4px; display:block;">Bank BSB:</label>
        <input type="text" id="regBSB" class="url-textarea"
               style="height:auto; margin-bottom:8px;"
               value="${savedCreds.bankBSB || ''}" />

        <label style="color: #fff; margin-bottom: 4px; display:block;">Bank Account #:</label>
        <input type="text" id="regAcctNum" class="url-textarea"
               style="height:auto; margin-bottom:8px;"
               value="${savedCreds.bankAccountNumber || ''}" />

        <label style="color: #fff; margin-bottom: 4px; display:block;">PayID:</label>
        <input type="text" id="regPayID" class="url-textarea"
               style="height:auto; margin-bottom:8px;"
               value="${savedCreds.payID || ''}" />

        <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 15px;">
            <button id="saveRegCredsBtn" class="control-btn">Save</button>
            <button id="cancelRegCredsBtn" class="control-btn">Cancel</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // Hook up cancel = close
    document.getElementById('cancelRegCredsBtn').onclick = function() {
        overlay.remove();
    };

    // Hook up save
    document.getElementById('saveRegCredsBtn').onclick = function() {
        const newCreds = {
            name: document.getElementById('regName').value.trim(),
            mobile: document.getElementById('regMobile').value.trim(),
            password: document.getElementById('regPassword').value.trim(),
            email: document.getElementById('regEmail').value.trim(),
            bankAccountName: document.getElementById('regBankName').value.trim(),
            bankBSB: document.getElementById('regBSB').value.trim(),
            bankAccountNumber: document.getElementById('regAcctNum').value.trim(),
            payID: document.getElementById('regPayID').value.trim()
        };
        GM_setValue("registerCreds", newCreds);
        updateStatusWithColor("Saved register credentials!", "success");
        overlay.remove();
    };
}
    // --- (2) HANDLE REGISTER BUTTON ---
function handleRegisterButton() {
    const url = window.location.href.toLowerCase();
    if (url.includes('/register') || url.includes('/smsregister')) {
        updateStatusWithColor("Filling registration form with stored credentials...", "info");
        fillRegisterFormFields();
        // Then click the registration flow buttons:
        autoClickRegistrationFlow();
    } else if (url.includes('/changebank')) {
        updateStatusWithColor("Filling bank account details with stored credentials...", "info");
        fillChangeBankFormFields();
        autoClickChangeBankFlow();
    } else if (url.includes('/changeemail')) {
        updateStatusWithColor("Filling email field with stored credentials...", "info");
        fillChangeEmailFormFields();
        autoClickChangeEmailFlow();
    } else {
        updateStatusWithColor("This page is not recognized for auto-filling registration/bank/email fields.", "warning");
    }
}

function fillRegisterFormFields() {
    // Retrieve saved register credentials (fallback to empty strings if not set)
    const creds = GM_getValue("registerCreds", {
        name: "",
        mobile: "",
        password: "",
        email: "",
        bankAccountName: "",
        bankBSB: "",
        bankAccountNumber: "",
        payID: ""
    });
    const nameField = document.querySelector('input[name="name"]');
    if (nameField && creds.name) nameField.value = creds.name;
    const mobileField = document.querySelector('input[name="mobile"]');
    if (mobileField && creds.mobile) mobileField.value = creds.mobile;
    const passwordField = document.querySelector('input[name="password"]');
    if (passwordField && creds.password) passwordField.value = creds.password;
    const emailField = document.querySelector('input[name="email"]');
    if (emailField && creds.email) emailField.value = creds.email;
    updateStatusWithColor("Registration form fields filled.", "success");
}

function fillChangeBankFormFields() {
    const creds = GM_getValue("registerCreds", {
        bankAccountName: "",
        bankBSB: "",
        bankAccountNumber: "",
        payID: ""
    });
    const bankNameField = document.querySelector('input[name="bankAccountName"]');
    if (bankNameField && creds.bankAccountName) bankNameField.value = creds.bankAccountName;
    const bankBSBField = document.querySelector('input[name="bankBSB"]');
    if (bankBSBField && creds.bankBSB) bankBSBField.value = creds.bankBSB;
    const bankAcctField = document.querySelector('input[name="bankAccountNumber"]');
    if (bankAcctField && creds.bankAccountNumber) bankAcctField.value = creds.bankAccountNumber;
    const payIDField = document.querySelector('input[name="payID"]');
    if (payIDField && creds.payID) payIDField.value = creds.payID;
    updateStatusWithColor("Bank account fields filled.", "success");
}

function fillChangeEmailFormFields() {
    const creds = GM_getValue("registerCreds", { email: "" });
    const emailField = document.querySelector('input[name="email"]');
    if (emailField && creds.email) {
        emailField.value = creds.email;
        updateStatusWithColor("Email field filled.", "success");
    } else {
        updateStatusWithColor("Email field not found or no email stored.", "error");
    }
}

function autoClickRegistrationFlow() {
    // Try clicking the "Get Code" button
    const getCodeButton = document.querySelector('a.btn.warning.get-code');
    if (getCodeButton) {
        getCodeButton.click();
        updateStatusWithColor("Clicked Get Code button.", "info");
        setTimeout(clickYesButton, 500);
    } else {
        // If not available, try clicking the final register button directly
        clickRegisterFinalButton();
    }
}

function clickYesButton() {
    const yesButton = document.querySelector('button.swal2-confirm.swal2-styled');
    if (yesButton) {
        yesButton.click();
        updateStatusWithColor("Clicked confirmation button.", "info");
        setTimeout(monitorVerificationCode, 500);
    }
}

function monitorVerificationCode() {
    const verificationCodeField = document.querySelector('input[name="verificationCode"]');
    if (!verificationCodeField) {
        setTimeout(monitorVerificationCode, 500);
        return;
    }
    // Wait until verification code is detected (or assume user has entered it)
    const interval = setInterval(() => {
        const code = verificationCodeField.value.trim();
        if (/\d/.test(code)) {
            clearInterval(interval);
            clickRegisterFinalButton();
        }
    }, 500);
}

function clickRegisterFinalButton() {
    const registerButton = document.querySelector('a.btn.register.primary');
    if (registerButton) {
        registerButton.click();
        updateStatusWithColor("Clicked final Register button.", "info");
        // After registration, proceed to bank info if applicable:
        setTimeout(monitorBankAccountNameField, 1000);
    }
}

function monitorBankAccountNameField() {
    const bankField = document.querySelector('input[name="bankAccountName"]');
    if (bankField) {
        // Optionally, you can auto-fill bank fields here
        fillChangeBankFormFields();
        autoClickChangeBankFlow();
    }
}

function autoClickChangeBankFlow() {
    const updateButton = document.querySelector('a.update.btn');
    if (updateButton) {
        updateButton.click();
        updateStatusWithColor("Clicked Update Bank Info button.", "info");
        setTimeout(clickSaveBankButton, 500);
    }
}

function clickSaveBankButton() {
    const saveBankButton = document.querySelector('button.swal2-confirm.swal2-styled');
    if (saveBankButton) {
        saveBankButton.click();
        updateStatusWithColor("Clicked Save Bank button.", "info");
    }
}

function autoClickChangeEmailFlow() {
    const confirmEmailButton = document.querySelector('button.swal2-confirm.swal2-styled');
    if (confirmEmailButton) {
        confirmEmailButton.click();
        updateStatusWithColor("Clicked Confirm Email button.", "info");
    }
}
    // --- (3) HANDLE REFLINK BUTTON ---

    // --- (4) HANDLE SELECTOR BUTTON ---
// (1) HANDLE SELECTOR BUTTON
// 1) SELECTOR BUTTON CLICK
// SELECTOR BUTTON
// 1) SELECTOR BUTTON CLICK

    // Global variables for selector mode
// Function to run a game from a slot
// Function to run a game from a slot - updated to use stored gameList path
function runGameSlot(slotIndex) {
  // Check if slot has data
  if (!gameSlotData[slotIndex] || !gameSlotData[slotIndex].imageUrl) {
    updateStatusWithColor(`Slot ${slotIndex+1} is empty. Use Selector mode to save a game first.`, "warning");
    return;
  }

  const slotData = gameSlotData[slotIndex];
  const imageUrl = slotData.imageUrl;
  const currentDomain = getCurrentDisplayDomain();

  // Activate this slot
  activeSlot = slotIndex;
  updateGameSlotUI();

  // Mark that a pending game flow exists and store the image URL globally
  GM_setValue("pendingGameFlow", true);
  GM_setValue("pendingGameUrl", imageUrl);

  // Determine the gamelist path using stored path first, domain-specific path second, or fall back to image detection
  let path = null;

  // 1. Check if the slot has a stored gameList path
  if (slotData.gameListPath) {
    path = slotData.gameListPath;
  }
  // 2. Check if we have a path stored for this domain
  else if (domainGameMapping[currentDomain] && domainGameMapping[currentDomain].gameListPath) {
    path = domainGameMapping[currentDomain].gameListPath;
  }
  // 3. Fall back to detection from image URL
  else {
    path = getGamelistPathForProvider(imageUrl);
  }

  if (!path) {
    updateStatusWithColor(
      "Could not determine game provider path. Please use Selector mode to save the game again.",
      "error"
    );
    return;
  }

  updateStatusWithColor(`Running game from Slot ${slotIndex+1} using path: ${path}`, "info");
  window.location.href = `https://${currentDomain}${path}`;
}

// Function to handle game slot button clicks in minimized mode
function handleGameSlotButton(slotIndex) {
  runGameSlot(slotIndex);
}

// Helper function to get the gamelist path - update existing function
// Helper function to get the gamelist path - updated to extract from URL
function getGamelistPathForProvider(imageUrl) {
  if (!imageUrl) return null;

  // Extract a path from the current URL if on a gameList page
  const currentUrl = window.location.href;
  const gameListMatch = currentUrl.match(/\/gameList\/([^\/]+)\/([^\/]+)\/([^\/]+)\/([^\/]+)/);

  if (gameListMatch) {
    // We're on a gameList page, so use the path from the current URL
    return `/gameList/${gameListMatch[1]}/${gameListMatch[2]}/${gameListMatch[3]}/${gameListMatch[4]}`;
  }

  // Fallback to provider detection if we're not on a gameList page
  imageUrl = imageUrl.toLowerCase();

  // Detect provider based on URL patterns
  if (imageUrl.includes("jili")) {
    return "/gameList/JILI2/SLOT/0/0";
  } else if (imageUrl.includes("uus") || imageUrl.includes("uugth")) {
    return "/gameList/UUS/SLOT/0/0";
  } else if (imageUrl.includes("booon") || imageUrl.includes("booongo")) {
    return "/gameList/REDGENN/SLOT/1/0";
  } else if (imageUrl.includes("vpower") || imageUrl.includes("vp")) {
    return "/gameList/VP/SLOT/0/0";
  } else if (imageUrl.includes("cq9")) {
    return "/gameList/CQ9/SLOT/0/0";
  } else if (imageUrl.includes("pragmatic") || imageUrl.includes("prag")) {
    return "/gameList/PG/SLOT/0/0";
  } else if (imageUrl.includes("habanero") || imageUrl.includes("haba")) {
    return "/gameList/HB/SLOT/0/0";
  } else if (imageUrl.includes("joker") || imageUrl.includes("jkr")) {
    return "/gameList/JKR/SLOT/0/0";
  } else if (imageUrl.includes("microgaming") || imageUrl.includes("mg")) {
    return "/gameList/MG/SLOT/0/0";
  }

  // Default path if we can't identify the provider
  return "/gameList/JILI2/SLOT/0/0";
}

// Update the existing Game Button handler to use slot 0 by default
// Updated Game Button Handler to use domain-specific paths
function handleGameButton() {
  // Run slot 0 by default when game button is clicked
  runGameSlot(0);
}

// Function to find game element based on image URL from any slot
function findGameElementByStoredUrl(storedUrl) {
  // Extract the filename portion (e.g. "15071.png") from the stored URL.
  const filename = storedUrl.split('/').pop().toLowerCase();
  const imageElems = document.querySelectorAll('div.image');
  for (const elem of imageElems) {
    // First, check the inline style attribute directly.
    let inlineStyle = elem.getAttribute("style") || "";
    if (inlineStyle.toLowerCase().includes(filename)) {
      return elem;
    }
    // Fallback: check the computed background-image property.
    const bg = window.getComputedStyle(elem).getPropertyValue('background-image');
    if (bg && bg.toLowerCase().includes(filename)) {
      return elem;
    }
  }
  return null;
}

// Update the completeGameFlow function to work with slot data
function completeGameFlowIfNeeded() {
  const currentDomain = getCurrentDisplayDomain();
  const isPending = GM_getValue("pendingGameFlow", false);
  const storedUrl = GM_getValue("pendingGameUrl", "");

  if (!isPending || !storedUrl) {
    // No pending game flow; do nothing.
    return;
  }

  // Ensure we're on an expected domain.
  if (!currentDomain || !domainList.includes(currentDomain)) {
    updateStatusWithColor("Pending game flow but domain mismatch. Aborting.", "error");
    return;
  }

  // Find the game element by the URL
  waitForGameElement(storedUrl, (gameElem) => {
    if (gameElem) {
      updateStatusWithColor("Game element found. Clicking...", "success");
      gameElem.click();

      // Wait for any "Enter Game" confirmation buttons
      setTimeout(() => {
        removeMasks(); // Remove any overlays

        const enterBtn = document.querySelector("button.swal2-confirm.swal2-styled");
        if (enterBtn) {
          updateStatusWithColor("Clicking Enter Game button...", "success");
          enterBtn.click();
        }

        // Clear pending game flow data
        GM_setValue("pendingGameFlow", false);
        GM_setValue("pendingGameUrl", "");
      }, 1000);
    } else {
      updateStatusWithColor("Couldn't find matching game element!", "error");
    }
  });
}
// Function to select a game slot for selector mode


// Update existing handleSelectorButton function to work with slots
// Update the existing handle selector button function to store the current URL gameList path


// Update the game selector click handler to work with slots
// Update the game selector click handler to store gameList path

// Enhanced version of handleSelectorButton function with persistent status messages
function handleSelectorButton() {
  const currentDomain = getCurrentDisplayDomain();
  if (!currentDomain) {
    updateStatusWithColorPersistent("No valid domain for selector mode.", "error", true);
    return;
  }

  // Store the current URL's gameList path if available
  const currentUrl = window.location.href;
  const gameListMatch = currentUrl.match(/\/gameList\/([^\/]+)\/([^\/]+)\/([^\/]+)\/([^\/]+)/);

  if (gameListMatch) {
    // We're on a gameList page, so remember this path for this domain
    const gameListPath = `/gameList/${gameListMatch[1]}/${gameListMatch[2]}/${gameListMatch[3]}/${gameListMatch[4]}`;

    // Initialize domainGameMapping if needed
    if (!domainGameMapping[currentDomain]) {
      domainGameMapping[currentDomain] = {};
    }

    // Store the path
    domainGameMapping[currentDomain].gameListPath = gameListPath;

    // Save to storage
    persistDomainGameMapping();

    updateStatusWithColorPersistent(
      `Stored gameList path for ${currentDomain}: ${gameListPath}`,
      "info",
      true
    );
  }

  // Enter selector mode but don't select a slot yet
  gameSelectorMode = true;
  selectorSlotMode = false;
  selectedSlot = -1;

  // Optional overlay so user knows we're in selector mode
  showSelectorModeOverlay("SELECTOR MODE - Click a slot, then a game image");

  updateStatusWithColorPersistent(
    `Selector mode ON. First click a slot (1-4), then click on a game image.`,
    "warning",
    true
  );

  // Highlight all slots to show they're selectable
  for (let i = 0; i < 4; i++) {
    const slot = document.getElementById(`gameSlot${i}`);
    if (slot) {
      slot.style.borderColor = '#ff69b4';
      slot.style.borderStyle = 'solid';
      slot.style.opacity = '0.8';
    }
  }
}

// Enhanced version of selectGameSlot function with persistent status messages
function selectGameSlot(slotIndex) {
  if (!gameSelectorMode) {
    // If not in selector mode, clicking slot should run the slot's game
    runGameSlot(slotIndex);
    return;
  }

  // We're in selector mode - activate this slot
  selectedSlot = slotIndex;
  selectorSlotMode = true;

  // Highlight the selected slot
  for (let i = 0; i < 4; i++) {
    const slot = document.getElementById(`gameSlot${i}`);
    if (slot) {
      if (i === selectedSlot) {
        slot.classList.add('active');
        slot.style.boxShadow = '0 0 10px #ff1493';
      } else {
        slot.classList.remove('active');
        slot.style.boxShadow = '';
      }
    }
  }

  updateStatusWithColorPersistent(
    `Slot ${slotIndex+1} selected. Now click on the game image you want to save.`,
    "info",
    true
  );

  // Show selector mode overlay to indicate we're in slot selection mode
  showSelectorModeOverlay(`SELECTOR MODE - SLOT ${slotIndex+1} - Click a game image`);
}

// Enhanced version of handleGameSelectorClick with persistent status messages
function handleGameSelectorClick(e) {
  // Exit if not in selector mode or if slot isn't selected yet
  if (!gameSelectorMode) return;
  if (!selectorSlotMode) return; // Need to select a slot first

  e.preventDefault();
  e.stopPropagation();

  const currentDomain = getCurrentDisplayDomain();

  // Try to get the background-image from the clicked .image element
  let imageElem = e.target.closest(".image");
  if (!imageElem) {
    updateStatusWithColorPersistent("Please click directly on the .image element.", "error", true);
    return;
  }

  // Extract the actual image URL from the element's inline style
  const bg = window.getComputedStyle(imageElem).getPropertyValue("background-image");
  const urlMatch = bg.match(/url\(["']?(.+?)["']?\)/);
  if (!urlMatch) {
    updateStatusWithColorPersistent("Could not find a valid background-image URL here!", "error", true);
    return;
  }
  const imageUrl = urlMatch[1]; // e.g. "https://example.com/games/jili/421.png"

  // Get current gameList path from URL
  const currentUrl = window.location.href;
  const gameListMatch = currentUrl.match(/\/gameList\/([^\/]+)\/([^\/]+)\/([^\/]+)\/([^\/]+)/);
  let gameListPath = null;

  if (gameListMatch) {
    gameListPath = `/gameList/${gameListMatch[1]}/${gameListMatch[2]}/${gameListMatch[3]}/${gameListMatch[4]}`;
  } else {
    // Fallback to detecting from the image URL
    gameListPath = getGamelistPathForProvider(imageUrl);
  }

  // Store the game image URL and gameList path in the selected slot
  if (!gameSlotData[selectedSlot]) {
    gameSlotData[selectedSlot] = {};
  }

  gameSlotData[selectedSlot] = {
    imageUrl: imageUrl,
    domain: currentDomain,
    gameListPath: gameListPath, // Store the path with the slot
    timestamp: Date.now()
  };

  // Save to storage
  saveGameSlots();

  // Also save in domain mapping
  if (!domainGameMapping[currentDomain]) {
    domainGameMapping[currentDomain] = {};
  }
  domainGameMapping[currentDomain].gameListPath = gameListPath;
  persistDomainGameMapping();

  // Update UI
  updateGameSlotUI();

  // Exit selector mode
  hideSelectorModeOverlay();
  gameSelectorMode = false;
  selectorSlotMode = false;

  // Reset slot highlighting
  for (let i = 0; i < 4; i++) {
    const slot = document.getElementById(`gameSlot${i}`);
    if (slot) {
      slot.style.borderColor = '#ff1493';
      slot.style.borderStyle = 'dashed';
      slot.style.opacity = '1';
      slot.style.boxShadow = '';
    }
  }

  updateStatusWithColorPersistent(
    `Saved game image to Slot ${selectedSlot+1} with path: ${gameListPath}`,
    "success",
    false // We don't need to persist this message after exiting selector mode
  );

  // Also display the success message in the regular updateStatusWithColor for extra visibility
  updateStatusWithColor(
    `SELECTOR MODE OFF - Game saved to Slot ${selectedSlot+1}!`,
    "success"
  );
}

// New function for persistent status messages that stay visible during selector mode
// Update the updateStatusWithColorPersistent function to properly maintain status messages
// Enhanced version of updateStatusWithColorPersistent with centered positioning
function updateStatusWithColorPersistent(message, typeOrBoolean, keepVisible = true) {
  // First, call the regular updateStatusWithColor function
  updateStatusWithColor(message, typeOrBoolean);

  // If we don't need to keep this visible, just return
  if (!keepVisible) {
    // Clean up any existing persistent status if we're not keeping it visible
    const persistentStatus = document.getElementById('persistent-selector-status');
    if (persistentStatus) {
      persistentStatus.remove();
    }
    return;
  }

  // Create or update persistent status popup
  let persistentStatus = document.getElementById('persistent-selector-status');

  if (!persistentStatus) {
    persistentStatus = document.createElement('div');
    persistentStatus.id = 'persistent-selector-status';

    // Position in the exact middle of the screen (both vertically and horizontally)
    persistentStatus.style.position = 'fixed';
    persistentStatus.style.top = '50%';
    persistentStatus.style.left = '50%';
    persistentStatus.style.transform = 'translate(-50%, -50%)';

    persistentStatus.style.backgroundColor = 'rgba(0,0,0,0.9)';
    persistentStatus.style.color = '#fff';
    persistentStatus.style.padding = '15px 25px';
    persistentStatus.style.borderRadius = '5px';
    persistentStatus.style.border = '2px solid #ff1493';
    persistentStatus.style.boxShadow = '0 0 15px rgba(255,20,147,0.7)';
    persistentStatus.style.zIndex = '9999999';
    persistentStatus.style.fontWeight = 'bold';
    persistentStatus.style.textAlign = 'center';
    persistentStatus.style.maxWidth = '80%';
    persistentStatus.style.fontSize = '16px';
    persistentStatus.style.animation = 'pop-in 0.3s ease-out';

    // Add animation style
    if (!document.getElementById('persistent-status-style')) {
      const styleElem = document.createElement('style');
      styleElem.id = 'persistent-status-style';
      styleElem.textContent = `
        @keyframes pop-in {
          0% { transform: translate(-50%, -50%) scale(0.9); opacity: 0; }
          100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        }

        #persistent-selector-status.success { border-color: #4CAF50; background-color: rgba(0,0,0,0.9); }
        #persistent-selector-status.error { border-color: #f44336; background-color: rgba(0,0,0,0.9); }
        #persistent-selector-status.warning { border-color: #ff9800; background-color: rgba(0,0,0,0.9); }
        #persistent-selector-status.info { border-color: #2196F3; background-color: rgba(0,0,0,0.9); }
      `;
      document.head.appendChild(styleElem);
    }

    document.body.appendChild(persistentStatus);
  }

  // Update content and styling based on the message type
  persistentStatus.textContent = message;

  // Remove all type classes
  persistentStatus.classList.remove('success', 'error', 'warning', 'info');

  // Determine type
  let type = 'info';
  if (typeof typeOrBoolean === 'boolean') {
    type = typeOrBoolean ? 'success' : 'error';
  } else if (typeof typeOrBoolean === 'string' &&
             ['success', 'error', 'warning', 'info'].includes(typeOrBoolean)) {
    type = typeOrBoolean;
  }

  // Add the appropriate class
  persistentStatus.classList.add(type);

  // Ensure the status is visible
  persistentStatus.style.display = 'block';
}

    function openThemeCustomizer() {
  createSimplifiedThemeCustomizer();
}
// Update the existing showSelectorModeOverlay to work with our persistent status
// Update the existing showSelectorModeOverlay to position in the middle of the screen
function showSelectorModeOverlay(message = 'SELECTOR MODE ACTIVE') {
  // If already there, update the message
  let overlay = document.getElementById('selectorModeOverlay');

  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'selectorModeOverlay';

    // Position at the top of the screen as a banner
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.left = '0';
    overlay.style.width = '100%';
    overlay.style.padding = '10px';
    overlay.style.backgroundColor = 'rgba(255,20,147,0.85)';
    overlay.style.color = '#fff';
    overlay.style.fontSize = '14px';
    overlay.style.fontWeight = 'bold';
    overlay.style.textAlign = 'center';
    overlay.style.zIndex = '9999999';

    document.body.appendChild(overlay);
  }

  overlay.textContent = message;

  // Also update persistent status with centered position
  updateStatusWithColorPersistent(message, "warning", true);
}

// Update the existing hideSelectorModeOverlay to also clear persistent status
// Update the existing hideSelectorModeOverlay to properly remove all elements
function hideSelectorModeOverlay() {
    const overlay = document.getElementById('selectorModeOverlay');
    if (overlay) {
        overlay.remove();
    }

    // Also remove the persistent status
    const persistentStatus = document.getElementById('persistent-selector-status');
    if (persistentStatus) {
        persistentStatus.remove();
    }
}
// Update the selectorModeOverlay function to display the active slot


// (4b) HIDE SELECTOR MODE OVERLAY


    function startMinimizedBonusCheck() {
        if (window.minimizedCheckInterval) {
            clearInterval(window.minimizedCheckInterval);
        }
        window.minimizedCheckInterval = setInterval(() => {
            const container = document.getElementById('bonus-checker-container');
            if (container && container.classList.contains('minimized')) {
                const currentDomain = getCurrentDisplayDomain();
                if (currentDomain) {
                    checkDomain(currentDomain).then(() => {
                        updateCurrentDomainCard();
                    });
                }
            } else {
                clearInterval(window.minimizedCheckInterval);
                window.minimizedCheckInterval = null;
            }
        }, 5000);
    }

    function startFormFillingProcess() {
    // Retrieve the saved register credentials
    const creds = GM_getValue("registerCreds", {});

    // If nothing is saved, you can fallback or do nothing:
    const nameField = document.querySelector('input[name="name"]');
    if (nameField && creds.name) {
        nameField.value = creds.name;
    }

    const mobileField = document.querySelector('input[name="mobile"]');
    if (mobileField && creds.mobile) {
        mobileField.value = creds.mobile;
    }

    const passwordField = document.querySelector('input[name="password"]');
    if (passwordField && creds.password) {
        passwordField.value = creds.password;
    }

    // etc. Same approach for the rest:
    // If you want to fill email right away:
    const emailField = document.querySelector('input[name="email"]');
    if (emailField && creds.email) {
        emailField.value = creds.email;
    }


}
    function fillNewFields() {
    const creds = GM_getValue("registerCreds", {});

    const bankAccountNameField = document.querySelector('input[name="bankAccountName"]');
    if (bankAccountNameField && creds.bankAccountName) {
        bankAccountNameField.value = creds.bankAccountName;
    }

    const bankBSBField = document.querySelector('input[name="bankBSB"]');
    if (bankBSBField && creds.bankBSB) {
        bankBSBField.value = creds.bankBSB;
    }

    const bankAccountNumberField = document.querySelector('input[name="bankAccountNumber"]');
    if (bankAccountNumberField && creds.bankAccountNumber) {
        bankAccountNumberField.value = creds.bankAccountNumber;
    }

    const payIDField = document.querySelector('input[name="payID"]');
    if (payIDField && creds.payID) {
        payIDField.value = creds.payID;
    }

    // Then do your final "save" steps
}


    function clearTemporaryData() {
        const container = document.getElementById('bonus-checker-container');
        if (container && container.classList.contains('minimized')) {
            return;
        }
        let hasValid = false;
        for (const domain in temporaryBonusData) {
            const bonus = temporaryBonusData[domain];
            if (bonus && (
                (bonus.commission && bonus.commission.amount > 0) ||
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

    function persistGUIState() {
    const container = document.getElementById('bonus-checker-container');
    if (!container) return;

    const minimized = container.classList.contains('minimized');
    GM_setValue("minimized", minimized);

    const resultsArea = document.getElementById('resultsArea');

    // Create a state object with all important values
    const state = {
        resultsHTML: resultsArea ? resultsArea.innerHTML : "",
        scrollTop: container.scrollTop || 0,
        autoLogin: autoLogin,
        autoNavNonVisited: autoNavNonVisited,
        autoNavValid: autoNavValid,
        sortMode: sortMode,
        minimized: minimized,
        checkLiveClickCount: checkLiveClickCount,
        lastUpdated: Date.now(),
        // DO NOT include visibility flags in guiState to avoid conflicts
    };

    // Use a try-catch block for the save operation
    try {
        // Save state
        GM_setValue("guiState", JSON.stringify(state));

        // Save these individually as the source of truth
        GM_setValue("gameSlotsVisible", gameSlotsVisible);
        GM_setValue("minimizedCardHidden", minimizedCardHidden);
    } catch(e) {
        // If primary save fails, try again after a delay
        setTimeout(() => {
            try {
                GM_setValue("guiState", JSON.stringify(state));
                GM_setValue("gameSlotsVisible", gameSlotsVisible);
                GM_setValue("minimizedCardHidden", minimizedCardHidden);
            } catch(innerE) {
                // Silent fail
            }
        }, 100);
    }

    // Also explicitly save merchant ID data for reliability
    saveMerchantData();
}

// Helper function to save merchant data with verification
function saveMerchantData() {
    try {
        GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));

        // Verify the save
        setTimeout(() => {
            try {
                const savedDataStr = GM_getValue("merchant_id_data", "{}");
                const savedData = JSON.parse(savedDataStr);

                // Basic verification - check if we have the same number of keys
                const originalKeys = Object.keys(merchantIdData).length;
                const savedKeys = Object.keys(savedData).length;

                if (originalKeys !== savedKeys) {
                    // Retry the save
                    GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));
                }
            } catch(e) {
                // On error, retry
                GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));
            }
        }, 50);
    } catch(e) {
        // If first attempt fails, retry after a delay
        setTimeout(() => {
            try {
                GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));
            } catch(innerE) {
                // Silent failure at this point
            }
        }, 100);
    }
}

    function forceStateSaveBeforeNavigate(url) {
    const container = document.getElementById('bonus-checker-container');
    if (container) {
        const isMinimized = container.classList.contains('minimized');
        GM_setValue("minimized", isMinimized);

        // Save the visibility states
        GM_setValue("gameSlotsVisible", gameSlotsVisible);
        GM_setValue("minimizedCardHidden", minimizedCardHidden);

        try {
            GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));
            persistGUIState();
        } catch (e) {}
    }
    window.location.href = url;
}

    function goToNextValidDomain() {
    let cachedBonusData = GM_getValue("cached_bonus_data", "{}");
    try {
        cachedBonusData = JSON.parse(cachedBonusData);
    } catch (e) {
        cachedBonusData = {};
    }
    // Use cached bonus data if available; otherwise fall back to temporary bonus data.
    const bonusDataSource = Object.keys(cachedBonusData).length > 0 ? cachedBonusData : temporaryBonusData;
    const currentDomain = getCurrentDisplayDomain();

    // Filter domains that have valid bonus data for the selected auto-valid bonus type.
    let validDomains = domainList.filter(domain => {
        if (visitedDomains.includes(domain)) return false;
        const bonusData = bonusDataSource[domain];
        if (!bonusData) return false;
        let bonus;
        if (autoValidBonusType === "maxWithdrawal") {
            bonus = bonusData[maxWithdrawalBonusType];
            const value = parseFloat(bonus && bonus.maxWithdrawal || 0);
            return value > 0;
        } else {
            bonus = bonusData[autoValidBonusType];
            const value = parseFloat(bonus && (bonus.amount || bonus.bonusFixed) || 0);
            return value > 0;
        }
    });

    // If no valid domains are found, reset the visited domains list and try again.
    if (validDomains.length === 0) {
        visitedDomains = [];
        GM_setValue("visitedDomains", visitedDomains);
        validDomains = domainList.filter(domain => {
            const bonusData = bonusDataSource[domain];
            if (!bonusData) return false;
            let bonus;
            if (autoValidBonusType === "maxWithdrawal") {
                bonus = bonusData[maxWithdrawalBonusType];
                const value = parseFloat(bonus && bonus.maxWithdrawal || 0);
                return value > 0;
            } else {
                bonus = bonusData[autoValidBonusType];
                const value = parseFloat(bonus && (bonus.amount || bonus.bonusFixed) || 0);
                return value > 0;
            }
        });
        if (validDomains.length === 0) {
            updateStatusWithColor(
                `No domains have valid ${autoValidBonusType === "maxWithdrawal" ? maxWithdrawalBonusType : autoValidBonusType} bonus data.`,
                false
            );
            return;
        }
    }

    // Sort valid domains in descending order of bonus value.
    validDomains.sort((a, b) => {
        let bonusA, bonusB;
        if (autoValidBonusType === "maxWithdrawal") {
            bonusA = bonusDataSource[a] && bonusDataSource[a][maxWithdrawalBonusType];
            bonusB = bonusDataSource[b] && bonusDataSource[b][maxWithdrawalBonusType];
            const valueA = parseFloat(bonusA && bonusA.maxWithdrawal || 0);
            const valueB = parseFloat(bonusB && bonusB.maxWithdrawal || 0);
            return valueB - valueA;
        } else {
            bonusA = bonusDataSource[a] && bonusDataSource[a][autoValidBonusType];
            bonusB = bonusDataSource[b] && bonusDataSource[b][autoValidBonusType];
            const valueA = parseFloat(bonusA && (bonusA.amount || bonusA.bonusFixed) || 0);
            const valueB = parseFloat(bonusB && (bonusB.amount || bonusB.bonusFixed) || 0);
            return valueB - valueA;
        }
    });

    // Choose the next domain that is not the current one; if all are the same, use the first.
    const nextDomain = validDomains.find(domain => domain !== currentDomain) || validDomains[0];
    visitedDomains.push(nextDomain);
    GM_setValue("visitedDomains", visitedDomains);
    updateStatusWithColor(
        `Auto-valid navigating to ${nextDomain} with highest ${autoValidBonusType === "maxWithdrawal" ? maxWithdrawalBonusType : autoValidBonusType} bonus.`,
        true
    );
    forceStateSaveBeforeNavigate(`https://${nextDomain}`);
}

    function goToNextDomain() {
    // If auto‑valid mode is enabled, use the bonus value criteria.
    if (autoNavValid) {
        goToNextValidDomain();
        return;
    }

    // If auto‑non‑visited mode is enabled, check for domains missing required data.
    if (autoNavNonVisited) {
        const incompleteDomains = domainList.filter(domain => {
            const data = merchantIdData[domain];
            return !data || !data.merchantId || !data.accessId || !data.accessToken;
        });
        if (incompleteDomains.length > 0) {
            const nextDomain = incompleteDomains[0];
            updateStatusWithColor(
                `Auto-nav non visited enabled. Navigating to "${nextDomain}" as it is missing required data.`,
                'info'
            );
            forceStateSaveBeforeNavigate(`https://${nextDomain}`);
            return;
        } else {
            updateStatusWithColor("All domains have complete required data!", 'success');
        }
    }

    // Default sequential navigation.
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
        let domain = url.replace(/^https?:\/\//i, "");
        domain = domain.replace(/^www\./i, "");
        domain = domain.split("/")[0].split(":")[0].toLowerCase();
        return domain;
      } catch (e) {
        return null;
      }
    }

    function navigateWithPageReset(url) {
        GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));
        const container = document.getElementById('bonus-checker-container');
        if (container) {
            const isMinimized = container.classList.contains('minimized');
            GM_setValue("minimized", isMinimized);
            persistGUIState();
        }
        const highestId = window.setTimeout(() => {}, 0);
        for (let i = 0; i < highestId; i++) {
            window.clearTimeout(i);
            window.clearInterval(i);
        }
        window.location.href = url;
    }

    function checkIfLastDomainAndNavigate(currentDomain) {
        const container = document.getElementById('bonus-checker-container');
        if (container) {
            const isMinimized = container.classList.contains('minimized');
            GM_setValue("minimized", isMinimized);
        }
        GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));
        persistGUIState();
        if (autoNavNonVisited) {
            const nextDomain = domainList.find(d => !merchantIdData[d]?.merchantId);
            if (nextDomain) {
                updateStatusWithColor(`Moving to next domain without merchant ID: ${nextDomain}`, true);
                forceStateSaveBeforeNavigate(`https://${nextDomain}`);
                return;
            }
        }
        if (autoLogin) {
            const currentIndex = domainList.indexOf(currentDomain);
            let nextIndex = (currentIndex + 1) % domainList.length;
            if (nextIndex === 0) {
                updateStatusWithColor(`Completed auto-login cycle for all domains!`, true);
                forceStateSaveBeforeNavigate(window.location.href);
                return;
            }
            const nextDomain = domainList[nextIndex];
            updateStatusWithColor(`Moving to next domain for auto-login: ${nextDomain}`, true);
            forceStateSaveBeforeNavigate(`https://${nextDomain}`);
            return;
        }
        forceStateSaveBeforeNavigate(window.location.href);
    }

    function findAndNavigateToUnloggedDomain() {
        if (!autoLogin) return;
        GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));
        const container = document.getElementById('bonus-checker-container');
        if (container) {
            const isMinimized = container.classList.contains('minimized');
            GM_setValue("minimized", isMinimized);
            persistGUIState();
        }
        const currentDomain = extractBaseDomain(window.location.href);
        updateStatusWithColor(`Finding domains that need login...`, true);
        const statusEl = document.getElementById('statusMessage');
        let originalStatus = statusEl?.textContent || '';
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
        const domainsToVerify = domainList.filter(domain =>
            domain !== currentDomain &&
            merchantIdData[domain]?.merchantId &&
            merchantIdData[domain]?.accessId &&
            merchantIdData[domain]?.accessToken
        );
        const domainsNeedingLoginImmediately = domainList.filter(domain =>
            domain !== currentDomain &&
            merchantIdData[domain]?.merchantId &&
            (!merchantIdData[domain]?.accessId || !merchantIdData[domain]?.accessToken)
        );
        if (domainsNeedingLoginImmediately.length > 0) {
            const nextDomain = domainsNeedingLoginImmediately[0];
            updateStatusWithColor(`Found domain needing login (no token): ${nextDomain}`, true);
            forceStateSaveBeforeNavigate(`https://${nextDomain}`);
            return;
        }
    }

    function findGameElementByStoredUrl(storedUrl) {
  // Extract the filename portion (e.g. "15071.png") from the stored URL.
  const filename = storedUrl.split('/').pop().toLowerCase();
  const imageElems = document.querySelectorAll('div.image');
  for (const elem of imageElems) {
    // First, check the inline style attribute directly.
    let inlineStyle = elem.getAttribute("style") || "";
    if (inlineStyle.toLowerCase().includes(filename)) {
      return elem;
    }
    // Fallback: check the computed background-image property.
    const bg = window.getComputedStyle(elem).getPropertyValue('background-image');
    if (bg && bg.toLowerCase().includes(filename)) {
      return elem;
    }
  }
  return null;
}

    function navigateToNextUnloggedDomain() {
        if (!autoLogin) return;
        GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));
        const container = document.getElementById('bonus-checker-container');
        if (container) {
            const isMinimized = container.classList.contains('minimized');
            GM_setValue("minimized", isMinimized);
            persistGUIState();
        }
        const currentDomain = extractBaseDomain(window.location.href);
        let currentIndex = domainList.indexOf(currentDomain);
        if (currentIndex === -1) currentIndex = 0;
        const unloggedDomains = [];
        for (let i = 1; i <= domainList.length; i++) {
            const idx = (currentIndex + i) % domainList.length;
            const domain = domainList[idx];
            if (!merchantIdData[domain]?.merchantId) continue;
            unloggedDomains.push(domain);
        }
        if (unloggedDomains.length === 0) {
            const domainsWithoutMerchantId = domainList.filter(d => !merchantIdData[d]?.merchantId);
            if (domainsWithoutMerchantId.length > 0) {
                const nextDomain = domainsWithoutMerchantId[0];
                updateStatusWithColor(`No domains left to login. Going to ${nextDomain} to capture merchant ID...`, true);
                forceStateSaveBeforeNavigate(`https://${nextDomain}`);
                return;
            }
            updateStatusWithColor(`All domains have been processed!`, true);
            return;
        }
        const nextDomain = unloggedDomains[0];
        updateStatusWithColor(`Navigating to next domain: ${nextDomain}`, true);
        forceStateSaveBeforeNavigate(`https://${nextDomain}`);
    }

    function hasCompleteRequestData(domain) {
        return merchantIdData[domain] && merchantIdData[domain].merchantId;
    }

    function cleanURLList(text) {
        if (!text) return [];
        return text.split(/[\n\r]+/)
            .map(line => line.trim())
            .filter(line => {
                const urlRegex = /^(https?:\/\/)?([\da-z.-]+\.[a-z.]{2,6})([\/\w .-]*)*\/?$/i;
                return urlRegex.test(line);
            })
            .map(line => extractBaseDomain(line))
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

    function updateStatusWithColor(message, typeOrBoolean, progressData) {
  // Helper function to find the correct position in the DOM
  function findCorrectPosition() {
    // Look for key elements
    const guiContent = document.getElementById('guiContent');
    const currentDomainCardContainer = document.getElementById('currentDomainCardContainer');
    const headerControls = document.querySelector('.header-controls');
    const resultsArea = document.getElementById('resultsArea');

    // Position the status container between the header controls and the domain card
    if (guiContent && headerControls) {
      return {
        element: headerControls,
        relation: 'after'
      };
    }

    // Fallback options
    if (currentDomainCardContainer) {
      return {
        element: currentDomainCardContainer,
        relation: 'before'
      };
    }

    if (resultsArea) {
      return {
        element: resultsArea,
        relation: 'before'
      };
    }

    return null;
  }

  // Create or find the status container
  let statusContainer = document.getElementById('statusContainer');
  if (!statusContainer) {
    statusContainer = document.createElement('div');
    statusContainer.id = 'statusContainer';
    statusContainer.style.display = 'flex';
    statusContainer.style.flexDirection = 'column';
    statusContainer.style.gap = '2px'; // Ultra-compact gap between status messages
    statusContainer.style.margin = '2px auto'; // Minimal margin
    statusContainer.style.width = '98%';
    statusContainer.style.maxWidth = '700px';
    statusContainer.style.position = 'relative';
    statusContainer.style.zIndex = '9999';

    // Add to the DOM in the correct position
    const position = findCorrectPosition();
    if (!position) {
      console.error("Could not find a suitable position for status messages");
      return;
    }

    // Add to the guiContent element in the correct position
    const guiContent = document.getElementById('guiContent');
    if (guiContent) {
      // Find the correct order position within guiContent
      // We want the statusContainer to come after header controls but before current domain card
      const headerControls = document.querySelector('.header-controls');
      const currentDomainCardContainer = document.getElementById('currentDomainCardContainer');

      if (headerControls && currentDomainCardContainer) {
        // Check if statusContainer already exists in the order property
        const existingStatusContainer = document.getElementById('statusContainer');
        if (!existingStatusContainer) {
          statusContainer.style.order = '3'; // Header is 1, controls are 2, this is 3, domain card will be 4
          statusContainer.style.marginTop = '0px'; // No top margin - tight to buttons
          statusContainer.style.marginBottom = '1px'; // Tiny bottom margin - tight to domain card
          guiContent.appendChild(statusContainer);
        }
      } else if (position.relation === 'before') {
        position.element.parentNode.insertBefore(statusContainer, position.element);
      } else if (position.relation === 'after') {
        const nextSibling = position.element.nextSibling;
        if (nextSibling) {
          position.element.parentNode.insertBefore(statusContainer, nextSibling);
        } else {
          position.element.parentNode.appendChild(statusContainer);
        }
      }
    } else if (position.relation === 'before') {
      position.element.parentNode.insertBefore(statusContainer, position.element);
    } else if (position.relation === 'after') {
      const nextSibling = position.element.nextSibling;
      if (nextSibling) {
        position.element.parentNode.insertBefore(statusContainer, nextSibling);
      } else {
        position.element.parentNode.appendChild(statusContainer);
      }
    }
  }

  // Determine status type
  let type = 'info';
  if (typeof typeOrBoolean === 'boolean') {
    type = typeOrBoolean ? 'success' : 'error';
  } else if (typeof typeOrBoolean === 'string' &&
             ['success', 'error', 'warning', 'info'].includes(typeOrBoolean)) {
    type = typeOrBoolean;
  }

  // Check if status already exists or create new
  let statusEl = document.getElementById(`statusMessage-${type}`);
  if (!statusEl) {
    statusEl = document.createElement('div');
    statusEl.id = `statusMessage-${type}`;
    statusEl.style.animation = "statusSlideIn 0.3s ease";
    statusContainer.appendChild(statusEl);
  }

  // Clear existing timeout
  if (window[`statusHideTimeout-${type}`]) {
    clearTimeout(window[`statusHideTimeout-${type}`]);
  }

  // Reset display properties
  statusEl.style.display = 'block';
  statusEl.style.opacity = '1';

  // Create progress HTML if needed
  let progressHtml = '';
  if (progressData && !message.includes("Caching complete and domains sorted")) {
    const { processed, total } = progressData;
    if (processed !== undefined && total !== undefined) {
      const percent = Math.min(100, Math.round((processed / total) * 100));
      progressHtml = `
        <div class="status-progress" style="margin-top: 2px;">
          <div class="status-progress-text" style="font-size: 9px; text-align: right; margin-bottom: 1px; opacity: 0.9;">${processed}/${total} (${percent}%)</div>
          <div class="status-progress-bar" style="height: 2px; width: 100%; background-color: rgba(0,0,0,0.3); border-radius: 0;">
            <div class="status-progress-fill" style="height: 100%; background-color: #ff1493; width: ${percent}%; transition: width 0.3s ease;"></div>
          </div>
        </div>
      `;
    }
  }

  // Set icon based on message type
  let icon;
  switch (type) {
    case 'success': icon = "✓"; break;
    case 'error': icon = "✖"; break;
    case 'warning': icon = "⚠"; break;
    case 'info':
    default: icon = "ⓘ"; break;
  }

  // Update content - simpler structure for compactness
  statusEl.innerHTML = `
    <div style="display: flex; align-items: flex-start; gap: 6px; padding: 4px 6px;">
      <div style="font-size: 11px; font-weight: bold; width: 18px; height: 18px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background-color: #ff1493; color: #fff; flex-shrink: 0;">${icon}</div>
      <div style="flex: 1; display: flex; flex-direction: column; gap: 2px;">
        <div style="font-size: 11px; line-height: 1.2; font-weight: 500;">${message}</div>
        ${progressHtml}
      </div>
    </div>
  `;

  // Apply exact styling from domain cards in screenshot
  statusEl.style.backgroundColor = "rgba(0,0,0,0.8)"; // Dark background like cards
  statusEl.style.border = "1px solid #ff1493"; // Magenta border like cards
  statusEl.style.borderRadius = "0"; // Square corners exactly like cards
  statusEl.style.boxShadow = "none"; // No shadow
  statusEl.style.color = "#fff";
  statusEl.style.fontFamily = "-apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif";
  statusEl.style.marginBottom = "2px"; // Very tight gap between messages
  statusEl.style.fontSize = "11px";
  statusEl.style.cursor = "pointer"; // Add pointer cursor to indicate it's clickable
  statusEl.style.position = "relative";

  // Add tap-to-dismiss functionality
  statusEl.addEventListener('click', function() {
    statusEl.style.transition = "all 0.2s ease";
    statusEl.style.opacity = '0';
    statusEl.style.height = '0';
    statusEl.style.margin = '0';
    statusEl.style.padding = '0';
    setTimeout(() => {
      if (statusEl && statusEl.parentNode) {
        statusEl.parentNode.removeChild(statusEl);
      }
    }, 200);
  });

  // Add close animation
  if (!document.getElementById('status-animations')) {
    const styleSheet = document.createElement('style');
    styleSheet.id = 'status-animations';
    styleSheet.textContent = `
      @keyframes statusSlideIn {
        from { opacity: 0; transform: translateY(-5px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(styleSheet);
  }

  // Auto-hide after 2.5s if appropriate
  const hasProgressBar = progressData && progressData.processed !== undefined && progressData.total !== undefined;
  const isProgressComplete = hasProgressBar ? (progressData.processed >= progressData.total) : false;

  if (!hasProgressBar || isProgressComplete) {
    window[`statusHideTimeout-${type}`] = setTimeout(() => {
      statusEl.style.transition = "all 0.3s ease";
      statusEl.style.opacity = '0';
      statusEl.style.height = '0';
      statusEl.style.margin = '0';
      statusEl.style.padding = '0';
      setTimeout(() => {
        if (statusEl && statusEl.parentNode) {
          statusEl.parentNode.removeChild(statusEl);
        }
      }, 300);
    }, 2500);
  }
}


    function updateAllCards() {
        updateCurrentDomainCard();
        const cards = document.querySelectorAll('.site-card');
        cards.forEach(card => {
            const domain = card.getAttribute('data-domain');
            if (domain && temporaryBonusData[domain]) {
                updateBonusDisplay(temporaryBonusData[domain], `https://${domain}`);
            }
        });
    }

    function getEffectiveWithdrawals(freeMin, freeMax, globalMin, globalMax) {
        const effectiveMin = (freeMin != null && freeMin > 0) ? freeMin : (globalMin != null && globalMin > 0 ? globalMin : '--');
        const effectiveMax = (freeMax != null && freeMax > 0) ? freeMax : (globalMax != null && globalMax > 0 ? globalMax : '--');
        return { effectiveMin, effectiveMax };
    }

    function loadGUIState() {
        const stateStr = GM_getValue("guiState", null);
        if (stateStr) {
            try {
                const state = JSON.parse(stateStr);
                if (typeof state.sortMode === 'number') {
                    const modes = ["commission", "share", "referral", "balance", "errors"];
                    state.sortMode = modes[state.sortMode] || "commission";
                }
                sortMode = state.sortMode || "commission";
                const resultsArea = document.getElementById('resultsArea');
                if (resultsArea) {
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = state.resultsHTML || "";
                    const currentCards = tempDiv.querySelectorAll('.current-domain-card');
                    currentCards.forEach(card => card.remove());
                    resultsArea.innerHTML = tempDiv.innerHTML;
                }
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
                rebindDomainCardClickEvents();
            } catch (e) {}
        }
    }

    function rebindDomainCardClickEvents() {
        const cards = document.querySelectorAll('.site-card:not(.current-domain-card)');
        cards.forEach(card => {
            const domain = card.getAttribute('data-domain');
            if (!domain) return;
            card.onclick = function(e) {
                e.preventDefault();
                window.location.href = `https://${domain}`;
                return false;
            };
        });
    }

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
        if (setDomainCredentialsBtn) setDomainCredentialsBtn.addEventListener('click', openDomainCredentialsModal);
        if (clearWithinRangeBtn) clearWithinRangeBtn.addEventListener('click', openRangeModal);
    }

    function updateCheckLiveButton() {
        const btn = document.getElementById('checkBonuses');
        if (!btn) return;
        if (checkLiveClickCount === 0) {
            btn.textContent = "Clear (Live Check Mode)";
        } else if (checkLiveClickCount === 1) {
            btn.textContent = "Show Cached Bonus Data";
        } else if (checkLiveClickCount === 2) {
            btn.textContent = "Fetch Fresh Bonus Data";
        }
    }

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

    // 3) PARSE AND FILTER BONUSES FROM THE RESPONSE
// ---------------------------------------------
function filterBonuses(rawData, domain) {
    if (!rawData || !rawData.data) return {};

    const rawBonuses = rawData.data.bonus || [];
    const rawWallets = rawData.data.wallet || [];
    let finalBalance = 0,
        finalMinW = 0,
        finalMaxW = 0;

    // Identify free-credit vs normal wallet
    let freeCreditWallet = null, normalBalanceWallet = null;
    if (Array.isArray(rawWallets)) {
        for (let i = 0; i < rawWallets.length; i++) {
            const wallet = rawWallets[i];
            if (wallet.id == "1") {
                freeCreditWallet = wallet;
            } else if (wallet.id == "0" || wallet.id == 0) {
                normalBalanceWallet = wallet;
            }
        }
    }

    // Determine finalBalance from freeCredit or fallback to normal
    if (freeCreditWallet) {
        const fcBal = parseFloat(freeCreditWallet.balance ?? 0) || 0;
        if (fcBal > 0) {
            finalBalance = fcBal;
            if (freeCreditWallet.data && typeof freeCreditWallet.data === 'string') {
                try {
                    const parsedData = JSON.parse(freeCreditWallet.data);
                    finalMinW = parsedData.minWithdraw ?? 0;
                    finalMaxW = parsedData.maxWithdraw ?? 0;
                } catch (e) {}
            }
        } else if (normalBalanceWallet) {
            const nbBal = parseFloat(normalBalanceWallet.balance ?? 0) || 0;
            if (nbBal > 0) finalBalance = nbBal;
        }
    } else if (normalBalanceWallet) {
        const nbBal = parseFloat(normalBalanceWallet.balance ?? 0) || 0;
        if (nbBal > 0) finalBalance = nbBal;
    }

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

    // Sort out each bonus that might exist
    rawBonuses.forEach(b => {
        let name = (b.name || "").toLowerCase();
        if (name.includes("commission")) {
            bonusData.commission = {
                name: b.name || '',
                amount: parseFloat(b.amount || 0) || 0,
                minBet: b.minBet || '--',
                maxWithdrawal: b.maxWithdraw || '--',
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
            if (formattedBonus.amount > 0 && formattedBonus.minWithdrawal !== null && formattedBonus.maxWithdrawal !== null) {
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
            if (formattedBonus.amount > 0 && formattedBonus.minWithdrawal !== null && formattedBonus.maxWithdrawal !== null) {
                bonusData.referral = formattedBonus;
            }
        }
    });

    return bonusData;
}

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
                    setTimeout(tryFetch, 0);
                } else if (!temporaryBonusData[currentDomain]) {
                    updateStatusWithColor(`After ${attempts} attempts, still no bonus data for ${currentDomain}.`, false);
                }
            });
        }
        setTimeout(tryFetch, 0);
    }

    function claimBonus(domain, bonusType) {
        const domainData = merchantIdData[domain];
        if (!domainData || !domainData.merchantId) {
            updateStatusWithColor(`Error: No merchant ID for ${domain}`, false);
            return;
        }
        const merchantId = domainData.merchantId;
        const accessId = domainData.accessId || "";
        const accessToken = domainData.accessToken || "";
        const domainId = domainData.domainId || "0";
        const walletIsAdmin = domainData.walletIsAdmin || "";
        if (!merchantId || !accessId || !accessToken) {
            updateStatusWithColor(`Error: Missing access info for ${domain}`, false);
            return;
        }
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
        const apiUrl = `https://${domain}/api/v1/index.php`;
        updateStatusWithColor(`Claiming ${bonusName} on ${domain} ...`, true);
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
                        if (result.status === 'SUCCESS') {
                            updateStatusWithColor(`Successfully claimed [${bonusName}] at ${domain}`, true);
                            setTimeout(() => checkDomain(domain), 1000);
                        } else {
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

    function cleanupBeforeNavigate() {
        XMLHttpRequest.prototype.open = originalOpen;
        XMLHttpRequest.prototype.setRequestHeader = originalSetRequestHeader;
        XMLHttpRequest.prototype.send = originalSend;
        if (topObserver) {
            topObserver.disconnect();
            topObserver = null;
        }
        eventListeners.forEach(({ el, evt, cb }) => {
            if (el && typeof el.removeEventListener === 'function') {
                el.removeEventListener(evt, cb);
            }
        });
        eventListeners.length = 0;
        cleanMerchantData();
    }

    function cleanMerchantData() {
        const validDomains = new Set(domainList);
        const domainsToRemove = [];
        for (const domain in merchantIdData) {
            if (Object.prototype.hasOwnProperty.call(merchantIdData, domain)) {
                if (!validDomains.has(domain)) {
                    domainsToRemove.push(domain);
                }
            }
        }
        if (domainsToRemove.length > 0) {
            domainsToRemove.forEach(domain => {
                delete merchantIdData[domain];
            });
            GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));
        }
    }

    function domainHasValidBonus(domain) {
        const bonusData = temporaryBonusData[domain];
        if (!bonusData) return false;
        const c = bonusData.commission;
        const s = bonusData.share;
        const r = bonusData.referral;
        return (
            (c && c.amount > 0) ||
            (s && s.amount > 0) ||
            (r && r.amount > 0)
        );
    }

    GM_addStyle(`
#bonus-checker-container {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    background: rgba(0,0,0,0.9);
    color: #fff;
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    z-index: 2147483647;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 4px 8px rgba(0,0,0,0.5);
    padding: 0;
}
#guiContent {
    position: relative;
    z-index: 1;
    padding: 5px;
    display: flex;
    flex-direction: column;
}
.site-card {
    padding: 2px;
    border-radius: 3px;
    margin-bottom: 2px;
    color: #fff;
    background: rgba(0,0,0,0.6);
    border: 1px solid var(--mainBorder);
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
.bonus-info {
    display: none;
}
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
#lastCapturedInfo {
    font-size: 0.75em;
    color: #ff1493;
    max-width: 50vw;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
}
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
    border: 1px solid var(--mainBorder);
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
    border: 1px solid var(--mainBorder);
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
#statusMessage {
    padding: 0;
    margin: 8px 0;
    transition: all 0.3s ease;
    position: relative;
    z-index: 1001;
    display: flex;
    align-items: flex-start;
    gap: 10px;
    order: 2;
}
#statusMessage.active {
    padding: 10px;
    background-color: rgba(255, 20, 147, 0.2);
    border: 1px solid var(--mainBorder);
    border-radius: 5px;
}
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
.status-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 5px;
}
.status-message-text {
    font-size: 14px;
    line-height: 1.4;
}
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
.status-indicator {
    display: none !important;
}
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
    border: 1px solid var(--mainBorder);
    border-radius: 4px;
    padding: 10px;
    margin-bottom: 10px;
    font-family: monospace;
}
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
    border: 1px solid var(--mainBorder);
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
.claim-btn {
    margin-top: 4px;
    display: inline-block;
}
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
#currentDomainCardContainer {
    position: relative !important;
    z-index: 999 !important;
    margin-top: 8px !important;
    margin-bottom: 8px !important;
    background: rgba(0,0,0,0.1);
    border-bottom: 1px solid #ff1493;
    padding-bottom: 5px;
    order: 3;
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
#bonus-checker-container.minimized #currentDomainCardContainer {
    display: block !important;
    position: relative !important;
    margin: 0 !important;
    padding: 0 !important;
    max-width: 100% !important;
    z-index: 2 !important;
}
#bonus-checker-container.minimized .current-domain-card {
    width: 100% !important;
    max-height: 80px !important;
    overflow-y: auto !important;
    margin: 0 !important;
    padding: 2px !important;
    font-size: 10px !important;
}
#bonus-checker-container.minimized #guiContent .header-controls,
#bonus-checker-container.minimized #resultsArea,
#bonus-checker-container.minimized #statusMessage,
#bonus-checker-container.minimized #progressBar {
    display: none !important;
}
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
#nextDomainMin,
#exportReferLinksMin,
#toggleCurrentCardMin {
    width: auto !important;
    position: absolute !important;
    top: 2px !important;
    z-index: 999999 !important;
    padding: 4px 6px !important;
    font-size: 10px !important;
}
#nextDomainMin {
    right: 70px !important;
}
#refreshLastMin {
    right: 115px !important;
}
#exportReferLinksMin {
    right: 197px !important;
}
#toggleCurrentCardMin {
    left: 10px !important;
}
.control-btn {
    width: auto !important;
}
.header-controls {
    order: 1;
}
#statusMessage {
    order: 2;
}
#currentDomainCardContainer {
    order: 3;
}
#resultsArea {
    order: 4;
}
#gameSlotsContainer {
    order: 0;
}
/* 1) Reduce spacing between header button rows */
.header-row {
  margin-bottom: 2px !important; /* originally 4px */
}

/* 2) Shrink spacing around the status message */
#statusMessage {
  margin: 4px 0 !important; /* originally 8px 0 */
}

/* 3) Tighten up the current domain card container spacing */
#currentDomainCardContainer {
  margin-top: 4px !important;    /* originally 8px */
  margin-bottom: 4px !important; /* originally 8px */
  padding-bottom: 2px !important; /* originally 5px */
}

/* 4) (Optional) Reduce any extra padding in #guiContent */
#guiContent {
  padding: 3px !important; /* originally 5px */
}

/* Adjust minimized state styling */
#bonus-checker-container.minimized {
  height: auto !important;
  min-height: 30px !important; /* Ensure there's always space for the buttons */
  max-height: none !important;
  padding-top: 30px !important;
  box-sizing: border-box !important;
}

/* Make sure minimized buttons are always visible */
#bonus-checker-container.minimized #refreshLastMin,
#bonus-checker-container.minimized #nextDomainMin,
#bonus-checker-container.minimized #exportReferLinksMin,
#bonus-checker-container.minimized #maximizeTracker,
#bonus-checker-container.minimized #toggleCurrentCardMin,
#bonus-checker-container.minimized #slotBtn0,
#bonus-checker-container.minimized #slotBtn1,
#bonus-checker-container.minimized #slotBtn2,
#bonus-checker-container.minimized #slotBtn3 {
  display: block !important;
  z-index: 9999999 !important;
}

/* Fix minimized state when the card is hidden */
#bonus-checker-container.minimized #currentDomainCardContainer[style*="display: none"] ~ #refreshLastMin,
#bonus-checker-container.minimized #currentDomainCardContainer[style*="display: none"] ~ #nextDomainMin,
#bonus-checker-container.minimized #currentDomainCardContainer[style*="display: none"] ~ #exportReferLinksMin,
#bonus-checker-container.minimized #currentDomainCardContainer[style*="display: none"] ~ #maximizeTracker,
#bonus-checker-container.minimized #currentDomainCardContainer[style*="display: none"] ~ #toggleCurrentCardMin,
#bonus-checker-container.minimized #currentDomainCardContainer[style*="display: none"] ~ #slotBtn0,
#bonus-checker-container.minimized #currentDomainCardContainer[style*="display: none"] ~ #slotBtn1,
#bonus-checker-container.minimized #currentDomainCardContainer[style*="display: none"] ~ #slotBtn2,
#bonus-checker-container.minimized #currentDomainCardContainer[style*="display: none"] ~ #slotBtn3 {
  display: block !important;
}

/* Ensure container has minimum height when card is hidden */
#bonus-checker-container.minimized #currentDomainCardContainer[style*="display: none"] {
  display: none !important;
  margin: 0 !important;
  padding: 0 !important;
  height: 0 !important;
}

/* Game slot button positioning in minimized mode */
#slotBtn0, #slotBtn1, #slotBtn2, #slotBtn3 {
  position: absolute !important;
  top: 2px !important;
  z-index: 999999 !important;
  padding: 4px 6px !important;
  font-size: 10px !important;
}
#slotBtn0 { left: 140px !important; }
#slotBtn1 { left: 200px !important; }
#slotBtn2 { left: 260px !important; }
#slotBtn3 { left: 320px !important; }
`);

    function createDomainCredentialsModal() {
        const currentDomain = extractBaseDomain(window.location.href);
        if (!currentDomain) return;
        const existingModal = document.getElementById('domainCredentialsModal');
        if (existingModal) {
            existingModal.remove();
        }
        const currentCreds = domainCredentials[currentDomain] || { phone: defaultPhone, password: defaultPassword };
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay';
        modalOverlay.id = 'domainCredentialsOverlay';
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
        // Update local object first
        domainCredentials[currentDomain] = {
            phone: phoneInput.value.trim(),
            password: passwordInput.value
        };

        // Then save to storage
        GM_setValue("domain_credentials", JSON.stringify(domainCredentials));

        // Verify the save was successful
        try {
            const savedCredsStr = GM_getValue("domain_credentials", "{}");
            const savedCreds = JSON.parse(savedCredsStr);

            // Check if the domain was properly saved
            if (!savedCreds[currentDomain] ||
                savedCreds[currentDomain].phone !== domainCredentials[currentDomain].phone) {

                // Retry the save
                setTimeout(() => {
                    GM_setValue("domain_credentials", JSON.stringify(domainCredentials));
                }, 100);
            }
        } catch(e) {
            // On parse error, retry the save
            setTimeout(() => {
                GM_setValue("domain_credentials", JSON.stringify(domainCredentials));
            }, 100);
        }

        // Force a sync of all state data
        persistGUIState();

        updateStatusWithColor(`Saved specific credentials for ${currentDomain}`, true);
        closeDomainCredentialsModal();

        if (confirm(`Do you want to login with the new credentials for ${currentDomain} now?`)) {
            tryDomainLogin();
        }
    }
}

function resetDomainCredentials() {
    const currentDomain = extractBaseDomain(window.location.href);
    if (!currentDomain) return;

    if (domainCredentials[currentDomain]) {
        delete domainCredentials[currentDomain];
        GM_setValue("domain_credentials", JSON.stringify(domainCredentials));
    }
    const phoneInput = document.getElementById('domainPhone');
    const passwordInput = document.getElementById('domainPassword');
    if (phoneInput && passwordInput) {
        phoneInput.value = defaultPhone;
        passwordInput.value = defaultPassword;
    }
    updateStatusWithColor(`Reset to default credentials for ${currentDomain}`, true);
    localStorage.removeItem("USER");
}

function createRangeModal() {
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
    addListener(document.getElementById('saveRangeBtn'), 'click', saveRangeValue);
    addListener(document.getElementById('clearRangeBtn'), 'click', clearWithinRange);
    addListener(document.getElementById('cancelRangeBtn'), 'click', closeRangeModal);
}

function openRangeModal() {
    const modal = document.getElementById('rangeModal');
    if (modal) {
        modal.classList.add('active');
        document.getElementById('rangeValue').focus();
    } else {
        createRangeModal();
        setTimeout(openRangeModal, 100);
    }
}

function closeRangeModal() {
    const modal = document.getElementById('rangeModal');
    if (modal) {
        modal.classList.remove('active');
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

async function clearWithinRange() {
    updateStatusWithColor("Clear balances functionality is not implemented in this version", false);
    closeRangeModal();
}

function openEditModal() {
    const overlay = document.getElementById('modalOverlay');
    const modal = document.getElementById('urlModal');
    const textarea = document.getElementById('urlList');
    const phoneInput = document.getElementById('apiPhone');
    const passwordInput = document.getElementById('apiPassword');

    if (!overlay || !modal) {
        createModalElements();
        return setTimeout(openEditModal, 100);
    }
    textarea.value = domainList.join('\n');
    phoneInput.value = defaultPhone;
    passwordInput.value = defaultPassword;
    overlay.style.display = 'flex';
    overlay.classList.add('active');
    modal.classList.add('active');
    textarea.focus();
}

function createModalElements() {
    const existingOverlay = document.getElementById('modalOverlay');
    if (existingOverlay) existingOverlay.remove();
    const existingModal = document.getElementById('urlModal');
    if (existingModal) existingModal.remove();

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

    modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) {
            closeEditModal();
        }
    });
    document.getElementById('saveUrls').addEventListener('click', saveEditedUrls);
    document.getElementById('cancelUrls').addEventListener('click', closeEditModal);
}

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

function saveEditedUrls() {
    const textarea = document.getElementById('urlList');
    const phoneInput = document.getElementById('apiPhone');
    const passwordInput = document.getElementById('apiPassword');

    if (!textarea) {
        updateStatusWithColor("Textarea not found. Unable to save.", false);
        return;
    }

    try {
        // Process the domain list
        const newDomainList = cleanURLList(textarea.value);

        // Save with verification - first write to local variable
        domainList = newDomainList;

        // Then persist to GM storage
        GM_setValue("bonus_checker_domains", JSON.stringify(domainList));

        // Verify the save was successful by reading it back
        const savedDomainsStr = GM_getValue("bonus_checker_domains", "[]");
        let savedDomains = [];

        try {
            savedDomains = JSON.parse(savedDomainsStr);
        } catch (parseErr) {
            updateStatusWithColor("Error parsing saved domains. Please try again.", false);
            return;
        }

        // Check if everything saved correctly
        if (savedDomains.length !== domainList.length) {
            // Retry the save one more time
            setTimeout(() => {
                GM_setValue("bonus_checker_domains", JSON.stringify(domainList));
                updateStatusWithColor("Save retry attempted. Please verify your domains list.", "warning");
            }, 100);
        }

        // Also save the credentials if present
        if (phoneInput && passwordInput) {
            defaultPhone = phoneInput.value.trim();
            defaultPassword = passwordInput.value;

            // Save with verification
            GM_setValue("default_phone", defaultPhone);
            GM_setValue("default_password", defaultPassword);

            // Verify phone saved correctly
            const savedPhone = GM_setValue("default_phone", defaultPhone);
            if (savedPhone !== defaultPhone) {
                setTimeout(() => {
                    GM_setValue("default_phone", defaultPhone);
                }, 100);
            }

            // Verify password saved correctly
            const savedPassword = GM_setValue("default_password", defaultPassword);
            if (savedPassword !== defaultPassword) {
                setTimeout(() => {
                    GM_setValue("default_password", defaultPassword);
                }, 100);
            }
        }

        // Force a sync of all saved data
        persistGUIState();

        // Close the modal and show success
        closeEditModal();
        updateStatusWithColor(`Saved ${domainList.length} domains and updated API credentials.`, true);

        // Final verification after a short delay
        setTimeout(() => {
            try {
                const finalCheck = GM_getValue("bonus_checker_domains", "[]");
                const finalDomains = JSON.parse(finalCheck);
                if (finalDomains.length !== domainList.length) {
                    updateStatusWithColor("Warning: Domain save verification failed. You may need to save again.", "warning");
                }
            } catch(e) {
                // Silent catch - just a final verification
            }
        }, 250);

    } catch (e) {
        updateStatusWithColor(`Error saving URLs: ${e.message}. Please try again.`, false);
    }
}

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
      displayText = `M (${maxWithdrawalBonusType || 'commission'})`;
      break;
    default:
      displayText = 'Commission';
      sortMode = 'commission';
  }
  btn.textContent = `Sort: ${displayText}`;
}

// 3) SORT THE CARDS, THEN TRIGGER FAVICON LOADING AFTERWARDS
function sortDomainCards() {
    const results = document.getElementById('resultsArea');
    if (!results) return;

    const currentContainer = document.getElementById('currentDomainCardContainer');
    const otherCards = Array.from(results.querySelectorAll('.site-card:not(.current-domain-card)'));

    // Sort by selected sortMode
    otherCards.sort((a, b) => {
        const domainA = a.getAttribute('data-domain') || '';
        const domainB = b.getAttribute('data-domain') || '';
        const infoA = temporaryBonusData[domainA];
        const infoB = temporaryBonusData[domainB];

        function compareNumbers(x, y) {
            const valX = parseFloat(x) || 0;
            const valY = parseFloat(y) || 0;
            return valY - valX;
        }
        function isErrorDomain(info) {
            return (info && info.error) ? 1 : 0;
        }

        if (sortMode === 'errors') {
            return isErrorDomain(infoB) - isErrorDomain(infoA);
        } else if (sortMode === 'commission') {
            return compareNumbers(infoA?.commission?.amount, infoB?.commission?.amount);
        } else if (sortMode === 'share') {
            return compareNumbers(infoA?.share?.amount, infoB?.share?.amount);
        } else if (sortMode === 'referral') {
            return compareNumbers(infoA?.referral?.amount, infoB?.referral?.amount);
        } else if (sortMode === 'balance') {
            return compareNumbers(infoA?.cash, infoB?.cash);
        } else if (sortMode === 'maxWithdrawal') {
            let bonusA = infoA && infoA[maxWithdrawalBonusType];
            let bonusB = infoB && infoB[maxWithdrawalBonusType];
            const maxA = bonusA?.maxWithdrawal ? parseFloat(bonusA.maxWithdrawal) : 0;
            const maxB = bonusB?.maxWithdrawal ? parseFloat(bonusB.maxWithdrawal) : 0;
            return maxB - maxA;
        }
        return 0;
    });

    // Re-append sorted cards:
    results.innerHTML = '';
    if (currentContainer) {
        results.appendChild(currentContainer);
    }
    otherCards.forEach(card => results.appendChild(card));

    updateStatusWithColor(`Sorted domains by ${sortMode}`, 'success');

    // Load favicons now that sorting is done:
    loadFaviconsForAllCards();
}

    function openAutoValidOptionsPopup() {
  let overlay = document.getElementById('autoValidOptionsOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'autoValidOptionsOverlay';
    overlay.className = 'modal-overlay';
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div id="autoValidOptionsModal"
         style="background: rgba(0,0,0,0.9);
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
        <button class="control-btn pink-button auto-valid-option"
                data-type="commission"
                ${autoValidBonusType==="commission"?"class='active'":""}>
          Commission
        </button>
        <button class="control-btn pink-button auto-valid-option"
                data-type="share"
                ${autoValidBonusType==="share"?"class='active'":""}>
          Share
        </button>
        <button class="control-btn pink-button auto-valid-option"
                data-type="referral"
                ${autoValidBonusType==="referral"?"class='active'":""}>
          Referral
        </button>
        <button class="control-btn pink-button auto-valid-option"
                data-type="maxWithdrawal"
                ${autoValidBonusType==="maxWithdrawal"?"class='active'":""}>
          Max Withdrawal
        </button>
      </div>
      <div id="maxWithdrawalBonusSelection" style="display: none; margin-bottom: 10px;">
        <p style="color: #fff; font-weight: bold;">
          Select bonus type for Max Withdrawal:
        </p>
        <label style="margin-right: 10px; color: #fff;">
          <input type="radio" name="maxWithdrawalBonus"
                 value="commission"
                 ${maxWithdrawalBonusType==="commission"?"checked":""}>
          Commission
        </label>
        <label style="margin-right: 10px; color: #fff;">
          <input type="radio" name="maxWithdrawalBonus"
                 value="share"
                 ${maxWithdrawalBonusType==="share"?"checked":""}>
          Share
        </label>
        <label style="margin-right: 10px; color: #fff;">
          <input type="radio" name="maxWithdrawalBonus"
                 value="referral"
                 ${maxWithdrawalBonusType==="referral"?"checked":""}>
          Referral
        </label>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button id="applyAutoValidOptions" class="control-btn pink-button">
          Apply
        </button>
        <button id="cancelAutoValidOptions" class="control-btn pink-button">
          Cancel
        </button>
      </div>
    </div>
  `;
  overlay.style.display = 'flex';
  overlay.classList.add('active');

  let selectedType = autoValidBonusType;
  const optionButtons = overlay.querySelectorAll('.auto-valid-option');
  optionButtons.forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      optionButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      selectedType = btn.getAttribute('data-type');
      const radioContainer = overlay.querySelector('#maxWithdrawalBonusSelection');
      radioContainer.style.display =
        (selectedType === "maxWithdrawal") ? 'block' : 'none';
    });
  });

  overlay.querySelector('#applyAutoValidOptions').onclick = function(e) {
    e.stopPropagation();
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

      // Save with verification
      GM_setValue("maxWithdrawalBonusType", maxWithdrawalBonusType);

      // Verify the save was successful
      const savedMaxType = GM_getValue("maxWithdrawalBonusType", null);
      if (savedMaxType !== maxWithdrawalBonusType) {
        setTimeout(() => {
          GM_setValue("maxWithdrawalBonusType", maxWithdrawalBonusType);
        }, 100);
      }
    } else {
      autoValidBonusType = selectedType;
    }

    // Save autoValidBonusType
    GM_setValue("autoValidBonusType", autoValidBonusType);

    // Verify the save
    const savedBonusType = GM_getValue("autoValidBonusType", null);
    if (savedBonusType !== autoValidBonusType) {
      setTimeout(() => {
        GM_setValue("autoValidBonusType", autoValidBonusType);
      }, 100);
    }

    // Enable auto nav valid
    autoNavValid = true;
    GM_setValue("autoNavValid", true);

    // Verify autoNavValid was saved
    const savedAutoNavValid = GM_getValue("autoNavValid", null);
    if (savedAutoNavValid !== true) {
      setTimeout(() => {
        GM_setValue("autoNavValid", true);
      }, 100);
    }

    updateStatusWithColor(
      `Auto Valid enabled for bonus type: ${autoValidBonusType}${
        autoValidBonusType==="maxWithdrawal" ? " ("+maxWithdrawalBonusType+")" : ""
      }`,
      true
    );

    setTimeout(() => {
      updateToggleButtons(); // Update the toggle button display
    }, 150);

    closeAutoValidOptionsPopup();
  };

  overlay.querySelector('#cancelAutoValidOptions').onclick = function(e) {
    e.stopPropagation();
    closeAutoValidOptionsPopup();
  };

  overlay.addEventListener('click', e => {
    if (e.target === overlay) {
      closeAutoValidOptionsPopup();
    }
  });

  const initialRadioContainer = overlay.querySelector('#maxWithdrawalBonusSelection');
  initialRadioContainer.style.display = (autoValidBonusType === "maxWithdrawal")
    ? 'block' : 'none';
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
  overlay.innerHTML = `
    <div id="sortOptionsModal"
         style="background: rgba(0,0,0,0.9);
                color: #fff;
                padding: 20px;
                border: 2px solid #ff1493;
                border-radius: 8px;
                width: 320px;
                text-align: center;
                position: relative;">
      <h3 style="color: #ff1493; margin-bottom: 15px;">Sort Options</h3>
      <div class="sort-options" style="margin-bottom: 10px;">
        <button class="control-btn pink-button sort-option"
                data-mode="commission"
                ${sortMode==="commission"?"class='active'":""}>
          Commission
        </button>
        <button class="control-btn pink-button sort-option"
                data-mode="share"
                ${sortMode==="share"?"class='active'":""}>
          Share
        </button>
        <button class="control-btn pink-button sort-option"
                data-mode="referral"
                ${sortMode==="referral"?"class='active'":""}>
          Referral
        </button>
        <button class="control-btn pink-button sort-option"
                data-mode="balance"
                ${sortMode==="balance"?"class='active'":""}>
          Balance
        </button>
        <button class="control-btn pink-button sort-option"
                data-mode="errors"
                ${sortMode==="errors"?"class='active'":""}>
          Errors
        </button>
        <button class="control-btn pink-button sort-option"
                data-mode="maxWithdrawal"
                ${sortMode==="maxWithdrawal"?"class='active'":""}>
          Max Withdrawal
        </button>
      </div>
      <div id="maxWithdrawalBonusSelection"
           style="display: ${sortMode==="maxWithdrawal"?"block":"none"};
                  margin-bottom: 10px;">
        <p style="color: #fff; font-weight: bold;">
          Select bonus type for Max Withdrawal:
        </p>
        <label style="margin-right: 10px; color: #fff;">
          <input type="radio" name="maxWithdrawalBonus"
                 value="commission"
                 ${maxWithdrawalBonusType==="commission"?"checked":""}>
          Commission
        </label>
        <label style="margin-right: 10px; color: #fff;">
          <input type="radio" name="maxWithdrawalBonus"
                 value="share"
                 ${maxWithdrawalBonusType==="share"?"checked":""}>
          Share
        </label>
        <label style="margin-right: 10px; color: #fff;">
          <input type="radio" name="maxWithdrawalBonus"
                 value="referral"
                 ${maxWithdrawalBonusType==="referral"?"checked":""}>
          Referral
        </label>
      </div>
      <div style="display: flex; justify-content: flex-end; gap: 8px;">
        <button id="applySortOptions" class="control-btn pink-button">
          Apply
        </button>
        <button id="cancelSortOptions" class="control-btn pink-button">
          Cancel
        </button>
      </div>
    </div>
  `;
  overlay.style.display = 'flex';
  overlay.classList.add('active');

  const optionButtons = overlay.querySelectorAll('.sort-option');
  optionButtons.forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      optionButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      sortMode = btn.getAttribute('data-mode');
      GM_setValue("sortMode", sortMode);
      const radioContainer = overlay.querySelector('#maxWithdrawalBonusSelection');
      radioContainer.style.display = (sortMode === "maxWithdrawal") ? 'block' : 'none';
    });
  });

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
  const cancelBtn = overlay.querySelector('#cancelSortOptions');
  cancelBtn.onclick = function(e) {
    e.stopPropagation();
    closeSortOptionsPopup();
  };
  overlay.addEventListener('click', e => {
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
  const searchValue = document.getElementById('sortSearchInput')
    .value.toLowerCase().trim();
  const cards = document.querySelectorAll('.site-card');
  cards.forEach(card => {
    const domain = card.getAttribute('data-domain') || "";
    card.style.display = domain.toLowerCase().includes(searchValue)
      ? "block" : "none";
  });
}

function updateToggleButtons() {
  const navBtn = document.getElementById('toggleAutoNavNonVisited');
  const validBtn = document.getElementById('toggleAutoNavValid');
  const autoLoginBtn = document.getElementById('toggleAutoLogin');
  if (navBtn) {
    navBtn.textContent = `Auto Collect: ${autoNavNonVisited ? 'ON' : 'OFF'}`;
    navBtn.classList.remove('red','green');
    navBtn.classList.add(autoNavNonVisited ? 'green' : 'red');
  }
  if (validBtn) {
    validBtn.textContent = `Auto Valid: ${autoNavValid ? 'ON' : 'OFF'}`;
    validBtn.classList.remove('red','green');
    validBtn.classList.add(autoNavValid ? 'green' : 'red');
  }
  if (autoLoginBtn) {
    autoLoginBtn.textContent = `Auto Login: ${autoLogin ? 'ON' : 'OFF'}`;
    autoLoginBtn.classList.remove('red','green');
    autoLoginBtn.classList.add(autoLogin ? 'green' : 'red');
  }
}

function toggleNavNonVisited() {
  // Toggle the value
  autoNavNonVisited = !autoNavNonVisited;

  // Save with verification
  GM_setValue("autoNavNonVisited", autoNavNonVisited);

  // Add confirmation by reading back the value
  setTimeout(() => {
    const savedValue = GM_getValue("autoNavNonVisited", null);
    if (savedValue !== autoNavNonVisited) {
      // Try again if not saved correctly
      GM_setValue("autoNavNonVisited", autoNavNonVisited);

      // And check one more time
      setTimeout(() => {
        const finalCheck = GM_getValue("autoNavNonVisited", null);
        if (finalCheck !== autoNavNonVisited) {
          // If still failing, try localStorage as backup
          try {
            localStorage.setItem('tm_autoNavNonVisited', autoNavNonVisited ? 'true' : 'false');
          } catch(e) {
            // Silent failure
          }
        }
      }, 100);
    }
  }, 50);

  if (autoNavNonVisited) {
    // If turning on non-visited navigation, turn off valid navigation
    autoNavValid = false;
    GM_setValue("autoNavValid", false);

    // Add verification for this value too
    setTimeout(() => {
      const verifyAutoNavValid = GM_getValue("autoNavValid", null);
      if (verifyAutoNavValid !== false) {
        GM_setValue("autoNavValid", false);
      }
    }, 50);
  }

  // Force a save of the complete state
  persistGUIState();

  // Update UI
  updateToggleButtons();

  if (autoNavNonVisited) {
    updateStatusWithColor(
      "Auto navigation enabled - will move to next non-visited domain",
      true
    );
    const currentDomain = extractBaseDomain(window.location.href);
    if (currentDomain && merchantIdData[currentDomain]?.merchantId) {
      setTimeout(goToNextDomain, 1000);
    } else if (currentDomain && domainList.includes(currentDomain)) {
      updateStatusWithColor(
        `Waiting for merchant ID on ${currentDomain}`,
        true
      );
    }
  } else {
    updateStatusWithColor("Auto navigation disabled", false);
  }
}

function toggleAutoLogin() {
  // Toggle the value
  autoLogin = !autoLogin;

  // Save with verification - multiple layers
  GM_setValue("autoLogin", autoLogin);

  // First verification
  setTimeout(() => {
    const savedValue = GM_getValue("autoLogin", null);
    if (savedValue !== autoLogin) {
      // Try again if not saved correctly
      GM_setValue("autoLogin", autoLogin);

      // Second verification
      setTimeout(() => {
        const finalCheck = GM_getValue("autoLogin", null);
        if (finalCheck !== autoLogin) {
          // If still failing, try localStorage as backup
          try {
            localStorage.setItem('tm_autoLogin', autoLogin ? 'true' : 'false');
          } catch(e) {
            // Silent failure
          }
        }
      }, 100);
    }
  }, 50);

  // Force a save of the complete state
  persistGUIState();

  // Update UI
  updateToggleButtons();

  if (autoLogin) {
    updateStatusWithColor(
      "Auto-login enabled - will now login, save data, and navigate domains",
      true
    );
    const currentDomain = extractBaseDomain(window.location.href);
    if (currentDomain && domainList.includes(currentDomain)) {
      if (merchantIdData[currentDomain]?.merchantId) {
        setTimeout(tryAutoLogin, 500);
      } else {
        updateStatusWithColor(
          `Waiting for merchant ID capture for ${currentDomain}`,
          false
        );
      }
    }
  } else {
    updateStatusWithColor("Auto-login disabled", false);
  }
}

function toggleNavValid() {
  // Original function simply called openAutoValidOptionsPopup(),
  // but we need to ensure the popup actually sets values reliably
  openAutoValidOptionsPopup();

  // The popup handles setting autoNavValid and other values,
  // so we'll modify the applyAutoValidOptions handler in openAutoValidOptionsPopup
}

function toggleAutoLogin() {
  autoLogin = !autoLogin;
  GM_setValue("autoLogin", autoLogin);

  // Add confirmation by reading back the value
  const savedValue = GM_getValue("autoLogin", null);
  if (savedValue !== autoLogin) {
    // Try again if not saved correctly
    setTimeout(() => {
      GM_setValue("autoLogin", autoLogin);
    }, 100);
  }

  updateToggleButtons();

  if (autoLogin) {
    updateStatusWithColor(
      "Auto-login enabled - will now login, save data, and navigate domains",
      true
    );
    const currentDomain = extractBaseDomain(window.location.href);
    if (currentDomain && domainList.includes(currentDomain)) {
      if (merchantIdData[currentDomain]?.merchantId) {
        setTimeout(tryAutoLogin, 500);
      } else {
        updateStatusWithColor(
          `Waiting for merchant ID capture for ${currentDomain}`,
          false
        );
      }
    }
  } else {
    updateStatusWithColor("Auto-login disabled", false);
  }
}

function createCurrentDomainCard() {
  let container = document.getElementById('currentDomainCardContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'currentDomainCardContainer';
    const guiContent = document.getElementById('guiContent');
    guiContent.insertBefore(container, guiContent.firstChild);
  }
  updateCurrentDomainCard();
}

function checkAndCaptureBonusDataAfterLoad() {
  const currentDomain = extractBaseDomain(window.location.href);
  if (!domainList.includes(currentDomain)) {
    updateCurrentDomainCard();
    return;
  }
  let attempts = 0;
  const maxAttempts = 5;
  function attemptCapture() {
    attempts++;
    if (temporaryBonusData[currentDomain]) {
      return;
    }
    if (!merchantIdData[currentDomain]?.merchantId) {
      if (attempts < maxAttempts) {
        attemptCapture();
      }
      return;
    }
    const merchantId = merchantIdData[currentDomain].merchantId;
    const accessId = merchantIdData[currentDomain].accessId || "";
    const accessToken = merchantIdData[currentDomain].accessToken || "";
    if (accessId && accessToken) {
      forceSyncDataCapture(currentDomain, merchantId, accessId, accessToken);
    } else if (attempts < maxAttempts) {
      tryDomainLogin(currentDomain, attemptCapture);
    }
  }
  attemptCapture();
}

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
          const bonusData = filterBonuses(parsed, domain);
          temporaryBonusData[domain] = bonusData;
          updateCurrentDomainCard();
          lastCapturedDomain = domain;
          lastCapturedBonus = parsed.data;
          renderLastCapturedInfo();
        } else {
          if (parsed.message && parsed.message.toLowerCase().includes("token")) {
            delete merchantIdData[domain].accessId;
            delete merchantIdData[domain].accessToken;
            GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));
          }
        }
      } catch(e) {}
    },
    onerror: function() {},
    ontimeout: function() {}
  });
}

function tryDomainLogin(domain, callback) {
  domain = domain || extractBaseDomain(window.location.href);
  const merchantId = merchantIdData[domain]?.merchantId;
  if (!merchantId) {
    if (callback) callback();
    return;
  }
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
          merchantIdData[domain].accessId = resp.data.id;
          merchantIdData[domain].accessToken = resp.data.token;
          GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));
          forceSyncDataCapture(domain, merchantId, resp.data.id, resp.data.token);
        }
      } catch(e) {}
      if (callback) callback();
    },
    onerror: function() {
      if (callback) callback();
    },
    ontimeout: function() {
      if (callback) callback();
    }
  });
}
function autoLoginCheck() {
  if (!autoLogin) return;
  const currentDomain = extractBaseDomain(window.location.href);

  // Try to retrieve the current USER object from localStorage.
  let userData;
  try {
    userData = JSON.parse(localStorage.getItem("USER") || "{}");
  } catch (e) {
    userData = {};
  }

  // If the USER object already has both token and id, assume we're logged in.
  if (userData && userData.token && userData.id) {
    updateStatusWithColor("Auto login: already logged in on this domain.", "success");
    return;
  }

  // Otherwise, look for stored credentials in merchantIdData.
  const domainData = merchantIdData[currentDomain];
  if (domainData && domainData.accessToken && domainData.accessId) {
    // Build a minimal user object.
    // You might need to add additional fields if the site requires them.
    userData = {
      token: domainData.accessToken,
      id: domainData.accessId,
      merchantId: domainData.merchantId
    };
    localStorage.setItem("USER", JSON.stringify(userData));
    updateStatusWithColor("Auto login: token and id set from storage. Reloading page...", "info");
    // Reload the page so that the new USER object takes effect.
    location.reload();
  } else {
    updateStatusWithColor("Auto login: no stored token found for this domain.", "error");
  }
}
function setupPeriodicStateCheck() {
  const checkInterval = setInterval(() => {
    const container = document.getElementById('bonus-checker-container');
    if (container) {
      const isMinimized = GM_getValue("minimized", false);
      if (isMinimized && !container.classList.contains('minimized')) {
        container.classList.add('minimized');
      } else if (!isMinimized && container.classList.contains('minimized')) {
        container.classList.remove('minimized');
      }
    }
    const maximizeBtn = document.getElementById('maximizeTracker');
    if (maximizeBtn && container && container.classList.contains('minimized')) {
      maximizeBtn.style.display = 'block';
    }
  }, 2000);
  window.stateCheckInterval = checkInterval;
}

function renderLastCapturedInfo() {
  const el = document.getElementById('lastCapturedInfo');
  if (!el) return;
  if (!lastCapturedDomain || !lastCapturedBonus) {
    el.textContent = 'No bonus captured yet';
    return;
  }
  el.textContent = `${lastCapturedDomain} - Last bonus captured`;
}

function updateLastValidDomain(domain) {
  if (domainList.includes(domain)) {
    lastValidListedDomain = domain;
    GM_setValue("lastValidDomain", domain);
  }
}

function getCurrentDisplayDomain() {
  const currentDomain = extractBaseDomain(window.location.href);
  if (domainList.includes(currentDomain)) {
    GM_setValue("lastValidDomain", currentDomain);
    return currentDomain;
  } else {
    const storedLast = GM_getValue("lastValidDomain", null);
    return storedLast || currentDomain;
  }
}

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
  let currentDomain = extractBaseDomain(window.location.href);
  let domainToRefresh = domainList.includes(currentDomain)
    ? currentDomain
    : GM_getValue("lastValidDomain", null);

  if (!domainToRefresh) {
    return;
  }

  // Save current visibility state
  const currentVisibilityState = minimizedCardHidden;

  temporaryBonusData[domainToRefresh] = null;
  checkDomain(domainToRefresh, true).then(() => {
    updateCurrentDomainCard(domainToRefresh);

    // Restore the original visibility state, don't modify it
    minimizedCardHidden = currentVisibilityState;

    // Apply the correct visibility state without changing it
    const currentDomainCard = document.getElementById('currentDomainCardContainer');
    if (currentDomainCard) {
      if (minimizedCardHidden) {
        currentDomainCard.style.cssText = "display: none !important;";
      } else {
        currentDomainCard.style.cssText = "display: block !important;";
      }
    }
  });
}


    async function checkAllBonuses() {
  fetchFreshBonusData();
}

async function fetchNewBonusData() {
  activeChecks.clear();
  processedCount = 0;
  createCurrentDomainCard();
  const validDomains = domainList;
  totalSites = validDomains.length;
  if (totalSites === 0) {
    updateStatusWithColor('No domains found in your list.', 'warning');
    isFetchingBonusData = false;
    return;
  }
  const batches = [];
  for (let i = 0; i < validDomains.length; i += BATCH_SIZE) {
    batches.push(validDomains.slice(i, i + BATCH_SIZE));
  }
  updateStatusWithColor(
    `Processing ${validDomains.length} domains in ${batches.length} batches of up to ${BATCH_SIZE} each`,
    'info',
    { processed: 0, total: totalSites }
  );
  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batch = batches[batchIndex];
    const batchStart = Date.now();
    updateStatusWithColor(
      `Processing batch ${batchIndex + 1}/${batches.length} (${batch.length} domains)`,
      'info',
      { processed: processedCount, total: totalSites }
    );
    await Promise.all(
      batch.map(domain =>
        checkDomain(domain, true)
          .then(() => {
            updateBonusDisplay(temporaryBonusData[domain], `https://${domain}`);
            processedCount++;
          })
          .catch(error => {
            processedCount++;
            updateBonusDisplay(null, `https://${domain}`, `Error: ${error.message || 'Unknown error'}`);
          })
      )
    );
    const batchDuration = ((Date.now() - batchStart) / 1000).toFixed(1);
    updateStatusWithColor(
      `Completed batch ${batchIndex + 1}/${batches.length} in ${batchDuration}s`,
      'success',
      { processed: processedCount, total: totalSites }
    );
  }
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
    updateStatusWithColor(
      'Error saving bonus data to cache.',
      'error',
      { processed: processedCount, total: totalSites }
    );
  }
  sortDomainCards();
  updateCurrentDomainCard();
}

// 1) FAST PARALLEL FETCH OF ALL DOMAINS
// -------------------------------------
// 1) FAST PARALLEL FETCH OF ALL DOMAINS (with delayed favicon loading)
// Clear all domain cards except the current domain card
function clearAllDomainCardsExceptCurrent() {
    const resultsArea = document.getElementById('resultsArea');
    if (!resultsArea) return;

    // Find all site cards that are not the current domain card
    const cards = resultsArea.querySelectorAll('.site-card:not(.current-domain-card)');

    // Remove each card
    cards.forEach(card => {
        card.remove();
    });
}
// Helper function to retry problematic domains with shorter timeouts
function retryDomainWithShorterTimeout(domain) {
  return new Promise((resolve, reject) => {
    // We'll use a much shorter timeout for these problematic domains
    const shorterTimeout = 8000; // 8 seconds

    updateStatusWithColor(`[Retry] Attempting ${domain} with ${shorterTimeout/1000}s timeout`, 'info');

    // Validate merchant data first
    const merchantData = merchantIdData[domain];
    if (!merchantData || !merchantData.merchantId) {
      temporaryBonusData[domain] = { error: `No merchantId for ${domain}` };
      updateBonusDisplay(null, `https://${domain}`, `No merchantId for ${domain}`);
      return reject(new Error(`No merchantId for ${domain}`));
    }

    if (!merchantData.accessId || !merchantData.accessToken) {
      temporaryBonusData[domain] = { error: `Missing access credentials for ${domain}` };
      updateBonusDisplay(null, `https://${domain}`, `Missing credentials for ${domain}`);
      return reject(new Error(`Missing credentials for ${domain}`));
    }

    // Prepare the syncData request
    const syncParams = new URLSearchParams({
      module: "/users/syncData",
      merchantId: merchantData.merchantId,
      domainId: "0",
      accessId: merchantData.accessId,
      accessToken: merchantData.accessToken,
      walletIsAdmin: merchantData.walletIsAdmin || ""
    });

    const apiUrl = `https://${domain}/api/v1/index.php`;

    const overallTimeoutId = setTimeout(() => {
      temporaryBonusData[domain] = { error: `Retry timeout (${shorterTimeout/1000}s) for ${domain}` };
      updateBonusDisplay(null, `https://${domain}`, `Retry timeout for ${domain}`);
      reject(new Error(`Retry timeout for ${domain}`));
    }, shorterTimeout);

    GM_xmlhttpRequest({
      method: "POST",
      url: apiUrl,
      headers: {
        "Accept": "*/*",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
      },
      data: syncParams.toString(),
      timeout: shorterTimeout,
      onload: function(response) {
        clearTimeout(overallTimeoutId);

        // Check for common error patterns in the response text
        if (response.responseText && (
            response.responseText.includes('HEADERS_RECEIVED') ||
            response.responseText.includes('LOADING') ||
            response.responseText.includes('OPENED') ||
            response.responseText.includes('UNSENT') ||
            response.responseText.includes('RESPONSE_TYPE')
        )) {
          temporaryBonusData[domain] = { error: `Network error for ${domain}: ${response.responseText}` };
          updateBonusDisplay(null, `https://${domain}`, `Network error for ${domain}`);
          return reject(new Error(`Network error for ${domain}`));
        }

        if (response.status !== 200) {
          temporaryBonusData[domain] = { error: `HTTP ${response.status} error for ${domain}` };
          updateBonusDisplay(null, `https://${domain}`, `HTTP ${response.status} error for ${domain}`);
          return reject(new Error(`HTTP ${response.status} error for ${domain}`));
        }

        try {
          const parsed = JSON.parse(response.responseText);

          if (String(parsed.status).toUpperCase() === "SUCCESS" && parsed.data) {
            const bonusData = filterBonuses(parsed, domain);
            temporaryBonusData[domain] = bonusData;

            // Update UI based on domain
            if (domain === getCurrentDisplayDomain()) {
              updateCurrentDomainCard();
            } else {
              updateBonusDisplay(bonusData, `https://${domain}`);
            }

            updateStatusWithColor(`[Retry] Successfully retrieved data for ${domain}`, 'success');
            resolve(bonusData);
          } else {
            // Try to extract a server error message
            let serverMsg = parsed.message || (parsed.data && parsed.data.Message);
            if (!serverMsg) {
              serverMsg = JSON.stringify(parsed);
            }

            // Handle token errors
            if (serverMsg.toLowerCase().includes("token") || serverMsg.toLowerCase().includes("login")) {
              delete merchantData.accessId;
              delete merchantData.accessToken;
              GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));
            }

            temporaryBonusData[domain] = { error: `API error: ${serverMsg}` };
            updateBonusDisplay(null, `https://${domain}`, `API error for ${domain}: ${serverMsg}`);
            reject(new Error(`API error for ${domain}: ${serverMsg}`));
          }
        } catch (e) {
          temporaryBonusData[domain] = { error: `JSON parse error for ${domain}: ${e.message}` };
          updateBonusDisplay(null, `https://${domain}`, `Parse error for ${domain}`);
          reject(new Error(`JSON parse error for ${domain}: ${e.message}`));
        }
      },
      onerror: function(e) {
        clearTimeout(overallTimeoutId);
        temporaryBonusData[domain] = { error: `Network error for ${domain}: ${e.message || "Unknown error"}` };
        updateBonusDisplay(null, `https://${domain}`, `Network error for ${domain}`);
        reject(new Error(`Network error for ${domain}: ${e.message || "Unknown error"}`));
      },
      ontimeout: function() {
        clearTimeout(overallTimeoutId);
        temporaryBonusData[domain] = { error: `Retry request timeout for ${domain}` };
        updateBonusDisplay(null, `https://${domain}`, `Retry timeout for ${domain}`);
        reject(new Error(`Retry request timeout for ${domain}`));
      }
    });
  });
}

    // Helper function to check for common error patterns in responses
function checkForErrorPatterns(responseText) {
  if (!responseText) return false;

  const errorPatterns = [
    'HEADERS_RECEIVED',
    'LOADING',
    'OPENED',
    'UNSENT',
    'RESPONSE_TYPE',
    'Request Timeout',
    'CheckDomain'
  ];

  for (const pattern of errorPatterns) {
    if (responseText.includes(pattern)) {
      return true;
    }
  }

  return false;
}

// Helper function to extract the most specific error message from an error object or string
function extractErrorMessage(error, defaultMessage = "Unknown error") {
  if (!error) return defaultMessage;

  if (typeof error === 'object') {
    // First, check for standard error properties
    if (error.message) return error.message;
    if (error.statusText) return error.statusText;
    if (error.responseText) {
      // Try to extract error pattern from response text
      const errorPatterns = [
        { regex: /Request Timeout \((\d+)s\) For ([^:]+)/, extract: (m) => `Request Timeout (${m[1]}s) for ${m[2]}` },
        { regex: /\[CheckDomain\]([^"]+)/, extract: (m) => m[1].trim() },
        { regex: /"DONE":4,"HEADERS_RECEIVED":2,"LOADING":3,"OPENED":1,"UNSENT":0/, extract: () => "Connection error (request state transition failed)" }
      ];

      for (const pattern of errorPatterns) {
        const match = error.responseText.match(pattern.regex);
        if (match) {
          return pattern.extract(match);
        }
      }

      // If we find an error pattern but no specific match, return a generic message
      if (checkForErrorPatterns(error.responseText)) {
        return "Network connection error";
      }

      return error.responseText.substring(0, 100) + (error.responseText.length > 100 ? '...' : '');
    }

    // If we have an object but no standard properties, stringify it
    try {
      return JSON.stringify(error);
    } catch (e) {
      return defaultMessage;
    }
  }

  // If it's a string, return it directly
  if (typeof error === 'string') {
    return error;
  }

  // Fallback
  return String(error) || defaultMessage;
}
    // 1) FAST PARALLEL FETCH OF ALL DOMAINS (with delayed favicon loading)
// 1) FAST PARALLEL FETCH OF ALL DOMAINS (with delayed favicon loading)
// 1) FAST PARALLEL FETCH OF ALL DOMAINS (with delayed favicon loading)
// 1) FAST PARALLEL FETCH OF ALL DOMAINS (with delayed favicon loading)
// 1) FAST PARALLEL FETCH OF ALL DOMAINS (with delayed favicon loading)
// 1) EXTREMELY FAST PARALLEL FETCH OF ALL DOMAINS (no batching, no artificial delays)
// 1) EXTREMELY FAST PARALLEL FETCH OF ALL DOMAINS (no batching, no artificial delays)
// with forced final UI update to 100%

    // 1) EXTREMELY FAST PARALLEL FETCH OF ALL DOMAINS (no batching, no artificial delays)
// with forced final UI update to 100% and a timeout mechanism
async function fetchFreshBonusData() {
    if (isFetchingBonusData) {
        updateStatusWithColor("[FetchBonus] Another bonus data fetch is in progress.", 'warning');
        return;
    }

    // Clear existing domain cards except the current domain card
    clearAllDomainCardsExceptCurrent();

    isFetchingBonusData = true;
    showingLastData = false;
    activeChecks.clear();
    processedCount = 0;

    const validDomains = domainList.slice();
    totalSites = validDomains.length;

    if (totalSites === 0) {
        updateStatusWithColor("No domains found in your list.", "warning");
        isFetchingBonusData = false;
        return;
    }

    updateStatusWithColor(
        `[FetchBonus] Fetching bonus data for ${totalSites} domain(s) in parallel...`,
        'info',
        { processed: 0, total: totalSites }
    );

    const freshBonusData = {};
    let nextUIUpdateTime = Date.now() + 500; // First update after 500ms

    // Add a timeout mechanism
    const globalTimeout = setTimeout(() => {
        if (processedCount < totalSites) {
            updateStatusWithColor(
                `[FetchBonus] Timeout reached (15s). Finishing with ${processedCount}/${totalSites} domains processed.`,
                'warning',
                { processed: totalSites, total: totalSites } // Force UI to show 100%
            );

            // Force completion
            completeOperation();
        }
    }, 15000); // 15 second timeout

    // Function to handle completion (either normal or via timeout)
    const completeOperation = () => {
        clearTimeout(globalTimeout); // Clear the timeout if normal completion

        // Save the fresh bonus data to cache
        try {
            GM_setValue("cached_bonus_data", JSON.stringify(freshBonusData));
            GM_setValue("cached_bonus_timestamp", Date.now().toString());
            // Reset visited domains
            visitedDomains = [];
            GM_setValue("visitedDomains", visitedDomains);
        } catch (e) {
            updateStatusWithColor("[FetchBonus] Error saving data to cache.", 'error');
        }

        // Sort and load favicons after all domains have been processed
        sortDomainCards();
        loadFaviconsForAllCards();

        // Final status update with complete progress
        updateStatusWithColor(
            "Caching complete and domains sorted. (100% complete)",
            "success",
            { processed: totalSites, total: totalSites }
        );

        isFetchingBonusData = false;
    };

    // Create an array of promises to fetch data for all domains in parallel
    const domainPromises = validDomains.map((domain) => {
        return new Promise((resolve) => {
            checkDomain(domain, true)
                .then(() => {
                    // Save the domain's data from your temporary store if found
                    if (temporaryBonusData[domain]) {
                        freshBonusData[domain] = temporaryBonusData[domain];
                    }
                })
                .catch((err) => {
                    updateStatusWithColor(
                        `[FetchBonus] Error on ${domain}: ${err.message}`,
                        'warning'
                    );
                })
                .finally(() => {
                    processedCount++;

                    // Update status message, but don't flood the UI
                    const now = Date.now();
                    if (processedCount === totalSites || now >= nextUIUpdateTime) {
                        updateStatusWithColor(
                            `[FetchBonus] Progress: ${processedCount}/${totalSites} domains processed.`,
                            'info',
                            { processed: processedCount, total: totalSites }
                        );
                        nextUIUpdateTime = now + 500; // Update at most every 500ms
                    }

                    // If all domains are processed, finish up
                    if (processedCount >= totalSites) {
                        updateStatusWithColor(
                            `[FetchBonus] Completed. Processed ${totalSites} domain(s). Data saved.`,
                            'success',
                            { processed: totalSites, total: totalSites }
                        );
                        completeOperation();
                    }

                    resolve();
                });
        });
    });

    // Wait for all domains to finish fetching (this will still finish if the timeout occurs)
    try {
        await Promise.all(domainPromises);
    } catch (error) {
        updateStatusWithColor(`[FetchBonus] Error in Promise.all: ${error.message}`, 'error');
        // Still complete the operation even on error
        completeOperation();
    }
}

    GM_addStyle(`
    #bonus-checker-container {
        border-bottom: none !important;
    }
`);
// 4) LOAD ALL FAVICONS (same logic, only runs AFTER sorting now)
// 3) loadFaviconsForAllCards() FUNCTION (UNCHANGED, BUT COMPLETE)
async function loadFaviconsForAllCards() {
    const cards = document.querySelectorAll('.site-card');
    for (const card of cards) {
        const domain = card.getAttribute('data-domain');
        if (domain && window.faviconManager && typeof window.faviconManager.addFaviconToCard === 'function') {
            try {
                await window.faviconManager.addFaviconToCard(card, domain);
            } catch (err) {
                console.error(`Favicon load error for ${domain}:`, err);
            }
        }
    }
}

// 1) FAVICON MANAGER CLASS (NO DEFAULT ICON, BIGGER SEARCH RANGE)
// Updated FaviconManager Class: Dynamically checks for favicon links and uses an expanded list.
// If no favicon is found, it caches an empty string (i.e. no default icon is shown).
// Updated FaviconManager Class with enhanced dynamic detection
// 1) FAVICONMANAGER CLASS (NEW clearDomainFavicon() METHOD)
class FaviconManager {
    constructor() {
        this.faviconCache = {};
    }

    loadCachedFavicons() {
        try {
            const cachedData = GM_getValue('favicon_cache', '{}');
            this.faviconCache = JSON.parse(cachedData);
        } catch (e) {
            this.faviconCache = {};
        }
    }

    saveFaviconCache() {
        try {
            GM_setValue('favicon_cache', JSON.stringify(this.faviconCache));
        } catch (e) {
            // handle error if needed
        }
    }

    /**
     * Clears the cached favicon for a specific domain
     * so the script won't use the old data URL next time.
     */
    clearDomainFavicon(domain) {
        if (this.faviconCache.hasOwnProperty(domain)) {
            delete this.faviconCache[domain];
            this.saveFaviconCache();
        }
    }

    async getFavicon(domain) {
        // If we have a cached entry, return it
        if (this.faviconCache.hasOwnProperty(domain)) {
            return this.faviconCache[domain];
        }

        // Attempt dynamic detection from homepage HTML
        let dynamicUrl = await this.getDynamicFaviconUrl(domain);
        if (dynamicUrl) {
            try {
                const dataUrl = await this.fetchFavicon(dynamicUrl);
                if (dataUrl) {
                    this.faviconCache[domain] = dataUrl;
                    this.saveFaviconCache();
                    return dataUrl;
                }
            } catch (e) {
                // Fall through to static checks
            }
        }

        // Fallback list of likely favicon URLs
        const faviconUrls = [
            `https://${domain}/favicon.ico`,
            `https://${domain}/favicon.png`,
            `https://${domain}/favicon-16x16.png`,
            `https://${domain}/favicon-32x32.png`,
            `https://${domain}/favicon-48x48.png`,
            `https://${domain}/favicon-64x64.png`,
            `https://${domain}/favicon-72x72.png`,
            `https://${domain}/favicon-96x96.png`,
            `https://${domain}/favicon-128x128.png`,
            `https://${domain}/favicon-192x192.png`,
            `https://${domain}/favicon-512x512.png`,
            `https://${domain}/apple-touch-icon.png`,
            `https://${domain}/apple-touch-icon-precomposed.png`,
            `https://${domain}/android-chrome-192x192.png`,
            `https://${domain}/android-chrome-512x512.png`,
            `https://${domain}/ms-icon-144x144.png`,
            // As a last resort, Google's service:
            `https://www.google.com/s2/favicons?domain=${domain}&sz=128`
        ];

        for (const url of faviconUrls) {
            try {
                const dataUrl = await this.fetchFavicon(url);
                if (dataUrl) {
                    this.faviconCache[domain] = dataUrl;
                    this.saveFaviconCache();
                    return dataUrl;
                }
            } catch (e) {
                // Continue to next candidate
            }
        }

        // If all fail, store an empty string to indicate no favicon
        this.faviconCache[domain] = '';
        this.saveFaviconCache();
        return '';
    }

    /**
     * Tries to parse the homepage HTML for a <link rel="icon"> or
     * any link that includes "icon" in its rel attribute.
     */
    getDynamicFaviconUrl(domain) {
        return new Promise((resolve) => {
            const homepageUrl = `https://${domain}/`;
            GM_xmlhttpRequest({
                method: 'GET',
                url: homepageUrl,
                timeout: 5000,
                onload: function(response) {
                    if (response.status === 200 && response.responseText) {
                        try {
                            const parser = new DOMParser();
                            const doc = parser.parseFromString(response.responseText, "text/html");
                            const iconLink = doc.querySelector('link[rel*="icon"]');
                            if (iconLink && iconLink.href) {
                                const resolvedUrl = new URL(iconLink.getAttribute('href'), homepageUrl).toString();
                                resolve(resolvedUrl);
                                return;
                            }
                        } catch (e) {
                            // If parse fails, fallback below
                        }
                    }
                    resolve(null);
                },
                onerror: function() {
                    resolve(null);
                },
                ontimeout: function() {
                    resolve(null);
                }
            });
        });
    }

    /**
     * Actually fetches the resource at the given URL as a Blob, then returns a data URL.
     */
    fetchFavicon(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                responseType: 'blob',
                timeout: 5000,
                onload: (response) => {
                    if (response.status !== 200) {
                        return reject(new Error(`HTTP ${response.status}`));
                    }
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = () => reject(new Error('FileReader error'));
                    reader.readAsDataURL(response.response);
                },
                onerror: () => reject(new Error('Network error')),
                ontimeout: () => reject(new Error('Timeout fetching favicon'))
            });
        });
    }

    /**
     * Adds the favicon to the .favicon-square element within a card.
     */
    async addFaviconToCard(card, domain) {
        const container = card.querySelector('.favicon-square');
        if (!container) return;

        // Ensure card is positioned relative.
        if (card.style.position !== 'relative') {
            card.style.position = 'relative';
        }

        // Attempt to load from cache or fetch fresh
        const iconUrl = await this.getFavicon(domain);
        if (!iconUrl) {
            container.innerHTML = ''; // Show nothing if not found
            return;
        }

        container.innerHTML = `<img src="${iconUrl}" alt="${domain}" style="max-width:100%; max-height:100%;" />`;
    }
}

GM_addStyle(`
    .favicon-square {
        position: absolute;
        top: 50%;
        right: 2px;
        transform: translateY(-50%);
        max-width: 40px;
        max-height: 40px;
        overflow: hidden;
    }
    .favicon-square img {
        width: auto !important;
        height: auto !important;
        max-width: 40px !important;
        max-height: 40px !important;
        object-fit: contain;
        image-rendering: crisp-edges;
        display: block;
    }
    .cache-indicator {
        position: absolute;
        top: 2px;
        right: 2px;
        z-index: 100;
        background-color: rgba(255, 20, 147, 0.8);
        color: #fff;
        padding: 2px 4px;
        font-size: 9px;
        border-radius: 3px;
    }
`);

window.faviconManager = new FaviconManager();
window.faviconManager.loadCachedFavicons();

function showCurrentDomainOnly() {
  const results = document.getElementById('resultsArea');
  if (!results) return;
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
  updateCurrentDomainCard();
}

function showCachedBonuses() {
  try {
    const isMinimized = GM_getValue("minimized", false);
    const savedData = GM_getValue("cached_bonus_data", "{}");
    const storedBonusData = JSON.parse(savedData);

    // Clear all domain cards except current domain card first
    clearAllDomainCardsExceptCurrent();

    // Update the current domain card
    updateCurrentDomainCard();

    if (isMinimized) {
      updateStatusWithColor(
        "GUI minimized – showing only current domain bonus data.",
        true
      );
      return;
    }

    if (Object.keys(storedBonusData).length > 0) {
      showingLastData = true;
      updateStatusWithColor("Displaying cached bonus data.", true);

      const currentDomain = getCurrentDisplayDomain();
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
    updateStatusWithColor("Error loading cached data.", false);
  }
}

function setupCardAndClaimClicks(card, domain) {
  const claimButtons = card.querySelectorAll('.claim-btn');
  claimButtons.forEach(button => {
    button.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const bonusType = button.getAttribute('data-type');
      claimBonus(domain, bonusType);
    });
  });
  card.addEventListener('click', e => {
    if (!e.target.closest('.claim-btn')) {
      window.location.href = `https://${domain}`;
    }
  });
}

// 4) UPDATE THE CARD UI FOR A DOMAIN
// ----------------------------------
// 2) UPDATE BONUS DISPLAY (NO IMMEDIATE FAVICON LOADING)
// 2) updateBonusDisplay() FUNCTION (WITH “CLEAR FAV” BUTTON)
function updateBonusDisplay(bonusData, url, error, forceShowAll = false) {
    const results = document.getElementById('resultsArea');
    if (!results) return;

    const domain = extractBaseDomain(url);
    if (!domain) return;

    const container = document.getElementById('bonus-checker-container');
    if (!forceShowAll && container && container.classList.contains('live-check-mode') && domain !== getCurrentDisplayDomain()) {
        return;
    }

    if (bonusData) {
        temporaryBonusData[domain] = bonusData;
    }

    // If domain is current, show differently
    const currentDomain = getCurrentDisplayDomain();
    if (domain === currentDomain) {
        return;
    }

    let card = document.querySelector(`.site-card[data-domain="${domain}"]:not(.current-domain-card)`);
    if (!card) {
        card = document.createElement('div');
        card.className = 'site-card';
        card.setAttribute('data-domain', domain);
        card.style.cursor = 'pointer';
        card.addEventListener('click', e => {
            if (!e.target.closest('.claim-btn') && !e.target.closest('.clear-fav-btn')) {
                window.location.href = `https://${domain}`;
            }
        });
        results.appendChild(card);
    }

    if (error || (bonusData && bonusData.error)) {
        let finalError = error || bonusData.error;
        card.innerHTML = `
            <div style="font-weight: bold;">${domain}</div>
            <div class="error-message" style="color: #ff4444; font-weight: bold; margin-top: 5px;">
                Error: ${finalError}
            </div>
        `;
        card.classList.remove('valid-bonus', 'invalid-bonus');
        card.classList.add('invalid-bonus');
    } else if (bonusData) {
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

        const hasValidBonus = (
            (commission && commission.amount > 0) ||
            (share && share.amount > 0) ||
            (referral && referral.amount > 0)
        );

        card.classList.toggle('valid-bonus', hasValidBonus);
        card.classList.toggle('invalid-bonus', !hasValidBonus);

        // Helper for effective min/max
        function getEffectiveWithdrawals(fcMin, fcMax, glMin, glMax) {
            return {
                effectiveMin: (fcMin && fcMin > 0) ? fcMin : (glMin && glMin > 0 ? glMin : '--'),
                effectiveMax: (fcMax && fcMax > 0) ? fcMax : (glMax && glMax > 0 ? glMax : '--')
            };
        }
        const { effectiveMin, effectiveMax } = getEffectiveWithdrawals(
            freeCreditMinWithdraw, freeCreditMaxWithdraw, globalMinWithdraw, globalMaxWithdraw
        );

        // Note the new "Clear Fav" button in the header
        card.innerHTML = `
          <div class="card-header" style="display: flex; align-items: center; justify-content: space-between;">
             <div style="font-weight: bold;">${domain}</div>
             <div class="favicon-square"></div>
             <button class="control-btn clear-fav-btn" data-domain="${domain}" style="margin-left: 6px;">
                Clear Fav
             </button>
          </div>
          <div class="top-row">
            <div>Bal: <strong style="color:#ffd700;">${cash ?? 0}</strong></div>
            <div>Comm: ${
                commission && commission.amount > 0
                ? `<span style="color:lime;">Yes</span><strong style="color:#ffd700;"> (${commission.amount})</strong>`
                : `<span style="color:red;">No</span>`
            }</div>
            <div>Share: ${
                share && share.amount > 0
                ? `<span style="color:lime;">Yes</span><strong style="color:#ffd700;"> (${share.amount})</strong>`
                : `<span style="color:red;">No</span>`
            }</div>
            <div>Ref: ${
                referral && referral.amount > 0
                ? `<span style="color:lime;">Yes</span><strong style="color:#ffd700;"> (${referral.amount})</strong>`
                : `<span style="color:red;">No</span>`
            }</div>
          </div>
          <div class="bottom-row">
            <div>
              Withdrawals:
              <span style="color:#fff;">Min: ${effectiveMin}</span> /
              <span style="color:#fff;">Max: ${effectiveMax}</span>
            </div>
            ${
                commission && commission.amount > 0
                ? `<div>
                     <div>Min: <span style="color:#fff;">${commission.minBet ?? '--'}</span>,
                      Max: <span style="color:#fff;">${commission.maxWithdrawal ?? '--'}</span>
                     </div>
                     <button class="control-btn claim-btn" data-domain="${domain}" data-type="commission">
                       Claim Comm
                     </button>
                   </div>`
                : `<div>&nbsp;</div>`
            }
            ${
                share && share.amount > 0
                ? `<div>
                     <div>Min: <span style="color:#fff;">${share.minWithdrawal ?? '--'}</span>,
                      Max: <span style="color:#fff;">${share.maxWithdrawal ?? '--'}</span>
                     </div>
                     <button class="control-btn claim-btn" data-domain="${domain}" data-type="share">
                       Claim Share
                     </button>
                   </div>`
                : `<div>&nbsp;</div>`
            }
            ${
                referral && referral.amount > 0
                ? `<div>
                     <div>MinW: <span style="color:#fff;">${referral.minWithdrawal ?? '--'}</span>,
                      MaxW: <span style="color:#fff;">${referral.maxWithdrawal ?? '--'}</span>
                     </div>
                     <button class="control-btn claim-btn" data-domain="${domain}" data-type="referral">
                       Claim Ref
                     </button>
                   </div>`
                : `<div>&nbsp;</div>`
            }
          </div>
        `;
    }

    // If showing cached data, show the “cached” indicator
    if (showingLastData) {
        addCacheIndicator(card);
    } else {
        const existingIndicator = card.querySelector('.cache-indicator');
        if (existingIndicator) existingIndicator.remove();
    }

    // Wire up the claim buttons
    const claimBtns = card.querySelectorAll(".claim-btn");
    claimBtns.forEach(btn => {
        btn.addEventListener("click", e => {
            e.stopPropagation();
            e.preventDefault();
            const d = btn.getAttribute('data-domain');
            const bonusType = btn.getAttribute('data-type');
            claimBonus(d, bonusType);
        });
    });

    // Wire up the new "Clear Fav" button
    const clearFavBtn = card.querySelector('.clear-fav-btn');
    if (clearFavBtn) {
        clearFavBtn.addEventListener('click', e => {
            e.stopPropagation();
            e.preventDefault();
            if (window.faviconManager && typeof window.faviconManager.clearDomainFavicon === 'function') {
                window.faviconManager.clearDomainFavicon(domain);
            }
            // Immediately remove the displayed icon
            const favSquare = card.querySelector('.favicon-square');
            if (favSquare) {
                favSquare.innerHTML = '';
            }
            // Optionally show a status message
            if (typeof updateStatusWithColor === 'function') {
                updateStatusWithColor(`Cleared cached favicon for ${domain}`, 'success');
            }
        });
    }

    // We do NOT load the favicon right here; that is done later by loadFaviconsForAllCards()
    persistGUIState();
}

function updateCurrentDomainCard(domainOverride) {
  // 1) Determine which domain to display.
  const displayDomain = domainOverride || getCurrentDisplayDomain();
  if (!displayDomain) return;

  // 2) Find the results area.
  const resultsArea = document.getElementById('resultsArea');
  if (!resultsArea) return;

  // 3) Save the current card's visibility state
  const currentVisibility = minimizedCardHidden;

  // 4) Remove any existing current domain card.
  const existingCard = document.getElementById('currentDomainCardContainer');
  if (existingCard) {
    existingCard.remove();
  }

  // 5) Create a new current domain card container.
  const card = document.createElement('div');
  card.id = 'currentDomainCardContainer';
  card.className = 'site-card current-domain-card';
  card.setAttribute('data-domain', displayDomain);

  // 6) Retrieve bonus data for this domain.
  const bonusData = temporaryBonusData[displayDomain];

  // 7) Check if this domain has valid bonuses.
  let hasValidBonus = false;
  if (bonusData) {
    hasValidBonus = (
      (bonusData.commission && bonusData.commission.amount > 0) ||
      (bonusData.share && bonusData.share.amount > 0) ||
      (bonusData.referral && bonusData.referral.amount > 0)
    );
  }

  // 8) Apply styling based on bonus validity.
  if (hasValidBonus) {
    card.classList.add('valid-bonus');
    card.classList.remove('invalid-bonus');
    card.style.background = 'rgba(255,20,147,0.2)'; // Valid bonus background
  } else {
    card.classList.add('invalid-bonus');
    card.classList.remove('valid-bonus');
    card.style.background = 'rgba(255,20,147,0.05)'; // Invalid bonus background
  }

  // 9) Set common base styling.
  card.style.border = '2px solid #ff1493';
  card.style.padding = '6px';
  card.style.marginBottom = '6px';
  card.style.fontSize = '12px';
  card.style.borderLeft = '3px solid #ff1493';

  // 10) Build merchant ID status.
  let merchantIdStatus = "";
  if (merchantIdData[displayDomain] && merchantIdData[displayDomain].merchantId) {
    merchantIdStatus = `<div style="color: #4CAF50; font-size: 12px;">
                          Merchant ID: ${merchantIdData[displayDomain].merchantId}
                        </div>`;
  } else {
    merchantIdStatus = `<div style="color: #ff4444; font-size: 12px;">
                          Waiting for merchant ID...
                        </div>`;
  }

  // 11) Build bonus data HTML.
  let bonusHTML = "";
  if (!bonusData) {
    bonusHTML = `<div style="padding: 4px; font-size:12px;">Waiting for bonus data...</div>`;
  } else {
    // Use all your existing logic and HTML structure here
    // This part is unchanged
    // ...
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
    // Use your helper to compute effective withdrawals.
    const { effectiveMin, effectiveMax } = getEffectiveWithdrawals(
      freeCreditMinWithdraw, freeCreditMaxWithdraw, globalMinWithdraw, globalMaxWithdraw
    );
    bonusHTML = `
          <div class="top-row" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 1px; text-align: center; margin-bottom: 2px;">
            <div>Bal: <strong style="color:#ffd700;">${cash ?? 0}</strong></div>
            <div>Comm: ${formatCommissionIndicator(commission)}</div>
            <div>Share: ${formatBonusIndicator(share && share.amount)}</div>
            <div>Ref: ${formatBonusIndicator(referral && referral.amount)}</div>
            <div></div>
          </div>
          <div class="bottom-row" style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 1px; text-align: center;">
            <div>Withdrawals: Min: <span style="color:#fff;">${effectiveMin}</span> / Max: <span style="color:#fff;">${effectiveMax}</span></div>
            ${ (commission && commission.amount > 0)
                ? `<div>
                     <div>Min: <span style="color:#fff;">${commission.minBet ?? '--'}</span>, Max: <span style="color:#fff;">${commission.maxWithdrawal ?? '--'}</span></div>
                     <button class="control-btn claim-btn" data-domain="${displayDomain}" data-type="commission">Claim Comm</button>
                   </div>`
                : `<div>&nbsp;</div>` }
            ${ (share && share.amount > 0)
                ? `<div>
                     <div>Min: <span style="color:#fff;">${share.minWithdrawal ?? '--'}</span>, Max: <span style="color:#fff;">${share.maxWithdrawal ?? '--'}</span></div>
                     <button class="control-btn claim-btn" data-domain="${displayDomain}" data-type="share">Claim Share</button>
                   </div>`
                : `<div>&nbsp;</div>` }
            ${ (referral && referral.amount > 0)
                ? `<div>
                     <div>MinW: <span style="color:#fff;">${referral.minWithdrawal ?? '--'}</span>, MaxW: <span style="color:#fff;">${referral.maxWithdrawal ?? '--'}</span></div>
                     <button class="control-btn claim-btn" data-domain="${displayDomain}" data-type="referral">Claim Ref</button>
                   </div>`
                : `<div>&nbsp;</div>` }
            <div></div>
          </div>
    `;
  }

  // 12) Build the header HTML.
  const headerHTML = `
      <div class="card-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
        <div style="font-weight: bold; font-size:14px;">${displayDomain} (Current)</div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <div class="favicon-square" style="width:40px; height:40px;"></div>
          <button class="control-btn clear-fav-btn" data-domain="${displayDomain}">Clear Fav</button>
        </div>
      </div>
  `;

  // 13) Assemble the card.
  card.innerHTML = `
      ${headerHTML}
      ${bonusHTML}
      <div style="margin-top: 4px; font-size:12px;">${merchantIdStatus}</div>
  `;

  // 14) Make the card clickable (if not clicking a button).
  card.addEventListener('click', function(e) {
    if (e.target.closest('.claim-btn') ||
        e.target.closest('.clear-fav-btn') ||
        e.target.closest('.favicon-square')) {
      return;
    }
    window.location.href = `https://${displayDomain}`;
  });

  // 15) Wire up the claim buttons.
  const claimButtons = card.querySelectorAll('.claim-btn');
  claimButtons.forEach(btn => {
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      e.preventDefault();
      const bonusType = btn.getAttribute('data-type');
      claimBonus(displayDomain, bonusType);
    });
  });

  // 16) Wire up the "Clear Fav" button.
  const clearFavBtn = card.querySelector('.clear-fav-btn');
  if (clearFavBtn) {
    clearFavBtn.addEventListener('click', e => {
      e.stopPropagation();
      e.preventDefault();
      if (window.faviconManager && typeof window.faviconManager.clearDomainFavicon === 'function') {
        window.faviconManager.clearDomainFavicon(displayDomain);
      }
      const favSquare = card.querySelector('.favicon-square');
      if (favSquare) {
        favSquare.innerHTML = '';
      }
      updateStatusWithColor(`Cleared cached favicon for ${displayDomain}`, 'success');
    });
  }

  // 17) Insert the card into the results area.
  if (resultsArea.firstChild) {
    resultsArea.insertBefore(card, resultsArea.firstChild);
  } else {
    resultsArea.appendChild(card);
  }

  // 18) Apply the visibility state - IMPORTANT: use the saved state
  if (currentVisibility) {
    card.style.cssText = "display: none !important;";
  } else {
    card.style.cssText = "display: block !important;";
  }

  // 19) Load the favicon for the domain.
  if (window.faviconManager && typeof window.faviconManager.addFaviconToCard === 'function') {
    window.faviconManager.addFaviconToCard(card, displayDomain);
  }

  // 20) Persist the GUI state.
  persistGUIState();
}

function addCacheIndicator(card) {
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

    // 2) CHECK A SINGLE DOMAIN
// ------------------------
function checkDomain(domain, forceRefresh = false) {
  return new Promise((resolve) => {
    // Clear any old bonus data and mark this domain as in progress
    temporaryBonusData[domain] = null;
    activeChecks.add(domain);

    // Add local timeout for individual domain checks
    const domainTimeoutId = setTimeout(() => {
      activeChecks.delete(domain);
      const errorMsg = `[CheckDomain] Request timeout for ${domain} after 15s`;
      temporaryBonusData[domain] = { error: errorMsg };
      updateBonusDisplay(null, `https://${domain}`, errorMsg);
      resolve(); // Resolve the promise to allow other checks to continue
    }, 15000); // 15 second timeout per domain check

    // Helper to handle cleanup and error reporting
    const cleanup = (errMsg, errorObj) => {
      clearTimeout(domainTimeoutId); // Clear the timeout
      activeChecks.delete(domain);

      let detailedError = errMsg;
      if (errorObj) {
        if (typeof errorObj === 'object') {
          if (errorObj.message) {
            detailedError += `: ${errorObj.message}`;
          } else {
            detailedError += `: ${JSON.stringify(errorObj)}`;
          }
        } else {
          detailedError += `: ${errorObj}`;
        }
      }

      temporaryBonusData[domain] = { error: detailedError };
      updateBonusDisplay(null, `https://${domain}`, detailedError);
      updateStatusWithColor(detailedError, 'error');
      resolve();
    };

    // Function to perform the actual request with retries
    const performRequest = (retryCount = 0) => {
      // Validate merchant data first
      const merchantData = merchantIdData[domain];
      if (!merchantData || !merchantData.merchantId) {
        clearTimeout(domainTimeoutId); // Clear the timeout
        return cleanup(`[CheckDomain] No merchantId for ${domain}`);
      }
      if (!merchantData.accessId || !merchantData.accessToken) {
        clearTimeout(domainTimeoutId); // Clear the timeout
        return cleanup(`[CheckDomain] Missing access credentials for ${domain}`);
      }

      // Increase timeout for each retry
      const requestTimeout = 10000 + (retryCount * 2000); // Shorter than our global timeout

      // Prepare the syncData request
      const syncParams = new URLSearchParams({
        module: "/users/syncData",
        merchantId: merchantData.merchantId,
        domainId: "0",
        accessId: merchantData.accessId,
        accessToken: merchantData.accessToken,
        walletIsAdmin: merchantData.walletIsAdmin || ""
      });

      const apiUrl = `https://${domain}/api/v1/index.php`;

      // Add some randomness to prevent rate limiting
      const jitter = Math.floor(Math.random() * 300);

      // Show retry message if this is a retry
      if (retryCount > 0) {
        updateStatusWithColor(
          `[CheckDomain] Retry #${retryCount} for ${domain} (${requestTimeout/1000}s timeout)`,
          'warning'
        );
      }

      setTimeout(() => {
        GM_xmlhttpRequest({
          method: "POST",
          url: apiUrl,
          headers: {
            "Accept": "*/*",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0"
          },
          data: syncParams.toString(),
          timeout: requestTimeout,
          onload: function(response) {
            activeChecks.delete(domain);

            // Specifically handle 502 Bad Gateway errors with retries
            if (response.status === 502) {
              if (retryCount < 2) {  // Allow up to 2 retries for 502 errors
                const waitTime = 1000 + (retryCount * 1000) + Math.floor(Math.random() * 1000);
                updateStatusWithColor(
                  `[CheckDomain] Got HTTP 502 for ${domain}, retrying in ${waitTime/1000}s...`,
                  'warning'
                );
                setTimeout(() => performRequest(retryCount + 1), waitTime);
                return;
              } else {
                clearTimeout(domainTimeoutId); // Clear the timeout
                return cleanup(
                  `[CheckDomain] HTTP 502 error for ${domain} after ${retryCount} retries`,
                  { statusText: response.statusText }
                );
              }
            }

            // Handle other 5xx server errors
            if (response.status >= 500 && response.status !== 502) {
              if (retryCount < 1) {  // Allow 1 retry for other 5xx errors
                const waitTime = 1500 + (retryCount * 1500) + Math.floor(Math.random() * 500);
                updateStatusWithColor(
                  `[CheckDomain] Got HTTP ${response.status} for ${domain}, retrying in ${waitTime/1000}s...`,
                  'warning'
                );
                setTimeout(() => performRequest(retryCount + 1), waitTime);
                return;
              }
            }

            // Immediately check for error patterns
            if (response.responseText && (
                response.responseText.includes('HEADERS_RECEIVED') ||
                response.responseText.includes('LOADING') ||
                response.responseText.includes('OPENED') ||
                response.responseText.includes('UNSENT') ||
                response.responseText.includes('RESPONSE_TYPE')
            )) {
              if (retryCount < 1) {
                const waitTime = 1200 + (retryCount * 1000);
                updateStatusWithColor(
                  `[CheckDomain] Network error pattern for ${domain}, retrying in ${waitTime/1000}s...`,
                  'warning'
                );
                setTimeout(() => performRequest(retryCount + 1), waitTime);
                return;
              }

              clearTimeout(domainTimeoutId); // Clear the timeout
              return cleanup(
                `[CheckDomain] Network error for ${domain}`,
                { message: response.responseText }
              );
            }

            if (response.status !== 200) {
              clearTimeout(domainTimeoutId); // Clear the timeout
              return cleanup(
                `[CheckDomain] HTTP ${response.status} error for ${domain}`,
                { statusText: response.statusText, responseText: response.responseText }
              );
            }

            let parsed;
            try {
              parsed = JSON.parse(response.responseText);
            } catch (e) {
              // For JSON parse errors, retry once
              if (retryCount < 1) {
                setTimeout(() => performRequest(retryCount + 1), 800);
                return;
              }
              clearTimeout(domainTimeoutId); // Clear the timeout
              return cleanup(`[CheckDomain] JSON parse error for ${domain}`, e);
            }

            if (String(parsed.status).toUpperCase() === "SUCCESS" && parsed.data) {
              try {
                clearTimeout(domainTimeoutId); // Clear the timeout
                const bonusData = filterBonuses(parsed, domain);
                temporaryBonusData[domain] = bonusData;

                // Save the current visibility state before updating UI
                const savedMinimizedCardHidden = GM_getValue("minimizedCardHidden", false);

                // Update UI based on domain
                if (domain === getCurrentDisplayDomain()) {
                  updateCurrentDomainCard();

                  // CRITICAL FIX: After updating the current domain card, enforce the visibility state
                  // This prevents the card from hiding itself after data loads
                  const currentDomainCard = document.getElementById('currentDomainCardContainer');
                  if (currentDomainCard) {
                    if (savedMinimizedCardHidden) {
                      currentDomainCard.style.cssText = "display: none !important;";
                    } else {
                      currentDomainCard.style.cssText = "display: block !important;";
                    }
                  }
                } else {
                  updateBonusDisplay(bonusData, `https://${domain}`);
                }

                lastCapturedDomain = domain;
                lastCapturedBonus = parsed.data;
                renderLastCapturedInfo();
                resolve();
              } catch (e) {
                clearTimeout(domainTimeoutId); // Clear the timeout
                return cleanup(`[CheckDomain] Error processing bonus data for ${domain}`, e);
              }
            } else {
              // Try to extract a detailed server message
              let serverMsg = parsed.message || (parsed.data && parsed.data.Message);
              if (!serverMsg) {
                serverMsg = JSON.stringify(parsed);
              }

              // Handle token errors
              if (serverMsg.toLowerCase().includes("token") || serverMsg.toLowerCase().includes("login")) {
                delete merchantData.accessId;
                delete merchantData.accessToken;
                GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));

                // Retry once with new credentials if we're early in retry count
                if (retryCount < 1) {
                  updateStatusWithColor(
                    `[CheckDomain] Token error for ${domain}, clearing credentials and retrying...`,
                    'warning'
                  );

                  // Try to login again with a delay
                  setTimeout(() => {
                    tryDomainLogin(domain, () => {
                      setTimeout(() => performRequest(retryCount + 1), 1000);
                    });
                  }, 1000);
                  return;
                }
              }

              clearTimeout(domainTimeoutId); // Clear the timeout
              return cleanup(`[CheckDomain] API error for ${domain}: ${serverMsg}`);
            }
          },
          onerror: function(e) {
            // For network errors, retry once
            if (retryCount < 1) {
              const waitTime = 1500 + (retryCount * 1500);
              updateStatusWithColor(
                `[CheckDomain] Network error for ${domain}, retrying in ${waitTime/1000}s...`,
                'warning'
              );
              setTimeout(() => performRequest(retryCount + 1), waitTime);
              return;
            }

            clearTimeout(domainTimeoutId); // Clear the timeout
            return cleanup(`[CheckDomain] Network error for ${domain}`, e);
          },
          ontimeout: function() {
            // For timeouts, retry once with increased timeout
            if (retryCount < 1) {
              const waitTime = 1000 + (retryCount * 1000);
              updateStatusWithColor(
                `[CheckDomain] Request timeout for ${domain}, retrying in ${waitTime/1000}s...`,
                'warning'
              );
              setTimeout(() => performRequest(retryCount + 1), waitTime);
              return;
            }

            clearTimeout(domainTimeoutId); // Clear the timeout
            return cleanup(`[CheckDomain] Request timeout for ${domain}`, { message: `Timeout after ${requestTimeout/1000}s` });
          },
          // The critical part - detect errors as they happen with onreadystatechange
          onreadystatechange: function(state) {
            if (!state) return;

            // Check for error patterns in the response at any state change
            if (state.responseText && (
              state.responseText.includes('HEADERS_RECEIVED') ||
              state.responseText.includes('LOADING') ||
              state.responseText.includes('OPENED') ||
              state.responseText.includes('UNSENT') ||
              state.responseText.includes('RESPONSE_TYPE') ||
              state.responseText.includes('Request Timeout')
            )) {
              // If we're already in a retry, don't cancel yet
              if (retryCount > 0) return;

              // Immediately abort and resolve with error
              activeChecks.delete(domain);

              // Don't set error state yet, just abort and retry
              try {
                state.abort();
              } catch (e) {
                // Ignore abort errors
              }

              // Schedule a retry
              if (retryCount < 1) {
                const waitTime = 800 + (retryCount * 800);
                updateStatusWithColor(
                  `[CheckDomain] Early error pattern for ${domain}, retrying in ${waitTime/1000}s...`,
                  'warning'
                );
                setTimeout(() => performRequest(retryCount + 1), waitTime);
                return;
              }

              clearTimeout(domainTimeoutId); // Clear the timeout
              temporaryBonusData[domain] = {
                error: `[CheckDomain] Network error detected immediately for ${domain}`
              };
              updateBonusDisplay(null, `https://${domain}`, `Network error for ${domain}`);
              updateStatusWithColor(`[CheckDomain] Instant error detection for ${domain}`, 'error');
              resolve();
            }
          }
        });
      }, jitter);  // Add small random delay to avoid simultaneous requests
    };

    // Start the request process
    performRequest(0);
  });
}



    // Minimal stubs for leftover references:
function performSyncRequestWithToken(domain, accessId, accessToken, merchantId, resolve, retryCount = 0) {
  // intentionally minimized
  resolve();
}
function performSyncDataRequest(domain, loginUrl, accessId, accessToken, merchantId, resolve) {
  // intentionally minimized
  resolve();
}
function addNumbersToDomainCards() {
  const results = document.getElementById('resultsArea');
  if (!results) return;
  const cards = Array.from(results.querySelectorAll('.site-card'))
    .filter(card => card.style.display !== 'none');
  cards.forEach((card, index) => {
    let numberBadge = card.querySelector('.card-number');
    if (!numberBadge) {
      numberBadge = document.createElement('div');
      numberBadge.className = 'card-number';
      numberBadge.style.position = 'absolute';
      numberBadge.style.bottom = '2px';
      numberBadge.style.right = '2px';
      numberBadge.style.backgroundColor = '#ff1493';
      numberBadge.style.color = 'white';
      numberBadge.style.borderRadius = '50%';
      numberBadge.style.width = '16px';
      numberBadge.style.height = '16px';
      numberBadge.style.display = 'flex';
      numberBadge.style.alignItems = 'center';
      numberBadge.style.justifyContent = 'center';
      numberBadge.style.fontSize = '10px';
      numberBadge.style.fontWeight = 'bold';
      numberBadge.style.zIndex = '10';
      if (card.style.position !== 'relative') {
        card.style.position = 'relative';
      }
      card.appendChild(numberBadge);
    }
    numberBadge.textContent = (index + 1).toString();
  });
}

    function persistDomainGameMapping() {
    GM_setValue("domainGameMapping", JSON.stringify(domainGameMapping));
}

// --- (5) HANDLE GAME SELECTOR CLICK (CAPTURING THE CSS PATH) ---
// (2) HANDLE GAME SELECTOR CLICK
// (3) HANDLE GAME BUTTON (CLICK THE STORED SELECTOR)
// 3) WAIT FOR ELEMENT HELPER (MutationObserver approach)
function waitForElement(selector, callback) {


    // Already present?
    const found = document.querySelector(selector);
    if (found) {
        requestAnimationFrame(() => callback(found));
        return;
    }
    // Otherwise, observe changes
    const observer = new MutationObserver(() => {
        const elem = document.querySelector(selector);
        if (elem) {
            observer.disconnect();
            requestAnimationFrame(() => callback(elem));
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}

    function waitForGameElement(storedUrl, callback) {
  const interval = setInterval(() => {
    const gameElem = findGameElementByStoredUrl(storedUrl);
    if (gameElem) {
      clearInterval(interval);
      callback(gameElem);
    }
  }, 500);
}
// 4) OPTIONAL: remove any overlays that might block clicks
function removeMasks() {
    // Update the below if your site uses different overlay classes
    const masks = document.querySelectorAll('.mask, .overlay, .modal, .loading-overlay');
    masks.forEach(m => m.remove());
}

// 5) Wait for no more masks. If you only have one or two, you can skip this
function waitForNoMasks(callback) {
    function check() {
        const masksLeft = document.querySelectorAll('.mask, .overlay, .modal, .loading-overlay').length;
        if (masksLeft === 0) {
            callback();
        } else {
            requestAnimationFrame(check);
        }
    }
    check();
}

// 6) FINALLY: THE GAME BUTTON
// Helper: Given the stored image URL, return the gamelist path
function getGamelistPathForProvider(imageUrl) {
    imageUrl = imageUrl.toLowerCase();
    if (imageUrl.includes("jili")) {
        return "/gameList/JILI2/SLOT/0/0";
    } else if (imageUrl.includes("uugth")) {
        return "/gameList/UUS/SLOT/0/0";
    } else if (imageUrl.includes("booongo")) {
        return "/gameList/REDGENN/SLOT/1/0";
    } else if (imageUrl.includes("vpower34")) {
        return "/gameList/VP/SLOT/0/0";
    }
    return null;
}

// Updated Game Button Handler – Uses the current domain dynamically

    // --- (5a) GET ELEMENT CSS PATH HELPER ---
function getElementCSSPath(el) {
    if (!el) return '';
    // If we reach the 'html' element, we’re done
    if (el.tagName.toLowerCase() === 'html') {
        return 'html';
    }
    // Find this element’s index among its siblings
    const index = Array.from(el.parentNode.children).indexOf(el) + 1;
    return (
        getElementCSSPath(el.parentNode) +
        ' > ' +
        el.tagName.toLowerCase() +
        `:nth-of-type(${index})`
    );
}
function enterGameSelectorMode(displayDomain) {
    gameSelectorMode = true;
    domainForGameSelection = displayDomain;
    updateStatusWithColor(
        "Selector mode active. Click on a game icon/link to store it.",
        "info"
    );
}
function hookIntoExistingFunctions() {
  const originalLoadGUIState = window.loadGUIState;
  if (originalLoadGUIState) {
    window.loadGUIState = function() {
      originalLoadGUIState.apply(this, arguments);
      addNumbersToDomainCards();
    };
  }
  const originalSortDomainCards = window.sortDomainCards;
  if (originalSortDomainCards) {
    window.sortDomainCards = function() {
      originalSortDomainCards.apply(this, arguments);
      addNumbersToDomainCards();
    };
  }
  const originalUpdateCurrentDomainCard = window.updateCurrentDomainCard;
  if (originalUpdateCurrentDomainCard) {
    window.updateCurrentDomainCard = function() {
      originalUpdateCurrentDomainCard.apply(this, arguments);
      addNumbersToDomainCards();
    };
  }
  const originalShowValidBonuses = window.showValidBonuses;
  if (originalShowValidBonuses) {
    window.showValidBonuses = function() {
      originalShowValidBonuses.apply(this, arguments);
      addNumbersToDomainCards();
    };
  }
  const originalShowCurrentDomainOnly = window.showCurrentDomainOnly;
  if (originalShowCurrentDomainOnly) {
    window.showCurrentDomainOnly = function() {
      originalShowCurrentDomainOnly.apply(this, arguments);
      addNumbersToDomainCards();
    };
  }
  const originalShowCachedBonuses = window.showCachedBonuses;
  if (originalShowCachedBonuses) {
    window.showCachedBonuses = function() {
      originalShowCachedBonuses.apply(this, arguments);
      addNumbersToDomainCards();
    };
  }
  setInterval(addNumbersToDomainCards, 2000);
}

function initializeNumbering() {
  const style = document.createElement('style');
  style.textContent = `
    .site-card { position: relative; }
    .card-number {
      position: absolute;
      bottom: 2px;
      right: 2px;
      background-color: #ff1493;
      color: white;
      border-radius: 50%;
      width: 16px;
      height: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: bold;
      z-index: 10;
    }
  `;
  document.head.appendChild(style);
  addNumbersToDomainCards();
  hookIntoExistingFunctions();
}
if (document.readyState === "complete" || document.readyState === "interactive") {
  setTimeout(initializeNumbering, 500);
} else {
  document.addEventListener("DOMContentLoaded", function() {
    setTimeout(initializeNumbering, 500);
  });
}
setTimeout(initializeNumbering, 1000);
// Call this function on load and on every viewport change.
// Function to adjust layout based on visual viewport and GUI height
// --- Dynamic Layout Adjustment Setup ---
// (These functions are defined in your script already)

function makeSquareFaviconsWider() {
  const style = document.createElement('style');
  style.id = 'wider-favicon-squares-style';
  style.textContent = `
    .favicon-square {
      width: 40px !important;
      max-width: 40px !important;
      right: 0 !important;
      height: 100% !important;
      z-index: 5 !important;
    }
    .site-card {
      padding-right: 42px !important;
    }
    .favicon-square img {
      width: 90% !important;
      height: 90% !important;
      margin: 5% !important;
      object-fit: contain !important;
    }
    .card-number {
      right: 42px !important;
    }
  `;
  const existingStyle = document.getElementById('wider-favicon-squares-style');
  if (existingStyle) {
    existingStyle.remove();
  }
  document.head.appendChild(style);
  const faviconSquares = document.querySelectorAll('.favicon-square');
  faviconSquares.forEach(square => {
    square.style.width = '40px';
    square.style.maxWidth = '40px';
    square.style.height = '100%';
    const img = square.querySelector('img');
    if (img) {
      img.style.width = '90%';
      img.style.height = '90%';
      img.style.margin = '5%';
    }
  });
  const cards = document.querySelectorAll('.site-card');
  cards.forEach(card => {
    card.style.paddingRight = '42px';
  });
}
makeSquareFaviconsWider();
['loadGUIState','sortDomainCards','updateCurrentDomainCard','addFaviconsToDomainCards'].forEach(funcName => {
  if (window[funcName]) {
    const original = window[funcName];
    window[funcName] = function() {
      const ret = original.apply(this, arguments);
      setTimeout(makeSquareFaviconsWider, 100);
      return ret;
    };
  }
});
setInterval(makeSquareFaviconsWider, 3000);

    function downloadFile(content, filename, mimeType) {
    mimeType = mimeType || "application/octet-stream";
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.style.display = "none";
    a.href = url;
    a.download = filename;

    // Append anchor to body
    document.body.appendChild(a);

    // For iOS Safari: if download attribute isn’t supported, open in new tab
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (isIOS) {
        window.open(url, "_blank");
    } else {
        a.click();
    }

    // Clean up
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
}
    function exportReferLinks() {
  updateStatusWithColor("Fetching refer links...", "info");

  // Create the modal overlay
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.id = 'referLinksOverlay';
  overlay.style.display = 'flex';
  overlay.style.justifyContent = 'center';
  overlay.style.alignItems = 'center';
  overlay.classList.add('active');

  // Create the modal content
  const modal = document.createElement('div');
  modal.className = 'url-modal';
  modal.id = 'referLinksModal';
  modal.style.maxWidth = '800px';
  modal.style.width = '90%';

  // Add a loading indicator inside the modal with enhanced UI
  modal.innerHTML = `
    <h3 style="color: #ff1493; margin-top: 0; margin-bottom: 15px; text-align: center;">
      Refer Links Exporter
    </h3>
    <div id="referLinksLoadingIndicator" style="text-align: center; padding: 20px;">
      <div style="color: #fff; margin-bottom: 10px; font-size: 14px;">
        Fetching refer links from ${domainList.length} domains...
      </div>
      <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
        <span style="color: #aaa; font-size: 12px;">Progress:</span>
        <span id="referLinksProgressText" style="color: #aaa; font-size: 12px;">
          0/${domainList.length} (0%)
        </span>
      </div>
      <div style="height: 8px; background: #333; border-radius: 4px; overflow: hidden; margin-bottom: 15px;">
        <div id="referLinksProgressBar" style="height: 100%; background: linear-gradient(90deg, #ff1493, #ff69b4); width: 0%; transition: width 0.3s ease;"></div>
      </div>

      <div style="display: flex; justify-content: space-between; text-align: center; margin-top: 15px;">
        <div style="flex: 1;">
          <div id="totalDomainsCounter" style="font-size: 22px; font-weight: bold; color: #ff1493;">0</div>
          <div style="font-size: 12px; color: #aaa;">Total Domains</div>
        </div>
        <div style="flex: 1;">
          <div id="successCounter" style="font-size: 22px; font-weight: bold; color: #4CAF50;">0</div>
          <div style="font-size: 12px; color: #aaa;">Successful</div>
        </div>
        <div style="flex: 1;">
          <div id="errorCounter" style="font-size: 22px; font-weight: bold; color: #f44336;">0</div>
          <div style="font-size: 12px; color: #aaa;">Errors</div>
        </div>
      </div>
    </div>

    <div id="referLinksContent" style="display: none;">
      <div id="referLinksStats" style="background: rgba(255,20,147,0.1); padding: 10px; border-radius: 4px; margin-bottom: 10px;">
        <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
          <div><strong>Total Domains:</strong> <span id="stats-total">0</span></div>
          <div><strong>Successful:</strong> <span id="stats-success" style="color: #4CAF50;">0</span></div>
          <div><strong>Errors:</strong> <span id="stats-errors" style="color: #f44336;">0</span></div>
        </div>
        <div id="errorDomainsCollapse" style="font-size: 12px; color: #f44336; cursor: pointer; margin-top: 5px; display: none;">
          ▶ Show domains with errors
        </div>
        <div id="errorDomainsList" style="display: none; max-height: 80px; overflow-y: auto; margin-top: 5px; font-size: 12px; color: #888; background: rgba(0,0,0,0.2); padding: 5px; border-radius: 3px;">
        </div>
      </div>

      <div style="display: flex; margin-bottom: 10px; gap: 10px;">
        <div style="flex: 1;">
          <label for="linkFilterInput" style="color: #fff; display: block; margin-bottom: 5px; font-size: 12px;">Filter Links:</label>
          <input type="text" id="linkFilterInput" placeholder="Type to filter..." style="width: 100%; background: #111; color: #fff; border: 1px solid var(--mainBorder); padding: 6px; border-radius: 3px;">
        </div>
        <div>
          <label for="linkDisplayOptions" style="color: #fff; display: block; margin-bottom: 5px; font-size: 12px;">Display Format:</label>
          <select id="linkDisplayOptions" style="background: #111; color: #fff; border: 1px solid var(--mainBorder); padding: 6px; border-radius: 3px;">
            <option value="links-only">Full Links</option>
            <option value="no-https">Links without https://</option>
          </select>
        </div>
      </div>

      <textarea id="referLinksTextarea" class="url-textarea"
                style="height: 250px; font-family: monospace; margin-bottom: 10px; white-space: pre; overflow-wrap: normal; overflow-x: auto;"
                readonly></textarea>

      <div style="display: flex; justify-content: space-between; gap: 10px; margin-top: 15px;">
        <button id="copyReferLinksBtn" class="control-btn">Copy to Clipboard</button>
        <button id="downloadReferLinksBtn" class="control-btn">Download as CSV</button>
        <button id="closeReferLinksBtn" class="control-btn">Close</button>
      </div>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Setup close button
  document.getElementById('closeReferLinksBtn').addEventListener('click', function() {
    overlay.remove();
  });

  // Setup click handler for the overlay background
  overlay.addEventListener('click', function(e) {
    if (e.target === overlay) {
      overlay.remove();
    }
  });

  // Initialize counters
  const totalDomainsCounter = document.getElementById('totalDomainsCounter');
  const successCounter = document.getElementById('successCounter');
  const errorCounter = document.getElementById('errorCounter');
  totalDomainsCounter.textContent = domainList.length;

  // Improved fetchReferLinkForDomain function with better error handling and retries
  function fetchReferLinkWithRetry(domain, retryCount = 0) {
    return new Promise((resolve) => {
      const maxRetries = 2; // Maximum number of retries per domain

      // If we've exceeded max retries, resolve with an error
      if (retryCount > maxRetries) {
        return resolve({
          domain,
          referLink: null,
          reason: `Failed after ${maxRetries} retries`
        });
      }

      // Try to fetch with a longer timeout for stability
      const timeout = 15000 + (retryCount * 5000); // Increase timeout on each retry

      // Check if we have cached merchant data
      const domainData = merchantIdData[domain];
      if (!domainData) {
        return resolve({
          domain,
          referLink: null,
          reason: "No merchantIdData for this domain"
        });
      }

      // Extract needed fields
      const { merchantId, accessId, accessToken, domainId, walletIsAdmin } = domainData || {};
      if (!merchantId) {
        return resolve({
          domain,
          referLink: null,
          reason: "No merchantId in domainData"
        });
      }

      // Build the POST data with more resilient parameters
      const syncParams = new URLSearchParams({
        module: "/users/syncData",
        merchantId: merchantId,
        domainId: domainId || "0",
        accessId: accessId || "",
        accessToken: accessToken || "",
        walletIsAdmin: walletIsAdmin || ""
      });

      GM_xmlhttpRequest({
        method: "POST",
        url: `https://${domain}/api/v1/index.php`,
        headers: {
          "Accept": "*/*",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
        },
        data: syncParams.toString(),
        timeout: timeout,
        onload: function(response) {
          // Handle HTTP status errors with retry logic
          if (response.status >= 500) {
            // Server error - try again
            setTimeout(() => {
              resolve(fetchReferLinkWithRetry(domain, retryCount + 1));
            }, 1000); // Wait 1 second before retry
            return;
          }

          if (response.status !== 200) {
            return resolve({
              domain,
              referLink: null,
              reason: `HTTP ${response.status}`
            });
          }

          try {
            const json = JSON.parse(response.responseText);

            // Check for a successful response
            if (json.status !== "SUCCESS") {
              const msg = json.message || json.status || "Unknown";

              // If token errors, try to login again and retry
              if (msg.toLowerCase().includes("token") && retryCount < maxRetries) {
                // Wait a bit and retry with refreshed token
                setTimeout(() => {
                  tryDomainLogin(domain);
                  setTimeout(() => {
                    resolve(fetchReferLinkWithRetry(domain, retryCount + 1));
                  }, 2000);
                }, 1000);
                return;
              }

              return resolve({
                domain,
                referLink: null,
                reason: `API: ${msg}`
              });
            }

            // Extract referLink from response data
            const referLink = (json.data && json.data.referLink) || "";
            if (!referLink) {
              return resolve({
                domain,
                referLink: null,
                reason: "No referLink in JSON"
              });
            }

            resolve({ domain, referLink, reason: "" });
          } catch (err) {
            // Retry on parse errors
            if (retryCount < maxRetries) {
              setTimeout(() => {
                resolve(fetchReferLinkWithRetry(domain, retryCount + 1));
              }, 1000);
              return;
            }

            resolve({
              domain,
              referLink: null,
              reason: `Parse error: ${err.message}`
            });
          }
        },
        onerror: function() {
          // Network error - retry
          if (retryCount < maxRetries) {
            setTimeout(() => {
              resolve(fetchReferLinkWithRetry(domain, retryCount + 1));
            }, 1500);
            return;
          }

          resolve({
            domain,
            referLink: null,
            reason: "Network error after retries"
          });
        },
        ontimeout: function() {
          // Timeout - retry with increased timeout
          if (retryCount < maxRetries) {
            setTimeout(() => {
              resolve(fetchReferLinkWithRetry(domain, retryCount + 1));
            }, 1500);
            return;
          }

          resolve({
            domain,
            referLink: null,
            reason: "Request timeout after retries"
          });
        }
      });
    });
  }

  // Process all domains concurrently
  let fetchedCount = 0;
  let successCount = 0;
  let errorCount = 0;
  let referLinksData = [];
  let errorDomains = [];

  const progressBar = document.getElementById('referLinksProgressBar');
  const progressText = document.getElementById('referLinksProgressText');

  // Use Promise.all to process all domains concurrently
  const allPromises = domainList.map(domain => {
    return fetchReferLinkWithRetry(domain)
      .then(result => {
        // Update counters and UI as each promise resolves
        fetchedCount++;

        if (result.referLink) {
          successCount++;
          successCounter.textContent = successCount;
        } else {
          errorCount++;
          errorCounter.textContent = errorCount;
          errorDomains.push({
            domain: result.domain,
            reason: result.reason || "Unknown error"
          });
        }

        // Add to results array
        referLinksData.push(result);

        // Update progress UI
        const percent = Math.min(100, Math.round((fetchedCount / domainList.length) * 100));
        progressBar.style.width = `${percent}%`;
        progressText.textContent = `${fetchedCount}/${domainList.length} (${percent}%)`;

        return result;
      });
  });

  // When all promises are resolved, display the results
  Promise.all(allPromises)
    .then(() => {
      displayResults();
    })
    .catch(error => {
      console.error("Error processing domains:", error);
      // Still display results with what we have
      displayResults();
    });

  function displayResults() {
    // Update final stats
    document.getElementById('stats-total').textContent = domainList.length;
    document.getElementById('stats-success').textContent = successCount;
    document.getElementById('stats-errors').textContent = errorCount;

    // Show error domains if any
    if (errorDomains.length > 0) {
      const errorDomainsCollapse = document.getElementById('errorDomainsCollapse');
      const errorDomainsList = document.getElementById('errorDomainsList');

      errorDomainsCollapse.style.display = 'block';
      errorDomainsCollapse.textContent = `▶ Show ${errorDomains.length} domains with errors`;

      let errorDomainsHTML = '';
      errorDomains.forEach(item => {
        errorDomainsHTML += `<div>${item.domain}: ${item.reason}</div>`;
      });
      errorDomainsList.innerHTML = errorDomainsHTML;

      // Setup toggle for error domains list
      errorDomainsCollapse.addEventListener('click', function() {
        if (errorDomainsList.style.display === 'none') {
          errorDomainsList.style.display = 'block';
          errorDomainsCollapse.textContent = `▼ Hide ${errorDomains.length} domains with errors`;
        } else {
          errorDomainsList.style.display = 'none';
          errorDomainsCollapse.textContent = `▶ Show ${errorDomains.length} domains with errors`;
        }
      });
    }

    // Filter to only include successful referLinks
    const validLinks = referLinksData.filter(item => item.referLink);

    // Sort data by domain name
    validLinks.sort((a, b) => a.domain.localeCompare(b.domain));

    // Function to format links based on selected display option
    function formatLinks(option) {
      let formattedText = '';

      validLinks.forEach(item => {
        const { referLink } = item;

        switch(option) {
          case 'links-only':
            formattedText += `${referLink}\n`;
            break;
          case 'no-https':
            // Remove https:// or http:// from the links
            const cleanLink = referLink.replace(/^https?:\/\//, '');
            formattedText += `${cleanLink}\n`;
            break;
          default:
            formattedText += `${referLink}\n`;
        }
      });

      return formattedText;
    }

    // Function to apply filter
    function applyFilter(filterText) {
      const filteredLinks = filterText ?
        validLinks.filter(item =>
          item.domain.toLowerCase().includes(filterText.toLowerCase()) ||
          item.referLink.toLowerCase().includes(filterText.toLowerCase())
        ) : validLinks;

      // Get current display option
      const displayOption = document.getElementById('linkDisplayOptions').value;

      // Format the filtered links
      let formattedText = '';
      filteredLinks.forEach(item => {
        const { referLink } = item;

        switch(displayOption) {
          case 'links-only':
            formattedText += `${referLink}\n`;
            break;
          case 'no-https':
            // Remove https:// or http:// from the links
            const cleanLink = referLink.replace(/^https?:\/\//, '');
            formattedText += `${cleanLink}\n`;
            break;
          default:
            formattedText += `${referLink}\n`;
        }
      });

      // Update the textarea
      document.getElementById('referLinksTextarea').value = formattedText;
    }

    // Hide loading indicator and show content
    document.getElementById('referLinksLoadingIndicator').style.display = 'none';
    document.getElementById('referLinksContent').style.display = 'block';

    // Set initial content
    const textarea = document.getElementById('referLinksTextarea');
    textarea.value = formatLinks('links-only');

    // Setup format selector change handler
    const formatSelector = document.getElementById('linkDisplayOptions');
    formatSelector.addEventListener('change', function() {
      // Get current filter text
      const filterText = document.getElementById('linkFilterInput').value;

      // Apply filter with new format
      applyFilter(filterText);
    });

    // Setup filter input
    const filterInput = document.getElementById('linkFilterInput');
    filterInput.addEventListener('input', function() {
      applyFilter(this.value);
    });

    // Setup buttons
    const copyBtn = document.getElementById('copyReferLinksBtn');
    copyBtn.addEventListener('click', function() {
      textarea.select();
      document.execCommand('copy');
      updateStatusWithColor("Refer links copied to clipboard!", "success");
      // Provide visual feedback
      this.textContent = "✓ Copied!";
      setTimeout(() => {
        this.textContent = "Copy to Clipboard";
      }, 2000);
    });

    const downloadBtn = document.getElementById('downloadReferLinksBtn');
    downloadBtn.addEventListener('click', function() {
      // Create CSV content
      let csvContent = "Domain,ReferLink,Issue\n";
      referLinksData.forEach(item => {
        const { domain, referLink, reason } = item;
        const safeReason = reason ? reason.replace(/"/g, "'") : "";
        csvContent += `"${domain}","${referLink || ""}","${safeReason}"\n`;
      });

      downloadFile(csvContent, "refer_links.csv", "text/csv");
      updateStatusWithColor("Refer links CSV downloaded.", "success");
    });

    // Final status update
    updateStatusWithColor(`Found ${validLinks.length} valid refer links out of ${domainList.length} domains.`, "success");
  }
}
    function fetchReferLinkForDomain(domain) {
  return new Promise((resolve) => {
    // 1) Check if we have merchant data
    const domainData = merchantIdData[domain];
    if (!domainData) {
      updateStatusWithColor(`[fetchReferLink] ${domain}: No merchantIdData found`, "error");
      return resolve({
        domain,
        referLink: null,
        reason: "No merchantIdData for this domain"
      });
    }

    // 2) Extract needed fields
    const { merchantId, accessId, accessToken, domainId, walletIsAdmin } = domainData || {};
    if (!merchantId) {
      updateStatusWithColor(`[fetchReferLink] ${domain}: Missing merchantId`, "error");
      return resolve({
        domain,
        referLink: null,
        reason: "No merchantId in domainData"
      });
    }

    // 3) Build the POST data
    const syncParams = new URLSearchParams({
      module: "/users/syncData",
      merchantId: merchantId,
      domainId: domainId || "0",
      accessId: accessId || "",
      accessToken: accessToken || "",
      walletIsAdmin: walletIsAdmin || ""
    });

    // 4) Show what we’re about to send
    updateStatusWithColor(
      `[fetchReferLink] ${domain} => sending: ${syncParams.toString()}`,
      "info"
    );

    // 5) Make the request
    GM_xmlhttpRequest({
      method: "POST",
      url: `https://${domain}/api/v1/index.php`,
      headers: {
        "Accept": "*/*",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
      },
      data: syncParams.toString(),
      timeout: 15000,
      onload: function(response) {
        // 6) Check HTTP status
        if (response.status !== 200) {
          updateStatusWithColor(
            `[fetchReferLink] ${domain}: HTTP ${response.status} error`,
            "error"
          );
          return resolve({
            domain,
            referLink: null,
            reason: `HTTP ${response.status}`
          });
        }

        // Removed the full-response logging line

        try {
          const json = JSON.parse(response.responseText);

          // 😎 Check for a successful response
          if (json.status !== "SUCCESS") {
            const msg = json.message || json.status || "Unknown";
            updateStatusWithColor(`[fetchReferLink] ${domain}: ${msg}`, "error");
            return resolve({
              domain,
              referLink: null,
              reason: `API: ${msg}`
            });
          }

          // 9) Extract referLink from response data
          const referLink = (json.data && json.data.referLink) || "";
          if (!referLink) {
            updateStatusWithColor(`[fetchReferLink] ${domain}: No referLink found`, "error");
            return resolve({
              domain,
              referLink: null,
              reason: "No referLink in JSON"
            });
          }

          // 10) Success: resolve with the referLink
          updateStatusWithColor(`[fetchReferLink] ${domain}: referLink = ${referLink}`, "success");
          resolve({ domain, referLink, reason: "" });
        } catch (err) {
          updateStatusWithColor(
            `[fetchReferLink] ${domain}: JSON parse error => ${err.message}`,
            "error"
          );
          resolve({
            domain,
            referLink: null,
            reason: `Parse error: ${err.message}`
          });
        }
      },
      onerror: function() {
        updateStatusWithColor(`[fetchReferLink] ${domain}: onerror`, "error");
        resolve({ domain, referLink: null, reason: "Network onerror" });
      },
      ontimeout: function() {
        updateStatusWithColor(`[fetchReferLink] ${domain}: request timed out`, "error");
        resolve({ domain, referLink: null, reason: "Timeout" });
      }
    });
  });
}
   // Function to fetch the referLink from one domain using the same syncData request as your bonus fetch
function fetchSingleReferLinkForDomain(domain) {
  return new Promise((resolve) => {
    updateStatusWithColor(`[SingleRefLink] Checking ${domain}`, "info");

    const domainData = merchantIdData[domain];
    if (!domainData) {
      updateStatusWithColor(`[SingleRefLink] ${domain} => No merchantIdData found`, "error");
      return resolve({
        domain,
        referLink: null,
        rawResponse: "",
        error: "No merchantIdData"
      });
    }

    const { merchantId, accessId, accessToken, domainId, walletIsAdmin } = domainData;
    if (!merchantId) {
      updateStatusWithColor(`[SingleRefLink] ${domain} => Missing merchantId`, "error");
      return resolve({
        domain,
        referLink: null,
        rawResponse: "",
        error: "Missing merchantId"
      });
    }

    // Build the POST data exactly as in your working bonus fetch
    const syncParams = new URLSearchParams({
      module: "/users/syncData",
      merchantId: merchantId,
      domainId: domainId || "0",
      accessId: accessId || "",
      accessToken: accessToken || "",
      walletIsAdmin: walletIsAdmin || ""
    });

    GM_xmlhttpRequest({
      method: "POST",
      url: `https://${domain}/api/v1/index.php`,
      headers: {
        "Accept": "*/*",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
      },
      data: syncParams.toString(),
      timeout: 10000,
      onload: function(response) {
        if (response.status !== 200) {
          updateStatusWithColor(`[SingleRefLink] ${domain} => HTTP ${response.status}`, "error");
          return resolve({
            domain,
            referLink: null,
            rawResponse: response.responseText || "",
            error: `HTTP ${response.status}`
          });
        }
        try {
          const json = JSON.parse(response.responseText);
          if (json.status !== "SUCCESS") {
            const msg = json.message || json.status || "Unknown error";
            updateStatusWithColor(`[SingleRefLink] ${domain} => ${msg}`, "error");
            return resolve({
              domain,
              referLink: null,
              rawResponse: response.responseText,
              error: msg
            });
          }
          // Expect referLink at top level
          const referLink = (json.data && json.data.referLink) || "";
          if (!referLink) {
            updateStatusWithColor(`[SingleRefLink] ${domain} => No referLink found`, "error");
            return resolve({
              domain,
              referLink: null,
              rawResponse: response.responseText,
              error: "No referLink in JSON"
            });
          }
          updateStatusWithColor(`[SingleRefLink] ${domain} => ReferLink found`, "success");
          resolve({
            domain,
            referLink,
            rawResponse: response.responseText,
            error: ""
          });
        } catch (err) {
          updateStatusWithColor(`[SingleRefLink] ${domain} => Parse error`, "error");
          resolve({
            domain,
            referLink: null,
            rawResponse: response.responseText,
            error: `Parse error: ${err.message}`
          });
        }
      },
      onerror: function() {
        updateStatusWithColor(`[SingleRefLink] ${domain} => Request error`, "error");
        resolve({
          domain,
          referLink: null,
          rawResponse: "",
          error: "Network error"
        });
      },
      ontimeout: function() {
        updateStatusWithColor(`[SingleRefLink] ${domain} => Request timed out`, "error");
        resolve({
          domain,
          referLink: null,
          rawResponse: "",
          error: "Timeout"
        });
      }
    });
  });
}

// Function to export a CSV for one domain, including raw server response and any error message
function exportSingleReferLinkResponse(domain) {
  updateStatusWithColor(`Exporting referLink for ${domain}...`, "info");
  fetchSingleReferLinkForDomain(domain)
    .then(result => {
      // Build a CSV with four columns: Domain, ReferLink, Error, RawResponse
      let csv = "Domain,ReferLink,Error,RawResponse\n";
      const safeResponse = result.rawResponse
        ? result.rawResponse.replace(/"/g, "'")
        : "";
      csv += `"${result.domain}","${result.referLink || ""}","${result.error || ""}","${safeResponse}"\n`;
      downloadFile(csv, `single_referlink_${domain}.csv`, "text/csv");
      updateStatusWithColor(`Export complete for ${domain}.`, "success");
    })
    .catch(err => {
      updateStatusWithColor(`Export error: ${err.message}`, "error");
    });
}

// Update the export button to use the single-domain export function
function addExportButtonRow() {
  const headerControls = document.querySelector('.header-controls');
  if (!headerControls) return;
  const row = document.createElement('div');
  row.className = 'header-row';
  row.innerHTML = `<button id="exportReferLinksBtn" class="control-btn">Export Single Refer Link</button>`;
  headerControls.appendChild(row);
  const exportBtn = document.getElementById('exportReferLinksBtn');
  if (exportBtn) {
    exportBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      // Export for the current display domain
      const currentDomain = getCurrentDisplayDomain();
      exportSingleReferLinkResponse(currentDomain);
    });
  }
}

// Update the export button to use the single-domain export function

function hookCompactCards() {
  window.addEventListener('resize', makeCardsMoreCompact);
  const fns = [
    'loadGUIState','sortDomainCards','updateCurrentDomainCard',
    'showValidBonuses','showCurrentDomainOnly','showCachedBonuses',
    'fetchFreshBonusData'
  ];
  fns.forEach(funcName => {
    if (window[funcName]) {
      const originalFunc = window[funcName];
      window[funcName] = function() {
        const result = originalFunc.apply(this, arguments);
        setTimeout(makeCardsMoreCompact, 100);
        return result;
      };
    }
  });
}
function makeCardsMoreCompact() {
  const style = document.createElement('style');
  style.id = 'compact-cards-style';
  style.textContent = `
    .site-card {
      padding: 1px !important;
      margin-bottom: 1px !important;
      font-size: 9px !important;
      line-height: 1 !important;
    }
    .site-card .top-row,.site-card .bottom-row {
      gap: 0 !important;
      margin-bottom: 0 !important;
    }
    .site-card .top-row>div,.site-card .bottom-row>div {
      padding: 0 !important;
      font-size: 9px !important;
    }
    .site-card .control-btn {
      padding: 1px 2px !important;
      font-size: 8px !important;
      margin-top: 1px !important;
    }
    .claim-btn {
      height: auto !important;
      line-height: 1 !important;
      margin-top: 1px !important;
    }
    .favicon-square {
      max-width: 20px !important;
    }
    .card-number {
      width: 12px !important;
      height: 12px !important;
      font-size: 8px !important;
    }
    .current-domain-card {
      padding: 2px !important;
      font-size: 10px !important;
    }
    .site-card {
      padding-right: 22px !important;
    }
  `;
  const existingStyle = document.getElementById('compact-cards-style');
  if (existingStyle) existingStyle.remove();
  document.head.appendChild(style);

  const cards = document.querySelectorAll('.site-card');
  cards.forEach(card => {
    const faviconSquare = card.querySelector('.favicon-square');
    if (faviconSquare) {
      faviconSquare.style.maxWidth = '20px';
    }
    card.style.paddingRight = '22px';
  });
}
makeCardsMoreCompact();
hookCompactCards();

class BulkDataProcessor {
  constructor(options={}) {
    this.batchSize = options.batchSize || 100;
    this.timeout = options.timeout || 4500;
    this.maxRetries = options.maxRetries || 2;
    this.retryDelay = options.retryDelay || 500;
    this.processedDomains = new Set();
    this.inProgress = false;
    this.abortController = null;
  }
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
      const batches = [];
      for (let i = 0; i < domains.length; i += this.batchSize) {
        batches.push(domains.slice(i, i + this.batchSize));
      }
      updateStatus(`Processing ${domains.length} domains in ${batches.length} batches`,true);
      let processedCount = 0;
      let errorCount = 0;
      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        if (signal.aborted) break;
        const batch = batches[batchIndex];
        updateStatus(`Processing batch ${batchIndex+1}/${batches.length} (${batch.length} domains)`,true);
        const batchResults = await Promise.allSettled(
          batch.map(domain => this._processWithTimeout(domain, processDomain, signal))
        );
        batchResults.forEach(result => {
          processedCount++;
          if (result.status === 'rejected') {
            errorCount++;
          } else {
            this.processedDomains.add(result.value.domain);
          }
        });
        if (onProgress) {
          onProgress(processedCount, domains.length, errorCount);
        }
      }
      updateStatus(`Completed processing ${processedCount} domains (${errorCount} errors)`,true);
      if (onComplete) {
        onComplete(this.processedDomains, errorCount);
      }
    } catch (error) {
      updateStatus(`Bulk processing error: ${error.message}`, false);
    } finally {
      this.inProgress = false;
      this.abortController = null;
    }
  }
  abort() {
    if (this.abortController) {
      this.abortController.abort();
      this.inProgress = false;
      return true;
    }
    return false;
  }
  _processWithTimeout(domain, processDomain, signal) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`Timeout processing domain: ${domain}`));
      }, this.timeout);
      processDomain(domain, signal)
        .then(result => {
          clearTimeout(timeoutId);
          resolve({ domain, result });
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }
}

class BonusDataCache {
  constructor() {
    this.memoryCache = {};
    this.lastCacheTime = Date.now();
    this.cacheLifetime = 30*60*1000;
  }
  initialize() {
    try {
      const cachedData = GM_getValue("cached_bonus_data","{}");
      const cacheTime = parseInt(GM_getValue("cached_bonus_timestamp","0"));
      this.memoryCache = JSON.parse(cachedData);
      this.lastCacheTime = cacheTime || Date.now();
      return true;
    } catch(e) {
      this.memoryCache = {};
      this.lastCacheTime = Date.now();
      return false;
    }
  }
  getDomain(domain) {
    return this.memoryCache[domain] || null;
  }
  storeDomain(domain, data) {
    if (!domain||!data) return false;
    this.memoryCache[domain] = data;
    return true;
  }
  persistCache() {
    try {
      GM_setValue("cached_bonus_data", JSON.stringify(this.memoryCache));
      GM_setValue("cached_bonus_timestamp", Date.now().toString());
      this.lastCacheTime = Date.now();
      return true;
    } catch(e) {
      return false;
    }
  }
  isExpired() {
    return (Date.now()-this.lastCacheTime)>this.cacheLifetime;
  }
  getMatchingDomains(filterFn) {
    const result=[];
    for(const domain in this.memoryCache) {
      const data=this.memoryCache[domain];
      if(filterFn(data,domain)) result.push(domain);
    }
    return result;
  }
  clearDomains(domains) {
    if(!domains||!domains.length) return 0;
    let cleared=0;
    domains.forEach(domain=>{
      if(this.memoryCache[domain]) {
        delete this.memoryCache[domain];
        cleared++;
      }
    });
    if(cleared>0)this.persistCache();
    return cleared;
  }
}

const bonusDataCache = new BonusDataCache();
const bulkProcessor = new BulkDataProcessor({batchSize:100,timeout:5000,maxRetries:2,retryDelay:500});

function initializeEnhancedSystems() {
  bonusDataCache.initialize();
  for(const domain in bonusDataCache.memoryCache){
    if(!temporaryBonusData[domain]){
      temporaryBonusData[domain]=bonusDataCache.memoryCache[domain];
    }
  }
}
document.addEventListener('DOMContentLoaded',initializeEnhancedSystems);

function showHighValueBonuses(minAmount=5) {
  const cards=document.querySelectorAll('.site-card');
  let count=0;
  cards.forEach(card=>{
    const domain=card.getAttribute('data-domain');
    if(!domain)return;
    const bonusData=temporaryBonusData[domain];
    const hasHighValue= bonusData && (
      (bonusData.commission && bonusData.commission.amount>=minAmount) ||
      (bonusData.share && bonusData.share.amount>=minAmount) ||
      (bonusData.referral && bonusData.referral.amount>=minAmount)
    );
    if(hasHighValue || card.classList.contains('current-domain-card')){
      card.style.display='block';
      count++;
    }else{
      card.style.display='none';
    }
  });
  sortDomainCards();
  updateStatusWithColor(`Showing ${count} site(s) with bonuses ≥${minAmount}.`,true);
}

// XHR interception for capturing merchant ID:
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
    let isApiRequest =
      xhr._url.includes("/api/v1/index.php") &&
      requestBody &&
      (requestBody.includes("merchantId=") || requestBody.includes("module="));
    if (isApiRequest) {
      try {
        let merchantId = null;
        try {
          let params = new URLSearchParams(requestBody);
          merchantId = params.get("merchantId");
          const accessId = params.get("accessId");
          const accessToken = params.get("accessToken");
          const domainId = params.get("domainId");
          const walletIsAdmin = params.get("walletIsAdmin");
          if (accessId && accessToken) {
            xhr._accessId = accessId;
            xhr._accessToken = accessToken;
            xhr._domainId = domainId;
            xhr._walletIsAdmin = walletIsAdmin;
          }
        } catch (e) {}
        if (!merchantId) {
          const merchantIdRegex = /merchantId=([^&]+)/;
          const match = requestBody.match(merchantIdRegex);
          if (match && match[1]) merchantId = decodeURIComponent(match[1]);
        }
        const currentDomain = extractBaseDomain(window.location.href);
        if (currentDomain && domainList.includes(currentDomain)) {
          // Only capture the merchantId if not already stored
          if (
            merchantIdData[currentDomain] &&
            merchantIdData[currentDomain].merchantId &&
            merchantIdData[currentDomain].merchantId.trim() !== ""
          ) {
            // Already have a valid merchantId—do nothing.
          } else {
            if (merchantId && merchantId !== "undefined" && merchantId !== "") {
              merchantIdData[currentDomain] = {
                merchantId: merchantId,
                capturedAt: new Date().toISOString()
              };
              if (xhr._accessId && xhr._accessToken) {
                merchantIdData[currentDomain].accessId = xhr._accessId;
                merchantIdData[currentDomain].accessToken = xhr._accessToken;
                merchantIdData[currentDomain].domainId = xhr._domainId || "0";
                merchantIdData[currentDomain].walletIsAdmin = xhr._walletIsAdmin || "";
              }
              GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));
              updateStatusWithColor(
                `Captured merchantId=${merchantId} for ${currentDomain}!`,
                true
              );
              updateCurrentDomainCard();
              if (autoNavNonVisited && !navigationScheduled) {
                navigationScheduled = true;
                updateStatusWithColor(
                  "Going to next domain without merchant ID in 1 second...",
                  true
                );
                setTimeout(() => {
                  navigationScheduled = false;
                  goToNextDomain();
                }, 1000);
              }
            }
          }
        }
      } catch (e) {}
    }
    if (
      isApiRequest &&
      requestBody.includes("login") &&
      !xhr._alreadyAddedLoginHandler
    ) {
      xhr._alreadyAddedLoginHandler = true;
      xhr.addEventListener("load", function() {
        if (xhr.readyState === 4) {
          try {
            const data = JSON.parse(xhr.responseText);
            if (
              data &&
              data.status === "SUCCESS" &&
              data.data?.id &&
              data.data?.token
            ) {
              const currentDomain = extractBaseDomain(window.location.href);
              if (
                currentDomain &&
                domainList.includes(currentDomain) &&
                merchantIdData[currentDomain]
              ) {
                merchantIdData[currentDomain].accessId = data.data.id;
                merchantIdData[currentDomain].accessToken = data.data.token;
                GM_setValue(
                  "merchant_id_data",
                  JSON.stringify(merchantIdData)
                );
                updateStatusWithColor(
                  `Captured login credentials for ${currentDomain}!`,
                  true
                );
                updateCurrentDomainCard();
              }
            }
          } catch (e) {}
        }
      });
    }
    if (
      isApiRequest &&
      (requestBody.includes("syncData") || requestBody.includes("%2FsyncData"))
    ) {
      xhr.addEventListener("load", function() {
        if (xhr.readyState === 4) {
          try {
            const data = JSON.parse(xhr.responseText);
            if (data && data.status === "SUCCESS" && data.data) {
              const currentDomain = extractBaseDomain(window.location.href);
              if (currentDomain && domainList.includes(currentDomain)) {
                if (Array.isArray(data.data.bonus) || data.data.bonus) {
                  const bonusData = filterBonuses(data, currentDomain);
                  temporaryBonusData[currentDomain] = bonusData;
                  updateCurrentDomainCard();
                  lastCapturedDomain = currentDomain;
                  lastCapturedBonus = data.data;
                  renderLastCapturedInfo();
                }
              }
            }
          } catch (e) {}
        }
      });
    }
    const originalResult = originalSend.apply(xhr, arguments);
    return originalResult;
  };
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const [resource, config] = args;
    if (
      resource &&
      resource.includes &&
      resource.includes("/api/v1/index.php")
    ) {
      try {
        if (config && config.body) {
          const body = config.body.toString();
          if (body.includes("merchantId=")) {
            const merchantIdRegex = /merchantId=([^&]+)/;
            const match = body.match(merchantIdRegex);
            if (match && match[1]) {
              const merchantId = decodeURIComponent(match[1]);
              const currentDomain = extractBaseDomain(window.location.href);
              if (
                currentDomain &&
                domainList.includes(currentDomain) &&
                (!merchantIdData[currentDomain] ||
                  !merchantIdData[currentDomain].merchantId) &&
                merchantId &&
                merchantId !== "undefined" &&
                merchantId !== ""
              ) {
                merchantIdData[currentDomain] = {
                  merchantId: merchantId,
                  capturedAt: new Date().toISOString()
                };
                GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));
                updateStatusWithColor(
                  `Captured merchantId=${merchantId} from fetch for ${currentDomain}!`,
                  true
                );
                updateCurrentDomainCard();
                if (autoNavNonVisited && !navigationScheduled) {
                  navigationScheduled = true;
                  updateStatusWithColor(
                    "Going to next domain without merchant ID in 1 second...",
                    true
                  );
                  setTimeout(() => {
                    navigationScheduled = false;
                    goToNextDomain();
                  }, 1000);
                }
              }
            }
          }
        }
      } catch (e) {}
    }
    return originalFetch.apply(window, args);
  };
}

// Theme Customizer Function


function createSimplifiedThemeCustomizer() {
  // Remove any existing theme customizer
  const existingOverlay = document.getElementById('themeCustomizerOverlay');
  if (existingOverlay) existingOverlay.remove();

  // Load saved theme settings
  const defaultTheme = {
    // Background colors
    mainBackground: 'rgba(0,0,0,0.9)',
    cardBackground: 'rgba(0,0,0,0.6)',
    validBonusBackground: 'rgba(255,20,147,0.2)',
    invalidBonusBackground: 'rgba(255,20,147,0.05)',
    statusBackground: 'rgba(0,0,0,0.8)',

    // Border colors
    mainBorder: '#ff1493',
    cardBorder: '#ff1493',
    buttonBorder: '#ff1493',

    // Text colors
    mainText: '#fff',
    headerText: '#ff1493',
    buttonText: '#fff',
    successText: 'lime',
    errorText: 'red',
    valueText: '#ffd700',

    // Button colors
    buttonBackground: 'rgba(0,0,0,0.6)',
    buttonHoverBackground: '#fff',
    buttonHoverText: '#ff1493',

    // Other colors
    progressBar: '#ff1493',
    cardNumber: '#ff1493',
    statusIcon: '#ff1493'
  };

  let currentTheme = {};
  try {
    const savedTheme = JSON.parse(GM_getValue('theme_settings', '{}'));
    currentTheme = { ...defaultTheme, ...savedTheme };
  } catch (e) {
    currentTheme = { ...defaultTheme };
  }

  // Create overlay and modal
  const overlay = document.createElement('div');
  overlay.id = 'themeCustomizerOverlay';
  overlay.className = 'modal-overlay';
  overlay.style.display = 'flex';
  overlay.style.justifyContent = 'center';
  overlay.style.alignItems = 'center';
  overlay.classList.add('active');

  const modal = document.createElement('div');
  modal.id = 'themeCustomizerModal';
  modal.className = 'url-modal';
  modal.style.maxWidth = '800px';
  modal.style.width = '90%';
  modal.style.maxHeight = '80vh';
  modal.style.overflowY = 'auto';
  modal.style.padding = '20px';
  modal.style.background = 'var(--mainBackground, rgba(0,0,0,0.9))';
  modal.style.borderColor = 'var(--mainBorder, #ff1493)';
  modal.style.color = 'var(--mainText, #fff)';

  // Create HTML structure with simplified UI (color pickers only)
  modal.innerHTML = `
    <h3 style="color: var(--headerText, #ff1493); margin-top: 0; margin-bottom: 20px; text-align: center;">Theme Customizer</h3>

    <div style="display: flex; flex-wrap: wrap; gap: 20px; margin-bottom: 20px;">
      <!-- Left Column -->
      <div style="flex: 1; min-width: 300px;">
        <div class="theme-section" style="margin-bottom: 20px; padding: 15px; background: rgba(0,0,0,0.3); border-radius: 4px;">
          <h4 style="color: var(--headerText, #ff1493); margin-top: 0; margin-bottom: 15px;">Background Colors</h4>

          <div class="color-picker-group" style="margin-bottom: 15px;">
            <label for="mainBackground" style="display: block; margin-bottom: 8px; color: var(--mainText, #fff);">Main Background:</label>
            <input type="color" id="mainBackground" data-key="mainBackground" value="${hexFromRgba(currentTheme.mainBackground)}"
              style="width: 50px; height: 50px; border: none; cursor: pointer; background: transparent;">
          </div>

          <div class="color-picker-group" style="margin-bottom: 15px;">
            <label for="cardBackground" style="display: block; margin-bottom: 8px; color: var(--mainText, #fff);">Card Background:</label>
            <input type="color" id="cardBackground" data-key="cardBackground" value="${hexFromRgba(currentTheme.cardBackground)}"
              style="width: 50px; height: 50px; border: none; cursor: pointer; background: transparent;">
          </div>

          <div class="color-picker-group" style="margin-bottom: 15px;">
            <label for="validBonusBackground" style="display: block; margin-bottom: 8px; color: var(--mainText, #fff);">Valid Bonus Background:</label>
            <input type="color" id="validBonusBackground" data-key="validBonusBackground" value="${hexFromRgba(currentTheme.validBonusBackground)}"
              style="width: 50px; height: 50px; border: none; cursor: pointer; background: transparent;">
          </div>

          <div class="color-picker-group" style="margin-bottom: 15px;">
            <label for="invalidBonusBackground" style="display: block; margin-bottom: 8px; color: var(--mainText, #fff);">Invalid Bonus Background:</label>
            <input type="color" id="invalidBonusBackground" data-key="invalidBonusBackground" value="${hexFromRgba(currentTheme.invalidBonusBackground)}"
              style="width: 50px; height: 50px; border: none; cursor: pointer; background: transparent;">
          </div>

          <div class="color-picker-group" style="margin-bottom: 15px;">
            <label for="statusBackground" style="display: block; margin-bottom: 8px; color: var(--mainText, #fff);">Status Background:</label>
            <input type="color" id="statusBackground" data-key="statusBackground" value="${hexFromRgba(currentTheme.statusBackground)}"
              style="width: 50px; height: 50px; border: none; cursor: pointer; background: transparent;">
          </div>
        </div>

        <div class="theme-section" style="margin-bottom: 20px; padding: 15px; background: rgba(0,0,0,0.3); border-radius: 4px;">
          <h4 style="color: var(--headerText, #ff1493); margin-top: 0; margin-bottom: 15px;">Border Colors</h4>

          <div class="color-picker-group" style="margin-bottom: 15px;">
            <label for="mainBorder" style="display: block; margin-bottom: 8px; color: var(--mainText, #fff);">Main Border:</label>
            <input type="color" id="mainBorder" data-key="mainBorder" value="${hexFromColor(currentTheme.mainBorder)}"
              style="width: 50px; height: 50px; border: none; cursor: pointer; background: transparent;">
          </div>

          <div class="color-picker-group" style="margin-bottom: 15px;">
            <label for="cardBorder" style="display: block; margin-bottom: 8px; color: var(--mainText, #fff);">Card Border:</label>
            <input type="color" id="cardBorder" data-key="cardBorder" value="${hexFromColor(currentTheme.cardBorder)}"
              style="width: 50px; height: 50px; border: none; cursor: pointer; background: transparent;">
          </div>

          <div class="color-picker-group" style="margin-bottom: 15px;">
            <label for="buttonBorder" style="display: block; margin-bottom: 8px; color: var(--mainText, #fff);">Button Border:</label>
            <input type="color" id="buttonBorder" data-key="buttonBorder" value="${hexFromColor(currentTheme.buttonBorder)}"
              style="width: 50px; height: 50px; border: none; cursor: pointer; background: transparent;">
          </div>
        </div>
      </div>

      <!-- Right Column -->
      <div style="flex: 1; min-width: 300px;">
        <div class="theme-section" style="margin-bottom: 20px; padding: 15px; background: rgba(0,0,0,0.3); border-radius: 4px;">
          <h4 style="color: var(--headerText, #ff1493); margin-top: 0; margin-bottom: 15px;">Text Colors</h4>

          <div class="color-picker-group" style="margin-bottom: 15px;">
            <label for="mainText" style="display: block; margin-bottom: 8px; color: var(--mainText, #fff);">Main Text:</label>
            <input type="color" id="mainText" data-key="mainText" value="${hexFromColor(currentTheme.mainText)}"
              style="width: 50px; height: 50px; border: none; cursor: pointer; background: transparent;">
          </div>

          <div class="color-picker-group" style="margin-bottom: 15px;">
            <label for="headerText" style="display: block; margin-bottom: 8px; color: var(--mainText, #fff);">Header Text:</label>
            <input type="color" id="headerText" data-key="headerText" value="${hexFromColor(currentTheme.headerText)}"
              style="width: 50px; height: 50px; border: none; cursor: pointer; background: transparent;">
          </div>

          <div class="color-picker-group" style="margin-bottom: 15px;">
            <label for="buttonText" style="display: block; margin-bottom: 8px; color: var(--mainText, #fff);">Button Text:</label>
            <input type="color" id="buttonText" data-key="buttonText" value="${hexFromColor(currentTheme.buttonText)}"
              style="width: 50px; height: 50px; border: none; cursor: pointer; background: transparent;">
          </div>

          <div class="color-picker-group" style="margin-bottom: 15px;">
            <label for="successText" style="display: block; margin-bottom: 8px; color: var(--mainText, #fff);">Success Text:</label>
            <input type="color" id="successText" data-key="successText" value="${hexFromColor(currentTheme.successText)}"
              style="width: 50px; height: 50px; border: none; cursor: pointer; background: transparent;">
          </div>

          <div class="color-picker-group" style="margin-bottom: 15px;">
            <label for="errorText" style="display: block; margin-bottom: 8px; color: var(--mainText, #fff);">Error Text:</label>
            <input type="color" id="errorText" data-key="errorText" value="${hexFromColor(currentTheme.errorText)}"
              style="width: 50px; height: 50px; border: none; cursor: pointer; background: transparent;">
          </div>

          <div class="color-picker-group" style="margin-bottom: 15px;">
            <label for="valueText" style="display: block; margin-bottom: 8px; color: var(--mainText, #fff);">Value Text:</label>
            <input type="color" id="valueText" data-key="valueText" value="${hexFromColor(currentTheme.valueText)}"
              style="width: 50px; height: 50px; border: none; cursor: pointer; background: transparent;">
          </div>
        </div>

        <div class="theme-section" style="margin-bottom: 20px; padding: 15px; background: rgba(0,0,0,0.3); border-radius: 4px;">
          <h4 style="color: var(--headerText, #ff1493); margin-top: 0; margin-bottom: 15px;">Button & Other Colors</h4>

          <div class="color-picker-group" style="margin-bottom: 15px;">
            <label for="buttonBackground" style="display: block; margin-bottom: 8px; color: var(--mainText, #fff);">Button Background:</label>
            <input type="color" id="buttonBackground" data-key="buttonBackground" value="${hexFromRgba(currentTheme.buttonBackground)}"
              style="width: 50px; height: 50px; border: none; cursor: pointer; background: transparent;">
          </div>

          <div class="color-picker-group" style="margin-bottom: 15px;">
            <label for="buttonHoverBackground" style="display: block; margin-bottom: 8px; color: var(--mainText, #fff);">Button Hover Background:</label>
            <input type="color" id="buttonHoverBackground" data-key="buttonHoverBackground" value="${hexFromColor(currentTheme.buttonHoverBackground)}"
              style="width: 50px; height: 50px; border: none; cursor: pointer; background: transparent;">
          </div>

          <div class="color-picker-group" style="margin-bottom: 15px;">
            <label for="buttonHoverText" style="display: block; margin-bottom: 8px; color: var(--mainText, #fff);">Button Hover Text:</label>
            <input type="color" id="buttonHoverText" data-key="buttonHoverText" value="${hexFromColor(currentTheme.buttonHoverText)}"
              style="width: 50px; height: 50px; border: none; cursor: pointer; background: transparent;">
          </div>

          <div class="color-picker-group" style="margin-bottom: 15px;">
            <label for="progressBar" style="display: block; margin-bottom: 8px; color: var(--mainText, #fff);">Progress Bar:</label>
            <input type="color" id="progressBar" data-key="progressBar" value="${hexFromColor(currentTheme.progressBar)}"
              style="width: 50px; height: 50px; border: none; cursor: pointer; background: transparent;">
          </div>

          <div class="color-picker-group" style="margin-bottom: 15px;">
            <label for="cardNumber" style="display: block; margin-bottom: 8px; color: var(--mainText, #fff);">Card Number:</label>
            <input type="color" id="cardNumber" data-key="cardNumber" value="${hexFromColor(currentTheme.cardNumber)}"
              style="width: 50px; height: 50px; border: none; cursor: pointer; background: transparent;">
          </div>

          <div class="color-picker-group" style="margin-bottom: 15px;">
            <label for="statusIcon" style="display: block; margin-bottom: 8px; color: var(--mainText, #fff);">Status Icon:</label>
            <input type="color" id="statusIcon" data-key="statusIcon" value="${hexFromColor(currentTheme.statusIcon)}"
              style="width: 50px; height: 50px; border: none; cursor: pointer; background: transparent;">
          </div>
        </div>
      </div>
    </div>

    <div class="theme-presets" style="margin-bottom: 20px;">
      <h4 style="color: var(--headerText, #ff1493); margin-top: 0; margin-bottom: 15px;">Presets</h4>
      <div style="display: flex; gap: 10px; flex-wrap: wrap;">
        <button id="defaultTheme" class="control-btn preset-btn" style="padding: 8px 12px; font-size: 12px;">Default Pink</button>
        <button id="darkBlueTheme" class="control-btn preset-btn" style="padding: 8px 12px; font-size: 12px;">Dark Blue</button>
        <button id="cyberpunkTheme" class="control-btn preset-btn" style="padding: 8px 12px; font-size: 12px;">Cyberpunk</button>
        <button id="retroWaveTheme" class="control-btn preset-btn" style="padding: 8px 12px; font-size: 12px;">Retro Wave</button>
        <button id="mintTheme" class="control-btn preset-btn" style="padding: 8px 12px; font-size: 12px;">Mint Green</button>
        <button id="sunsetTheme" class="control-btn preset-btn" style="padding: 8px 12px; font-size: 12px;">Sunset</button>
      </div>
    </div>

    <div style="margin-top: 20px;">
      <div id="themePreview" style="margin-bottom: 20px; border: 1px solid var(--mainBorder, #ff1493); padding: 15px; border-radius: 4px; background: var(--mainBackground, rgba(0,0,0,0.9));">
        <h4 style="color: var(--headerText, #ff1493); margin-top: 0; margin-bottom: 15px;">Live Preview</h4>
        <div style="background: var(--cardBackground, rgba(0,0,0,0.6)); border: 1px solid var(--cardBorder, #ff1493); padding: 15px; margin-bottom: 15px; border-radius: 4px;">
          <div style="font-weight: bold; color: var(--mainText, #fff);">example.com</div>
          <div>Bal: <strong style="color: var(--valueText, #ffd700);">100</strong></div>
          <div>Comm: <span style="color: var(--successText, lime);">Yes</span> <strong style="color: var(--valueText, #ffd700);">(10)</strong></div>
          <button class="preview-btn" style="background: var(--buttonBackground, rgba(0,0,0,0.6)); color: var(--buttonText, #fff); border: 1px solid var(--buttonBorder, #ff1493); padding: 4px 8px; margin-top: 8px; cursor: pointer;">Claim</button>
        </div>
        <div style="background: var(--statusBackground, rgba(0,0,0,0.8)); border: 1px solid var(--mainBorder, #ff1493); padding: 15px; border-radius: 4px;">
          <span style="background: var(--statusIcon, #ff1493); color: var(--mainText, #fff); width: 20px; height: 20px; display: inline-block; text-align: center; border-radius: 50%; margin-right: 8px;">✓</span>
          <span style="color: var(--mainText, #fff);">Status message example</span>
        </div>
      </div>
    </div>

    <div style="display: flex; justify-content: space-between; gap: 15px; margin-top: 20px;">
      <button id="saveThemeBtn" class="control-btn" style="padding: 10px 15px; font-size: 14px;">Save Theme</button>
      <button id="exportThemeBtn" class="control-btn" style="padding: 10px 15px; font-size: 14px;">Export Theme</button>
      <button id="importThemeBtn" class="control-btn" style="padding: 10px 15px; font-size: 14px;">Import Theme</button>
      <button id="closeThemeBtn" class="control-btn" style="padding: 10px 15px; font-size: 14px;">Close</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // Setup color pickers
  setupSimplifiedColorPickers(currentTheme);

  // Setup preset buttons
  document.getElementById('defaultTheme').addEventListener('click', () => loadPreset('default'));
  document.getElementById('darkBlueTheme').addEventListener('click', () => loadPreset('darkBlue'));
  document.getElementById('cyberpunkTheme').addEventListener('click', () => loadPreset('cyberpunk'));
  document.getElementById('retroWaveTheme').addEventListener('click', () => loadPreset('retroWave'));
  document.getElementById('mintTheme').addEventListener('click', () => loadPreset('mint'));
  document.getElementById('sunsetTheme').addEventListener('click', () => loadPreset('sunset'));

  // Setup action buttons
  document.getElementById('saveThemeBtn').addEventListener('click', saveTheme);
  // Close Button functionality
document.getElementById('closeThemeBtn').addEventListener('click', function(e) {
  e.stopPropagation();
  e.preventDefault();
  closeThemeCustomizer();
});

// Export Button functionality
document.getElementById('exportThemeBtn').addEventListener('click', exportTheme);

// Import Button functionality
document.getElementById('importThemeBtn').addEventListener('click', importTheme);

// Implementation of closeThemeCustomizer
function closeThemeCustomizer() {
  const overlay = document.getElementById('themeCustomizerOverlay');
  if (overlay) {
    overlay.parentNode.removeChild(overlay);
  }
}

// Implementation of exportTheme
function exportTheme() {
  const themeJSON = JSON.stringify(currentTheme);
  prompt("Copy your theme settings below:", themeJSON);
}

// Implementation of importTheme
function importTheme() {
  const importedJSON = prompt("Paste your theme settings here:");
  if (importedJSON) {
    try {
      const importedTheme = JSON.parse(importedJSON);
      currentTheme = { ...defaultTheme, ...importedTheme };

      GM_setValue('theme_settings', JSON.stringify(currentTheme));

      document.querySelectorAll('input[type="color"]').forEach(input => {
        const key = input.getAttribute('data-key');
        if (key.includes('Background')) {
          input.value = hexFromRgba(currentTheme[key]);
        } else {
          input.value = hexFromColor(currentTheme[key]);
        }
      });

      updateThemePreview(currentTheme);
      alert('Theme imported successfully!');
    } catch (e) {
      alert('Failed to import theme. Invalid JSON.');
    }
  }
}
    document.getElementById('exportThemeBtn').addEventListener('click', exportTheme);
  document.getElementById('importThemeBtn').addEventListener('click', importTheme);
  document.getElementById('closeThemeBtn').addEventListener('click', closeThemeCustomizer);

  // Setup overlay background click handler
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closeThemeCustomizer();
    }
  });

  // Helper function for simplified color picker setup


  // Helper function to update preview
  // Correct updateThemePreview implementation:
// Enhanced updateThemePreview function with accurate domain card HTML structure
function updateThemePreview(theme) {
  const preview = document.getElementById('themePreview');
  if (!preview) return;

  preview.innerHTML = `
    <div style="background: ${theme.cardBackground}; border: 2px solid ${theme.cardBorder}; border-left: 3px solid ${theme.cardBorder}; padding: 6px; border-radius: 4px; font-size: 12px; color: ${theme.mainText};">

      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
        <div style="font-weight: bold; font-size:14px; color: ${theme.headerText};">betjason.com (Current)</div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <div style="width:40px; height:40px; background: rgba(255,255,255,0.1); border-radius:3px;"></div>
          <button style="background:${theme.buttonBackground}; color:${theme.buttonText}; border:1px solid ${theme.buttonBorder}; padding:2px 4px; font-size:11px; border-radius:3px;"
                  onmouseover="this.style.background='${theme.buttonHoverBackground}'; this.style.color='${theme.buttonHoverText}';"
                  onmouseout="this.style.background='${theme.buttonBackground}'; this.style.color='${theme.buttonText}';">
            Clear Fav
          </button>
        </div>
      </div>

      <div style="display:grid; grid-template-columns: repeat(5,1fr); gap:1px; text-align:center; margin-bottom:2px;">
        <div>Bal: <strong style="color:${theme.valueText};">0</strong></div>
        <div>Comm: <span style="color:${theme.successText};">Yes</span></div>
        <div>Share: <span style="color:${theme.errorText};">No</span></div>
        <div>Ref: <span style="color:${theme.errorText};">No</span></div>
        <div></div>
      </div>

      <div style="display:grid; grid-template-columns: repeat(5,1fr); gap:1px; text-align:center;">
        <div style="grid-column:span 1;">Withdrawals: Min: <span style="color:${theme.mainText};">8</span> / Max: <span style="color:${theme.mainText};">888</span></div>
        <div style="grid-column:span 1;">
          <div>Min: <span style="color:${theme.mainText};">1.25</span>, Max: <span style="color:${theme.mainText};">--</span></div>
          <button style="background:${theme.buttonBackground}; color:${theme.buttonText}; border:1px solid ${theme.buttonBorder}; padding:2px 4px; font-size:11px; border-radius:3px; margin-top:2px;"
                  onmouseover="this.style.background='${theme.buttonHoverBackground}'; this.style.color='${theme.buttonHoverText}';"
                  onmouseout="this.style.background='${theme.buttonBackground}'; this.style.color='${theme.buttonText}';">
            Claim Comm
          </button>
        </div>
        <div style="grid-column:span 1;">&nbsp;</div>
        <div style="grid-column:span 1;">&nbsp;</div>
        <div></div>
      </div>

      <div style="margin-top:4px; font-size:12px; color: #4CAF50;">Merchant ID: 10662</div>
    </div>

    <div style="background: ${theme.statusBackground}; border: 1px solid ${theme.mainBorder}; color: ${theme.mainText}; padding: 8px; margin-top: 8px; border-radius: 4px; display: flex; align-items: center;">
      <span style="background: ${theme.statusIcon}; color: ${theme.mainText}; width: 16px; height: 16px; display: inline-flex; justify-content: center; align-items: center; border-radius: 50%; font-size: 12px; margin-right: 5px;">✓</span>
      Status example message
    </div>
  `;
}


// Adding mini live previews next to each setting
function setupSimplifiedColorPickers(theme) {
  document.querySelectorAll('input[type="color"]').forEach(input => {
    const key = input.getAttribute('data-key');

    // Create accurate GUI mini preview
    const miniPreview = document.createElement('div');
    miniPreview.style.display = 'inline-block';
    miniPreview.style.marginLeft = '8px';
    miniPreview.style.verticalAlign = 'middle';

    switch(key) {
      case 'mainBackground':
        miniPreview.textContent = 'Page BG';
        miniPreview.style.background = theme[key];
        miniPreview.style.padding = '4px';
        miniPreview.style.color = theme.mainText;
        break;

      case 'cardBackground':
        miniPreview.textContent = 'Card BG';
        miniPreview.style.background = theme[key];
        miniPreview.style.padding = '4px';
        miniPreview.style.color = theme.mainText;
        miniPreview.style.border = `1px solid ${theme.cardBorder}`;
        break;

      case 'buttonBackground':
        miniPreview.innerHTML = `<button style="background:${theme.buttonBackground}; color:${theme.buttonText}; border:1px solid ${theme.buttonBorder}; padding:2px 4px;">Btn</button>`;
        break;

      case 'statusBackground':
        miniPreview.textContent = 'Status BG';
        miniPreview.style.background = theme[key];
        miniPreview.style.padding = '4px';
        miniPreview.style.color = theme.mainText;
        miniPreview.style.border = `1px solid ${theme.mainBorder}`;
        break;

      case 'statusIcon':
        miniPreview.innerHTML = `<span style="background:${theme.statusIcon};color:${theme.mainText};padding:2px;border-radius:50%;">✓</span>`;
        break;

      case 'progressBar':
        miniPreview.style.background = theme[key];
        miniPreview.style.width = '40px';
        miniPreview.style.height = '5px';
        miniPreview.style.borderRadius = '2px';
        break;

      default:
        miniPreview.style.background = theme[key];
        miniPreview.style.width = '20px';
        miniPreview.style.height = '20px';
        miniPreview.style.border = '1px solid #fff';
        break;
    }

    input.parentNode.appendChild(miniPreview);

    input.addEventListener('input', () => {
      if (key.includes('Background')) {
        const rgb = hexToRgb(input.value);
        let alpha = 1;
        if (theme[key] && theme[key].includes('rgba')) {
          const match = theme[key].match(/rgba\(.*,(.*)\)/);
          if (match) alpha = parseFloat(match[1]);
        }
        theme[key] = `rgba(${rgb.r},${rgb.g},${rgb.b},${alpha})`;
      } else {
        theme[key] = input.value;
      }

      updateThemePreview(theme);
    });
  });

  updateThemePreview(theme);
}

    // Function to create the single Slot button that toggles slot visibility
function addSlotToggleButton() {
  // Check if the button already exists
  let slotToggleBtn = document.getElementById('slotToggleBtn');
  if (slotToggleBtn) {
    return; // Button already exists
  }

  // Create the Slot button
  slotToggleBtn = document.createElement('button');
  slotToggleBtn.id = 'slotToggleBtn';
  slotToggleBtn.className = 'control-btn';
  slotToggleBtn.textContent = 'Slot';  // Simple "Slot" text as requested
  slotToggleBtn.style.position = 'absolute';
  slotToggleBtn.style.top = '2px';
  slotToggleBtn.style.right = '260px'; // Position between Export and Show buttons
  slotToggleBtn.style.zIndex = '999999';
  slotToggleBtn.style.width = 'auto';
  slotToggleBtn.style.padding = '4px 6px';
  slotToggleBtn.style.fontSize = '10px';

  // Initially hide the button - it will only be shown in minimized mode
  slotToggleBtn.style.display = 'none';

  // Add click event handler
  slotToggleBtn.onclick = function(e) {
    e.preventDefault();
    e.stopPropagation();
    toggleGameSlotsVisibility();
    return false;
  };

  // Add the button to the container
  const container = document.getElementById('bonus-checker-container');
  if (container) {
    container.appendChild(slotToggleBtn);
  }

  // Update the button visibility based on current minimized state
  updateSlotToggleButtonVisibility();
}

// Function to update slot toggle button visibility based on minimized state
function updateSlotToggleButtonVisibility() {
  const container = document.getElementById('bonus-checker-container');
  const slotToggleBtn = document.getElementById('slotToggleBtn');

  if (!container || !slotToggleBtn) return;

  // Only show in minimized mode
  if (container.classList.contains('minimized')) {
    slotToggleBtn.style.display = 'block';
  } else {
    slotToggleBtn.style.display = 'none';
  }
}

// Global flag to track game slots container visibility
let gameSlotsVisible = true; // Default to visible

// Function to toggle game slots container visibility

// Hook into the minimize function to add our slot toggle button
function enhanceMinimizeMaximizeFunctions() {
  // We'll add this hook to the end of the existing minimizeResults function
  const originalMinimizeResults = minimizeResults;
  window.minimizeResults = function() {
    // Call the original function first
    originalMinimizeResults.apply(this, arguments);

    // Make sure our slot toggle button is visible in minimized mode
    const slotToggleBtn = document.getElementById('slotToggleBtn');
    if (slotToggleBtn) {
      slotToggleBtn.style.display = 'block';
    }

    // Then apply the saved game slots visibility
    try {
      const state = JSON.parse(GM_getValue("guiState", "{}")) || {};
      gameSlotsVisible = state.gameSlotsVisible !== undefined ? state.gameSlotsVisible : true;

      // Apply the visibility to the game slots container
      const slotsContainer = document.getElementById('gameSlotsContainer');
      if (slotsContainer) {
        if (gameSlotsVisible) {
          slotsContainer.style.display = 'flex'; // Or 'block' depending on your layout
          slotsContainer.style.cssText = "display: flex !important;"; // Override any other styles
        } else {
          slotsContainer.style.display = 'none';
          slotsContainer.style.cssText = "display: none !important;"; // Override any other styles
        }
      }
    } catch (e) {
      console.error("Error applying saved game slots visibility state", e);
    }
  };

  // Update the maximize function to ensure slot button is hidden
  const originalMaximizeResults = maximizeResults;
  window.maximizeResults = function() {
    // Call the original function first
    originalMaximizeResults.apply(this, arguments);

    // Hide our slot toggle button
    const slotToggleBtn = document.getElementById('slotToggleBtn');
    if (slotToggleBtn) {
      slotToggleBtn.style.display = 'none';
    }

    // Always make sure game slots container is visible in maximized mode
    const slotsContainer = document.getElementById('gameSlotsContainer');
    if (slotsContainer) {
      slotsContainer.style.display = 'flex'; // Or 'block' depending on your layout
      slotsContainer.style.cssText = "display: flex !important;"; // Override any other styles
    }
  };
}

// Function to add CSS styles for the slot toggle button
function addSlotToggleStyles() {
  const style = document.createElement('style');
  style.id = 'slot-toggle-styles';
  style.textContent = `
    /* Styles for Slot toggle button - with !important to override any conflicting styles */
    #slotToggleBtn {
      position: absolute !important;
      top: 2px !important;
      right: 260px !important;
      z-index: 999999 !important;
      padding: 4px 6px !important;
      font-size: 10px !important;
      background: var(--buttonBackground, rgba(0,0,0,0.6)) !important;
      color: var(--buttonText, #fff) !important;
      border: 1px solid var(--buttonBorder, #ff1493) !important;
    }

    #slotToggleBtn:hover {
      background: var(--buttonHoverBackground, #fff) !important;
      color: var(--buttonHoverText, #ff1493) !important;
    }

    /* Force the button to be visible in minimized mode */
    #bonus-checker-container.minimized ~ #slotToggleBtn,
    body.minimized #slotToggleBtn,
    html.minimized #slotToggleBtn,
    #slotToggleBtn.minimized-visible {
      display: block !important;
    }
  `;
  document.head.appendChild(style);
}

// Function to initialize the slot toggle feature
function initializeSlotToggle() {
  // Add the Slot toggle button
  addSlotToggleButton();

  // Load saved state
  try {
    const state = JSON.parse(GM_getValue("guiState", "{}")) || {};
    gameSlotsVisible = state.gameSlotsVisible !== undefined ? state.gameSlotsVisible : true;

    // Apply immediately if we're already in minimized mode
    const container = document.getElementById('bonus-checker-container');
    if (container && container.classList.contains('minimized')) {
      const slotsContainer = document.getElementById('gameSlotsContainer');
      if (slotsContainer) {
        if (gameSlotsVisible) {
          slotsContainer.style.display = 'flex';
          slotsContainer.style.cssText = "display: flex !important;";
        } else {
          slotsContainer.style.display = 'none';
          slotsContainer.style.cssText = "display: none !important;";
        }
      }
    }
  } catch (e) {
    gameSlotsVisible = true; // Default to visible
  }

  // Enhance minimize/maximize functions
  enhanceMinimizeMaximizeFunctions();

  // Add CSS styles
  addSlotToggleStyles();
}

// Hook into the existing createGUI function
const originalCreateGUI = createGUI;
createGUI = function() {
  // Call the original function first
  originalCreateGUI.apply(this, arguments);

  // Then add our slot toggle button
  addSlotToggleButton();
};

// Initialize when the document is ready
if (document.readyState === "complete" || document.readyState === "interactive") {
  setTimeout(initializeSlotToggle, 500);
} else {
  document.addEventListener("DOMContentLoaded", function() {
    setTimeout(initializeSlotToggle, 500);
  });
}

// Also call immediately in case the DOM is already loaded
initializeSlotToggle();

function loadPreset(presetName) {
  const presets = {
    default: {
      mainBackground: 'rgba(0,0,0,0.9)',
      mainBorder: '#ff1493',
      headerText: '#ff1493',
      cardBackground: 'rgba(0,0,0,0.6)',
      cardBorder: '#ff1493',
      buttonBorder: '#ff1493',
      mainText: '#fff',
      buttonBackground: 'rgba(0,0,0,0.6)',
      buttonHoverBackground: '#fff',
      buttonHoverText: '#ff1493',
      progressBar: '#ff1493',
      cardNumber: '#ff1493',
      statusIcon: '#ff1493',
      statusBackground: 'rgba(0,0,0,0.8)',
      validBonusBackground: 'rgba(255,20,147,0.2)',
      invalidBonusBackground: 'rgba(255,20,147,0.05)',
      successText: 'lime',
      errorText: 'red',
      valueText: '#ffd700'
    },
    darkBlue: {
      mainBackground: 'rgba(5, 10, 40, 0.95)',
      mainBorder: '#00aeff',
      headerText: '#00aeff',
      cardBackground: 'rgba(10,20,60,0.8)',
      cardBorder: '#00aeff',
      buttonBorder: '#00aeff',
      mainText: '#ffffff',
      buttonBackground: 'rgba(0,0,20,0.7)',
      buttonHoverBackground: '#00aeff',
      buttonHoverText: '#fff',
      progressBar: '#00aeff',
      cardNumber: '#00aeff',
      statusIcon: '#00aeff',
      statusBackground: 'rgba(10,20,60,0.9)',
      validBonusBackground: 'rgba(0,174,255,0.2)',
      invalidBonusBackground: 'rgba(0,174,255,0.05)',
      successText: '#00ff88',
      errorText: '#ff0066',
      valueText: '#ffee00'
    },
    cyberpunk: {
      mainBackground: 'rgba(20,0,40,0.95)',
      mainBorder: '#ff0077',
      headerText: '#00ffaa',
      cardBackground: 'rgba(50,0,100,0.7)',
      cardBorder: '#ff0077',
      buttonBorder: '#ff0077',
      mainText: '#fff',
      buttonBackground: 'rgba(80,0,160,0.7)',
      buttonHoverBackground: '#ff0077',
      buttonHoverText: '#000',
      progressBar: '#00ffaa',
      cardNumber: '#ff0077',
      statusIcon: '#00ffaa',
      statusBackground: 'rgba(50,0,100,0.9)',
      validBonusBackground: 'rgba(0,255,170,0.2)',
      invalidBonusBackground: 'rgba(255,0,119,0.1)',
      successText: '#00ffaa',
      errorText: '#ff0077',
      valueText: '#ffee00'
    },
    retroWave: {
      mainBackground: 'rgba(10,0,20,0.9)',
      mainBorder: '#ff00ff',
      headerText: '#00ffff',
      cardBackground: 'rgba(30,0,50,0.8)',
      cardBorder: '#ff00ff',
      buttonBorder: '#ff00ff',
      mainText: '#ffffff',
      buttonBackground: 'rgba(60,0,90,0.7)',
      buttonHoverBackground: '#ff00ff',
      buttonHoverText: '#000',
      progressBar: '#00ffff',
      cardNumber: '#ff00ff',
      statusIcon: '#00ffff',
      statusBackground: 'rgba(30,0,50,0.9)',
      validBonusBackground: 'rgba(0,255,255,0.2)',
      invalidBonusBackground: 'rgba(255,0,255,0.1)',
      successText: '#00ff99',
      errorText: '#ff3399',
      valueText: '#ffdd00'
    },
    mint: {
      mainBackground: 'rgba(0,40,30,0.95)',
      mainBorder: '#88ffdd',
      headerText: '#88ffdd',
      cardBackground: 'rgba(0,80,60,0.8)',
      cardBorder: '#88ffdd',
      buttonBorder: '#88ffdd',
      mainText: '#ffffff',
      buttonBackground: 'rgba(0,60,50,0.7)',
      buttonHoverBackground: '#88ffdd',
      buttonHoverText: '#003030',
      progressBar: '#88ffdd',
      cardNumber: '#88ffdd',
      statusIcon: '#88ffdd',
      statusBackground: 'rgba(0,60,50,0.9)',
      validBonusBackground: 'rgba(136,255,221,0.2)',
      invalidBonusBackground: 'rgba(136,255,221,0.05)',
      successText: '#99ffbb',
      errorText: '#ff5555',
      valueText: '#ffee88'
    },
    sunset: {
      mainBackground: 'rgba(40,10,0,0.95)',
      mainBorder: '#ff8822',
      headerText: '#ff8822',
      cardBackground: 'rgba(60,20,0,0.8)',
      cardBorder: '#ff8822',
      buttonBorder: '#ff8822',
      mainText: '#ffffff',
      buttonBackground: 'rgba(80,30,10,0.7)',
      buttonHoverBackground: '#ff8822',
      buttonHoverText: '#401000',
      progressBar: '#ff8822',
      cardNumber: '#ff8822',
      statusIcon: '#ff8822',
      statusBackground: 'rgba(60,20,0,0.9)',
      validBonusBackground: 'rgba(255,136,34,0.2)',
      invalidBonusBackground: 'rgba(255,136,34,0.05)',
      successText: '#33ffaa',
      errorText: '#ff4466',
      valueText: '#ffdd55'
    }
  };

  if (!presets[presetName]) {
    alert('Preset theme not found!');
    return;
  }

  currentTheme = { ...presets[presetName] };

  // Update all color pickers visually
  document.querySelectorAll('input[type="color"]').forEach(input => {
    const key = input.getAttribute('data-key');
    if (key.includes('Background')) {
      input.value = hexFromRgba(currentTheme[key]);
    } else {
      input.value = hexFromColor(currentTheme[key]);
    }
  });

  updateThemePreview(currentTheme);
}
// Implement saveTheme
function saveTheme() {
  GM_setValue('theme_settings', JSON.stringify(currentTheme));
  alert('Theme settings saved successfully!');
}


  // Helper function to extract hex from color string
  function hexFromColor(color) {
    if (!color) return '#000000';

    // If it's already a hex color, return it
    if (color.startsWith('#')) {
      return color;
    }

    // If it's a named color, use a temporary div to convert it
    if (!color.startsWith('rgb')) {
      const tempDiv = document.createElement('div');
      tempDiv.style.color = color;
      document.body.appendChild(tempDiv);
      const rgbColor = window.getComputedStyle(tempDiv).color;
      document.body.removeChild(tempDiv);
      color = rgbColor;
    }

    // Convert rgb/rgba to hex
    const rgbMatch = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*[\d.]+)?\)/);
    if (rgbMatch) {
      const r = parseInt(rgbMatch[1]);
      const g = parseInt(rgbMatch[2]);
      const b = parseInt(rgbMatch[3]);
      return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
    }

    return '#000000';
  }

  // Helper function to extract hex from rgba
  // Helper function to extract hex from rgba
function hexFromRgba(rgba) {
  if (!rgba || !rgba.startsWith('rgba')) return '#000000';

  const match = rgba.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*[\d\.]+\)/);

  if (match) {
    const r = parseInt(match[1]);
    const g = parseInt(match[2]);
    const b = parseInt(match[3]);

    return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
  }

  return '#000000';
}

// Helper function to convert hex color to RGB
function hexToRgb(hex) {
  hex = hex.replace('#', '');

  // Handle shorthand hex colors (#fff)
  if (hex.length === 3) {
    hex = hex.split('').map(char => char + char).join('');
  }

  const num = parseInt(hex, 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;

  return { r, g, b };
}
}
/**
 * Applies the currently selected theme to the GUI container, site cards, buttons, etc.
 * This ensures that the theme you pick in the popup is reflected in the actual interface.
 */
function applyThemeToGUI() {
  // Generate and apply CSS variables first
  const theme = generateAndApplyCSSVariables();

  // Define comprehensive styles using CSS variables
  let themeStylesheet = document.getElementById('global-theme-styles');
  if (!themeStylesheet) {
    themeStylesheet = document.createElement('style');
    themeStylesheet.id = 'global-theme-styles';
    document.head.appendChild(themeStylesheet);
  }

  // Define comprehensive styles using CSS variables
  themeStylesheet.textContent = `
    /* Container styles */
    #bonus-checker-container {
      background: var(--mainBackground) !important;
      color: var(--mainText) !important;
    }

    /* Card styles */
    .site-card {
      background: var(--cardBackground) !important;
      border: 1px solid var(--cardBorder) !important;
      color: var(--mainText) !important;
    }

    .site-card.valid-bonus {
      background: var(--validBonusBackground) !important;
      border-color: var(--mainBorder) !important;
    }

    .site-card.invalid-bonus {
      background: var(--invalidBonusBackground) !important;
      border-color: var(--mainBorder) !important;
    }

    /* Button styles */
    .control-btn {
      background: var(--buttonBackground) !important;
      color: var(--buttonText) !important;
      border: 1px solid var(--buttonBorder) !important;
      transition: all 0.2s ease !important;
    }

    .control-btn:hover {
      background: var(--buttonHoverBackground) !important;
      color: var(--buttonHoverText) !important;
    }

    /* Status message styles */
    #statusMessage, .status-message {
      background-color: var(--statusBackground);
      border-color: var(--mainBorder);
    }

    /* Progress bar */
    .progress-fill, #progressBar, .status-progress-fill {
      background: var(--progressBar) !important;
    }

    /* Card numbers */
    .card-number {
      background-color: var(--cardNumber) !important;
    }

    /* Status icons */
    .status-icon {
      background-color: var(--statusIcon) !important;
      color: var(--mainText) !important;
    }

    /* Text colors */
    h3, h4, .header-controls h3 {
      color: var(--headerText) !important;
    }

    .current-domain-card strong[style*="color:#ffd700"] {
      color: var(--valueText) !important;
    }

    .current-domain-card span[style*="color:lime"] {
      color: var(--successText) !important;
    }

    .current-domain-card span[style*="color:red"] {
      color: var(--errorText) !important;
    }

    /* Fix specifically for the minimized mode */
    #bonus-checker-container.minimized {
      border-bottom: none !important;
    }

    /* Modal styles */
    .url-modal, .modal-overlay .url-modal {
      background: var(--mainBackground) !important;
      border: 2px solid var(--mainBorder) !important;
    }

    /* Fix for game slots */
    .game-slot {
      background: var(--cardBackground) !important;
      border: 1px dashed var(--mainBorder) !important;
    }

    .game-slot.active {
      border: 2px solid var(--mainBorder) !important;
      box-shadow: 0 0 5px var(--mainBorder) !important;
    }

    /* Critical fixes for the pink buttons/borders in minimized mode */
    #refreshLastMin, #nextDomainMin, #toggleCurrentCardMin, #themeCustomizeBtn, #maximizeTracker {
      background: var(--buttonBackground) !important;
      color: var(--buttonText) !important;
      border: 1px solid var(--buttonBorder) !important;
    }

    #refreshLastMin:hover, #nextDomainMin:hover, #toggleCurrentCardMin:hover,
    #themeCustomizeBtn:hover, #maximizeTracker:hover {
      background: var(--buttonHoverBackground) !important;
      color: var(--buttonHoverText) !important;
    }

    /* Fix the current domain card */
    .current-domain-card {
      background: var(--validBonusBackground) !important;
      border-left: 3px solid var(--mainBorder) !important;
    }
  `;

  // Apply direct styles to elements with inline styling
  const valueTexts = document.querySelectorAll('strong[style*="color:#ffd700"]');
  valueTexts.forEach(elem => {
    elem.style.color = theme.valueText;
  });

  const successTexts = document.querySelectorAll('span[style*="color:lime"]');
  successTexts.forEach(elem => {
    elem.style.color = theme.successText;
  });

  const errorTexts = document.querySelectorAll('span[style*="color:red"]');
  errorTexts.forEach(elem => {
    elem.style.color = theme.errorText;
  });
}

    function fixGameSlotsBorder() {
  // Create a specific style element for game slots
  let gameSlotStyle = document.getElementById('game-slots-fixed-style');
  if (!gameSlotStyle) {
    gameSlotStyle = document.createElement('style');
    gameSlotStyle.id = 'game-slots-fixed-style';
    document.head.appendChild(gameSlotStyle);
  }

  // Apply styles with !important to override any other styles
  gameSlotStyle.textContent = `
    /* Game slot specific fixes with higher specificity */
    #gameSlotsContainer {
      border: 1px solid var(--mainBorder, #ff1493) !important;
    }

    #gameSlotsContainer .game-slot {
      border: 1px dashed var(--mainBorder, #ff1493) !important;
      background: var(--cardBackground, rgba(0,0,0,0.5)) !important;
    }

    #gameSlotsContainer .game-slot.active {
      border: 2px solid var(--mainBorder, #ff1493) !important;
      box-shadow: 0 0 5px var(--mainBorder, #ff1493) !important;
    }

    /* Status message border fix */
    #statusMessage,
    .status-message,
    [id^="statusMessage-"] {
      border: 1px solid var(--mainBorder, #ff1493) !important;
      background-color: var(--statusBackground, rgba(0,0,0,0.8)) !important;
    }

    /* Fix status icons */
    .status-icon,
    #statusMessage .status-icon,
    [id^="statusMessage-"] .status-icon {
      background-color: var(--statusIcon, #ff1493) !important;
      color: var(--mainText, #fff) !important;
    }
  `;

  // Directly apply to existing elements
  const gameSlots = document.querySelectorAll('.game-slot');
  gameSlots.forEach(slot => {
    slot.style.border = `1px dashed var(--mainBorder, #ff1493)`;
    slot.style.background = `var(--cardBackground, rgba(0,0,0,0.5))`;

    if (slot.classList.contains('active')) {
      slot.style.border = `2px solid var(--mainBorder, #ff1493)`;
      slot.style.boxShadow = `0 0 5px var(--mainBorder, #ff1493)`;
    }
  });

  const slotsContainer = document.getElementById('gameSlotsContainer');
  if (slotsContainer) {
    slotsContainer.style.border = `1px solid var(--mainBorder, #ff1493)`;
  }

  // Fix status messages
  const statusMessages = document.querySelectorAll('#statusMessage, .status-message, [id^="statusMessage-"]');
  statusMessages.forEach(msg => {
    msg.style.border = `1px solid var(--mainBorder, #ff1493)`;
    msg.style.backgroundColor = `var(--statusBackground, rgba(0,0,0,0.8))`;
  });
}

// Call this function after applying theme and whenever the UI is updated
function enhanceApplyThemeToGUI() {
  // Call original function if it exists
  if (typeof window.originalApplyThemeToGUI === 'function') {
    window.originalApplyThemeToGUI();
  } else if (typeof applyThemeToGUI === 'function') {
    applyThemeToGUI();
  }

  // Apply our specific fixes
  fixGameSlotsBorder();
}

// Automatically call our function periodically to ensure styles are maintained
setInterval(fixGameSlotsBorder, 1000);

// Call immediately
fixGameSlotsBorder();

// Override the original function
if (typeof applyThemeToGUI === 'function' && !window.originalApplyThemeToGUI) {
  window.originalApplyThemeToGUI = applyThemeToGUI;
  applyThemeToGUI = enhanceApplyThemeToGUI;
}

    // Override GM_setValue so that every call to it immediately persists the GUI state.
function initializeThemeSystem() {
  // Generate and apply CSS variables
  generateAndApplyCSSVariables();

  // Apply theme to GUI elements
  applyThemeToGUI();

  // Setup periodic theme check to ensure consistency
  setInterval(() => {
    // Check if CSS variables are present
    const rootStyles = getComputedStyle(document.documentElement);
    if (!rootStyles.getPropertyValue('--mainBorder').trim()) {
      console.log("Theme variables missing, reapplying...");
      generateAndApplyCSSVariables();
      applyThemeToGUI();
    }
  }, 5000);
}

    // Add this function to your script
function generateAndApplyCSSVariables() {
  // Default theme as fallback
  const defaultTheme = {
    // Background colors
    mainBackground: 'rgba(0,0,0,0.9)',
    cardBackground: 'rgba(0,0,0,0.6)',
    validBonusBackground: 'rgba(255,20,147,0.2)',
    invalidBonusBackground: 'rgba(255,20,147,0.05)',
    statusBackground: 'rgba(0,0,0,0.8)',

    // Border colors
    mainBorder: '#ff1493',
    cardBorder: '#ff1493',
    buttonBorder: '#ff1493',

    // Text colors
    mainText: '#fff',
    headerText: '#ff1493',
    buttonText: '#fff',
    successText: 'lime',
    errorText: 'red',
    valueText: '#ffd700',

    // Button colors
    buttonBackground: 'rgba(0,0,0,0.6)',
    buttonHoverBackground: '#fff',
    buttonHoverText: '#ff1493',

    // Other colors
    progressBar: '#ff1493',
    cardNumber: '#ff1493',
    statusIcon: '#ff1493'
  };

  // Load user theme from storage
  let userTheme = {};
  try {
    userTheme = JSON.parse(GM_getValue('theme_settings', '{}'));
  } catch (e) {
    console.error("Error parsing theme settings:", e);
    userTheme = {};
  }

  // Merge the themes, with user theme taking precedence
  const theme = { ...defaultTheme, ...userTheme };

  // Create a style element for CSS variables
  let styleElement = document.getElementById('theme-variables-style');
  if (!styleElement) {
    styleElement = document.createElement('style');
    styleElement.id = 'theme-variables-style';
    document.head.appendChild(styleElement);
  }

  // Generate CSS variables
  const cssVariables = `
    :root {
      --mainBackground: ${theme.mainBackground};
      --cardBackground: ${theme.cardBackground};
      --validBonusBackground: ${theme.validBonusBackground};
      --invalidBonusBackground: ${theme.invalidBonusBackground};
      --statusBackground: ${theme.statusBackground};

      --mainBorder: ${theme.mainBorder};
      --cardBorder: ${theme.cardBorder};
      --buttonBorder: ${theme.buttonBorder};

      --mainText: ${theme.mainText};
      --headerText: ${theme.headerText};
      --buttonText: ${theme.buttonText};
      --successText: ${theme.successText};
      --errorText: ${theme.errorText};
      --valueText: ${theme.valueText};

      --buttonBackground: ${theme.buttonBackground};
      --buttonHoverBackground: ${theme.buttonHoverBackground};
      --buttonHoverText: ${theme.buttonHoverText};

      --progressBar: ${theme.progressBar};
      --cardNumber: ${theme.cardNumber};
      --statusIcon: ${theme.statusIcon};
    }
  `;

  // Apply CSS variables
  styleElement.textContent = cssVariables;

  return theme;
}
// Call this function in your init() function
document.addEventListener('DOMContentLoaded', initializeThemeSystem);
// Also call directly in case the DOM is already loaded
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  initializeThemeSystem();
}


function init() {
  // Add early style rule to hide current domain card if needed
  const shouldBeHidden = GM_getValue("minimizedCardHidden", false);
  if (shouldBeHidden) {
    const style = document.createElement('style');
    style.id = 'early-card-hiding-style';
    style.textContent = `
      #currentDomainCardContainer {
        display: none !important;
      }
    `;
    document.head.appendChild(style);
  }

  // Load saved settings first with verification
  try {
    autoNavNonVisited = GM_getValue("autoNavNonVisited", false);
    autoLogin = GM_getValue("autoLogin", false);
    autoNavValid = GM_getValue("autoNavValid", false);
    maxWithdrawalBonusType = GM_getValue("maxWithdrawalBonusType", "commission");
    autoValidBonusType = GM_getValue("autoValidBonusType", "commission");

    // Load visibility states directly from storage - this is essential for persistence
    gameSlotsVisible = GM_getValue("gameSlotsVisible", true);
    minimizedCardHidden = GM_getValue("minimizedCardHidden", false);
  } catch(e) {
    // Silent fail with defaults
    gameSlotsVisible = true;
    minimizedCardHidden = false;
  }

  // EARLY GUI INJECTION (hidden until license validated)
  injectMinimizedStylesheet();
  applyMinimizedStateEarly();
  createGUI();
  const container = document.getElementById('bonus-checker-container');
  if (container) container.style.display = 'none';

  // SHOW GUI now that license is confirmed valid
  if (container) container.style.display = '';

  loadGUIState();

  // Configure the Export/Toggle button in minimized mode
  const exportReferLinksMinBtn = document.getElementById('exportReferLinksMin');
  if (exportReferLinksMinBtn) {
    exportReferLinksMinBtn.textContent = 'Toggle Slots';
    exportReferLinksMinBtn.onclick = function(e) {
      e.preventDefault();
      e.stopPropagation();
      toggleGameSlotsVisibility();
    };
  }

  applyThemeToGUI();
  setupXHRInterception();
  keepOnTop();
  createCurrentDomainCard();
  initializeMinimizedState();
  setupMinimizeMaximizeButtons();

  // Initialize game slots
  initializeGameSlots();

  // Add CSS styles and create the slot toggle button
  addSlotToggleStyles();
  addSlotToggleButton();

  // Update slot toggle button visibility based on minimized state
  const slotToggleBtn = document.getElementById('slotToggleBtn');
  if (slotToggleBtn && container && container.classList.contains('minimized')) {
    slotToggleBtn.style.display = 'block';
    slotToggleBtn.style.cssText = "display: block !important;";
    slotToggleBtn.classList.add('minimized-visible');
  }

  // Add document listener for game selector click
  document.addEventListener('click', handleGameSelectorClick, true);

  // Delay initial refresh to ensure settings are loaded
  setTimeout(() => {
    refreshLastVisited();
  }, 200);

  const currentDomain = extractBaseDomain(window.location.href);
  if (domainList.includes(currentDomain)) {
    if (merchantIdData[currentDomain]?.merchantId) {
      if (autoLogin) {
        setTimeout(autoLoginCheck, 1000);
      } else if (autoNavNonVisited && !navigationScheduled) {
        navigationScheduled = true;
        setTimeout(() => {
          navigationScheduled = false;
          const domainsWithoutMerchantId = domainList.filter(d => !merchantIdData[d]?.merchantId);
          if (domainsWithoutMerchantId.length > 0) {
            updateStatusWithColor(`Moving to next domain without merchant ID: ${domainsWithoutMerchantId[0]}`, true);
            goToNextDomain();
          } else {
            updateStatusWithColor("All domains have merchant IDs!", true);
          }
        }, 1500);
      }
    } else {
      updateStatusWithColor(`Waiting for merchant ID capture for ${currentDomain}...`, false);
    }
    checkAndCaptureBonusDataAfterLoad();
  } else {
    updateStatusWithColor(`Current domain not listed. Displaying data for last valid domain: ${getCurrentDisplayDomain()}`, true);
    updateCurrentDomainCard();
    refreshLastVisited();
    setInterval(refreshLastVisited, 45000);
  }

  setupPeriodicStateCheck();
  setInterval(cleanup, CLEANUP_INTERVAL);

  window.addEventListener('beforeunload', function() {
    persistGUIState();

    // Explicitly save visibility states
    GM_setValue("gameSlotsVisible", gameSlotsVisible);
    GM_setValue("minimizedCardHidden", minimizedCardHidden);
  });

  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      initializeMinimizedState();

      // Re-check slot toggle button visibility on visibility change
      const slotToggleBtn = document.getElementById('slotToggleBtn');
      const container = document.getElementById('bonus-checker-container');
      if (slotToggleBtn && container && container.classList.contains('minimized')) {
        slotToggleBtn.style.display = 'block';
        slotToggleBtn.style.cssText = "display: block !important;";
        slotToggleBtn.classList.add('minimized-visible');
      }

      // Apply the game slots visibility based on saved state
      const slotsContainer = document.getElementById('gameSlotsContainer');
      if (slotsContainer) {
        // Read directly from storage to ensure consistency
        const slotsVisible = GM_getValue("gameSlotsVisible", true);

        if (slotsVisible) {
          slotsContainer.style.display = 'flex';
          slotsContainer.style.cssText = "display: flex !important;";
        } else {
          slotsContainer.style.display = 'none';
          slotsContainer.style.cssText = "display: none !important;";
        }

        // Update the global variable to match
        gameSlotsVisible = slotsVisible;
      }
    } else {
      persistGUIState();

      // Explicitly save visibility states
      GM_setValue("gameSlotsVisible", gameSlotsVisible);
      GM_setValue("minimizedCardHidden", minimizedCardHidden);

      clearTemporaryData();
    }
  });

  // Immediately resume any pending game flow
  completeGameFlowIfNeeded();

  // Persist critical state periodically
  setInterval(() => {
    persistGUIState();

    // Also check slot toggle button visibility
    const slotToggleBtn = document.getElementById('slotToggleBtn');
    const container = document.getElementById('bonus-checker-container');
    if (slotToggleBtn && container) {
      if (container.classList.contains('minimized')) {
        if (slotToggleBtn.style.display === 'none') {
          slotToggleBtn.style.display = 'block';
          slotToggleBtn.style.cssText = "display: block !important;";
          slotToggleBtn.classList.add('minimized-visible');
        }
      } else {
        slotToggleBtn.style.display = 'none';
        slotToggleBtn.classList.remove('minimized-visible');
      }
    }

    // Apply current domain card visibility if needed
    const currentDomainCard = document.getElementById('currentDomainCardContainer');
    if (currentDomainCard) {
      if (minimizedCardHidden) {
        currentDomainCard.style.cssText = "display: none !important;";
      } else if (minimizedCardHidden === false) { // Explicitly check for false
        currentDomainCard.style.cssText = "display: block !important;";
      }
    }

    // Apply game slots visibility if needed
    const slotsContainer = document.getElementById('gameSlotsContainer');
    if (slotsContainer) {
      // Get the latest state from storage
      const slotsVisible = GM_getValue("gameSlotsVisible", true);

      if (slotsVisible) {
        slotsContainer.style.display = 'flex';
        slotsContainer.style.cssText = "display: flex !important;";
      } else {
        slotsContainer.style.display = 'none';
        slotsContainer.style.cssText = "display: none !important;";
      }

      // Update global variable to match storage
      gameSlotsVisible = slotsVisible;
    }
  }, 2000);

  // Critical event handler for toggle buttons
  document.addEventListener('click', function(e) {
    // Only save when clicking the toggle buttons
    if (e.target && (
        e.target.id === 'exportReferLinksMin' ||
        e.target.id === 'toggleCurrentCardMin' ||
        e.target.id === 'slotToggleBtn')) {
      // Save states immediately
      setTimeout(() => {
        GM_setValue("gameSlotsVisible", gameSlotsVisible);
        GM_setValue("minimizedCardHidden", minimizedCardHidden);
      }, 50);
    }
  });
}



// Function to toggle game slots container visibility

function cleanup() {
  cleanMerchantData();
}



function keepOnTop() {
  topObserver=new MutationObserver(()=>{
    if(!document.contains(guiElement)){
      document.body.appendChild(guiElement);
    }
    guiElement.style.zIndex='2147483647';
  });
  topObserver.observe(document.documentElement,{childList:true,subtree:true});
}

window.addEventListener('beforeunload',clearTemporaryData);
window.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden'){
    clearTemporaryData();
  }
});

if(document.readyState==="complete"||document.readyState==="interactive"){
  init();
}else{
  document.addEventListener("DOMContentLoaded",()=>{init();});
}
startScript();
})();

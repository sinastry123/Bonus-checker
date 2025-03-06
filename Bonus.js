// ==UserScript==
// @name         kkkonus Checker - Final Version
// @namespace    http://example.com
// @version      7.7
// @description  Uses login request approach for bonus data, maintains original GUI, auto-navigates to next URL without merchant ID
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
let showingLastData = false;
    // Default credentials for API login
    let defaultPhone = GM_getValue("default_phone", "0412578959");
    let defaultPassword = GM_getValue("default_password", "password");

    let lastListedDomain = null;
    let lastCapturedDomain = null;
    let lastCapturedBonus = null;

    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    const originalSend = XMLHttpRequest.prototype.send;

    let guiElement = null;
    let navigationScheduled = false;

    // Sort mode for bonus sorting
    let sortMode = 0;
    // 0 -> sort by highest Commission
    // 1 -> sort by highest Share
    // 2 -> sort by highest Referral
    // 3 -> sort by highest Balance
    // 4 -> sort by Errors

    /***********************************************
     *         HELPER / UTILITY FUNCS              *
     ***********************************************/
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

        // Clear any pending timers/intervals
        const highestId = window.setTimeout(() => {}, 0);
        for (let i = 0; i < highestId; i++) {
            window.clearTimeout(i);
            window.clearInterval(i);
        }

        // Force page reload instead of replace to clear any stale state
        window.location.href = url;
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
    function clearTemporaryData() {
        if (!autoNavValid) {
            temporaryBonusData = {};
            updateAllCards();
        }
    }

    // Function to update status with color
    function updateStatusWithColor(message, isSuccess = true) {
        const statusEl = document.getElementById('statusMessage');
        if (statusEl) {
            statusEl.textContent = message;
            statusEl.style.color = isSuccess ? '#4CAF50' : '#ff4444';

            // Flash the status message to draw attention
            statusEl.style.opacity = '1';
            setTimeout(() => {
                statusEl.style.transition = 'opacity 1s';
                statusEl.style.opacity = '0.8';
            }, 100);
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

    /***********************************************
     *      BONUS DATA TRANSFORMATION FUNC         *
     ***********************************************/
    // Optimized bonus data filtering
    function filterBonuses(rawData, domain) {
        if (!rawData || !rawData.data) return {};

        const rawBonuses = rawData.data.bonus || [];
        const rawWallets = rawData.data.wallet || [];

        // Determine the balance and min/max withdrawal
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

        let bonusData = {
            cash: finalBalance,
            freeCreditMinWithdraw: finalMinW,
            freeCreditMaxWithdraw: finalMaxW,
            commission: null,
            share: null,
            referral: null
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
    padding: 10px; /* spacing inside container */
}

/* TITLE HEADER (ALANNAH) */
#bonus-checker-title {
    font-size: 26px;
    font-weight: bold;
    text-align: center;
    margin-bottom: 10px;
    color: #ff1493;
    text-shadow: 1px 1px 5px rgba(255,20,147,0.7);
}

/* HEADER CONTROLS (grid) */
.header-controls {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
    margin-bottom: 8px;
}

/* SITE CARDS */
.site-card {
    padding: 8px;
    border-radius: 5px;
    margin-bottom: 8px;
    color: #fff;
    background: rgba(0,0,0,0.6);
    border: 1px solid #ff1493;
    box-shadow: 0 2px 4px rgba(0,0,0,0.5);
}
.valid-bonus {
    background: rgba(255,20,147,0.2) !important;
    border-color: #ff1493 !important;
}
.invalid-bonus {
    background: rgba(255,20,147,0.05) !important;
    border-color: #ff1493 !important;
}

/* NEW COMPACT GRID for top/bottom rows in each card */
.site-card .top-row,
.site-card .bottom-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
    text-align: center;
    margin-bottom: 6px;
}
/* Top/Bottom Row Layout (No extra block backgrounds) */
.site-card .top-row,
.site-card .bottom-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
  text-align: center;
  margin-bottom: 6px;
}

/* Remove the black block backgrounds. Just use spacing. */
.site-card .top-row > div,
.site-card .bottom-row > div {
  background: transparent !important;
  border-radius: 0 !important;
  padding: 0 !important;
}

/* BONUS INFO (old style, can remove if not used) */
.bonus-info {
    display: none; /* Hide or remove if you want the new layout only */
}

/* NON-TRANSPARENT BUTTONS (hot pink) */
.control-btn {
    background: #ff1493;  /* solid pink */
    color: #fff;
    border: 1px solid #ff1493;
    padding: 3px 6px;
    font-size: 11px;
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.3s ease;
    text-align: center;
}
.control-btn:hover {
    background: #fff;
    color: #ff1493;
    box-shadow: 0 0 8px rgba(255,20,147,0.7);
}

/* PROGRESS BAR (always visible, pink) */
.progress-bar {
    height: 3px;
    background: #333;
    margin: 5px 0;
}
.progress-fill {
    height: 100%;
    background: #ff1493;
    width: 0%;
    transition: width 0.3s ease;
}

/* MINIMIZE / MAXIMIZE MODES */
#bonus-checker-container.minimized {
    height: auto !important;
    width: auto !important;
    background: rgba(0,0,0,0.9) !important;
    max-height: none !important;
    overflow: visible !important;
}
#bonus-checker-container.minimized #guiContent .header-controls,
#bonus-checker-container.minimized #resultsArea,
#bonus-checker-container.minimized #statusMessage {
    display: none !important;
}
#bonus-checker-container.minimized #currentDomainCardContainer {
    display: block !important;
}
#bonus-checker-container.minimized .current-domain-card {
    width: 100% !important;
    max-height: 80px !important;
    overflow-y: auto !important;
    margin: 0 !important;
}

/* Show Refresh Last and Maximize button when minimized */
#bonus-checker-container.minimized #refreshLastBtn {
    display: inline-block !important;
}
#bonus-checker-container.minimized #maximizeTracker {
    display: inline-block !important;
}
#bonus-checker-container.minimized #bonus-checker-title {
    display: none !important;
}
/* MAXIMIZE BUTTON */
#maximizeTracker {
    display: none;
    background: #ff1493;
    color: #fff;
    border: none;
    cursor: pointer;
    border-radius: 3px;
    box-shadow: 0 0 6px rgba(255,20,147,0.7);
    margin-bottom: 6px;
    padding: 3px 6px;
    font-size: 11px;
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

/* CLAIM BUTTONS (optional colors) */
.claim-btn {
    background: #4CAF50;  /* green */
    color: #fff;
    border: 1px solid #4CAF50;
    padding: 2px 4px;
    font-size: 10px;
    border-radius: 3px;
    cursor: pointer;
    transition: all 0.3s ease;
    margin-top: 4px;
    display: inline-block;
}
.claim-btn:hover {
    background: #fff;
    color: #4CAF50;
    box-shadow: 0 0 8px rgba(76,175,80,0.7);
}
/* Different colors for different bonus types */
.claim-commission-btn {
    background: #4CAF50;  /* green */
    border-color: #4CAF50;
}
.claim-share-btn {
    background: #2196F3;  /* blue */
    border-color: #2196F3;
}
.claim-referral-btn {
    background: #9C27B0;  /* purple */
    border-color: #9C27B0;
}
/* MODAL OVERLAY STYLES */
.modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.8);
    z-index: 2147483648; /* One higher than main container */
    display: none;
    justify-content: center;
    align-items: center;
}
.modal-overlay.active {
    display: flex !important; /* Force display */
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
`);

    /***********************************************
     *               GUI CREATION                  *
     ***********************************************/
    function createGUI() {
        if (guiElement) return;

        // Main container
        const container = document.createElement('div');
        container.id = 'bonus-checker-container';

        // Insert an absolutely-positioned heart container INSIDE #bonus-checker-container
        const heartsDiv = document.createElement('div');
        heartsDiv.id = 'heart-container';
        container.appendChild(heartsDiv);

        // Now create the main GUI content wrapper
        const guiContent = document.createElement('div');
        guiContent.id = 'guiContent';
        container.appendChild(guiContent);

        // Insert the title at the top
        const title = document.createElement('div');
        title.id = 'bonus-checker-title';
        title.textContent = 'ALANNAH';
        guiContent.appendChild(title);

        // Add the rest of the GUI HTML inside guiContent - using the second script's button layout
        guiContent.innerHTML += `
            <div class="header-controls">
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
                <div id="lastCapturedInfo" title="Last Captured Bonus"></div>
            </div>

            <button id="maximizeTracker" class="control-btn">Maximize</button>
            <div class="progress-bar" id="progressBar">
                <div class="progress-fill" id="progressFill"></div>
            </div>
            <div class="status-message" id="statusMessage"></div>
            <div id="resultsArea"></div>
            <div id="currentDomainCardContainer"></div>
        `;

        // Attach container to body
        document.body.appendChild(container);
        guiElement = container;

        // Create multiple floating hearts inside #heart-container
        for (let i = 0; i < 20; i++) {
            const heart = document.createElement('div');
            heart.className = 'floating-heart';
            // Random horizontal position (0–100%)
            heart.style.left = Math.random() * 100 + '%';
            // Random delay so hearts start at different times
            heart.style.animationDelay = (Math.random() * 5) + 's';
            // Random animation duration so they float at different speeds
            heart.style.animationDuration = (4 + Math.random() * 4) + 's';
            heartsDiv.appendChild(heart);
        }

        // CREATE AND APPEND THE MODAL OVERLAY & DIALOG OUTSIDE MAIN GUI
        const modalOverlay = document.createElement('div');
        modalOverlay.className = 'modal-overlay';
        modalOverlay.id = 'modalOverlay';

        const urlModal = document.createElement('div');
        urlModal.className = 'url-modal';
        urlModal.id = 'urlModal';

        // Include credentials input boxes
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
        document.body.appendChild(modalOverlay);

        // Create range modal
        createRangeModal();

        // Hook up event listeners
        addListener(document.getElementById('modalOverlay'), 'click', (e) => {
            if (e.target === modalOverlay) {
                closeEditModal();
            }
        });

        addListener(document.getElementById('saveUrls'), 'click', saveEditedUrls);
        addListener(document.getElementById('cancelUrls'), 'click', closeEditModal);

        // Hook up event listeners for buttons
        addListener(guiContent.querySelector('#editUrls'), 'click', openEditModal);
        addListener(guiContent.querySelector('#checkBonuses'), 'click', checkAllBonuses);
        addListener(guiContent.querySelector('#refreshLastBtn'), 'click', refreshLastVisited);
        addListener(guiContent.querySelector('#nextDomainBtn'), 'click', goToNextDomain);
        addListener(guiContent.querySelector('#showValidBonusesBtn'), 'click', showValidBonuses);
        addListener(guiContent.querySelector('#toggleAutoLogin'), 'click', toggleAutoLogin);
        addListener(guiContent.querySelector('#toggleAutoNavNonVisited'), 'click', toggleNavNonVisited);
        addListener(guiContent.querySelector('#toggleAutoNavValid'), 'click', toggleNavValid);
        addListener(guiContent.querySelector('#minimizeTracker'), 'click', minimizeResults);
        addListener(guiContent.querySelector('#maximizeTracker'), 'click', maximizeResults);
        addListener(guiContent.querySelector('#clearWithinRangeBtn'), 'click', openRangeModal);
        addListener(guiContent.querySelector('#toggleSortBtn'), 'click', cycleSortMode);
        addListener(guiContent.querySelector('#setDomainCredentials'), 'click', openDomainCredentialsModal);
        // Perform final UI updates
        updateToggleButtons();
        renderLastCapturedInfo();
        updateSortButtonText();
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

        if (textarea) {
            // Save domains
            domainList = cleanURLList(textarea.value);
            GM_setValue("bonus_checker_domains", JSON.stringify(domainList));

            // Save credentials
            if (phoneInput && passwordInput) {
                defaultPhone = phoneInput.value.trim();
                defaultPassword = passwordInput.value;
                GM_setValue("default_phone", defaultPhone);
                GM_setValue("default_password", defaultPassword);
            }

            closeEditModal();
            updateStatusWithColor(`Saved ${domainList.length} domains and updated API credentials.`, true);
        }
    }

    function cycleSortMode() {
        // Cycle through 5 modes: 0: Commission, 1: Share, 2: Referral, 3: Balance, 4: Errors
        sortMode = (sortMode + 1) % 5;
        sortDomainCards();
        updateSortButtonText();
    }

    function updateSortButtonText() {
        const btn = document.getElementById('toggleSortBtn');
        if (!btn) return;

        const sortTypes = ["Commission", "Share", "Referral", "Balance", "Errors"];
        btn.textContent = `Sort: ${sortTypes[sortMode]}`;
    }

    // Handle minimize/maximize
    function minimizeResults() {
        guiElement.classList.add('minimized');
    }

    function maximizeResults() {
        guiElement.classList.remove('minimized');
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
        const displayDomain = getCurrentDisplayDomain();
        if (!displayDomain) return;

        if (!currentDomainCard) {
            currentDomainCard = document.createElement('div');
            currentDomainCard.className = 'site-card current-domain-card';
            currentDomainCard.setAttribute('data-domain', displayDomain);

            const container = document.createElement('div');
            container.id = 'currentDomainCardContainer';
            container.appendChild(currentDomainCard);

            const mainContainer = document.getElementById('bonus-checker-container');
            if (mainContainer) {
                mainContainer.appendChild(container);
            }
        }

        updateCurrentDomainCard();
    }

    // Function to ensure current domain card is always on top
    function ensureCurrentDomainCardOnTop() {
        const container = document.getElementById('currentDomainCardContainer');
        const resultsArea = document.getElementById('resultsArea');

        if (container && resultsArea) {
            // Remove it from current position if it exists
            if (container.parentNode) {
                container.parentNode.removeChild(container);
            }

            // Insert at the top of results area
            if (resultsArea.firstChild) {
                resultsArea.insertBefore(container, resultsArea.firstChild);
            } else {
                resultsArea.appendChild(container);
            }
        }
    }

    // Update the current domain card with bonus data
   function updateCurrentDomainCard() {
    const displayDomain = getCurrentDisplayDomain();
    if (!displayDomain || !currentDomainCard) return;

    currentDomainCard.setAttribute('data-domain', displayDomain);

    // Show merchant ID status
    let merchantIdStatus = "";
    if (merchantIdData[displayDomain]?.merchantId) {
        merchantIdStatus = `<div style="color: #4CAF50;">Merchant ID: ${merchantIdData[displayDomain].merchantId}</div>`;
    } else {
        merchantIdStatus = `<div style="color: #ff4444;">Waiting for merchant ID...</div>`;
    }

    // If bonus data not yet available
    const bonusData = temporaryBonusData[displayDomain];
    if (!bonusData) {
        currentDomainCard.innerHTML = `
            <div style="font-weight: bold;">${displayDomain} (Current)</div>
            ${merchantIdStatus}
            <div>Waiting for bonus data...</div>
        `;
        currentDomainCard.style.background = "rgba(0,0,0,0.2)";
        currentDomainCard.style.border = "1px solid #333";
        return;
    }

    // Helpers
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

    const {
        cash,
        freeCreditMinWithdraw,
        freeCreditMaxWithdraw,
        commission,
        share,
        referral
    } = bonusData;

    // Determine if there's any valid bonus
    const hasValidBonus = (
        (commission && commission.amount > 0) ||
        (share && share.amount > 0) ||
        (referral && referral.amount > 0)
    );
    currentDomainCard.style.background = hasValidBonus
        ? "rgba(0, 128, 0, 0.3)"
        : "rgba(255, 0, 0, 0.3)";
    currentDomainCard.style.border = hasValidBonus
        ? "1px solid #4CAF50"
        : "1px solid red";

    // Wallet min/max
    const dispMinW = freeCreditMinWithdraw ?? '--';
    const dispMaxW = freeCreditMaxWithdraw ?? '--';

    // Always render 4 columns in bottom row:
    //   Col1: free-credit wallet info
    //   Col2: Commission info
    //   Col3: Share info
    //   Col4: Referral info
    currentDomainCard.innerHTML = `
        <div style="font-weight: bold;">${displayDomain} (Current)</div>
        ${merchantIdStatus}

        <div class="top-row">
            <div><span>Bal:</span> <strong style="color:#ffd700;">${cash ?? 0}</strong></div>
            <div><span>Comm:</span> ${formatCommissionIndicator(commission)}</div>
            <div><span>Share:</span> ${formatBonusIndicator(share?.amount)}</div>
            <div><span>Ref:</span> ${formatBonusIndicator(referral?.amount)}</div>
        </div>

        <div class="bottom-row">
            <!-- Column 1: wallet min/max -->
            <div>
                <div>MinW: <span style="color:#fff;">${dispMinW}</span>,
                     MaxW: <span style="color:#fff;">${dispMaxW}</span></div>
            </div>

            <!-- Column 2: Commission details or placeholder -->
            <div>
                ${
                    (commission && commission.amount > 0)
                        ? `
                            <div>
                                minBet: <span style="color:#fff;">${commission.minBet ?? '--'}</span>,
                                maxW: <span style="color:#fff;">${commission.maxWithdrawal ?? '--'}</span>
                            </div>
                            <button class="control-btn claim-btn claim-commission-btn"
                                    data-domain="${displayDomain}"
                                    data-type="commission"
                                    style="margin-top:4px;">
                                Claim Comm
                            </button>
                          `
                        : `<div>&nbsp;</div>`
                }
            </div>

            <!-- Column 3: Share details or placeholder -->
            <div>
                ${
                    (share && share.amount > 0)
                        ? `
                            <div>
                                MinW: <span style="color:#fff;">${share.minWithdrawal ?? '--'}</span>,
                                MaxW: <span style="color:#fff;">${share.maxWithdrawal ?? '--'}</span>
                            </div>
                            <button class="control-btn claim-btn claim-share-btn"
                                    data-domain="${displayDomain}"
                                    data-type="share"
                                    style="margin-top:4px;">
                                Claim Share
                            </button>
                          `
                        : `<div>&nbsp;</div>`
                }
            </div>

            <!-- Column 4: Referral details or placeholder -->
            <div>
                ${
                    (referral && referral.amount > 0)
                        ? `
                            <div>
                                MinW: <span style="color:#fff;">${referral.minWithdrawal ?? '--'}</span>,
                                MaxW: <span style="color:#fff;">${referral.maxWithdrawal ?? '--'}</span>
                            </div>
                            <button class="control-btn claim-btn claim-referral-btn"
                                    data-domain="${displayDomain}"
                                    data-type="referral"
                                    style="margin-top:4px;">
                                Claim Ref
                            </button>
                          `
                        : `<div>&nbsp;</div>`
                }
            </div>
        </div>
    `;

    // Attach claim button listeners
    const claimBtns = currentDomainCard.querySelectorAll(".claim-btn");
    claimBtns.forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const d = btn.getAttribute('data-domain');
            const bonusType = btn.getAttribute('data-type');
            claimBonus(d, bonusType);
        });
    });
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
    function updateProgress() {
        const bar = document.getElementById('progressBar');
        const fill = document.getElementById('progressFill');
        if (!bar || !fill || totalSites <= 0) return;

        const progress = (processedCount / totalSites) * 100;
        fill.style.width = `${progress}%`;
    }

    /***********************************************
     *               SORT FUNCTIONALITY            *
     ***********************************************/
    // Only sorting the current card - not storing multiple domain data
    // Replace the sortDomainCards function with this version that actually sorts cards
function sortDomainCards() {
    const results = document.getElementById('resultsArea');
    if (!results) return;

    let currentCardContainer = document.getElementById('currentDomainCardContainer');
    if (currentCardContainer) {
        currentCardContainer.remove();
    }

    let cards = Array.from(results.querySelectorAll('.site-card'))
        .filter(card => card.id !== 'currentDomainCardContainer');

    cards.sort((a, b) => {
        const domainA = a.getAttribute('data-domain') || '';
        const domainB = b.getAttribute('data-domain') || '';

        const infoA = temporaryBonusData[domainA];
        const infoB = temporaryBonusData[domainB];

        function getCommissionAmt(x) { return x?.commission?.amount || 0; }
        function getShareAmt(x) { return x?.share?.amount || 0; }
        function getReferralAmt(x) { return x?.referral?.amount || 0; }
        function getBalance(x) { return x?.cash || 0; }

        let valA = 0, valB = 0;

        if (sortMode === 0) {
            // Commission
            valA = getCommissionAmt(infoA);
            valB = getCommissionAmt(infoB);
        } else if (sortMode === 1) {
            // Share
            valA = getShareAmt(infoA);
            valB = getShareAmt(infoB);
        } else if (sortMode === 2) {
            // Referral
            valA = getReferralAmt(infoA);
            valB = getReferralAmt(infoB);
        } else if (sortMode === 3) {
            // Balance
            valA = getBalance(infoA);
            valB = getBalance(infoB);
        } else {
            // Errors - just sort alphabetically
            return domainA.localeCompare(domainB);
        }

        // Descending
        if (valB !== valA) {
            return valB - valA;
        }
        // If tie, alphabetical
        return domainA.localeCompare(domainB);
    });

    results.innerHTML = '';
    if (currentCardContainer) {
        results.appendChild(currentCardContainer);
    }
    cards.forEach(card => results.appendChild(card));

    updateStatusWithColor(`Sorted domains by ${["Commission", "Share", "Referral", "Balance", "Errors"][sortMode]}`, true);
}
    /***********************************************
     *           CHECK BONUSES FUNCTIONALITY       *
     ***********************************************/
    // Main function to check all bonuses
    // Replace the checkAllBonuses function to create and display cards for all domains
// Track if we're currently showing last data
// Track if we're currently showing last data


// Main function to check all bonuses - enhanced to toggle between showing saved data and fetching new data
async function checkAllBonuses() {
    const results = document.getElementById('resultsArea');
    if (results) results.innerHTML = '';

    // If we're already showing last data, fetch new data
    if (showingLastData) {
        showingLastData = false;
        updateStatusWithColor(`Fetching fresh bonus data...`, true);
        await fetchNewBonusData();
        return;
    }

    // Otherwise, show last stored data first
    showingLastData = true;

    // Check if we have any stored bonus data using GM_getValue
    let storedBonusData = {};

    try {
        const savedData = GM_getValue("cached_bonus_data", "{}");
        storedBonusData = JSON.parse(savedData);

        if (Object.keys(storedBonusData).length > 0) {
            updateStatusWithColor(`Showing previously saved bonus data. Click "Check Live" again to fetch fresh data.`, true);
        } else {
            updateStatusWithColor(`No saved bonus data found. Fetching fresh data...`, true);
            showingLastData = false;
            await fetchNewBonusData();
            return;
        }
    } catch (e) {
        console.error("Error loading saved bonus data:", e);
        updateStatusWithColor(`Error loading saved data. Fetching fresh data...`, false);
        showingLastData = false;
        await fetchNewBonusData();
        return;
    }

    // Display all stored bonus data
    for (const domain in storedBonusData) {
        const bonusData = storedBonusData[domain];
        // A flag to mark as stored data
        bonusData.isStoredData = true;
        updateBonusDisplay(bonusData, `https://${domain}`);
        temporaryBonusData[domain] = bonusData;
    }

    // Also create cards for domains that don't have stored data
    const domainsWithoutData = domainList.filter(domain => !storedBonusData[domain]);
    domainsWithoutData.forEach(domain => {
        if (merchantIdData[domain]?.merchantId) {
            updateBonusDisplay(null, `https://${domain}`, 'Click "Check Live" again to fetch');
        } else {
            updateBonusDisplay(null, `https://${domain}`, 'No merchant ID data');
        }
    });

    const timestamp = GM_getValue("cached_bonus_timestamp", "Unknown");
    const dateStr = timestamp !== "Unknown" ? new Date(parseInt(timestamp)).toLocaleString() : "Unknown";

    updateStatusWithColor(`Displaying saved data for ${Object.keys(storedBonusData).length} domains (saved: ${dateStr}). Click "Check Live" again to fetch fresh data.`, true);
    sortDomainCards();
}

// Helper function to fetch fresh bonus data
async function fetchNewBonusData() {
    activeChecks.clear();
    processedCount = 0;
    totalSites = domainList.length;
    temporaryBonusData = {};

    // Only check domains that have a merchant ID captured
    const domainsWithMerchantId = domainList.filter(domain => merchantIdData[domain]?.merchantId);

    if (domainsWithMerchantId.length === 0) {
        updateStatusWithColor("No domains have merchant IDs captured yet. Please visit and capture merchant IDs first.", false);
        return;
    }

    updateStatusWithColor(`Checking ${domainsWithMerchantId.length} domains with merchant IDs...`, true);

    for (let i = 0; i < domainsWithMerchantId.length; i += BATCH_SIZE) {
        const batch = domainsWithMerchantId.slice(i, i + BATCH_SIZE);
        await Promise.all(batch.map(domain => {
            activeChecks.add(domain);
            return checkDomain(domain);
        }));
        await new Promise(resolve => setTimeout(resolve, CHECK_DELAY));
    }

    // Create cards for domains without merchant IDs (showing error)
    const domainsWithoutMerchantId = domainList.filter(domain => !merchantIdData[domain]?.merchantId);
    domainsWithoutMerchantId.forEach(domain => {
        updateBonusDisplay(null, `https://${domain}`, 'No merchant ID data');
    });

    // Save the updated bonus data in Tampermonkey storage
    try {
        GM_setValue("cached_bonus_data", JSON.stringify(temporaryBonusData));
        GM_setValue("cached_bonus_timestamp", Date.now().toString());
    } catch (e) {
        console.error("Error saving bonus data:", e);
    }

    updateStatusWithColor('All checks completed. Data saved for next time.', true);
    sortDomainCards();
}

// Main function to check all bonuses - enhanced to toggle between showing saved data and fetching new data
// Function to update bonus display with styling for cached/fresh data
function updateBonusDisplay(bonusData, url, error) {
    const results = document.getElementById('resultsArea');
    if (!results) return;

    const domain = extractBaseDomain(url);
    if (!domain) return;

    // Store bonusData if we have it
    if (bonusData) {
        temporaryBonusData[domain] = bonusData;
    }

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

    // If there’s an error, just show error message
    if (error) {
        card.innerHTML = `
            <div style="font-weight: bold;">${domain}</div>
            <div class="error-message" style="color: #ff4444; font-weight: bold; margin-top: 5px;">Error: ${error}</div>
        `;
        card.classList.remove('valid-bonus', 'invalid-bonus');
        card.classList.add('invalid-bonus');

        // If we're showing cached data, add the orange indicator
        if (showingLastData) {
            card.style.borderLeftWidth = '4px';
            card.style.borderLeftColor = '#ff9800';
            const cachedIndicator = document.createElement('div');
            cachedIndicator.textContent = 'Cached';
            cachedIndicator.style.position = 'absolute';
            cachedIndicator.style.top = '2px';
            cachedIndicator.style.right = '2px';
            cachedIndicator.style.fontSize = '9px';
            cachedIndicator.style.padding = '2px 4px';
            cachedIndicator.style.backgroundColor = '#ff9800';
            cachedIndicator.style.color = 'white';
            cachedIndicator.style.borderRadius = '2px';
            card.style.position = 'relative';
            card.appendChild(cachedIndicator);
        }
        return;
    }

    // Otherwise, render the bonus data
    const { cash, commission, share, referral } = bonusData || {};

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

    const hasValidBonus = (
        (commission && commission.amount > 0) ||
        (share && share.amount > 0) ||
        (referral && referral.amount > 0)
    );
    card.classList.toggle('valid-bonus', hasValidBonus);
    card.classList.toggle('invalid-bonus', !hasValidBonus);

    // If we have freeCreditMinWithdraw/MaxWithdraw from filterBonuses
    const dispMinW = bonusData.freeCreditMinWithdraw ?? '--';
    const dispMaxW = bonusData.freeCreditMaxWithdraw ?? '--';

    // 4 columns again:
    //   1) main wallet minW/maxW
    //   2) Commission
    //   3) Share
    //   4) Referral
    card.innerHTML = `
        <div style="font-weight: bold;">${domain}</div>
        <div class="top-row">
            <div>Bal: <strong style="color:#ffd700;">${cash ?? 0}</strong></div>
            <div>Comm: ${formatCommissionIndicator(commission)}</div>
            <div>Share: ${formatBonusIndicator(share?.amount)}</div>
            <div>Ref: ${formatBonusIndicator(referral?.amount)}</div>
        </div>

        <div class="bottom-row">
            <!-- Column 1: free-credit wallet min/max -->
            <div>
                <div>MinW: <span style="color:#fff;">${dispMinW}</span>,
                     MaxW: <span style="color:#fff;">${dispMaxW}</span></div>
            </div>

            <!-- Column 2: Commission details or placeholder -->
            <div>
                ${
                    commission && commission.amount > 0
                        ? `
                            <div>minBet: <span style="color:#fff;">${commission.minBet ?? '--'}</span>,
                                 maxW: <span style="color:#fff;">${commission.maxWithdrawal ?? '--'}</span>
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

            <!-- Column 3: Share details or placeholder -->
            <div>
                ${
                    share && share.amount > 0
                        ? `
                            <div>MinW: <span style="color:#fff;">${share.minWithdrawal ?? '--'}</span>,
                                 MaxW: <span style="color:#fff;">${share.maxWithdrawal ?? '--'}</span>
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

            <!-- Column 4: Referral details or placeholder -->
            <div>
                ${
                    referral && referral.amount > 0
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

    // If showing cached data, show orange "Cached" label
    if (showingLastData || bonusData?.isStoredData) {
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

        const cachedIndicator = document.createElement('div');
        cachedIndicator.textContent = cachedTime;
        cachedIndicator.style.position = 'absolute';
        cachedIndicator.style.top = '2px';
        cachedIndicator.style.right = '2px';
        cachedIndicator.style.fontSize = '9px';
        cachedIndicator.style.padding = '2px 4px';
        cachedIndicator.style.backgroundColor = '#ff9800';
        cachedIndicator.style.color = 'white';
        cachedIndicator.style.borderRadius = '2px';
        card.style.position = 'relative';
        card.appendChild(cachedIndicator);
    }

    // Hook up the claim buttons
    const claimBtns = card.querySelectorAll(".claim-btn");
    claimBtns.forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.stopPropagation();
            const d = btn.getAttribute('data-domain');
            const bonusType = btn.getAttribute('data-type');
            claimBonus(d, bonusType);
        });
    });

    ensureCurrentDomainCardOnTop();
}
// Helper function to fetch fresh bonus data

    // Function to check a single domain using login approach from first script
    function checkDomain(domain) {
    return new Promise((resolve) => {
        const merchantData = merchantIdData[domain];
        if (!merchantData || !merchantData.merchantId) {
            updateBonusDisplay(null, `https://${domain}`, 'No merchant ID');
            processedCount++;
            activeChecks.delete(domain);
            updateProgress();
            resolve();
            return;
        }

        // Check if we have valid tokens stored in merchantData
        const accessId = merchantData.accessId;
        const accessToken = merchantData.accessToken;

        // If we have valid tokens stored, use them directly
        if (accessId && accessToken) {
            performSyncRequestWithToken(domain, accessId, accessToken, merchantData.merchantId, resolve);
            return;
        }

        // No tokens stored, need to login
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
                } catch(e) {
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

// New helper function to perform syncData request with existing token
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
                    updateBonusDisplay(bonusData, `https://${domain}`);
                    updateCurrentDomainCard();
                    lastCapturedDomain = domain;
                    lastCapturedBonus = parsed.data;
                    renderLastCapturedInfo();
                    updateStatusWithColor(`Captured bonus data for ${domain} using existing token`, true);
                } else {
                    // Token might be invalid, try login instead
                    if (parsed.message && parsed.message.toLowerCase().includes("token")) {
                        // Clear stored tokens
                        delete merchantIdData[domain].accessId;
                        delete merchantIdData[domain].accessToken;
                        GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));

                        // Call checkDomain again to trigger a login
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
    // SyncData call after successful login
    // Replace the performSyncDataRequest function to display cards for all domains
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

                    // Process the bonus data immediately without refreshing
                    if (parsed.data.bonus || Array.isArray(parsed.data.bonus)) {
                        const bonusData = filterBonuses(parsed, domain);
                        temporaryBonusData[domain] = bonusData;
                        updateCurrentDomainCard();
                        lastCapturedDomain = domain;
                        lastCapturedBonus = parsed.data;
                        renderLastCapturedInfo();
                    }

                    // Check for existing USER data
                    const existingUserData = localStorage.getItem("USER");
                    let userData = null;

                    if (existingUserData && existingUserData.length > 5) {
                        try {
                            userData = JSON.parse(existingUserData);
                        } catch (e) {
                            userData = null;
                        }
                    }

                    if (!userData) {
                        // No existing USER data, create new
                        userData = {
                            token: accessToken,
                            id: accessId,
                            syncData: parsed.data,
                            timestamp: Date.now()
                        };
                        localStorage.setItem("USER", JSON.stringify(userData));
                        updateStatusWithColor(`New USER data stored for ${domain}`, true);
                    } else {
                        // Update only syncData in existing USER object
                        userData.syncData = parsed.data;
                        userData.timestamp = Date.now();
                        // Ensure token and id are set (but don't overwrite if they exist)
                        if (!userData.token) userData.token = accessToken;
                        if (!userData.id) userData.id = accessId;
                        localStorage.setItem("USER", JSON.stringify(userData));
                        updateStatusWithColor(`Updated syncData while preserving existing USER session`, true);
                    }

                    // Dispatch a custom event to inform the page about the data update
                    try {
                        const event = new CustomEvent('userDataUpdated', {
                            detail: { userData: userData }
                        });
                        window.dispatchEvent(event);
                        updateStatusWithColor(`Triggered data refresh event`, true);
                    } catch (e) {
                        console.error("Error dispatching userDataUpdated event:", e);
                    }

                    // Move to next domain if auto-navigation is enabled
                    if (autoNavNonVisited || autoNavValid) {
                        setTimeout(() => {
                            checkIfLastDomainAndNavigate(domain);
                        }, 1000);
                    }
                } else {
                    updateStatusWithColor(`SyncData failed for ${domain}: ${parsed.message || 'Unknown error'}`, false);

                    // If token error, we should remove the token and try login again
                    if (parsed.message &&
                        (parsed.message.includes("token") ||
                         parsed.message.includes("Token") ||
                         parsed.message.includes("auth") ||
                         parsed.message.includes("Auth"))) {

                        // Keep the userData but remove token
                        const existingUserData = localStorage.getItem("USER");
                        if (existingUserData) {
                            try {
                                const userData = JSON.parse(existingUserData);
                                delete userData.token;
                                delete userData.id;
                                localStorage.setItem("USER", JSON.stringify(userData));

                                // Try login again
                                updateStatusWithColor(`Invalid token, attempting new login...`, true);
                                setTimeout(() => tryAutoLogin(), 1000);
                            } catch (e) {
                                console.error("Error handling token reset:", e);
                            }
                        }
                    }
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
    // Function to update bonus display
    // Replace the updateBonusDisplay function with this version that creates cards for all domains
// Function to update bonus display with styling for cached/fresh data
// Function to update bonus display with styling for cached/fresh data
// Function to update bonus display with styling for cached/fresh data
   /***********************************************
     *          AUTO-NAVIGATION LOGIC              *
     ***********************************************/
    // Function to go to next domain without merchant ID
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
            window.location.href = `https://${nextDomain}`;
            return;
        }

        // Otherwise just go to next in list
        currentIndex++;
        if (currentIndex >= domainList.length) {
            currentIndex = 0;
        }
        GM_setValue("currentIndex", currentIndex);
        const nextDomain = domainList[currentIndex];
        window.location.href = `https://${nextDomain}`;
    }

    function updateLastValidDomain(domain) {
        if (domainList.includes(domain)) {
            lastValidListedDomain = domain;
            GM_setValue("lastValidDomain", domain);
        }
    }

    function getCurrentDisplayDomain() {
        const currentDomain = extractBaseDomain(window.location.href);
        const storedLastDomain = GM_getValue("lastValidDomain", null);

        if (domainList.includes(currentDomain)) {
            GM_setValue("lastValidDomain", currentDomain);
            return currentDomain;
        }
        return storedLastDomain || null;
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
        let domainToRefresh = GM_getValue("lastValidDomain", null);
        if (!domainToRefresh) {
            updateStatusWithColor('No last valid domain to refresh.', false);
            return;
        }
        checkDomain(domainToRefresh).then(() => {
            updateStatusWithColor(`Updated data for ${domainToRefresh}`, true);
            updateCurrentDomainCard();
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
        // If not on a domain in our list, find and navigate to next domain
        findAndNavigateToUnloggedDomain();
        return false;
    }

    // Check if USER key already exists with data
    const userDataStr = localStorage.getItem("USER");

    // If we have any USER data at all, we're already logged in on this domain
    if (userDataStr && userDataStr.length > 5) {
        try {
            const userData = JSON.parse(userDataStr);

            updateStatusWithColor(`USER data found for ${currentDomain}, site is logged in`, true);

            // If there's a valid token in the USER data, store it in our merchantData for later use
            if (userData && userData.token && userData.id) {
                if (!merchantIdData[currentDomain]) {
                    merchantIdData[currentDomain] = {};
                }
                merchantIdData[currentDomain].accessId = userData.id;
                merchantIdData[currentDomain].accessToken = userData.token;
                GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));
            }

            // Process bonus data if available
            if (userData.syncData && (userData.syncData.bonus || Array.isArray(userData.syncData.bonus))) {
                const bonusData = filterBonuses({data: userData.syncData}, currentDomain);
                if (bonusData) {
                    temporaryBonusData[currentDomain] = bonusData;
                    updateCurrentDomainCard();
                    lastCapturedDomain = currentDomain;
                    lastCapturedBonus = userData.syncData;
                    renderLastCapturedInfo();
                }
            }

            // Navigation to next unlogged domain after a delay
            updateStatusWithColor(`Already logged in - looking for next domain in 2 seconds...`, true);
            setTimeout(() => findAndNavigateToUnloggedDomain(), 2000);

            return true; // We're handling this domain
        } catch (e) {
            console.error("Error parsing USER data:", e);
            // Continue to login if we couldn't parse the USER data
        }
    }

    // Check if merchant ID exists
    const merchantId = merchantIdData[currentDomain]?.merchantId;
    if (!merchantId) {
        updateStatusWithColor(`Cannot auto-login on ${currentDomain} - no merchant ID captured yet.`, false);

        // We should try to navigate to a domain that has a merchant ID
        setTimeout(() => findAndNavigateToUnloggedDomain(), 2000);
        return false;
    }

    // Use domain-specific credentials if available, otherwise use defaults
    const domainCreds = domainCredentials[currentDomain] || { phone: defaultPhone, password: defaultPassword };

    // Create login params
    let params = new URLSearchParams();
    params.set("mobile", domainCreds.phone);
    params.set("password", domainCreds.password);
    params.set("module", "/users/login");
    params.set("merchantId", merchantId);
    params.set("domainId", "0");
    params.set("accessId", "");
    params.set("accessToken", "");
    params.set("walletIsAdmin", "");

    // Login URL
    let loginUrl = `https://${currentDomain}/api/v1/index.php`;

    updateStatusWithColor(`Performing auto-login for ${currentDomain}...`, true);

    // Perform login request
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
                    updateStatusWithColor(`Auto-login successful for ${currentDomain}`, true);

                    // Save access credentials in merchant data
                    merchantIdData[currentDomain].accessId = resp.data.id;
                    merchantIdData[currentDomain].accessToken = resp.data.token;
                    GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));

                    // Create USER data in localStorage
                    const userData = {
                        token: resp.data.token,
                        id: resp.data.id,
                        timestamp: Date.now()
                    };
                    localStorage.setItem("USER", JSON.stringify(userData));

                    // Navigate to next domain after a short delay
                    updateStatusWithColor(`Login successful! Finding next domain in 2 seconds...`, true);
                    setTimeout(() => findAndNavigateToUnloggedDomain(), 2000);
                } else {
                    updateStatusWithColor(`Auto-login failed for ${currentDomain}: ${resp.message || 'Unknown error'}`, false);

                    // Still navigate to next domain after failure
                    setTimeout(() => findAndNavigateToUnloggedDomain(), 2000);
                }
            } catch(e) {
                updateStatusWithColor(`Parse error during auto-login for ${currentDomain}: ${e.message}`, false);
                // Still navigate to next domain after failure
                setTimeout(() => findAndNavigateToUnloggedDomain(), 2000);
            }
        },
        onerror: function() {
            updateStatusWithColor(`Network error during auto-login for ${currentDomain}`, false);
            // Still navigate to next domain after failure
            setTimeout(() => findAndNavigateToUnloggedDomain(), 2000);
        },
        ontimeout: function() {
            updateStatusWithColor(`Login timeout for ${currentDomain}`, false);
            // Still navigate to next domain after failure
            setTimeout(() => findAndNavigateToUnloggedDomain(), 2000);
        }
    });

    return true;
}

// New function to find and navigate directly to a domain that isn't logged in yet
// New function to find and navigate directly to a domain that needs login
// New function to find and navigate directly to a domain that needs login
// Improved function to navigate only to domains that need login
// Enhanced function to find and navigate to domains needing login
// This version actually checks if tokens are valid by making API requests
async function findAndNavigateToUnloggedDomain() {
    if (!autoLogin) return; // Only continue if auto-login is still enabled

    // Save current merchantData state before navigating
    GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));

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
        window.location.href = `https://${nextDomain}`;
        return;
    }

    // No domains need immediate login, so verify tokens for the rest
    const domainsNeedingLogin = [];

    // Update progress indicator
    const updateVerificationProgress = (completed) => {
        const total = domainsToVerify.length;
        const percent = total > 0 ? (completed / total) * 100 : 0;
        const progressBar = document.getElementById('verification-progress');
        const counter = document.getElementById('verification-counter');

        if (progressBar) progressBar.style.width = `${percent}%`;
        if (counter) counter.textContent = `${completed}/${total}`;
    };

    // Verify tokens in batches of 3 to avoid too many concurrent requests
    const BATCH_SIZE = 30;
    for (let i = 0; i < domainsToVerify.length; i += BATCH_SIZE) {
        const batch = domainsToVerify.slice(i, Math.min(i + BATCH_SIZE, domainsToVerify.length));

        // Verify this batch
        const results = await Promise.all(batch.map(domain =>
            verifyDomainToken(domain).then(isValid => ({ domain, isValid }))
        ));

        // Process results
        for (const { domain, isValid } of results) {
            if (!isValid) {
                domainsNeedingLogin.push(domain);
            }
        }

        // Update progress
        updateVerificationProgress(i + batch.length);
    }

    // Remove the progress indicator
    if (statusEl && progressDiv.parentNode === statusEl) {
        statusEl.removeChild(progressDiv);
    }

    // If we found domains needing login, go to the first one
    if (domainsNeedingLogin.length > 0) {
        const nextDomain = domainsNeedingLogin[0];
        updateStatusWithColor(`Found domain with invalid token: ${nextDomain}`, true);
        window.location.href = `https://${nextDomain}`;
        return;
    }

    // If no domains need login, check if there are domains without merchant IDs
    const domainsWithoutMerchantId = domainList.filter(d =>
        !merchantIdData[d]?.merchantId && d !== currentDomain
    );

    if (domainsWithoutMerchantId.length > 0) {
        const nextDomain = domainsWithoutMerchantId[0];
        updateStatusWithColor(`All domains have valid login tokens. Going to ${nextDomain} to capture merchant ID...`, true);
        window.location.href = `https://${nextDomain}`;
        return;
    }

    // If we get here, all domains have merchant IDs and valid tokens
    updateStatusWithColor(`✅ All domains have merchant IDs and valid login tokens! Nothing more to do.`, true);

    // Show a visual indication that everything is done
    const resultsArea = document.getElementById('resultsArea');
    if (resultsArea) {
        // Create a completion message if it doesn't exist
        if (!document.getElementById('all-complete-message')) {
            const completeMessage = document.createElement('div');
            completeMessage.id = 'all-complete-message';
            completeMessage.style.padding = '15px';
            completeMessage.style.margin = '10px 0';
            completeMessage.style.backgroundColor = 'rgba(76, 175, 80, 0.2)';
            completeMessage.style.border = '1px solid #4CAF50';
            completeMessage.style.borderRadius = '5px';
            completeMessage.style.textAlign = 'center';
            completeMessage.style.color = '#4CAF50';
            completeMessage.style.fontWeight = 'bold';
            completeMessage.innerHTML = `
                <div style="font-size: 24px; margin-bottom: 10px;">✅</div>
                <div>All domains have been processed!</div>
                <div style="margin-top: 10px; font-size: 12px;">
                    You can now run "Check Live" to get bonus data for all domains.
                </div>
            `;

            // Insert at the top of the results area
            if (resultsArea.firstChild) {
                resultsArea.insertBefore(completeMessage, resultsArea.firstChild);
            } else {
                resultsArea.appendChild(completeMessage);
            }

            // Flash the message briefly to draw attention
            completeMessage.animate(
                [
                    { backgroundColor: 'rgba(76, 175, 80, 0.6)' },
                    { backgroundColor: 'rgba(76, 175, 80, 0.2)' }
                ], {
                    duration: 1000,
                    iterations: 30
                }
            );
        }
    }

    // Ask to toggle auto-login off since everything is done
    const shouldTurnOff = confirm("All domains are processed! Would you like to turn off auto-login now?");
    if (shouldTurnOff) {
        autoLogin = false;
        GM_setValue("autoLogin", false);
        updateToggleButtons();
        updateStatusWithColor("Auto-login has been turned off as all domains are processed.", true);
    }
}// New helper function to find and navigate to the next domain without USER data
function navigateToNextUnloggedDomain() {
    if (!autoLogin) return; // Only continue if auto-login is still enabled

    // Save current merchantData state before navigating
    GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));

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
            window.location.href = `https://${nextDomain}`;
            return;
        }

        // If all domains have merchant IDs and we've cycled through all of them
        updateStatusWithColor(`All domains have been processed!`, true);
        return;
    }

    // Navigate to the first unlogged domain
    const nextDomain = unloggedDomains[0];
    updateStatusWithColor(`Navigating to next domain: ${nextDomain}`, true);
    window.location.href = `https://${nextDomain}`;
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
    // Add this new function to handle navigation after processing each domain
function checkIfLastDomainAndNavigate(currentDomain) {
    // Save merchant data before navigating
    GM_setValue("merchant_id_data", JSON.stringify(merchantIdData));

    // Check if there are more domains to process
    if (autoNavNonVisited) {
        // Find next domain that doesn't have a merchant ID
        const nextDomain = domainList.find(d => !merchantIdData[d]?.merchantId);
        if (nextDomain) {
            updateStatusWithColor(`Moving to next domain without merchant ID: ${nextDomain}`, true);
            window.location.href = `https://${nextDomain}`;
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
            window.location.reload();
            return;
        }

        const nextDomain = domainList[nextIndex];
        updateStatusWithColor(`Moving to next domain for auto-login: ${nextDomain}`, true);
        window.location.href = `https://${nextDomain}`;
        return;
    }

    // If no auto-navigation is enabled, just refresh the current page
    window.location.reload();
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
    createGUI();
    setupXHRInterception();
    keepOnTop();
    createCurrentDomainCard();

    // Get current domain
    const currentDomain = extractBaseDomain(window.location.href);

    // Handle auto-login and auto-navigation
    if (currentDomain && domainList.includes(currentDomain)) {
        // Show status based on whether we have a merchant ID
        if (merchantIdData[currentDomain]?.merchantId) {
            updateStatusWithColor(`Merchant ID already captured for ${currentDomain}: ${merchantIdData[currentDomain].merchantId}`, true);

            // If auto-login is enabled, try to login
            if (autoLogin) {
                setTimeout(tryAutoLogin, 1000);
            }
            // If we have a merchant ID and auto-nav is on, go to next domain that needs a merchant ID
            else if (autoNavNonVisited && !navigationScheduled) {
                navigationScheduled = true;
                setTimeout(() => {
                    navigationScheduled = false;
                    // Check if there are any domains left without merchant IDs
                    const domainsWithoutMerchantId = domainList.filter(d => !merchantIdData[d]?.merchantId);
                    if (domainsWithoutMerchantId.length > 0) {
                        updateStatusWithColor(`Moving to next domain without merchant ID: ${domainsWithoutMerchantId[0]}`, true);
                        goToNextDomain();
                    } else {
                        updateStatusWithColor("All domains now have merchant IDs captured!", true);
                    }
                }, 1500);
            }
        } else {
            updateStatusWithColor(`Waiting for merchant ID capture for ${currentDomain}...`, false);
        }
    } else if (currentDomain) {
        updateStatusWithColor(`Current domain (${currentDomain}) is not in your list. Merchant ID won't be captured.`, false);
    }

    // Set up cleanup interval
    setInterval(cleanup, CLEANUP_INTERVAL);
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

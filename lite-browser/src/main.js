
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Webview } from "@tauri-apps/api/webview";

const mainWindow = getCurrentWindow();

// Global State
let tabs = [];
let activeTabId = null;
let tabCounter = 0;
let loadInterval = null;
let isDarkMode = false;
let bookmarks = [];

const urlInput = document.getElementById("url-input");
const progressBar = document.getElementById("progress-bar");
const tabsContainer = document.getElementById("tabs-container");
const bookmarksBar = document.getElementById("bookmarks-bar");
const headerHeight = 97;

// --- UI Helpers ---
function startProgress() {
    progressBar.style.display = "block";
    progressBar.style.width = "10%";
    let width = 10;
    if (loadInterval) clearInterval(loadInterval);
    loadInterval = setInterval(() => {
        if (width >= 85) clearInterval(loadInterval);
        else {
            width += Math.random() * 5;
            progressBar.style.width = width + "%";
        }
    }, 200);
}

function stopProgress() {
    if (loadInterval) clearInterval(loadInterval);
    progressBar.style.width = "100%";
    setTimeout(() => {
        progressBar.style.display = "none";
        progressBar.style.width = "0%";
    }, 300);
}

function parseUrl(input) {
    if (input.startsWith("http://") || input.startsWith("https://")) return input;
    if (input.includes(".") && !input.includes(" ")) return "https://" + input;
    let engine = document.getElementById("search-engine").value;
    if (engine === "duckduckgo") return "https://duckduckgo.com/?q=" + encodeURIComponent(input);
    return "https://www.google.com/search?q=" + encodeURIComponent(input);
}

// --- BOOKMARKS ---
function loadBookmarks() {
    try {
        const stored = localStorage.getItem("liteBrowserBookmarks");
        if (stored) bookmarks = JSON.parse(stored);
    } catch(e) {}
    renderBookmarks();
}
function saveBookmarks() {
    try { localStorage.setItem("liteBrowserBookmarks", JSON.stringify(bookmarks)); } catch(e) {}
}
function renderBookmarks() {
    bookmarksBar.innerHTML = "";
    bookmarks.forEach((bm, index) => {
        const btn = document.createElement("button");
        btn.className = "bookmark-btn";
        btn.innerText = bm.title || bm.url;
        btn.onclick = () => navigateTo(bm.url);
        btn.oncontextmenu = (e) => {
            e.preventDefault();
            if (confirm(`Czy usunąć zakładkę: ${bm.title}?`)) {
                bookmarks.splice(index, 1);
                saveBookmarks();
                renderBookmarks();
            }
        };
        bookmarksBar.appendChild(btn);
    });
}
document.getElementById("add-bookmark-btn").addEventListener("click", () => {
    const t = getActiveTab();
    if (t && t.url && !bookmarks.some(b => b.url === t.url)) {
        bookmarks.push({ title: t.titleEl.innerText, url: t.url });
        saveBookmarks();
        renderBookmarks();
    }
});

// --- TABS LOGIC ---
async function createTab(initialUrl = "https://duckduckgo.com") {
    tabCounter++;
    const id = tabCounter;

    const tabEl = document.createElement("div");
    tabEl.className = "tab";
    tabEl.id = `tab-${id}`;

    const titleEl = document.createElement("span");
    titleEl.className = "tab-title";
    titleEl.innerText = "Nowa karta";
    tabEl.appendChild(titleEl);

    const closeBtn = document.createElement("button");
    closeBtn.className = "close-tab-btn";
    closeBtn.innerText = "✖";
    closeBtn.title = "Zamknij kartę (Ctrl+W)";
    closeBtn.onclick = (e) => {
        e.stopPropagation();
        closeTab(id);
    };
    tabEl.appendChild(closeBtn);

    tabEl.onclick = () => switchTab(id);
    tabsContainer.appendChild(tabEl);

    const scaleFactor = await mainWindow.scaleFactor();

    let webview = new Webview(mainWindow, `webview-${id}`, {
        url: initialUrl,
        x: 0,
        y: Math.floor(headerHeight * scaleFactor),
        width: Math.floor(window.innerWidth * scaleFactor),
        height: Math.floor((window.innerHeight - headerHeight) * scaleFactor),
        incognito: true,
        initializationScripts: [`
            // Adblock injection
            (function() {
                const adKeywords = ["ads", "analytics", "tracking", "banner", "doubleclick"];
                const originalFetch = window.fetch;
                window.fetch = async function(...args) {
                    if(typeof args[0] === "string" && adKeywords.some(k => args[0].includes(k))) {
                        return new Response();
                    }
                    return originalFetch.apply(this, args);
                };
            })();

            // W Tauri V2 webview.eval nie zwraca danych bezpośrednio (void).
            // Ponieważ używamy minimalistycznego setupu JS-only,
            // synchronizację URL przeprowadzimy poprzez modyfikację tytułu okna i użycie interval.
            setInterval(() => {
                if(document.title !== window.__lastTitleSync || window.location.href !== window.__lastUrlSync) {
                   window.__lastTitleSync = document.title;
                   window.__lastUrlSync = window.location.href;
                   // Przekazanie do title poprzez konwencję (tylko na MVP, by ominąć brak IPC w czystym webview setup)
                   // Najbezpieczniejsza opcja dla JS-only bez modyfikacji Rusta: brak idealnej drogi.
                   // W ramach obejścia dla Lite Browsera - MVP, akceptujemy ograniczenia lub weryfikujemy z rustem.
                }
            }, 1000);
        `]
    });

    const tabData = { id, webview, url: initialUrl, titleEl, isSleeping: false };
    tabs.push(tabData);

    // Tauri webview events (część może działać, w zależności od dostępnych eventów)
    webview.once("tauri://created", function () { console.log(`Webview ${id} spawned`); });
    webview.once("tauri://error", function (e) { console.error(`Webview error`, e); });

    await switchTab(id);
}

async function wakeUpTab(tabData) {
    const scaleFactor = await mainWindow.scaleFactor();
    tabData.webview = new Webview(mainWindow, `webview-${tabData.id}`, {
        url: tabData.url,
        x: 0,
        y: Math.floor(headerHeight * scaleFactor),
        width: Math.floor(window.innerWidth * scaleFactor),
        height: Math.floor((window.innerHeight - headerHeight) * scaleFactor),
        incognito: true,
        initializationScripts: [`
            (function() {
                const adKeywords = ["ads", "analytics", "tracking", "banner", "doubleclick"];
                const originalFetch = window.fetch;
                window.fetch = async function(...args) {
                    if(typeof args[0] === "string" && adKeywords.some(k => args[0].includes(k))) {
                        return new Response();
                    }
                    return originalFetch.apply(this, args);
                };
            })();
        `]
    });
    tabData.isSleeping = false;
    document.getElementById(`tab-${tabData.id}`).classList.remove("sleeping");

    if (isDarkMode) setTimeout(applyDarkModeToActive, 500);
}

async function switchTab(id) {
    if (activeTabId === id) return;

    if (activeTabId !== null) {
        const oldTab = tabs.find(t => t.id === activeTabId);
        if (oldTab && oldTab.webview && !oldTab.isSleeping) {
            document.getElementById(`tab-${activeTabId}`).classList.remove("active");
            oldTab.webview.hide().catch(()=>{});
        }
    }

    activeTabId = id;
    const newTab = tabs.find(t => t.id === activeTabId);
    if (newTab) {
        document.getElementById(`tab-${activeTabId}`).classList.add("active");
        if (newTab.isSleeping) await wakeUpTab(newTab);
        else newTab.webview.show().catch(()=>{});
        urlInput.value = newTab.url;
    }
}

async function closeTab(id) {
    const tabIndex = tabs.findIndex(t => t.id === id);
    if (tabIndex === -1) return;

    const tabData = tabs[tabIndex];
    if (tabData.webview && !tabData.isSleeping) {
        await tabData.webview.close();
    }

    document.getElementById(`tab-${id}`).remove();
    tabs.splice(tabIndex, 1);

    if (activeTabId === id) {
        activeTabId = null;
        if (tabs.length > 0) {
            await switchTab(tabs[tabs.length - 1].id);
        } else {
            urlInput.value = "";
            createTab();
        }
    }
}

function getActiveTab() {
    return tabs.find(t => t.id === activeTabId);
}

// --- NEW TAB BTN BINDING ---
document.getElementById("new-tab-btn").addEventListener("click", () => {
    createTab();
});

// --- BACK, FORWARD, REFRESH BINDINGS ---
document.getElementById("back-btn").addEventListener("click", () => {
    const t = getActiveTab();
    if(t && t.webview && !t.isSleeping) {
        startProgress();
        t.webview.eval(`window.history.back();`).catch(() => {});
        setTimeout(stopProgress, 600);
    }
});

document.getElementById("forward-btn").addEventListener("click", () => {
    const t = getActiveTab();
    if(t && t.webview && !t.isSleeping) {
        startProgress();
        t.webview.eval(`window.history.forward();`).catch(() => {});
        setTimeout(stopProgress, 600);
    }
});

document.getElementById("refresh-btn").addEventListener("click", () => {
    const t = getActiveTab();
    if(t && t.webview && !t.isSleeping) {
        startProgress();
        t.webview.eval(`window.location.reload();`).catch(() => {});
        setTimeout(stopProgress, 600);
    }
});

// --- NAVIGATION ---
async function navigateTo(input) {
    let url = parseUrl(input);
    urlInput.value = url;
    let t = getActiveTab();
    if (!t) await createTab(url);
    else {
        startProgress();
        t.url = url;
        if(t.isSleeping) await wakeUpTab(t);
        t.webview.eval(`window.location.href = "${url}";`).catch(()=>{});
        setTimeout(stopProgress, 800);
    }
}

document.getElementById("go-btn").addEventListener("click", () => { let i = urlInput.value; if(i) navigateTo(i); });
urlInput.addEventListener("keypress", (e) => { if(e.key === "Enter") { let i = urlInput.value; if(i) navigateTo(i); }});
urlInput.addEventListener("click", function() { this.select(); });

// --- MEMORY SAVER ---
document.getElementById("sleep-tabs-btn").addEventListener("click", async () => {
    let freedCount = 0;
    for (let tab of tabs) {
        if (tab.id !== activeTabId && !tab.isSleeping && tab.webview) {
            await tab.webview.close();
            tab.webview = null;
            tab.isSleeping = true;
            document.getElementById(`tab-${tab.id}`).classList.add("sleeping");
            freedCount++;
        }
    }
    if (freedCount > 0) alert(`Uśpiono ${freedCount} kart w tle. Pamięć RAM została zwolniona!`);
    else alert("Brak kart w tle do uśpienia.");
});

// --- READER MODE ---
document.getElementById("reader-mode-btn").addEventListener("click", () => {
    const t = getActiveTab();
    if(t && t.webview && !t.isSleeping) {
        startProgress();
        const rs = `(() => {
            const art = document.querySelector("article") || document.body;
            const content = Array.from(art.querySelectorAll("h1, h2, h3, h4, p")).map(e => e.outerHTML).join("");
            document.body.innerHTML = "<div style=\"max-width: 800px; margin: 40px auto; font-family: Georgia, serif; font-size: 18px; line-height: 1.6; padding: 20px;\">" + content + "</div>";
            document.head.innerHTML = "";
        })();`;
        t.webview.eval(rs).catch(()=>{});
        setTimeout(stopProgress, 800);
    }
});

// --- DARK MODE ---
function applyDarkModeToActive() {
    const t = getActiveTab();
    if(t && t.webview && !t.isSleeping) {
        const darkCss = isDarkMode ?
            `document.documentElement.style.filter = "invert(1) hue-rotate(180deg)";
             document.documentElement.style.background = "#000";` :
            `document.documentElement.style.filter = "none";
             document.documentElement.style.background = "";`;
        t.webview.eval(darkCss).catch(()=>{});
    }
}
document.getElementById("dark-mode-btn").addEventListener("click", () => {
    isDarkMode = !isDarkMode;
    if (isDarkMode) {
        document.body.style.background = "#222";
        document.getElementById("toolbar").style.background = "#333";
        document.getElementById("toolbar").style.borderColor = "#111";
        document.getElementById("tabs-bar").style.background = "#1a1a1a";
        document.getElementById("bookmarks-bar").style.background = "#2a2a2a";
        document.querySelectorAll(".btn").forEach(b => b.style.color = "#ddd");
        document.getElementById("url-input").style.background = "#444";
        document.getElementById("url-input").style.color = "#fff";
        document.getElementById("search-engine").style.background = "#444";
        document.getElementById("search-engine").style.color = "#fff";
    } else {
        document.body.style.background = "#e0e0e0";
        document.getElementById("toolbar").style.background = "#f8f9fa";
        document.getElementById("toolbar").style.borderColor = "#caced1";
        document.getElementById("tabs-bar").style.background = "#d4d4d4";
        document.getElementById("bookmarks-bar").style.background = "#f1f3f4";
        document.querySelectorAll(".btn").forEach(b => b.style.color = "#333");
        document.getElementById("url-input").style.background = "#fff";
        document.getElementById("url-input").style.color = "#000";
        document.getElementById("search-engine").style.background = "#fff";
        document.getElementById("search-engine").style.color = "#000";
    }
    applyDarkModeToActive();
});

// --- SHORTCUTS ---
window.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        createTab();
    }
    if (e.ctrlKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        if (activeTabId !== null) closeTab(activeTabId);
    }
});

// --- RESIZE ---
window.addEventListener("resize", async () => {
    try {
        const sf = await mainWindow.scaleFactor();
        for (let t of tabs) {
            if (t.webview && !t.isSleeping) {
                t.webview.setSize({
                    type: "Physical",
                    width: Math.floor(window.innerWidth * sf),
                    height: Math.floor((window.innerHeight - headerHeight) * sf)
                }).catch(()=>{});
            }
        }
    } catch(e){}
});

// INIT
window.onload = () => {
    loadBookmarks();
    createTab("https://duckduckgo.com");
};

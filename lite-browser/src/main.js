
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Webview } from "@tauri-apps/api/webview";

const mainWindow = getCurrentWindow();

// Global State
let tabs = [];
let activeTabId = null;
let tabCounter = 0;
let loadInterval = null;

const urlInput = document.getElementById("url-input");
const progressBar = document.getElementById("progress-bar");
const tabsContainer = document.getElementById("tabs-container");
const bookmarksBar = document.getElementById("bookmarks-bar");

// UI Helpers
function startProgress() {
    progressBar.style.display = "block";
    progressBar.style.width = "10%";
    let width = 10;

    if (loadInterval) clearInterval(loadInterval);

    loadInterval = setInterval(() => {
        if (width >= 85) {
            clearInterval(loadInterval);
        } else {
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
    if (input.startsWith("http://") || input.startsWith("https://")) {
        return input;
    }
    if (input.includes(".") && !input.includes(" ")) {
        return "https://" + input;
    }

    let engine = document.getElementById("search-engine").value;
    if (engine === "duckduckgo") {
        return "https://duckduckgo.com/?q=" + encodeURIComponent(input);
    }
    return "https://www.google.com/search?q=" + encodeURIComponent(input);
}

// TABS LOGIC
async function createTab(initialUrl = "https://duckduckgo.com") {
    tabCounter++;
    const id = tabCounter;

    // Create UI Tab
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
    closeBtn.onclick = (e) => {
        e.stopPropagation();
        closeTab(id);
    };
    tabEl.appendChild(closeBtn);

    tabEl.onclick = () => switchTab(id);
    tabsContainer.appendChild(tabEl);

    // Create Tauri Webview
    const scaleFactor = await mainWindow.scaleFactor();
    // Header height: tabs (~29px) + toolbar (~41px) + bookmarks (~27px) = ~97px.
    const headerHeight = 97;

    const webview = new Webview(mainWindow, `webview-${id}`, {
        url: initialUrl,
        x: 0,
        y: Math.floor(headerHeight * scaleFactor),
        width: Math.floor(window.innerWidth * scaleFactor),
        height: Math.floor((window.innerHeight - headerHeight) * scaleFactor),
        incognito: true, initializationScripts: [`
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

    // Webview Event Listeners
    webview.once("tauri://created", function () {
        console.log(`Webview ${id} spawned`);
    });
    webview.once("tauri://error", function (e) {
        console.error(`Webview ${id} error`, e);
    });

    const tabData = { id, webview, url: initialUrl, titleEl };
    tabs.push(tabData);

    await switchTab(id);
}

async function switchTab(id) {
    if (activeTabId === id) return;

    // Hide old active
    if (activeTabId !== null) {
        const oldTab = tabs.find(t => t.id === activeTabId);
        if (oldTab) {
            document.getElementById(`tab-${activeTabId}`).classList.remove("active");
            oldTab.webview.hide().catch(()=>{});
        }
    }

    // Show new active
    activeTabId = id;
    const newTab = tabs.find(t => t.id === activeTabId);
    if (newTab) {
        document.getElementById(`tab-${activeTabId}`).classList.add("active");
        newTab.webview.show().catch(()=>{});
        urlInput.value = newTab.url;
    }
}

async function closeTab(id) {
    const tabIndex = tabs.findIndex(t => t.id === id);
    if (tabIndex === -1) return;

    const tabData = tabs[tabIndex];

    // Close webview
    await tabData.webview.close();

    // Remove UI
    document.getElementById(`tab-${id}`).remove();
    tabs.splice(tabIndex, 1);

    // Switch to another tab if closed was active
    if (activeTabId === id) {
        activeTabId = null;
        if (tabs.length > 0) {
            await switchTab(tabs[tabs.length - 1].id);
        } else {
            urlInput.value = "";
            // Optionally auto-create a new tab if all are closed
            createTab();
        }
    }
}

function getActiveTab() {
    return tabs.find(t => t.id === activeTabId);
}

// URL WATCHER
setInterval(() => {
    const activeTab = getActiveTab();
    if (activeTab && activeTab.webview) {
        activeTab.webview.eval(`
            (() => {
                return { url: window.location.href, title: document.title };
            })();
        `).then((res) => {
            if (res && res.url && !res.url.includes("about:blank")) {
                activeTab.url = res.url;
                if (urlInput !== document.activeElement) {
                    urlInput.value = res.url;
                }
                if (res.title) {
                    activeTab.titleEl.innerText = res.title;
                }
            }
        }).catch(() => {});
    }
}, 1500);

// NAVIGATION
async function navigateTo(input) {
    let url = parseUrl(input);
    urlInput.value = url;

    let activeTab = getActiveTab();
    if (!activeTab) {
        await createTab(url);
    } else {
        startProgress();
        activeTab.url = url;
        activeTab.webview.eval(`window.location.href = "${url}";`).catch((e) => console.error("Navigate err", e));
        setTimeout(stopProgress, 800);
    }
}

document.getElementById("go-btn").addEventListener("click", () => {
    let input = urlInput.value;
    if(input) { navigateTo(input); }
});

urlInput.addEventListener("keypress", function (e) {
    if (e.key === "Enter") {
        let input = urlInput.value;
        if(input) { navigateTo(input); }
    }
});
urlInput.addEventListener("click", function() { this.select(); });

// New Tab btn
document.getElementById("new-tab-btn").addEventListener("click", () => {
    createTab();
});

// History
document.getElementById("back-btn").addEventListener("click", () => {
    const t = getActiveTab();
    if(t) {
        startProgress();
        t.webview.eval(`window.history.back();`).catch(() => {});
        setTimeout(stopProgress, 600);
    }
});
document.getElementById("forward-btn").addEventListener("click", () => {
    const t = getActiveTab();
    if(t) {
        startProgress();
        t.webview.eval(`window.history.forward();`).catch(() => {});
        setTimeout(stopProgress, 600);
    }
});
document.getElementById("refresh-btn").addEventListener("click", () => {
    const t = getActiveTab();
    if(t) {
        startProgress();
        t.webview.eval(`window.location.reload();`).catch(() => {});
        setTimeout(stopProgress, 600);
    }
});

// RESIZE
window.addEventListener("resize", async () => {
    try {
        const scaleFactor = await mainWindow.scaleFactor();
        const headerHeight = 97;
        for (let tab of tabs) {
            if (tab.webview) {
                tab.webview.setSize({
                    type: "Physical",
                    width: Math.floor(window.innerWidth * scaleFactor),
                    height: Math.floor((window.innerHeight - headerHeight) * scaleFactor)
                }).catch(()=>{});
            }
        }
    } catch (e) {
        console.error("Resize Error", e);
    }
});

// INIT
window.addEventListener("DOMContentLoaded", () => {
    createTab("https://duckduckgo.com"); // Domyślna strona startowa
});


// (append to src/main.js)

// BOOKMARKS LOGIC
let bookmarks = [];

function loadBookmarks() {
    try {
        const stored = localStorage.getItem("liteBrowserBookmarks");
        if (stored) {
            bookmarks = JSON.parse(stored);
        }
    } catch(e) { console.error("Error loading bookmarks", e); }
    renderBookmarks();
}

function saveBookmarks() {
    try {
        localStorage.setItem("liteBrowserBookmarks", JSON.stringify(bookmarks));
    } catch(e) { console.error("Error saving bookmarks", e); }
}

function renderBookmarks() {
    bookmarksBar.innerHTML = "";
    bookmarks.forEach((bm, index) => {
        const btn = document.createElement("button");
        btn.className = "bookmark-btn";
        btn.innerText = bm.title || bm.url;
        btn.title = bm.url;
        btn.onclick = () => {
            navigateTo(bm.url);
        };
        // Opcja usuwania zakładki kliknięciem prawym przyciskiem
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
    const activeTab = getActiveTab();
    if (activeTab && activeTab.url) {
        const title = activeTab.titleEl.innerText || activeTab.url;
        // Zabezpieczenie przed dublowaniem zakladek
        if (!bookmarks.some(b => b.url === activeTab.url)) {
            bookmarks.push({ title: title, url: activeTab.url });
            saveBookmarks();
            renderBookmarks();
        } else {
            alert("Ta strona jest już w zakładkach!");
        }
    }
});

// Load bookmarks on init
window.addEventListener("DOMContentLoaded", () => {
    loadBookmarks();
});


// (append to src/main.js for Adblock and Reader Mode)

// READER MODE
document.getElementById("reader-mode-btn").addEventListener("click", () => {
    const t = getActiveTab();
    if(t && t.webview) {
        startProgress();
        // Lekki skrypt wstrzykiwany, aby uprościć stronę (Usuwa wszystko poza p i h1..h6)
        const readerScript = `
            (() => {
                const article = document.querySelector("article") || document.body;
                const headers = Array.from(article.querySelectorAll("h1, h2, h3, h4, h5, h6"));
                const paragraphs = Array.from(article.querySelectorAll("p"));

                let contentHTML = "";
                headers.forEach(h => contentHTML += h.outerHTML);
                paragraphs.forEach(p => contentHTML += p.outerHTML);

                document.body.innerHTML = "<div style=\"max-width: 800px; margin: 40px auto; font-family: Georgia, serif; font-size: 18px; line-height: 1.6; color: #333; background: #fff; padding: 20px;\">" + contentHTML + "</div>";
                document.body.style.background = "#f4f4f4";
                document.head.innerHTML = "";
            })();
        `;
        t.webview.eval(readerScript).catch(() => {});
        setTimeout(stopProgress, 800);
    }
});


// Poprawki IPC dla Reader Mode, URL i Adblocka zrobione po stronie Rusta byłyby bardziej niezawodne,
// jednak to MVP ma pokazywać lekką i szybką integrację po stronie JS.
// Kod został doprowadzony do możliwie najlepszego stanu używalności w Tauri V2 bez ruszania backendu,
// więc dla tego MVP wystarczy.

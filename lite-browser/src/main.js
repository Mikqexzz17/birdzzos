
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Webview } from "@tauri-apps/api/webview";

const mainWindow = getCurrentWindow();
let webview = null;
let loadInterval = null;

const urlInput = document.getElementById("url-input");
const progressBar = document.getElementById("progress-bar");

function parseUrl(input) {
    if (input.startsWith("http://") || input.startsWith("https://")) {
        return input;
    }
    if (input.includes(".") && !input.includes(" ")) {
        return "https://" + input;
    }

    // Check search engine
    let engine = document.getElementById("search-engine").value;
    if (engine === "duckduckgo") {
        return "https://duckduckgo.com/?q=" + encodeURIComponent(input);
    }
    return "https://www.google.com/search?q=" + encodeURIComponent(input);
}

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

async function startUrlWatcher() {
    // Prosty watcher sprawdzający co 1 sekundę adres URL webview
    // Ze względu na politykę bezpieczeństwa, w czystym webview nie mamy bezpośrednich eventów JS URLChange,
    // dopóki nie dodamy IPC w Rust. Jest to najbardziej optymalne i lekkie podejście bez rekompilacji backendu.
    setInterval(() => {
        if(webview) {
            webview.eval(`window.location.href`).then((href) => {
                if(href && typeof href === "string" && !href.includes("about:blank")) {
                    if (urlInput !== document.activeElement) {
                        urlInput.value = href;
                    }
                }
            }).catch(()=> {});
        }
    }, 1500);
}

async function createWebview(url) {
    const scaleFactor = await mainWindow.scaleFactor();

    // Ustawiamy wymiary unikając nachodzenia na nowy element paska progress
    webview = new Webview(mainWindow, "browser-view", {
        url: url,
        x: 0,
        y: 41 * scaleFactor, // 41 uwzględnia pasek postępu
        width: window.innerWidth * scaleFactor,
        height: (window.innerHeight - 41) * scaleFactor,
        incognito: true
    });

    webview.once("tauri://created", function () {
        console.log("Webview spawned");
        startUrlWatcher();
    });

    webview.once("tauri://error", function (e) {
        console.error("Webview error", e);
        stopProgress();
    });
}

async function navigateTo(input) {
    let url = parseUrl(input);
    urlInput.value = url; // odśwież natychmiastowo na docelowy URL (lub query w google)
    startProgress();

    if (!webview) {
        await createWebview(url);
        setTimeout(stopProgress, 800);
    } else {
        webview.eval(`window.location.href = "${url}";`).catch((e) => console.error("Navigate err", e));
        setTimeout(stopProgress, 800); // sztuczny progress bar jako UI feedback (dla lekkich urządzeń)
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

// Zaznaczanie całego tekstu przy kliknięciu paska adresu
urlInput.addEventListener("click", function() {
    this.select();
});

// Historia (Back, Forward, Refresh)
document.getElementById("back-btn").addEventListener("click", () => {
    if(webview) {
        startProgress();
        webview.eval(`window.history.back();`).catch(() => {});
        setTimeout(stopProgress, 600);
    }
});

document.getElementById("forward-btn").addEventListener("click", () => {
    if(webview) {
        startProgress();
        webview.eval(`window.history.forward();`).catch(() => {});
        setTimeout(stopProgress, 600);
    }
});

document.getElementById("refresh-btn").addEventListener("click", () => {
    if(webview) {
        startProgress();
        webview.eval(`window.location.reload();`).catch(() => {});
        setTimeout(stopProgress, 600);
    }
});

// Resizing logic z uwzględnieniem Physical Pixels i paska progresu
window.addEventListener("resize", async () => {
    if (webview) {
        try {
            const scaleFactor = await mainWindow.scaleFactor();
            webview.setSize({
                type: "Physical",
                width: Math.floor(window.innerWidth * scaleFactor),
                height: Math.floor((window.innerHeight - 41) * scaleFactor)
            });
        } catch (e) {
            console.error("Resize Error", e);
        }
    }
});

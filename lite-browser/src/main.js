
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Webview } from "@tauri-apps/api/webview";

const mainWindow = getCurrentWindow();
let webview = null;

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

// Inicjalizacja osadzonego webview
async function createWebview(url) {
    const scaleFactor = await mainWindow.scaleFactor();
    webview = new Webview(mainWindow, "browser-view", {
        url: url,
        x: 0,
        y: 40 * scaleFactor,
        width: window.innerWidth * scaleFactor,
        height: (window.innerHeight - 40) * scaleFactor,
        incognito: true
    });

    webview.once("tauri://created", function () {
        console.log("Webview spawned");
    });
    webview.once("tauri://error", function (e) {
        console.error("Webview error", e);
    });
}

async function navigateTo(input) {
    let url = parseUrl(input);

    if (!webview) {
        await createWebview(url);
    } else {
        // Evaluate JS na istniejącym webview (zamiast niszczyć) w celu zachowania historii
        webview.eval(`window.location.href = "${url}";`).catch((e) => console.error("Navigate err", e));
    }
}

document.getElementById("go-btn").addEventListener("click", () => {
    let input = document.getElementById("url-input").value;
    if(input) { navigateTo(input); }
});

document.getElementById("url-input").addEventListener("keypress", function (e) {
    if (e.key === "Enter") {
        let input = document.getElementById("url-input").value;
        if(input) { navigateTo(input); }
    }
});

// Historia (Back, Forward, Refresh)
document.getElementById("back-btn").addEventListener("click", () => {
    if(webview) {
        webview.eval(`window.history.back();`).catch(() => {});
    }
});

document.getElementById("forward-btn").addEventListener("click", () => {
    if(webview) {
        webview.eval(`window.history.forward();`).catch(() => {});
    }
});

document.getElementById("refresh-btn").addEventListener("click", () => {
    if(webview) {
        webview.eval(`window.location.reload();`).catch(() => {});
    }
});

// Resizing logic z uwzględnieniem Physical Pixels
window.addEventListener("resize", async () => {
    if (webview) {
        try {
            const scaleFactor = await mainWindow.scaleFactor();
            webview.setSize({
                type: "Physical",
                width: Math.floor(window.innerWidth * scaleFactor),
                height: Math.floor((window.innerHeight - 40) * scaleFactor)
            });
        } catch (e) {
            console.error("Resize Error", e);
        }
    }
});

const APP_VERSION = "0.1.1-pwa";
const STORAGE = {
  interval: "wma_interval",
  rarity: "wma_rarity",
  historySort: "wma_history_sort"
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const isAndroid = /android/i.test(navigator.userAgent);
const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;

let deferredInstallPrompt = null;
let waitingWorker = null;
let deploymentVersion = null;

function platformName() {
  if (isIOS) return "iPhone / iPad";
  if (isAndroid) return "Android";
  return "Web";
}

function renderOnlineState() {
  const badge = $("#onlineBadge");
  const online = navigator.onLine;
  badge.textContent = online ? "En ligne" : "Hors ligne";
  badge.className = `badge ${online ? "online" : "offline"}`;
}

function renderInstallState() {
  const button = $("#installButton");
  const title = $("#installTitle");
  const help = $("#installHelp");

  if (isStandalone) {
    title.textContent = "App installée";
    help.textContent = "WikiMaster Auto est déjà ouverte comme une application.";
    button.textContent = "Installée";
    button.disabled = true;
    button.style.opacity = ".55";
    return;
  }

  if (isIOS) {
    title.textContent = "Installer sur iPhone";
    help.textContent = "Safari → Partager → Ajouter à l’écran d’accueil.";
    button.textContent = "Voir comment";
    return;
  }

  title.textContent = "Installer l’app";
  help.textContent = deferredInstallPrompt
    ? "Installation disponible directement depuis le navigateur."
    : "Le navigateur proposera l’installation dès qu’elle sera disponible.";
  button.textContent = "Installer";
}

function setupSettings() {
  const interval = localStorage.getItem(STORAGE.interval) || "100";
  $("#intervalSelect").value = interval;
  $("#intervalSelect").addEventListener("change", (event) => {
    localStorage.setItem(STORAGE.interval, event.target.value);
  });

  const savedRank = Number(localStorage.getItem(STORAGE.rarity) ?? 4);
  setRarity(savedRank);
  $$("#rarityPicker button").forEach((button) => {
    button.addEventListener("click", () => {
      const rank = Number(button.dataset.rank);
      localStorage.setItem(STORAGE.rarity, String(rank));
      setRarity(rank);
    });
  });

  const sort = localStorage.getItem(STORAGE.historySort) || "recent";
  $("#historySort").value = sort;
  $("#historySort").addEventListener("change", (event) => {
    localStorage.setItem(STORAGE.historySort, event.target.value);
  });
}

function setRarity(rank) {
  $$("#rarityPicker button").forEach((button) => {
    const active = Number(button.dataset.rank) === rank;
    button.classList.toggle("active", active);
    button.setAttribute("aria-checked", active ? "true" : "false");
  });
  const selected = $$("#rarityPicker button").find(
    (button) => Number(button.dataset.rank) === rank
  );
  const code = selected?.dataset.code || "UR";
  $("#rarityHint").textContent =
    code === "L" ? "Notification uniquement pour les cartes L" : `Notification à partir de ${code}`;
}

function setupActions() {
  $("#openWikiMasters").addEventListener("click", () => {
    window.open("https://www.wiki-masters.com/login", "_blank", "noopener,noreferrer");
  });

  $("#installButton").addEventListener("click", async () => {
    if (isStandalone) return;

    if (isIOS) {
      alert("Sur iPhone : ouvre cette page dans Safari, touche Partager, puis « Ajouter à l’écran d’accueil ».");
      return;
    }

    if (!deferredInstallPrompt) {
      alert("L’installation n’est pas encore proposée par ce navigateur. Ouvre le menu du navigateur puis cherche « Installer l’application » ou « Ajouter à l’écran d’accueil ».");
      return;
    }

    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    renderInstallState();
  });

  $("#updateButton").addEventListener("click", () => {
    if (waitingWorker) {
      waitingWorker.postMessage({ type: "SKIP_WAITING" });
    } else {
      window.location.reload();
    }
  });
}

async function setupServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  const registration = await navigator.serviceWorker.register("./sw.js", { scope: "./" });

  if (registration.waiting) {
    showUpdate(registration.waiting);
  }

  registration.addEventListener("updatefound", () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener("statechange", () => {
      if (worker.state === "installed" && navigator.serviceWorker.controller) {
        showUpdate(worker);
      }
    });
  });

  navigator.serviceWorker.addEventListener("controllerchange", () => {
    window.location.reload();
  });

  registration.update().catch(() => {});
  setInterval(() => registration.update().catch(() => {}), 5 * 60 * 1000);
}

function showUpdate(worker = null) {
  if (worker) waitingWorker = worker;
  $("#updateBanner").hidden = false;
}

async function checkDeploymentVersion() {
  try {
    const response = await fetch(`./version.json?t=${Date.now()}`, {
      cache: "no-store"
    });
    if (!response.ok) return;

    const payload = await response.json();
    const version = String(payload.version || "").trim();
    if (!version) return;

    if (deploymentVersion === null) {
      deploymentVersion = version;
      $("#versionLabel").textContent =
        `WikiMaster Auto ${APP_VERSION} • ${version.slice(0, 7)}`;
      return;
    }

    if (deploymentVersion !== version) {
      showUpdate();
    }
  } catch (_) {
    // Offline is expected for an installable PWA.
  }
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  renderInstallState();
});

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  renderInstallState();
});

window.addEventListener("online", renderOnlineState);
window.addEventListener("offline", renderOnlineState);

$("#versionLabel").textContent = `WikiMaster Auto ${APP_VERSION}`;
$("#platformLabel").textContent = platformName();

renderOnlineState();
renderInstallState();
setupSettings();
setupActions();
setupServiceWorker().catch(() => {});
checkDeploymentVersion();
setInterval(checkDeploymentVersion, 5 * 60 * 1000);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") checkDeploymentVersion();
});

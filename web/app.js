const APP_VERSION = "0.3.0-pwa";
const BACKEND_URL = String(window.WMA_BACKEND_URL || "").replace(/\/$/, "");

const STORAGE = {
  credential: "wma_backend_credential",
  interval: "wma_interval",
  rarity: "wma_rarity",
  historySort: "wma_history_sort"
};

const RARITY_RANK = { C: 0, PC: 1, R: 2, SR: 3, UR: 4, L: 5 };

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
let currentStatus = null;
let historyItems = [];
let activePairCode = null;
let pairingPoll = null;
let captchaToken = "";
let turnstileWidgetId = null;
let toastTimer = null;

function platformName() {
  if (isIOS) return "iPhone / iPad";
  if (isAndroid) return "Android";
  return "Web";
}

function credential() {
  return localStorage.getItem(STORAGE.credential) || "";
}

function apiUrl(action, params = {}) {
  if (!BACKEND_URL) return "";
  const url = new URL(`${BACKEND_URL}/api/wma`);
  url.searchParams.set("action", action);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

async function api(action, options = {}, auth = true) {
  if (!BACKEND_URL) throw new Error("Backend non configuré");
  const headers = new Headers(options.headers || {});
  headers.set("Accept", "application/json");
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (auth) {
    const token = credential();
    if (!token) throw new Error("Compte non appairé");
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(apiUrl(action, options.params), {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    cache: "no-store"
  });

  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch {}

  if (!response.ok) {
    const error = new Error(payload.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

function toast(message) {
  const box = $("#toast");
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    box.hidden = true;
  }, 3600);
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
    help.textContent = "WikiMaster Auto est ouverte comme une application.";
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
    : "Menu du navigateur → Installer l’application.";
  button.textContent = "Installer";
}

function renderBackendUnavailable() {
  currentStatus = null;
  $("#accountStatus").textContent = "Backend à déployer";
  $("#accountDetail").textContent =
    "La PWA est prête, mais aucune URL backend n’est encore configurée.";
  $("#accountDot").className = "status-dot offline";
  $("#connectButton").disabled = true;
  $("#automationToggle").disabled = true;
  $("#automationSwitch").classList.add("disabled");
  $("#openNowButton").disabled = true;
  $("#pushButton").disabled = true;
}

function renderStatus(status) {
  currentStatus = status;
  const connected = Boolean(status?.connected);

  $("#accountDot").className = `status-dot ${connected ? "connected" : "offline"}`;
  $("#accountStatus").textContent = connected
    ? "Compte WikiMasters connecté"
    : "Compte non connecté";
  $("#accountDetail").textContent = connected
    ? (status.email ? status.email : "Session WikiMasters active")
    : "Appaire ton compte une seule fois pour activer l’automatisation.";

  $("#connectButton").hidden = connected;
  $("#disconnectButton").hidden = !connected;
  $("#pairPanel").hidden = connected || !activePairCode;

  const toggle = $("#automationToggle");
  toggle.disabled = !connected;
  toggle.checked = Boolean(status?.settings?.enabled);
  $("#automationSwitch").classList.toggle("disabled", !connected);
  $("#openNowButton").disabled = !connected;
  $("#pushButton").disabled = !connected;

  if (status?.settings?.intervalMinutes) {
    $("#intervalSelect").value = String(status.settings.intervalMinutes);
    localStorage.setItem(STORAGE.interval, String(status.settings.intervalMinutes));
  }

  if (Number.isInteger(status?.settings?.minRank)) {
    setRarity(status.settings.minRank, false);
    localStorage.setItem(STORAGE.rarity, String(status.settings.minRank));
  }

  renderNextRun(status);
  renderLastRun(status);
}

function renderNextRun(status) {
  const el = $("#nextRunText");
  if (!status?.connected || !status?.settings?.enabled) {
    el.textContent = "Automatisation désactivée";
    return;
  }
  if (!status.nextRunAt) {
    el.textContent = "Planification en cours…";
    return;
  }

  const target = Number(status.nextRunAt);
  const delta = Math.max(0, target - Date.now());
  const minutes = Math.ceil(delta / 60000);
  const time = new Date(target).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
  el.textContent = `vers ${time} • dans ~${formatMinutes(minutes)}`;
}

function renderLastRun(status) {
  const el = $("#lastRunText");
  if (!status?.lastRunAt) {
    el.textContent = "Aucune ouverture serveur enregistrée.";
    return;
  }
  const when = new Date(Number(status.lastRunAt)).toLocaleString();
  el.textContent = status.lastError
    ? `Dernier essai : ${when} • erreur : ${status.lastError}`
    : `Dernière ouverture serveur : ${when}`;
}

function formatMinutes(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function setRarity(rank, persist = true) {
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
    code === "L"
      ? "Notification uniquement pour les cartes L"
      : `Notification à partir de ${code}`;

  if (persist) localStorage.setItem(STORAGE.rarity, String(rank));
}

async function refreshStatus({ quiet = false } = {}) {
  if (!BACKEND_URL) {
    renderBackendUnavailable();
    return;
  }

  if (!credential()) {
    renderStatus({
      connected: false,
      settings: {
        enabled: false,
        intervalMinutes: Number(localStorage.getItem(STORAGE.interval) || 100),
        minRank: Number(localStorage.getItem(STORAGE.rarity) ?? 4)
      }
    });
    return;
  }

  try {
    const status = await api("status");
    renderStatus(status);
    if (status.connected) {
      stopPairPolling();
      activePairCode = null;
      $("#pairPanel").hidden = true;
      await refreshHistory({ quiet: true });
    }
  } catch (error) {
    if (error.status === 401) {
      localStorage.removeItem(STORAGE.credential);
      renderStatus({ connected: false, settings: { enabled: false } });
      if (!quiet) toast("Connexion locale expirée. Reconnecte le compte.");
      return;
    }
    if (!quiet) toast("Backend momentanément inaccessible.");
  }
}

async function waitForTurnstile(timeoutMs = 10000) {
  const started = Date.now();
  while (!window.turnstile) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("CAPTCHA indisponible");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return window.turnstile;
}

async function renderTurnstile() {
  captchaToken = "";
  const container = $("#turnstileWidget");
  if (!container) return;

  const turnstile = await waitForTurnstile();

  if (turnstileWidgetId !== null) {
    try { turnstile.remove(turnstileWidgetId); } catch {}
    turnstileWidgetId = null;
  }

  container.replaceChildren();
  turnstileWidgetId = turnstile.render(container, {
    sitekey: "0x4AAAAAAEW_2IAWonrk_N5i",
    theme: "auto",
    callback(token) {
      captchaToken = token;
      $("#captchaHelp").textContent = "CAPTCHA validé ✓";
    },
    "expired-callback"() {
      captchaToken = "";
      $("#captchaHelp").textContent = "Le CAPTCHA a expiré. Valide-le à nouveau.";
    },
    "error-callback"(code) {
      captchaToken = "";
      const suffix = code ? ` (erreur ${code})` : "";
      $("#captchaHelp").textContent =
        "CAPTCHA WikiMasters refusé sur ce domaine" + suffix + ".";
      console.error("Turnstile error", code);
    }
  });
}

async function beginPairing() {
  try {
    const result = await api("pair-start", { method: "POST" }, false);
    localStorage.setItem(STORAGE.credential, result.credential);
    activePairCode = result.pairCode || null;

    $("#pairPanel").hidden = false;
    $("#connectButton").hidden = true;
    $("#accountStatus").textContent = "Connexion WikiMasters";
    $("#accountDetail").textContent =
      "Entre tes identifiants WikiMasters puis valide le CAPTCHA.";

    $("#wikiPassword").value = "";
    $("#captchaHelp").textContent = "Valide le CAPTCHA puis touche “Se connecter”.";
    await renderTurnstile();
  } catch (error) {
    console.error(error);
    toast("Impossible de préparer la connexion.");
  }
}

async function loginWikiMasters() {
  const email = $("#wikiEmail").value.trim();
  const passwordInput = $("#wikiPassword");
  const password = passwordInput.value;
  const button = $("#loginWikiButton");

  if (!email || !password) {
    toast("Entre ton email et ton mot de passe WikiMasters.");
    return;
  }
  if (!captchaToken) {
    toast("Valide d’abord le CAPTCHA.");
    return;
  }

  const oldText = button.textContent;
  button.disabled = true;
  button.textContent = "Connexion…";

  try {
    const status = await api("login", {
      method: "POST",
      body: { email, password, captchaToken }
    });

    passwordInput.value = "";
    captchaToken = "";
    currentStatus = status;
    renderStatus(status);
    $("#pairPanel").hidden = true;
    $("#connectButton").hidden = true;
    toast("Compte WikiMasters connecté ✓");
    await refreshHistory({ quiet: true });
  } catch (error) {
    passwordInput.value = "";
    captchaToken = "";
    const message =
      error.payload?.message ||
      (error.payload?.error === "login_failed"
        ? "Connexion refusée par WikiMasters."
        : "Connexion impossible.");
    $("#captchaHelp").textContent = message;
    toast(message);
    try {
      if (window.turnstile && turnstileWidgetId !== null) {
        window.turnstile.reset(turnstileWidgetId);
      }
    } catch {}
  } finally {
    button.disabled = false;
    button.textContent = oldText;
  }
}

function cancelLogin() {
  $("#pairPanel").hidden = true;
  $("#connectButton").hidden = false;
  $("#wikiPassword").value = "";
  captchaToken = "";
  try {
    if (window.turnstile && turnstileWidgetId !== null) {
      window.turnstile.remove(turnstileWidgetId);
    }
  } catch {}
  turnstileWidgetId = null;
}

async function updateSettings(patch) {
  if (!currentStatus?.connected) return;
  try {
    const status = await api("settings", {
      method: "POST",
      body: patch
    });
    renderStatus(status);
  } catch {
    toast("Impossible d’enregistrer le réglage.");
    await refreshStatus({ quiet: true });
  }
}

async function openNow() {
  const button = $("#openNowButton");
  button.disabled = true;
  const oldText = button.textContent;
  button.textContent = "Ouverture en cours…";

  try {
    const result = await api("open-now", { method: "POST" });
    const count = Array.isArray(result.cards) ? result.cards.length : 0;
    toast(`${result.packsOpened || 0} booster(s), ${count} carte(s) récupérée(s).`);
    await Promise.all([
      refreshStatus({ quiet: true }),
      refreshHistory({ quiet: true })
    ]);
  } catch (error) {
    toast(error.payload?.error || "L’ouverture a échoué.");
  } finally {
    button.textContent = oldText;
    button.disabled = !currentStatus?.connected;
  }
}

async function disconnectAccount() {
  if (!credential()) return;
  try {
    await api("disconnect", { method: "POST" });
  } catch {}
  localStorage.removeItem(STORAGE.credential);
  activePairCode = null;
  historyItems = [];
  renderHistory();
  renderStatus({
    connected: false,
    settings: {
      enabled: false,
      intervalMinutes: Number(localStorage.getItem(STORAGE.interval) || 100),
      minRank: Number(localStorage.getItem(STORAGE.rarity) ?? 4)
    }
  });
  toast("Compte déconnecté de WikiMaster Auto.");
}

async function refreshHistory({ quiet = false } = {}) {
  if (!credential() || !currentStatus?.connected) {
    historyItems = [];
    renderHistory();
    return;
  }

  try {
    const result = await api("history", {
      params: { offset: 0, limit: 200 }
    });
    historyItems = Array.isArray(result.items) ? result.items : [];
    $("#historyCount").textContent =
      `${result.count || historyItems.length} carte${(result.count || historyItems.length) > 1 ? "s" : ""}`;
    renderHistory();
  } catch {
    if (!quiet) toast("Impossible de charger l’historique.");
  }
}

function sortedHistory() {
  const items = [...historyItems];
  const sort = $("#historySort").value;

  if (sort === "old") {
    items.sort((a, b) => Number(a.pulledAt || 0) - Number(b.pulledAt || 0));
  } else if (sort === "rarity-desc") {
    items.sort((a, b) =>
      (RARITY_RANK[b.rarity] ?? 0) - (RARITY_RANK[a.rarity] ?? 0) ||
      Number(b.pulledAt || 0) - Number(a.pulledAt || 0)
    );
  } else if (sort === "rarity-asc") {
    items.sort((a, b) =>
      (RARITY_RANK[a.rarity] ?? 0) - (RARITY_RANK[b.rarity] ?? 0) ||
      Number(b.pulledAt || 0) - Number(a.pulledAt || 0)
    );
  } else if (sort === "name") {
    items.sort((a, b) =>
      String(a.title || "").localeCompare(String(b.title || ""), "fr")
    );
  } else {
    items.sort((a, b) => Number(b.pulledAt || 0) - Number(a.pulledAt || 0));
  }
  return items;
}

function renderHistory() {
  const list = $("#historyList");
  const empty = $("#historyEmpty");
  list.replaceChildren();

  const items = sortedHistory();
  empty.hidden = items.length > 0;

  if (!items.length) {
    if (!currentStatus?.connected) {
      $("#historyCount").textContent = "0 carte";
    }
    return;
  }

  for (const card of items) {
    const article = document.createElement("article");
    article.className = "history-card";

    const imageWrap = document.createElement("div");
    imageWrap.className = "history-image-wrap";

    const img = document.createElement("img");
    img.className = "history-image";
    img.alt = "";
    img.loading = "lazy";
    if (card.imageUrl) {
      img.src = card.imageUrl;
      img.addEventListener("error", () => {
        recoverWikipediaImage(card.title, img);
      }, { once: true });
    } else {
      recoverWikipediaImage(card.title, img);
    }
    imageWrap.appendChild(img);

    const body = document.createElement("div");
    body.className = "history-card-body";

    const top = document.createElement("div");
    top.className = "history-card-top";

    const rarity = document.createElement("span");
    rarity.className = `rarity-badge rarity-${String(card.rarity || "C").toLowerCase()}`;
    rarity.textContent = card.rarity || "C";

    const date = document.createElement("span");
    date.className = "history-date";
    date.textContent = card.pulledAt
      ? new Date(Number(card.pulledAt)).toLocaleString()
      : "";

    top.append(rarity, date);

    const title = document.createElement("strong");
    title.className = "history-title";
    title.textContent = card.title || "Carte";

    body.append(top, title);

    if (card.wikipediaUrl) {
      const link = document.createElement("a");
      link.className = "history-link";
      link.href = card.wikipediaUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Voir dans le navigateur";
      body.appendChild(link);
    }

    article.append(imageWrap, body);
    list.appendChild(article);
  }
}

async function recoverWikipediaImage(title, img) {
  if (!title) {
    img.src = "./logo.svg";
    return;
  }

  try {
    const url = new URL("https://fr.wikipedia.org/w/api.php");
    url.searchParams.set("action", "query");
    url.searchParams.set("format", "json");
    url.searchParams.set("formatversion", "2");
    url.searchParams.set("origin", "*");
    url.searchParams.set("redirects", "1");
    url.searchParams.set("prop", "pageimages");
    url.searchParams.set("piprop", "thumbnail");
    url.searchParams.set("pithumbsize", "900");
    url.searchParams.set("titles", title);

    const response = await fetch(url);
    const json = await response.json();
    const source = json?.query?.pages?.[0]?.thumbnail?.source;
    img.src = source || "./logo.svg";
  } catch {
    img.src = "./logo.svg";
  }
}

function base64UrlToUint8Array(value) {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}

async function enablePush() {
  if (!currentStatus?.connected) {
    toast("Connecte d’abord ton compte WikiMasters.");
    return;
  }
  if (!("Notification" in window) || !("PushManager" in window)) {
    toast("Les notifications push ne sont pas disponibles ici.");
    return;
  }
  if (isIOS && !isStandalone) {
    toast("Sur iPhone, installe d’abord la PWA sur l’écran d’accueil.");
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    toast("Notifications non autorisées.");
    return;
  }

  try {
    const keyResult = await api("vapid-key", {}, false);
    if (!keyResult.publicKey) throw new Error("VAPID non configuré");

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(keyResult.publicKey)
      });
    }

    await api("push-subscribe", {
      method: "POST",
      body: { subscription: subscription.toJSON() }
    });
    $("#pushButton").textContent = "Activées";
    toast("Notifications activées.");
  } catch (error) {
    toast(`Notifications indisponibles : ${error.message}`);
  }
}

function setupSettings() {
  const interval = localStorage.getItem(STORAGE.interval) || "100";
  $("#intervalSelect").value = interval;
  $("#intervalSelect").addEventListener("change", async (event) => {
    const value = Number(event.target.value);
    localStorage.setItem(STORAGE.interval, String(value));
    await updateSettings({ intervalMinutes: value });
  });

  const savedRank = Number(localStorage.getItem(STORAGE.rarity) ?? 4);
  setRarity(savedRank, false);
  $$("#rarityPicker button").forEach((button) => {
    button.addEventListener("click", async () => {
      const rank = Number(button.dataset.rank);
      setRarity(rank);
      await updateSettings({ minRank: rank });
    });
  });

  const sort = localStorage.getItem(STORAGE.historySort) || "recent";
  $("#historySort").value = sort;
  $("#historySort").addEventListener("change", (event) => {
    localStorage.setItem(STORAGE.historySort, event.target.value);
    renderHistory();
  });

  $("#automationToggle").addEventListener("change", async (event) => {
    await updateSettings({ enabled: event.target.checked });
  });
}

function setupActions() {
  $("#connectButton").addEventListener("click", beginPairing);
  $("#loginWikiButton").addEventListener("click", loginWikiMasters);
  $("#cancelLoginButton").addEventListener("click", cancelLogin);
  $("#wikiPassword").addEventListener("keydown", (event) => {
    if (event.key === "Enter") loginWikiMasters();
  });

  $("#disconnectButton").addEventListener("click", disconnectAccount);
  $("#openNowButton").addEventListener("click", openNow);
  $("#pushButton").addEventListener("click", enablePush);
  $("#refreshHistory").addEventListener("click", () => refreshHistory());

  $("#installButton").addEventListener("click", async () => {
    if (isStandalone) return;

    if (isIOS) {
      alert("Sur iPhone : ouvre cette page dans Safari, touche Partager, puis « Ajouter à l’écran d’accueil ».");
      return;
    }

    if (!deferredInstallPrompt) {
      alert("Ouvre le menu du navigateur puis choisis « Installer l’application » ou « Ajouter à l’écran d’accueil ».");
      return;
    }

    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    renderInstallState();
  });

  $("#updateButton").addEventListener("click", () => {
    if (waitingWorker) waitingWorker.postMessage({ type: "SKIP_WAITING" });
    else window.location.reload();
  });
}

async function setupServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  const registration = await navigator.serviceWorker.register("./sw.js", {
    scope: "./"
  });

  if (registration.waiting) showUpdate(registration.waiting);

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

    if (deploymentVersion !== version) showUpdate();
  } catch {}
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

window.addEventListener("online", () => {
  renderOnlineState();
  refreshStatus({ quiet: true });
});
window.addEventListener("offline", renderOnlineState);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    checkDeploymentVersion();
    refreshStatus({ quiet: true });
  }
});

$("#versionLabel").textContent = `WikiMaster Auto ${APP_VERSION}`;
$("#platformLabel").textContent = platformName();

renderOnlineState();
renderInstallState();
setupSettings();
setupActions();
setupServiceWorker().catch(() => {});
checkDeploymentVersion();
refreshStatus();
setInterval(checkDeploymentVersion, 5 * 60 * 1000);
setInterval(() => {
  if (currentStatus) renderNextRun(currentStatus);
}, 30 * 1000);

const APP_VERSION = "0.5.13-pwa";
const BACKEND_URL = String(window.WMA_BACKEND_URL || "").replace(/\/$/, "");

const STORAGE = {
  credential: "wma_backend_credential",
  interval: "wma_interval",
  rarity: "wma_rarity",
  historySort: "wma_history_sort",
  seenCardsThrough: "wma_seen_cards_through"
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
let toastTimer = null;
let revealCards = [];
let revealIndex = 0;
let revealCutoff = 0;
let revealCheckedThisLaunch = false;

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

  renderDiagnostic(status);
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

async function beginPairing() {
  try {
    const result = await api("pair-start", { method: "POST" }, false);
    localStorage.setItem(STORAGE.credential, result.credential);
    activePairCode = result.pairCode;

    $("#pairCode").textContent = result.pairCode;
    $("#pairPanel").hidden = false;
    $("#connectButton").hidden = true;
    $("#accountStatus").textContent = "Appairage en attente";
    $("#accountDetail").textContent =
      "Fais l’étape PC une seule fois. Le téléphone détectera automatiquement la connexion.";
    startPairPolling();
  } catch (error) {
    console.error(error);
    toast("Impossible de préparer l’appairage.");
  }
}

function startPairPolling() {
  stopPairPolling();
  pairingPoll = setInterval(() => refreshStatus({ quiet: true }), 2000);
}

function stopPairPolling() {
  if (pairingPoll) clearInterval(pairingPoll);
  pairingPoll = null;
}

function cancelLogin() {
  stopPairPolling();
  activePairCode = null;
  $("#pairPanel").hidden = true;
  $("#connectButton").hidden = false;
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
  const openingStarted = Date.now();
  button.textContent = "Ouverture en cours… 0 s";
  const openingTimer = setInterval(() => {
    button.textContent = `Ouverture en cours… ${Math.floor((Date.now() - openingStarted) / 1000)} s`;
  }, 1000);

  try {
    const result = await api("open-now", { method: "POST" });
    const count = Array.isArray(result.cards) ? result.cards.length : 0;
    toast(`${result.packsOpened || 0} booster(s), ${count} carte(s) récupérée(s).`);

    if (count > 0) {
      revealCards = [...result.cards].sort((a, b) =>
        (RARITY_RANK[b.rarity] ?? 0) - (RARITY_RANK[a.rarity] ?? 0)
      );
      revealIndex = 0;
      revealCutoff = Math.max(...revealCards.map((card) => Number(card.pulledAt || Date.now())));
      revealCheckedThisLaunch = true;
      renderNewCardReveal();
      $("#newCardsModal").hidden = false;
      document.body.classList.add("modal-open");
    }

    await Promise.all([
      refreshStatus({ quiet: true }),
      refreshHistory({ quiet: true })
    ]);
  } catch (error) {
    toast(error.payload?.error || "L’ouverture a échoué.");
    await refreshStatus({ quiet: true });
  } finally {
    clearInterval(openingTimer);
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
    maybeShowNewCards();
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
    const rarityCode = String(card.rarity || "C").toLowerCase();
    article.className = `history-card rarity-card-${rarityCode}`;

    const imageWrap = document.createElement("div");
    imageWrap.className = "history-image-wrap";

    const img = document.createElement("img");
    img.className = "history-image";
    img.alt = "";
    img.loading = "lazy";
    if (card.imageUrl) {
      img.src = card.imageUrl;
      img.addEventListener("error", () => {
        recoverWikipediaImage(card.title, img, imageWrap);
      }, { once: true });
    } else {
      recoverWikipediaImage(card.title, img, imageWrap);
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

    const link = document.createElement("button");
    link.type = "button";
    link.className = "history-link history-link-button";
    link.textContent = "Retrouver dans WikiMasters";
    link.addEventListener("click", async () => {
      const cardName = String(card.title || "Carte");
      try {
        await navigator.clipboard.writeText(cardName);
      } catch {
        const area = document.createElement("textarea");
        area.value = cardName;
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        area.remove();
      }
      toast(`« ${cardName} » copié — colle-le dans la recherche WikiMasters.`);
      window.open("https://www.wiki-masters.com/collection", "_blank", "noopener,noreferrer");
    });
    body.appendChild(link);

    article.append(imageWrap, body);
    list.appendChild(article);
  }
}

function maybeShowNewCards() {
  if (revealCheckedThisLaunch || !historyItems.length) return;

  const seenThrough = Number(localStorage.getItem(STORAGE.seenCardsThrough) || 0);

  // First install/upgrade: establish a baseline so the entire old history does
  // not appear as "new". From then on, only genuinely later pulls are revealed.
  if (!seenThrough) {
    const baseline = Math.max(...historyItems.map((card) => Number(card.pulledAt || 0)));
    localStorage.setItem(STORAGE.seenCardsThrough, String(baseline));
    revealCheckedThisLaunch = true;
    return;
  }

  const fresh = historyItems
    .filter((card) => Number(card.pulledAt || 0) > seenThrough)
    .sort((a, b) =>
      (RARITY_RANK[b.rarity] ?? 0) - (RARITY_RANK[a.rarity] ?? 0) ||
      Number(b.pulledAt || 0) - Number(a.pulledAt || 0)
    );

  revealCheckedThisLaunch = true;
  if (!fresh.length) return;

  revealCards = fresh;
  revealIndex = 0;
  revealCutoff = Math.max(...fresh.map((card) => Number(card.pulledAt || 0)));
  renderNewCardReveal();
  $("#newCardsModal").hidden = false;
  document.body.classList.add("modal-open");
}

function renderNewCardReveal() {
  const card = revealCards[revealIndex];
  if (!card) return;

  const stage = $("#newCardStage");
  stage.replaceChildren();

  const article = document.createElement("article");
  const rarityCode = String(card.rarity || "C").toLowerCase();
  article.className = `new-card-reveal rarity-card-${rarityCode}`;

  const imageWrap = document.createElement("div");
  imageWrap.className = "new-card-image-wrap history-image-wrap";
  const img = document.createElement("img");
  img.className = "new-card-image history-image";
  img.alt = "";
  if (card.imageUrl) {
    img.src = card.imageUrl;
    img.addEventListener("error", () => recoverWikipediaImage(card.title, img, imageWrap), { once: true });
  } else {
    recoverWikipediaImage(card.title, img, imageWrap);
  }
  imageWrap.appendChild(img);

  const info = document.createElement("div");
  info.className = "new-card-info";
  const rarity = document.createElement("span");
  rarity.className = `rarity-badge rarity-${rarityCode}`;
  rarity.textContent = card.rarity || "C";
  const title = document.createElement("strong");
  title.textContent = card.title || "Carte";
  const stats = document.createElement("span");
  stats.className = "new-card-stats";
  stats.textContent = [
    card.atk != null ? `ATK ${card.atk}` : "",
    card.def != null ? `DEF ${card.def}` : ""
  ].filter(Boolean).join("  ·  ");
  info.append(rarity, title);
  if (stats.textContent) info.append(stats);

  article.append(imageWrap, info);
  stage.appendChild(article);

  $("#newCardsProgress").textContent = `${revealIndex + 1} / ${revealCards.length}`;
  $("#newCardPrev").disabled = revealIndex === 0;
  $("#newCardNext").disabled = revealIndex === revealCards.length - 1;
}

function finishNewCardReveal() {
  if (revealCutoff) {
    localStorage.setItem(STORAGE.seenCardsThrough, String(revealCutoff));
  }
  $("#newCardsModal").hidden = true;
  document.body.classList.remove("modal-open");
  revealCards = [];
  revealIndex = 0;
  revealCutoff = 0;
}

function nextNewCardReveal() {
  if (revealIndex >= revealCards.length - 1) return;
  revealIndex += 1;
  renderNewCardReveal();
}

function previousNewCardReveal() {
  if (revealIndex <= 0) return;
  revealIndex -= 1;
  renderNewCardReveal();
}

function showCardPlaceholder(img, imageWrap) {
  img.removeAttribute("src");
  img.hidden = true;
  if (imageWrap.querySelector(".card-placeholder")) return;

  const placeholder = document.createElement("div");
  placeholder.className = "card-placeholder";
  placeholder.innerHTML = `
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <rect x="16" y="10" width="32" height="44" rx="6"></rect>
      <path d="M24 23h16M24 31h12M24 39h9"></path>
      <circle cx="39" cy="42" r="4"></circle>
    </svg>
    <span>Image indisponible</span>
  `;
  imageWrap.appendChild(placeholder);
}

async function recoverWikipediaImage(title, img, imageWrap) {
  if (!title) {
    showCardPlaceholder(img, imageWrap);
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
    if (!source) {
      showCardPlaceholder(img, imageWrap);
      return;
    }
    img.hidden = false;
    img.src = source;
    img.addEventListener("error", () => showCardPlaceholder(img, imageWrap), { once: true });
  } catch {
    showCardPlaceholder(img, imageWrap);
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
  $("#cancelLoginButton").addEventListener("click", cancelLogin);

  $("#disconnectButton").addEventListener("click", disconnectAccount);
  $("#openNowButton").addEventListener("click", openNow);
  $("#pushButton").addEventListener("click", enablePush);
  $("#refreshHistory").addEventListener("click", () => refreshHistory());
  $("#newCardNext").addEventListener("click", nextNewCardReveal);
  $("#newCardPrev").addEventListener("click", previousNewCardReveal);
  $(".new-cards-backdrop").addEventListener("click", finishNewCardReveal);

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


function renderDiagnostic(status) {
  let button = document.querySelector("#captchaDiagnosticButton");
  if (!button) {
    button = document.createElement("button");
    button.id = "captchaDiagnosticButton";
    button.type = "button";
    button.textContent = "Exporter le diagnostic du blocage";
    document.querySelector("#openNowButton").insertAdjacentElement("afterend", button);
    button.addEventListener("click", () => {
      const report = currentStatus?.requestDiagnostic || currentStatus?.captchaDiagnostic || {
        frontendVersion: APP_VERSION,
        backendVersion: currentStatus?.backendVersion || "ancien serveur sans version",
        capturedAt: null,
        lastRunAt: currentStatus?.lastRunAt || null,
        provider: "inconnu",
        errorType: "verification_antibot_requise",
        automationEnabled: Boolean(currentStatus?.settings?.enabled),
        note: "Blocage antérieur sans diagnostic serveur. Ce rapport ne contient pas la réponse HTTP originale."
      };
      if (!report) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "wikimaster-captcha-diagnostic.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  const normalizedError = String(status?.lastError || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  button.hidden = !status?.requestDiagnostic && !status?.captchaDiagnostic && !/captcha|turnstile|anti[ _-]?bot|verification[ _-](humaine|requise)/i.test(normalizedError);
}

const RELEASE_NOTES = [
  "Rapport navigateur : chronologie en millisecondes, chargement, boutons visibles et désactivés, apparition de la vérification, clic et réponses. Le test attend le bouton jusqu’à 15 secondes.",
  "Après un blocage anti-bot lors d’une ouverture manuelle, le navigateur en arrière-plan tente maintenant un seul clic sur le bouton d’ouverture du site et observe le résultat pendant 25 secondes. Le rapport indique le clic, les réponses et le résultat.",
  "L’Auto Opener reste désactivé après un blocage. Le rapport navigateur contient le blocage initial et le résultat de la nouvelle tentative.",
  "Nouveau test navigateur en arrière-plan avec rapport exportable. Il charge la page sans ouvrir de booster ni interagir avec la vérification.",
  "Rapport enrichi : version serveur, en-têtes techniques, structure de réponse, messages anti-bot et contexte de la tentative.",
  "Correction : les messages « Vérification anti-bot requise » déclenchent maintenant le diagnostic et la désactivation automatique.",
  "Le bouton d’export apparaît aussi pour un ancien blocage, avec un rapport limité si les informations originales n’ont pas été conservées.",
  "Une notification signale le blocage. Le dernier diagnostic CAPTCHA peut être exporté depuis l’application, sans cookies ni jetons de connexion.",
  "Les cartes obtenues avant le blocage restent dans l’historique.",
  "L’état et l’historique s’actualisent au retour dans l’application, puis toutes les 30 secondes lorsqu’elle est visible."
];
function showReleaseNotes() {
  const key = "wma_release_notes_seen";
  if (localStorage.getItem(key) === APP_VERSION) return;
  const dialog = document.createElement("dialog");
  const title = document.createElement("h2");
  title.textContent = `Nouveautés · ${APP_VERSION}`;
  const list = document.createElement("ul");
  RELEASE_NOTES.forEach(note => {
    const item = document.createElement("li");
    item.textContent = note;
    list.append(item);
  });
  const close = document.createElement("button");
  close.textContent = "Compris";
  close.addEventListener("click", () => dialog.close());
  dialog.append(title, list, close);
  document.body.append(dialog);
  dialog.addEventListener("close", () => {
    localStorage.setItem(key, APP_VERSION);
    dialog.remove();
  });
  dialog.showModal();
}
showReleaseNotes();

// Installed PWAs may resume through focus/pageshow without visibilitychange.
let resumeRefresh = null;
function refreshOnResume() {
  if (document.visibilityState !== "visible" || resumeRefresh) return;
  resumeRefresh = Promise.allSettled([
    checkDeploymentVersion(),
    refreshStatus({ quiet: true })
  ]).finally(() => { resumeRefresh = null; });
}
window.addEventListener("focus", refreshOnResume);
window.addEventListener("pageshow", refreshOnResume);
setInterval(refreshOnResume, 30_000);

const probeButton = document.createElement("button");
probeButton.type = "button";
probeButton.className = "button secondary full-width";
probeButton.textContent = "Tester le navigateur en arrière-plan";
document.querySelector("#openNowButton").insertAdjacentElement("afterend", probeButton);
probeButton.addEventListener("click", async () => {
  probeButton.disabled = true;
  probeButton.textContent = "Test du navigateur…";
  try {
    const result = await api("browser-probe", { method: "POST" });
    const messages = {
      page_loaded: "Page chargée. Cela ne prouve pas que l’ouverture des boosters est autorisée.",
      verification_detected_stopped: "Vérification détectée : test arrêté.",
      login_required: "La page demande une connexion.",
      browser_error: "Erreur du navigateur : consulte le rapport."
    };
    toast(messages[result.report.outcome] || "Test terminé.");
    await refreshStatus({ quiet: true });
  } catch (error) { toast(error.message); }
  finally { probeButton.disabled = false; probeButton.textContent = "Tester le navigateur en arrière-plan"; }
});
const browserExport = document.createElement("button");
browserExport.type = "button";
browserExport.className = "button secondary full-width";
browserExport.textContent = "Exporter le test navigateur";
probeButton.insertAdjacentElement("afterend", browserExport);
browserExport.addEventListener("click", () => {
  const report = currentStatus?.browserDiagnostic;
  if (!report) return toast("Lance d’abord un test navigateur.");
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "wikimaster-browser-diagnostic.json";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

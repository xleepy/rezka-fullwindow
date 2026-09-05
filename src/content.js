(() => {
  if (globalThis.__rezkaWindowPlayer) return;
  globalThis.__rezkaWindowPlayer = true;

  const css = document.createElement("style");
  css.textContent = `
    html.rwp-active, html.rwp-active body { overflow: hidden !important; }
    .rwp-ancestor {
      transform: none !important; filter: none !important;
      perspective: none !important; contain: none !important;
      will-change: auto !important; content-visibility: visible !important;
      overflow: visible !important; clip: auto !important;
      clip-path: none !important; isolation: auto !important;
      opacity: 1 !important; z-index: auto !important;
    }
    .rwp-ancestor > :not(.rwp-ancestor):not(.rwp-player):not(#rwp-controls) {
      visibility: hidden !important;
    }
    .rwp-player {
      position: fixed !important; inset: 0 !important;
      width: 100vw !important; height: 100vh !important;
      min-width: 0 !important; min-height: 0 !important;
      max-width: none !important; max-height: none !important;
      margin: 0 !important; padding: 0 !important; border: 0 !important;
      box-sizing: border-box !important; background: #000 !important;
      z-index: 2147483646 !important; visibility: visible !important;
    }
    .rwp-player #cdnplayer, .rwp-player iframe, .rwp-player video {
      width: 100% !important; height: 100% !important;
      max-width: none !important; max-height: none !important;
      margin: 0 !important; object-fit: contain !important;
    }
    #rwp-controls {
      position: fixed !important; top: 12px !important; right: 12px !important;
      z-index: 2147483647 !important; visibility: visible !important;
      display: block !important;
    }
  `;
  document.documentElement.append(css);

  const host = document.createElement("div");
  host.id = "rwp-controls";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>
    :host { color-scheme: dark; }
    button { font: 600 13px/1.4 system-ui, sans-serif; color: white;
      background: #202329; border: 1px solid #777; border-radius: 7px;
      padding: 9px 13px; cursor: pointer; box-shadow: 0 2px 10px #0005; }
    button:hover { background: #383e48; }
    button:focus-visible { outline: 3px solid #7db8ff; outline-offset: 3px; }
    #toggle[data-positioned] {
      position: fixed; right: var(--player-right); bottom: var(--player-bottom);
    }
    :host([data-active]) button { opacity: .3; transition: opacity .15s; }
    :host([data-active]) button:hover, button:focus-visible { opacity: 1; }
    #next { margin-right: 8px; background: #245b38; opacity: 1; }
    [hidden] { display: none !important; }
    p { max-width: 240px; font: 13px/1.4 system-ui, sans-serif;
      background: #202329; color: white; padding: 10px; border-radius: 7px; }
    p:empty { display: none; }
  </style><button id="next" type="button" hidden>Next episode</button>
  <button id="toggle" type="button" aria-pressed="false">Fill window</button>
  <p role="status"></p>`;
  const button = shadow.querySelector("#toggle");
  const nextButton = shadow.querySelector("#next");
  const status = shadow.querySelector("p");
  let player = null;
  let ancestors = [];
  let scrollPosition;
  let previousFocus;
  let episodeTransitionUntil = 0;
  let skippedVideo = null;
  const inactiveElements = new Map();
  let observedPlayer = null;
  const playerResizeObserver = new ResizeObserver(updateButtonPosition);

  function updateButtonPosition() {
    const target = player || findPlayer();
    if (target !== observedPlayer) {
      playerResizeObserver.disconnect();
      observedPlayer = target;
      if (target) playerResizeObserver.observe(target);
    }
    button.toggleAttribute("data-positioned", Boolean(target));
    if (!target) return;
    const bounds = target.getBoundingClientRect();
    // Leave room for the playback controls along the bottom of the video.
    button.style.setProperty("--player-right", `${window.innerWidth - bounds.right + 12}px`);
    button.style.setProperty("--player-bottom", `${window.innerHeight - bounds.bottom + 64}px`);
  }

  window.addEventListener("resize", updateButtonPosition);
  document.addEventListener("scroll", updateButtonPosition, true);

  function findNextEpisode() {
    const current = document.querySelector(".b-simple_episode__item.active");
    if (!current) return null;
    const episodes = [...current.parentElement.querySelectorAll(".b-simple_episode__item")];
    const next = episodes[episodes.indexOf(current) + 1];
    if (!next || next.matches('.disabled, [disabled], [aria-disabled="true"]')) return null;
    return next;
  }

  function findVideo(root) {
    if (!root) return null;
    const video = root.querySelector("video");
    if (video) return video;
    for (const frame of root.querySelectorAll("iframe")) {
      // Cross-origin frames do not expose playback time to the extension.
      try {
        const embedded = findVideo(frame.contentDocument);
        if (embedded) return embedded;
      } catch { /* Leave inaccessible players unchanged. */ }
    }
    return null;
  }

  function updateNextEpisode() {
    const video = findVideo(player);
    const duration = video?.duration;
    const remaining = duration - video?.currentTime;
    const nearEnd = Number.isFinite(duration) && duration > 0 &&
      remaining >= 0 && remaining <= Math.min(90, duration * 0.1);
    if (video !== skippedVideo || !nearEnd) skippedVideo = null;
    nextButton.hidden = !player || !nearEnd || video === skippedVideo || !findNextEpisode();
  }

  nextButton.addEventListener("click", () => {
    updateNextEpisode();
    if (nextButton.hidden) return;
    const next = findNextEpisode();
    skippedVideo = findVideo(player);
    nextButton.hidden = true;
    button.focus({ preventScroll: true });
    episodeTransitionUntil = Date.now() + 10000;
    // Invoke the site's handler to preserve its translation and playback logic.
    next.click();
  });

  function findPlayer() {
    return [...document.querySelectorAll("#cdnplayer-container, #youtubeplayer")]
      .find((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.width > 0 && bounds.height > 0 &&
          getComputedStyle(element).visibility !== "hidden";
      });
  }

  function restore() {
    episodeTransitionUntil = 0;
    nextButton.hidden = true;
    if (!player) return;
    player.classList.remove("rwp-player");
    ancestors.forEach((element) => element.classList.remove("rwp-ancestor"));
    inactiveElements.forEach((wasInert, element) => { element.inert = wasInert; });
    inactiveElements.clear();
    document.documentElement.classList.remove("rwp-active");
    player = null;
    ancestors = [];
    host.removeAttribute("data-active");
    button.textContent = "Fill window";
    button.setAttribute("aria-pressed", "false");
    window.dispatchEvent(new Event("resize"));
    window.scrollTo({ left: scrollPosition.x, top: scrollPosition.y, behavior: "instant" });
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }

  function toggle() {
    status.textContent = "";
    if (player) return restore();
    const target = findPlayer();
    if (!target) {
      status.textContent = "Player not found. Open a video page and wait for the player to load.";
      if (!host.isConnected) document.body.append(host);
      return;
    }
    scrollPosition = { x: window.scrollX, y: window.scrollY };
    previousFocus = document.activeElement;
    player = target;
    for (let parent = target.parentElement; parent; parent = parent.parentElement) {
      ancestors.push(parent);
      parent.classList.add("rwp-ancestor");
    }
    // Keep keyboard navigation inside the player and extension controls.
    ancestors.forEach((parent) => {
      for (const sibling of parent.children) {
        if (sibling === target || sibling === host || ancestors.includes(sibling)) continue;
        inactiveElements.set(sibling, sibling.inert);
        sibling.inert = true;
      }
    });
    player.classList.add("rwp-player");
    document.documentElement.classList.add("rwp-active");
    host.setAttribute("data-active", "");
    button.textContent = "Restore player · Esc";
    button.setAttribute("aria-pressed", "true");
    window.dispatchEvent(new Event("resize"));
    updateNextEpisode();
  }

  button.addEventListener("click", toggle);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && (player || Date.now() < episodeTransitionUntil) &&
        !document.fullscreenElement) {
      event.preventDefault();
      event.stopImmediatePropagation();
      restore();
    }
  }, true);
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "rezka-window-toggle") toggle();
  });

  // Poll only playback state; this also handles same-origin iframe navigation.
  setInterval(() => { if (player) updateNextEpisode(); }, 500);

  // Keep the original DOM in place, so expanding does not reload an iframe.
  // Handle player removal or replacement during episode/translation changes.
  let updatePending = false;
  const observer = new MutationObserver(() => {
    if (updatePending) return;
    updatePending = true;
    requestAnimationFrame(() => {
      updatePending = false;
      if (player && (!player.isConnected || player.getClientRects().length === 0)) {
        const transitionUntil = episodeTransitionUntil;
        restore();
        episodeTransitionUntil = transitionUntil;
      }
      if (!player && Date.now() < episodeTransitionUntil && findPlayer()) toggle();
      const available = player || findPlayer();
      if (!host.isConnected && (available || status.textContent)) document.body.append(host);
      if (host.isConnected && !available && !status.textContent) host.remove();
      updateButtonPosition();
      updateNextEpisode();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ["style", "class"] });
  if (findPlayer()) document.body.append(host);
  updateButtonPosition();
})();

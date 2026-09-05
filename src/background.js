chrome.action.onClicked.addListener(async (tab) => {
  if (!Number.isInteger(tab.id)) return;
  try {
    const url = new URL(tab.url);
    if (!["http:", "https:"].includes(url.protocol) || !/(^|\.)rezka\.ag$/.test(url.hostname)) {
      throw new Error("Open a video page on rezka.ag first.");
    }
    // Also supports tabs that were open before the extension was installed.
    await chrome.scripting.executeScript({
      target: { tabId: tab.id }, files: ["content.js"]
    });
    await chrome.tabs.sendMessage(tab.id, { type: "rezka-window-toggle" });
    await chrome.action.setBadgeText({ tabId: tab.id, text: "" });
    await chrome.action.setTitle({ tabId: tab.id, title: "Fill window / Restore player" });
  } catch (error) {
    // The tab may have closed while injection or messaging was in progress.
    await Promise.allSettled([
      chrome.action.setBadgeText({ tabId: tab.id, text: "!" }),
      chrome.action.setTitle({ tabId: tab.id, title: error.message })
    ]);
  }
});

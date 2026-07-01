// popup.js — query active tab and ask content script for highlights
document.addEventListener("DOMContentLoaded", () => {
  const status = document.getElementById("status");
  const listEl = document.getElementById("highlights");
  const empty = document.getElementById("empty");
  const badge = document.getElementById("count-badge");

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) {
      status.textContent = "No active tab.";
      return;
    }

    chrome.tabs.sendMessage(tab.id, { action: "GET_HIGHLIGHTS" }, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        status.textContent = "No content script on this page.";
        return;
      }

      status.style.display = "none";
      const highs = resp.highlights || [];
      badge.textContent = highs.length;

      if (highs.length === 0) {
        empty.style.display = "flex";
        return;
      }

      highs.forEach((h) => {
        const li = document.createElement("li");
        li.className = "high-item";

        // Color dot
        const dot = document.createElement("span");
        dot.className = `color-dot ${h.colorClass || "chatmark-yellow"}`;
        li.appendChild(dot);

        // Text
        const t = document.createElement("div");
        t.className = "high-text";
        t.textContent = h.text;
        t.title = h.text; // full text on hover
        li.appendChild(t);

        // Delete button
        const del = document.createElement("button");
        del.className = "btn-delete";
        del.textContent = "Remove";
        del.addEventListener("click", () => {
          chrome.tabs.sendMessage(tab.id, { action: "REMOVE_HIGHLIGHT", id: h.id }, (r) => {
            if (r && r.ok) {
              li.style.opacity = "0";
              li.style.transform = "translateX(20px)";
              li.style.transition = "all 0.2s ease";
              setTimeout(() => {
                li.remove();
                const remaining = listEl.children.length;
                badge.textContent = remaining;
                if (remaining === 0) empty.style.display = "flex";
              }, 200);
            }
          });
        });
        li.appendChild(del);

        listEl.appendChild(li);
      });
    });
  });
});
document.addEventListener("mouseup", handlemouseup);
document.addEventListener("mousedown", handlemousedown);

function handlemouseup(e) {
  const selection = window.getSelection();
  const selText = selection.toString().trim();

  if (!selText) {
    return;
  }
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  showToolBar(rect, range, selText);
}

function handlemousedown(e) {
  const toolbar = document.getElementById("chatmark-toolbar");
  if (toolbar && !toolbar.contains(e.target)) {
    hideToolBar();
  }
}

function showToolBar(rect, range, selText) {
  hideToolBar();

  const toolbar = document.createElement("div");
  toolbar.style.position = "fixed";
  toolbar.style.top = `${rect.top + window.scrollY - 45}px`;
  toolbar.style.left = `${rect.left + window.scrollX}px`;
  toolbar.style.zIndex = "999999";

  const yellowBtn = document.createElement("button");
  yellowBtn.className = "chatmark-btn chatmark-yellow";
  yellowBtn.title = "Highlight Yellow";
  yellowBtn.innerText = "Highlight";

  yellowBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    applyHighlight(range, selText, "chatmark-yellow");
    hideToolbar();
  });

  // yellowBtn.addEventListener("click", () => {
  //   applyHighlight(range, selText, "chatmark-yellow");
  //   hideToolbar();
  // });

  toolbar.appendChild(yellowBtn);
  document.body.appendChild(toolbar);
}

function hideToolBar() {
  const toolbar = document.getElementById("chatmark-toolbar");
  if (toolbar) toolbar.remove();
}

function applyHighlight(range, selText, colorClass) {
  const span = document.createElement("span");
  span.className = `chatmark-highlight ${colorClass}`;
  span.dataset.text = selText;

  range.surroundContents(span);

  saveHighlight(selText, colorClass);
}

function saveHighlight(text, colorClass) {
  const url = window.location.href;

  chrome.storage.local.get([url], (result) => {
    const existing = result[url] || [];
    existing.push({ text, colorClass });
    chrome.storage.local.set({ [url]: existing });
  });
}

function restoreHighlights() {
  const url = window.location.href;
  chrome.storage.local.get([url], (result) => {
    const highlights = result[url] || [];
    highlights.forEach(({ text, colorClass }) => {
      if (!text) return;

      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
      );

      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.nodeValue.includes(text)) {
          const span = document.createElement("span");
          span.className = `chatmark-highlight ${colorClass}`;
          const range = document.createRange();
          const index = node.nodeValue.indexOf(text);
          range.setStart(node, index);
          range.setEnd(node, index + text.length);
          range.surroundContents(span);
          break;
        }
      }
    });
  });
}

// Call on page load
restoreHighlights();

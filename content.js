document.addEventListener("mouseup", handleMouseUp);
document.addEventListener("mousedown", handleMouseDown);
  
function handleMouseUp(e) {
  const selection = window.getSelection();
  if(!selection || selection.rangeCount === 0) return;
  const selText = selection.toString().trim();

  if (!selText) {
    return;
  }
  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  showToolBar(rect, range, selText);
}

function handleMouseDown(e) {
  const toolbar = document.getElementById("chatmark-toolbar");
  if (toolbar && !toolbar.contains(e.target)) {
    hideToolBar();
  }
}

function showToolBar(rect, range, selText) {
  hideToolBar();

  const toolbar = document.createElement("div");
  toolbar.id = "chatmark-toolbar";
  toolbar.style.position = "fixed";
  toolbar.style.top = `${Math.max(4, rect.top - 45)}px`;
  toolbar.style.left = `${Math.max(4, rect.left)}px`;
  toolbar.style.zIndex = "999999";

  const yellowBtn = document.createElement("button");
  yellowBtn.className = "chatmark-btn chatmark-yellow";
  yellowBtn.title = "Highlight Yellow";
  yellowBtn.innerText = "Highlight";

  yellowBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    applyHighlight(range, selText, "chatmark-yellow");
    hideToolBar();
    window.getSelection().removeAllRanges();
  });


  toolbar.appendChild(yellowBtn);
  document.body.appendChild(toolbar);
}

function hideToolBar() {
  const toolbar = document.getElementById("chatmark-toolbar");
  if (toolbar) toolbar.remove();
}

function generateId(){
  return `cm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function safeWrapRange(range, span){
  try{
    const frag = range.extractContents();
    span.appendChild(frag);
    range.insertNode(span);
    return true;
  } catch(err) {
    // Fallback: replace selected content with plain-text inside span (best-effort)
    try {
      const text = range.toString();
      range.deleteContents();
      span.appendChild(document.createTextNode(text));
      range.insertNode(span);
      return true;
    } catch (e) {
      console.warn("chatmark: Failed to wrap range (fallback)", e);
      return false;
    }
  }
}

function getConversationKey(){
  const origin = location.origin;

  const selectors = [
    '[data-conversation-id]',
    'meta[name="conversation-id"]',
    '[data-thread-id]',
    '[data-id^="conversation-"]'
  ];

  for(const sel of selectors){
    const el = document.querySelector(sel);
    if(el){
      const val = el.getAttribute('data-conversation-id') || el.getAttribute('content') || el.getAttribute('data-thread-id') || el.getAttribute('data-id');
      if(val) return `${origin}::${val}`;
    }
  }

  const pathParts = location.pathname.split('/').filter(Boolean);
  if(pathParts.length){
    const last = pathParts[pathParts.length-1];
    if(last.length >= 6) return `${origin}::${last}`;
  }

  return `${origin}::${location.pathname}`;
}

function storageKeyForConversation(){
  return `chatmark::${getConversationKey()}`;
}

function saveHighlight(text, colorClass, id) {
  const key = storageKeyForConversation();
  chrome.storage.local.get([key], (result) => {
    const existing = result[key] || [];
    existing.push({ id, text, colorClass });
    chrome.storage.local.set({ [key]: existing });
  });
}

function applyHighlight(range, selText, colorClass) {
  const id = generateId();
  const span = document.createElement("span");
  span.className = `chatmark-highlight ${colorClass}`;
  span.dataset.text = selText;
  span.dataset.id = id;

  const ok = safeWrapRange(range, span);
  if (!ok) {
    // Fallback: try to wrap by creating a new text node (best-effort)
    try {
      const textNode = document.createTextNode(selText);
      span.appendChild(textNode);
      range.deleteContents();
      range.insertNode(span);
    } catch (err) {
      console.error("ChatMark: fallback highlight failed", err);
      return;
    }
  }

  saveHighlight(selText, colorClass, id);
}

function getConversationContainer() {
  // Try host-specific containers that hold messages; fallback to document.body
  const candidates = [
    '.conversation', // generic
    '[role="main"]',
    '#chat', '#messages',
    '.chat-lines'
  ];
  for (const sel of candidates) {
    const el = document.querySelector(sel);
    if (el && el.textContent && el.textContent.trim().length > 20) return el;
  }
  return document.body;
}

function restoreHighlights() {
  const key = storageKeyForConversation();
  chrome.storage.local.get([key], (result) => {
    const highlights = result[key] || [];
    const container = getConversationContainer();

    highlights.forEach(({ id, text, colorClass }) => {
      if (!text) return;
      // Skip if already present
      if (document.querySelector(`span.chatmark-highlight[data-id="${id}"]`)) return;

      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        if (!node.nodeValue) continue;
        if (node.parentNode && node.parentNode.closest && node.parentNode.closest('.chatmark-highlight')) continue;
        const idx = node.nodeValue.indexOf(text);
        if (idx !== -1) {
          const range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + text.length);
          const span = document.createElement("span");
          span.className = `chatmark-highlight ${colorClass}`;
          span.dataset.text = text;
          span.dataset.id = id;
          const ok = safeWrapRange(range, span);
          if (!ok) {
            // if wrap failed, continue searching
            console.warn("ChatMark: restore wrap failed for", text);
          }
          break;
        }
      }
    });
  });
}

function removeHighlightById(id, callback) {
  const key = storageKeyForConversation();
  // Remove DOM nodes
  const spans = Array.from(document.querySelectorAll(`span.chatmark-highlight[data-id="${id}"]`));
  spans.forEach(span => {
    const parent = span.parentNode;
    while (span.firstChild) parent.insertBefore(span.firstChild, span);
    parent.removeChild(span);
    parent.normalize && parent.normalize();
  });
  // Update storage
  chrome.storage.local.get([key], (result) => {
    const existing = result[key] || [];
    const filtered = existing.filter(h => h.id !== id);
    chrome.storage.local.set({ [key]: filtered }, () => {
      if (typeof callback === 'function') callback();
    });
  });
}

// Messaging for popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.action === 'GET_HIGHLIGHTS') {
    const key = storageKeyForConversation();
    chrome.storage.local.get([key], (result) => {
      sendResponse({ highlights: result[key] || [], conversationKey: getConversationKey() });
    });
    return true; // async
  }
  if (msg && msg.action === 'REMOVE_HIGHLIGHT' && msg.id) {
    removeHighlightById(msg.id, () => sendResponse({ ok: true }));
    return true;
  }
});

// Restore on load
restoreHighlights();








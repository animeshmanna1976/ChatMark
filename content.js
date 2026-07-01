//IIFE-Immediately Invoked Function Expression (IIFE)
(() => {
  "use strict";

  // extension is reloaded but old content scripts are still running.
  function isContextValid() {
    try {
      return !!chrome.runtime && !!chrome.runtime.id;
    } catch (e) {
      return false;
    }
  }

  // Constants 
  const TOOLBAR_OFFSET_Y = 90; // this for height
  const TOOLBAR_HEIGHT = 44;
  const RESTORE_DEBOUNCE_MS = 400;
  const RESTORE_TIMEOUT_MS = 15000;

  // Track restored highlight IDs to avoid double-processing
  const restoredIds = new Set();
  let restoreTimer = null;
  let restoreTimeoutTimer = null;
  let observer = null;
  let lastUrl = location.href;

  //  Shadow DOM Host for 
  // Using Shadow DOM to fully isolate toolbar from platform CSS stacking contexts
  let shadowHost = null;
  let shadowRoot = null;

  function ensureShadowHost() {
    if (shadowHost && document.documentElement.contains(shadowHost)) return;
    shadowHost = document.createElement("chatmark-toolbar-host");
    shadowHost.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;";
    shadowRoot = shadowHost.attachShadow({ mode: "open" });

    // Inject toolbar styles into shadow root
    const style = document.createElement("style");
    style.textContent = `
      .chatmark-toolbar {
        position: fixed;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        gap: 8px;
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 12px;
        padding: 8px 14px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.05);
        backdrop-filter: blur(16px);
        pointer-events: auto;
        animation: chatmark-fadein 0.15s ease-out;
        font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
      }
      @keyframes chatmark-fadein {
        from { opacity: 0; transform: translateY(6px) scale(0.96); }
        to   { opacity: 1; transform: translateY(0) scale(1); }
      }
      .chatmark-btn {
        border: none;
        border-radius: 8px;
        padding: 6px 14px;
        font-size: 13px;
        cursor: pointer;
        font-weight: 600;
        letter-spacing: 0.02em;
        transition: transform 0.12s ease, box-shadow 0.12s ease, filter 0.12s ease;
        outline: none;
        position: relative;
      }
      .chatmark-btn:hover {
        transform: translateY(-1px) scale(1.04);
        box-shadow: 0 4px 16px rgba(0,0,0,0.25);
      }
      .chatmark-btn:active {
        transform: scale(0.97);
      }
      .chatmark-btn-yellow {
        background: linear-gradient(135deg, #ffe066 0%, #ffcc02 100%);
        color: #1a1a1a;
      }
      .chatmark-btn-green {
        background: linear-gradient(135deg, #69db7c 0%, #40c057 100%);
        color: #1a1a1a;
      }
      .chatmark-btn-blue {
        background: linear-gradient(135deg, #74c0fc 0%, #339af0 100%);
        color: #1a1a1a;
      }
      .chatmark-btn-pink {
        background: linear-gradient(135deg, #ffa8c5 0%, #f06595 100%);
        color: #1a1a1a;
      }
      .chatmark-btn-remove {
        background: linear-gradient(135deg, #ff6b6b 0%, #fa5252 100%);
        color: #fff;
      }
      .chatmark-btn-comment {
        background: linear-gradient(135deg, #74c0fc 0%, #339af0 100%);
        color: #fff;
      }
      .chatmark-input-wrapper {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
      }
      .chatmark-input {
        flex: 1;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: #fff;
        border-radius: 6px;
        padding: 6px 10px;
        font-size: 13px;
        outline: none;
        min-width: 180px;
      }
      .chatmark-input::placeholder {
        color: rgba(255, 255, 255, 0.4);
      }
      .chatmark-btn-save {
        background: linear-gradient(135deg, #69db7c 0%, #40c057 100%);
        color: #1a1a1a;
      }
      .chatmark-label {
        color: rgba(255,255,255,0.5);
        font-size: 11px;
        font-weight: 500;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        margin-right: 4px;
        user-select: none;
      }
    `;
    shadowRoot.appendChild(style);
    document.documentElement.appendChild(shadowHost);
  }

  // Event Listeners 
  document.addEventListener("mouseup", handleMouseUp);  //release mouse button
  document.addEventListener("mousedown", handleMouseDown);  //press mouse button
  document.addEventListener("click", handleDocumentClick);

  function handleDocumentClick(e) {
    if (!isContextValid()) return;    //context guard is valid or not
    const highlightSpan = e.target.closest(".chatmark-highlight");
    if (highlightSpan) {
      e.stopPropagation();
      const id = highlightSpan.dataset.id;
      if (id) {
        const rect = highlightSpan.getBoundingClientRect();
        showEditToolBar(rect, id);
      }
    }
  }

  function handleMouseUp(e) {
    if (!isContextValid()) return;
    // Small delay to let the browser finalize the selection
    setTimeout(() => {
      if (!isContextValid()) return;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const selText = selection.toString().trim();
      if (!selText) return;

      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      showToolBar(rect, range, selText);
    }, 10);
  }

  function handleMouseDown(e) {
    // Hide toolbar if clicking outside it
    if (shadowRoot) {
      const toolbar = shadowRoot.querySelector(".chatmark-toolbar");
      // Shadow DOM click — the event target is on the main document, so
      // if we clicked inside the shadow host, e.target would be the host itself
      if (toolbar && e.target !== shadowHost) {
        hideToolBar();
      }
    }
  }

  // Toolbar
  function showToolBar(rect, range, selText) {
    hideToolBar();            // to remove any existing toolbar
    ensureShadowHost();

    const toolbar = document.createElement("div");
    toolbar.className = "chatmark-toolbar";

    // Smart positioning: try above first, fall back to below
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    const spaceAbove = rect.top;
    const spaceBelow = viewportH - rect.bottom;
    const neededHeight = TOOLBAR_HEIGHT + TOOLBAR_OFFSET_Y;

    let top, left;
    if (spaceAbove >= neededHeight) {
      // Position above selection
      top = rect.top - TOOLBAR_OFFSET_Y;
    } else if (spaceBelow >= neededHeight) {
      // Position below selection
      top = rect.bottom + 16;
    } else {
      // Not enough room either way — position at top of viewport
      top = 12;
    }

    // Horizontal: center on selection, but clamp to viewport
    const toolbarEstWidth = 280;
    left = rect.left + rect.width / 2 - toolbarEstWidth / 2;
    left = Math.max(12, Math.min(left, viewportW - toolbarEstWidth - 12));

    toolbar.style.top = `${Math.round(top)}px`;
    toolbar.style.left = `${Math.round(left)}px`;

    // Label
    const label = document.createElement("span");
    label.className = "chatmark-label";
    label.textContent = "Mark";
    toolbar.appendChild(label);

    // Color buttons
    const colors = [
      { cls: "chatmark-yellow", label: "Yellow", emoji: "🟡" },
      { cls: "chatmark-green", label: "Green", emoji: "🟢" },
      { cls: "chatmark-blue", label: "Blue", emoji: "🔵" },
      { cls: "chatmark-pink", label: "Pink", emoji: "🌸" },
    ];

    colors.forEach(({ cls, label: lbl, emoji }) => {
      const btn = document.createElement("button");
      btn.className = `chatmark-btn chatmark-btn-${cls.split("-")[1]}`;
      btn.title = `Highlight ${lbl}`;
      btn.textContent = emoji;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        applyHighlight(range, selText, cls);
        hideToolBar();
        window.getSelection().removeAllRanges();
      });
      toolbar.appendChild(btn);
    });

    shadowRoot.appendChild(toolbar);
  }

  function showEditToolBar(rect, id) {
    hideToolBar();
    ensureShadowHost();

    const toolbar = document.createElement("div");
    toolbar.className = "chatmark-toolbar";

    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    const spaceAbove = rect.top;
    const spaceBelow = viewportH - rect.bottom;
    const neededHeight = TOOLBAR_HEIGHT + TOOLBAR_OFFSET_Y;

    let top, left;
    if (spaceAbove >= neededHeight) {
      top = rect.top - TOOLBAR_OFFSET_Y;
    } else if (spaceBelow >= neededHeight) {
      top = rect.bottom + 16;
    } else {
      top = 12;
    }

    const toolbarEstWidth = 220; // wider for two buttons
    left = rect.left + rect.width / 2 - toolbarEstWidth / 2;
    left = Math.max(12, Math.min(left, viewportW - toolbarEstWidth - 12));

    toolbar.style.top = `${Math.round(top)}px`;
    toolbar.style.left = `${Math.round(left)}px`;

    // Fetch existing comment (if any) first
    const key = storageKeyForConversation();
    chrome.storage.local.get([key], (result) => {
      const existing = result[key] || [];
      const highlightData = existing.find(h => h.id === id);
      const currentComment = highlightData ? (highlightData.comment || "") : "";

      const btnRemove = document.createElement("button");
      btnRemove.className = "chatmark-btn chatmark-btn-remove";
      btnRemove.title = "Remove Highlight";
      btnRemove.textContent = "Remove";
      btnRemove.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        removeHighlightById(id);
        hideToolBar();
      });

      const btnComment = document.createElement("button");
      btnComment.className = "chatmark-btn chatmark-btn-comment";
      btnComment.title = "Add/Edit Comment";
      btnComment.textContent = "💬 Comment";
      btnComment.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        // Replace buttons with input UI
        toolbar.innerHTML = "";
        
        const wrapper = document.createElement("div");
        wrapper.className = "chatmark-input-wrapper";

        const input = document.createElement("input");
        input.type = "text";
        input.className = "chatmark-input";
        input.placeholder = "Add a comment...";
        input.value = currentComment;

        const btnSave = document.createElement("button");
        btnSave.className = "chatmark-btn chatmark-btn-save";
        btnSave.textContent = "Save";

        const saveHandler = (se) => {
          se.stopPropagation();
          se.preventDefault();
          updateHighlightComment(id, input.value.trim());
          hideToolBar();
        };

        btnSave.addEventListener("click", saveHandler);
        input.addEventListener("keydown", (ke) => {
          if (ke.key === "Enter") saveHandler(ke);
          if (ke.key === "Escape") hideToolBar();
        });

        wrapper.appendChild(input);
        wrapper.appendChild(btnSave);
        toolbar.appendChild(wrapper);

        // Focus input after rendering
        setTimeout(() => input.focus(), 50);
      });

      toolbar.appendChild(btnRemove);
      toolbar.appendChild(btnComment);
      shadowRoot.appendChild(toolbar);
    });
  }

  function hideToolBar() {
    if (!shadowRoot) return;
    const toolbar = shadowRoot.querySelector(".chatmark-toolbar");
    if (toolbar) toolbar.remove();
  }

  // ID Generation 
  function generateId() {
    return `cm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  // Text Node Walker Highlight 
  // Instead of extractContents (which fails on cross-element ranges),
  // we walk individual text nodes and wrap each one separately.

  function getTextNodesInRange(range) {
    const nodes = [];
    const startContainer = range.startContainer;
    const endContainer = range.endContainer;

    // If both start and end are in the same text node
    if (startContainer === endContainer && startContainer.nodeType === Node.TEXT_NODE) {
      nodes.push({
        node: startContainer,
        start: range.startOffset,
        end: range.endOffset,
      });
      return nodes;
    }

    // Walk all text nodes within the common ancestor
    const ancestor = range.commonAncestorContainer;
    const walker = document.createTreeWalker(
      ancestor.nodeType === Node.TEXT_NODE ? ancestor.parentNode : ancestor,
      NodeFilter.SHOW_TEXT
    );

    let inRange = false;
    while (walker.nextNode()) {
      const node = walker.currentNode;

      if (node === startContainer) {
        inRange = true;
        nodes.push({
          node,
          start: range.startOffset,
          end: node.nodeValue.length,
        });
        continue;
      }

      if (node === endContainer) {
        nodes.push({
          node,
          start: 0,
          end: range.endOffset,
        });
        break;
      }

      if (inRange) {
        nodes.push({
          node,
          start: 0,
          end: node.nodeValue.length,
        });
      }
    }

    return nodes;
  }

  function highlightTextNodes(textNodes, colorClass, id, comment = "") {
    const wrappedSpans = [];

    // Process in reverse order so offsets remain valid
    for (let i = textNodes.length - 1; i >= 0; i--) {
      const { node, start, end } = textNodes[i];
      if (!node.parentNode) continue;
      if (start === end) continue;

      // Skip if already inside a chatmark highlight
      if (node.parentNode.closest && node.parentNode.closest(".chatmark-highlight")) continue;

      try {
        const r = document.createRange();
        r.setStart(node, start);
        r.setEnd(node, end);

        const span = document.createElement("span");
        span.className = `chatmark-highlight ${colorClass}`;
        span.dataset.id = id;
        span.dataset.text = r.toString();

        r.surroundContents(span);
        wrappedSpans.push(span);
      } catch (err) {
        // surroundContents can fail if the range partially selects a non-text node.
        // Fallback: extract and re-insert
        try {
          const r = document.createRange();
          r.setStart(node, start);
          r.setEnd(node, end);
          const span = document.createElement("span");
          span.className = `chatmark-highlight ${colorClass}`;
          span.dataset.id = id;
          const fragment = r.extractContents();
          span.dataset.text = fragment.textContent;
          span.appendChild(fragment);
          r.insertNode(span);
          wrappedSpans.push(span);
        } catch (e2) {
          console.warn("ChatMark: could not wrap text node", e2);
        }
      }
    }

    // Add comment icon to the last span (which is wrappedSpans[0] because we process in reverse)
    if (comment && wrappedSpans.length > 0) {
      updateCommentIconForHighlight(id, comment, null); // Will use current date if null
    }

    return wrappedSpans;
  }

  function updateCommentIconForHighlight(id, comment, dateStr) {
    const existingIcons = document.querySelectorAll(`span.chatmark-comment-icon[data-id="${id}"]`);
    existingIcons.forEach(icon => icon.remove());

    if (!comment) return;

    // Remove any leftover title attributes just in case
    const spans = document.querySelectorAll(`span.chatmark-highlight[data-id="${id}"]`);
    spans.forEach(span => span.removeAttribute("title"));

    if (spans.length > 0) {
      // Find the last span in document order. Since they are queried from DOM,
      // spans[spans.length - 1] is the last piece of the highlight.
      const lastSpan = spans[spans.length - 1];

      const iconSpan = document.createElement("span");
      iconSpan.className = "chatmark-comment-icon";
      iconSpan.dataset.id = id;
      
      const displayDate = dateStr || new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

      iconSpan.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        <div class="chatmark-comment-tooltip">
          <div class="chatmark-tooltip-date">${displayDate}</div>
          <div class="chatmark-tooltip-text">${comment}</div>
        </div>
      `;

      // Allow clicking the icon to edit
      iconSpan.addEventListener("click", (e) => {
        e.stopPropagation();
        e.preventDefault();
        const rect = lastSpan.getBoundingClientRect();
        showEditToolBar(rect, id);
      });

      lastSpan.appendChild(iconSpan);
    }
  }

  // Apply Highlight 
  function applyHighlight(range, selText, colorClass) {
    const id = generateId();
    const textNodes = getTextNodesInRange(range);

    if (textNodes.length === 0) {
      console.warn("ChatMark: no text nodes found in selection");
      return;
    }

    const spans = highlightTextNodes(textNodes, colorClass, id);
    if (spans.length > 0) {
      saveHighlight(selText, colorClass, id);
      restoredIds.add(id);
    }
  }

  // Conversation Key 
  function getConversationKey() {
    const origin = location.origin;

    const selectors = [
      "[data-conversation-id]",
      'meta[name="conversation-id"]',
      "[data-thread-id]",
      '[data-id^="conversation-"]',
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const val =
          el.getAttribute("data-conversation-id") ||
          el.getAttribute("content") ||
          el.getAttribute("data-thread-id") ||
          el.getAttribute("data-id");
        if (val) return `${origin}::${val}`;
      }
    }

    const pathParts = location.pathname.split("/").filter(Boolean);
    if (pathParts.length) {
      const last = pathParts[pathParts.length - 1];
      if (last.length >= 6) return `${origin}::${last}`;
    }

    return `${origin}::${location.pathname}`;
  }

  function storageKeyForConversation() {
    return `chatmark::${getConversationKey()}`;
  }

  // Storage 
  function saveHighlight(text, colorClass, id) {
    if (!isContextValid()) return;
    const key = storageKeyForConversation();
    chrome.storage.local.get([key], (result) => {
      if (chrome.runtime.lastError) return;
      const existing = result[key] || [];
      existing.push({ id, text, colorClass, comment: "" });
      chrome.storage.local.set({ [key]: existing });
    });
  }

  function updateHighlightComment(id, comment) {
    if (!isContextValid()) return;
    const key = storageKeyForConversation();
    chrome.storage.local.get([key], (result) => {
      if (chrome.runtime.lastError) return;
      const existing = result[key] || [];
      const item = existing.find(h => h.id === id);
      if (item) {
        item.comment = comment;
        item.dateStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
        chrome.storage.local.set({ [key]: existing });
        
        // Update DOM icon
        updateCommentIconForHighlight(id, comment, item.dateStr);
      }
    });
  }

  // Restore Highlights 
  function getConversationContainer() {
    // Platform-specific containers
    const candidates = [
      // ChatGPT
      '[role="presentation"]',
      "main .flex.flex-col",
      // Claude
      ".conversation-content",
      '[class*="ConversationContent"]',
      // Gemini
      ".conversation-container",
      'main[class*="main"]',
      // Generic fallbacks
      '[role="main"]',
      "main",
      "#chat",
      "#messages",
    ];

    for (const sel of candidates) {
      try {
        const el = document.querySelector(sel);
        if (el && el.textContent && el.textContent.trim().length > 20) return el;
      } catch (e) {
        // Invalid selector, skip
      }
    }
    return document.body;
  }

  // Block-level element check 
  const BLOCK_TAGS = new Set([
    "DIV", "P", "H1", "H2", "H3", "H4", "H5", "H6",
    "LI", "OL", "UL", "BLOCKQUOTE", "PRE", "TABLE",
    "TR", "TD", "TH", "SECTION", "ARTICLE", "HEADER",
    "FOOTER", "MAIN", "NAV", "BR", "HR",
  ]);

  function isBlockBoundaryBetween(nodeA, nodeB) {
    // Check if there's a block-level element boundary between two text nodes.
    // This mimics how selection.toString() inserts newlines at block boundaries.
    if (!nodeA || !nodeB) return false;
    const parentA = nodeA.parentNode;
    const parentB = nodeB.parentNode;
    if (parentA === parentB) return false; // same parent = inline siblings

    // Walk up from each node and check if they share the same block ancestor
    let blockA = parentA;
    while (blockA && !BLOCK_TAGS.has(blockA.tagName)) blockA = blockA.parentNode;
    let blockB = parentB;
    while (blockB && !BLOCK_TAGS.has(blockB.tagName)) blockB = blockB.parentNode;

    return blockA !== blockB;
  }

  // Find text that may span across multiple DOM nodes (e.g., bold + regular text).
  // Returns an array of { node, start, end } objects, or null if not found.
  function findTextAcrossNodes(container, searchText) {
    const textNodes = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);

    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.nodeValue) continue;
      // Skip nodes already inside a highlight
      if (node.parentNode && node.parentNode.closest && node.parentNode.closest(".chatmark-highlight")) continue;
      textNodes.push(node);
    }

    if (textNodes.length === 0) return null;

    // Build a concatenated string with block-boundary separators.
    // selection.toString() inserts \n between block elements, so we must too.
    const segments = []; // { node, globalStart, globalEnd }
    let fullText = "";

    for (let i = 0; i < textNodes.length; i++) {
      const node = textNodes[i];

      // Insert a newline separator if there's a block boundary between this
      // and the previous text node (mimics selection.toString() behavior)
      if (i > 0 && isBlockBoundaryBetween(textNodes[i - 1], node)) {
        fullText += "\n";
      }

      const globalStart = fullText.length;
      fullText += node.nodeValue;

      segments.push({
        node,
        globalStart,
        globalEnd: fullText.length,
      });
    }

    // Try exact match first
    let matchIdx = fullText.indexOf(searchText);

    // If exact match fails, try with normalized whitespace
    if (matchIdx === -1) {
      const normSearch = searchText.replace(/\s+/g, " ").trim();
      // Build a mapping from normalized positions to original positions
      const normChars = []; // normChars[i] = index in fullText
      let normText = "";
      let lastWasSpace = false;
      for (let i = 0; i < fullText.length; i++) {
        const ch = fullText[i];
        if (/\s/.test(ch)) {
          if (!lastWasSpace && normText.length > 0) {
            normChars.push(i);
            normText += " ";
          }
          lastWasSpace = true;
        } else {
          normChars.push(i);
          normText += ch;
          lastWasSpace = false;
        }
      }

      const normMatchIdx = normText.indexOf(normSearch);
      if (normMatchIdx !== -1) {
        // Map normalized match back to original fullText positions
        matchIdx = normChars[normMatchIdx];
        const normMatchEnd = normMatchIdx + normSearch.length - 1;
        const origEnd = normChars[normMatchEnd] + 1;
        // Use origEnd for the match length
        const matchEnd = origEnd;

        const result = [];
        for (const seg of segments) {
          if (seg.globalEnd <= matchIdx) continue;
          if (seg.globalStart >= matchEnd) break;
          const localStart = Math.max(0, matchIdx - seg.globalStart);
          const localEnd = Math.min(seg.node.nodeValue.length, matchEnd - seg.globalStart);
          if (localStart < localEnd) {
            result.push({ node: seg.node, start: localStart, end: localEnd });
          }
        }
        return result.length > 0 ? result : null;
      }

      return null;
    }

    const matchEnd = matchIdx + searchText.length;

    // Map the match back to individual text nodes
    const result = [];
    for (const seg of segments) {
      if (seg.globalEnd <= matchIdx) continue;
      if (seg.globalStart >= matchEnd) break;

      const localStart = Math.max(0, matchIdx - seg.globalStart);
      const localEnd = Math.min(seg.node.nodeValue.length, matchEnd - seg.globalStart);

      if (localStart < localEnd) {
        result.push({
          node: seg.node,
          start: localStart,
          end: localEnd,
        });
      }
    }

    return result.length > 0 ? result : null;
  }

  function restoreHighlights() {
    if (!isContextValid()) return;
    const key = storageKeyForConversation();
    chrome.storage.local.get([key], (result) => {
      if (chrome.runtime.lastError) return;
      const highlights = result[key] || [];
      if (highlights.length === 0) return;

      const container = getConversationContainer();
      let allRestored = true;

      // Process highlights one at a time. After each successful restore,
      // the DOM is modified (text nodes get split by inserted <span>s),
      // so we must do a FRESH DOM walk for each subsequent highlight.
      for (const { id, text, colorClass, comment, dateStr } of highlights) {
        if (!text) continue;
        // Skip if already restored
        if (restoredIds.has(id)) continue;
        // Skip if already in DOM
        if (document.querySelector(`span.chatmark-highlight[data-id="${id}"]`)) {
          restoredIds.add(id);
          continue;
        }

        allRestored = false;

        // Fresh DOM walk for each highlight (previous restores may have split text nodes)
        const matchedNodes = findTextAcrossNodes(container, text);

        if (matchedNodes && matchedNodes.length > 0) {
          const spans = highlightTextNodes(matchedNodes, colorClass, id, comment);
          if (comment) {
            updateCommentIconForHighlight(id, comment, dateStr);
          }
          if (spans.length > 0) {
            restoredIds.add(id);
          }
        }
      }

      // If all highlights are restored, stop the observer
      if (allRestored && observer) {
        observer.disconnect();
        observer = null;
        clearTimeout(restoreTimeoutTimer);
      }
    });
  }

  // Remove Highlight 
  function removeHighlightById(id, callback) {
    const key = storageKeyForConversation();
    // Remove all DOM spans with this ID
    const spans = Array.from(document.querySelectorAll(`span.chatmark-highlight[data-id="${id}"]`));
    spans.forEach((span) => {
      const parent = span.parentNode;
      while (span.firstChild) parent.insertBefore(span.firstChild, span);
      parent.removeChild(span);
      if (parent.normalize) parent.normalize();
    });
    // Remove from restoredIds
    restoredIds.delete(id);
    // Update storage
    if (!isContextValid()) { if (typeof callback === 'function') callback(); return; }
    chrome.storage.local.get([key], (result) => {
      if (chrome.runtime.lastError) return;
      const existing = result[key] || [];
      const filtered = existing.filter((h) => h.id !== id);
      chrome.storage.local.set({ [key]: filtered }, () => {
        if (typeof callback === "function") callback();
      });
    });
  }

  //  MutationObserver for SPA Content Loading 
  function startObserver() {
    if (observer) return;

    let debounceTimer = null;

    observer = new MutationObserver((mutations) => {
      if (!isContextValid()) {
        observer.disconnect();
        observer = null;
        return;
      }
      // Check if any meaningful content was added
      let hasNewContent = false;
      for (const m of mutations) {
        if (m.addedNodes.length > 0) {
          for (const node of m.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE && node.textContent && node.textContent.trim().length > 5) {
              hasNewContent = true;
              break;
            }
          }
        }
        if (hasNewContent) break;
      }

      if (!hasNewContent) return;

      // Debounce to avoid hammering on rapid DOM updates
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        restoreHighlights();
      }, RESTORE_DEBOUNCE_MS);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Auto-disconnect after timeout
    restoreTimeoutTimer = setTimeout(() => {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
    }, RESTORE_TIMEOUT_MS);
  }

  // SPA Navigation Detection 
  function handleNavigation() {
    // Clear restored set for the new page
    restoredIds.clear();
    // Restart observer
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    clearTimeout(restoreTimeoutTimer);
    startObserver();
    // Immediate attempt
    setTimeout(restoreHighlights, 500);
  }

  // Listen for popstate (back/forward)
  window.addEventListener("popstate", handleNavigation);

  // Poll for URL changes (SPA pushState doesn't fire popstate)
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      handleNavigation();
    }
  }, 1000);

  // Messaging for Popup 
  if (isContextValid()) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (!isContextValid()) return;
      if (msg && msg.action === "GET_HIGHLIGHTS") {
        const key = storageKeyForConversation();
        chrome.storage.local.get([key], (result) => {
          if (chrome.runtime.lastError) { sendResponse({ highlights: [] }); return; }
          sendResponse({
            highlights: result[key] || [],
            conversationKey: getConversationKey(),
          });
        });
        return true; // async
      }
      if (msg && msg.action === "REMOVE_HIGHLIGHT" && msg.id) {
        removeHighlightById(msg.id, () => sendResponse({ ok: true }));
        return true;
      }
      if (msg && msg.action === "SCROLL_TO_HIGHLIGHT" && msg.id) {
        const span = document.querySelector(`span.chatmark-highlight[data-id="${msg.id}"]`);
        if (span) {
          span.scrollIntoView({ behavior: "smooth", block: "center" });
          // Add a brief flash animation
          span.classList.add("chatmark-flash");
          setTimeout(() => span.classList.remove("chatmark-flash"), 1500);
          sendResponse({ ok: true });
        } else {
          sendResponse({ ok: false });
        }
        return true;
      }
    });
  }

  // Initialize 
  // First attempt immediately
  restoreHighlights();
  // Start observer for dynamically loaded content
  startObserver();
  // Retry after a delay (gives SPA time to load initial content)
  setTimeout(restoreHighlights, 1500);
  setTimeout(restoreHighlights, 4000);
})();

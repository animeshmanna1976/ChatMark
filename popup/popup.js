// popup.js - query active tab and ask content script for highlights
document.addEventListener('DOMContentLoaded', () => {
  const status = document.getElementById('status');
  const listEl = document.getElementById('highlights');
  const empty = document.getElementById('empty');

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.id) {
      status.textContent = 'No active tab.';
      return;
    }

    chrome.tabs.sendMessage(tab.id, { action: 'GET_HIGHLIGHTS' }, (resp) => {
      if (!resp) {
        status.textContent = 'No content script on this page.';
        return;
      }
      status.style.display = 'none';
      const highs = resp.highlights || [];
      if (highs.length === 0) {
        empty.style.display = 'block';
        return;
      }
      highs.forEach(h => {
        const li = document.createElement('li');
        li.className = 'high-item';
        const t = document.createElement('div');
        t.className = 'high-text';
        t.textContent = h.text;
        const del = document.createElement('button');
        del.className = 'btn';
        del.textContent = 'Delete';
        del.addEventListener('click', () => {
          chrome.tabs.sendMessage(tab.id, { action: 'REMOVE_HIGHLIGHT', id: h.id }, (r) => {
            if (r && r.ok) {
              li.remove();
              if (listEl.children.length === 0) empty.style.display = 'block';
            }
          });
        });
        li.appendChild(t);
        li.appendChild(del);
        listEl.appendChild(li);
      });
    });
  });
});
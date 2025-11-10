// ==UserScript==
// @name         ChatGPT Prompt Queue
// @namespace    https://chatgpt.com/
// @version      1.0.9
// @description  Queue prompts while a message is sending
// @match        https://chatgpt.com/*
// @run-at       document-idle
// @grant        none
// @downloadURL  https://github.com/HailXD/chatgpt-queue/raw/refs/heads/main/script.user.js
// ==/UserScript==

(function () {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function getEditor() {
    return (
      document.getElementById("prompt-textarea") ||
      $('[data-testid="prompt-textarea"]') ||
      null
    );
  }

  function isSending() {
    return Boolean($('[data-testid="stop-button"]'));
  }

  function getSendButton() {
    return $('[data-testid="send-button"], [aria-label="Send"]');
  }

  const LS_KEY = "cgpt_prompt_queue_v1";

  let queue = [];
  let dispatchLock = false;
  let pendingDraft = null;

  function loadQueue() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      queue = Array.isArray(parsed)
        ? parsed.filter((item) => !(item && item.isDraft))
        : [];
    } catch {
      queue = [];
    }
  }
  function saveQueue() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(queue));
    } catch {}
  }

  const styles = `
#cgpt-queue-panel {
  position: fixed;
  right: 12px;
  bottom: 12px;
  z-index: 999999;
  width: 320px;
  max-height: 40vh;
  background: rgba(20,20,20,0.92);
  color: #fff;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.35);
  overflow: hidden;
  font: 13px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  backdrop-filter: blur(6px);
}
#cgpt-queue-panel.cgpt-collapsed {
  width: auto;
  min-width: 120px;
}
#cgpt-queue-panel.cgpt-collapsed #cgpt-queue-actions,
#cgpt-queue-panel.cgpt-collapsed #cgpt-queue-list {
  display: none;
}
#cgpt-queue-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: rgba(255,255,255,0.06);
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
#cgpt-queue-title { font-weight: 600; font-size: 13px; cursor: pointer; }
#cgpt-queue-actions { display: flex; gap: 8px; }
.cgpt-btn {
  cursor: pointer; user-select: none; padding: 4px 8px;
  border-radius: 8px; border: 1px solid rgba(255,255,255,0.15);
  background: rgba(255,255,255,0.08); color: #fff; font-size: 12px;
}
.cgpt-btn:hover { background: rgba(255,255,255,0.14); }
#cgpt-queue-list { max-height: calc(40vh - 44px); overflow: auto; }
.cgpt-queue-item {
  position: relative;
  display: grid; grid-template-columns: 1fr auto; gap: 8px;
  padding: 12px 12px 16px;
}
.cgpt-queue-item:not(:last-child)::after {
  content: "";
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 6px;
  height: 1px;
  pointer-events: none;
  background: linear-gradient(90deg,
    rgba(255,255,255,0),
    rgba(255,255,255,0.25),
    rgba(255,255,255,0)
  );
  opacity: 0.7;
}
.cgpt-queue-text {
  display: flex; gap: 8px; align-items: flex-start;
  white-space: pre-wrap; word-break: break-word;
  font-size: 12px; color: #eaeaea;
}
.cgpt-queue-summary { flex: 1; color: #eaeaea; }
.cgpt-queue-index {
  font-weight: 600;
  color: rgba(255,255,255,0.75);
  font-size: 11px;
  min-width: 18px;
  text-align: right;
  letter-spacing: 0.02em;
}
.cgpt-queue-meta { display: flex; align-items: center; gap: 6px; }
.cgpt-remove,
.cgpt-edit {
  cursor: pointer; padding: 2px 6px; border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.18);
  background: rgba(255,255,255,0.07); color: #fff; font-size: 11px;
}
.cgpt-remove:hover,
.cgpt-edit:hover { background: rgba(255,255,255,0.15); }
.cgpt-empty { padding: 14px 12px; color: #c9c9c9; font-size: 12px; }
.cgpt-queue-item--draft {
  background: rgba(255,153,0,0.16);
  border-left: 3px solid rgba(255,153,0,0.85);
}
.cgpt-queue-tag {
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 10px;
  background: rgba(255,153,0,0.18);
  color: #ffb347;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
`;
  const styleTag = document.createElement("style");
  styleTag.textContent = styles;
  document.head.appendChild(styleTag);

  const panel = document.createElement("div");
  panel.id = "cgpt-queue-panel";
  panel.innerHTML = `
    <div id="cgpt-queue-header">
      <div id="cgpt-queue-title">Queue (0)</div>
      <div id="cgpt-queue-actions">
        <button id="cgpt-queue-clear" class="cgpt-btn" title="Clear all">Clear</button>
      </div>
    </div>
    <div id="cgpt-queue-list"><div class="cgpt-empty">No queued prompts.</div></div>
  `;
  document.body.appendChild(panel);

  const titleEl = $("#cgpt-queue-title", panel);
  const listEl = $("#cgpt-queue-list", panel);
  const clearBtn = $("#cgpt-queue-clear", panel);
  const headerEl = $("#cgpt-queue-header", panel);
  const actionsEl = $("#cgpt-queue-actions", panel);

  let isCollapsed = false;

  function setCollapsed(state) {
    isCollapsed = Boolean(state);
    panel.classList.toggle("cgpt-collapsed", isCollapsed);
  }

  setCollapsed(isCollapsed);
  if (headerEl) {
    headerEl.title = "Click to expand or collapse the queue";
    headerEl.addEventListener("click", (event) => {
      if (actionsEl && actionsEl.contains(event.target)) return;
      setCollapsed(!isCollapsed);
    });
  }

  function summarize(lines, maxLen = 180) {
    const text = lines.join("\n");
    return text.length > maxLen ? text.slice(0, maxLen - 1) + "…" : text;
  }

  function renderQueue() {
    titleEl.textContent = `Queue (${queue.length})`;
    listEl.innerHTML = "";
    if (!queue.length) {
      const empty = document.createElement("div");
      empty.className = "cgpt-empty";
      empty.textContent = "No queued prompts.";
      listEl.appendChild(empty);
      return;
    }
    queue.forEach((item, idx) => {
      const row = document.createElement("div");
      row.className = "cgpt-queue-item";
      if (item && item.isDraft) row.classList.add("cgpt-queue-item--draft");

      const text = document.createElement("div");
      text.className = "cgpt-queue-text";

      const index = document.createElement("span");
      index.className = "cgpt-queue-index";
      index.textContent = String(idx + 1);

      const summary = document.createElement("span");
      summary.className = "cgpt-queue-summary";
      summary.textContent = summarize(item.lines);

      text.appendChild(index);
      text.appendChild(summary);

      const tools = document.createElement("div");
      tools.className = "cgpt-queue-meta";

      const edit = document.createElement("button");
      edit.className = "cgpt-edit";
      edit.textContent = "Edit";
      edit.addEventListener("click", () => {
        const removed = removeQueueItemAt(idx);
        if (!removed) return;
        const editor = getEditor();
        if (editor) {
          linesToEditor(removed.lines || [""], editor);
        }
      });

      const remove = document.createElement("button");
      remove.className = "cgpt-remove";
      remove.textContent = "Remove";
      remove.addEventListener("click", () => {
        removeQueueItemAt(idx);
      });

      if (item && item.isDraft) {
        const badge = document.createElement("span");
        badge.className = "cgpt-queue-tag";
        badge.textContent = "Saved draft";
        tools.appendChild(badge);
      }
      tools.appendChild(edit);
      tools.appendChild(remove);
      row.appendChild(text);
      row.appendChild(tools);
      listEl.appendChild(row);
    });
  }

  clearBtn.addEventListener("click", () => {
    queue = [];
    if (pendingDraft) pendingDraft.restore = false;
    saveQueue();
    renderQueue();
  });

  function editorToLines(editor) {
    const ps = $$("p", editor);
    if (ps.length === 0) {
      const t = editor.textContent || "";
      return t.split(/\r?\n/);
    }
    return ps.map((p) => (p.textContent ?? "").replace(/\u00A0/g, ""));
  }

  function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function linesToEditor(lines, editor) {
    const html = lines
      .map((ln) => (ln && ln.length ? `<p>${escapeHtml(ln)}</p>` : "<p><br></p>"))
      .join("");
    editor.innerHTML = html || "<p><br></p>";
    editor.dispatchEvent(new InputEvent("input", { bubbles: true }));
    placeCaretAtEnd(editor);
  }

  function placeCaretAtEnd(el) {
    try {
      el.focus();
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
    } catch {}
  }

  function simulateEnterOn(el) {
    if (!el) return;
    el.focus();
    const evInit = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    };
    el.dispatchEvent(new KeyboardEvent("keydown", evInit));
    el.dispatchEvent(new KeyboardEvent("keypress", evInit));
    el.dispatchEvent(new KeyboardEvent("keyup", evInit));
    setTimeout(() => {
      const sendBtn = getSendButton();
      if (sendBtn && !isSending()) sendBtn.click();
    }, 80);
  }

  function enqueue(lines, opts = {}) {
    const item = {
      id: String(Date.now()) + Math.random().toString(36).slice(2),
      lines,
      created: Date.now(),
      ...opts,
    };
    queue.push(item);
    saveQueue();
    renderQueue();
    return item;
  }

  function dequeue() {
    const item = queue.shift();
    saveQueue();
    renderQueue();
    return item;
  }

  function removeQueueItemAt(index) {
    if (typeof index !== "number" || index < 0 || index >= queue.length) {
      return null;
    }
    const removed = queue.splice(index, 1)[0];
    if (pendingDraft && removed && removed.id === pendingDraft.id) {
      pendingDraft.restore = false;
    }
    saveQueue();
    renderQueue();
    return removed;
  }

  function removeQueueItemById(id) {
    if (!id) return;
    const idx = queue.findIndex((item) => item && item.id === id);
    if (idx === -1) return;
    removeQueueItemAt(idx);
  }

  function restorePendingDraft(editor) {
    if (!pendingDraft) return;
    const { id, lines, restore } = pendingDraft;
    pendingDraft = null;
    if (restore !== false && editor) {
      linesToEditor(lines, editor);
    }
    removeQueueItemById(id);
  }

  function hasContent(lines) {
    return lines.some((ln) => (ln ?? "").trim().length > 0);
  }

  function waitFor(pred, timeout = 5000, interval = 50) {
    return new Promise((resolve) => {
      const start = Date.now();
      (function tick() {
        let ok = false;
        try { ok = !!pred(); } catch {}
        if (ok || Date.now() - start >= timeout) return resolve();
        setTimeout(tick, interval);
      })();
    });
  }

  async function trySendNext() {
    if (dispatchLock) return;
    if (!queue.length) return;
    if (isSending()) return;

    const editor = getEditor();
    if (!editor) return;

    dispatchLock = true;

    const currentLines = editorToLines(editor);
    if (!pendingDraft && hasContent(currentLines)) {
      const draftItem = enqueue(currentLines, { isDraft: true });
      pendingDraft = {
        id: draftItem.id,
        lines: currentLines.slice(),
        restore: true,
      };
    }

    const item = dequeue();
    if (!item) {
      dispatchLock = false;
      return;
    }

    linesToEditor(item.lines, editor);

    await Promise.resolve();

    const btn = getSendButton();
    if (btn) btn.click();
    else simulateEnterOn(editor);

    await waitFor(() => isSending(), 2000, 50);
    if (!isSending()) {
      restorePendingDraft(editor);
      dispatchLock = false;
      setTimeout(trySendNext, 300);
      return;
    }

    restorePendingDraft(editor);

    await waitFor(() => !isSending(), 120000, 100);

    dispatchLock = false;
    setTimeout(trySendNext, 50);
  }

  function keydownHandler(e) {
    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;

    const editor = getEditor();
    if (!editor) return;
    if (!editor.contains(e.target) && e.target !== editor) return;

    if (!isSending()) return;

    e.preventDefault();
    e.stopPropagation();

    const lines = editorToLines(editor);
    if (!hasContent(lines)) return;

    enqueue(lines);
    linesToEditor([""], editor);
  }

  loadQueue();
  renderQueue();

  document.addEventListener("keydown", keydownHandler, true);

  setInterval(() => {
    if (!dispatchLock && !isSending()) trySendNext();
  }, 600);

  const obs = new MutationObserver(() => {
    if (!dispatchLock && !isSending()) trySendNext();
  });
  obs.observe(document.body, { childList: true, subtree: true });
})();

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

    /** @type {{id:string, lines:string[], created:number}[]} */
    let queue = [];

    function loadQueue() {
        try {
            const raw = localStorage.getItem(LS_KEY);
            queue = raw ? JSON.parse(raw) : [];
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
#cgpt-queue-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  background: rgba(255,255,255,0.06);
  border-bottom: 1px solid rgba(255,255,255,0.08);
}
#cgpt-queue-title {
  font-weight: 600;
  font-size: 13px;
}
#cgpt-queue-actions {
  display: flex;
  gap: 8px;
}
.cgpt-btn {
  cursor: pointer;
  user-select: none;
  padding: 4px 8px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.15);
  background: rgba(255,255,255,0.08);
  color: #fff;
  font-size: 12px;
}
.cgpt-btn:hover { background: rgba(255,255,255,0.14); }
#cgpt-queue-list {
  max-height: calc(40vh - 44px);
  overflow: auto;
}
.cgpt-queue-item {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px dashed rgba(255,255,255,0.08);
}
.cgpt-queue-item:last-child { border-bottom: none; }
.cgpt-queue-text {
  white-space: pre-wrap;
  word-break: break-word;
  color: #eaeaea;
  font-size: 12px;
}
.cgpt-queue-meta {
  display: flex;
  align-items: center;
  gap: 6px;
}
.cgpt-remove {
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
  border: 1px solid rgba(255,255,255,0.18);
  background: rgba(255,255,255,0.07);
  color: #fff;
  font-size: 11px;
}
.cgpt-remove:hover { background: rgba(255,255,255,0.15); }
.cgpt-empty {
  padding: 14px 12px;
  color: #c9c9c9;
  font-size: 12px;
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
        <button id="cgpt-queue-sendnext" class="cgpt-btn" title="Force send next now">Send next</button>
        <button id="cgpt-queue-clear" class="cgpt-btn" title="Clear all">Clear</button>
      </div>
    </div>
    <div id="cgpt-queue-list"><div class="cgpt-empty">No queued prompts.</div></div>
  `;
    document.body.appendChild(panel);

    const titleEl = $("#cgpt-queue-title", panel);
    const listEl = $("#cgpt-queue-list", panel);
    const clearBtn = $("#cgpt-queue-clear", panel);
    const sendNextBtn = $("#cgpt-queue-sendnext", panel);

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

            const text = document.createElement("div");
            text.className = "cgpt-queue-text";
            text.textContent = summarize(item.lines);

            const tools = document.createElement("div");
            tools.className = "cgpt-queue-meta";

            const remove = document.createElement("button");
            remove.className = "cgpt-remove";
            remove.textContent = "Remove";
            remove.addEventListener("click", () => {
                queue.splice(idx, 1);
                saveQueue();
                renderQueue();
            });

            tools.appendChild(remove);
            row.appendChild(text);
            row.appendChild(tools);
            listEl.appendChild(row);
        });
    }

    clearBtn.addEventListener("click", () => {
        queue = [];
        saveQueue();
        renderQueue();
    });

    sendNextBtn.addEventListener("click", () => {
        trySendNext();
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
        return s
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
    }

    function linesToEditor(lines, editor) {
        const html = lines
            .map((ln) =>
                ln && ln.length ? `<p>${escapeHtml(ln)}</p>` : "<p><br></p>"
            )
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
            if (sendBtn && !isSending()) {
                sendBtn.click();
            }
        }, 80);
    }

    function addToQueue(lines) {
        queue.push({
            id: String(Date.now()) + Math.random().toString(36).slice(2),
            lines,
            created: Date.now(),
        });
        saveQueue();
        renderQueue();
    }

    function popLatestFromQueue() {
        const item = queue.pop();
        saveQueue();
        renderQueue();
        return item;
    }

    let sendingTimer = null;

    function trySendNext() {
        if (!queue.length) return;
        if (isSending()) return;
        const editor = getEditor();
        if (!editor) return;

        const item = popLatestFromQueue();
        if (!item) return;

        linesToEditor(item.lines, editor);

        clearTimeout(sendingTimer);
        sendingTimer = setTimeout(() => {
            if (isSending()) {
                return;
            }
            simulateEnterOn(editor);
        }, 1000);
    }

    function keydownHandler(e) {
        if (
            e.key !== "Enter" ||
            e.shiftKey ||
            e.ctrlKey ||
            e.altKey ||
            e.metaKey
        )
            return;

        const editor = getEditor();
        if (!editor) return;
        if (!editor.contains(e.target) && e.target !== editor) return;

        if (!isSending()) return;

        e.preventDefault();
        e.stopPropagation();

        const lines = editorToLines(editor);
        const hasContent = lines.some((ln) => (ln ?? "").trim().length > 0);
        if (!hasContent) return;

        addToQueue(lines);

        linesToEditor([""], editor);
    }

    loadQueue();
    renderQueue();

    document.addEventListener("keydown", keydownHandler, true);

    setInterval(() => {
        if (!isSending()) {
            trySendNext();
        }
    }, 500);

    const obs = new MutationObserver(() => {
        if (!isSending()) trySendNext();
    });
    obs.observe(document.body, { childList: true, subtree: true });
})();

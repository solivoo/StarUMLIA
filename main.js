const fs = require("fs");
const path = require("path");
const kimiClient = require("./lib/kimi-client");
const { buildMessages, extractJson } = require("./lib/prompt");
const { buildFromSpec, snapshotCurrentDiagram } = require("./lib/diagram-builder");

const PREF_VISIBILITY = "view.kimi-chat.visibility";

let chatPanel = null;
let $panel = null;
let $messages = null;
let $input = null;
let $send = null;
let history = [];
let busy = false;

function appendMessage(role, text) {
  if (!$messages) {
    return;
  }
  const $el = $("<div class='kimi-msg'></div>");
  $el.addClass(role);
  $el.text((role === "user" ? "Tú: " : role === "assistant" ? "Kimi: " : "") + text);
  $messages.append($el);
  $messages.scrollTop($messages[0].scrollHeight);
}

function setBusy(value) {
  busy = value;
  if ($send) {
    $send.prop("disabled", value);
    $send.text(value ? "…" : "Generar");
  }
}

function showPanel() {
  if (!chatPanel) {
    return;
  }
  chatPanel.show();
  app.preferences.set(PREF_VISIBILITY, true);
  if ($input) {
    $input.focus();
  }
}

function hidePanel() {
  if (!chatPanel) {
    return;
  }
  chatPanel.hide();
  app.preferences.set(PREF_VISIBILITY, false);
}

function togglePanel() {
  if (!chatPanel) {
    return;
  }
  if (chatPanel.isVisible()) {
    hidePanel();
  } else {
    showPanel();
  }
}

function clearChat() {
  history = [];
  if ($messages) {
    $messages.empty();
  }
  appendMessage(
    "system",
    "Chat limpio. Primer mensaje = diagrama nuevo. Siguientes = solo cambios sobre el diagrama activo."
  );
}

async function handleGenerate(userText) {
  const text = (userText || "").trim();
  if (!text) {
    return;
  }
  if (busy) {
    return;
  }

  appendMessage("user", text);
  history.push({ role: "user", content: text });
  $input.val("");
  setBusy(true);
  appendMessage("system", "Consultando Kimi…");

  try {
    const current = snapshotCurrentDiagram();
    const reply = await kimiClient.chat(
      buildMessages(text, history.slice(0, -1), current)
    );
    history.push({ role: "assistant", content: reply });

    const spec = extractJson(reply);
    const result = buildFromSpec(spec);

    if (result.mode === "patch") {
      appendMessage(
        "system",
        "✓ Actualizado «" +
          (result.diagram.name || "diagrama") +
          "»: +" +
          result.added +
          " clases, ~" +
          result.updated +
          " modificadas, -" +
          result.removed +
          " eliminadas, +" +
          result.assocCount +
          " relaciones."
      );
      app.toast.info("Diagrama actualizado (parche)");
    } else {
      const names = (spec.classes || []).map((c) => c.name).filter(Boolean);
      appendMessage(
        "system",
        "✓ Diagrama nuevo «" +
          (spec.diagramName || result.diagram.name || "Kimi") +
          "»: " +
          result.added +
          " clases, " +
          result.assocCount +
          " relaciones" +
          (names.length ? " → " + names.slice(0, 8).join(", ") : "") +
          "."
      );
      app.toast.info("Diagrama generado con Kimi");
    }
  } catch (err) {
    console.error("[Kimi]", err);
    appendMessage("error", String(err && err.message ? err.message : err));
    app.toast.error("Kimi: " + (err && err.message ? err.message : err));
  } finally {
    setBusy(false);
  }
}

function setupPanel() {
  const html = fs.readFileSync(path.join(__dirname, "panel/kimi-chat-panel.html"), "utf8");
  $panel = $(html);
  $messages = $panel.find("#kimi-messages");
  $input = $panel.find("#kimi-input");
  $send = $panel.find("#kimi-send");

  $panel.find(".close").click((e) => {
    e.preventDefault();
    hidePanel();
  });
  $panel.find(".kimi-clear").click((e) => {
    e.preventDefault();
    clearChat();
  });
  $send.click(() => handleGenerate($input.val()));
  $input.on("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleGenerate($input.val());
    }
  });

  chatPanel = app.panelManager.createBottomPanel("?", $panel, 180);
  clearChat();

  if (app.preferences.get(PREF_VISIBILITY)) {
    showPanel();
  } else {
    hidePanel();
  }
}

function promptGenerate() {
  showPanel();
  app.dialogs
    .showTextDialog(
      "Describe el dominio / diagrama a generar con Kimi",
      "Ej: Sistema de biblioteca con Libro, Autor, Prestamo (DDD)"
    )
    .then(({ buttonId, returnValue }) => {
      if (buttonId === "ok" && returnValue) {
        handleGenerate(returnValue);
      }
    });
}

function init() {
  setupPanel();
  app.commands.register("kimi:toggle-chat", togglePanel);
  app.commands.register("kimi:prompt-generate", promptGenerate);
}

exports.init = init;

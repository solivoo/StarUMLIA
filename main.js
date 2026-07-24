const fs = require("fs");
const path = require("path");
const kimiClient = require("./lib/kimi-client");
const { buildMessages, extractJson } = require("./lib/prompt");
const { validateSpec } = require("./lib/spec-utils");
const {
  buildFromSpec,
  snapshotCurrentDiagram,
  applyRoundedLines,
  autoLayout,
  cleanNoiseAssociationNames,
  regroupDiagramByLayers
} = require("./lib/diagram-builder");

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
    const currentExists = !!current;
    const validation = validateSpec(spec, { hasCurrentDiagram: currentExists });

    if (!validation.ok) {
      throw new Error(validation.error || "Spec inválido");
    }

    if (validation.kind === "chat") {
      appendMessage("system", validation.message);
      app.toast.info("Kimi");
      return;
    }

    const result = buildFromSpec(spec);

    if (result.mode === "chat") {
      appendMessage("system", result.message || validation.message);
      return;
    }

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

/** Aplica líneas redondeadas + limpia etiquetas + reordena el diagrama actual */
function polishCurrentDiagram() {
  const diagram = app.diagrams.getCurrentDiagram();
  if (!diagram) {
    app.toast.error("No hay diagrama activo");
    return;
  }
  const cleaned = cleanNoiseAssociationNames(diagram);
  autoLayout(diagram);
  const rounded = applyRoundedLines(diagram);
  app.diagrams.repaint();
  app.toast.info(
    "Diagrama pulido: " + rounded + " líneas redondeadas, " + cleaned + " etiquetas limpiadas"
  );
}

/** Agrupa todas las clases en paquetes Domain / Application / Infrastructure / Presentation / Interfaces */
function regroupCurrentDiagram() {
  const diagram = app.diagrams.getCurrentDiagram();
  if (!diagram) {
    app.toast.error("No hay diagrama activo");
    return;
  }
  const result = regroupDiagramByLayers(diagram);
  app.toast.info(
    "Capas DDD: " + result.moved + " elementos en " + result.packages + " paquetes"
  );
}

function init() {
  setupPanel();
  // Estilo de línea por defecto: rectilíneo redondeado (LS_ROUNDRECT = 2),
  // así las nuevas aristas nacen con el mismo estilo que aplica el auto-layout.
  try {
    const roundRect =
      (type.EdgeView && type.EdgeView.LS_ROUNDRECT != null)
        ? type.EdgeView.LS_ROUNDRECT
        : 2;
    app.preferences.set("view.lineStyle", roundRect);
  } catch (err) {
    /* preferencia opcional */
  }
  app.commands.register("kimi:toggle-chat", togglePanel);
  app.commands.register("kimi:prompt-generate", promptGenerate);
  app.commands.register("kimi:polish-diagram", polishCurrentDiagram);
  app.commands.register("kimi:regroup-layers", regroupCurrentDiagram);
}

exports.init = init;

/**
 * Utilidades puras (sin StarUML) para parsear/validar respuestas de Kimi.
 */

function parseFeature(text) {
  const raw = String(text || "").trim();
  if (!raw) {
    return { name: "unnamed", type: null };
  }
  const m = raw.match(/^([^:(]+)(\([^)]*\))?\s*(?::\s*(.+))?$/);
  if (!m) {
    return { name: raw, type: null };
  }
  return {
    name: (m[1] + (m[2] || "")).trim(),
    type: m[3] ? m[3].trim() : null
  };
}

function extractJson(text) {
  if (!text) {
    throw new Error("Respuesta vacía");
  }
  let raw = String(text).trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    raw = fence[1].trim();
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("No se encontró JSON en la respuesta");
  }
  raw = raw.slice(start, end + 1);
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error("JSON inválido: " + (err && err.message ? err.message : err));
  }
}

function hasNonEmptyArray(obj, key) {
  return obj && Array.isArray(obj[key]) && obj[key].length > 0;
}

/**
 * Clasifica el spec de Kimi.
 * @returns {'create'|'patch'|'chat'|'empty'|'invalid'}
 */
function classifySpec(spec) {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    return "invalid";
  }

  const mode = String(spec.mode || "").toLowerCase();

  if (mode === "chat" || mode === "noop" || mode === "message") {
    return "chat";
  }

  if (typeof spec.message === "string" && spec.message.trim() && !mode) {
    // mensaje conversacional sin acciones
    if (
      !hasNonEmptyArray(spec, "classes") &&
      !hasNonEmptyArray(spec, "addClasses") &&
      !hasNonEmptyArray(spec, "updateClasses") &&
      !hasNonEmptyArray(spec, "removeClasses") &&
      !hasNonEmptyArray(spec, "addAssociations") &&
      !hasNonEmptyArray(spec, "associations")
    ) {
      return "chat";
    }
  }

  if (mode === "create" || hasNonEmptyArray(spec, "classes")) {
    if (hasNonEmptyArray(spec, "classes")) {
      return "create";
    }
    return "empty";
  }

  if (
    mode === "patch" ||
    hasNonEmptyArray(spec, "addClasses") ||
    hasNonEmptyArray(spec, "updateClasses") ||
    hasNonEmptyArray(spec, "removeClasses") ||
    hasNonEmptyArray(spec, "addAssociations") ||
    hasNonEmptyArray(spec, "removeAssociations") ||
    hasNonEmptyArray(spec, "associations")
  ) {
    // patch vacío (sin cambios) también es válido
    return "patch";
  }

  if (mode === "patch") {
    return "patch";
  }

  return "empty";
}

/**
 * @returns {{ ok: boolean, kind: string, error?: string, message?: string }}
 */
function validateSpec(spec, options) {
  const opts = options || {};
  const hasCurrentDiagram = !!opts.hasCurrentDiagram;
  const kind = classifySpec(spec);

  if (kind === "invalid") {
    return { ok: false, kind, error: "Respuesta inválida: se esperaba un objeto JSON" };
  }

  if (kind === "chat") {
    return {
      ok: true,
      kind: "chat",
      message:
        (spec && (spec.message || spec.reply || spec.text)) ||
        "Hola. Describe el dominio o di qué diagrama quieres crear/modificar."
    };
  }

  if (kind === "empty") {
    return {
      ok: true,
      kind: "chat",
      message:
        "No hay cambios de diagrama en la respuesta. Pide algo concreto, p. ej. «Crea un diagrama de clases de una calculadora»."
    };
  }

  if (kind === "create") {
    if (!hasNonEmptyArray(spec, "classes")) {
      return { ok: false, kind, error: "mode=create requiere classes[] con al menos una clase" };
    }
    for (let i = 0; i < spec.classes.length; i++) {
      const c = spec.classes[i];
      if (!c || !c.name || !String(c.name).trim()) {
        return { ok: false, kind, error: "classes[" + i + "] sin name" };
      }
    }
    return { ok: true, kind: hasCurrentDiagram ? "patch" : "create" };
  }

  // patch
  const lists = ["addClasses", "updateClasses"];
  for (let li = 0; li < lists.length; li++) {
    const key = lists[li];
    const arr = spec[key];
    if (!Array.isArray(arr)) {
      continue;
    }
    for (let i = 0; i < arr.length; i++) {
      if (!arr[i] || !arr[i].name) {
        return { ok: false, kind, error: key + "[" + i + "] sin name" };
      }
    }
  }

  return { ok: true, kind: "patch" };
}

function summarizeSpec(spec, kind) {
  if (kind === "create") {
    const n = (spec.classes || []).length;
    const names = (spec.classes || []).map((c) => c.name).filter(Boolean);
    return "create " + n + " clases" + (names.length ? ": " + names.slice(0, 6).join(", ") : "");
  }
  if (kind === "patch") {
    const a = (spec.addClasses || []).length;
    const u = (spec.updateClasses || []).length;
    const r = (spec.removeClasses || []).length;
    const assoc = (spec.addAssociations || spec.associations || []).length;
    return "patch +" + a + " ~" + u + " -" + r + " rel+" + assoc;
  }
  return kind;
}

module.exports = {
  parseFeature,
  extractJson,
  classifySpec,
  validateSpec,
  summarizeSpec,
  hasNonEmptyArray
};

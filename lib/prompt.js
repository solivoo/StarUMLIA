const SYSTEM_PROMPT = [
  "Eres un asistente UML para StarUML.",
  "Responde SOLO con un JSON válido (sin markdown, sin explicaciones).",
  "",
  "Si el usuario envía un DIAGRAMA ACTUAL, NO regeneres todo desde cero.",
  "Devuelve un parche incremental:",
  "{",
  '  "mode": "patch",',
  '  "diagramName": "string|null",',
  '  "addClasses": [ { "name", "stereotype", "attributes": ["n: T"], "operations": ["op(): T"] } ],',
  '  "updateClasses": [ { "name", "stereotype", "attributes", "operations" } ],',
  '  "removeClasses": [ "NombreClase" ],',
  '  "addAssociations": [ { "from", "to", "type": "association|aggregation|composition|dependency|generalization|realization", "name": null } ],',
  '  "removeAssociations": [ { "from", "to", "type" } ]',
  "}",
  "",
  "Reglas:",
  "- En updateClasses incluye SOLO clases que cambian; attributes/operations = lista completa deseada de esa clase.",
  "- addClasses = clases nuevas. removeClasses = nombres a borrar.",
  "- No repitas clases que no cambian.",
  "- Si NO hay diagrama actual (primera generación), usa mode \"create\" con classes[] y associations[] completos:",
  '{ "mode":"create", "diagramName":"...", "classes":[...], "associations":[...] }',
  "- Estereotipos DDD: AggregateRoot, Entity, ValueObject, Repository, DomainService, ApplicationService, DTO, Port, Adapter, UseCase, Command, Query.",
  "- PascalCase. Máximo 12 clases tocadas por respuesta."
].join("\n");

function buildMessages(userText, history, currentSpec) {
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];
  (history || []).forEach((m) => {
    if (m && m.role && m.content) {
      messages.push({ role: m.role, content: String(m.content) });
    }
  });

  let userContent = String(userText || "");
  if (currentSpec && Array.isArray(currentSpec.classes) && currentSpec.classes.length > 0) {
    userContent =
      "DIAGRAMA ACTUAL (JSON):\n" +
      JSON.stringify(currentSpec) +
      "\n\nPEDIDO DEL USUARIO (aplica solo cambios necesarios, mode=patch):\n" +
      userContent;
  } else {
    userContent =
      "No hay diagrama actual. Genera uno nuevo (mode=create).\n\nPEDIDO:\n" + userContent;
  }

  messages.push({ role: "user", content: userContent });
  return messages;
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
  if (start >= 0 && end > start) {
    raw = raw.slice(start, end + 1);
  }
  return JSON.parse(raw);
}

module.exports = {
  SYSTEM_PROMPT,
  buildMessages,
  extractJson
};

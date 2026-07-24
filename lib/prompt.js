const SYSTEM_PROMPT = [
  "Eres un asistente UML para StarUML.",
  "Cuando el usuario pida un diagrama, responde SOLO con un JSON válido (sin markdown).",
  "Esquema:",
  "{",
  '  "diagramName": "string",',
  '  "classes": [',
  '    { "name": "string", "stereotype": "string|null", "attributes": ["name: type"], "operations": ["name(): type"] }',
  "  ],",
  '  "associations": [',
  '    { "from": "ClassA", "to": "ClassB", "type": "association|aggregation|composition|dependency|generalization|realization", "name": "string|null" }',
  "  ]",
  "}",
  "Estereotipos DDD útiles si aplican: AggregateRoot, Entity, ValueObject, Repository, DomainService, ApplicationService, DTO, Port, Adapter, UseCase, Command, Query.",
  "Usa nombres en PascalCase. Máximo 12 clases por respuesta."
].join("\n");

function buildMessages(userText, history) {
  const messages = [{ role: "system", content: SYSTEM_PROMPT }];
  (history || []).forEach((m) => {
    if (m && m.role && m.content) {
      messages.push({ role: m.role, content: String(m.content) });
    }
  });
  messages.push({ role: "user", content: String(userText || "") });
  return messages;
}

/**
 * Extrae JSON de una respuesta que puede venir con ```json ... ```
 */
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

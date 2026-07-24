const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildMessages, extractJson } = require("../lib/prompt");
const { validateSpec } = require("../lib/spec-utils");

/**
 * Flujo end-to-end sin StarUML ni red:
 * texto usuario → mensajes → (respuesta simulada) → validateSpec
 */
function simulatePipeline(userText, fakeReply, currentSpec) {
  const messages = buildMessages(userText, [], currentSpec);
  const spec = extractJson(fakeReply);
  const validation = validateSpec(spec, {
    hasCurrentDiagram: !!(currentSpec && currentSpec.classes && currentSpec.classes.length)
  });
  return { messages, spec, validation };
}

describe("pipeline sin StarUML", () => {
  it("saludo no intenta crear diagrama", () => {
    const { validation } = simulatePipeline(
      "hola",
      '{"mode":"chat","message":"Hola. Describe el dominio a modelar."}',
      null
    );
    assert.equal(validation.kind, "chat");
    assert.equal(validation.ok, true);
  });

  it("create calculadora", () => {
    const reply = JSON.stringify({
      mode: "create",
      diagramName: "Calculadora",
      classes: [
        {
          name: "Calculadora",
          stereotype: "AggregateRoot",
          attributes: ["resultado: number"],
          operations: ["sumar(a,b): number"]
        }
      ],
      associations: []
    });
    const { validation } = simulatePipeline("diagrama calculadora", reply, null);
    assert.equal(validation.ok, true);
    assert.equal(validation.kind, "create");
  });

  it("patch añade clase sobre diagrama existente", () => {
    const current = {
      classes: [{ name: "Calculadora", attributes: [], operations: [] }],
      associations: []
    };
    const reply = JSON.stringify({
      mode: "patch",
      addClasses: [{ name: "Operacion", stereotype: "Entity", attributes: ["tipo: string"] }],
      updateClasses: [],
      removeClasses: [],
      addAssociations: [
        { from: "Calculadora", to: "Operacion", type: "composition", name: null }
      ]
    });
    const { validation } = simulatePipeline("añade Operacion", reply, current);
    assert.equal(validation.ok, true);
    assert.equal(validation.kind, "patch");
  });
});

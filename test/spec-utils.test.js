const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  parseFeature,
  extractJson,
  classifySpec,
  validateSpec
} = require("../lib/spec-utils");
const { buildMessages } = require("../lib/prompt");

describe("parseFeature", () => {
  it("parsea name: type", () => {
    assert.deepEqual(parseFeature("total: number"), {
      name: "total",
      type: "number"
    });
  });

  it("parsea operación con tipo", () => {
    const r = parseFeature("sumar(a,b): number");
    assert.equal(r.name, "sumar(a,b)");
    assert.equal(r.type, "number");
  });

  it("vacío → unnamed", () => {
    assert.equal(parseFeature("").name, "unnamed");
  });
});

describe("extractJson", () => {
  it("extrae JSON puro", () => {
    const s = extractJson('{"mode":"chat","message":"hola"}');
    assert.equal(s.mode, "chat");
  });

  it("extrae de fence markdown", () => {
    const s = extractJson('```json\n{"mode":"create","classes":[{"name":"A"}]}\n```');
    assert.equal(s.mode, "create");
    assert.equal(s.classes[0].name, "A");
  });

  it("falla sin JSON", () => {
    assert.throws(() => extractJson("hola mundo"), /No se encontró JSON/);
  });

  it("falla JSON roto", () => {
    assert.throws(() => extractJson('{"mode":}'), /JSON inválido/);
  });
});

describe("classifySpec / validateSpec", () => {
  it("hola / mode chat no rompe", () => {
    const v = validateSpec({ mode: "chat", message: "¿Qué diagrama quieres?" });
    assert.equal(v.ok, true);
    assert.equal(v.kind, "chat");
    assert.match(v.message, /diagrama/i);
  });

  it("create sin classes → mensaje amable (no error duro de classes[])", () => {
    const v = validateSpec({ mode: "create" });
    assert.equal(v.ok, true);
    assert.equal(v.kind, "chat");
  });

  it("create válido", () => {
    const v = validateSpec({
      mode: "create",
      classes: [{ name: "Pedido", attributes: ["id: string"] }]
    });
    assert.equal(v.ok, true);
    assert.equal(v.kind, "create");
  });

  it("create con diagrama actual se trata como patch", () => {
    const v = validateSpec(
      {
        mode: "create",
        classes: [{ name: "Pedido" }]
      },
      { hasCurrentDiagram: true }
    );
    assert.equal(v.ok, true);
    assert.equal(v.kind, "patch");
  });

  it("patch con addClasses", () => {
    const v = validateSpec({
      mode: "patch",
      addClasses: [{ name: "Pago" }]
    });
    assert.equal(v.ok, true);
    assert.equal(v.kind, "patch");
  });

  it("patch vacío es válido (sin cambios)", () => {
    assert.equal(classifySpec({ mode: "patch" }), "patch");
    const v = validateSpec({ mode: "patch" });
    assert.equal(v.ok, true);
    assert.equal(v.kind, "patch");
  });

  it("clase sin name falla", () => {
    const v = validateSpec({
      mode: "create",
      classes: [{ attributes: ["x: int"] }]
    });
    assert.equal(v.ok, false);
  });

  it("objeto inválido", () => {
    const v = validateSpec(null);
    assert.equal(v.ok, false);
    assert.equal(v.kind, "invalid");
  });
});

describe("buildMessages", () => {
  it("incluye system y user", () => {
    const msgs = buildMessages("crea diagrama", [], null);
    assert.equal(msgs[0].role, "system");
    assert.equal(msgs[msgs.length - 1].role, "user");
    assert.match(msgs[msgs.length - 1].content, /mode=create|mode=chat/);
  });

  it("con diagrama actual pide patch", () => {
    const msgs = buildMessages(
      "añade Pago",
      [],
      { classes: [{ name: "Pedido" }], associations: [] }
    );
    assert.match(msgs[msgs.length - 1].content, /DIAGRAMA ACTUAL/);
    assert.match(msgs[msgs.length - 1].content, /mode=patch/);
  });
});

describe("regresión error hola", () => {
  it("no lanza 'classes[] para create' ante saludo JSON", () => {
    const reply = '{"mode":"chat","message":"Hola, ¿qué diagrama quieres?"}';
    const spec = extractJson(reply);
    const v = validateSpec(spec, { hasCurrentDiagram: false });
    assert.equal(v.ok, true);
    assert.equal(v.kind, "chat");
  });

  it("create vacío no usa el error antiguo", () => {
    const v = validateSpec({ mode: "create", classes: [] });
    assert.equal(v.ok, true);
    assert.equal(v.kind, "chat");
    assert.doesNotMatch(v.message || "", /classes\[\] para create/);
  });
});

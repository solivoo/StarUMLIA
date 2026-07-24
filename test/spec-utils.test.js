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

describe("sanitizeAssocName", () => {
  const { sanitizeAssocName } = require("../lib/diagram-builder");

  it("elimina verbos ruidosos", () => {
    assert.equal(sanitizeAssocName("+usa"), null);
    assert.equal(sanitizeAssocName("crea"), null);
    assert.equal(sanitizeAssocName("produce"), null);
    assert.equal(sanitizeAssocName("persiste"), null);
  });

  it("conserva roles significativos", () => {
    assert.equal(sanitizeAssocName("items"), "items");
    assert.equal(sanitizeAssocName("+owner"), "owner");
  });

  it("null/vacío → null", () => {
    assert.equal(sanitizeAssocName(null), null);
    assert.equal(sanitizeAssocName(""), null);
  });
});

describe("interfaces y capas DDD", () => {
  const { isInterfaceSpec, inferLayer, relationId } = require("../lib/diagram-builder");

  it("detecta interface por kind", () => {
    assert.equal(isInterfaceSpec({ name: "IRepo", kind: "interface" }), true);
  });

  it("detecta interface por stereotype", () => {
    assert.equal(isInterfaceSpec({ name: "IRepo", stereotype: "interface" }), true);
  });

  it("Port + INombre → interface", () => {
    assert.equal(isInterfaceSpec({ name: "IEventPublisher", stereotype: "Port" }), true);
  });

  it("clase normal no es interface", () => {
    assert.equal(isInterfaceSpec({ name: "Historial", stereotype: "AggregateRoot" }), false);
  });

  it("infiere capas DDD", () => {
    assert.equal(inferLayer({ stereotype: "Entity" }), "Domain");
    assert.equal(inferLayer({ stereotype: "ApplicationService" }), "Application");
    assert.equal(inferLayer({ stereotype: "Repository" }), "Infrastructure");
    assert.equal(inferLayer({ stereotype: "Adapter" }), "Infrastructure");
    assert.equal(inferLayer({ kind: "interface", name: "IFoo" }), "Interfaces");
    assert.equal(inferLayer({ layer: "Domain", stereotype: "DTO" }), "Domain");
  });

  it("realization mapea a UMLInterfaceRealization", () => {
    assert.equal(relationId("realization"), "UMLInterfaceRealization");
    assert.equal(relationId("interfaceRealization"), "UMLInterfaceRealization");
  });
});

describe("contrato del SYSTEM_PROMPT", () => {
  const { SYSTEM_PROMPT } = require("../lib/prompt");

  it("instruye kind:interface para interfaces reales", () => {
    assert.match(SYSTEM_PROMPT, /kind:"interface"/);
  });

  it("instruye dirección correcta de realization (from=implementador, to=interfaz)", () => {
    assert.match(SYSTEM_PROMPT, /realization: SIEMPRE from=/);
  });

  it("soporta agrupar por capas DDD", () => {
    assert.match(SYSTEM_PROMPT, /groupByLayers/);
    assert.match(SYSTEM_PROMPT, /Domain.*Application.*Infrastructure/);
  });

  it("prohíbe etiquetas verbo en asociaciones", () => {
    assert.match(SYSTEM_PROMPT, /NUNCA uses verbos/);
  });
});

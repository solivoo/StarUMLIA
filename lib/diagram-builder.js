/**
 * Construye un diagrama de clases UML a partir del JSON de Kimi.
 */

function ensureParent() {
  const selected = app.selections.getSelected();
  if (selected && !(selected instanceof type.Diagram)) {
    return selected;
  }
  const project = app.project.getProject();
  if (!project) {
    throw new Error("No hay proyecto abierto");
  }
  // Preferir un Model hijo
  const model = (project.ownedElements || []).find(
    (e) => e.getClassName && e.getClassName() === "UMLModel"
  );
  return model || project;
}

function createClassDiagram(parent, name) {
  return app.factory.createDiagram({
    id: "UMLClassDiagram",
    parent: parent,
    diagramInitializer: (d) => {
      d.name = name || "Kimi Class Diagram";
    }
  });
}

function addAttribute(classModel, text) {
  if (!text) {
    return;
  }
  app.factory.createModel({
    id: "UMLAttribute",
    parent: classModel,
    modelInitializer: (m) => {
      m.name = String(text);
    }
  });
}

function addOperation(classModel, text) {
  if (!text) {
    return;
  }
  app.factory.createModel({
    id: "UMLOperation",
    parent: classModel,
    modelInitializer: (m) => {
      m.name = String(text);
    }
  });
}

function placeClass(diagram, classModel, x, y) {
  return app.factory.createViewOf({
    model: classModel,
    diagram: diagram,
    viewInitializer: (v) => {
      v.left = x;
      v.top = y;
    }
  });
}

function createClassOnDiagram(parent, diagram, classSpec, x, y) {
  const classModel = app.factory.createModel({
    id: "UMLClass",
    parent: parent,
    modelInitializer: (m) => {
      m.name = classSpec.name || "Class";
      if (classSpec.stereotype) {
        m.stereotype = String(classSpec.stereotype);
      }
    }
  });

  (classSpec.attributes || []).forEach((a) => addAttribute(classModel, a));
  (classSpec.operations || []).forEach((o) => addOperation(classModel, o));

  const view = placeClass(diagram, classModel, x, y);
  return { model: classModel, view: view };
}

function relationId(relType) {
  switch (String(relType || "association").toLowerCase()) {
    case "aggregation":
      return "UMLAssociation"; // end1 aggregation set after
    case "composition":
      return "UMLAssociation";
    case "dependency":
      return "UMLDependency";
    case "generalization":
      return "UMLGeneralization";
    case "realization":
    case "interfaceRealization":
      return "UMLInterfaceRealization";
    default:
      return "UMLAssociation";
  }
}

function connect(diagram, fromView, toView, assoc) {
  const id = relationId(assoc.type);
  const options = {
    id: id,
    parent: diagram,
    diagram: diagram,
    tailView: fromView,
    headView: toView,
    tailModel: fromView.model,
    headModel: toView.model
  };

  if (assoc.name) {
    options.modelInitializer = (m) => {
      m.name = String(assoc.name);
    };
  }

  const edge = app.factory.createModelAndView(options);

  // aggregation / composition en association ends si aplica
  try {
    const t = String(assoc.type || "").toLowerCase();
    if (edge && edge.model && edge.model.end1) {
      if (t === "aggregation") {
        app.engine.setProperty(edge.model.end1, "aggregation", type.UMLAttribute.AK_SHARED);
      } else if (t === "composition") {
        app.engine.setProperty(edge.model.end1, "aggregation", type.UMLAttribute.AK_COMPOSITE);
      }
    }
  } catch (err) {
    console.warn("[Kimi] aggregation flag:", err);
  }

  return edge;
}

/**
 * @param {object} spec JSON de Kimi
 * @returns {{ diagram: object, classCount: number, assocCount: number }}
 */
function buildFromSpec(spec) {
  if (!spec || !Array.isArray(spec.classes) || spec.classes.length === 0) {
    throw new Error("El JSON no tiene classes[]");
  }

  const parent = ensureParent();
  const diagram = createClassDiagram(parent, spec.diagramName || "Kimi Class Diagram");

  // Contenedor de elementos: el parent del diagrama suele ser Model/Package
  const modelParent = diagram._parent || parent;
  const byName = {};
  const gapX = 220;
  const gapY = 160;
  const cols = 3;

  spec.classes.forEach((c, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 40 + col * gapX;
    const y = 40 + row * gapY;
    const created = createClassOnDiagram(modelParent, diagram, c, x, y);
    byName[c.name] = created;
  });

  let assocCount = 0;
  (spec.associations || []).forEach((a) => {
    const from = byName[a.from];
    const to = byName[a.to];
    if (!from || !to) {
      console.warn("[Kimi] asociación omitida:", a);
      return;
    }
    connect(diagram, from.view, to.view, a);
    assocCount += 1;
  });

  app.diagrams.setCurrentDiagram(diagram);
  app.diagrams.repaint();

  return {
    diagram: diagram,
    classCount: spec.classes.length,
    assocCount: assocCount
  };
}

module.exports = {
  buildFromSpec
};

/**
 * Crea o actualiza (merge/patch) un diagrama de clases UML desde JSON de Kimi.
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

function featureLabel(elem) {
  if (!elem) {
    return "";
  }
  const n = elem.name || "";
  const t = elem.type
    ? typeof elem.type === "string"
      ? elem.type
      : elem.type.name || ""
    : "";
  return t ? n + ": " + t : n;
}

function addAttribute(classModel, text) {
  if (!text) {
    return;
  }
  const parsed = parseFeature(text);
  app.factory.createModel({
    id: "UMLAttribute",
    parent: classModel,
    field: "attributes",
    modelInitializer: (m) => {
      m.name = parsed.name;
      if (parsed.type) {
        m.type = parsed.type;
      }
    }
  });
}

function addOperation(classModel, text) {
  if (!text) {
    return;
  }
  const parsed = parseFeature(text);
  app.factory.createModel({
    id: "UMLOperation",
    parent: classModel,
    field: "operations",
    modelInitializer: (m) => {
      m.name = parsed.name.replace(/\(\)$/, "") || parsed.name;
      if (parsed.type) {
        try {
          m.type = parsed.type;
        } catch (err) {
          /* ignore */
        }
      }
    }
  });
}

function clearFeaturesAttrsOnly(classModel) {
  (classModel.attributes || []).slice().forEach((a) => {
    try {
      app.engine.deleteElements([a], []);
    } catch (err) {
      /* ignore */
    }
  });
}

function clearFeaturesOpsOnly(classModel) {
  (classModel.operations || []).slice().forEach((o) => {
    try {
      app.engine.deleteElements([o], []);
    } catch (err) {
      /* ignore */
    }
  });
}

function setFeatures(classModel, attributes, operations) {
  if (Array.isArray(attributes)) {
    clearFeaturesAttrsOnly(classModel);
    attributes.forEach((a) => addAttribute(classModel, a));
  }
  if (Array.isArray(operations)) {
    clearFeaturesOpsOnly(classModel);
    operations.forEach((o) => addOperation(classModel, o));
  }
}

function placeClass(diagram, classModel, x, y) {
  const editor = app.diagrams.getEditor();
  const view = app.factory.createViewOf({
    model: classModel,
    diagram: diagram,
    editor: editor,
    x: x,
    y: y
  });

  if (view) {
    try {
      app.engine.setProperty(view, "suppressAttributes", false);
      app.engine.setProperty(view, "suppressOperations", false);
      app.engine.setProperty(view, "left", x);
      app.engine.setProperty(view, "top", y);
    } catch (err) {
      view.suppressAttributes = false;
      view.suppressOperations = false;
      view.left = x;
      view.top = y;
    }
  }
  return view;
}

function nextFreeSlot(diagram) {
  const views = (diagram.ownedViews || []).filter(
    (v) => v && v.getClassName && /ClassView$|InterfaceView$/.test(v.getClassName())
  );
  const cols = 3;
  const gapX = 280;
  const gapY = 220;
  const i = views.length;
  return {
    x: 60 + (i % cols) * gapX,
    y: 60 + Math.floor(i / cols) * gapY
  };
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

function findClassModelByName(parent, name) {
  if (!parent || !name) {
    return null;
  }
  const all = [];
  function walk(el) {
    if (!el) {
      return;
    }
    if (el.getClassName && el.getClassName() === "UMLClass" && el.name === name) {
      all.push(el);
    }
    (el.ownedElements || []).forEach(walk);
  }
  walk(parent);
  // también buscar en project
  if (!all.length && app.repository.find) {
    try {
      const found = app.repository.find((e) => {
        return e && e.getClassName && e.getClassName() === "UMLClass" && e.name === name;
      });
      if (found) {
        return found;
      }
    } catch (err) {
      /* ignore */
    }
  }
  return all[0] || null;
}

function getViewOf(diagram, model) {
  if (!diagram || !model) {
    return null;
  }
  if (diagram.getViewOf) {
    return diagram.getViewOf(model);
  }
  return (diagram.ownedViews || []).find((v) => v.model === model) || null;
}

function relationId(relType) {
  switch (String(relType || "association").toLowerCase()) {
    case "aggregation":
    case "composition":
      return "UMLAssociation";
    case "dependency":
      return "UMLDependency";
    case "generalization":
      return "UMLGeneralization";
    case "realization":
    case "interfacerealization":
      return "UMLInterfaceRealization";
    default:
      return "UMLAssociation";
  }
}

function connect(diagram, fromView, toView, assoc) {
  if (!fromView || !toView) {
    return null;
  }
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

  try {
    const t = String(assoc.type || "").toLowerCase();
    const model = edge && edge.model ? edge.model : edge;
    if (model && model.end1) {
      if (t === "aggregation") {
        app.engine.setProperty(model.end1, "aggregation", type.UMLAttribute.AK_SHARED);
      } else if (t === "composition") {
        app.engine.setProperty(model.end1, "aggregation", type.UMLAttribute.AK_COMPOSITE);
      }
    }
  } catch (err) {
    console.warn("[Kimi] aggregation flag:", err);
  }

  return edge;
}

function associationExists(diagram, fromModel, toModel) {
  return (diagram.ownedViews || []).some((v) => {
    if (!v || !v.model) {
      return false;
    }
    const m = v.model;
    const a = m.end1 ? m.end1.reference : m.source;
    const b = m.end2 ? m.end2.reference : m.target;
    return (a === fromModel && b === toModel) || (a === toModel && b === fromModel);
  });
}

function layoutViews(views) {
  const gapX = 280;
  const gapY = 220;
  const cols = Math.max(2, Math.ceil(Math.sqrt(Math.max(views.length, 1))));
  views.forEach((view, i) => {
    if (!view) {
      return;
    }
    const x = 60 + (i % cols) * gapX;
    const y = 60 + Math.floor(i / cols) * gapY;
    try {
      app.engine.setProperty(view, "left", x);
      app.engine.setProperty(view, "top", y);
    } catch (err) {
      view.left = x;
      view.top = y;
    }
  });
}

/**
 * Snapshot del diagrama de clases actual → JSON compatible con el prompt.
 */
function snapshotCurrentDiagram() {
  const diagram = app.diagrams.getCurrentDiagram();
  if (!diagram || !diagram.getClassName || diagram.getClassName() !== "UMLClassDiagram") {
    return null;
  }

  const classViews = (diagram.ownedViews || []).filter((v) => {
    return v && v.model && v.model.getClassName && v.model.getClassName() === "UMLClass";
  });

  if (!classViews.length) {
    return null;
  }

  const classes = classViews.map((v) => {
    const m = v.model;
    return {
      name: m.name,
      stereotype:
        typeof m.stereotype === "string"
          ? m.stereotype
          : m.stereotype && m.stereotype.name
            ? m.stereotype.name
            : null,
      attributes: (m.attributes || []).map(featureLabel),
      operations: (m.operations || []).map(featureLabel)
    };
  });

  const associations = [];
  (diagram.ownedViews || []).forEach((v) => {
    if (!v || !v.model) {
      return;
    }
    const m = v.model;
    const cn = m.getClassName && m.getClassName();
    let from = null;
    let to = null;
    let typeName = "association";
    if (cn === "UMLAssociation") {
      from = m.end1 && m.end1.reference;
      to = m.end2 && m.end2.reference;
      if (m.end1 && m.end1.aggregation === type.UMLAttribute.AK_COMPOSITE) {
        typeName = "composition";
      } else if (m.end1 && m.end1.aggregation === type.UMLAttribute.AK_SHARED) {
        typeName = "aggregation";
      }
    } else if (cn === "UMLDependency") {
      from = m.source;
      to = m.target;
      typeName = "dependency";
    } else if (cn === "UMLGeneralization") {
      from = m.source;
      to = m.target;
      typeName = "generalization";
    } else if (cn === "UMLInterfaceRealization") {
      from = m.source;
      to = m.target;
      typeName = "realization";
    } else {
      return;
    }
    if (from && to && from.name && to.name) {
      associations.push({
        from: from.name,
        to: to.name,
        type: typeName,
        name: m.name || null
      });
    }
  });

  return {
    diagramName: diagram.name,
    classes: classes,
    associations: associations
  };
}

function applyCreate(spec) {
  const parent = ensureParent();
  const diagram = createClassDiagram(parent, spec.diagramName || "Kimi Class Diagram");
  app.diagrams.setCurrentDiagram(diagram);

  const modelParent = diagram._parent || parent;
  const byName = {};
  const views = [];
  const cols = Math.max(2, Math.ceil(Math.sqrt(spec.classes.length)));
  const gapX = 280;
  const gapY = 220;

  spec.classes.forEach((c, i) => {
    const x = 60 + (i % cols) * gapX;
    const y = 60 + Math.floor(i / cols) * gapY;
    const created = createClassOnDiagram(modelParent, diagram, c, x, y);
    byName[c.name] = created;
    if (created.view) {
      views.push(created.view);
    }
  });

  layoutViews(views);

  let assocCount = 0;
  (spec.associations || []).forEach((a) => {
    const from = byName[a.from];
    const to = byName[a.to];
    if (!from || !to || !from.view || !to.view) {
      return;
    }
    connect(diagram, from.view, to.view, a);
    assocCount += 1;
  });

  app.diagrams.repaint();
  return {
    diagram: diagram,
    mode: "create",
    added: spec.classes.length,
    updated: 0,
    removed: 0,
    assocCount: assocCount
  };
}

function applyPatch(spec) {
  let diagram = app.diagrams.getCurrentDiagram();
  if (!diagram || diagram.getClassName() !== "UMLClassDiagram") {
    // sin diagrama usable → tratar create si viene classes
    if (spec.classes && spec.classes.length) {
      return applyCreate(spec);
    }
    throw new Error("No hay diagrama de clases activo para aplicar el parche");
  }

  app.diagrams.setCurrentDiagram(diagram);
  const modelParent = diagram._parent || ensureParent();
  let added = 0;
  let updated = 0;
  let removed = 0;
  let assocCount = 0;

  if (spec.diagramName) {
    try {
      app.engine.setProperty(diagram, "name", spec.diagramName);
    } catch (err) {
      diagram.name = spec.diagramName;
    }
  }

  // remove classes
  (spec.removeClasses || []).forEach((name) => {
    const model = findClassModelByName(modelParent, name);
    if (!model) {
      return;
    }
    const view = getViewOf(diagram, model);
    try {
      if (view) {
        app.engine.deleteElements([model], [view]);
      } else {
        app.engine.deleteElements([model], []);
      }
      removed += 1;
    } catch (err) {
      console.warn("[Kimi] remove class", name, err);
    }
  });

  // add classes
  (spec.addClasses || []).forEach((c) => {
    if (!c || !c.name) {
      return;
    }
    if (findClassModelByName(modelParent, c.name)) {
      return;
    }
    const slot = nextFreeSlot(diagram);
    createClassOnDiagram(modelParent, diagram, c, slot.x, slot.y);
    added += 1;
  });

  // update classes
  (spec.updateClasses || []).forEach((c) => {
    if (!c || !c.name) {
      return;
    }
    const model = findClassModelByName(modelParent, c.name);
    if (!model) {
      const slot = nextFreeSlot(diagram);
      createClassOnDiagram(modelParent, diagram, c, slot.x, slot.y);
      added += 1;
      return;
    }
    if (c.stereotype !== undefined) {
      try {
        app.engine.setProperty(model, "stereotype", c.stereotype || null);
      } catch (err) {
        model.stereotype = c.stereotype || null;
      }
    }
    if (Array.isArray(c.attributes) || Array.isArray(c.operations)) {
      setFeatures(model, c.attributes, c.operations);
    }
    let view = getViewOf(diagram, model);
    if (!view) {
      const slot = nextFreeSlot(diagram);
      view = placeClass(diagram, model, slot.x, slot.y);
    } else {
      try {
        app.engine.setProperty(view, "suppressAttributes", false);
        app.engine.setProperty(view, "suppressOperations", false);
      } catch (err) {
        /* ignore */
      }
    }
    updated += 1;
  });

  // remove associations
  (spec.removeAssociations || []).forEach((a) => {
    const fromM = findClassModelByName(modelParent, a.from);
    const toM = findClassModelByName(modelParent, a.to);
    if (!fromM || !toM) {
      return;
    }
    (diagram.ownedViews || []).slice().forEach((v) => {
      if (!v || !v.model) {
        return;
      }
      const m = v.model;
      const endA = m.end1 ? m.end1.reference : m.source;
      const endB = m.end2 ? m.end2.reference : m.target;
      if (
        (endA === fromM && endB === toM) ||
        (endA === toM && endB === fromM)
      ) {
        try {
          app.engine.deleteElements([m], [v]);
        } catch (err) {
          /* ignore */
        }
      }
    });
  });

  // add associations
  (spec.addAssociations || []).forEach((a) => {
    const fromM = findClassModelByName(modelParent, a.from);
    const toM = findClassModelByName(modelParent, a.to);
    if (!fromM || !toM) {
      return;
    }
    if (associationExists(diagram, fromM, toM)) {
      return;
    }
    const fromV = getViewOf(diagram, fromM);
    const toV = getViewOf(diagram, toM);
    if (!fromV || !toV) {
      return;
    }
    connect(diagram, fromV, toV, a);
    assocCount += 1;
  });

  // compat: si Kimi mandó create-like dentro de patch
  if ((!spec.addClasses || !spec.addClasses.length) && Array.isArray(spec.classes)) {
    spec.classes.forEach((c) => {
      const existing = findClassModelByName(modelParent, c.name);
      if (existing) {
        if (c.stereotype !== undefined) {
          try {
            app.engine.setProperty(existing, "stereotype", c.stereotype || null);
          } catch (err) {
            existing.stereotype = c.stereotype || null;
          }
        }
        if (Array.isArray(c.attributes) || Array.isArray(c.operations)) {
          setFeatures(existing, c.attributes, c.operations);
        }
        updated += 1;
      } else {
        const slot = nextFreeSlot(diagram);
        createClassOnDiagram(modelParent, diagram, c, slot.x, slot.y);
        added += 1;
      }
    });
  }

  if (Array.isArray(spec.associations)) {
    spec.associations.forEach((a) => {
      const fromM = findClassModelByName(modelParent, a.from);
      const toM = findClassModelByName(modelParent, a.to);
      if (!fromM || !toM) {
        return;
      }
      if (associationExists(diagram, fromM, toM)) {
        return;
      }
      const fromV = getViewOf(diagram, fromM);
      const toV = getViewOf(diagram, toM);
      if (fromV && toV) {
        connect(diagram, fromV, toV, a);
        assocCount += 1;
      }
    });
  }

  app.diagrams.repaint();
  return {
    diagram: diagram,
    mode: "patch",
    added: added,
    updated: updated,
    removed: removed,
    assocCount: assocCount
  };
}

/**
 * Aplica create o patch según spec.mode / contexto.
 */
function buildFromSpec(spec) {
  if (!spec || typeof spec !== "object") {
    throw new Error("Spec inválido");
  }

  const mode = String(spec.mode || "").toLowerCase();
  const hasCurrent =
    app.diagrams.getCurrentDiagram() &&
    app.diagrams.getCurrentDiagram().getClassName() === "UMLClassDiagram";

  if (mode === "patch" || (hasCurrent && mode !== "create")) {
    // Si vino "create" completo pero ya hay diagrama, fusionar como patch
    if (mode === "create" && hasCurrent && Array.isArray(spec.classes)) {
      return applyPatch({
        mode: "patch",
        diagramName: spec.diagramName,
        addClasses: [],
        updateClasses: [],
        removeClasses: [],
        addAssociations: [],
        classes: spec.classes,
        associations: spec.associations || []
      });
    }
    return applyPatch(spec);
  }

  if (!Array.isArray(spec.classes) || !spec.classes.length) {
    throw new Error("El JSON no tiene classes[] para create");
  }
  return applyCreate(spec);
}

module.exports = {
  buildFromSpec,
  snapshotCurrentDiagram
};

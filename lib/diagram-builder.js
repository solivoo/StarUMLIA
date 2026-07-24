/**
 * Crea o actualiza (merge/patch) un diagrama de clases UML desde JSON de Kimi.
 */

const { parseFeature, validateSpec } = require("./spec-utils");

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

function placeClass(diagram, classModel, x, y, containerView) {
  const editor = app.diagrams.getEditor();
  let view = null;

  // Preferir API que soporta containerView (paquetes / capas)
  if (containerView && editor && app.factory.createViewAndRelationships) {
    try {
      view = app.factory.createViewAndRelationships(
        editor,
        x,
        y,
        classModel,
        containerView
      );
    } catch (err) {
      console.warn("[Kimi] createViewAndRelationships:", err);
    }
  }

  if (!view) {
    view = app.factory.createViewOf({
      model: classModel,
      diagram: diagram,
      editor: editor,
      x: x,
      y: y
    });
  }

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

/** ¿El spec describe una interfaz UML real (no solo estereotipo Port)? */
function isInterfaceSpec(spec) {
  if (!spec) {
    return false;
  }
  const kind = String(spec.kind || "").toLowerCase();
  if (kind === "interface") {
    return true;
  }
  const st = String(spec.stereotype || "").toLowerCase();
  if (st === "interface" || st === "umlinterface") {
    return true;
  }
  // Convención: INombre + Port → interfaz
  if (st === "port" && /^I[A-Z]/.test(String(spec.name || ""))) {
    return true;
  }
  return false;
}

/** Infiera capa DDD desde estereotipo si no viene layer */
function inferLayer(spec) {
  if (spec && spec.layer) {
    return String(spec.layer);
  }
  if (spec && spec.package) {
    return String(spec.package);
  }
  const st = String((spec && spec.stereotype) || "").toLowerCase();
  if (
    /aggregateroot|entity|valueobject|domainservice|domainevent|factory|specification|domain/.test(
      st
    )
  ) {
    return "Domain";
  }
  if (/applicationservice|usecase|command|query|handler|dto|application/.test(st)) {
    return "Application";
  }
  if (/repository|adapter|anticorruption|infrastructure/.test(st)) {
    return "Infrastructure";
  }
  if (/controller|presentation|ui/.test(st)) {
    return "Presentation";
  }
  if (/port|interface/.test(st) || isInterfaceSpec(spec)) {
    return "Interfaces";
  }
  return null;
}

const LAYER_ORDER = [
  "Domain",
  "Application",
  "Infrastructure",
  "Presentation",
  "Interfaces",
  "Shared"
];

function ensurePackage(parent, diagram, layerName, index, cache) {
  if (cache[layerName]) {
    return cache[layerName];
  }
  const pkgModel = app.factory.createModel({
    id: "UMLPackage",
    parent: parent,
    modelInitializer: (m) => {
      m.name = layerName;
    }
  });

  const cols = 2;
  const x = 40 + (index % cols) * 720;
  const y = 40 + Math.floor(index / cols) * 520;
  const editor = app.diagrams.getEditor();
  let pkgView = null;
  try {
    pkgView = app.factory.createViewOf({
      model: pkgModel,
      diagram: diagram,
      editor: editor,
      x: x,
      y: y
    });
  } catch (err) {
    console.warn("[Kimi] package view:", err);
  }

  if (pkgView) {
    try {
      app.engine.setProperty(pkgView, "left", x);
      app.engine.setProperty(pkgView, "top", y);
      app.engine.setProperty(pkgView, "width", 680);
      app.engine.setProperty(pkgView, "height", 480);
    } catch (err) {
      pkgView.left = x;
      pkgView.top = y;
      pkgView.width = 680;
      pkgView.height = 480;
    }
  }

  cache[layerName] = { model: pkgModel, view: pkgView, childCount: 0 };
  return cache[layerName];
}

function createClassOnDiagram(parent, diagram, classSpec, x, y, containerView) {
  const asInterface = isInterfaceSpec(classSpec);
  const modelId = asInterface ? "UMLInterface" : "UMLClass";
  const classModel = app.factory.createModel({
    id: modelId,
    parent: parent,
    modelInitializer: (m) => {
      m.name = classSpec.name || (asInterface ? "Interface" : "Class");
      // En UMLInterface el estereotipo «interface» es redundante; no lo forzamos
      if (classSpec.stereotype && !asInterface) {
        m.stereotype = String(classSpec.stereotype);
      } else if (asInterface && classSpec.stereotype && String(classSpec.stereotype).toLowerCase() !== "interface") {
        m.stereotype = String(classSpec.stereotype);
      }
    }
  });

  (classSpec.attributes || []).forEach((a) => addAttribute(classModel, a));
  (classSpec.operations || []).forEach((o) => addOperation(classModel, o));

  const view = placeClass(diagram, classModel, x, y, containerView);
  return { model: classModel, view: view };
}

function isClassifierModel(el) {
  if (!el || !el.getClassName) {
    return false;
  }
  const cn = el.getClassName();
  return cn === "UMLClass" || cn === "UMLInterface";
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
    if (isClassifierModel(el) && el.name === name) {
      all.push(el);
    }
    (el.ownedElements || []).forEach(walk);
  }
  walk(parent);
  if (!all.length && app.repository.find) {
    try {
      const found = app.repository.find((e) => {
        return e && isClassifierModel(e) && e.name === name;
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
    const v = diagram.getViewOf(model);
    if (v) {
      return v;
    }
  }
  function findIn(views) {
    for (let i = 0; i < (views || []).length; i++) {
      const v = views[i];
      if (v && v.model === model) {
        return v;
      }
      if (v && v.containedViews && v.containedViews.length) {
        const nested = findIn(v.containedViews);
        if (nested) {
          return nested;
        }
      }
    }
    return null;
  }
  return findIn(diagram.ownedViews);
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

/** Nombres de relación genéricos que solo saturan el diagrama */
const NOISE_ASSOC_NAMES = /^(usa|crea|produce|emite|publica|referencia|contiene|persiste|usa\s|uses|creates|depends|has|owns)$/i;

function sanitizeAssocName(name) {
  if (name == null || name === "") {
    return null;
  }
  const n = String(name)
    .trim()
    .replace(/^\++/, "")
    .trim();
  if (!n || NOISE_ASSOC_NAMES.test(n)) {
    return null;
  }
  return n;
}

function isEdgeView(v) {
  if (!v) {
    return false;
  }
  if (type.EdgeView && v instanceof type.EdgeView) {
    return true;
  }
  return typeof v.lineStyle !== "undefined" && v.points;
}

function roundRectStyle() {
  if (type.EdgeView && type.EdgeView.LS_ROUNDRECT != null) {
    return type.EdgeView.LS_ROUNDRECT;
  }
  return 2; // EdgeView.LS_ROUNDRECT
}

function connect(diagram, fromView, toView, assoc) {
  if (!fromView || !toView) {
    return null;
  }
  let id = relationId(assoc.type);
  let tailView = fromView;
  let headView = toView;
  const cleanName = sanitizeAssocName(assoc && assoc.name);

  // UMLInterfaceRealization exige:
  //   tail = UMLClassifier (implementador), head = UMLInterface
  if (id === "UMLInterfaceRealization") {
    const fromModel = fromView.model;
    const toModel = toView.model;
    const fromIsIface =
      fromModel &&
      ((type.UMLInterface && fromModel instanceof type.UMLInterface) ||
        (fromModel.getClassName && fromModel.getClassName() === "UMLInterface"));
    const toIsIface =
      toModel &&
      ((type.UMLInterface && toModel instanceof type.UMLInterface) ||
        (toModel.getClassName && toModel.getClassName() === "UMLInterface"));

    if (toIsIface && !fromIsIface) {
      // from (clase) → to (interfaz) ✓
      tailView = fromView;
      headView = toView;
    } else if (fromIsIface && !toIsIface) {
      // Kimi invirtió from/to → corregir
      tailView = toView;
      headView = fromView;
    } else {
      // Ninguno es UMLInterface real (p.ej. clase con estereotipo) → dependency
      id = "UMLDependency";
      console.warn(
        "[Kimi] realization sin UMLInterface real; usando dependency:",
        fromModel && fromModel.name,
        "→",
        toModel && toModel.name
      );
    }
  }

  const options = {
    id: id,
    parent: diagram,
    diagram: diagram,
    tailView: tailView,
    headView: headView,
    tailModel: tailView.model,
    headModel: headView.model
  };

  if (cleanName) {
    options.modelInitializer = (m) => {
      m.name = cleanName;
    };
  }

  let edge = null;
  try {
    edge = app.factory.createModelAndView(options);
  } catch (err) {
    console.warn("[Kimi] connect falló (" + id + "):", err && err.message ? err.message : err);
    // Fallback: dependency para no abortar todo el diagrama
    if (id !== "UMLDependency") {
      try {
        edge = app.factory.createModelAndView({
          id: "UMLDependency",
          parent: diagram,
          diagram: diagram,
          tailView: fromView,
          headView: toView,
          tailModel: fromView.model,
          headModel: toView.model
        });
      } catch (err2) {
        console.warn("[Kimi] fallback dependency también falló:", err2);
        return null;
      }
    } else {
      return null;
    }
  }

  // Estilo redondeado al crear (antes del layout)
  try {
    const view = edge && edge.view ? edge.view : edge;
    if (isEdgeView(view)) {
      app.engine.setProperty(view, "lineStyle", roundRectStyle());
    }
  } catch (err) {
    /* ignore */
  }

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
 * Auto-layout con dagre (minimiza cruces) + líneas rectilíneas redondeadas.
 * Fallback silencioso si la API no está disponible.
 */
function autoLayout(diagram) {
  if (!diagram) {
    return false;
  }
  const editor = app.diagrams.getEditor && app.diagrams.getEditor();
  const dir = (type.Diagram && type.Diagram.LD_TB) || "TB";
  const style = roundRectStyle();
  // Más aire entre nodos → menos cruces y etiquetas amontonadas
  const separations = { node: 90, edge: 50, rank: 110 };
  let ok = false;

  if (editor) {
    try {
      app.engine.layoutDiagram(editor, diagram, dir, separations, style);
      ok = true;
    } catch (err) {
      console.warn("[Kimi] autoLayout falló:", err);
    }
  } else {
    console.warn("[Kimi] autoLayout: editor no disponible aún");
  }

  // CRÍTICO: layoutDiagram a veces no persiste lineStyle; lo forzamos SIEMPRE después.
  applyRoundedLines(diagram);
  try {
    app.diagrams.repaint();
  } catch (err) {
    /* ignore */
  }
  return ok;
}

/** Fuerza estilo de línea rectilíneo redondeado en todas las aristas del diagrama */
function applyRoundedLines(diagram) {
  if (!diagram) {
    return 0;
  }
  const style = roundRectStyle();
  let n = 0;
  (diagram.ownedViews || []).forEach((v) => {
    if (!isEdgeView(v)) {
      return;
    }
    try {
      app.engine.setProperty(v, "lineStyle", style);
      n += 1;
    } catch (err) {
      try {
        v.lineStyle = style;
        n += 1;
      } catch (err2) {
        /* ignore */
      }
    }
  });
  return n;
}

/** Quita etiquetas ruidosas (usa/crea/…) de las relaciones del diagrama */
function cleanNoiseAssociationNames(diagram) {
  if (!diagram) {
    return 0;
  }
  let n = 0;
  (diagram.ownedViews || []).forEach((v) => {
    if (!isEdgeView(v) || !v.model) {
      return;
    }
    const m = v.model;
    if (!m.name) {
      return;
    }
    const cleaned = sanitizeAssocName(m.name);
    if (cleaned === null) {
      try {
        app.engine.setProperty(m, "name", "");
        n += 1;
      } catch (err) {
        try {
          m.name = "";
          n += 1;
        } catch (err2) {
          /* ignore */
        }
      }
    }
  });
  return n;
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
    return v && v.model && isClassifierModel(v.model);
  });

  // También clasificadores dentro de paquetes (containedViews)
  function collectContained(views, out) {
    (views || []).forEach((v) => {
      if (v && v.model && isClassifierModel(v.model) && !out.includes(v)) {
        out.push(v);
      }
      if (v && v.containedViews && v.containedViews.length) {
        collectContained(v.containedViews, out);
      }
    });
  }
  collectContained(diagram.ownedViews, classViews);

  if (!classViews.length) {
    return null;
  }

  const classes = classViews.map((v) => {
    const m = v.model;
    const cn = m.getClassName();
    const parentName =
      m._parent && m._parent.getClassName && m._parent.getClassName() === "UMLPackage"
        ? m._parent.name
        : null;
    return {
      name: m.name,
      kind: cn === "UMLInterface" ? "interface" : "class",
      layer: parentName,
      stereotype:
        typeof m.stereotype === "string"
          ? m.stereotype
          : m.stereotype && m.stereotype.name
            ? m.stereotype.name
            : cn === "UMLInterface"
              ? "interface"
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
      // source = clasificador, target = interfaz
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

function shouldGroupByLayers(spec) {
  if (!spec) {
    return false;
  }
  if (spec.groupByLayers === true || spec.usePackages === true) {
    return true;
  }
  const list = spec.classes || spec.addClasses || [];
  return list.some((c) => c && (c.layer || c.package));
}

function applyCreate(spec) {
  const parent = ensureParent();
  const diagram = createClassDiagram(parent, spec.diagramName || "Kimi Class Diagram");
  app.diagrams.setCurrentDiagram(diagram);

  const modelParent = diagram._parent || parent;
  const byName = {};
  const views = [];
  const packageCache = {};
  const useLayers = shouldGroupByLayers(spec);
  const cols = Math.max(2, Math.ceil(Math.sqrt(spec.classes.length)));
  const gapX = 280;
  const gapY = 220;

  // Crear paquetes en orden de capas DDD
  if (useLayers) {
    const layers = [];
    spec.classes.forEach((c) => {
      const layer = inferLayer(c);
      if (layer && !layers.includes(layer)) {
        layers.push(layer);
      }
    });
    layers
      .sort((a, b) => {
        const ia = LAYER_ORDER.indexOf(a);
        const ib = LAYER_ORDER.indexOf(b);
        return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
      })
      .forEach((layer, idx) => {
        ensurePackage(modelParent, diagram, layer, idx, packageCache);
      });
  }

  spec.classes.forEach((c, i) => {
    let x = 60 + (i % cols) * gapX;
    let y = 60 + Math.floor(i / cols) * gapY;
    let owner = modelParent;
    let containerView = null;

    if (useLayers) {
      const layer = inferLayer(c);
      if (layer) {
        const pkg = ensurePackage(
          modelParent,
          diagram,
          layer,
          Object.keys(packageCache).length,
          packageCache
        );
        owner = pkg.model;
        containerView = pkg.view;
        const ci = pkg.childCount || 0;
        const localCols = 2;
        x = (pkg.view ? pkg.view.left : 40) + 30 + (ci % localCols) * 300;
        y = (pkg.view ? pkg.view.top : 40) + 50 + Math.floor(ci / localCols) * 200;
        pkg.childCount = ci + 1;
      }
    }

    const created = createClassOnDiagram(owner, diagram, c, x, y, containerView);
    byName[c.name] = created;
    if (created.view) {
      views.push(created.view);
    }
  });

  // Con paquetes, no aplastar con grid global
  if (!useLayers) {
    layoutViews(views);
  }

  let assocCount = 0;
  let assocErrors = 0;
  (spec.associations || []).forEach((a) => {
    const from = byName[a.from];
    const to = byName[a.to];
    if (!from || !to || !from.view || !to.view) {
      return;
    }
    const edge = connect(diagram, from.view, to.view, a);
    if (edge) {
      assocCount += 1;
    } else {
      assocErrors += 1;
    }
  });

  // Con capas, layout dagre puede sacar clases de paquetes; solo redondear líneas
  if (useLayers) {
    applyRoundedLines(diagram);
  } else {
    autoLayout(diagram);
  }
  app.diagrams.repaint();
  return {
    diagram: diagram,
    mode: "create",
    added: spec.classes.length,
    updated: 0,
    removed: 0,
    assocCount: assocCount,
    assocErrors: assocErrors,
    layered: useLayers
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

  // add classes (soporta interfaces + capas)
  const packageCache = {};
  (spec.addClasses || []).forEach((c) => {
    if (!c || !c.name) {
      return;
    }
    if (findClassModelByName(modelParent, c.name)) {
      return;
    }
    const layer = inferLayer(c);
    let owner = modelParent;
    let containerView = null;
    let x;
    let y;
    if (layer) {
      const pkg = ensurePackage(
        modelParent,
        diagram,
        layer,
        Object.keys(packageCache).length,
        packageCache
      );
      owner = pkg.model;
      containerView = pkg.view;
      const ci = pkg.childCount || 0;
      x = (pkg.view ? pkg.view.left : 40) + 30 + (ci % 2) * 300;
      y = (pkg.view ? pkg.view.top : 40) + 50 + Math.floor(ci / 2) * 200;
      pkg.childCount = ci + 1;
    } else {
      const slot = nextFreeSlot(diagram);
      x = slot.x;
      y = slot.y;
    }
    createClassOnDiagram(owner, diagram, c, x, y, containerView);
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
    if (connect(diagram, fromV, toV, a)) {
      assocCount += 1;
    }
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
        const layer = inferLayer(c);
        if (layer) {
          const pkg = ensurePackage(
            modelParent,
            diagram,
            layer,
            Object.keys(packageCache).length,
            packageCache
          );
          const ci = pkg.childCount || 0;
          const x = (pkg.view ? pkg.view.left : 40) + 30 + (ci % 2) * 300;
          const y = (pkg.view ? pkg.view.top : 40) + 50 + Math.floor(ci / 2) * 200;
          pkg.childCount = ci + 1;
          createClassOnDiagram(pkg.model, diagram, c, x, y, pkg.view);
        } else {
          const slot = nextFreeSlot(diagram);
          createClassOnDiagram(modelParent, diagram, c, slot.x, slot.y);
        }
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
      if (fromV && toV && connect(diagram, fromV, toV, a)) {
        assocCount += 1;
      }
    });
  }

  const hasPackages = Object.keys(packageCache).length > 0;
  // Con paquetes, dagre saca las clases de las cajas; solo redondear
  if (hasPackages) {
    applyRoundedLines(diagram);
  } else if (added > 0 || assocCount > 0) {
    autoLayout(diagram);
  } else {
    applyRoundedLines(diagram);
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

  const hasCurrent =
    !!(app.diagrams.getCurrentDiagram() &&
      app.diagrams.getCurrentDiagram().getClassName() === "UMLClassDiagram");

  const validation = validateSpec(spec, { hasCurrentDiagram: hasCurrent });
  if (!validation.ok) {
    throw new Error(validation.error || "Spec inválido");
  }
  if (validation.kind === "chat") {
    return {
      mode: "chat",
      message: validation.message,
      diagram: null,
      added: 0,
      updated: 0,
      removed: 0,
      assocCount: 0
    };
  }

  const mode = validation.kind;
  if (mode === "patch") {
    if (String(spec.mode || "").toLowerCase() === "create" && hasCurrent && Array.isArray(spec.classes)) {
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

  return applyCreate(spec);
}

module.exports = {
  buildFromSpec,
  snapshotCurrentDiagram,
  parseFeature,
  applyRoundedLines,
  autoLayout,
  sanitizeAssocName,
  cleanNoiseAssociationNames,
  isInterfaceSpec,
  inferLayer,
  relationId
};

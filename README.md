# Kimi Diagrams (StarUML)

Extensión **aparte** del tema: chat con **Kimi (Moonshot)** para generar diagramas de clases UML en StarUML 6.3.1+.

## Instalación local

```bash
mkdir -p ~/.config/StarUML/extensions/user
ln -sfn /home/solivo/Documentos/UML/KimiStarUML ~/.config/StarUML/extensions/user/solivo.kimi-diagrams
```

Reinicia StarUML.

## Configuración

1. **Preferences → Kimi AI**
2. Pega tu **API Key** de https://platform.kimi.ai
3. Base URL: `https://api.moonshot.ai/v1` ([docs](https://platform.kimi.ai/docs/overview))
4. Modelo por defecto: **`kimi-k3`**

## Uso

1. **Tools → Kimi Diagrams → Abrir chat**
2. Escribe algo como:  
   `Crea un diagrama DDD de e-commerce: Pedido (AggregateRoot), Cliente (Entity), Producto (Entity), PedidoRepository`
3. Pulsa **Generar** (o Ctrl+Enter)
4. Kimi responde JSON → la extensión crea el diagrama en el proyecto

También: **Tools → Kimi Diagrams → Generar diagrama desde selección…**

## Convivencia con Theme Dark

- Tema: `solivo.theme-dark-staruml` (colores / perfil DDD)
- IA: `solivo.kimi-diagrams` (este proyecto)

Puedes usar ambos a la vez. Tras generar, en el tema: **Recolorear diagrama actual**.

## Estructura

```
KimiStarUML/
├── main.js
├── lib/
│   ├── kimi-client.js      # HTTP a Moonshot/Kimi
│   ├── prompt.js           # system prompt + parse JSON
│   └── diagram-builder.js  # factory StarUML
├── panel/kimi-chat-panel.html
├── preferences/kimi.json
├── menus/menu.json
└── stylesheets/kimi-chat.css
```

## Estado

MVP `0.1.0`: chat + generación de **diagrama de clases**.  
Pendiente: más tipos de diagrama, edición conversacional, layout automático mejor.

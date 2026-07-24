const https = require("https");
const http = require("http");
const { URL } = require("url");

function getConfig() {
  return {
    apiKey: (app.preferences.get("kimi.apiKey") || "").trim(),
    baseUrl: (app.preferences.get("kimi.baseUrl") || "https://api.moonshot.ai/v1").replace(/\/$/, ""),
    model: app.preferences.get("kimi.model") || "kimi-k2.5",
    temperature: Number(app.preferences.get("kimi.temperature") || 0.2)
  };
}

function requestJson(method, urlString, headers, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const lib = url.protocol === "http:" ? http : https;
    const payload = body ? JSON.stringify(body) : null;
    const req = lib.request(
      {
        method,
        hostname: url.hostname,
        port: url.port || (url.protocol === "http:" ? 80 : 443),
        path: url.pathname + url.search,
        headers: Object.assign(
          {
            "Content-Type": "application/json",
            Accept: "application/json"
          },
          headers || {},
          payload ? { "Content-Length": Buffer.byteLength(payload) } : {}
        )
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          let parsed = null;
          try {
            parsed = data ? JSON.parse(data) : null;
          } catch (err) {
            reject(new Error("Respuesta no JSON (" + res.statusCode + "): " + data.slice(0, 200)));
            return;
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const msg =
              (parsed && parsed.error && (parsed.error.message || parsed.error)) ||
              data.slice(0, 300);
            reject(new Error("HTTP " + res.statusCode + ": " + msg));
            return;
          }
          resolve(parsed);
        });
      }
    );
    req.on("error", reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

/**
 * Chat completions compatible con OpenAI / Kimi.
 * @param {Array<{role:string, content:string}>} messages
 * @returns {Promise<string>}
 */
function chat(messages) {
  const cfg = getConfig();
  if (!cfg.apiKey) {
    return Promise.reject(
      new Error("Configura kimi.apiKey en Preferences → Kimi AI")
    );
  }

  return requestJson(
    "POST",
    cfg.baseUrl + "/chat/completions",
    { Authorization: "Bearer " + cfg.apiKey },
    {
      model: cfg.model,
      temperature: cfg.temperature,
      messages: messages
    }
  ).then((res) => {
    const content =
      res &&
      res.choices &&
      res.choices[0] &&
      res.choices[0].message &&
      res.choices[0].message.content;
    if (!content) {
      throw new Error("La API no devolvió contenido");
    }
    return content;
  });
}

module.exports = {
  getConfig,
  chat
};

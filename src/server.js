import "dotenv/config";
import http from "node:http";
import { askAgent, resolveWorkdir } from "./agent-core.js";
const HOST = process.env.AGENT_SERVER_HOST || "127.0.0.1";
const PORT = Number(process.env.AGENT_SERVER_PORT || 8765);

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body)
  });
  res.end(body);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") {
      sendJson(res, 200, {
        ok: true,
        service: "mcp-openai-bridge",
        time: new Date().toISOString()
      });
      return;
    }
    if (req.method === "POST" && req.url === "/ask") {
      const rawBody = await readRequestBody(req);
      let body;
      try {
        body = JSON.parse(rawBody || "{}");
      } catch {
        sendJson(res, 400, { ok: false, error: "Invalid JSON body" });
        return;
      }
      const question = body.question;
      const requestedWorkdir = body.workdir;
      const history = Array.isArray(body.history) ? body.history : [];
      if (!question || typeof question !== "string") {
        sendJson(res, 400, { ok: false, error: "Missing string field:question" });
        return;
      }
      const resolvedWorkdir = await resolveWorkdir(requestedWorkdir);
      const logs = [];
      const logger = {
        log: (...args) => {
          const line = args
            .map((item) => typeof item === "string" ? item :JSON.stringify(item))
            .join(" ");
          logs.push(line);
          console.log(...args);
        }
      };
      const result = await askAgent({
        question,
        workdir: resolvedWorkdir,
        history,
        interactive: false,
        logger
      });
      sendJson(res, 200, {
        ok: true,
        workdir: result.workdir,
        answer: result.answer,
        steps: result.steps,
        logs
      });
      return;
    }
    sendJson(res, 404, {
      ok: false,
      error: "Not Found",
      availableEndpoints: ["GET /health", "POST /ask"]
    });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { ok: false, error: error.message || String(error) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`MCP OpenAI Bridge server running at http://${HOST}:${PORT}`);
  console.log("Available endpoints:");
  console.log(`- GET  http://${HOST}:${PORT}/health`);
  console.log(`- POST http://${HOST}:${PORT}/ask`);
});
import "dotenv/config";
import http from "node:http";
import { askAgent, resolveWorkdir } from "./agent-core.js";
import { sendJson, readJsonBody, createMemoryLogger } from "./http-utils.js";

const HOST = process.env.AGENT_SERVER_HOST || "127.0.0.1";
const PORT = Number(process.env.AGENT_SERVER_PORT || 8765);

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
      let body;

      try {
        body = await readJsonBody(req);
      } catch (error) {
        sendJson(res, error.statusCode || 400, {
          ok: false,
          error: error.message || "Invalid request body",
        });
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
      const { logs, logger } = createMemoryLogger(console);
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
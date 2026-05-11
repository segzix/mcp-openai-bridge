const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

export function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data, null, 2);

  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

export function readRequestBody(req, options = {}) {
  const maxBytes = options.maxBytes || DEFAULT_MAX_BODY_BYTES;

  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;

      if (Buffer.byteLength(body) > maxBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });

    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

export async function readJsonBody(req) {
  const rawBody = await readRequestBody(req);

  try {
    return JSON.parse(rawBody || "{}");
  } catch {
    const error = new Error("Invalid JSON body");
    error.statusCode = 400;
    throw error;
  }
}

export function createMemoryLogger(baseLogger = console) {
  const logs = [];

  return {
    logs,
    logger: {
      log: (...args) => {
        const line = args
          .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
          .join(" ");

        logs.push(line);
        baseLogger.log(...args);
      },
    },
  };
}

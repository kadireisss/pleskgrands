import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);
const startedAt = Date.now();
const isProd = process.env.NODE_ENV === "production";

// Prevent hung connections: close idle sockets so ERR_CONNECTION_TIMED_OUT is less likely
httpServer.keepAliveTimeout = 65000;
httpServer.headersTimeout = 66000;
httpServer.requestTimeout = parseInt(process.env.REQUEST_TIMEOUT_MS || "60000", 10);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "true" || isProd) {
  app.set("trust proxy", 1);
}

app.use(
  express.json({
    limit: process.env.JSON_LIMIT || "1mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      const shouldIncludePayload =
        !isProd || process.env.LOG_API_PAYLOADS === "true" || res.statusCode >= 400;
      if (capturedJsonResponse && shouldIncludePayload) {
        const serialized = JSON.stringify(capturedJsonResponse);
        const maxLen = parseInt(process.env.API_LOG_MAX_CHARS || "400", 10);
        logLine += ` :: ${serialized.slice(0, maxLen)}`;
        if (serialized.length > maxLen) {
          logLine += "...(truncated)";
        }
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  app.get("/healthz", (_req, res) => {
    const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
    res.status(200).json({ status: "ok", uptimeSec });
  });

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();

function shutdown(signal: string) {
  log(`received ${signal}, shutting down`, "server");
  const timeout = setTimeout(() => {
    log("forced shutdown timeout reached", "server");
    process.exit(1);
  }, 15000);

  httpServer.close(() => {
    clearTimeout(timeout);
    log("shutdown complete", "server");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("uncaughtException", (err) => {
  console.error("[fatal] uncaughtException", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[fatal] unhandledRejection", reason);
});

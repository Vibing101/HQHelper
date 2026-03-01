import "dotenv/config";
import express from "express";
import cors from "cors";
import { createServer as createHttpServer } from "http";
import { createServer as createHttpsServer } from "https";
import { readFileSync } from "fs";
import path from "path";
import { Server } from "socket.io";
import { connectDb } from "./db";
import campaignRoutes from "./routes/campaigns";
import sessionRoutes from "./routes/sessions";
import heroRoutes from "./routes/heroes";
import { registerSocketHandlers } from "./socket/handlers";

const PORT = Number(process.env.PORT ?? 4000);
const MONGODB_URI = process.env.MONGODB_URI ?? "mongodb://localhost:27017/heroquest";
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:5173";

const app = express();

const TLS_CERT = process.env.TLS_CERT_PATH;
const TLS_KEY  = process.env.TLS_KEY_PATH;
const httpServer =
  TLS_CERT && TLS_KEY
    ? createHttpsServer({ cert: readFileSync(TLS_CERT), key: readFileSync(TLS_KEY) }, app)
    : createHttpServer(app);

const io = new Server(httpServer, {
  cors: { origin: CLIENT_URL, methods: ["GET", "POST"] },
});

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors({ origin: CLIENT_URL }));
app.use(express.json());

// ─── REST Routes ──────────────────────────────────────────────────────────────

app.use("/api/campaigns", campaignRoutes);
app.use("/api", sessionRoutes);
app.use("/api/heroes", heroRoutes);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ─── Static Client ────────────────────────────────────────────────────────────

const CLIENT_DIST = path.resolve(__dirname, "../../client/dist");
app.use(express.static(CLIENT_DIST));
app.get("*", (_req, res) => res.sendFile(path.join(CLIENT_DIST, "index.html")));

// ─── Socket.io ────────────────────────────────────────────────────────────────

io.on("connection", (socket) => {
  console.log(`[socket] Connected: ${socket.id}`);

  // Client sends join event: { campaignId, sessionId?, role, playerId? }
  socket.on("join", (data: { campaignId: string; sessionId?: string; role: "gm" | "player"; playerId?: string }) => {
    socket.data = { ...data };
    socket.join(`campaign:${data.campaignId}`);
    if (data.sessionId) {
      socket.join(`session:${data.sessionId}`);
    }
    console.log(`[socket] ${socket.id} joined campaign:${data.campaignId} as ${data.role}`);
    socket.emit("joined", { ok: true });
  });

  registerSocketHandlers(io, socket);

  socket.on("disconnect", () => {
    console.log(`[socket] Disconnected: ${socket.id}`);
  });
});

// ─── Boot ─────────────────────────────────────────────────────────────────────

connectDb(MONGODB_URI)
  .then(() => {
    httpServer.listen(PORT, () => {
      console.log(`[server] Listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("[server] Failed to connect to MongoDB:", err);
    process.exit(1);
  });

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
import { verifyToken } from "./auth";

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

app.set("io", io);

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

// ─── Socket.io Auth Middleware ────────────────────────────────────────────────
//
// Every socket connection must present a valid JWT in socket.handshake.auth.token.
// On success, verified claims are written into socket.data so downstream handlers
// can trust them.  Clients may NOT override socket.data via the "join" event.

io.use((socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) {
    return next(new Error("Unauthorized: no token provided"));
  }
  try {
    const payload = verifyToken(token);
    // Write each claim individually — never spread the whole payload so that
    // JWT-internal fields (iat/exp) don't end up on socket.data.
    socket.data.campaignId = payload.campaignId;
    socket.data.role       = payload.role;
    socket.data.playerId   = payload.playerId;
    socket.data.heroId     = payload.heroId;
    next();
  } catch {
    next(new Error("Unauthorized: invalid or expired token"));
  }
});

// ─── Socket.io Connection ─────────────────────────────────────────────────────

io.on("connection", (socket) => {
  console.log(`[socket] Connected: ${socket.id}`);

  // Client sends join event: { sessionId? }
  // Identity (campaignId, role, playerId, heroId) comes exclusively from the
  // verified JWT populated above — never from client-supplied join data.
  socket.on("join", (data: { sessionId?: string; [key: string]: unknown }) => {
    socket.join(`campaign:${socket.data.campaignId}`);
    if (data.sessionId) {
      socket.join(`session:${data.sessionId}`);
      socket.data.sessionId = data.sessionId;
    }
    console.log(
      `[socket] ${socket.id} joined campaign:${socket.data.campaignId} as ${socket.data.role}`
    );
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

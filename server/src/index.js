  import "dotenv/config";
import express from "express";
import http from "node:http";
import cors from "cors";
import helmet from "helmet";
import { Server } from "socket.io";
import crypto from "node:crypto";

const app = express();
const server = http.createServer(app);
const PORT = Number(process.env.PORT || 5000);
const allowedOrigins = (process.env.CLIENT_ORIGIN || "http://localhost:5173")
  .split(",").map(s => s.trim()).filter(Boolean);

app.use(helmet({ crossOriginEmbedderPolicy: false }));
app.use(cors({ origin: allowedOrigins, methods: ["GET", "POST"] }));
app.use(express.json({ limit: "20kb" }));

const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ["GET", "POST"] },
  maxHttpBufferSize: 8e6
});

// In-memory rooms are intentionally ephemeral. A server restart invalidates all pairings.
const rooms = new Map(); // code -> { ownerId, phoneId, approved, createdAt }
const ROOM_TTL_MS = 30 * 60 * 1000;

function makeCode() {
  let code;
  do { code = String(crypto.randomInt(100000, 1000000)); } while (rooms.has(code));
  return code;
}
function cleanupRooms() {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.createdAt > ROOM_TTL_MS || (!io.sockets.sockets.has(room.ownerId))) {
      if (room.phoneId) io.to(room.phoneId).emit("session:ended", { reason: "Room expired or dashboard disconnected." });
      rooms.delete(code);
    }
  }
}
setInterval(cleanupRooms, 60_000).unref();

app.get("/health", (_req, res) => res.json({ ok: true, service: "phone-camera-control", rooms: rooms.size }));
app.get("/", (_req, res) => res.json({ name: "Phone Camera Control Center signaling server", status: "ok" }));

io.on("connection", socket => {
  socket.on("room:create", (_payload, callback) => {
    cleanupRooms();
    const code = makeCode();
    rooms.set(code, { ownerId: socket.id, phoneId: null, approved: false, createdAt: Date.now() });
    socket.data.roomCode = code;
    socket.data.role = "owner";
    callback?.({ ok: true, code, expiresInMinutes: 30 });
  });

  socket.on("room:join", ({ code }, callback) => {
    const normalized = String(code || "").replace(/\D/g, "").slice(0, 6);
    const room = rooms.get(normalized);
    if (!room || Date.now() - room.createdAt > ROOM_TTL_MS) {
      callback?.({ ok: false, error: "Pairing code is invalid or expired. Generate a new code on the dashboard." });
      return;
    }
    if (room.phoneId && room.phoneId !== socket.id) {
      callback?.({ ok: false, error: "A phone is already connected or awaiting approval." });
      return;
    }
    room.phoneId = socket.id;
    room.approved = false;
    socket.data.roomCode = normalized;
    socket.data.role = "phone";
    io.to(room.ownerId).emit("phone:request", { deviceLabel: "Android phone", requestedAt: Date.now() });
    callback?.({ ok: true, waitingForApproval: true });
  });

  socket.on("phone:approve", callback => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room || room.ownerId !== socket.id || !room.phoneId) {
      callback?.({ ok: false, error: "No phone is waiting to pair." });
      return;
    }
    room.approved = true;
    io.to(room.phoneId).emit("pair:approved");
    io.to(room.ownerId).emit("pair:connected");
    if (typeof callback === "function") {
      callback({ ok: true });
    }
  });

  socket.on("phone:reject", callback => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.ownerId !== socket.id) return callback?.({ ok: false });
    if (room.phoneId) {
      io.to(room.phoneId).emit("pair:rejected");
      const phoneSocket = io.sockets.sockets.get(room.phoneId);
      if (phoneSocket) { phoneSocket.data.roomCode = null; phoneSocket.data.role = null; }
    }
    room.phoneId = null;
    room.approved = false;
    callback?.({ ok: true });
  });

  // WebRTC signaling is relayed only between the owner and the approved phone.
  for (const event of ["webrtc:offer", "webrtc:answer", "webrtc:ice", "camera:command", "camera:status", "camera:photo", "recording:status"]) {
    socket.on(event, payload => {
      const room = rooms.get(socket.data.roomCode);
      if (!room || !room.approved) return;
      const target = socket.data.role === "owner" ? room.phoneId : room.ownerId;
      if (!target) return;
      io.to(target).emit(event, payload);
    });
  }

  socket.on("room:leave", () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    if (room.ownerId === socket.id) {
      if (room.phoneId) io.to(room.phoneId).emit("session:ended", { reason: "Dashboard ended the session." });
      rooms.delete(code);
    } else if (room.phoneId === socket.id) {
      room.phoneId = null;
      room.approved = false;
      io.to(room.ownerId).emit("phone:disconnected");
    }
    socket.data.roomCode = null;
  });

  socket.on("disconnect", () => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) return;
    if (room.ownerId === socket.id) {
      if (room.phoneId) io.to(room.phoneId).emit("session:ended", { reason: "Dashboard disconnected." });
      rooms.delete(code);
    } else if (room.phoneId === socket.id) {
      room.phoneId = null;
      room.approved = false;
      io.to(room.ownerId).emit("phone:disconnected");
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Signaling server listening on port ${PORT}`);
});
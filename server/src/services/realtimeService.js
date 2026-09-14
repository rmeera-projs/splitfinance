const jwt = require("jsonwebtoken");
const prisma = require("../config/prisma");

// Set once by initRealtime() when the app actually boots a real HTTP server
// (see index.js). Deliberately stays null under Jest/Supertest, which
// exercises the Express app directly and never calls initRealtime - so
// emitGroupActivity below is a safe no-op in every test.
let io = null;

// Wires up Socket.IO on top of the app's HTTP server. One room per group
// ("group:<id>"); a socket only joins a room after we've checked the
// connecting user is actually a member of that group, same rule the REST
// API enforces.
function initRealtime(httpServer) {
  const { Server } = require("socket.io");
  io = new Server(httpServer, {
    cors: { origin: process.env.CLIENT_URL || "*" },
  });

  // Auth middleware runs during the handshake, before the client ever sees
  // a "connect" event - a bad/missing token rejects the connection outright
  // (client gets "connect_error") instead of connecting and then racing a
  // forced disconnect.
  // Same tokenVersion check as requireAuth (middleware/auth.js) - without
  // it, a token invalidated by a password change/reset would still open a
  // live WebSocket connection and keep receiving group activity, even
  // though the same stale token is correctly rejected by the REST API.
  io.use(async (socket, next) => {
    try {
      const payload = jwt.verify(socket.handshake.auth?.token, process.env.JWT_SECRET);

      const user = await prisma.user.findUnique({ where: { id: payload.userId }, select: { tokenVersion: true } });
      if (!user || user.tokenVersion !== payload.tokenVersion) {
        return next(new Error("unauthorized"));
      }

      socket.userId = payload.userId;
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("join-group", async (groupId) => {
      const membership = await prisma.groupMember.findUnique({
        where: { groupId_userId: { groupId: Number(groupId), userId: socket.userId } },
      });
      if (membership) socket.join(`group:${groupId}`);
    });

    socket.on("leave-group", (groupId) => {
      socket.leave(`group:${groupId}`);
    });
  });

  return io;
}

// Notifies everyone currently viewing this group that something changed.
// This is a lightweight "something happened, you may want to refresh"
// signal, not the changed data itself - clients still refetch over the
// normal REST API, so there's one source of truth for what's current.
function emitGroupActivity(groupId, { type, actorId }) {
  if (!io) return;
  io.to(`group:${groupId}`).emit("group-activity", { groupId: Number(groupId), type, actorId });
}

module.exports = { initRealtime, emitGroupActivity };

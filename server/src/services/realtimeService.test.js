process.env.JWT_SECRET = "test-secret";

const http = require("http");
const jwt = require("jsonwebtoken");
const { io: ioClient } = require("socket.io-client");

jest.mock("../config/prisma", () => ({
  groupMember: { findUnique: jest.fn() },
}));

function tokenFor(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET);
}

// emitGroupActivity must never throw just because initRealtime hasn't run
// yet - that's exactly the state every Jest/Supertest test runs in, since
// they exercise the Express app directly and never boot a real HTTP server.
test("emitGroupActivity is a no-op when realtime was never initialized", () => {
  jest.isolateModules(() => {
    const { emitGroupActivity } = require("./realtimeService");
    expect(() => emitGroupActivity(1, { type: "expense-added", actorId: 1 })).not.toThrow();
  });
});

describe("realtime socket server", () => {
  let httpServer;
  let io;
  let port;
  let prisma;
  let emitGroupActivity;
  let sockets = [];

  beforeEach((done) => {
    // isolateModules gives this test its own module registry for the
    // duration of this callback - requiring the mocked prisma module and
    // realtimeService (which requires prisma internally) together here
    // means they resolve to the *same* mock instance, so mockResolvedValue
    // calls below actually affect what the socket server sees.
    jest.isolateModules(() => {
      prisma = require("../config/prisma");
      const realtimeService = require("./realtimeService");
      httpServer = http.createServer();
      io = realtimeService.initRealtime(httpServer);
      emitGroupActivity = realtimeService.emitGroupActivity;
    });
    httpServer.listen(0, () => {
      port = httpServer.address().port;
      done();
    });
  });

  afterEach((done) => {
    sockets.forEach((s) => s.close());
    sockets = [];
    io.close();
    httpServer.close(done);
  });

  function connect(token) {
    const socket = ioClient(`http://localhost:${port}`, {
      auth: { token },
      reconnection: false,
      forceNew: true,
      transports: ["websocket"],
    });
    sockets.push(socket);
    return socket;
  }

  test("rejects a connection with an invalid token", (done) => {
    const socket = connect("not-a-real-token");
    socket.on("connect_error", () => done());
    socket.on("connect", () => done(new Error("should not have connected")));
  });

  test("lets a member join their group's room and receive activity", (done) => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: 1 });
    const socket = connect(tokenFor(1));

    socket.on("connect", () => {
      socket.emit("join-group", 10);
      // Give the async membership check a tick to resolve and actually join
      // the room before triggering the broadcast.
      setTimeout(() => {
        emitGroupActivity(10, { type: "expense-added", actorId: 2 });
      }, 50);
    });

    socket.on("group-activity", (payload) => {
      expect(payload).toEqual({ groupId: 10, type: "expense-added", actorId: 2 });
      done();
    });
  });

  test("never joins the room if the user isn't a member of the group", (done) => {
    prisma.groupMember.findUnique.mockResolvedValue(null);
    const socket = connect(tokenFor(1));

    socket.on("connect", () => {
      socket.emit("join-group", 10);
      setTimeout(() => {
        emitGroupActivity(10, { type: "expense-added", actorId: 2 });
        // No "group-activity" should ever arrive - give it a moment, then pass.
        setTimeout(done, 100);
      }, 50);
    });

    socket.on("group-activity", () => {
      done(new Error("should not have received activity for a group it never joined"));
    });
  });

  test("leave-group stops further activity from reaching the socket", (done) => {
    prisma.groupMember.findUnique.mockResolvedValue({ groupId: 10, userId: 1 });
    const socket = connect(tokenFor(1));

    socket.on("connect", () => {
      socket.emit("join-group", 10);
      setTimeout(() => {
        socket.emit("leave-group", 10);
        setTimeout(() => {
          emitGroupActivity(10, { type: "expense-added", actorId: 2 });
          setTimeout(done, 100);
        }, 50);
      }, 50);
    });

    socket.on("group-activity", () => {
      done(new Error("should not have received activity after leaving the room"));
    });
  });
});

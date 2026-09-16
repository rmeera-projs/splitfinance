import { io } from "socket.io-client";

// Socket.IO mounts on the server's root (e.g. http://host:5000), not under
// /api like the REST client - strip that suffix off VITE_API_URL to get the
// right origin to connect to.
const SOCKET_URL = (import.meta.env.VITE_API_URL || "http://localhost:5000/api").replace(/\/api\/?$/, "");

let socket = null;

// One shared, lazily-created socket for the whole app. autoConnect is off -
// callers (GroupPage) connect/disconnect it around the time they actually
// need it, rather than holding an open connection on every page.
export function getSocket() {
  if (!socket) {
    // withCredentials makes the browser send the HttpOnly session cookie on
    // the handshake request, which is where the server authenticates the
    // connection (see realtimeService's io.use). This used to pass the token
    // explicitly via socket.auth, read out of localStorage - impossible now,
    // and unnecessary, since the browser attaches the cookie itself.
    socket = io(SOCKET_URL, { autoConnect: false, withCredentials: true });
  }
  return socket;
}

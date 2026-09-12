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
    socket = io(SOCKET_URL, { autoConnect: false });
  }
  // The auth token can change (login/logout) between uses of the shared
  // socket, so refresh it on every access rather than only at creation.
  socket.auth = { token: localStorage.getItem("token") };
  return socket;
}

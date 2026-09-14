import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000/api",
});

// Attach the JWT to every request once the user is logged in.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// A 401 on a request that *carried* a token means the token itself is no
// longer valid (expired, or invalidated by a password change/reset - see
// requireAuth's tokenVersion check) - not the same as a login/signup
// attempt failing with bad credentials, which is also a 401 but on a
// request with no token to begin with, and should be handled by whichever
// form triggered it instead. Without this, a stale token just makes every
// authenticated request silently fail and pages render as if the user had
// no data (empty groups list, etc.) instead of clearly signing them out.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const hadToken = Boolean(error.config?.headers?.Authorization);
    if (error.response?.status === 401 && hadToken) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      if (window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

export default api;

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:4000";

// A hung request (dropped connection, server not responding) used to leave
// the UI stuck forever — "Saving…" with no way out short of a manual
// refresh, which is exactly the "tool gets stuck" complaint. Every request
// now gives up after REQUEST_TIMEOUT_MS with a clear, catchable error
// instead of hanging indefinitely.
const REQUEST_TIMEOUT_MS = 20000;

// sessionStorage (not localStorage): keeps a session alive for
// refreshes/navigation within the same tab but not beyond it, so a brand
// new tab — e.g. someone clicking a shared deploy link — never silently
// resumes whatever account was last logged in on that browser and always
// hits /login first. See the matching comment in authStore.ts.
function getAccessToken(): string | null {
  return sessionStorage.getItem("annotiq_access_token");
}

function getRefreshToken(): string | null {
  return sessionStorage.getItem("annotiq_refresh_token");
}

function clearStoredAuth() {
  sessionStorage.removeItem("annotiq_access_token");
  sessionStorage.removeItem("annotiq_refresh_token");
  sessionStorage.removeItem("annotiq_user");
}

// The access token is short-lived (15m — see backend/src/lib/jwt.ts) so it
// WILL expire mid-session for anyone who keeps a task open longer than
// that. Previously nothing ever exchanged the refresh token for a new one,
// so the very next save after expiry just failed outright with "Invalid or
// expired token" and stayed that way until a manual page reload. At most
// one refresh is ever in flight at a time — every request that hits a 401
// while one is already running just waits on the same promise instead of
// firing its own duplicate /auth/refresh call.
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { accessToken: string };
    sessionStorage.setItem("annotiq_access_token", data.accessToken);
    return data.accessToken;
  } catch {
    return null;
  }
}

function getRefreshedTokenOnce(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

// Fired when the refresh token itself is no longer valid (expired / never
// existed) — i.e. the person is genuinely signed out, not just holding a
// stale access token. App.tsx listens for this and calls authStore's
// logout(), which is the one place session state actually changes; this
// module intentionally doesn't import the auth store directly to avoid a
// circular dependency (authStore -> api client -> authStore).
const SESSION_EXPIRED_EVENT = "annotiq:session-expired";
function notifySessionExpired() {
  clearStoredAuth();
  window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
}

async function fetchWithTimeout(url: string, options: RequestInit): Promise<Response> {
  // A caller doing a best-effort save on page unload (keepalive: true)
  // passes its own short-lived signal setup instead — AbortController
  // timers don't reliably fire once the page has started unloading anyway,
  // and the keepalive fetch is meant to be fire-and-forget.
  if (options.keepalive) {
    return fetch(url, options);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error("Request timed out. Check your connection and try again.");
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function request<T>(path: string, options: RequestInit = {}, retried = false): Promise<T> {
  const token = getAccessToken();
  const res = await fetchWithTimeout(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (res.status === 401 && !retried) {
    const newToken = await getRefreshedTokenOnce();
    if (newToken) {
      return request<T>(path, options, true);
    }
    notifySessionExpired();
    throw new Error("Your session has expired. Please sign in again.");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }

  // 204 No Content etc.
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  // `opts` lets a caller pass extra RequestInit fields through — in
  // practice just { keepalive: true }, used by the annotation workspace's
  // best-effort flush-on-unload save so the browser keeps the request
  // alive for a moment after the page starts navigating away/refreshing.
  patch: <T>(path: string, body?: unknown, opts?: RequestInit) =>
    request<T>(path, { method: "PATCH", body: body ? JSON.stringify(body) : undefined, ...opts }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),

  // Multipart upload (e.g. admin posting a new job with a document file).
  // No Content-Type header here — the browser sets it (with the multipart
  // boundary) automatically when the body is a FormData instance.
  postForm: async <T>(path: string, form: FormData, retried = false): Promise<T> => {
    const token = getAccessToken();
    const res = await fetchWithTimeout(`${API_BASE}${path}`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    if (res.status === 401 && !retried) {
      const newToken = await getRefreshedTokenOnce();
      if (newToken) {
        return api.postForm<T>(path, form, true);
      }
      notifySessionExpired();
      throw new Error("Your session has expired. Please sign in again.");
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `Request failed: ${res.status}`);
    }
    return res.json() as Promise<T>;
  },
};

export { SESSION_EXPIRED_EVENT };

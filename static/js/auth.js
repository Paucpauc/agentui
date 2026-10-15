// Authentication Status & Fetch 401 Interceptor

import { dom } from "./dom.js";

export async function checkAuthStatus() {
  try {
    const res = await fetch("/api/auth/status");
    if (res.status === 401) {
      window.location.href = "/login";
      return;
    }
    const data = await res.json();
    if (data.auth_enabled && data.user) {
      const userInfo = dom.userInfo;
      const userName = dom.userName;
      const btnLogout = dom.btnLogout;
      if (userInfo && userName) {
        userName.textContent = data.user;
        userInfo.style.display = "inline-flex";
      }
      if (btnLogout) {
        btnLogout.style.display = "inline-block";
        btnLogout.onclick = async () => {
          try {
            await fetch("/api/logout", { method: "POST" });
          } catch (e) {}
          window.location.href = "/login";
        };
      }
    }
  } catch (err) {
    console.warn("Auth status check failed:", err);
  }
}

export function setupFetchInterceptor() {
  const originalFetch = window.fetch;
  window.fetch = async function(...args) {
    const res = await originalFetch.apply(this, args);
    if (res.status === 401) {
      const url = typeof args[0] === "string" ? args[0] : (args[0] && args[0].url ? args[0].url : "");
      if (!url.includes("/api/login") && !url.includes("/api/auth/status")) {
        window.location.href = "/login";
      }
    }
    return res;
  };
}

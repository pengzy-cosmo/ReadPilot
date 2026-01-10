const DEFAULT_API_URL = "http://localhost:8000";

export function getApiBaseUrl(): string {
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl && typeof envUrl === "string" && envUrl.trim()) {
    return envUrl.trim();
  }

  if (typeof window === "undefined") {
    return DEFAULT_API_URL;
  }

  const protocol = window.location.protocol || "http:";
  const host = window.location.hostname || "localhost";
  return `${protocol}//${host}:8000`;
}

export type ApiConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

const STORAGE_KEY = "pdf-reader-api-config";

export function loadApiConfig(): ApiConfig {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return JSON.parse(saved) as ApiConfig;
    }
  } catch {
    // ignore
  }
  return {
    apiKey: "",
    baseUrl: "",
    model: "gpt-5.2",
  };
}

export function saveApiConfig(config: ApiConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

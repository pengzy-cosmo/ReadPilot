export type ApiConfig = {
	apiKey: string;
	baseUrl: string;
	model: string;
};

const STORAGE_KEY = "pdf-reader-api-config";

export function loadApiConfig(): ApiConfig {
	// Persist API settings locally to avoid re-entry on reload.
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
	// Store user-provided API settings for future sessions.
	localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

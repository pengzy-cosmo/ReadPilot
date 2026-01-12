/** apiConfig - Types and persistence for LLM API configuration with multi-provider support. */

export type LLMProvider = "openai" | "anthropic" | "gemini";

export type ApiConfig = {
	provider: LLMProvider;
	apiKeys: {
		openai: string;
		anthropic: string;
		gemini: string;
	};
	baseUrl: string; // Only for OpenAI compatible
	model: string;
};

/** Default models for each provider. */
export const DEFAULT_MODELS: Record<LLMProvider, string> = {
	openai: "gpt-5.2",
	anthropic: "claude-sonnet-4-5",
	gemini: "gemini-3-pro-preview",
};

/** Human-readable labels for providers. */
export const PROVIDER_LABELS: Record<LLMProvider, string> = {
	openai: "OpenAI Compatible",
	anthropic: "Anthropic",
	gemini: "Google Gemini",
};

const STORAGE_KEY = "pdf-reader-api-config";

export function loadApiConfig(): ApiConfig {
	// Persist API settings locally to avoid re-entry on reload.
	try {
		const saved = localStorage.getItem(STORAGE_KEY);
		if (saved) {
			const parsed = JSON.parse(saved) as Partial<ApiConfig>;
			// Migrate from old single apiKey format if needed
			if ("apiKey" in parsed && typeof parsed.apiKey === "string") {
				const oldConfig = parsed as unknown as { apiKey: string; baseUrl: string; model: string };
				return {
					provider: "openai",
					apiKeys: {
						openai: oldConfig.apiKey,
						anthropic: "",
						gemini: "",
					},
					baseUrl: oldConfig.baseUrl || "",
					model: oldConfig.model || DEFAULT_MODELS.openai,
				};
			}
			// Return saved config with defaults for missing fields
			return {
				provider: parsed.provider || "openai",
				apiKeys: {
					openai: parsed.apiKeys?.openai || "",
					anthropic: parsed.apiKeys?.anthropic || "",
					gemini: parsed.apiKeys?.gemini || "",
				},
				baseUrl: parsed.baseUrl || "",
				model: parsed.model || DEFAULT_MODELS[parsed.provider || "openai"],
			};
		}
	} catch {
		// ignore
	}
	return {
		provider: "openai",
		apiKeys: {
			openai: "",
			anthropic: "",
			gemini: "",
		},
		baseUrl: "",
		model: DEFAULT_MODELS.openai,
	};
}

export function saveApiConfig(config: ApiConfig): void {
	// Store user-provided API settings for future sessions.
	localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

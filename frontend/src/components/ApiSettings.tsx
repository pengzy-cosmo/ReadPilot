/** ApiSettings - Modal for configuring LLM provider, API keys, and model. */
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { type ApiConfig, DEFAULT_MODELS, type LLMProvider, PROVIDER_LABELS, saveApiConfig } from "@/lib/apiConfig";

interface ApiSettingsProps {
	isOpen: boolean;
	onClose: () => void;
	config: ApiConfig;
	onSave: (config: ApiConfig) => void;
}

const PROVIDERS: LLMProvider[] = ["openai", "anthropic", "gemini"];

export function ApiSettings({ isOpen, onClose, config, onSave }: ApiSettingsProps) {
	const [localConfig, setLocalConfig] = useState(config);

	useEffect(() => {
		setLocalConfig(config);
	}, [config]);

	if (!isOpen) return null;

	const handleSave = () => {
		onSave(localConfig);
		saveApiConfig(localConfig);
		onClose();
	};

	const handleProviderChange = (provider: LLMProvider) => {
		setLocalConfig({
			...localConfig,
			provider,
			model: DEFAULT_MODELS[provider],
		});
	};

	const handleApiKeyChange = (value: string) => {
		setLocalConfig({
			...localConfig,
			apiKeys: {
				...localConfig.apiKeys,
				[localConfig.provider]: value,
			},
		});
	};

	const currentApiKey = localConfig.apiKeys[localConfig.provider];

	const providerId = "provider-select";
	const apiKeyId = "api-key";
	const baseUrlId = "api-base-url";
	const modelId = "api-model";

	return (
		<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
			<Card className="w-full max-w-md">
				<CardHeader>
					<CardTitle>API Settings</CardTitle>
				</CardHeader>
				<CardContent className="space-y-4">
					<div>
						<label htmlFor={providerId} className="text-sm font-medium">
							Provider
						</label>
						<select
							id={providerId}
							value={localConfig.provider}
							onChange={(e) => handleProviderChange(e.target.value as LLMProvider)}
							className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
						>
							{PROVIDERS.map((p) => (
								<option key={p} value={p}>
									{PROVIDER_LABELS[p]}
								</option>
							))}
						</select>
					</div>

					<div>
						<label htmlFor={apiKeyId} className="text-sm font-medium">
							API Key ({PROVIDER_LABELS[localConfig.provider]})
						</label>
						<Input
							id={apiKeyId}
							type="password"
							value={currentApiKey}
							onChange={(e) => handleApiKeyChange(e.target.value)}
							placeholder={localConfig.provider === "openai" ? "sk-…" : "…"}
						/>
						<p className="text-xs text-muted-foreground mt-1">Stored locally in browser</p>
					</div>

					{localConfig.provider === "openai" && (
						<div>
							<label htmlFor={baseUrlId} className="text-sm font-medium">
								Base URL (optional)
							</label>
							<Input
								id={baseUrlId}
								type="url"
								value={localConfig.baseUrl}
								onChange={(e) => setLocalConfig({ ...localConfig, baseUrl: e.target.value })}
								placeholder="https://api.openai.com/v1"
							/>
							<p className="text-xs text-muted-foreground mt-1">Leave empty to use default, or use custom endpoint</p>
						</div>
					)}

					<div>
						<label htmlFor={modelId} className="text-sm font-medium">
							Model
						</label>
						<Input
							id={modelId}
							type="text"
							value={localConfig.model}
							onChange={(e) => setLocalConfig({ ...localConfig, model: e.target.value })}
							placeholder={DEFAULT_MODELS[localConfig.provider]}
						/>
					</div>

					<div className="flex justify-end gap-2 pt-4">
						<Button variant="outline" onClick={onClose}>
							Cancel
						</Button>
						<Button onClick={handleSave}>Save</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { saveApiConfig, type ApiConfig } from "@/lib/apiConfig";

interface ApiSettingsProps {
  isOpen: boolean;
  onClose: () => void;
  config: ApiConfig;
  onSave: (config: ApiConfig) => void;
}

export function ApiSettings({
  isOpen,
  onClose,
  config,
  onSave,
}: ApiSettingsProps) {
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

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>API Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="text-sm font-medium">API Key</label>
            <Input
              type="password"
              value={localConfig.apiKey}
              onChange={(e) =>
                setLocalConfig({ ...localConfig, apiKey: e.target.value })
              }
              placeholder="sk-..."
            />
            <p className="text-xs text-muted-foreground mt-1">
              Stored locally in browser
            </p>
          </div>

          <div>
            <label className="text-sm font-medium">Base URL (optional)</label>
            <Input
              type="url"
              value={localConfig.baseUrl}
              onChange={(e) =>
                setLocalConfig({ ...localConfig, baseUrl: e.target.value })
              }
              placeholder="https://api.openai.com/v1"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Leave empty to use default, or use custom endpoint
            </p>
          </div>

          <div>
            <label className="text-sm font-medium">Model</label>
            <Input
              type="text"
              value={localConfig.model}
              onChange={(e) =>
                setLocalConfig({ ...localConfig, model: e.target.value })
              }
              placeholder="gpt-5.2"
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

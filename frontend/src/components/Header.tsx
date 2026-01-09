import { BookOpen, Loader2, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";

interface HeaderProps {
  isUploading: boolean;
  onOpenLibrary: () => void;
  onOpenSettings: () => void;
}

export function Header({
  isUploading,
  onOpenLibrary,
  onOpenSettings,
}: HeaderProps) {
  return (
    <header className="h-14 border-b border-border/40 bg-background/60 backdrop-blur-xl flex items-center justify-between px-4 fixed top-0 w-full z-50 transition-all">
      <div className="flex items-center gap-2">
        <div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
          <BookOpen className="size-4" />
        </div>
        <h1 className="font-semibold text-lg tracking-tight">ReadPilot</h1>
      </div>

      <div className="flex items-center gap-2">
        {isUploading && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-muted text-xs font-medium text-muted-foreground animate-in fade-in zoom-in-95">
            <Loader2 className="size-3 animate-spin" />
            <span>Uploading...</span>
          </div>
        )}

        <div className="h-6 w-px bg-border/60 mx-1" />

        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenLibrary}
          className="text-muted-foreground hover:text-foreground"
        >
          <BookOpen className="size-4 mr-2" />
          Library
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSettings}
          className="text-muted-foreground hover:text-foreground"
        >
          <Settings className="size-4" />
          <span className="sr-only">Settings</span>
        </Button>
      </div>
    </header>
  );
}

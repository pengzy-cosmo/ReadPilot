import { useCallback, useRef, useState } from "react";
import { FileUp, Loader2, Upload } from "lucide-react";

import { cn } from "@/lib/utils";

interface UploadZoneProps {
  onFileSelect: (file: File) => void;
  isUploading?: boolean;
}

export function UploadZone({ onFileSelect, isUploading }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setIsDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file && file.type === "application/pdf") {
        onFileSelect(file);
      }
    },
    [onFileSelect]
  );

  const handleFileInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        onFileSelect(file);
      }
      event.target.value = "";
    },
    [onFileSelect]
  );

  const handleClick = useCallback(() => {
    if (isUploading) return;
    inputRef.current?.click();
  }, [isUploading]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-4">
      <div
        className={cn(
          "relative group w-full max-w-lg aspect-video rounded-3xl border-2 border-dashed transition-all duration-300 ease-out flex flex-col items-center justify-center p-8 text-center",
          isUploading ? "cursor-not-allowed" : "cursor-pointer",
          isDragging
            ? "border-primary bg-primary/5 scale-[1.02]"
            : "border-border hover:border-primary/50 hover:bg-muted/30"
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleClick}
      >
        <div className="absolute inset-0 bg-gradient-to-tr from-primary/5 via-transparent to-primary/5 rounded-3xl opacity-0 group-hover:opacity-100 transition-opacity" />

        <div className="relative z-10 flex flex-col items-center gap-4">
          <div className="p-4 rounded-2xl bg-background shadow-lg shadow-primary/5 group-hover:scale-110 transition-transform duration-300 border border-border/50">
            {isUploading ? (
              <Loader2 className="size-8 text-primary animate-spin" />
            ) : isDragging ? (
              <FileUp className="size-8 text-primary animate-bounce" />
            ) : (
              <Upload className="size-8 text-muted-foreground group-hover:text-primary transition-colors" />
            )}
          </div>

          <div className="space-y-1">
            <h3 className="text-xl font-medium tracking-tight">
              {isUploading ? "Uploading..." : "Drop your PDF here"}
            </h3>
            <p className="text-sm text-muted-foreground">
              or click to browse from your computer
            </p>
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={handleFileInput}
          disabled={isUploading}
        />
      </div>

      <div className="mt-8 text-center space-y-2">
        <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground/60">
          <span>Secure Processing</span>
          <span>•</span>
          <span>Smart Analysis</span>
          <span>•</span>
          <span>Instant Answers</span>
        </div>
      </div>
    </div>
  );
}

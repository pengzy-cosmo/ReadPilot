/** UploadZone - Drag-and-drop zone for PDF file upload. */
import { FileUp, Loader2, Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";

import { cn } from "@/lib/utils";

interface UploadZoneProps {
	onFileSelect: (file: File) => void;
	isUploading?: boolean;
}

export function UploadZone({ onFileSelect, isUploading }: UploadZoneProps) {
	const [isDragging, setIsDragging] = useState(false);
	const inputRef = useRef<HTMLInputElement | null>(null);

	const handleDragOver = useCallback((event: React.DragEvent) => {
		// Prevent default to allow drop.
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
			if (isUploading) return;
			setIsDragging(false);
			// Only accept a single PDF file.
			const file = event.dataTransfer.files?.[0];
			if (file && file.type === "application/pdf") {
				onFileSelect(file);
			}
		},
		[onFileSelect, isUploading],
	);

	const handleFileInput = useCallback(
		(event: React.ChangeEvent<HTMLInputElement>) => {
			const file = event.target.files?.[0];
			if (file) {
				onFileSelect(file);
			}
			event.target.value = "";
		},
		[onFileSelect],
	);

	const handleClick = useCallback(() => {
		if (isUploading) return;
		inputRef.current?.click();
	}, [isUploading]);

	return (
		<div className="flex flex-1 flex-col items-center justify-center p-6 sm:p-8">
			<button
				type="button"
				className={cn(
					"group relative flex w-full max-w-3xl min-h-[320px] flex-col items-center justify-center rounded-3xl border-2 border-dashed p-8 text-center outline-none transition-all duration-200 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
					isUploading ? "cursor-not-allowed" : "cursor-pointer",
					isDragging
						? "scale-[1.01] border-primary/60 bg-primary/10"
						: "border-border/70 bg-card/55 hover:border-primary/35 hover:bg-card/75",
				)}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				onDrop={handleDrop}
				onClick={handleClick}
				disabled={isUploading}
				aria-label="Upload PDF file"
			>
				<div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-primary/10 via-transparent to-accent/10 opacity-0 transition-opacity group-hover:opacity-100" />

				<div className="relative z-10 flex flex-col items-center gap-4">
					<div className="rounded-2xl border border-border/70 bg-card p-4 shadow-sm transition-transform duration-200 group-hover:scale-105">
						{isUploading ? (
							<Loader2 className="size-8 text-primary animate-spin" aria-hidden="true" />
						) : isDragging ? (
							<FileUp className="size-8 text-primary animate-bounce" aria-hidden="true" />
						) : (
							<Upload
								className="size-8 text-muted-foreground transition-colors group-hover:text-primary"
								aria-hidden="true"
							/>
						)}
					</div>

					<div className="space-y-1.5">
						<h3 className="text-xl font-semibold tracking-tight text-foreground">
							{isUploading ? "Uploading…" : "Drop your PDF here"}
						</h3>
						<p className="text-sm text-muted-foreground">or click to browse from your computer</p>
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
			</button>

			<div className="mt-8 space-y-2 text-center">
				<div className="flex items-center justify-center gap-4 text-xs text-muted-foreground/70">
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

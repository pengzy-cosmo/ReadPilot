/** Header - App header with logo, library button, and settings. */
import { BookOpen, Loader2, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";

interface HeaderProps {
	isUploading: boolean;
	readingMeta?: {
		currentPage: number;
		totalPages: number;
		pageRange: { start: number; end: number };
	} | null;
	onOpenLibrary: () => void;
	onOpenSettings: () => void;
}

export function Header({ isUploading, readingMeta, onOpenLibrary, onOpenSettings }: HeaderProps) {
	const rangeLabel = readingMeta
		? readingMeta.pageRange.start === readingMeta.pageRange.end
			? `Context ${readingMeta.pageRange.start}`
			: `Context ${readingMeta.pageRange.start}-${readingMeta.pageRange.end}`
		: null;

	return (
		<header className="sticky top-0 z-40 border-b border-border/50 bg-background/82 backdrop-blur-xl">
			<div className="mx-auto flex h-14 w-full max-w-[1920px] items-center justify-between px-3 sm:px-4">
				<div className="flex min-w-0 items-center gap-3">
					<div className="size-8 rounded-lg bg-gradient-to-br from-primary/20 via-primary/10 to-accent/20 flex items-center justify-center text-primary shadow-sm">
						<BookOpen className="size-4" aria-hidden="true" />
					</div>
					<div className="min-w-0">
						<h1 className="font-display truncate text-lg leading-none tracking-tight">ReadPilot</h1>
						<p className="hidden truncate text-[11px] text-muted-foreground sm:block">Focused PDF reading workspace</p>
					</div>
					{readingMeta && (
						<div className="hidden items-center gap-2 rounded-full border border-border/60 bg-card/80 px-2.5 py-1 text-[11px] text-muted-foreground md:flex">
							<span className="font-mono">
								Page {readingMeta.currentPage} / {readingMeta.totalPages}
							</span>
							{rangeLabel && <span className="font-mono text-primary/90">{rangeLabel}</span>}
						</div>
					)}
				</div>

				<div className="flex items-center gap-1.5 sm:gap-2">
					{isUploading && (
						<div className="flex items-center gap-1.5 rounded-full border border-border/60 bg-card/85 px-2.5 py-1 text-xs font-medium text-muted-foreground animate-in fade-in zoom-in-95">
							<Loader2 className="size-3 animate-spin" aria-hidden="true" />
							<span>Uploading…</span>
						</div>
					)}

					<div className="h-5 w-px bg-border/70 mx-1" />

					<Button
						variant="outline"
						size="sm"
						onClick={onOpenLibrary}
						className="h-8 rounded-full border-border/60 bg-card/75 px-3 text-muted-foreground hover:bg-card hover:text-foreground"
					>
						<BookOpen className="size-4 mr-2" aria-hidden="true" />
						Library
					</Button>
					<Button
						variant="outline"
						size="icon"
						onClick={onOpenSettings}
						className="size-8 rounded-full border-border/60 bg-card/75 text-muted-foreground hover:bg-card hover:text-foreground"
						aria-label="Settings"
					>
						<Settings className="size-4" aria-hidden="true" />
						<span className="sr-only">Settings</span>
					</Button>
				</div>
			</div>
		</header>
	);
}

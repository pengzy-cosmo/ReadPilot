/** PdfToolbar - Floating toolbar with navigation, zoom, search, and settings. */
import {
	BrainCircuit,
	ChevronLeft,
	ChevronRight,
	FileText,
	Maximize,
	Minimize,
	PanelLeft,
	RefreshCw,
	Search,
	Settings2,
	X,
	ZoomIn,
	ZoomOut,
} from "lucide-react";
import { memo, type RefObject } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PdfToolbarProps {
	// Navigation
	currentPage: number;
	numPages: number;
	pageInput: string;
	onPageInputChange: (value: string) => void;
	onPageInputCommit: () => void;
	onPageStep: (delta: number) => void;

	// Zoom
	effectiveScale: number;
	fitMode: "page-width" | "page-fit";
	onZoomIn: () => void;
	onZoomOut: () => void;
	onToggleFit: () => void;

	// AI context range
	rangeInput: { start: string; end: string };
	localAutoFollow: boolean;
	contextWindowSize: number;
	onRangeStartChange: (value: string) => void;
	onRangeEndChange: (value: string) => void;
	onRangeStartCommit: () => void;
	onRangeEndCommit: () => void;
	onAutoFollowToggle: () => void;
	onContextWindowChange: (value: number) => void;

	// Search
	isSearchOpen: boolean;
	searchQuery: string;
	searchHits: { pageNumber: number; hitIndex: number }[];
	searchIndex: number;
	isSearching: boolean;
	searchInputRef: RefObject<HTMLInputElement | null>;
	onSearchToggle: () => void;
	onSearchQueryChange: (value: string) => void;
	onSearchSubmit: () => void;
	onSearchPrev: () => void;
	onSearchNext: () => void;

	// Settings
	isSettingsOpen: boolean;
	onSettingsToggle: () => void;

	// Sidebar
	showSidebar: boolean;
	onShowSidebar: () => void;

	// Actions
	onRequestOpenFile: () => void;
}

// Context window slider bounds
const CONTEXT_WINDOW_MIN = 1;
const CONTEXT_WINDOW_MAX = 12;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

function PdfToolbarComponent({
	currentPage,
	numPages,
	pageInput,
	onPageInputChange,
	onPageInputCommit,
	onPageStep,
	effectiveScale,
	fitMode,
	onZoomIn,
	onZoomOut,
	onToggleFit,
	rangeInput,
	localAutoFollow,
	contextWindowSize,
	onRangeStartChange,
	onRangeEndChange,
	onRangeStartCommit,
	onRangeEndCommit,
	onAutoFollowToggle,
	onContextWindowChange,
	isSearchOpen,
	searchQuery,
	searchHits,
	searchIndex,
	isSearching,
	searchInputRef,
	onSearchToggle,
	onSearchQueryChange,
	onSearchSubmit,
	onSearchPrev,
	onSearchNext,
	isSettingsOpen,
	onSettingsToggle,
	showSidebar,
	onShowSidebar,
	onRequestOpenFile,
}: PdfToolbarProps) {
	return (
		<div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center p-1 glass rounded-xl shadow-md border border-border/10 transition-all duration-300 max-w-[95vw] w-auto gap-1">
			{/* Left: Sidebar & File */}
			<div className="flex items-center gap-1 pl-1">
				{!showSidebar && (
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8 text-muted-foreground hover:text-foreground"
						onClick={onShowSidebar}
						aria-label="Show Sidebar"
					>
						<PanelLeft className="h-4 w-4" aria-hidden="true" />
					</Button>
				)}
				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-8 text-muted-foreground hover:text-foreground"
					onClick={onRequestOpenFile}
					aria-label="Open PDF"
				>
					<FileText className="h-4 w-4" aria-hidden="true" />
				</Button>
			</div>

			<div className="h-4 w-px bg-border/40 mx-1.5" />

			{/* Center: Navigation */}
			<div className="flex items-center gap-1 shrink-0">
				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
					onClick={() => onPageStep(-1)}
					disabled={currentPage <= 1}
					aria-label="Previous page"
				>
					<ChevronLeft className="h-4 w-4" aria-hidden="true" />
				</Button>

				<div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50 border border-border/20 shadow-sm shrink-0 min-w-[80px] justify-center">
					<label htmlFor="page-input" className="sr-only">
						Current page
					</label>
					<Input
						id="page-input"
						type="text"
						inputMode="numeric"
						pattern="[0-9]*"
						className="w-9 text-center text-sm p-0 border-none bg-transparent focus-visible:ring-0 font-semibold tabular-nums shadow-none h-auto shrink-0 leading-none text-foreground"
						value={pageInput}
						onChange={(e) => onPageInputChange(e.target.value)}
						onBlur={onPageInputCommit}
						onKeyDown={(e) => e.key === "Enter" && onPageInputCommit()}
					/>
					<span className="text-xs text-muted-foreground/60 tabular-nums shrink-0 select-none font-medium">
						/ {numPages}
					</span>
				</div>

				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
					onClick={() => onPageStep(1)}
					disabled={currentPage >= numPages}
					aria-label="Next page"
				>
					<ChevronRight className="h-4 w-4" aria-hidden="true" />
				</Button>
			</div>

			<div className="h-4 w-px bg-border/40 mx-1.5 hidden sm:block shrink-0" />

			{/* Right Center: Zoom (Hidden on very small screens) */}
			<div className="hidden sm:flex items-center gap-1 shrink-0">
				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
					onClick={onZoomOut}
					aria-label="Zoom out"
				>
					<ZoomOut className="h-4 w-4" aria-hidden="true" />
				</Button>
				<span className="text-xs text-muted-foreground font-medium w-10 text-center tabular-nums shrink-0">
					{Math.round(effectiveScale * 100)}%
				</span>
				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
					onClick={onZoomIn}
					aria-label="Zoom in"
				>
					<ZoomIn className="h-4 w-4" aria-hidden="true" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
					onClick={onToggleFit}
					aria-label={fitMode === "page-width" ? "Fit to Page" : "Fit to Width"}
				>
					{fitMode === "page-width" ? (
						<Minimize className="h-4 w-4" aria-hidden="true" />
					) : (
						<Maximize className="h-4 w-4" aria-hidden="true" />
					)}
				</Button>
			</div>

			<div className="h-4 w-px bg-border/40 mx-1.5 shrink-0" />

			{/* Right: AI Context & Tools */}
			<div className="flex items-center gap-1 pr-1 shrink-0 relative">
				{/* AI context range indicator */}
				<div
					className={cn(
						"flex items-center gap-1 rounded-md px-2 py-1 transition-all border shrink-0 mr-1",
						localAutoFollow ? "bg-primary/10 border-primary/20" : "bg-muted/30 border-border/30 hover:bg-muted/50",
					)}
				>
					<BrainCircuit
						className={cn("h-3.5 w-3.5 shrink-0", localAutoFollow ? "text-primary" : "text-muted-foreground")}
						aria-hidden="true"
					/>
					<label htmlFor="range-start" className="sr-only">
						Context range start page
					</label>
					<Input
						id="range-start"
						type="text"
						inputMode="numeric"
						pattern="[0-9]*"
						className="h-4 w-8 text-center text-[10px] p-0 border-none bg-transparent focus-visible:ring-0 font-medium tabular-nums text-foreground shadow-none shrink-0"
						value={rangeInput.start}
						onChange={(e) => onRangeStartChange(e.target.value)}
						onBlur={onRangeStartCommit}
						onKeyDown={(e) => e.key === "Enter" && onRangeStartCommit()}
					/>
					<span className="text-[9px] text-muted-foreground shrink-0 select-none" aria-hidden="true">
						/
					</span>
					<label htmlFor="range-end" className="sr-only">
						Context range end page
					</label>
					<Input
						id="range-end"
						type="text"
						inputMode="numeric"
						pattern="[0-9]*"
						className="h-4 w-8 text-center text-[10px] p-0 border-none bg-transparent focus-visible:ring-0 font-medium tabular-nums text-foreground shadow-none shrink-0"
						value={rangeInput.end}
						onChange={(e) => onRangeEndChange(e.target.value)}
						onBlur={onRangeEndCommit}
						onKeyDown={(e) => e.key === "Enter" && onRangeEndCommit()}
					/>
					<button
						type="button"
						onClick={onAutoFollowToggle}
						className={cn(
							"ml-1 h-4 w-4 rounded-full flex items-center justify-center transition-colors shrink-0",
							localAutoFollow
								? "text-primary hover:bg-primary/10"
								: "text-muted-foreground hover:text-foreground hover:bg-muted",
						)}
						aria-label={localAutoFollow ? "Disable auto-follow" : "Enable auto-follow"}
						aria-pressed={localAutoFollow}
					>
						<RefreshCw className={cn("h-2.5 w-2.5", localAutoFollow && "animate-spin-once")} aria-hidden="true" />
					</button>
				</div>

				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
					onClick={onSettingsToggle}
					aria-label="AI Context Settings"
					aria-expanded={isSettingsOpen}
				>
					<Settings2 className="h-4 w-4" aria-hidden="true" />
				</Button>

				<Button
					variant={isSearchOpen ? "secondary" : "ghost"}
					size="icon"
					className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
					onClick={onSearchToggle}
					aria-label="Search"
					aria-expanded={isSearchOpen}
				>
					<Search className="h-4 w-4" aria-hidden="true" />
				</Button>

				{/* Search Popup */}
				{isSearchOpen && (
					<div className="absolute top-full right-0 mt-3 z-30 w-72 bg-background/80 backdrop-blur-xl shadow-2xl rounded-2xl border border-white/20 dark:border-white/10 p-3 flex flex-col gap-3 animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-200 origin-top-right ring-1 ring-black/5">
						<div className="flex items-center gap-2 bg-muted/50 rounded-xl px-3 py-2 border border-white/5 transition-colors focus-within:bg-muted/70 focus-within:ring-1 focus-within:ring-primary/20">
							<Search className="h-4 w-4 text-muted-foreground/70 shrink-0" aria-hidden="true" />
							<label htmlFor="search-input" className="sr-only">
								Search in document
							</label>
							<Input
								id="search-input"
								ref={searchInputRef}
								placeholder="Find in document…"
								className="h-5 text-sm bg-transparent border-none focus-visible:ring-0 placeholder:text-muted-foreground/50 px-0 shadow-none file:bg-transparent"
								value={searchQuery}
								onChange={(e) => onSearchQueryChange(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") {
										if (e.shiftKey) onSearchPrev();
										else onSearchSubmit();
									} else if (e.key === "Escape") {
										onSearchToggle();
									}
								}}
							/>
							{searchQuery && (
								<button
									type="button"
									onClick={() => onSearchQueryChange("")}
									className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
									aria-label="Clear search"
								>
									<X className="h-3.5 w-3.5" aria-hidden="true" />
								</button>
							)}
						</div>
						<div className="flex items-center justify-between text-xs text-muted-foreground px-1">
							<span className="font-medium truncate max-w-[120px] select-none">
								{searchHits.length > 0
									? `${searchIndex + 1} of ${searchHits.length} results`
									: isSearching
										? "Searching…"
										: "No results"}
							</span>
							<div className="flex items-center gap-1">
								<Button
									variant="ghost"
									size="icon"
									className="h-7 w-7 rounded-lg hover:bg-primary/10 hover:text-primary transition-all"
									onClick={onSearchPrev}
									disabled={!searchHits.length}
									aria-label="Previous result"
								>
									<ChevronLeft className="h-4 w-4" aria-hidden="true" />
								</Button>
								<Button
									variant="ghost"
									size="icon"
									className="h-7 w-7 rounded-lg hover:bg-primary/10 hover:text-primary transition-all"
									onClick={onSearchNext}
									disabled={!searchHits.length}
									aria-label="Next result"
								>
									<ChevronRight className="h-4 w-4" aria-hidden="true" />
								</Button>
							</div>
						</div>
					</div>
				)}

				{/* Settings Popup */}
				{isSettingsOpen && (
					<div className="absolute top-full right-0 mt-3 z-30 w-64 bg-background/80 backdrop-blur-xl shadow-2xl rounded-2xl border border-white/20 dark:border-white/10 p-4 flex flex-col gap-4 animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-200 origin-top-right ring-1 ring-black/5">
						<div className={cn("space-y-3", !localAutoFollow && "opacity-60 grayscale-[0.5] transition-all")}>
							<div className="flex items-center justify-between">
								<span className="text-xs font-semibold text-foreground/80">Context Window</span>
								<span className="bg-primary/10 text-primary px-2 py-0.5 rounded-md text-[11px] font-mono font-medium border border-primary/20">
									±{contextWindowSize}
								</span>
							</div>

							{/* Range Slider */}
							<div className="relative h-4 flex items-center">
								<input
									type="range"
									min={CONTEXT_WINDOW_MIN}
									max={CONTEXT_WINDOW_MAX}
									step={1}
									value={contextWindowSize}
									onChange={(e) => onContextWindowChange(parseInt(e.target.value, 10))}
									disabled={!localAutoFollow}
									aria-label="Auto-follow context window size"
									className="group w-full h-1.5 bg-muted rounded-full appearance-none cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20
									[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4
									[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:shadow-[0_2px_4px_rgba(0,0,0,0.2)]
									[&::-webkit-slider-thumb]:border-[1.5px] [&::-webkit-slider-thumb]:border-primary/50
									[&::-webkit-slider-thumb]:transition-all [&::-webkit-slider-thumb]:hover:scale-110
									[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full
									[&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-[1.5px] [&::-moz-range-thumb]:border-primary/50
									[&::-moz-range-thumb]:shadow-md"
								/>
								<div
									className="absolute left-0 top-1/2 -translate-y-1/2 h-1.5 bg-primary/20 rounded-l-full pointer-events-none"
									style={{
										width: `${((contextWindowSize - CONTEXT_WINDOW_MIN) / (CONTEXT_WINDOW_MAX - CONTEXT_WINDOW_MIN)) * 100}%`,
									}}
								/>
							</div>
						</div>

						{/* Mobile zoom controls */}
						<div className="sm:hidden space-y-3 pt-3 border-t border-border/10">
							<div className="text-xs font-semibold text-foreground/80">Zoom Level</div>
							<div className="flex items-center gap-2 justify-between">
								<div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1 border border-white/5">
									<Button
										variant="ghost"
										size="icon"
										className="h-7 w-7 rounded-md hover:bg-background hover:shadow-sm"
										onClick={onZoomOut}
										aria-label="Zoom out"
									>
										<ZoomOut className="h-3.5 w-3.5" aria-hidden="true" />
									</Button>
									<span className="text-[11px] w-10 text-center font-medium tabular-nums">
										{Math.round(effectiveScale * 100)}%
									</span>
									<Button
										variant="ghost"
										size="icon"
										className="h-7 w-7 rounded-md hover:bg-background hover:shadow-sm"
										onClick={onZoomIn}
										aria-label="Zoom in"
									>
										<ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
									</Button>
								</div>
								<Button
									variant="outline"
									size="icon"
									className="h-9 w-9 rounded-lg bg-transparent border-white/10 hover:bg-muted/50"
									onClick={onToggleFit}
									aria-label={fitMode === "page-width" ? "Fit to Page" : "Fit to Width"}
								>
									{fitMode === "page-width" ? (
										<Minimize className="h-4 w-4" aria-hidden="true" />
									) : (
										<Maximize className="h-4 w-4" aria-hidden="true" />
									)}
								</Button>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

export const PdfToolbar = memo(PdfToolbarComponent);

/** PdfSidebar - Sidebar with outline tree and thumbnail navigation. */
import { BrainCircuit, ChevronDown, ChevronRight, Menu, X } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Thumbnail } from "react-pdf";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import { Button } from "@/components/ui/button";
import type { OutlineNode } from "@/lib/pdfHelpers";
import { cn } from "@/lib/utils";

// Re-export for backward compatibility
export type { OutlineNode };

export interface PdfSidebarProps {
	// Tab state
	sidebarTab: "outline" | "thumbnails";
	onTabChange: (tab: "outline" | "thumbnails") => void;
	hasOutline: boolean;

	// Outline
	outlineItems: OutlineNode[];
	selectedOutlineId: string | null;
	activeOutlineId: string | null;
	onOutlineClick: (item: OutlineNode) => void;
	onOutlineSelectRange: (item: OutlineNode) => void;

	// Thumbnails
	numPages: number;
	pdfDoc: PDFDocumentProxy | null;
	currentPage: number;
	pageRange: { start: number; end: number };
	fileKey: string;
	onThumbnailSelect: (pageNumber: number, isRange: boolean) => void;

	// Panel sizing
	sidebarSizes: { minPercent: number; defaultPercent: number };

	// Actions
	onClose: () => void;
}

// Target width for thumbnail rendering (px)
const THUMBNAIL_TARGET_WIDTH = 120;

// ---------------------------------------------------------------------------
// ThumbnailItem - Single page thumbnail button
// ---------------------------------------------------------------------------

interface ThumbnailItemProps {
	pageNumber: number;
	pdf: PDFDocumentProxy | null;
	isSelected: boolean;
	isCurrent: boolean;
	onSelect: (pageNumber: number, isRange: boolean) => void;
}

function ThumbnailItem({ pageNumber, pdf, isSelected, isCurrent, onSelect }: ThumbnailItemProps) {
	return (
		<button
			type="button"
			className={cn(
				"group w-full rounded-lg border p-2 text-left transition-all duration-200 relative overflow-hidden",
				isSelected ? "border-primary/50 bg-primary/5 shadow-sm" : "border-transparent hover:bg-muted/50",
				isCurrent && "ring-2 ring-blue-500/80 ring-offset-1",
			)}
			onClick={(event) => onSelect(pageNumber, event.shiftKey)}
			title={`Select page ${pageNumber}`}
		>
			<div className="w-full flex items-center justify-center pointer-events-none opacity-90 group-hover:opacity-100 transition-opacity">
				<Thumbnail pageNumber={pageNumber} pdf={pdf ?? undefined} width={THUMBNAIL_TARGET_WIDTH} />
			</div>
			<div className="mt-2 text-[10px] text-muted-foreground text-center font-medium font-mono">{pageNumber}</div>
		</button>
	);
}

const MemoizedThumbnailItem = memo(ThumbnailItem);

// ---------------------------------------------------------------------------
// OutlineTree - Recursive outline rendering
// ---------------------------------------------------------------------------

interface OutlineTreeProps {
	items: OutlineNode[];
	level?: number;
	selectedOutlineId: string | null;
	activeOutlineId: string | null;
	expandedIds: Set<string>;
	activePath: Set<string>;
	onToggleExpand: (id: string, expand: boolean) => void;
	onOutlineClick: (item: OutlineNode) => void;
	onOutlineSelectRange: (item: OutlineNode) => void;
}

function OutlineTree({
	items,
	level = 0,
	selectedOutlineId,
	activeOutlineId,
	expandedIds,
	activePath,
	onToggleExpand,
	onOutlineClick,
	onOutlineSelectRange,
}: OutlineTreeProps) {
	if (!items.length) return null;

	return (
		<ul className={cn("space-y-0.5", level > 0 && "ml-3 border-l border-border/40 pl-2")}>
			{items.map((item) => {
				const isSelected = selectedOutlineId === item.id;
				const isAncestorActive = activePath.has(item.id);
				const isExpanded = expandedIds.has(item.id);
				// Show active indicator if this is the active item, OR if it contains the active item but is collapsed (proxy)
				const showActiveIndicator = activeOutlineId === item.id || (isAncestorActive && !isExpanded);
				const hasChildren = item.items && item.items.length > 0;

				return (
					<li key={item.id}>
						{/* biome-ignore lint/a11y/useSemanticElements: div+role avoids nested <button> hydration error from inner Button component */}
						<div
							id={`outline-node-${item.id}`}
							className={cn(
								"group w-full flex items-center gap-1 rounded-sm pr-2 py-1 transition-colors text-sm cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring relative",
								isSelected
									? "bg-primary/10 text-primary font-medium"
									: showActiveIndicator
										? "text-foreground font-medium bg-muted/40"
										: "hover:bg-muted text-muted-foreground hover:text-foreground",
							)}
							role="button"
							tabIndex={0}
							onClick={() => onOutlineClick(item)}
							onKeyDown={(e) => {
								if (e.key === "Enter" || e.key === " ") {
									e.preventDefault();
									onOutlineClick(item);
								}
							}}
							style={{ paddingLeft: `${Math.max(4, level * 12 + 4)}px` }}
						>
							{/* Expand/Collapse Toggle */}
							<button
								type="button"
								className={cn(
									"flex items-center justify-center w-5 h-5 rounded-sm hover:bg-black/5 dark:hover:bg-white/10 shrink-0 focus-visible:ring-2 focus-visible:ring-ring outline-none transition-colors",
									hasChildren ? "cursor-pointer" : "invisible pointer-events-none",
								)}
								onClick={(e) => {
									e.stopPropagation();
									onToggleExpand(item.id, !isExpanded);
								}}
								aria-label={isExpanded ? "Collapse section" : "Expand section"}
							>
								{isExpanded ? (
									<ChevronDown className="h-3.5 w-3.5 opacity-50" aria-hidden="true" />
								) : (
									<ChevronRight className="h-3.5 w-3.5 opacity-50" aria-hidden="true" />
								)}
							</button>

							<span className="flex-1 truncate text-left select-none">{item.title || "Untitled"}</span>
							{/* Focus context button - only for internal links */}
							{!item.url && (
								<Button
									variant="ghost"
									size="icon"
									className={cn(
										"h-5 w-5 opacity-0 group-hover:opacity-100 transition-all scale-90 hover:scale-100 shrink-0",
										isSelected && "opacity-100 text-primary bg-background shadow-sm",
									)}
									onClick={(event) => {
										event.stopPropagation();
										onOutlineSelectRange(item);
									}}
									aria-label="Focus context on this section"
								>
									<BrainCircuit className="h-3 w-3" aria-hidden="true" />
								</Button>
							)}
							{showActiveIndicator && !isSelected && (
								<div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-1/2 bg-primary/60 rounded-r-full" />
							)}
						</div>
						{hasChildren && isExpanded && (
							<OutlineTree
								items={item.items ?? []}
								level={level + 1}
								selectedOutlineId={selectedOutlineId}
								activeOutlineId={activeOutlineId}
								expandedIds={expandedIds}
								activePath={activePath}
								onToggleExpand={onToggleExpand}
								onOutlineClick={onOutlineClick}
								onOutlineSelectRange={onOutlineSelectRange}
							/>
						)}
					</li>
				);
			})}
		</ul>
	);
}

// ---------------------------------------------------------------------------
// PdfSidebar Component
// ---------------------------------------------------------------------------

function PdfSidebarComponent({
	sidebarTab,
	onTabChange,
	hasOutline,
	outlineItems,
	selectedOutlineId,
	activeOutlineId,
	onOutlineClick,
	onOutlineSelectRange,
	numPages,
	pdfDoc,
	currentPage,
	pageRange,
	fileKey,
	onThumbnailSelect,
	onClose,
}: PdfSidebarProps) {
	// Ref for programmatic scrolling of thumbnail list
	const thumbnailListRef = useRef<VirtuosoHandle>(null);

	// Expansion state
	const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
	const shouldScrollToActiveRef = useRef(false);

	// Reset expansion state when document changes
	useEffect(() => {
		if (!fileKey) return;
		setExpandedIds(new Set());
	}, [fileKey]);

	// Helper: Find path to active item
	const getActivePath = useCallback((nodes: OutlineNode[], targetId: string | null): Set<string> => {
		if (!targetId) return new Set();
		const path = new Set<string>();
		const find = (items: OutlineNode[]): boolean => {
			for (const item of items) {
				if (item.id === targetId) return true;
				if (item.items && item.items.length > 0) {
					if (find(item.items)) {
						path.add(item.id); // Add parent to path
						return true;
					}
				}
			}
			return false;
		};
		find(nodes);
		return path;
	}, []);

	// Memoize active path set for efficient lookup
	const activePath = useMemo(
		() => getActivePath(outlineItems, activeOutlineId),
		[activeOutlineId, outlineItems, getActivePath],
	);

	// Auto-expand effect
	useEffect(() => {
		if (activeOutlineId) shouldScrollToActiveRef.current = true;

		if (activePath.size > 0) {
			setExpandedIds((prev) => {
				const next = new Set(prev);
				let changed = false;
				activePath.forEach((id) => {
					if (!next.has(id)) {
						next.add(id);
						changed = true;
					}
				});
				return changed ? next : prev;
			});
		}
	}, [activePath, activeOutlineId]);

	// Auto-scroll outline to active item (after expansion)
	// biome-ignore lint/correctness/useExhaustiveDependencies: expandedIds is needed to retry scroll after expansion updates
	useEffect(() => {
		let frameId: number | null = null;
		if (sidebarTab === "outline" && shouldScrollToActiveRef.current && activeOutlineId) {
			// Use RAF to ensure DOM has updated after expansion
			frameId = requestAnimationFrame(() => {
				const el = document.getElementById(`outline-node-${activeOutlineId}`);
				if (el) {
					el.scrollIntoView({ block: "nearest", behavior: "smooth" });
					shouldScrollToActiveRef.current = false;
				}
			});
		}
		return () => {
			if (frameId !== null) cancelAnimationFrame(frameId);
		};
	}, [activeOutlineId, sidebarTab, expandedIds]);

	const toggleExpand = useCallback((id: string, expand: boolean) => {
		setExpandedIds((prev) => {
			const next = new Set(prev);
			if (expand) next.add(id);
			else next.delete(id);
			return next;
		});
	}, []);

	// Auto-scroll thumbnail list to keep current page visible
	useEffect(() => {
		if (sidebarTab === "thumbnails" && currentPage > 0 && numPages > 0) {
			const targetIndex = Math.max(0, Math.min(currentPage - 1, numPages - 1));
			thumbnailListRef.current?.scrollToIndex({
				index: targetIndex,
				align: "center",
				behavior: "smooth",
			});
		}
	}, [currentPage, sidebarTab, numPages]);

	return (
		<>
			{/* Header with tabs */}
			<div className="flex items-center justify-between p-3 border-b h-14 bg-background/50 backdrop-blur-sm shrink-0">
				<div className="flex bg-muted/50 p-1 rounded-lg" role="tablist">
					<button
						type="button"
						id="tab-outline"
						role="tab"
						aria-selected={sidebarTab === "outline"}
						aria-controls="panel-outline"
						tabIndex={sidebarTab === "outline" ? 0 : -1}
						className={cn(
							"px-3 py-1 text-xs font-medium rounded-md transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 outline-none",
							sidebarTab === "outline"
								? "bg-background text-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground",
						)}
						onClick={() => onTabChange("outline")}
					>
						Outline
					</button>
					<button
						type="button"
						id="tab-thumbnails"
						role="tab"
						aria-selected={sidebarTab === "thumbnails"}
						aria-controls="panel-thumbnails"
						tabIndex={sidebarTab === "thumbnails" ? 0 : -1}
						className={cn(
							"px-3 py-1 text-xs font-medium rounded-md transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 outline-none",
							sidebarTab === "thumbnails"
								? "bg-background text-foreground shadow-sm"
								: "text-muted-foreground hover:text-foreground",
						)}
						onClick={() => onTabChange("thumbnails")}
					>
						Thumbnails
					</button>
				</div>
				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-8 text-muted-foreground hover:text-foreground"
					onClick={onClose}
					aria-label="Close sidebar"
				>
					<X className="h-4 w-4" aria-hidden="true" />
				</Button>
			</div>

			{/* Content area - both panels always in DOM for aria-controls */}
			<div className="flex-1 overflow-hidden p-3 scrollbar-thin flex flex-col">
				{/* Outline panel */}
				<div
					id="panel-outline"
					role="tabpanel"
					aria-labelledby="tab-outline"
					className={sidebarTab === "outline" ? "flex-1 overflow-auto" : "hidden"}
				>
					{hasOutline ? (
						<div className="pdf-outline">
							<OutlineTree
								items={outlineItems}
								selectedOutlineId={selectedOutlineId}
								activeOutlineId={activeOutlineId}
								expandedIds={expandedIds}
								activePath={activePath}
								onToggleExpand={toggleExpand}
								onOutlineClick={onOutlineClick}
								onOutlineSelectRange={onOutlineSelectRange}
							/>
						</div>
					) : (
						<div className="p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-3 opacity-60">
							<Menu className="h-8 w-8 opacity-20" aria-hidden="true" />
							<p>No outline available</p>
						</div>
					)}
				</div>
				{/* Thumbnails panel - container always in DOM, Virtuoso conditionally rendered to ensure correct height measurement */}
				<div
					id="panel-thumbnails"
					role="tabpanel"
					aria-labelledby="tab-thumbnails"
					className={sidebarTab === "thumbnails" ? "flex-1 overflow-hidden" : "hidden"}
				>
					{sidebarTab === "thumbnails" && (
						<Virtuoso
							ref={thumbnailListRef}
							style={{ height: "100%" }}
							totalCount={numPages}
							initialTopMostItemIndex={Math.max(0, Math.min(currentPage - 1, numPages - 1))}
							itemContent={(index) => {
								const page = index + 1;
								return (
									<div className="pb-4 px-1">
										<MemoizedThumbnailItem
											key={`${fileKey}-${page}`}
											pageNumber={page}
											pdf={pdfDoc}
											isSelected={page >= pageRange.start && page <= pageRange.end}
											isCurrent={currentPage === page}
											onSelect={onThumbnailSelect}
										/>
									</div>
								);
							}}
						/>
					)}
				</div>
			</div>
		</>
	);
}

export const PdfSidebar = memo(PdfSidebarComponent);

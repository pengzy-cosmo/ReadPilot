/** PdfSidebar - Sidebar with outline tree and thumbnail navigation. */
import { BrainCircuit, Menu, X } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { memo, useEffect, useRef } from "react";
import { Thumbnail } from "react-pdf";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type OutlineNode = {
	id: string;
	title: string;
	dest: unknown;
	url?: string | null;
	items?: OutlineNode[];
};

export interface PdfSidebarProps {
	// Tab state
	sidebarTab: "outline" | "thumbnails";
	onTabChange: (tab: "outline" | "thumbnails") => void;
	hasOutline: boolean;

	// Outline
	outlineItems: OutlineNode[];
	selectedOutlineId: string | null;
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
				isCurrent && "ring-2 ring-primary ring-offset-1",
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
	onOutlineClick: (item: OutlineNode) => void;
	onOutlineSelectRange: (item: OutlineNode) => void;
}

function OutlineTree({ items, level = 0, selectedOutlineId, onOutlineClick, onOutlineSelectRange }: OutlineTreeProps) {
	if (!items.length) return null;

	return (
		<ul className={cn("space-y-0.5", level > 0 && "ml-3 border-l border-border/40 pl-2")}>
			{items.map((item) => {
				const isSelected = selectedOutlineId === item.id;
				return (
					<li key={item.id}>
						{/* biome-ignore lint/a11y/useSemanticElements: div+role avoids nested <button> hydration error from inner Button component */}
						<div
							className={cn(
								"group w-full flex items-center gap-2 rounded-sm px-2 py-1.5 transition-colors text-sm cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring",
								isSelected
									? "bg-primary/10 text-primary font-medium"
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
						>
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
									title="Focus context on this section"
								>
									<BrainCircuit className="h-3 w-3" />
								</Button>
							)}
						</div>
						{item.items && item.items.length > 0 && (
							<OutlineTree
								items={item.items}
								level={level + 1}
								selectedOutlineId={selectedOutlineId}
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

	// Auto-scroll thumbnail list to keep current page visible
	useEffect(() => {
		if (sidebarTab === "thumbnails" && currentPage > 0) {
			thumbnailListRef.current?.scrollToIndex({
				index: currentPage - 1,
				align: "center",
				behavior: "smooth",
			});
		}
	}, [currentPage, sidebarTab]);

	return (
		<>
			{/* Header with tabs */}
			<div className="flex items-center justify-between p-3 border-b h-14 bg-background/50 backdrop-blur-sm shrink-0">
				<div className="flex bg-muted/50 p-1 rounded-lg">
					<button
						type="button"
						className={cn(
							"px-3 py-1 text-xs font-medium rounded-md transition-all",
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
						className={cn(
							"px-3 py-1 text-xs font-medium rounded-md transition-all",
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
				>
					<X className="h-4 w-4" />
				</Button>
			</div>

			{/* Content area */}
			<div className="flex-1 overflow-auto p-3 scrollbar-thin">
				{sidebarTab === "outline" ? (
					hasOutline ? (
						<div className="pdf-outline animate-in fade-in duration-300">
							<OutlineTree
								items={outlineItems}
								selectedOutlineId={selectedOutlineId}
								onOutlineClick={onOutlineClick}
								onOutlineSelectRange={onOutlineSelectRange}
							/>
						</div>
					) : (
						<div className="p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-3 opacity-60">
							<Menu className="h-8 w-8 opacity-20" />
							<p>No outline available</p>
						</div>
					)
				) : (
					<Virtuoso
						ref={thumbnailListRef}
						style={{ height: "100%" }}
						totalCount={numPages}
						initialTopMostItemIndex={Math.max(0, currentPage - 1)}
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
		</>
	);
}

export const PdfSidebar = memo(PdfSidebarComponent);

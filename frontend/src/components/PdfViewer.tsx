/** PdfViewer - Main PDF viewer with sidebar, toolbar, search, and AI context range. */
import { FileText, X } from "lucide-react";
import type { DocumentInitParameters, PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist/types/src/display/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import { type OutlineNode, PdfSidebar } from "@/components/PdfSidebar";
import { PdfToolbar } from "@/components/PdfToolbar";
import { TextSelectionPopup } from "@/components/TextSelectionPopup";
import { Button } from "@/components/ui/button";
import { usePdfOutline } from "@/hooks/usePdfOutline";
import { usePdfSearch } from "@/hooks/usePdfSearch";
import { normalizePdfFromLoad } from "@/lib/pdfHelpers";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// PDF.js Configuration
// ---------------------------------------------------------------------------

const PDFJS_VERSION = (pdfjs as unknown as { version?: string }).version ?? "5.4.296";
const PDFJS_CDN_BASE = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/`;

// Load worker + assets from CDN to avoid bundling heavy PDF.js files.
pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN_BASE}build/pdf.worker.min.mjs`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PdfViewerProps {
	sourceUrl: string | null;
	onRequestOpenFile: () => void;
	pageRange: { start: number; end: number };
	onPageRangeChange: (range: { start: number; end: number }) => void;
	onCurrentPageChange?: (page: number) => void;
	onTextSelect?: (text: string) => void;
	onExplainText?: (text: string) => void;
	initialPage?: number;
	initialAutoFollow?: boolean;
	initialContextWindow?: number;
}

type FitMode = "page-width" | "page-fit";
type PageSize = { width: number; height: number };
type ScrollBehaviorOption = "auto" | "smooth";

type OutlineFlatItem = {
	id: string;
	title: string;
	dest: unknown;
	url?: string | null;
	level: number;
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VIEWPORT_BUFFER_PAGES = 2;
const PAGE_GAP = 24;
const VIEWER_PADDING = 48;
const CONTEXT_WINDOW_MIN = 1;
const CONTEXT_WINDOW_MAX = 12;
const SIDEBAR_DEFAULT_SIZE = 28;
const SIDEBAR_MIN_SIZE = 22;
const SIDEBAR_DEFAULT_PX = 320;
const SIDEBAR_MIN_PX = 240;
const VIEWER_MIN_SIZE = 40;

// ---------------------------------------------------------------------------
// Helper Functions
// ---------------------------------------------------------------------------

/** Flatten nested outline into a flat list with level depth for range calculations. */
const flattenOutline = (items: OutlineNode[], level = 0, acc: OutlineFlatItem[] = []) => {
	items.forEach((item) => {
		acc.push({
			id: item.id,
			title: item.title,
			dest: item.dest,
			url: item.url,
			level,
		});
		if (item.items && item.items.length > 0) {
			flattenOutline(item.items, level + 1, acc);
		}
	});
	return acc;
};

// ---------------------------------------------------------------------------
// PdfViewer Component
// ---------------------------------------------------------------------------

export function PdfViewer({
	sourceUrl,
	onRequestOpenFile,
	pageRange,
	onPageRangeChange,
	onCurrentPageChange,
	onTextSelect,
	onExplainText,
	initialPage,
	initialAutoFollow = true,
	initialContextWindow = 3,
}: PdfViewerProps) {
	// -------------------------------------------------------------------------
	// State: Document
	// -------------------------------------------------------------------------

	const [numPages, setNumPages] = useState(0);
	const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
	const [pageBaseSize, setPageBaseSize] = useState<PageSize | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);

	// -------------------------------------------------------------------------
	// State: Navigation
	// -------------------------------------------------------------------------

	const [currentPage, setCurrentPage] = useState(1);
	const [pageInput, setPageInput] = useState("1");

	// -------------------------------------------------------------------------
	// State: Sidebar
	// -------------------------------------------------------------------------

	const [showSidebar, setShowSidebar] = useState(true);
	const [sidebarTab, setSidebarTab] = useState<"outline" | "thumbnails">("outline");
	const [hasOutline, setHasOutline] = useState(false);
	const [outlineItems, setOutlineItems] = useState<OutlineNode[]>([]);
	const [selectedOutlineId, setSelectedOutlineId] = useState<string | null>(null);
	const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null);
	const [outlinePageMap, setOutlinePageMap] = useState<Map<string, number>>(new Map());
	const [thumbnailAnchor, setThumbnailAnchor] = useState<number | null>(null);

	// -------------------------------------------------------------------------
	// State: Zoom
	// -------------------------------------------------------------------------

	const [fitMode, setFitMode] = useState<FitMode>("page-width");
	const [userScale, setUserScale] = useState(1);

	// -------------------------------------------------------------------------
	// State: AI Context Range
	// -------------------------------------------------------------------------

	const [localAutoFollow, setLocalAutoFollow] = useState(initialAutoFollow);
	const [contextWindowSize, setContextWindowSize] = useState(initialContextWindow);
	const [rangeInput, setRangeInput] = useState({ start: "1", end: "1" });

	// -------------------------------------------------------------------------
	// State: Search UI
	// -------------------------------------------------------------------------

	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);

	// -------------------------------------------------------------------------
	// State: Container Sizing
	// -------------------------------------------------------------------------

	const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
	const [groupWidth, setGroupWidth] = useState(0);

	// -------------------------------------------------------------------------
	// Refs
	// -------------------------------------------------------------------------

	const containerRef = useRef<HTMLDivElement | null>(null);
	const groupRef = useRef<HTMLDivElement | null>(null);
	const viewerRef = useRef<VirtuosoHandle | null>(null);
	const scrollerRef = useRef<HTMLElement | null>(null);
	const searchInputRef = useRef<HTMLInputElement | null>(null);
	const pdfRef = useRef<PDFDocumentProxy | null>(null);
	const baseSizeRef = useRef<PageSize | null>(null);
	const currentPageRef = useRef(1);
	const initialPageRef = useRef<number | null>(initialPage ?? null);

	const outlineResolveTokenRef = useRef(0);
	const hadOutlineRef = useRef(false);
	const hadBaseSizeRef = useRef(false);
	const retryScrollRef = useRef<number[]>([]);
	const pendingScrollPageRef = useRef<number | null>(null);

	// -------------------------------------------------------------------------
	// Hooks: Search & Outline
	// -------------------------------------------------------------------------

	const scheduleJump = useCallback((pageNumber: number, offset = 0) => {
		pendingScrollPageRef.current = pageNumber;
		for (const timer of retryScrollRef.current) window.clearTimeout(timer);
		retryScrollRef.current = [];
		const scrollToPage = (page: number, opt?: { behavior?: ScrollBehaviorOption; offset?: number }) => {
			viewerRef.current?.scrollToIndex({
				index: page - 1,
				align: "start",
				behavior: opt?.behavior ?? "smooth",
				offset: opt?.offset ?? 0,
			});
		};
		scrollToPage(pageNumber, { behavior: "auto", offset });
		retryScrollRef.current.push(window.setTimeout(() => scrollToPage(pageNumber, { behavior: "auto", offset }), 120));
		retryScrollRef.current.push(window.setTimeout(() => scrollToPage(pageNumber, { behavior: "auto", offset }), 420));
	}, []);

	const {
		activeQuery,
		searchHits,
		searchIndex,
		isSearching,
		pendingHitRef: searchPendingHitRef,
		clearSearch,
		runSearch,
		navigatePrev: searchNavigatePrev,
		navigateNext: searchNavigateNext,
		makeTextRenderer,
		scrollToPendingHit,
		resetPageHitCounter,
	} = usePdfSearch();
	const {
		resolveDestPageNumber,
		navigateToOutlineItem,
		loadOutline,
		outlinePageCacheRef,
		clearCache: clearOutlineCache,
	} = usePdfOutline();

	const effectiveScale = useMemo(() => {
		if (!pageBaseSize || !containerSize.width || !containerSize.height) return 1;
		const availableWidth = Math.max(0, containerSize.width - VIEWER_PADDING);
		const availableHeight = Math.max(0, containerSize.height - VIEWER_PADDING);
		const widthScale = availableWidth / pageBaseSize.width;
		if (fitMode === "page-width") return Math.max(0.1, widthScale * userScale);
		const heightScale = availableHeight / pageBaseSize.height;
		return Math.max(0.1, Math.min(widthScale, heightScale) * userScale);
	}, [containerSize, fitMode, pageBaseSize, userScale]);

	// -------------------------------------------------------------------------
	// Computed Values
	// -------------------------------------------------------------------------

	const fileKey = useMemo(() => sourceUrl ?? "empty", [sourceUrl]);

	const sidebarSizes = useMemo(() => {
		if (!groupWidth) {
			return { minPercent: SIDEBAR_MIN_SIZE, defaultPercent: SIDEBAR_DEFAULT_SIZE };
		}
		const minPercent = Math.min(100 - VIEWER_MIN_SIZE, (SIDEBAR_MIN_PX / groupWidth) * 100);
		const defaultPercent = Math.min(
			100 - VIEWER_MIN_SIZE,
			Math.max(minPercent, (SIDEBAR_DEFAULT_PX / groupWidth) * 100),
		);
		return { minPercent, defaultPercent };
	}, [groupWidth]);

	const groupDefaultLayout = useMemo((): Record<string, number> => {
		if (!showSidebar || numPages <= 0) return { "viewer-panel": 100 };
		return {
			"sidebar-panel": sidebarSizes.defaultPercent,
			"viewer-panel": 100 - sidebarSizes.defaultPercent,
		};
	}, [numPages, showSidebar, sidebarSizes.defaultPercent]);

	const documentOptions = useMemo<DocumentInitParameters>(
		() => ({
			cMapUrl: `${PDFJS_CDN_BASE}cmaps/`,
			cMapPacked: true,
			standardFontDataUrl: `${PDFJS_CDN_BASE}standard_fonts/`,
			wasmUrl: `${PDFJS_CDN_BASE}wasm/`,
			iccUrl: `${PDFJS_CDN_BASE}iccs/`,
		}),
		[],
	);

	const pageRenderSize = useMemo(() => {
		if (!pageBaseSize) return null;
		return { width: pageBaseSize.width * effectiveScale, height: pageBaseSize.height * effectiveScale };
	}, [pageBaseSize, effectiveScale]);

	// -------------------------------------------------------------------------
	// Navigation Handlers
	// -------------------------------------------------------------------------

	const handlePageInputCommit = useCallback(() => {
		if (!numPages) return;
		const value = parseInt(pageInput, 10);
		if (Number.isNaN(value)) {
			setPageInput(String(currentPage));
			return;
		}
		const nextPage = Math.max(1, Math.min(numPages, value));
		setCurrentPage(nextPage);
		scheduleJump(nextPage, 0);
	}, [currentPage, numPages, pageInput, scheduleJump]);

	const handlePageStep = useCallback(
		(delta: number) => {
			if (!numPages) return;
			const basePage = pendingScrollPageRef.current ?? currentPageRef.current;
			const next = Math.max(1, Math.min(numPages, basePage + delta));
			setCurrentPage(next);
			scheduleJump(next, 0);
		},
		[numPages, scheduleJump],
	);

	// -------------------------------------------------------------------------
	// Zoom Handlers
	// -------------------------------------------------------------------------

	const handleZoomIn = useCallback(() => setUserScale((prev) => Math.min(prev + 0.1, 3)), []);
	const handleZoomOut = useCallback(() => setUserScale((prev) => Math.max(prev - 0.1, 0.5)), []);
	const handleToggleFit = useCallback(() => {
		setFitMode((prev) => (prev === "page-width" ? "page-fit" : "page-width"));
		setUserScale(1);
	}, []);

	// -------------------------------------------------------------------------
	// Page Range Handlers (AI Context)
	// -------------------------------------------------------------------------

	const clampRange = useCallback(
		(nextStart: number, nextEnd: number) => {
			const max = numPages || 1;
			const start = Math.max(1, Math.min(nextStart, max));
			const end = Math.max(1, Math.min(nextEnd, max));
			if (start <= end) {
				onPageRangeChange({ start, end });
			} else {
				onPageRangeChange({ start: end, end: start });
			}
		},
		[numPages, onPageRangeChange],
	);

	const commitRangeStart = useCallback(() => {
		const value = parseInt(rangeInput.start, 10);
		if (Number.isNaN(value)) {
			setRangeInput((prev) => ({ ...prev, start: String(pageRange.start) }));
			return;
		}
		clampRange(value, pageRange.end);
	}, [clampRange, pageRange.end, pageRange.start, rangeInput.start]);

	const commitRangeEnd = useCallback(() => {
		const value = parseInt(rangeInput.end, 10);
		if (Number.isNaN(value)) {
			setRangeInput((prev) => ({ ...prev, end: String(pageRange.end) }));
			return;
		}
		clampRange(pageRange.start, value);
	}, [clampRange, pageRange.end, pageRange.start, rangeInput.end]);

	const handleRangeStartChange = useCallback((value: string) => {
		setLocalAutoFollow(false);
		setSelectedOutlineId(null);
		setRangeInput((prev) => ({ ...prev, start: value }));
	}, []);

	const handleRangeEndChange = useCallback((value: string) => {
		setLocalAutoFollow(false);
		setSelectedOutlineId(null);
		setRangeInput((prev) => ({ ...prev, end: value }));
	}, []);

	const handleContextWindowChange = useCallback((value: number) => {
		const next = Math.max(CONTEXT_WINDOW_MIN, Math.min(CONTEXT_WINDOW_MAX, value));
		setContextWindowSize(next);
	}, []);

	const handleAutoFollowToggle = useCallback(() => {
		setLocalAutoFollow((prev) => {
			const next = !prev;
			if (next) setSelectedOutlineId(null);
			return next;
		});
	}, []);

	// -------------------------------------------------------------------------
	// Search Handlers
	// -------------------------------------------------------------------------

	const handleSearchPrev = useCallback(() => searchNavigatePrev(), [searchNavigatePrev]);
	const handleSearchNext = useCallback(() => searchNavigateNext(), [searchNavigateNext]);

	const handleSearchSubmit = useCallback(() => {
		const trimmed = searchQuery.trim();
		if (!trimmed) {
			clearSearch();
			return;
		}
		if (trimmed === activeQuery && searchHits.length > 0 && !isSearching) {
			handleSearchNext();
			return;
		}
		void runSearch(trimmed, pdfRef.current, currentPageRef.current, (page) => scheduleJump(page, 0));
	}, [
		activeQuery,
		clearSearch,
		handleSearchNext,
		isSearching,
		runSearch,
		scheduleJump,
		searchHits.length,
		searchQuery,
	]);

	const handleToggleSearch = useCallback(() => {
		setIsSearchOpen((prev) => {
			const next = !prev;
			if (next) {
				requestAnimationFrame(() => {
					searchInputRef.current?.focus();
					searchInputRef.current?.select();
				});
			} else {
				clearSearch();
			}
			return next;
		});
		setIsSettingsOpen(false);
	}, [clearSearch]);

	const handleToggleSettings = useCallback(() => {
		setIsSettingsOpen((prev) => !prev);
		setIsSearchOpen(false);
	}, []);

	// -------------------------------------------------------------------------
	// Outline Handlers
	// -------------------------------------------------------------------------

	const handleOutlineClick = useCallback(
		async (item: OutlineNode) => {
			await navigateToOutlineItem(item, pdfRef.current, effectiveScale, scheduleJump);
		},
		[effectiveScale, navigateToOutlineItem, scheduleJump],
	);

	const getOutlineFlatWithPages = useCallback(async () => {
		const flat = flattenOutline(outlineItems);
		// Parallel resolution for all outline items
		const resolved = await Promise.all(
			flat.map(async (item) => {
				if (item.url) {
					return { ...item, pageNumber: null };
				}
				let pageNumber = outlinePageCacheRef.current.get(item.id) ?? null;
				if (!pageNumber) {
					pageNumber = await resolveDestPageNumber(pdfRef.current, item.dest);
					if (pageNumber) outlinePageCacheRef.current.set(item.id, pageNumber);
				}
				return { ...item, pageNumber };
			}),
		);
		return resolved;
	}, [outlineItems, outlinePageCacheRef, resolveDestPageNumber]);

	const handleOutlineSelectRange = useCallback(
		async (item: OutlineNode) => {
			if (selectedOutlineId === item.id) {
				setSelectedOutlineId(null);
				setLocalAutoFollow(true);
				return;
			}
			const flat = await getOutlineFlatWithPages();
			const currentIndex = flat.findIndex((entry) => entry.id === item.id);
			if (currentIndex < 0) return;
			const current = flat[currentIndex];
			if (!current.pageNumber || !numPages) return;
			let endPage = numPages;
			for (let i = currentIndex + 1; i < flat.length; i += 1) {
				const next = flat[i];
				if (next.pageNumber && next.level <= current.level) {
					endPage = Math.max(1, next.pageNumber);
					break;
				}
			}
			const start = current.pageNumber;
			const end = Math.max(start, endPage);
			setLocalAutoFollow(false);
			onPageRangeChange({ start, end });
			setThumbnailAnchor(start);
			setSelectedOutlineId(item.id);
		},
		[getOutlineFlatWithPages, numPages, onPageRangeChange, selectedOutlineId],
	);

	// -------------------------------------------------------------------------
	// Thumbnail Handlers
	// -------------------------------------------------------------------------

	const handleThumbnailSelect = useCallback(
		(pageNumber: number, isRange: boolean) => {
			if (!numPages) return;
			setLocalAutoFollow(false);
			setSelectedOutlineId(null);
			if (isRange && thumbnailAnchor) {
				const start = Math.max(1, Math.min(thumbnailAnchor, pageNumber));
				const end = Math.min(numPages, Math.max(thumbnailAnchor, pageNumber));
				onPageRangeChange({ start, end });
			} else {
				onPageRangeChange({ start: pageNumber, end: pageNumber });
				setThumbnailAnchor(pageNumber);
			}
			scheduleJump(pageNumber, 0);
		},
		[numPages, onPageRangeChange, scheduleJump, thumbnailAnchor],
	);

	// -------------------------------------------------------------------------
	// Document Load Handlers
	// -------------------------------------------------------------------------

	const handleDocumentLoadSuccess = useCallback(
		(value: PDFDocumentProxy | { pdf?: PDFDocumentProxy }) => {
			const pdf = normalizePdfFromLoad(value);
			pdfRef.current = pdf;
			setPdfDoc(pdf);
			setNumPages(pdf.numPages);
			setCurrentPage(1);
			setPageInput("1");
			setIsLoading(false);
			setLoadError(null);
			const targetPage = initialPageRef.current;
			if (targetPage && targetPage >= 1 && targetPage <= pdf.numPages) scheduleJump(targetPage, 0);
		},
		[scheduleJump],
	);

	const handleDocumentLoadError = useCallback((error: Error) => {
		console.error("Failed to load PDF:", error);
		setLoadError("Failed to load PDF. Please try another file.");
		setIsLoading(false);
	}, []);

	const handlePageLoadSuccess = useCallback((page: PDFPageProxy) => {
		if (baseSizeRef.current) return;
		const viewport = page.getViewport({ scale: 1 });
		const nextSize = { width: viewport.width, height: viewport.height };
		baseSizeRef.current = nextSize;
		setPageBaseSize(nextSize);
	}, []);

	const handleRangeChanged = useCallback(
		({ startIndex }: { startIndex: number; endIndex: number }) => {
			if (!numPages) return;
			const visibleIndex = Math.min(numPages - 1, Math.max(0, startIndex + VIEWPORT_BUFFER_PAGES));
			const nextPage = visibleIndex + 1;
			const pendingPage = pendingScrollPageRef.current;
			if (pendingPage) {
				if (Math.abs(nextPage - pendingPage) > 1) return;
				pendingScrollPageRef.current = null;
			}
			setCurrentPage((prev) => (prev === nextPage ? prev : nextPage));
		},
		[numPages],
	);

	// -------------------------------------------------------------------------
	// Effects
	// -------------------------------------------------------------------------

	// Sync initialPage prop to ref
	useEffect(() => {
		initialPageRef.current = initialPage ?? null;
	}, [initialPage]);

	// Sync currentPage to ref and notify parent
	useEffect(() => {
		setPageInput(String(currentPage));
		onCurrentPageChange?.(currentPage);
	}, [currentPage, onCurrentPageChange]);

	useEffect(() => {
		currentPageRef.current = currentPage;
	}, [currentPage]);

	// Sync pageRange to input fields
	useEffect(() => {
		setRangeInput({ start: String(pageRange.start), end: String(pageRange.end) });
	}, [pageRange.end, pageRange.start]);

	// Auto-follow: update page range based on current page
	useEffect(() => {
		if (localAutoFollow && numPages > 0) {
			const start = Math.max(1, currentPage - contextWindowSize);
			const end = Math.min(numPages, currentPage + contextWindowSize);
			onPageRangeChange({ start, end });
		}
	}, [currentPage, localAutoFollow, contextWindowSize, numPages, onPageRangeChange]);

	// Switch to thumbnails tab if no outline
	useEffect(() => {
		if (!hasOutline && sidebarTab === "outline") setSidebarTab("thumbnails");
	}, [hasOutline, sidebarTab]);

	// Clear search when query becomes empty
	useEffect(() => {
		if (!searchQuery.trim()) clearSearch();
	}, [clearSearch, searchQuery]);

	// Navigate to search hit when index changes
	useEffect(() => {
		if (!searchHits.length) return;
		const target = searchHits[searchIndex];
		if (!target) return;
		searchPendingHitRef.current = target;
		if (target.pageNumber !== currentPage) scheduleJump(target.pageNumber, 0);
		else scrollToPendingHit(containerRef.current);
	}, [currentPage, scheduleJump, scrollToPendingHit, searchHits, searchIndex, searchPendingHitRef]);

	// Scroll to pending hit after render
	useEffect(() => {
		const frame = requestAnimationFrame(() => scrollToPendingHit(containerRef.current));
		return () => cancelAnimationFrame(frame);
	}, [scrollToPendingHit]);

	// Update active outline ID based on current page
	useEffect(() => {
		if (outlinePageMap.size === 0) {
			setActiveOutlineId(null);
			return;
		}
		let bestId: string | null = null;
		let maxPage = -1;
		for (const [id, page] of outlinePageMap.entries()) {
			if (page <= currentPage && page > maxPage) {
				maxPage = page;
				bestId = id;
			}
		}
		setActiveOutlineId(bestId);
	}, [currentPage, outlinePageMap]);

	// Keyboard shortcuts
	useEffect(() => {
		const handler = (event: KeyboardEvent) => {
			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
				event.preventDefault();
				if (!pdfRef.current) return;
				setIsSearchOpen(true);
				requestAnimationFrame(() => {
					searchInputRef.current?.focus();
					searchInputRef.current?.select();
				});
			} else if (event.key === "Escape") {
				if (isSearchOpen) {
					setIsSearchOpen(false);
					clearSearch();
				}
				if (isSettingsOpen) setIsSettingsOpen(false);
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [clearSearch, isSearchOpen, isSettingsOpen]);

	// Reset state when source changes
	useEffect(() => {
		if (!sourceUrl) {
			setNumPages(0);
			setCurrentPage(1);
			setPageInput("1");
			setOutlineItems([]);
			setHasOutline(false);
			setSelectedOutlineId(null);
			setThumbnailAnchor(null);
			setLoadError(null);
			setIsLoading(false);
			setPdfDoc(null);
			setPageBaseSize(null);
			hadBaseSizeRef.current = false;
			baseSizeRef.current = null;
			pdfRef.current = null;
			clearOutlineCache();
			hadOutlineRef.current = false;
			clearSearch();
			setSearchQuery("");
			setIsSearchOpen(false);
			for (const timer of retryScrollRef.current) window.clearTimeout(timer);
			retryScrollRef.current = [];
			return;
		}
		setIsLoading(true);
		setLoadError(null);
		setNumPages(0);
		setCurrentPage(1);
		setPageInput("1");
		setOutlineItems([]);
		setHasOutline(false);
		setSelectedOutlineId(null);
		clearOutlineCache();
		hadOutlineRef.current = false;
		hadBaseSizeRef.current = false;
		setPdfDoc(null);
		setPageBaseSize(null);
		baseSizeRef.current = null;
		clearSearch();
		setSearchQuery("");
		setIsSearchOpen(false);
		for (const timer of retryScrollRef.current) window.clearTimeout(timer);
		retryScrollRef.current = [];
	}, [clearOutlineCache, clearSearch, sourceUrl]);

	// Load outline when document is ready
	useEffect(() => {
		if (!pdfDoc) return;
		let cancelled = false;
		outlineResolveTokenRef.current += 1;
		const resolveToken = outlineResolveTokenRef.current;
		setOutlinePageMap(new Map());
		setActiveOutlineId(null);

		const loadOutlineTask = async () => {
			try {
				const normalized = await loadOutline(pdfDoc);
				if (cancelled) return;
				setOutlineItems(normalized);
				setHasOutline(normalized.length > 0);
				if (normalized.length > 0 && !hadOutlineRef.current) {
					setSidebarTab("outline");
					hadOutlineRef.current = true;
				}

				// Optimized parallel page resolution
				if (normalized.length > 0) {
					const flat = flattenOutline(normalized);
					const internalItems = flat.filter((item) => !item.url && item.dest);

					const results = await Promise.allSettled(
						internalItems.map(async (item) => {
							const page = await resolveDestPageNumber(pdfDoc, item.dest);
							return page ? { id: item.id, page } : null;
						}),
					);

					if (cancelled || resolveToken !== outlineResolveTokenRef.current) return;

					const map = new Map<string, number>();
					for (const res of results) {
						if (res.status === "fulfilled" && res.value) {
							map.set(res.value.id, res.value.page);
						}
					}
					setOutlinePageMap(map);
				}

				if (normalized.length === 0) hadOutlineRef.current = false;
				clearOutlineCache();
			} catch (error) {
				if (cancelled) return;
				console.warn("Failed to load outline:", error);
				setOutlineItems([]);
				setHasOutline(false);
				hadOutlineRef.current = false;
				clearOutlineCache();
			}
		};
		void loadOutlineTask();
		return () => {
			cancelled = true;
		};
	}, [clearOutlineCache, loadOutline, pdfDoc, resolveDestPageNumber]);

	// Load base page size for scaling calculations
	useEffect(() => {
		if (!pdfDoc) return;
		let cancelled = false;
		const loadBaseSize = async () => {
			try {
				const page = await pdfDoc.getPage(1);
				const viewport = page.getViewport({ scale: 1 });
				const nextSize = { width: viewport.width, height: viewport.height };
				if (cancelled) return;
				baseSizeRef.current = nextSize;
				setPageBaseSize(nextSize);
			} catch (error) {
				if (!cancelled) console.warn("Failed to read base page size:", error);
			}
		};
		void loadBaseSize();
		return () => {
			cancelled = true;
		};
	}, [pdfDoc]);

	// Jump to current page after base size is loaded
	useEffect(() => {
		if (!pageBaseSize) return;
		if (hadBaseSizeRef.current) return;
		hadBaseSizeRef.current = true;
		if (currentPage > 1) scheduleJump(currentPage, 0);
	}, [currentPage, pageBaseSize, scheduleJump]);

	// Container resize observer with scroll position preservation
	useEffect(() => {
		const target = containerRef.current;
		if (!target) return;
		let resizeTimer: number | undefined;
		let prevWidth = target.clientWidth;
		let prevHeight = target.clientHeight;
		// Store scroll ratio before resize
		let scrollRatio = 0;

		const observer = new ResizeObserver(() => {
			if (!target) return;
			const newWidth = target.clientWidth;
			const newHeight = target.clientHeight;
			// Skip if size unchanged
			if (newWidth === prevWidth && newHeight === prevHeight) return;

			// Capture scroll ratio BEFORE updating size
			const scroller = scrollerRef.current;
			if (scroller && scroller.scrollHeight > scroller.clientHeight) {
				scrollRatio = scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight);
			}

			prevWidth = newWidth;
			prevHeight = newHeight;
			setContainerSize({ width: newWidth, height: newHeight });

			// Restore scroll position after resize settles
			window.clearTimeout(resizeTimer);
			resizeTimer = window.setTimeout(() => {
				const scroller = scrollerRef.current;
				if (scroller && scroller.scrollHeight > scroller.clientHeight) {
					const newScrollTop = scrollRatio * (scroller.scrollHeight - scroller.clientHeight);
					scroller.scrollTop = newScrollTop;
				}
			}, 50);
		});
		observer.observe(target);
		return () => {
			observer.disconnect();
			window.clearTimeout(resizeTimer);
		};
	}, []);

	// Group resize observer for sidebar sizing
	useEffect(() => {
		const target = groupRef.current;
		if (!target) return;
		const observer = new ResizeObserver(() => {
			if (!target) return;
			setGroupWidth(target.clientWidth);
		});
		observer.observe(target);
		return () => observer.disconnect();
	}, []);

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			for (const timer of retryScrollRef.current) window.clearTimeout(timer);
			retryScrollRef.current = [];
		};
	}, []);

	// -------------------------------------------------------------------------
	// Render
	// -------------------------------------------------------------------------

	return (
		<Group
			orientation="horizontal"
			className="h-full bg-transparent"
			id="pdf-viewer"
			defaultLayout={groupDefaultLayout}
			elementRef={groupRef}
		>
			{/* Sidebar Panel */}
			{showSidebar && numPages > 0 && (
				<>
					<Panel
						id="sidebar-panel"
						defaultSize={sidebarSizes.defaultPercent}
						minSize={sidebarSizes.minPercent}
						className="z-10 flex flex-col border-r border-border/70 bg-card/85 backdrop-blur-sm"
					>
						<PdfSidebar
							sidebarTab={sidebarTab}
							onTabChange={setSidebarTab}
							hasOutline={hasOutline}
							outlineItems={outlineItems}
							selectedOutlineId={selectedOutlineId}
							activeOutlineId={activeOutlineId}
							onOutlineClick={(item) => void handleOutlineClick(item)}
							onOutlineSelectRange={(item) => void handleOutlineSelectRange(item)}
							numPages={numPages}
							pdfDoc={pdfDoc}
							currentPage={currentPage}
							pageRange={pageRange}
							fileKey={fileKey}
							onThumbnailSelect={handleThumbnailSelect}
							sidebarSizes={sidebarSizes}
							onClose={() => setShowSidebar(false)}
						/>
					</Panel>
					<Separator className="z-50 -ml-1 flex w-2 cursor-col-resize justify-center bg-transparent transition-colors hover:bg-primary/10">
						<div className="w-px h-full bg-border/50" />
					</Separator>
				</>
			)}

			{/* Viewer Panel */}
			<Panel id="viewer-panel" minSize={VIEWER_MIN_SIZE} className="relative flex flex-col bg-transparent">
				{/* Floating Toolbar */}
				{numPages > 0 && (
					<PdfToolbar
						currentPage={currentPage}
						numPages={numPages}
						pageInput={pageInput}
						onPageInputChange={setPageInput}
						onPageInputCommit={handlePageInputCommit}
						onPageStep={handlePageStep}
						effectiveScale={effectiveScale}
						fitMode={fitMode}
						onZoomIn={handleZoomIn}
						onZoomOut={handleZoomOut}
						onToggleFit={handleToggleFit}
						rangeInput={rangeInput}
						localAutoFollow={localAutoFollow}
						contextWindowSize={contextWindowSize}
						onRangeStartChange={handleRangeStartChange}
						onRangeEndChange={handleRangeEndChange}
						onRangeStartCommit={commitRangeStart}
						onRangeEndCommit={commitRangeEnd}
						onAutoFollowToggle={handleAutoFollowToggle}
						onContextWindowChange={handleContextWindowChange}
						isSearchOpen={isSearchOpen}
						searchQuery={searchQuery}
						searchHits={searchHits}
						searchIndex={searchIndex}
						isSearching={isSearching}
						searchInputRef={searchInputRef}
						onSearchToggle={handleToggleSearch}
						onSearchQueryChange={setSearchQuery}
						onSearchSubmit={handleSearchSubmit}
						onSearchPrev={handleSearchPrev}
						onSearchNext={handleSearchNext}
						isSettingsOpen={isSettingsOpen}
						onSettingsToggle={handleToggleSettings}
						showSidebar={showSidebar}
						onShowSidebar={() => setShowSidebar(true)}
						onRequestOpenFile={onRequestOpenFile}
					/>
				)}

				{/* PDF Viewer Area */}
				<div className="flex-1 relative w-full h-full overflow-hidden">
					<div ref={containerRef} className="absolute inset-0 overflow-hidden pdfViewerContainer">
						{sourceUrl ? (
							<div className="h-full w-full">
								<Document
									file={sourceUrl}
									options={documentOptions}
									onLoadSuccess={handleDocumentLoadSuccess}
									onLoadError={handleDocumentLoadError}
									onItemClick={(event) => {
										if (event?.pageNumber) scheduleJump(event.pageNumber, 0);
									}}
									loading={null}
									error={null}
									noData={null}
									className="h-full w-full flex flex-col"
								>
									<Virtuoso
										key={fileKey}
										ref={viewerRef}
										scrollerRef={(ref) => {
											scrollerRef.current = ref as HTMLElement | null;
										}}
										style={{ height: "100%", width: "100%" }}
										totalCount={numPages}
										initialTopMostItemIndex={Math.max(0, (initialPage ?? 1) - 1)}
										rangeChanged={handleRangeChanged}
										defaultItemHeight={pageRenderSize ? pageRenderSize.height + PAGE_GAP : 800}
										increaseViewportBy={pageRenderSize ? pageRenderSize.height * VIEWPORT_BUFFER_PAGES : 1600}
										components={{
											Header: () => <div style={{ height: 72 }} />,
											Footer: () => <div style={{ height: 24 }} />,
										}}
										itemContent={(index) => {
											const pageNumber = index + 1;
											const isInContext = pageNumber >= pageRange.start && pageNumber <= pageRange.end;

											// Reset hit counter for search highlight tracking
											if (activeQuery) resetPageHitCounter(pageNumber);
											return (
												<div
													className="pdf-page-wrapper relative px-3 md:px-4"
													style={pageRenderSize ? { height: pageRenderSize.height + PAGE_GAP } : undefined}
												>
													<div
														className={cn(
															"pdf-page relative transition-[box-shadow,border-color,transform] duration-200",
															isInContext
																? "ring-1 ring-primary/35 border-primary/30 shadow-xl"
																: "border-border/70 shadow-lg hover:shadow-xl",
														)}
													>
														<Page
															pageNumber={pageNumber}
															scale={effectiveScale}
															renderTextLayer
															renderAnnotationLayer
															onLoadSuccess={handlePageLoadSuccess}
															customTextRenderer={
																activeQuery
																	? makeTextRenderer(pageNumber, activeQuery, searchHits, searchIndex)
																	: undefined
															}
															devicePixelRatio={typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1}
															loading={
																<div className="h-full w-full bg-muted/10 animate-pulse flex items-center justify-center">
																	<div className="flex flex-col items-center gap-2 opacity-20">
																		<FileText className="h-10 w-10" aria-hidden="true" />
																		<span className="text-xs">Loading Page {pageNumber}…</span>
																	</div>
																</div>
															}
														/>
													</div>
													<div style={{ height: PAGE_GAP }} />
												</div>
											);
										}}
									/>
								</Document>
								{onTextSelect && (
									<TextSelectionPopup
										containerRef={containerRef}
										onAddSelection={onTextSelect}
										onExplainSelection={onExplainText}
										maxLength={2000}
									/>
								)}
							</div>
						) : (
							/* Empty State */
							<div className="flex h-full flex-col items-center justify-center gap-5 p-6 text-sm text-muted-foreground animate-in fade-in duration-500">
								<div className="surface-panel flex max-w-md flex-col items-center gap-4 px-8 py-10 text-center">
									<div className="rounded-2xl bg-muted/70 p-4 text-muted-foreground">
										<FileText className="h-10 w-10 opacity-75" aria-hidden="true" />
									</div>
									<div className="space-y-2">
										<p className="text-base font-semibold text-foreground">Open a PDF to start reading</p>
										<p className="max-w-xs text-sm text-muted-foreground">
											Use the left canvas for focused reading and the right panel for quick AI analysis.
										</p>
									</div>
									<Button onClick={onRequestOpenFile} className="rounded-full px-5">
										Open Document
									</Button>
								</div>
							</div>
						)}

						{/* Loading Overlay */}
						{isLoading && (
							<div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[2px] z-50 animate-in fade-in duration-300">
								<div className="flex flex-col items-center gap-4 p-6 rounded-2xl bg-card/80 shadow-xl border border-white/10">
									<div className="h-12 w-12 animate-spin rounded-full border-[3px] border-primary border-t-transparent shadow-sm" />
									<span className="text-sm font-medium animate-pulse">Loading Document…</span>
								</div>
							</div>
						)}

						{/* Error Overlay */}
						{loadError && (
							<div className="absolute inset-0 flex items-center justify-center bg-background/80 z-50 animate-in fade-in zoom-in-95 duration-300">
								<div className="bg-destructive/5 text-destructive border border-destructive/10 p-8 rounded-2xl shadow-2xl flex flex-col items-center gap-3 max-w-md text-center backdrop-blur-md">
									<div className="p-3 rounded-full bg-destructive/10 mb-2">
										<X className="h-8 w-8" aria-hidden="true" />
									</div>
									<p className="font-semibold text-lg">Unable to load document</p>
									<p className="text-sm opacity-80 leading-relaxed">{loadError}</p>
									<Button
										variant="outline"
										className="mt-4 border-destructive/20 hover:bg-destructive/10"
										onClick={onRequestOpenFile}
									>
										Try another file
									</Button>
								</div>
							</div>
						)}
					</div>
				</div>
			</Panel>
		</Group>
	);
}

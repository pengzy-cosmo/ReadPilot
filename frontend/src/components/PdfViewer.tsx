/** PdfViewer - Main PDF viewer with sidebar, toolbar, search, and AI context range. */
import { FileText, X } from "lucide-react";
import type {
	DocumentInitParameters,
	PDFDocumentProxy,
	PDFPageProxy,
	RefProxy,
} from "pdfjs-dist/types/src/display/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import { type OutlineNode, PdfSidebar } from "@/components/PdfSidebar";
import { PdfToolbar } from "@/components/PdfToolbar";
import { TextSelectionPopup } from "@/components/TextSelectionPopup";
import { Button } from "@/components/ui/button";
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
	autoFollow?: boolean;
	contextWindow?: number;
}

type OutlineNodeInput = {
	title: string;
	dest: unknown;
	url?: string | null;
	items?: OutlineNodeInput[];
};

type OutlineFlatItem = {
	id: string;
	title: string;
	dest: unknown;
	url?: string | null;
	level: number;
};

type FitMode = "page-width" | "page-fit";
type PageSize = { width: number; height: number };
type ScrollBehaviorOption = "auto" | "smooth";

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

/** Type guard for PDF.js RefProxy objects (internal page references). */
const isRefProxyValue = (value: unknown): value is RefProxy => {
	if (!value || typeof value !== "object") return false;
	const ref = value as { num?: unknown; gen?: unknown };
	return typeof ref.num === "number" && typeof ref.gen === "number";
};

/** Assign unique IDs to outline nodes for React keys and selection tracking. */
const assignOutlineIds = (items: OutlineNodeInput[], prefix = "outline"): OutlineNode[] =>
	items.map((item, index) => {
		const id = `${prefix}-${index}`;
		return {
			title: item.title,
			dest: item.dest,
			url: item.url,
			id,
			items: item.items ? assignOutlineIds(item.items, id) : undefined,
		};
	});

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

/** Normalize PDF document from react-pdf load callback. */
const normalizePdfFromLoad = (value: PDFDocumentProxy | { pdf?: PDFDocumentProxy }): PDFDocumentProxy => {
	if (value && typeof value === "object" && "pdf" in value && (value as { pdf?: PDFDocumentProxy }).pdf) {
		return (value as { pdf: PDFDocumentProxy }).pdf;
	}
	return value as PDFDocumentProxy;
};

/** Escape HTML special characters for safe innerHTML rendering. */
const escapeHtml = (value: string) => {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
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
	autoFollow = true,
	contextWindow = 3,
}: PdfViewerProps) {
	// -------------------------------------------------------------------------
	// State
	// -------------------------------------------------------------------------

	// Document state
	const [numPages, setNumPages] = useState(0);
	const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
	const [pageBaseSize, setPageBaseSize] = useState<PageSize | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);

	// Navigation state
	const [currentPage, setCurrentPage] = useState(1);
	const [pageInput, setPageInput] = useState("1");

	// Sidebar state
	const [showSidebar, setShowSidebar] = useState(true);
	const [sidebarTab, setSidebarTab] = useState<"outline" | "thumbnails">("outline");
	const [hasOutline, setHasOutline] = useState(false);
	const [outlineItems, setOutlineItems] = useState<OutlineNode[]>([]);
	const [selectedOutlineId, setSelectedOutlineId] = useState<string | null>(null);
	const [activeOutlineId, setActiveOutlineId] = useState<string | null>(null);
	const [outlinePageMap, setOutlinePageMap] = useState<Map<string, number>>(new Map());
	const [thumbnailAnchor, setThumbnailAnchor] = useState<number | null>(null);

	// Zoom state
	const [fitMode, setFitMode] = useState<FitMode>("page-width");
	const [userScale, setUserScale] = useState(1);

	// AI context range state
	const [localAutoFollow, setLocalAutoFollow] = useState(autoFollow);
	const [contextWindowSize, setContextWindowSize] = useState(contextWindow);
	const [rangeInput, setRangeInput] = useState({ start: "1", end: "1" });

	// Search state
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [activeQuery, setActiveQuery] = useState("");
	const [searchHits, setSearchHits] = useState<{ pageNumber: number; hitIndex: number }[]>([]);
	const [searchIndex, setSearchIndex] = useState(0);
	const [isSearching, setIsSearching] = useState(false);

	// Settings popup state
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);

	// Container sizing state
	const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
	const [groupWidth, setGroupWidth] = useState(0);

	// -------------------------------------------------------------------------
	// Refs
	// -------------------------------------------------------------------------

	const containerRef = useRef<HTMLDivElement | null>(null);
	const groupRef = useRef<HTMLDivElement | null>(null);
	const viewerRef = useRef<VirtuosoHandle | null>(null);
	const searchInputRef = useRef<HTMLInputElement | null>(null);
	const pdfRef = useRef<PDFDocumentProxy | null>(null);
	const baseSizeRef = useRef<PageSize | null>(null);
	const currentPageRef = useRef(1);
	const initialPageRef = useRef<number | null>(initialPage ?? null);

	// Caches for performance
	const outlinePageCacheRef = useRef<Map<string, number>>(new Map());
	const textCacheRef = useRef<Map<number, string[]>>(new Map());
	const pageHitCounterRef = useRef<Map<number, number>>(new Map());

	// State tracking refs
	const hadOutlineRef = useRef(false);
	const hadBaseSizeRef = useRef(false);
	const retryScrollRef = useRef<number[]>([]);
	const searchAbortRef = useRef<{ canceled: boolean } | null>(null);
	const pendingHitRef = useRef<{ pageNumber: number; hitIndex: number } | null>(null);
	const pendingScrollPageRef = useRef<number | null>(null);

	// -------------------------------------------------------------------------
	// Computed Values
	// -------------------------------------------------------------------------

	const fileKey = useMemo(() => sourceUrl ?? "empty", [sourceUrl]);
	const activeHit = searchHits[searchIndex];

	/** Calculate sidebar panel size percentages based on container width. */
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

	/** Layout for react-resizable-panels Group component. */
	const groupDefaultLayout = useMemo((): Record<string, number> => {
		if (!showSidebar || numPages <= 0) return { "viewer-panel": 100 };
		return {
			"sidebar-panel": sidebarSizes.defaultPercent,
			"viewer-panel": 100 - sidebarSizes.defaultPercent,
		};
	}, [numPages, showSidebar, sidebarSizes.defaultPercent]);

	/** PDF.js document loading options - load assets from CDN. */
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

	const availableWidth = useMemo(() => Math.max(0, containerSize.width - VIEWER_PADDING), [containerSize.width]);
	const availableHeight = useMemo(() => Math.max(0, containerSize.height - VIEWER_PADDING), [containerSize.height]);

	/** Calculate scale to fit page in viewport based on fit mode. */
	const fitScale = useMemo(() => {
		if (!pageBaseSize || !availableWidth || !availableHeight) return 1;
		const widthScale = availableWidth / pageBaseSize.width;
		if (fitMode === "page-width") return widthScale;
		const heightScale = availableHeight / pageBaseSize.height;
		return Math.min(widthScale, heightScale);
	}, [availableHeight, availableWidth, fitMode, pageBaseSize]);

	const effectiveScale = Math.max(0.1, fitScale * userScale);

	/** Calculated page dimensions at current scale. */
	const pageRenderSize = useMemo(() => {
		if (!pageBaseSize) return null;
		return { width: pageBaseSize.width * effectiveScale, height: pageBaseSize.height * effectiveScale };
	}, [pageBaseSize, effectiveScale]);

	// -------------------------------------------------------------------------
	// Scroll Helpers
	// -------------------------------------------------------------------------

	const scrollToPage = useCallback(
		(pageNumber: number, options?: { behavior?: ScrollBehaviorOption; offset?: number }) => {
			viewerRef.current?.scrollToIndex({
				index: pageNumber - 1,
				align: "start",
				behavior: options?.behavior ?? "smooth",
				offset: options?.offset ?? 0,
			});
		},
		[],
	);

	/**
	 * Schedule a jump to a page with retry mechanism.
	 * Retries needed because virtualized list may not have rendered target page yet.
	 */
	const scheduleJump = useCallback(
		(pageNumber: number, offset = 0) => {
			pendingScrollPageRef.current = pageNumber;
			retryScrollRef.current.forEach((timer) => {
				window.clearTimeout(timer);
			});
			retryScrollRef.current = [];
			scrollToPage(pageNumber, { behavior: "auto", offset });
			retryScrollRef.current.push(window.setTimeout(() => scrollToPage(pageNumber, { behavior: "auto", offset }), 120));
			retryScrollRef.current.push(window.setTimeout(() => scrollToPage(pageNumber, { behavior: "auto", offset }), 420));
		},
		[scrollToPage],
	);

	const clearScrollRetries = useCallback(() => {
		retryScrollRef.current.forEach((timer) => {
			window.clearTimeout(timer);
		});
		retryScrollRef.current = [];
	}, []);

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
	// Search Logic
	// -------------------------------------------------------------------------

	const clearSearch = useCallback(() => {
		if (searchAbortRef.current) {
			searchAbortRef.current.canceled = true;
			searchAbortRef.current = null;
		}
		setIsSearching(false);
		setSearchHits([]);
		setSearchIndex(0);
		setActiveQuery("");
		pendingHitRef.current = null;
	}, []);

	const resetSearchUi = useCallback(() => {
		clearSearch();
		setSearchQuery("");
		setIsSearchOpen(false);
	}, [clearSearch]);

	/** Get next hit index for a page (used to track which match on a page). */
	const getNextHitIndex = useCallback((pageNumber: number) => {
		const current = pageHitCounterRef.current.get(pageNumber) ?? 0;
		const next = current + 1;
		pageHitCounterRef.current.set(pageNumber, next);
		return next;
	}, []);

	/**
	 * Custom text renderer for search highlighting.
	 * Wraps matched text in <mark> elements with data attributes for navigation.
	 */
	const makeTextRenderer = useCallback(
		(pageNumber: number) => {
			return ({ str }: { str: string }) => {
				if (!activeQuery) return escapeHtml(str);
				const escapedQuery = activeQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
				const regex = new RegExp(escapedQuery, "gi");
				const parts = str.split(regex);
				const matches = str.match(regex);
				if (!matches) return escapeHtml(str);
				let result = "";
				parts.forEach((part, index) => {
					result += escapeHtml(part);
					if (matches[index]) {
						const hitIndex = getNextHitIndex(pageNumber);
						const isActive = activeHit && activeHit.pageNumber === pageNumber && activeHit.hitIndex === hitIndex;
						const className = isActive ? "pdf-search-hit pdf-search-hit--active" : "pdf-search-hit";
						result += `<mark class="${className}" data-page="${pageNumber}" data-hit="${hitIndex}">${escapeHtml(matches[index])}</mark>`;
					}
				});
				return result;
			};
		},
		[activeHit, activeQuery, getNextHitIndex],
	);

	/** Scan a single page for text matches. */
	const scanPageForMatches = useCallback(
		async (
			pdf: PDFDocumentProxy,
			pageNumber: number,
			regex: RegExp,
		): Promise<{ pageNumber: number; hitIndex: number }[]> => {
			let parts = textCacheRef.current.get(pageNumber);
			if (!parts) {
				const page = await pdf.getPage(pageNumber);
				const textContent = await page.getTextContent();
				const rawItems = Array.isArray(textContent.items) ? textContent.items : [];
				const strings = rawItems.map((item) =>
					typeof (item as { str?: string }).str === "string" ? (item as { str: string }).str : "",
				);
				textCacheRef.current.set(pageNumber, strings);
				parts = strings;
			}
			const hits: { pageNumber: number; hitIndex: number }[] = [];
			let hitCount = 0;
			for (const part of parts) {
				if (!part) continue;
				regex.lastIndex = 0;
				while (regex.exec(part) !== null) {
					hitCount += 1;
					hits.push({ pageNumber, hitIndex: hitCount });
				}
			}
			return hits;
		},
		[],
	);

	/**
	 * Run full-text search across all pages.
	 * Searches downward from current page first for better UX,
	 * then wraps around to pages before current page.
	 */
	const runSearch = useCallback(
		async (query: string) => {
			const pdf = pdfRef.current;
			const trimmed = query.trim();
			if (!pdf || !trimmed) {
				clearSearch();
				return;
			}
			// If same query and results exist, just jump to current hit
			if (trimmed === activeQuery && searchHits.length > 0 && !isSearching) {
				const nextHit = searchHits[searchIndex];
				if (nextHit) scheduleJump(nextHit.pageNumber, 0);
				return;
			}

			// Cancel any ongoing search
			if (searchAbortRef.current) searchAbortRef.current.canceled = true;
			const token = { canceled: false };
			searchAbortRef.current = token;

			setIsSearching(true);
			setSearchHits([]);
			setSearchIndex(0);
			setActiveQuery(trimmed);

			const total = pdf.numPages;
			const startPage = currentPageRef.current;
			const escapedQuery = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const regex = new RegExp(escapedQuery, "gi");

			// Results from current page to end (forward matches)
			const forwardMatches: { pageNumber: number; hitIndex: number }[] = [];
			// Results from page 1 to current page - 1 (wrapped matches)
			const wrappedMatches: { pageNumber: number; hitIndex: number }[] = [];

			let firstMatchShown = false;

			// Phase 1: Search from current page to end
			for (let pageNumber = startPage; pageNumber <= total; pageNumber += 1) {
				if (token.canceled) return;
				const pageHits = await scanPageForMatches(pdf, pageNumber, regex);
				if (token.canceled) return;
				if (pageHits.length > 0) {
					forwardMatches.push(...pageHits);
					// Show first match immediately for responsive feedback
					if (!firstMatchShown) {
						firstMatchShown = true;
						setSearchHits([...forwardMatches]);
						setSearchIndex(0);
						scheduleJump(pageHits[0].pageNumber, 0);
					}
				}
				// Yield to UI every 4 pages
				if (pageNumber % 4 === 0) {
					await new Promise((resolve) => setTimeout(resolve, 0));
					if (token.canceled) return;
				}
			}

			// Phase 2: Search from page 1 to current page - 1 (wrap around)
			for (let pageNumber = 1; pageNumber < startPage; pageNumber += 1) {
				if (token.canceled) return;
				const pageHits = await scanPageForMatches(pdf, pageNumber, regex);
				if (token.canceled) return;
				if (pageHits.length > 0) {
					wrappedMatches.push(...pageHits);
					if (!firstMatchShown) {
						firstMatchShown = true;
						setSearchHits([...wrappedMatches]);
						setSearchIndex(0);
						scheduleJump(pageHits[0].pageNumber, 0);
					}
				}
				if (pageNumber % 4 === 0) {
					await new Promise((resolve) => setTimeout(resolve, 0));
					if (token.canceled) return;
				}
			}

			if (token.canceled) return;

			// Combine: forward matches first, then wrapped
			const allMatches = [...forwardMatches, ...wrappedMatches];
			setSearchHits(allMatches);
			setIsSearching(false);
			if (allMatches.length > 0) setSearchIndex(0);
		},
		[activeQuery, clearSearch, isSearching, scanPageForMatches, scheduleJump, searchHits, searchIndex],
	);

	const handleSearchPrev = useCallback(() => {
		if (!searchHits.length) return;
		const nextIndex = (searchIndex - 1 + searchHits.length) % searchHits.length;
		setSearchIndex(nextIndex);
	}, [searchHits, searchIndex]);

	const handleSearchNext = useCallback(() => {
		if (!searchHits.length) return;
		const nextIndex = (searchIndex + 1) % searchHits.length;
		setSearchIndex(nextIndex);
	}, [searchHits, searchIndex]);

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
		void runSearch(trimmed);
	}, [activeQuery, clearSearch, handleSearchNext, isSearching, runSearch, searchHits.length, searchQuery]);

	const handleToggleSearch = useCallback(() => {
		setIsSearchOpen((prev) => {
			const next = !prev;
			if (next) {
				requestAnimationFrame(() => {
					searchInputRef.current?.focus();
					searchInputRef.current?.select();
				});
			} else {
				// Clear highlights when closing search
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

	/** Scroll to pending search hit element after render. */
	const scrollToPendingHit = useCallback(() => {
		const pending = pendingHitRef.current;
		if (!pending) return;
		const container = containerRef.current;
		if (!container) return;
		const selector = `.pdf-search-hit[data-page="${pending.pageNumber}"][data-hit="${pending.hitIndex}"]`;
		const mark = container.querySelector(selector);
		if (mark) {
			pendingHitRef.current = null;
			mark.scrollIntoView({ block: "start", inline: "nearest" });
		}
	}, []);

	// -------------------------------------------------------------------------
	// Outline Handlers
	// -------------------------------------------------------------------------

	/** Resolve PDF destination to page number. */
	const resolveDestPageNumber = useCallback(async (dest: unknown) => {
		const pdf = pdfRef.current;
		if (!pdf || !dest) return null;
		try {
			let destination: unknown = dest;
			if (typeof destination === "string") destination = await pdf.getDestination(destination);
			if (!Array.isArray(destination) || destination.length === 0) return null;
			const [ref] = destination as unknown[];
			if (typeof ref === "number") return ref + 1;
			if (!isRefProxyValue(ref)) return null;
			const pageIndex = await pdf.getPageIndex(ref);
			return pageIndex + 1;
		} catch (error) {
			console.warn("Failed to resolve outline page number:", error);
			return null;
		}
	}, []);

	/** Get flattened outline with resolved page numbers for range calculation. */
	const getOutlineFlatWithPages = useCallback(async () => {
		const flat = flattenOutline(outlineItems);
		const resolved: (OutlineFlatItem & { pageNumber: number | null })[] = [];
		for (const item of flat) {
			if (item.url) {
				resolved.push({ ...item, pageNumber: null });
				continue;
			}
			let pageNumber = outlinePageCacheRef.current.get(item.id) ?? null;
			if (!pageNumber) {
				pageNumber = await resolveDestPageNumber(item.dest);
				if (pageNumber) outlinePageCacheRef.current.set(item.id, pageNumber);
			}
			resolved.push({ ...item, pageNumber });
		}
		return resolved;
	}, [outlineItems, resolveDestPageNumber]);

	/** Resolve all outline items to page numbers for active highlighting. */
	const resolveAllOutlinePages = useCallback(
		async (items: OutlineNode[]) => {
			const flat = flattenOutline(items);
			const map = new Map<string, number>();
			for (const item of flat) {
				const page = await resolveDestPageNumber(item.dest);
				if (page) map.set(item.id, page);
			}
			setOutlinePageMap(map);
		},
		[resolveDestPageNumber],
	);

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

	/** Handle outline item click - navigate to page with optional Y offset. */
	const handleOutlineClick = useCallback(
		async (item: OutlineNode) => {
			if (item.url) {
				window.open(item.url, "_blank", "noopener,noreferrer");
				return;
			}
			const pdf = pdfRef.current;
			if (!pdf || !item.dest) return;

			try {
				let destination: unknown = item.dest;
				if (typeof destination === "string") destination = await pdf.getDestination(destination);
				if (!Array.isArray(destination) || destination.length === 0) return;
				const [ref] = destination as unknown[];
				let pageNumber: number | null = null;
				if (typeof ref === "number") pageNumber = ref + 1;
				else if (isRefProxyValue(ref)) {
					const pageIndex = await pdf.getPageIndex(ref);
					pageNumber = pageIndex + 1;
				}
				if (!pageNumber) return;

				// Calculate Y offset from destination parameters
				let offset = 0;
				const destType = (destination as unknown[])[1];
				const destName =
					typeof destType === "string"
						? destType
						: destType && typeof destType === "object" && "name" in (destType as { name?: string })
							? (destType as { name?: string }).name
							: null;
				if (destName) {
					const page = await pdf.getPage(pageNumber);
					const viewport = page.getViewport({ scale: effectiveScale });
					let top: number | null = null;
					const args = destination as unknown[];
					if (destName === "XYZ") {
						const value = args[3];
						if (typeof value === "number") top = value;
					} else if (destName === "FitH" || destName === "FitBH") {
						const value = args[2];
						if (typeof value === "number") top = value;
					} else if (destName === "FitR") {
						const value = args[5];
						if (typeof value === "number") top = value;
					}
					if (typeof top === "number") {
						const [, y] = viewport.convertToViewportPoint(0, top);
						offset = Math.max(0, Math.min(y, viewport.height - 1));
					}
				}
				scheduleJump(pageNumber, offset);
			} catch (error) {
				console.warn("Failed to resolve outline destination:", error);
			}
		},
		[effectiveScale, scheduleJump],
	);

	/** Select page range based on outline section (from heading to next same-level heading). */
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

	useEffect(() => setContextWindowSize(contextWindow), [contextWindow]);

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
		pendingHitRef.current = target;
		if (target.pageNumber !== currentPage) scheduleJump(target.pageNumber, 0);
		else scrollToPendingHit();
	}, [currentPage, scheduleJump, scrollToPendingHit, searchHits, searchIndex]);

	// Scroll to pending hit after render
	useEffect(() => {
		const frame = requestAnimationFrame(() => scrollToPendingHit());
		return () => cancelAnimationFrame(frame);
	}, [scrollToPendingHit]);

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
			outlinePageCacheRef.current.clear();
			hadOutlineRef.current = false;
			textCacheRef.current.clear();
			resetSearchUi();
			clearScrollRetries();
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
		outlinePageCacheRef.current.clear();
		hadOutlineRef.current = false;
		hadBaseSizeRef.current = false;
		setPdfDoc(null);
		setPageBaseSize(null);
		baseSizeRef.current = null;
		textCacheRef.current.clear();
		resetSearchUi();
		clearScrollRetries();
	}, [clearScrollRetries, resetSearchUi, sourceUrl]);

	// Load outline when document is ready
	useEffect(() => {
		if (!pdfDoc) return;
		let cancelled = false;
		const loadOutline = async () => {
			try {
				const outline = await pdfDoc.getOutline();
				if (cancelled) return;
				const normalized = assignOutlineIds((outline ?? []) as OutlineNodeInput[]);
				setOutlineItems(normalized);
				setHasOutline(normalized.length > 0);
				if (normalized.length > 0 && !hadOutlineRef.current) {
					setSidebarTab("outline");
					hadOutlineRef.current = true;
				}
				if (normalized.length > 0) void resolveAllOutlinePages(normalized);
				if (normalized.length === 0) hadOutlineRef.current = false;
				outlinePageCacheRef.current.clear();
			} catch (error) {
				if (cancelled) return;
				console.warn("Failed to load outline:", error);
				setOutlineItems([]);
				setHasOutline(false);
				hadOutlineRef.current = false;
				outlinePageCacheRef.current.clear();
			}
		};
		void loadOutline();
		return () => {
			cancelled = true;
		};
	}, [pdfDoc, resolveAllOutlinePages]);

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

	// Container resize observer
	useEffect(() => {
		const target = containerRef.current;
		if (!target) return;
		const observer = new ResizeObserver(() => {
			if (!target) return;
			setContainerSize({ width: target.clientWidth, height: target.clientHeight });
		});
		observer.observe(target);
		return () => observer.disconnect();
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
			clearScrollRetries();
			if (searchAbortRef.current) {
				searchAbortRef.current.canceled = true;
				searchAbortRef.current = null;
			}
		};
	}, [clearScrollRetries]);

	// -------------------------------------------------------------------------
	// Render
	// -------------------------------------------------------------------------

	return (
		<Group
			orientation="horizontal"
			className="h-full bg-muted/5"
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
						className="flex flex-col bg-background border-r z-10 shadow-sm"
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
					<Separator className="w-2 -ml-1 bg-transparent hover:bg-primary/10 transition-colors cursor-col-resize z-50 flex justify-center">
						<div className="w-px h-full bg-border/50" />
					</Separator>
				</>
			)}

			{/* Viewer Panel */}
			<Panel id="viewer-panel" minSize={VIEWER_MIN_SIZE} className="relative flex flex-col bg-muted/30">
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
										style={{ height: "100%", width: "100%" }}
										totalCount={numPages}
										initialTopMostItemIndex={Math.max(0, (initialPage ?? 1) - 1)}
										rangeChanged={handleRangeChanged}
										defaultItemHeight={pageRenderSize ? pageRenderSize.height + PAGE_GAP : 800}
										increaseViewportBy={pageRenderSize ? pageRenderSize.height * VIEWPORT_BUFFER_PAGES : 1600}
										components={{
											Header: () => <div style={{ height: 90 }} />,
											Footer: () => <div style={{ height: 40 }} />,
										}}
										itemContent={(index) => {
											const pageNumber = index + 1;
											const isInContext = pageNumber >= pageRange.start && pageNumber <= pageRange.end;

											// Reset hit counter for search highlight tracking
											if (activeQuery) pageHitCounterRef.current.set(pageNumber, 0);
											return (
												<div
													className="pdf-page-wrapper relative"
													style={pageRenderSize ? { height: pageRenderSize.height + PAGE_GAP } : undefined}
												>
													<div
														className={cn(
															"pdf-page transition-all duration-300 relative",
															isInContext ? "ring-1 ring-primary/30 shadow-lg" : "shadow-md hover:shadow-lg",
														)}
													>
														<Page
															pageNumber={pageNumber}
															scale={effectiveScale}
															renderTextLayer
															renderAnnotationLayer
															onLoadSuccess={handlePageLoadSuccess}
															customTextRenderer={activeQuery ? makeTextRenderer(pageNumber) : undefined}
															devicePixelRatio={typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1}
															loading={
																<div className="h-full w-full bg-muted/10 animate-pulse flex items-center justify-center">
																	<div className="flex flex-col items-center gap-2 opacity-20">
																		<FileText className="h-10 w-10" />
																		<span className="text-xs">Loading Page {pageNumber}</span>
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
							<div className="flex flex-col h-full items-center justify-center text-sm text-muted-foreground gap-6 animate-in fade-in duration-500">
								<div className="p-8 rounded-full bg-muted/30 border border-border/50 shadow-sm">
									<FileText className="h-16 w-16 opacity-10" />
								</div>
								<div className="text-center space-y-2">
									<p className="text-lg font-medium text-foreground">No Document Loaded</p>
									<p className="max-w-xs mx-auto opacity-70">
										Upload a PDF to start reading and chatting with your personal AI assistant.
									</p>
								</div>
								<Button onClick={onRequestOpenFile} className="mt-4 shadow-lg shadow-primary/20">
									Open Document
								</Button>
							</div>
						)}

						{/* Loading Overlay */}
						{isLoading && (
							<div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[2px] z-50 animate-in fade-in duration-300">
								<div className="flex flex-col items-center gap-4 p-6 rounded-2xl bg-card/80 shadow-xl border border-white/10">
									<div className="h-12 w-12 animate-spin rounded-full border-[3px] border-primary border-t-transparent shadow-sm" />
									<span className="text-sm font-medium animate-pulse">Loading Document...</span>
								</div>
							</div>
						)}

						{/* Error Overlay */}
						{loadError && (
							<div className="absolute inset-0 flex items-center justify-center bg-background/80 z-50 animate-in fade-in zoom-in-95 duration-300">
								<div className="bg-destructive/5 text-destructive border border-destructive/10 p-8 rounded-2xl shadow-2xl flex flex-col items-center gap-3 max-w-md text-center backdrop-blur-md">
									<div className="p-3 rounded-full bg-destructive/10 mb-2">
										<X className="h-8 w-8" />
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

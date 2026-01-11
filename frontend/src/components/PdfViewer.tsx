import {
	BrainCircuit,
	ChevronLeft,
	ChevronRight,
	FileText,
	Maximize,
	Menu,
	Minimize,
	PanelLeft,
	RefreshCw,
	Search,
	Settings2,
	X,
	ZoomIn,
	ZoomOut,
} from "lucide-react";
import type {
	DocumentInitParameters,
	PDFDocumentProxy,
	PDFPageProxy,
	RefProxy,
} from "pdfjs-dist/types/src/display/api";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs, Thumbnail } from "react-pdf";

import { Group, Panel, Separator } from "react-resizable-panels";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PDFJS_VERSION = (pdfjs as unknown as { version?: string }).version ?? "5.4.296";
const PDFJS_CDN_BASE = `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/`;

// Load worker + assets from CDN to avoid bundling heavy PDF.js files.
pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN_BASE}build/pdf.worker.min.mjs`;

interface PdfViewerProps {
	sourceUrl: string | null;
	onRequestOpenFile: () => void;
	pageRange: { start: number; end: number };
	onPageRangeChange: (range: { start: number; end: number }) => void;
	onCurrentPageChange?: (page: number) => void;
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

type OutlineNode = {
	id: string;
	title: string;
	dest: unknown;
	url?: string | null;
	items?: OutlineNode[];
};

type OutlineFlatItem = {
	id: string;
	title: string;
	dest: unknown;
	url?: string | null;
	level: number;
};

type FitMode = "page-width" | "page-fit";

type ThumbnailItemProps = {
	pageNumber: number;
	pdf: PDFDocumentProxy | null;
	isSelected: boolean;
	isCurrent: boolean;
	onSelect: (pageNumber: number, isRange: boolean) => void;
};

type PageSize = {
	width: number;
	height: number;
};

type ScrollBehaviorOption = "auto" | "smooth";

const THUMBNAIL_TARGET_WIDTH = 120;
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

const isRefProxyValue = (value: unknown): value is RefProxy => {
	if (!value || typeof value !== "object") return false;
	const ref = value as { num?: unknown; gen?: unknown };
	return typeof ref.num === "number" && typeof ref.gen === "number";
};

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

const normalizePdfFromLoad = (value: PDFDocumentProxy | { pdf?: PDFDocumentProxy }): PDFDocumentProxy => {
	if (value && typeof value === "object" && "pdf" in value && (value as { pdf?: PDFDocumentProxy }).pdf) {
		return (value as { pdf: PDFDocumentProxy }).pdf;
	}
	return value as PDFDocumentProxy;
};

export function PdfViewer({
	sourceUrl,
	onRequestOpenFile,
	pageRange,
	onPageRangeChange,
	onCurrentPageChange,
	initialPage,
	autoFollow = true,
	contextWindow = 3,
}: PdfViewerProps) {
	const [numPages, setNumPages] = useState(0);
	const [currentPage, setCurrentPage] = useState(1);
	const [pageInput, setPageInput] = useState("1");
	const [localAutoFollow, setLocalAutoFollow] = useState(autoFollow);
	const [contextWindowSize, setContextWindowSize] = useState(contextWindow);
	const [hasOutline, setHasOutline] = useState(false);
	const [showSidebar, setShowSidebar] = useState(true);
	const [sidebarTab, setSidebarTab] = useState<"outline" | "thumbnails">("outline");
	const [outlineItems, setOutlineItems] = useState<OutlineNode[]>([]);
	const [selectedOutlineId, setSelectedOutlineId] = useState<string | null>(null);
	const [fitMode, setFitMode] = useState<FitMode>("page-width");
	const [userScale, setUserScale] = useState(1);
	const [isLoading, setIsLoading] = useState(false);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [thumbnailAnchor, setThumbnailAnchor] = useState<number | null>(null);
	const [rangeInput, setRangeInput] = useState({ start: "1", end: "1" });
	const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
	const [pageBaseSize, setPageBaseSize] = useState<PageSize | null>(null);
	const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
	const [groupWidth, setGroupWidth] = useState(0);
	const [isSearchOpen, setIsSearchOpen] = useState(false);
	const [isSettingsOpen, setIsSettingsOpen] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const [activeQuery, setActiveQuery] = useState("");
	const [searchHits, setSearchHits] = useState<{ pageNumber: number; hitIndex: number }[]>([]);
	const [searchIndex, setSearchIndex] = useState(0);
	const [isSearching, setIsSearching] = useState(false);
	const initialPageRef = useRef<number | null>(initialPage ?? null);
	const fileKey = useMemo(() => sourceUrl ?? "empty", [sourceUrl]);

	const containerRef = useRef<HTMLDivElement | null>(null);
	const groupRef = useRef<HTMLDivElement | null>(null);
	const viewerRef = useRef<VirtuosoHandle | null>(null);
	const outlinePageCacheRef = useRef<Map<string, number>>(new Map());
	const hadOutlineRef = useRef(false);
	const baseSizeRef = useRef<PageSize | null>(null);
	const pdfRef = useRef<PDFDocumentProxy | null>(null);
	const hadBaseSizeRef = useRef(false);
	const retryScrollRef = useRef<number[]>([]);
	const textCacheRef = useRef<Map<number, string[]>>(new Map());
	const pageHitCounterRef = useRef<Map<number, number>>(new Map());
	const searchAbortRef = useRef<{ canceled: boolean } | null>(null);
	const searchInputRef = useRef<HTMLInputElement | null>(null);
	const pendingHitRef = useRef<{ pageNumber: number; hitIndex: number } | null>(null);
	const currentPageRef = useRef(1);
	const pendingScrollPageRef = useRef<number | null>(null);

	const activeHit = searchHits[searchIndex];
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

	useEffect(() => {
		initialPageRef.current = initialPage ?? null;
	}, [initialPage]);

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

	const handleZoomIn = useCallback(() => setUserScale((prev) => Math.min(prev + 0.1, 3)), []);
	const handleZoomOut = useCallback(() => setUserScale((prev) => Math.max(prev - 0.1, 0.5)), []);
	const handleToggleFit = useCallback(() => {
		setFitMode((prev) => (prev === "page-width" ? "page-fit" : "page-width"));
		setUserScale(1);
	}, []);

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

	const escapeHtml = useCallback((value: string) => {
		return value
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#39;");
	}, []);

	const getNextHitIndex = useCallback((pageNumber: number) => {
		const current = pageHitCounterRef.current.get(pageNumber) ?? 0;
		const next = current + 1;
		pageHitCounterRef.current.set(pageNumber, next);
		return next;
	}, []);

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
		[activeHit, activeQuery, escapeHtml, getNextHitIndex],
	);

	const runSearch = useCallback(
		async (query: string) => {
			const pdf = pdfRef.current;
			const trimmed = query.trim();
			if (!pdf || !trimmed) {
				clearSearch();
				return;
			}
			if (trimmed === activeQuery && searchHits.length > 0 && !isSearching) {
				const nextHit = searchHits[searchIndex];
				if (nextHit) scheduleJump(nextHit.pageNumber, 0);
				return;
			}

			if (searchAbortRef.current) searchAbortRef.current.canceled = true;
			const token = { canceled: false };
			searchAbortRef.current = token;

			setIsSearching(true);
			setSearchHits([]);
			setSearchIndex(0);
			setActiveQuery(trimmed);

			const total = pdf.numPages;
			const matches: { pageNumber: number; hitIndex: number }[] = [];
			const escapedQuery = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const regex = new RegExp(escapedQuery, "gi");

			for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
				if (token.canceled) return;
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
				let pageHitCount = 0;
				for (const part of parts) {
					if (!part) continue;
					regex.lastIndex = 0;
					while (regex.exec(part) !== null) pageHitCount += 1;
				}
				if (pageHitCount > 0) {
					for (let i = 1; i <= pageHitCount; i += 1) matches.push({ pageNumber, hitIndex: i });
				}
				if (pageNumber % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
			}

			if (token.canceled) return;
			setSearchHits(matches);
			setIsSearching(false);
			if (matches.length > 0) setSearchIndex(0);
		},
		[activeQuery, clearSearch, isSearching, scheduleJump, searchIndex, searchHits],
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
			}
			return next;
		});
		setIsSettingsOpen(false);
	}, []);

	const handleToggleSettings = useCallback(() => {
		setIsSettingsOpen((prev) => !prev);
		setIsSearchOpen(false);
	}, []);

	const handleAutoFollowToggle = useCallback(() => {
		setLocalAutoFollow((prev) => {
			const next = !prev;
			if (next) setSelectedOutlineId(null);
			return next;
		});
	}, []);
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

	useEffect(() => {
		setPageInput(String(currentPage));
		onCurrentPageChange?.(currentPage);
	}, [currentPage, onCurrentPageChange]);
	useEffect(() => {
		currentPageRef.current = currentPage;
	}, [currentPage]);

	useEffect(() => {
		setRangeInput({ start: String(pageRange.start), end: String(pageRange.end) });
	}, [pageRange.end, pageRange.start]);

	useEffect(() => {
		if (localAutoFollow && numPages > 0) {
			const start = Math.max(1, currentPage - contextWindowSize);
			const end = Math.min(numPages, currentPage + contextWindowSize);
			onPageRangeChange({ start, end });
		}
	}, [currentPage, localAutoFollow, contextWindowSize, numPages, onPageRangeChange]);

	useEffect(() => setContextWindowSize(contextWindow), [contextWindow]);
	useEffect(() => {
		if (!hasOutline && sidebarTab === "outline") setSidebarTab("thumbnails");
	}, [hasOutline, sidebarTab]);
	useEffect(() => {
		if (!searchQuery.trim()) clearSearch();
	}, [clearSearch, searchQuery]);

	useEffect(() => {
		if (!searchHits.length) return;
		const target = searchHits[searchIndex];
		if (!target) return;
		pendingHitRef.current = target;
		if (target.pageNumber !== currentPage) scheduleJump(target.pageNumber, 0);
		else scrollToPendingHit();
	}, [currentPage, scheduleJump, scrollToPendingHit, searchHits, searchIndex]);

	useEffect(() => {
		const frame = requestAnimationFrame(() => scrollToPendingHit());
		return () => cancelAnimationFrame(frame);
	}, [scrollToPendingHit]);

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
				if (isSearchOpen) setIsSearchOpen(false);
				if (isSettingsOpen) setIsSettingsOpen(false);
			}
		};
		window.addEventListener("keydown", handler);
		return () => window.removeEventListener("keydown", handler);
	}, [isSearchOpen, isSettingsOpen]);

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
	}, [pdfDoc]);

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

	useEffect(() => {
		if (!pageBaseSize) return;
		if (hadBaseSizeRef.current) return;
		hadBaseSizeRef.current = true;
		if (currentPage > 1) scheduleJump(currentPage, 0);
	}, [currentPage, pageBaseSize, scheduleJump]);

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

	useEffect(() => {
		return () => {
			clearScrollRetries();
			if (searchAbortRef.current) {
				searchAbortRef.current.canceled = true;
				searchAbortRef.current = null;
			}
		};
	}, [clearScrollRetries]);

	const availableWidth = useMemo(() => Math.max(0, containerSize.width - VIEWER_PADDING), [containerSize.width]);
	const availableHeight = useMemo(() => Math.max(0, containerSize.height - VIEWER_PADDING), [containerSize.height]);

	const fitScale = useMemo(() => {
		if (!pageBaseSize || !availableWidth || !availableHeight) return 1;
		const widthScale = availableWidth / pageBaseSize.width;
		if (fitMode === "page-width") return widthScale;
		const heightScale = availableHeight / pageBaseSize.height;
		return Math.min(widthScale, heightScale);
	}, [availableHeight, availableWidth, fitMode, pageBaseSize]);

	const effectiveScale = Math.max(0.1, fitScale * userScale);

	const pageRenderSize = useMemo(() => {
		if (!pageBaseSize) return null;
		return { width: pageBaseSize.width * effectiveScale, height: pageBaseSize.height * effectiveScale };
	}, [pageBaseSize, effectiveScale]);

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

	const renderOutlineItems = useCallback(
		function renderOutlineItems(items: OutlineNode[], level = 0) {
			if (!items.length) return null;
			return (
				<ul className={cn("space-y-0.5", level > 0 && "ml-3 border-l border-border/40 pl-2")}>
					{items.map((item) => {
						const isSelected = selectedOutlineId === item.id;
						return (
							<li key={item.id}>
								<button
									type="button"
									className={cn(
										"group w-full flex items-center gap-2 rounded-sm px-2 py-1.5 transition-colors cursor-pointer text-sm text-left",
										isSelected
											? "bg-primary/10 text-primary font-medium"
											: "hover:bg-muted text-muted-foreground hover:text-foreground",
									)}
									onClick={() => void handleOutlineClick(item)}
								>
									<span className="flex-1 truncate">{item.title || "Untitled"}</span>
									{!item.url && (
										<Button
											variant="ghost"
											size="icon"
											className={cn(
												"h-5 w-5 opacity-0 group-hover:opacity-100 transition-all scale-90 hover:scale-100",
												isSelected && "opacity-100 text-primary bg-background shadow-sm",
											)}
											onClick={(event) => {
												event.stopPropagation();
												void handleOutlineSelectRange(item);
											}}
											title="Focus context on this section"
										>
											<BrainCircuit className="h-3 w-3" />
										</Button>
									)}
								</button>
								{item.items && item.items.length > 0 && renderOutlineItems(item.items, level + 1)}
							</li>
						);
					})}
				</ul>
			);
		},
		[handleOutlineClick, handleOutlineSelectRange, selectedOutlineId],
	);

	const renderCompactToolbar = useMemo(
		() => (
			<div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center p-1 glass rounded-xl shadow-md border border-border/10 transition-all duration-300 max-w-[95vw] w-auto gap-1">
				{/* Left: Sidebar & File */}
				<div className="flex items-center gap-1 pl-1">
					{!showSidebar && (
						<Button
							variant="ghost"
							size="icon"
							className="h-8 w-8 text-muted-foreground hover:text-foreground"
							onClick={() => setShowSidebar(true)}
							title="Show Sidebar"
						>
							<PanelLeft className="h-4 w-4" />
						</Button>
					)}
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8 text-muted-foreground hover:text-foreground"
						onClick={onRequestOpenFile}
						title="Open PDF"
					>
						<FileText className="h-4 w-4" />
					</Button>
				</div>

				<div className="h-4 w-px bg-border/40 mx-1.5" />

				{/* Center: Navigation */}
				<div className="flex items-center gap-1 shrink-0">
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
						onClick={() => handlePageStep(-1)}
						disabled={currentPage <= 1}
					>
						<ChevronLeft className="h-4 w-4" />
					</Button>

					<div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted/50 border border-border/20 shadow-sm shrink-0 min-w-[80px] justify-center">
						<Input
							type="text"
							inputMode="numeric"
							pattern="[0-9]*"
							className="w-9 text-center text-sm p-0 border-none bg-transparent focus-visible:ring-0 font-semibold tabular-nums shadow-none h-auto shrink-0 leading-none text-foreground"
							value={pageInput}
							onChange={(e) => setPageInput(e.target.value)}
							onBlur={handlePageInputCommit}
							onKeyDown={(e) => e.key === "Enter" && handlePageInputCommit()}
						/>
						<span className="text-xs text-muted-foreground/60 tabular-nums shrink-0 select-none font-medium">
							/ {numPages}
						</span>
					</div>

					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
						onClick={() => handlePageStep(1)}
						disabled={currentPage >= numPages}
					>
						<ChevronRight className="h-4 w-4" />
					</Button>
				</div>

				<div className="h-4 w-px bg-border/40 mx-1.5 hidden sm:block shrink-0" />

				{/* Right Center: Zoom (Hidden on very small screens or collapsed) */}
				<div className="hidden sm:flex items-center gap-1 shrink-0">
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
						onClick={handleZoomOut}
					>
						<ZoomOut className="h-4 w-4" />
					</Button>
					<span className="text-xs text-muted-foreground font-medium w-10 text-center tabular-nums shrink-0">
						{Math.round(effectiveScale * 100)}%
					</span>
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
						onClick={handleZoomIn}
					>
						<ZoomIn className="h-4 w-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
						onClick={handleToggleFit}
						title={fitMode === "page-width" ? "Fit to Page" : "Fit to Width"}
					>
						{fitMode === "page-width" ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
					</Button>
				</div>

				<div className="h-4 w-px bg-border/40 mx-1.5 shrink-0" />

				{/* Right: AI & Tools */}
				<div className="flex items-center gap-1 pr-1 shrink-0 relative">
					<div
						className={cn(
							"flex items-center gap-1 rounded-md px-2 py-1 transition-all border shrink-0 mr-1",
							localAutoFollow ? "bg-primary/10 border-primary/20" : "bg-muted/30 border-border/30 hover:bg-muted/50",
						)}
					>
						<BrainCircuit
							className={cn("h-3.5 w-3.5 shrink-0", localAutoFollow ? "text-primary" : "text-muted-foreground")}
						/>
						<Input
							type="text"
							inputMode="numeric"
							pattern="[0-9]*"
							className="h-4 w-8 text-center text-[10px] p-0 border-none bg-transparent focus-visible:ring-0 font-medium tabular-nums text-foreground shadow-none shrink-0"
							value={rangeInput.start}
							onChange={(e) => handleRangeStartChange(e.target.value)}
							onBlur={commitRangeStart}
							onKeyDown={(e) => e.key === "Enter" && commitRangeStart()}
						/>
						<span className="text-[9px] text-muted-foreground shrink-0 select-none">/</span>
						<Input
							type="text"
							inputMode="numeric"
							pattern="[0-9]*"
							className="h-4 w-8 text-center text-[10px] p-0 border-none bg-transparent focus-visible:ring-0 font-medium tabular-nums text-foreground shadow-none shrink-0"
							value={rangeInput.end}
							onChange={(e) => handleRangeEndChange(e.target.value)}
							onBlur={commitRangeEnd}
							onKeyDown={(e) => e.key === "Enter" && commitRangeEnd()}
						/>
						<button
							type="button"
							onClick={handleAutoFollowToggle}
							className={cn(
								"ml-1 h-4 w-4 rounded-full flex items-center justify-center transition-colors shrink-0",
								localAutoFollow
									? "text-primary hover:bg-primary/10"
									: "text-muted-foreground hover:text-foreground hover:bg-muted",
							)}
							title="Toggle Auto-follow"
						>
							<RefreshCw className={cn("h-2.5 w-2.5", localAutoFollow && "animate-spin-once")} />
						</button>
					</div>

					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
						onClick={handleToggleSettings}
						title="AI Context Settings"
					>
						<Settings2 className="h-4 w-4" />
					</Button>

					<Button
						variant={isSearchOpen ? "secondary" : "ghost"}
						size="icon"
						className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0"
						onClick={handleToggleSearch}
						title="Search"
					>
						<Search className="h-4 w-4" />
					</Button>

					{/* Search Overlay */}
					{isSearchOpen && (
						<div className="absolute top-full right-0 mt-3 z-30 w-72 bg-background/80 backdrop-blur-xl shadow-2xl rounded-2xl border border-white/20 dark:border-white/10 p-3 flex flex-col gap-3 animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-200 origin-top-right ring-1 ring-black/5">
							<div className="flex items-center gap-2 bg-muted/50 rounded-xl px-3 py-2 border border-white/5 transition-colors focus-within:bg-muted/70 focus-within:ring-1 focus-within:ring-primary/20">
								<Search className="h-4 w-4 text-muted-foreground/70 shrink-0" />
								<Input
									ref={searchInputRef}
									placeholder="Find in document"
									className="h-5 text-sm bg-transparent border-none focus-visible:ring-0 placeholder:text-muted-foreground/50 px-0 shadow-none file:bg-transparent"
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											if (e.shiftKey) handleSearchPrev();
											else handleSearchSubmit();
										} else if (e.key === "Escape") setIsSearchOpen(false);
									}}
								/>
								{searchQuery && (
									<button
										type="button"
										onClick={() => setSearchQuery("")}
										className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
									>
										<X className="h-3.5 w-3.5" />
									</button>
								)}
							</div>
							<div className="flex items-center justify-between text-xs text-muted-foreground px-1">
								<span className="font-medium truncate max-w-[120px] select-none">
									{searchHits.length > 0
										? `${searchIndex + 1} of ${searchHits.length} results`
										: isSearching
											? "Searching..."
											: "No results"}
								</span>
								<div className="flex items-center gap-1">
									<Button
										variant="ghost"
										size="icon"
										className="h-7 w-7 rounded-lg hover:bg-primary/10 hover:text-primary transition-all"
										onClick={handleSearchPrev}
										disabled={!searchHits.length}
									>
										<ChevronLeft className="h-4 w-4" />
									</Button>
									<Button
										variant="ghost"
										size="icon"
										className="h-7 w-7 rounded-lg hover:bg-primary/10 hover:text-primary transition-all"
										onClick={handleSearchNext}
										disabled={!searchHits.length}
									>
										<ChevronRight className="h-4 w-4" />
									</Button>
								</div>
							</div>
						</div>
					)}

					{/* Settings Overlay */}
					{isSettingsOpen && (
						<div className="absolute top-full right-0 mt-3 z-30 w-64 bg-background/80 backdrop-blur-xl shadow-2xl rounded-2xl border border-white/20 dark:border-white/10 p-4 flex flex-col gap-4 animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-200 origin-top-right ring-1 ring-black/5">
							<div className={cn("space-y-3", !localAutoFollow && "opacity-60 grayscale-[0.5] transition-all")}>
								<div className="flex items-center justify-between">
									<span className="text-xs font-semibold text-foreground/80">Context Window</span>
									<span className="bg-primary/10 text-primary px-2 py-0.5 rounded-md text-[11px] font-mono font-medium border border-primary/20">
										±{contextWindowSize}
									</span>
								</div>

								{/* Modern Range Slider */}
								<div className="relative h-4 flex items-center">
									<input
										type="range"
										min={CONTEXT_WINDOW_MIN}
										max={CONTEXT_WINDOW_MAX}
										step={1}
										value={contextWindowSize}
										onChange={(e) => handleContextWindowChange(parseInt(e.target.value, 10))}
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

							<div className="sm:hidden space-y-3 pt-3 border-t border-border/10">
								<div className="text-xs font-semibold text-foreground/80">Zoom Level</div>
								<div className="flex items-center gap-2 justify-between">
									<div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1 border border-white/5">
										<Button
											variant="ghost"
											size="icon"
											className="h-7 w-7 rounded-md hover:bg-background hover:shadow-sm"
											onClick={handleZoomOut}
										>
											<ZoomOut className="h-3.5 w-3.5" />
										</Button>
										<span className="text-[11px] w-10 text-center font-medium tabular-nums">
											{Math.round(effectiveScale * 100)}%
										</span>
										<Button
											variant="ghost"
											size="icon"
											className="h-7 w-7 rounded-md hover:bg-background hover:shadow-sm"
											onClick={handleZoomIn}
										>
											<ZoomIn className="h-3.5 w-3.5" />
										</Button>
									</div>
									<Button
										variant="outline"
										size="icon"
										className="h-9 w-9 rounded-lg bg-transparent border-white/10 hover:bg-muted/50"
										onClick={handleToggleFit}
									>
										{fitMode === "page-width" ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
									</Button>
								</div>
							</div>
						</div>
					)}
				</div>
			</div>
		),
		[
			showSidebar,
			onRequestOpenFile,
			currentPage,
			pageInput,
			numPages,
			handlePageInputCommit,
			handlePageStep,
			handleZoomOut,
			effectiveScale,
			handleZoomIn,
			handleToggleFit,
			fitMode,
			rangeInput.start,
			handleRangeStartChange,
			commitRangeStart,
			rangeInput.end,
			handleRangeEndChange,
			commitRangeEnd,
			localAutoFollow,
			handleAutoFollowToggle,
			isSearchOpen,
			handleToggleSearch,
			handleToggleSettings,
			searchQuery,
			searchHits,
			searchIndex,
			isSearching,
			isSettingsOpen,
			contextWindowSize,
			handleContextWindowChange,
			handleSearchPrev,
			handleSearchSubmit,
			handleSearchNext,
		],
	);

	return (
		<Group
			orientation="horizontal"
			className="h-full bg-muted/5"
			id="pdf-viewer"
			defaultLayout={groupDefaultLayout}
			elementRef={groupRef}
		>
			{showSidebar && numPages > 0 && (
				<>
					<Panel
						id="sidebar-panel"
						defaultSize={sidebarSizes.defaultPercent}
						minSize={sidebarSizes.minPercent}
						className="flex flex-col bg-background border-r z-10 shadow-sm"
					>
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
									onClick={() => setSidebarTab("outline")}
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
									onClick={() => setSidebarTab("thumbnails")}
								>
									Thumbnails
								</button>
							</div>
							<Button
								variant="ghost"
								size="icon"
								className="h-8 w-8 text-muted-foreground hover:text-foreground"
								onClick={() => setShowSidebar(false)}
							>
								<X className="h-4 w-4" />
							</Button>
						</div>

						<div className="flex-1 overflow-auto p-3 scrollbar-thin">
							{sidebarTab === "outline" ? (
								hasOutline ? (
									<div className="pdf-outline animate-in fade-in duration-300">{renderOutlineItems(outlineItems)}</div>
								) : (
									<div className="p-8 text-center text-sm text-muted-foreground flex flex-col items-center gap-3 opacity-60">
										<Menu className="h-8 w-8 opacity-20" />
										<p>No outline available</p>
									</div>
								)
							) : (
								<Virtuoso
									style={{ height: "100%" }}
									totalCount={numPages}
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
													onSelect={handleThumbnailSelect}
												/>
											</div>
										);
									}}
								/>
							)}
						</div>
					</Panel>
					<Separator className="w-2 -ml-1 bg-transparent hover:bg-primary/10 transition-colors cursor-col-resize z-50 flex justify-center">
						<div className="w-px h-full bg-border/50" />
					</Separator>
				</>
			)}

			<Panel id="viewer-panel" minSize={VIEWER_MIN_SIZE} className="relative flex flex-col bg-muted/30">
				{numPages > 0 && renderCompactToolbar}

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
							</div>
						) : (
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
						{isLoading && (
							<div className="absolute inset-0 flex items-center justify-center bg-background/60 backdrop-blur-[2px] z-50 animate-in fade-in duration-300">
								<div className="flex flex-col items-center gap-4 p-6 rounded-2xl bg-card/80 shadow-xl border border-white/10">
									<div className="h-12 w-12 animate-spin rounded-full border-[3px] border-primary border-t-transparent shadow-sm" />
									<span className="text-sm font-medium animate-pulse">Loading Document...</span>
								</div>
							</div>
						)}
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

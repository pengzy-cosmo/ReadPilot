import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, Thumbnail, pdfjs } from "react-pdf";
import type {
  DocumentInitParameters,
  PDFDocumentProxy,
  PDFPageProxy,
  RefProxy,
} from "pdfjs-dist/types/src/display/api";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";

import { Group, Panel, Separator } from "react-resizable-panels";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Search, X } from "lucide-react";

const PDFJS_VERSION =
  (pdfjs as unknown as { version?: string }).version ?? "5.4.296";
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

const CONTEXT_WINDOW_MIN = 1;
const CONTEXT_WINDOW_MAX = 12;
const THUMBNAIL_TARGET_WIDTH = 120;
const VIEWER_PADDING = 32;
const PAGE_GAP = 16;
const VIEWPORT_BUFFER_PAGES = 2;

const isRefProxyValue = (value: unknown): value is RefProxy => {
  if (!value || typeof value !== "object") return false;
  const ref = value as { num?: unknown; gen?: unknown };
  return typeof ref.num === "number" && typeof ref.gen === "number";
};

const assignOutlineIds = (
  items: OutlineNodeInput[],
  prefix = "outline"
): OutlineNode[] =>
  // Stable ids make outline rendering + caching predictable.
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

const flattenOutline = (
  items: OutlineNode[],
  level = 0,
  acc: OutlineFlatItem[] = []
) => {
  // Flatten tree into a list for range selection and searching.
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

function ThumbnailItem({
  pageNumber,
  pdf,
  isSelected,
  isCurrent,
  onSelect,
}: ThumbnailItemProps) {
  return (
    <button
      type="button"
      className={`group w-full rounded-lg border p-2 text-left transition ${
        isSelected
          ? "border-primary bg-primary/10"
          : "border-border bg-card hover:bg-muted/60"
      } ${isCurrent ? "ring-1 ring-primary/60" : ""}`}
      onClick={(event) => onSelect(pageNumber, event.shiftKey)}
      title={`Select page ${pageNumber}`}
    >
      <div className="w-full flex items-center justify-center">
        <Thumbnail
          pageNumber={pageNumber}
          pdf={pdf ?? undefined}
          width={THUMBNAIL_TARGET_WIDTH}
        />
      </div>
      <div className="mt-1 text-xs text-muted-foreground text-right">
        Page {pageNumber}
      </div>
    </button>
  );
}

const MemoizedThumbnailItem = memo(ThumbnailItem);

const normalizePdfFromLoad = (
  value: PDFDocumentProxy | { pdf?: PDFDocumentProxy }
): PDFDocumentProxy => {
  // react-pdf may wrap the document in an object; normalize both shapes.
  if (
    value &&
    typeof value === "object" &&
    "pdf" in value &&
    (value as { pdf?: PDFDocumentProxy }).pdf
  ) {
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
  const [sidebarTab, setSidebarTab] = useState<"outline" | "thumbnails">(
    "outline"
  );
  const [outlineItems, setOutlineItems] = useState<OutlineNode[]>([]);
  const [fitMode, setFitMode] = useState<FitMode>("page-width");
  const [userScale, setUserScale] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [thumbnailAnchor, setThumbnailAnchor] = useState<number | null>(null);
  const [rangeInput, setRangeInput] = useState({ start: "1", end: "1" });
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pageBaseSize, setPageBaseSize] = useState<PageSize | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [searchHits, setSearchHits] = useState<
    { pageNumber: number; hitIndex: number }[]
  >([]);
  const [searchIndex, setSearchIndex] = useState(0);
  const [isSearching, setIsSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState({
    current: 0,
    total: 0,
  });
  const initialPageRef = useRef<number | null>(initialPage ?? null);
  const fileKey = useMemo(() => sourceUrl ?? "empty", [sourceUrl]);

  const containerRef = useRef<HTMLDivElement | null>(null);
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
  const pendingHitRef = useRef<{ pageNumber: number; hitIndex: number } | null>(
    null
  );

  const activeHit = searchHits[searchIndex];

  const documentOptions = useMemo<DocumentInitParameters>(
    () => ({
      cMapUrl: `${PDFJS_CDN_BASE}cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `${PDFJS_CDN_BASE}standard_fonts/`,
      wasmUrl: `${PDFJS_CDN_BASE}wasm/`,
      iccUrl: `${PDFJS_CDN_BASE}iccs/`,
    }),
    []
  );

  const scrollToPage = useCallback(
    (
      pageNumber: number,
      options?: { behavior?: ScrollBehaviorOption; offset?: number }
    ) => {
      viewerRef.current?.scrollToIndex({
        index: pageNumber - 1,
        align: "start",
        behavior: options?.behavior ?? "smooth",
        offset: options?.offset ?? 0,
      });
    },
    []
  );

  const scheduleJump = useCallback(
    (pageNumber: number, offset = 0) => {
      // Re-try scroll to ensure the virtualized list has rendered the target.
      retryScrollRef.current.forEach((timer) => window.clearTimeout(timer));
      retryScrollRef.current = [];
      scrollToPage(pageNumber, { behavior: "auto", offset });
      retryScrollRef.current.push(
        window.setTimeout(() => {
          scrollToPage(pageNumber, { behavior: "auto", offset });
        }, 120)
      );
      retryScrollRef.current.push(
        window.setTimeout(() => {
          scrollToPage(pageNumber, { behavior: "auto", offset });
        }, 420)
      );
    },
    [scrollToPage]
  );

  const handlePageInputCommit = useCallback(() => {
    if (!numPages) return;
    const value = parseInt(pageInput, 10);
    if (Number.isNaN(value)) {
      setPageInput(String(currentPage));
      return;
    }
    const nextPage = Math.max(1, Math.min(numPages, value));
    setPageInput(String(nextPage));
    scrollToPage(nextPage);
  }, [currentPage, numPages, pageInput, scrollToPage]);

  useEffect(() => {
    initialPageRef.current = initialPage ?? null;
  }, [initialPage]);

  const clampRange = useCallback(
    (nextStart: number, nextEnd: number) => {
      const max = numPages || 1;
      const start = Math.max(1, Math.min(nextStart, max));
      const end = Math.max(1, Math.min(nextEnd, max));
      // Normalize range even if inputs are flipped.
      if (start <= end) {
        onPageRangeChange({ start, end });
      } else {
        onPageRangeChange({ start: end, end: start });
      }
    },
    [numPages, onPageRangeChange]
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

  const handleZoomIn = useCallback(() => {
    setUserScale((prev) => Math.min(prev + 0.1, 3));
  }, []);

  const handleZoomOut = useCallback(() => {
    setUserScale((prev) => Math.max(prev - 0.1, 0.5));
  }, []);

  const handleToggleFit = useCallback(() => {
    setFitMode((prev) => (prev === "page-width" ? "page-fit" : "page-width"));
    setUserScale(1);
  }, []);

  const handleRangeStartChange = useCallback((value: string) => {
    setLocalAutoFollow(false);
    setRangeInput((prev) => ({ ...prev, start: value }));
  }, []);

  const handleRangeEndChange = useCallback((value: string) => {
    setLocalAutoFollow(false);
    setRangeInput((prev) => ({ ...prev, end: value }));
  }, []);

  const handleContextWindowChange = useCallback(
    (value: number) => {
      const next = Math.max(
        CONTEXT_WINDOW_MIN,
        Math.min(CONTEXT_WINDOW_MAX, value)
      );
      setContextWindowSize(next);
    },
    [setContextWindowSize]
  );

  const clearSearch = useCallback(() => {
    if (searchAbortRef.current) {
      searchAbortRef.current.canceled = true;
      searchAbortRef.current = null;
    }
    // Reset all search-related UI + counters.
    setIsSearching(false);
    setSearchHits([]);
    setSearchIndex(0);
    setSearchProgress({ current: 0, total: 0 });
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
      // Highlight search hits by injecting <mark> tags.
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
            const isActive =
              activeHit &&
              activeHit.pageNumber === pageNumber &&
              activeHit.hitIndex === hitIndex;
            const className = isActive
              ? "pdf-search-hit pdf-search-hit--active"
              : "pdf-search-hit";
            result += `<mark class="${className}" data-page="${pageNumber}" data-hit="${hitIndex}">${escapeHtml(
              matches[index]
            )}</mark>`;
          }
        });
        return result;
      };
    },
    [activeHit, activeQuery, escapeHtml, getNextHitIndex]
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
        // If same query, just jump to the current hit.
        const nextHit = searchHits[searchIndex];
        if (nextHit) scheduleJump(nextHit.pageNumber, 0);
        return;
      }

      if (searchAbortRef.current) {
        searchAbortRef.current.canceled = true;
      }
      const token = { canceled: false };
      searchAbortRef.current = token;

      setIsSearching(true);
      setSearchHits([]);
      setSearchIndex(0);
      setActiveQuery(trimmed);

      const total = pdf.numPages;
      setSearchProgress({ current: 0, total });
      const matches: { pageNumber: number; hitIndex: number }[] = [];
      const escapedQuery = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(escapedQuery, "gi");

      for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
        if (token.canceled) return;
        let parts = textCacheRef.current.get(pageNumber);
        if (!parts) {
          // Cache extracted text to speed up repeated searches.
          const page = await pdf.getPage(pageNumber);
          const textContent = await page.getTextContent();
          const rawItems = Array.isArray(textContent.items)
            ? textContent.items
            : [];
          const strings = rawItems.map((item) =>
            typeof (item as { str?: string }).str === "string"
              ? (item as { str: string }).str
              : ""
          );
          textCacheRef.current.set(pageNumber, strings);
          parts = strings;
        }
        let pageHitCount = 0;
        for (const part of parts) {
          if (!part) continue;
          regex.lastIndex = 0;
          while (regex.exec(part) !== null) {
            pageHitCount += 1;
          }
        }
        if (pageHitCount > 0) {
          for (let i = 1; i <= pageHitCount; i += 1) {
            matches.push({ pageNumber, hitIndex: i });
          }
        }
        setSearchProgress({ current: pageNumber, total });
        if (pageNumber % 4 === 0) {
          // Yield to the UI thread during long searches.
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }

      if (token.canceled) return;
      setSearchHits(matches);
      setIsSearching(false);
      if (matches.length > 0) {
        setSearchIndex(0);
      }
    },
    [
      activeQuery,
      clearSearch,
      isSearching,
      scheduleJump,
      searchIndex,
      searchHits,
    ]
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
  }, [
    activeQuery,
    clearSearch,
    handleSearchNext,
    isSearching,
    runSearch,
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
      }
      return next;
    });
  }, []);

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
      if (typeof destination === "string") {
        destination = await pdf.getDestination(destination);
      }
      if (!Array.isArray(destination) || destination.length === 0) {
        return null;
      }
      const [ref] = destination as unknown[];
      if (typeof ref === "number") {
        return ref + 1;
      }
      if (!isRefProxyValue(ref)) return null;
      // Resolve PDF reference to a 1-based page number.
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
        if (pageNumber) {
          outlinePageCacheRef.current.set(item.id, pageNumber);
        }
      }
      resolved.push({ ...item, pageNumber });
    }
    return resolved;
  }, [outlineItems, resolveDestPageNumber]);

  const handleOutlineSelectRange = useCallback(
    async (item: OutlineNode) => {
      // Select from current heading to the next same-or-higher level heading.
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
      scheduleJump(start, 0);
    },
    [getOutlineFlatWithPages, numPages, onPageRangeChange, scheduleJump]
  );

  const handleThumbnailSelect = useCallback(
    (pageNumber: number, isRange: boolean) => {
      if (!numPages) return;
      setLocalAutoFollow(false);
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
    [numPages, onPageRangeChange, scheduleJump, thumbnailAnchor]
  );

  useEffect(() => {
    setPageInput(String(currentPage));
    onCurrentPageChange?.(currentPage);
  }, [currentPage, onCurrentPageChange]);

  useEffect(() => {
    setRangeInput({
      start: String(pageRange.start),
      end: String(pageRange.end),
    });
  }, [pageRange.end, pageRange.start]);

  useEffect(() => {
    if (localAutoFollow && numPages > 0) {
      // Keep range centered around the current page.
      const start = Math.max(1, currentPage - contextWindowSize);
      const end = Math.min(numPages, currentPage + contextWindowSize);
      onPageRangeChange({ start, end });
    }
  }, [
    currentPage,
    localAutoFollow,
    contextWindowSize,
    numPages,
    onPageRangeChange,
  ]);

  useEffect(() => {
    setContextWindowSize(contextWindow);
  }, [contextWindow]);

  useEffect(() => {
    if (!hasOutline && sidebarTab === "outline") {
      setSidebarTab("thumbnails");
    }
  }, [hasOutline, sidebarTab]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      clearSearch();
    }
  }, [clearSearch, searchQuery]);

  useEffect(() => {
    if (!searchHits.length) return;
    const target = searchHits[searchIndex];
    if (!target) return;
    pendingHitRef.current = target;
    if (target.pageNumber !== currentPage) {
      scheduleJump(target.pageNumber, 0);
    } else {
      scrollToPendingHit();
    }
  }, [currentPage, scheduleJump, scrollToPendingHit, searchHits, searchIndex]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => scrollToPendingHit());
    return () => cancelAnimationFrame(frame);
  }, [
    scrollToPendingHit,
    currentPage,
    activeQuery,
    searchIndex,
    searchHits.length,
  ]);

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
      } else if (event.key === "Escape" && isSearchOpen) {
        setIsSearchOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isSearchOpen]);

  useEffect(() => {
    if (!sourceUrl) {
      // Reset viewer state when document is cleared.
      setNumPages(0);
      setCurrentPage(1);
      setPageInput("1");
      setOutlineItems([]);
      setHasOutline(false);
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
      if (retryScrollRef.current.length > 0) {
        retryScrollRef.current.forEach((timer) => window.clearTimeout(timer));
        retryScrollRef.current = [];
      }
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    // Clear viewer state before loading a new document.
    setNumPages(0);
    setCurrentPage(1);
    setPageInput("1");
    setOutlineItems([]);
    setHasOutline(false);
    outlinePageCacheRef.current.clear();
    hadOutlineRef.current = false;
    hadBaseSizeRef.current = false;
    setPdfDoc(null);
    setPageBaseSize(null);
    baseSizeRef.current = null;
    textCacheRef.current.clear();
    resetSearchUi();
    if (retryScrollRef.current.length > 0) {
      retryScrollRef.current.forEach((timer) => window.clearTimeout(timer));
      retryScrollRef.current = [];
    }
  }, [resetSearchUi, sourceUrl]);

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
      // Respect the last-read page when opening a document.
      if (targetPage && targetPage >= 1 && targetPage <= pdf.numPages) {
        scheduleJump(targetPage, 0);
      }
    },
    [scheduleJump]
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
        const normalized = assignOutlineIds(
          (outline ?? []) as OutlineNodeInput[]
        );
        setOutlineItems(normalized);
        setHasOutline(normalized.length > 0);
        if (normalized.length > 0 && !hadOutlineRef.current) {
          setSidebarTab("outline");
          hadOutlineRef.current = true;
        }
        if (normalized.length === 0) {
          hadOutlineRef.current = false;
        }
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
        // Use the first page to compute base sizing for fit/scale.
        const page = await pdfDoc.getPage(1);
        const viewport = page.getViewport({ scale: 1 });
        const nextSize = { width: viewport.width, height: viewport.height };
        if (cancelled) return;
        baseSizeRef.current = nextSize;
        setPageBaseSize(nextSize);
      } catch (error) {
        if (!cancelled) {
          console.warn("Failed to read base page size:", error);
        }
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
    // If the initial page is not 1, scroll after size is known.
    if (currentPage > 1) {
      scheduleJump(currentPage, 0);
    }
  }, [currentPage, pageBaseSize, scheduleJump]);

  useEffect(() => {
    const target = containerRef.current;
    if (!target) return;
    const observer = new ResizeObserver(() => {
      if (!target) return;
      setContainerSize({
        width: target.clientWidth,
        height: target.clientHeight,
      });
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (retryScrollRef.current.length > 0) {
        retryScrollRef.current.forEach((timer) => window.clearTimeout(timer));
        retryScrollRef.current = [];
      }
      if (searchAbortRef.current) {
        searchAbortRef.current.canceled = true;
        searchAbortRef.current = null;
      }
    };
  }, []);

  const availableWidth = useMemo(
    () => Math.max(0, containerSize.width - VIEWER_PADDING),
    [containerSize.width]
  );

  const availableHeight = useMemo(
    () => Math.max(0, containerSize.height - VIEWER_PADDING),
    [containerSize.height]
  );

  const fitScale = useMemo(() => {
    if (!pageBaseSize || !availableWidth || !availableHeight) return 1;
    const widthScale = availableWidth / pageBaseSize.width;
    if (fitMode === "page-width") {
      return widthScale;
    }
    const heightScale = availableHeight / pageBaseSize.height;
    return Math.min(widthScale, heightScale);
  }, [availableHeight, availableWidth, fitMode, pageBaseSize]);

  const effectiveScale = Math.max(0.1, fitScale * userScale);

  const pageRenderSize = useMemo(() => {
    if (!pageBaseSize) return null;
    return {
      width: pageBaseSize.width * effectiveScale,
      height: pageBaseSize.height * effectiveScale,
    };
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
      const nextPage = startIndex + 1;
      setCurrentPage((prev) => (prev === nextPage ? prev : nextPage));
    },
    []
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
        if (typeof destination === "string") {
          destination = await pdf.getDestination(destination);
        }
        if (!Array.isArray(destination) || destination.length === 0) {
          return;
        }

        const destinationArray = destination as unknown[];
        const [ref] = destinationArray;
        let pageNumber: number | null = null;
        if (typeof ref === "number") {
          pageNumber = ref + 1;
        } else if (isRefProxyValue(ref)) {
          const pageIndex = await pdf.getPageIndex(ref);
          pageNumber = pageIndex + 1;
        } else {
          pageNumber = null;
        }
        if (!pageNumber) return;

        let offset = 0;
        const destType = destinationArray[1];
        const destName =
          typeof destType === "string"
            ? destType
            : destType &&
              typeof destType === "object" &&
              "name" in (destType as { name?: string })
            ? (destType as { name?: string }).name
            : null;
        if (destName) {
          const page = await pdf.getPage(pageNumber);
          const viewport = page.getViewport({ scale: effectiveScale });
          let top: number | null = null;
          if (destName === "XYZ") {
            const value = destinationArray[3];
            if (typeof value === "number") top = value;
          } else if (destName === "FitH" || destName === "FitBH") {
            const value = destinationArray[2];
            if (typeof value === "number") top = value;
          } else if (destName === "FitR") {
            const value = destinationArray[5];
            if (typeof value === "number") top = value;
          }
          if (typeof top === "number") {
            const [, y] = viewport.convertToViewportPoint(0, top);
            const clamped = Math.max(0, Math.min(y, viewport.height - 1));
            offset = clamped;
          }
        }

        scheduleJump(pageNumber, offset);
      } catch (error) {
        console.warn("Failed to resolve outline destination:", error);
      }
    },
    [effectiveScale, scheduleJump]
  );

  const renderOutlineItems = useCallback(
    function renderOutlineItems(items: OutlineNode[]) {
      if (!items.length) return null;
      return (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <div className="group flex items-center gap-2">
                <button
                  type="button"
                  className="flex-1 text-left outline-link"
                  onClick={() => {
                    void handleOutlineClick(item);
                  }}
                >
                  {item.title || "Untitled"}
                </button>
                {!item.url && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground opacity-60 transition hover:opacity-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleOutlineSelectRange(item);
                    }}
                    title="Select this section"
                  >
                    Select
                  </button>
                )}
              </div>
              {item.items && item.items.length > 0 && (
                <div className="ml-2">{renderOutlineItems(item.items)}</div>
              )}
            </li>
          ))}
        </ul>
      );
    },
    [handleOutlineClick, handleOutlineSelectRange]
  );

  const renderToolbar = useMemo(
    () => (
      <div className="flex flex-col border-b bg-muted/50">
        <div className="flex items-center gap-2 p-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={onRequestOpenFile}>
            Open PDF
          </Button>

          {numPages > 0 && (
            <>
              {!showSidebar && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowSidebar(true);
                  }}
                >
                  Sidebar
                </Button>
              )}

              <div className="flex items-center gap-1 ml-2">
                <Input
                  type="number"
                  min={1}
                  max={numPages}
                  value={pageInput}
                  onChange={(e) => setPageInput(e.target.value)}
                  onBlur={handlePageInputCommit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handlePageInputCommit();
                    }
                  }}
                  className="w-16 h-8"
                />
                <span className="text-sm text-muted-foreground">
                  / {numPages}
                </span>
              </div>

              <div className="flex items-center gap-1 ml-2">
                <Button variant="outline" size="sm" onClick={handleZoomIn}>
                  +
                </Button>
                <Button variant="outline" size="sm" onClick={handleZoomOut}>
                  -
                </Button>
                <Button variant="outline" size="sm" onClick={handleToggleFit}>
                  {fitMode === "page-width" ? "Fit" : "Width"}
                </Button>
                <span className="text-xs text-muted-foreground">
                  {Math.round(effectiveScale * 100)}%
                </span>
              </div>

              <div className="flex items-center gap-1 ml-2 border-l pl-2 shrink-0">
                <span className="text-sm text-muted-foreground">Range:</span>
                <Input
                  type="number"
                  min={1}
                  max={numPages}
                  value={rangeInput.start}
                  onChange={(e) => handleRangeStartChange(e.target.value)}
                  onBlur={commitRangeStart}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitRangeStart();
                    }
                  }}
                  disabled={localAutoFollow}
                  className="w-20 h-8"
                />
                <span>-</span>
                <Input
                  type="number"
                  min={1}
                  max={numPages}
                  value={rangeInput.end}
                  onChange={(e) => handleRangeEndChange(e.target.value)}
                  onBlur={commitRangeEnd}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitRangeEnd();
                    }
                  }}
                  disabled={localAutoFollow}
                  className="w-20 h-8"
                />
                <Button
                  variant={localAutoFollow ? "default" : "outline"}
                  size="sm"
                  onClick={() => setLocalAutoFollow(!localAutoFollow)}
                  title={`Auto-follow: current page ±${contextWindowSize}`}
                >
                  Auto
                </Button>
                <div
                  className={`flex items-center gap-2 ml-2 ${
                    localAutoFollow ? "" : "opacity-60"
                  }`}
                >
                  <input
                    type="range"
                    min={CONTEXT_WINDOW_MIN}
                    max={CONTEXT_WINDOW_MAX}
                    value={contextWindowSize}
                    onChange={(event) =>
                      handleContextWindowChange(
                        parseInt(event.target.value, 10)
                      )
                    }
                    disabled={!localAutoFollow}
                    className="w-24"
                    aria-label="Auto-follow window size"
                  />
                  <span className="text-xs text-muted-foreground">
                    ±{contextWindowSize}
                  </span>
                </div>
              </div>

              <Button
                variant={isSearchOpen ? "default" : "outline"}
                size="sm"
                className="ml-auto"
                onClick={handleToggleSearch}
                title="Search (Ctrl+F)"
              >
                {isSearchOpen ? (
                  <X className="h-4 w-4" />
                ) : (
                  <Search className="h-4 w-4" />
                )}
              </Button>
            </>
          )}
        </div>

        {isSearchOpen && (
          <div className="flex items-center gap-2 px-2 py-1 border-t bg-muted/40">
            <Input
              ref={searchInputRef}
              type="search"
              placeholder="Search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (e.shiftKey) {
                    handleSearchPrev();
                  } else {
                    handleSearchSubmit();
                  }
                } else if (e.key === "Escape") {
                  setIsSearchOpen(false);
                }
              }}
              className="w-56 h-8"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleSearchPrev}
              disabled={isSearching || searchHits.length === 0}
              title="Previous match"
            >
              Prev
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSearchNext}
              disabled={isSearching || searchHits.length === 0}
              title="Next match"
            >
              Next
            </Button>
            {isSearching ? (
              <span className="text-xs text-muted-foreground">
                {searchProgress.current}/{searchProgress.total}
              </span>
            ) : searchHits.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                {searchIndex + 1}/{searchHits.length}
              </span>
            ) : null}
          </div>
        )}
      </div>
    ),
    [
      contextWindowSize,
      fitMode,
      commitRangeEnd,
      commitRangeStart,
      handleContextWindowChange,
      handlePageInputCommit,
      handleRangeEndChange,
      handleRangeStartChange,
      handleToggleFit,
      handleZoomIn,
      handleZoomOut,
      onRequestOpenFile,
      localAutoFollow,
      numPages,
      pageInput,
      rangeInput.end,
      rangeInput.start,
      showSidebar,
      effectiveScale,
      handleToggleSearch,
      handleSearchNext,
      handleSearchPrev,
      handleSearchSubmit,
      isSearching,
      isSearchOpen,
      searchIndex,
      searchProgress,
      searchQuery,
      searchHits.length,
    ]
  );

  return (
    <Group orientation="horizontal" className="h-full">
      {showSidebar && numPages > 0 && (
        <>
          <Panel
            defaultSize="280px"
            minSize="220px"
            maxSize="400px"
            className="flex flex-col bg-muted/10 !shrink-0"
          >
            <div className="flex items-center border-b">
              <button
                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                  sidebarTab === "outline"
                    ? "border-b-2 border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
                onClick={() => setSidebarTab("outline")}
              >
                Outline
              </button>
              <button
                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors ${
                  sidebarTab === "thumbnails"
                    ? "border-b-2 border-primary text-foreground"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                }`}
                onClick={() => setSidebarTab("thumbnails")}
              >
                Thumbnails
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => setShowSidebar(false)}
              >
                <span className="sr-only">Close sidebar</span>
                &times;
              </Button>
            </div>

            <div className="flex-1 overflow-auto p-2">
              {sidebarTab === "outline" ? (
                hasOutline ? (
                  <div className="space-y-1 pdf-outline">
                    {renderOutlineItems(outlineItems)}
                  </div>
                ) : (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    No outline available
                  </div>
                )
              ) : (
                <Virtuoso
                  style={{ height: "100%" }}
                  totalCount={numPages}
                  itemContent={(index) => {
                    const page = index + 1;
                    return (
                      <MemoizedThumbnailItem
                        key={`${fileKey}-${page}`}
                        pageNumber={page}
                        pdf={pdfDoc}
                        isSelected={
                          page >= pageRange.start && page <= pageRange.end
                        }
                        isCurrent={currentPage === page}
                        onSelect={handleThumbnailSelect}
                      />
                    );
                  }}
                />
              )}
            </div>
          </Panel>
          <Separator className="w-2 bg-border/50 hover:bg-primary/50 transition-colors cursor-col-resize z-50 flex items-center justify-center">
            <div className="h-8 w-1 bg-border rounded-full" />
          </Separator>
        </>
      )}

      <Panel className="relative flex flex-col bg-muted/30">
        {renderToolbar}
        <div className="flex-1 relative w-full h-full overflow-hidden">
          <div
            ref={containerRef}
            className="absolute inset-0 overflow-hidden p-4 pdfViewerContainer"
          >
            {sourceUrl ? (
              <div className="h-full w-full">
                <Document
                  file={sourceUrl}
                  options={documentOptions}
                  onLoadSuccess={handleDocumentLoadSuccess}
                  onLoadError={handleDocumentLoadError}
                  onItemClick={(event) => {
                    if (event?.pageNumber) {
                      scheduleJump(event.pageNumber, 0);
                    }
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
                    initialTopMostItemIndex={Math.max(
                      0,
                      (initialPage ?? 1) - 1
                    )}
                    rangeChanged={handleRangeChanged}
                    defaultItemHeight={
                      pageRenderSize ? pageRenderSize.height + PAGE_GAP : 800
                    }
                    increaseViewportBy={
                      pageRenderSize
                        ? pageRenderSize.height * VIEWPORT_BUFFER_PAGES
                        : 1600
                    }
                    itemContent={(index) => {
                      const pageNumber = index + 1;
                      if (activeQuery) {
                        pageHitCounterRef.current.set(pageNumber, 0);
                      }
                      return (
                        <div
                          className="pdf-page-wrapper"
                          style={
                            pageRenderSize
                              ? { height: pageRenderSize.height + PAGE_GAP }
                              : undefined
                          }
                        >
                          <div className="pdf-page">
                            <Page
                              pageNumber={pageNumber}
                              scale={effectiveScale}
                              renderTextLayer
                              renderAnnotationLayer
                              onLoadSuccess={handlePageLoadSuccess}
                              customTextRenderer={
                                activeQuery
                                  ? makeTextRenderer(pageNumber)
                                  : undefined
                              }
                              devicePixelRatio={
                                typeof window !== "undefined"
                                  ? window.devicePixelRatio || 1
                                  : 1
                              }
                              loading={
                                <div
                                  className="h-48 w-full rounded-lg bg-muted/40 animate-pulse"
                                  aria-label="Loading page"
                                />
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
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No PDF loaded
              </div>
            )}
            {isLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/50 backdrop-blur-sm z-10">
                <div className="flex flex-col items-center gap-2">
                  <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                  <span className="text-sm font-medium">Loading PDF...</span>
                </div>
              </div>
            )}
            {loadError && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-20">
                <div className="bg-destructive/10 text-destructive p-4 rounded-lg flex flex-col items-center gap-2">
                  <p className="font-medium">Error</p>
                  <p>{loadError}</p>
                  <Button variant="outline" onClick={onRequestOpenFile}>
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

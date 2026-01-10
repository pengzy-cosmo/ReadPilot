import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
} from "pdfjs-dist/types/src/display/api";
import {
  EventBus,
  PDFLinkService,
  PDFViewer,
} from "pdfjs-dist/web/pdf_viewer.mjs";

import { Group, Panel, Separator } from "react-resizable-panels";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { memo } from "react";

const PDFJS_CDN_BASE = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/`;
pdfjsLib.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN_BASE}build/pdf.worker.min.mjs`;

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
  rootRef: { current: HTMLDivElement | null };
  isSelected: boolean;
  isCurrent: boolean;
  onSelect: (pageNumber: number, isRange: boolean) => void;
};

const ANNOTATION_MODE = 2; // ENABLE
const TEXT_LAYER_MODE = 1; // ENABLE

const CONTEXT_WINDOW_MIN = 1;
const CONTEXT_WINDOW_MAX = 12;
const THUMBNAIL_TARGET_WIDTH = 120;

const assignOutlineIds = (
  items: OutlineNodeInput[],
  prefix = "outline"
): OutlineNode[] =>
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
  rootRef,
  isSelected,
  isCurrent,
  onSelect,
}: ThumbnailItemProps) {
  const wrapperRef = useRef<HTMLButtonElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = useRef<ReturnType<PDFPageProxy["render"]> | null>(null);
  const [isRendered, setIsRendered] = useState(false);

  useEffect(() => {
    const target = wrapperRef.current;
    const canvas = canvasRef.current;
    if (!target || !canvas || !pdf || isRendered) return;

    let cancelled = false;
    const root = rootRef.current;

    const renderThumbnail = async () => {
      try {
        const page = await pdf.getPage(pageNumber);
        const baseViewport = page.getViewport({ scale: 1 });
        const scale = THUMBNAIL_TARGET_WIDTH / baseViewport.width;
        const viewport = page.getViewport({ scale });
        const outputScale = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const transform:
          | [number, number, number, number, number, number]
          | undefined =
          outputScale !== 1
            ? [outputScale, 0, 0, outputScale, 0, 0]
            : undefined;

        const renderTask = page.render({
          canvasContext: ctx,
          viewport,
          transform,
        });

        renderTaskRef.current = renderTask;
        await renderTask.promise;

        if (!cancelled) {
          setIsRendered(true);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("Failed to render thumbnail:", error);
        }
      }
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          observer.disconnect();
          void renderThumbnail();
        }
      },
      { root, rootMargin: "200px" }
    );

    observer.observe(target);
    return () => {
      cancelled = true;
      observer.disconnect();
      renderTaskRef.current?.cancel?.();
    };
  }, [pageNumber, pdf, rootRef, isRendered]);

  return (
    <button
      ref={wrapperRef}
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
        <div
          className={`w-full rounded-md bg-muted/60 ${
            isRendered ? "hidden" : "block"
          }`}
          style={{ aspectRatio: "3 / 4" }}
        />
        <canvas
          ref={canvasRef}
          className={`block rounded-md ${
            isRendered ? "opacity-100" : "opacity-0"
          }`}
        />
      </div>
      <div className="mt-1 text-xs text-muted-foreground text-right">
        Page {pageNumber}
      </div>
    </button>
  );
}

const MemoizedThumbnailItem = memo(ThumbnailItem);

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
  const [scale, setScale] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [thumbnailAnchor, setThumbnailAnchor] = useState<number | null>(null);
  const fitModeRef = useRef<FitMode>(fitMode);
  const [rangeInput, setRangeInput] = useState({ start: "1", end: "1" });
  const initialPageRef = useRef<number | null>(initialPage ?? null);
  const fileKey = useMemo(() => sourceUrl ?? "empty", [sourceUrl]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const thumbnailRootRef = useRef<HTMLDivElement | null>(null);
  const eventBusRef = useRef<EventBus | null>(null);
  const linkServiceRef = useRef<PDFLinkService | null>(null);
  const pdfViewerRef = useRef<PDFViewer | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const pdfRef = useRef<PDFDocumentProxy | null>(null);
  const outlinePageCacheRef = useRef<Map<string, number>>(new Map());
  const hadOutlineRef = useRef(false);

  const scrollToPage = useCallback((pageNumber: number) => {
    const viewer = pdfViewerRef.current;
    if (viewer) {
      viewer.currentPageNumber = pageNumber;
    }
  }, []);

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
    const viewer = pdfViewerRef.current;
    if (!viewer) return;
    const next = Math.min(viewer.currentScale + 0.1, 3);
    viewer.currentScale = next;
    setScale(next);
  }, []);

  const handleZoomOut = useCallback(() => {
    const viewer = pdfViewerRef.current;
    if (!viewer) return;
    const next = Math.max(viewer.currentScale - 0.1, 0.5);
    viewer.currentScale = next;
    setScale(next);
  }, []);

  const handleToggleFit = useCallback(() => {
    const nextMode = fitMode === "page-width" ? "page-fit" : "page-width";
    setFitMode(nextMode);
    const viewer = pdfViewerRef.current;
    if (viewer) {
      viewer.currentScaleValue = nextMode;
    }
  }, [fitMode]);

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
      scrollToPage(start);
    },
    [getOutlineFlatWithPages, numPages, onPageRangeChange, scrollToPage]
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
      scrollToPage(pageNumber);
    },
    [
      numPages,
      onPageRangeChange,
      scrollToPage,
      thumbnailAnchor,
      setThumbnailAnchor,
    ]
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

  const renderToolbar = useMemo(
    () => (
      <div className="flex items-center gap-2 p-2 border-b bg-muted/50 flex-wrap">
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
                {Math.round(scale * 100)}%
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
                    handleContextWindowChange(parseInt(event.target.value, 10))
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
          </>
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
      scale,
      showSidebar,
    ]
  );

  const cleanupDocument = useCallback(async () => {
    if (loadingTaskRef.current) {
      await loadingTaskRef.current.destroy();
      loadingTaskRef.current = null;
    }
    if (pdfRef.current) {
      await pdfRef.current.destroy();
      pdfRef.current = null;
    }
    setNumPages(0);
    setCurrentPage(1);
    setPageInput("1");
    setOutlineItems([]);
    setHasOutline(false);
    hadOutlineRef.current = false;
    setThumbnailAnchor(null);
    outlinePageCacheRef.current.clear();
    setLoadError(null);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const viewer = viewerRef.current;
    if (!container || !viewer) return;
    if (pdfViewerRef.current) return;

    const eventBus = new EventBus();
    const linkService = new PDFLinkService({ eventBus });
    const pdfViewer = new PDFViewer({
      container,
      viewer,
      eventBus,
      linkService,
      annotationMode: ANNOTATION_MODE,
      textLayerMode: TEXT_LAYER_MODE,
      enableAutoLinking: false,
    });
    linkService.setViewer(pdfViewer);

    eventBus.on("pagesinit", () => {
      pdfViewer.currentScaleValue = fitModeRef.current;
      setScale(pdfViewer.currentScale);
      const targetPage = initialPageRef.current;
      if (targetPage && targetPage >= 1 && targetPage <= pdfViewer.pagesCount) {
        pdfViewer.currentPageNumber = targetPage;
      }
    });

    eventBus.on("pagechanging", (event: { pageNumber: number }) => {
      setCurrentPage(event.pageNumber);
      setPageInput(String(event.pageNumber));
    });

    eventBusRef.current = eventBus;
    linkServiceRef.current = linkService;
    pdfViewerRef.current = pdfViewer;

    return () => {
      eventBusRef.current = null;
      linkServiceRef.current = null;
      pdfViewerRef.current = null;
    };
  }, [sourceUrl]);

  useEffect(() => {
    fitModeRef.current = fitMode;
    const viewer = pdfViewerRef.current;
    if (viewer) {
      viewer.currentScaleValue = fitMode;
      setScale(viewer.currentScale);
    }
  }, [fitMode]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      const viewer = pdfViewerRef.current;
      if (viewer && fitMode === "page-width") {
        viewer.currentScaleValue = "page-width";
        setScale(viewer.currentScale);
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, [fitMode]);

  useEffect(() => {
    const load = async () => {
      if (!sourceUrl) {
        await cleanupDocument();
        const viewer = pdfViewerRef.current;
        const linkService = linkServiceRef.current;
        if (viewer && linkService) {
          viewer.setDocument(null);
          linkService.setDocument(null, null);
        }
        return;
      }

      setIsLoading(true);
      setLoadError(null);
      await cleanupDocument();
      try {
        const loadingTask = pdfjsLib.getDocument({
          url: sourceUrl,
          wasmUrl: `${PDFJS_CDN_BASE}wasm/`,
          cMapUrl: `${PDFJS_CDN_BASE}cmaps/`,
          cMapPacked: true,
          standardFontDataUrl: `${PDFJS_CDN_BASE}standard_fonts/`,
          iccUrl: `${PDFJS_CDN_BASE}iccs/`,
        });
        loadingTaskRef.current = loadingTask;
        const pdf = await loadingTask.promise;
        pdfRef.current = pdf;
        setNumPages(pdf.numPages);
        setCurrentPage(1);
        setPageInput("1");

        const pdfViewer = pdfViewerRef.current;
        const linkService = linkServiceRef.current;
        if (pdfViewer && linkService) {
          pdfViewer.setDocument(pdf);
          linkService.setDocument(pdf, null);
        }

        try {
          const outline = await pdf.getOutline();
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
          console.warn("Failed to load outline:", error);
          setOutlineItems([]);
          setHasOutline(false);
          hadOutlineRef.current = false;
          outlinePageCacheRef.current.clear();
        }
      } catch (error) {
        console.error("Failed to load PDF:", error);
        setLoadError("Failed to load PDF. Please try another file.");
      } finally {
        setIsLoading(false);
      }
    };

    void load();
    return () => {
      void cleanupDocument();
    };
  }, [cleanupDocument, sourceUrl]);

  const handleOutlineClick = useCallback(async (item: OutlineNode) => {
    if (item.url) {
      window.open(item.url, "_blank", "noopener,noreferrer");
      return;
    }

    const pdf = pdfRef.current;
    const viewer = pdfViewerRef.current;
    const linkService = linkServiceRef.current;
    if (!pdf || !viewer || !item.dest) {
      if (linkService && item.dest) {
        linkService.navigateTo(item.dest);
      }
      return;
    }

    try {
      let destination: unknown = item.dest;
      if (typeof destination === "string") {
        destination = await pdf.getDestination(destination);
      }
      if (!Array.isArray(destination) || destination.length === 0) {
        if (linkService) linkService.navigateTo(item.dest);
        return;
      }

      const destinationArray = destination as unknown[];
      const [ref] = destinationArray;
      let pageNumber: number | null = null;
      if (typeof ref === "number") {
        pageNumber = ref + 1;
      } else {
        const pageIndex = await pdf.getPageIndex(ref);
        pageNumber = pageIndex + 1;
      }
      if (!pageNumber) return;

      viewer.scrollPageIntoView({
        pageNumber,
        destArray: destinationArray,
      });
    } catch (error) {
      console.warn("Failed to resolve outline destination:", error);
      if (linkService) {
        linkService.navigateTo(item.dest);
      }
    }
  }, []);

  // Helper for recursive outline render
  const renderOutlineItems = useCallback(
    (items: OutlineNode[]) => {
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

  return (
    <Group orientation="horizontal" className="h-full">
      {/* Sidebar Panel */}
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
                <div className="space-y-2" ref={thumbnailRootRef}>
                  {Array.from({ length: numPages }, (_, i) => i + 1).map(
                    (page) => (
                      <MemoizedThumbnailItem
                        key={`${fileKey}-${page}`}
                        pageNumber={page}
                        pdf={pdfRef.current}
                        rootRef={thumbnailRootRef}
                        isSelected={
                          page >= pageRange.start && page <= pageRange.end
                        }
                        isCurrent={currentPage === page}
                        onSelect={handleThumbnailSelect}
                      />
                    )
                  )}
                </div>
              )}
            </div>
          </Panel>
          <Separator className="w-2 bg-border/50 hover:bg-primary/50 transition-colors cursor-col-resize z-50 flex items-center justify-center">
            <div className="h-8 w-1 bg-border rounded-full" />
          </Separator>
        </>
      )}

      {/* Main Viewer Panel */}
      <Panel className="relative flex flex-col bg-muted/30">
        {renderToolbar}
        <div className="flex-1 relative w-full h-full overflow-hidden">
          <div
            ref={containerRef}
            className="absolute inset-0 overflow-auto p-4 pdfViewerContainer"
          >
            <div className="pdfViewer" ref={viewerRef} />
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

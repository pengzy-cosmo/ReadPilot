import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type {
  PDFDocumentLoadingTask,
  PDFDocumentProxy,
  PDFPageProxy,
} from "pdfjs-dist/types/src/display/api";
import { EventBus, PDFLinkService, PDFViewer } from "pdfjs-dist/web/pdf_viewer";
import "pdfjs-dist/web/pdf_viewer.css";

import { Group, Panel, Separator } from "react-resizable-panels";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

interface PdfViewerProps {
  file: File | null;
  onFileChange: (file: File | null) => void;
  pageRange: { start: number; end: number };
  onPageRangeChange: (range: { start: number; end: number }) => void;
  onCurrentPageChange?: (page: number) => void;
  autoFollow?: boolean;
  contextWindow?: number;
}

type OutlineNodeInput = {
  title: string;
  dest: unknown;
  url?: string | null;
  items?: OutlineNodeInput[];
};

type OutlineNode = OutlineNodeInput & { id: string };

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

const ANNOTATION_MODE =
  (pdfjsLib as { AnnotationMode?: { ENABLE: number } }).AnnotationMode
    ?.ENABLE ?? 2;
const TEXT_LAYER_MODE =
  (pdfjsLib as { TextLayerMode?: { ENABLE: number } }).TextLayerMode?.ENABLE ??
  1;

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
      ...item,
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
        const transform =
          outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;
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

export function PdfViewer({
  file,
  onFileChange,
  pageRange,
  onPageRangeChange,
  onCurrentPageChange,
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
  const fileKey = useMemo(() => {
    if (!file) return "empty";
    return `${file.name}-${file.size}-${file.lastModified}`;
  }, [file]);

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

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = e.target.files?.[0];
      if (selectedFile && selectedFile.type === "application/pdf") {
        onFileChange(selectedFile);
      }
    },
    [onFileChange]
  );

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
      let destination = dest;
      if (typeof destination === "string") {
        destination = await pdf.getDestination(destination);
      }
      if (!Array.isArray(destination) || destination.length === 0) {
        return null;
      }
      const [ref] = destination;
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
        <input
          type="file"
          accept="application/pdf"
          onChange={handleFileSelect}
          className="hidden"
          id="pdf-upload"
        />
        <label htmlFor="pdf-upload">
          <Button variant="outline" size="sm" asChild>
            <span>Open PDF</span>
          </Button>
        </label>

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
      handleFileSelect,
      handlePageInputCommit,
      handleRangeEndChange,
      handleRangeStartChange,
      handleToggleFit,
      handleZoomIn,
      handleZoomOut,
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
  }, [file]);

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
      if (!file) {
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
        const buffer = await file.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: buffer });
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
  }, [cleanupDocument, file]);

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
      let destination = item.dest;
      if (typeof destination === "string") {
        destination = await pdf.getDestination(destination);
      }
      if (!Array.isArray(destination) || destination.length === 0) {
        if (linkService) linkService.navigateTo(item.dest);
        return;
      }

      const [ref] = destination;
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
        destArray: destination,
      });
    } catch (error) {
      console.warn("Failed to resolve outline destination:", error);
      if (linkService) {
        linkService.navigateTo(item.dest);
      }
    }
  }, []);

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

  const renderStatus = () => {
    if (!file) {
      return (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          Click "Open PDF" to load a document
        </div>
      );
    }
    if (isLoading) {
      return (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          Loading PDF...
        </div>
      );
    }
    if (loadError) {
      return (
        <div className="flex items-center justify-center h-64 text-destructive">
          {loadError}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {renderToolbar}
      <div className="flex-1 min-h-0 overflow-hidden bg-muted/30">
        <Group
          orientation="horizontal"
          className="flex h-full min-h-0 min-w-0"
        >
          {showSidebar && (
            <Panel
              defaultSize="22%"
              minSize="15%"
              maxSize="40%"
              className="min-w-0"
            >
              <div className="flex flex-col bg-muted/30 h-full min-h-0">
                <div className="p-2 border-b text-sm flex items-center gap-2">
                  {hasOutline && (
                    <Button
                      variant={sidebarTab === "outline" ? "default" : "ghost"}
                      size="sm"
                      onClick={() => setSidebarTab("outline")}
                    >
                      Outline
                    </Button>
                  )}
                  <Button
                    variant={sidebarTab === "thumbnails" ? "default" : "ghost"}
                    size="sm"
                    onClick={() => setSidebarTab("thumbnails")}
                  >
                    Thumbnails
                  </Button>
                  <div className="ml-auto">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowSidebar(false)}
                    >
                      ×
                    </Button>
                  </div>
                </div>
                <div
                  className="flex-1 min-h-0 overflow-auto"
                  ref={thumbnailRootRef}
                >
                  {sidebarTab === "outline" && hasOutline ? (
                    <div className="p-2 text-sm pdf-outline">
                      {renderOutlineItems(outlineItems)}
                    </div>
                  ) : (
                    <div className="p-2 space-y-2">
                      <div className="text-xs text-muted-foreground">
                        Click to select, Shift-click for range.
                      </div>
                      <div className="grid gap-2">
                        {Array.from({ length: numPages }, (_, index) => {
                          const pageNumber = index + 1;
                          return (
                            <ThumbnailItem
                              key={`thumb-${fileKey}-${pageNumber}`}
                              pageNumber={pageNumber}
                              pdf={pdfRef.current}
                              rootRef={thumbnailRootRef}
                              isSelected={
                                pageNumber >= pageRange.start &&
                                pageNumber <= pageRange.end
                              }
                              isCurrent={pageNumber === currentPage}
                              onSelect={handleThumbnailSelect}
                            />
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </Panel>
          )}

          {showSidebar && (
            <Separator
              style={{
                width: "6px",
                background: "var(--border)",
                cursor: "col-resize",
              }}
              className="shrink-0"
            />
          )}

          <Panel
            defaultSize={showSidebar ? "78%" : "100%"}
            minSize="30%"
            className="min-w-0"
          >
            <div className="relative h-full min-h-0 overflow-hidden">
              <div
                ref={containerRef}
                className="overflow-auto pdfViewerContainer px-4 py-4"
                style={{ position: "absolute", inset: 0 }}
              >
                {renderStatus()}
                <div ref={viewerRef} className="pdfViewer" />
              </div>
            </div>
          </Panel>
        </Group>
      </div>
    </div>
  );
}

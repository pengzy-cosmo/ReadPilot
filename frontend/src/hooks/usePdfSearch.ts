/** usePdfSearch - Full-text PDF search with highlighting and navigation. */
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { useCallback, useRef, useState } from "react";
import { escapeHtml } from "@/lib/pdfHelpers";

type SearchHit = { pageNumber: number; hitIndex: number };

export function usePdfSearch() {
	const [activeQuery, setActiveQuery] = useState("");
	const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
	const [searchIndex, setSearchIndex] = useState(0);
	const [isSearching, setIsSearching] = useState(false);

	// Caches for performance
	const textCacheRef = useRef<Map<number, string[]>>(new Map());
	const pageHitCounterRef = useRef<Map<number, number>>(new Map());
	const searchAbortRef = useRef<{ canceled: boolean } | null>(null);
	const pendingHitRef = useRef<SearchHit | null>(null);

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
		textCacheRef.current.clear();
	}, []);

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
		(pageNumber: number, currentActiveQuery: string, currentSearchHits: SearchHit[], currentSearchIndex: number) => {
			const currentActiveHit = currentSearchHits[currentSearchIndex];
			return ({ str }: { str: string }) => {
				if (!currentActiveQuery) return escapeHtml(str);
				const escapedQuery = currentActiveQuery.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
							currentActiveHit && currentActiveHit.pageNumber === pageNumber && currentActiveHit.hitIndex === hitIndex;
						const className = isActive ? "pdf-search-hit pdf-search-hit--active" : "pdf-search-hit";
						result += `<mark class="${className}" data-page="${pageNumber}" data-hit="${hitIndex}">${escapeHtml(matches[index])}</mark>`;
					}
				});
				return result;
			};
		},
		[getNextHitIndex],
	);

	/** Scan a single page for text matches. */
	const scanPageForMatches = useCallback(
		async (pdf: PDFDocumentProxy, pageNumber: number, regex: RegExp): Promise<SearchHit[]> => {
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
			const hits: SearchHit[] = [];
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
		async (
			query: string,
			pdfDoc: PDFDocumentProxy | null,
			currentPage: number,
			onJumpToPage: (page: number) => void,
		) => {
			const trimmed = query.trim();
			if (!pdfDoc || !trimmed) {
				clearSearch();
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

			const total = pdfDoc.numPages;
			const startPage = currentPage;
			const escapedQuery = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
			const regex = new RegExp(escapedQuery, "gi");

			// Results from current page to end (forward matches)
			const forwardMatches: SearchHit[] = [];
			// Results from page 1 to current page - 1 (wrapped matches)
			const wrappedMatches: SearchHit[] = [];

			let firstMatchShown = false;

			// Phase 1: Search from current page to end
			for (let pageNumber = startPage; pageNumber <= total; pageNumber += 1) {
				if (token.canceled) return;
				const pageHits = await scanPageForMatches(pdfDoc, pageNumber, regex);
				if (token.canceled) return;
				if (pageHits.length > 0) {
					forwardMatches.push(...pageHits);
					// Show first match immediately for responsive feedback
					if (!firstMatchShown) {
						firstMatchShown = true;
						setSearchHits([...forwardMatches]);
						setSearchIndex(0);
						onJumpToPage(pageHits[0].pageNumber);
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
				const pageHits = await scanPageForMatches(pdfDoc, pageNumber, regex);
				if (token.canceled) return;
				if (pageHits.length > 0) {
					wrappedMatches.push(...pageHits);
					if (!firstMatchShown) {
						firstMatchShown = true;
						setSearchHits([...wrappedMatches]);
						setSearchIndex(0);
						onJumpToPage(pageHits[0].pageNumber);
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
		[clearSearch, scanPageForMatches],
	);

	const navigatePrev = useCallback(() => {
		setSearchIndex((prev) => {
			if (searchHits.length === 0) return prev;
			return (prev - 1 + searchHits.length) % searchHits.length;
		});
	}, [searchHits.length]);

	const navigateNext = useCallback(() => {
		setSearchIndex((prev) => {
			if (searchHits.length === 0) return prev;
			return (prev + 1) % searchHits.length;
		});
	}, [searchHits.length]);

	/** Scroll to pending search hit element after render. */
	const scrollToPendingHit = useCallback((containerEl: HTMLElement | null) => {
		const pending = pendingHitRef.current;
		if (!pending || !containerEl) return;
		const selector = `.pdf-search-hit[data-page="${pending.pageNumber}"][data-hit="${pending.hitIndex}"]`;
		const mark = containerEl.querySelector(selector);
		if (mark) {
			pendingHitRef.current = null;
			mark.scrollIntoView({ block: "start", inline: "nearest" });
		}
	}, []);

	return {
		activeQuery,
		searchHits,
		searchIndex,
		isSearching,
		pendingHitRef,
		clearSearch,
		runSearch,
		navigatePrev,
		navigateNext,
		makeTextRenderer,
		scrollToPendingHit,
		// Reset hit counter for each page render
		resetPageHitCounter: (pageNumber: number) => pageHitCounterRef.current.set(pageNumber, 0),
	};
}

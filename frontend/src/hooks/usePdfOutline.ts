/** usePdfOutline - PDF outline/bookmarks resolution and navigation. */
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import { useCallback, useRef } from "react";
import { assignOutlineIds, isRefProxyValue, type OutlineNode, type OutlineNodeInput } from "@/lib/pdfHelpers";

export function usePdfOutline() {
	const outlinePageCacheRef = useRef<Map<string, number>>(new Map());

	/** Resolve PDF destination to page number. */
	const resolveDestPageNumber = useCallback(async (pdfDoc: PDFDocumentProxy | null, dest: unknown) => {
		if (!pdfDoc || !dest) return null;
		try {
			let destination: unknown = dest;
			if (typeof destination === "string") destination = await pdfDoc.getDestination(destination);
			if (!Array.isArray(destination) || destination.length === 0) return null;
			const [ref] = destination as unknown[];
			if (typeof ref === "number") return ref + 1;
			if (!isRefProxyValue(ref)) return null;
			const pageIndex = await pdfDoc.getPageIndex(ref);
			return pageIndex + 1;
		} catch (error) {
			console.warn("Failed to resolve outline page number:", error);
			return null;
		}
	}, []);

	/** Handle outline item click - navigate to page with optional Y offset. */
	const navigateToOutlineItem = useCallback(
		async (
			item: OutlineNode,
			pdfDoc: PDFDocumentProxy | null,
			effectiveScale: number,
			onJump: (pageNumber: number, offset: number) => void,
		) => {
			if (item.url) {
				window.open(item.url, "_blank", "noopener,noreferrer");
				return;
			}
			if (!pdfDoc || !item.dest) return;

			try {
				let destination: unknown = item.dest;
				if (typeof destination === "string") destination = await pdfDoc.getDestination(destination);
				if (!Array.isArray(destination) || destination.length === 0) return;
				const [ref] = destination as unknown[];
				let pageNumber: number | null = null;
				if (typeof ref === "number") pageNumber = ref + 1;
				else if (isRefProxyValue(ref)) {
					const pageIndex = await pdfDoc.getPageIndex(ref);
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
					const page = await pdfDoc.getPage(pageNumber);
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
				onJump(pageNumber, offset);
			} catch (error) {
				console.warn("Failed to resolve outline destination:", error);
			}
		},
		[],
	);

	/** Load and assign IDs to outline items. */
	const loadOutline = useCallback(async (pdfDoc: PDFDocumentProxy | null): Promise<OutlineNode[]> => {
		if (!pdfDoc) return [];
		try {
			const outline = await pdfDoc.getOutline();
			return assignOutlineIds((outline ?? []) as OutlineNodeInput[]);
		} catch (error) {
			console.warn("Failed to load outline:", error);
			return [];
		}
	}, []);

	const clearCache = useCallback(() => {
		outlinePageCacheRef.current.clear();
	}, []);

	return {
		resolveDestPageNumber,
		navigateToOutlineItem,
		loadOutline,
		outlinePageCacheRef,
		clearCache,
	};
}

/** pdfHelpers - PDF.js utility functions and type guards. */
import type { PDFDocumentProxy, RefProxy } from "pdfjs-dist/types/src/display/api";

export type OutlineNodeInput = {
	title: string;
	dest: unknown;
	url?: string | null;
	items?: OutlineNodeInput[];
};

export type OutlineNode = {
	id: string;
	title: string;
	dest: unknown;
	url?: string | null;
	items?: OutlineNode[];
};

/** Type guard for PDF.js RefProxy objects (internal page references). */
export const isRefProxyValue = (value: unknown): value is RefProxy => {
	if (!value || typeof value !== "object") return false;
	const ref = value as { num?: unknown; gen?: unknown };
	return typeof ref.num === "number" && typeof ref.gen === "number";
};

/** Assign unique IDs to outline nodes for React keys and selection tracking. */
export const assignOutlineIds = (items: OutlineNodeInput[], prefix = "outline"): OutlineNode[] =>
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

/** Normalize PDF document from react-pdf load callback. */
export const normalizePdfFromLoad = (value: PDFDocumentProxy | { pdf?: PDFDocumentProxy }): PDFDocumentProxy => {
	if (value && typeof value === "object" && "pdf" in value && (value as { pdf?: PDFDocumentProxy }).pdf) {
		return (value as { pdf: PDFDocumentProxy }).pdf;
	}
	return value as PDFDocumentProxy;
};

/** Escape HTML special characters for safe innerHTML rendering. */
export const escapeHtml = (value: string) => {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
};

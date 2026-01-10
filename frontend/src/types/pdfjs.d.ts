declare module "pdfjs-dist/web/pdf_viewer.mjs" {
	type PdfDocument = unknown;
	type PdfLayer = unknown;
	type PdfEvent = unknown;
	type PdfDest = unknown;

	export class EventBus {
		on(eventName: string, listener: (event: PdfEvent) => void): void;
		off(eventName: string, listener: (event: PdfEvent) => void): void;
		dispatch(eventName: string, data?: PdfEvent): void;
	}

	export class PDFLinkService {
		constructor(options: { eventBus: EventBus });
		setViewer(viewer: PDFViewer): void;
		setDocument(pdf: PdfDocument | null, layer: PdfLayer | null): void;
		navigateTo(dest: PdfDest): void;
	}

	export class PDFViewer {
		constructor(options: {
			container: HTMLElement;
			viewer: HTMLElement;
			eventBus: EventBus;
			linkService: PDFLinkService;
			annotationMode?: number;
			textLayerMode?: number;
			enableAutoLinking?: boolean;
		});
		currentScaleValue: string | number;
		currentScale: number;
		pagesCount: number;
		currentPageNumber: number;
		setDocument(pdf: PdfDocument | null): void;
		scrollPageIntoView(args: { pageNumber: number; destArray?: unknown[] }): void;
	}
}

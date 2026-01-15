/** App - Main application: PDF viewer (left) + AI chat (right). */
import { useCallback, useEffect, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Toaster, toast } from "sonner";
import { ApiSettings } from "@/components/ApiSettings";
import { BookshelfModal } from "@/components/BookshelfModal";
import { ChatPanel } from "@/components/ChatPanel";
import { Header } from "@/components/Header";
import { Layout } from "@/components/Layout";
import { PdfViewer } from "@/components/PdfViewer";
import { SessionListModal } from "@/components/SessionListModal";
import { UploadZone } from "@/components/UploadZone";
import { type BookContext, type Message, useChat } from "@/hooks/useChat";
import {
	clearMessages,
	createSession,
	type DocumentInfo,
	formatOutline,
	getDocument,
	getDocumentFileUrl,
	getSession,
	importDocument,
	listDocuments,
	listMessages,
	listSessions,
	type MessageInfo,
	type SessionInfo,
	updateDocumentState,
	updateSessionTitle,
} from "@/lib/api";
import { loadApiConfig } from "@/lib/apiConfig";

function App() {
	const [docId, setDocId] = useState<string | null>(null);
	const [docInfo, setDocInfo] = useState<DocumentInfo | null>(null);
	const [fileUrl, setFileUrl] = useState<string | null>(null);
	const [isUploading, setIsUploading] = useState(false);
	const [initialLoading, setInitialLoading] = useState(true);
	const [pageRange, setPageRange] = useState({ start: 1, end: 7 });
	const [currentPage, setCurrentPage] = useState(1);
	const [initialPage, setInitialPage] = useState(1);
	const [outline, setOutline] = useState<string | undefined>();
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [sessionTitle, setSessionTitle] = useState<string | null>(null);
	const [sessionSubtitle, setSessionSubtitle] = useState<string | null>(null);
	const [apiConfig, setApiConfig] = useState(loadApiConfig);
	const [showSettings, setShowSettings] = useState(false);
	const [showBookshelf, setShowBookshelf] = useState(false);
	const [bookshelfDocs, setBookshelfDocs] = useState<DocumentInfo[]>([]);
	const [showSessions, setShowSessions] = useState(false);
	const [sessionList, setSessionList] = useState<SessionInfo[]>([]);
	const [selectedTexts, setSelectedTexts] = useState<string[]>([]);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const messageCountRef = useRef(0);
	const sessionRef = useRef<string | null>(null);
	const userSelectedRef = useRef(false);

	const { messages, isLoading, streamingContent, streamingMeta, sendMessage, replaceMessages } = useChat(apiConfig);

	const refreshRecentDocs = useCallback(async () => {
		const docs = await listDocuments(100);
		setBookshelfDocs(docs);
	}, []);

	const loadSessionsForDoc = useCallback(async (nextDocId: string | null) => {
		if (!nextDocId) {
			setSessionList([]);
			return;
		}
		const sessions = await listSessions(nextDocId);
		setSessionList(sessions);
	}, []);

	const mapStoredMessages = useCallback(
		(items: MessageInfo[]): Message[] =>
			items.map((item) => ({
				id: item.message_id,
				role: item.role,
				content: item.content,
				meta:
					item.page_start != null && item.page_end != null
						? { pageStart: item.page_start, pageEnd: item.page_end }
						: undefined,
			})),
		[],
	);

	const deriveSessionTitle = useCallback((items: Message[]) => {
		const firstUser = items.find((message) => message.role === "user" && message.content.trim().length > 0);
		if (!firstUser) return null;
		const trimmed = firstUser.content.trim();
		return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
	}, []);

	const formatSessionSubtitle = useCallback((session?: SessionInfo | null) => {
		if (!session) return null;
		const updated = new Date(session.updated_at).toLocaleString();
		return `Updated · ${updated}`;
	}, []);

	const applyDocumentState = useCallback((info: DocumentInfo) => {
		setDocId(info.doc_id);
		setDocInfo(info);
		setFileUrl(getDocumentFileUrl(info.doc_id));
		// Pre-format outline for the chat context prompt.
		setOutline(info.outline.length > 0 ? formatOutline(info.outline) : undefined);
		const nextRange = {
			start: info.range_start || 1,
			end: info.range_end || 7,
		};
		const nextPage = info.last_page || 1;
		setPageRange(nextRange);
		setCurrentPage(nextPage);
		setInitialPage(nextPage);
	}, []);

	const ensureSessionForDoc = useCallback(
		async (info: DocumentInfo) => {
			// Reuse the last session if available; otherwise create a new one.
			let targetSessionId = info.last_session_id;
			if (!targetSessionId) {
				const session = await createSession(info.doc_id);
				targetSessionId = session.session_id;
			}
			setSessionId(targetSessionId);
			setSessionTitle(null);
			setSessionSubtitle(null);
			replaceMessages([]);
		},
		[replaceMessages],
	);

	// Auto-load the most recent document on startup
	useEffect(() => {
		let cancelled = false;
		const loadRecent = async () => {
			try {
				const docs = await listDocuments(1);
				if (cancelled || userSelectedRef.current) return;
				if (docs.length > 0) {
					// Open the most recently accessed document
					const info = await getDocument(docs[0].doc_id);
					if (cancelled || userSelectedRef.current) return;
					applyDocumentState(info);
					await ensureSessionForDoc(info);
					await refreshRecentDocs();
				}
			} catch (error) {
				console.error("Failed to load recent document:", error);
			} finally {
				if (!cancelled) setInitialLoading(false);
			}
		};
		void loadRecent();
		return () => {
			cancelled = true;
		};
	}, [applyDocumentState, ensureSessionForDoc, refreshRecentDocs]);

	const openDocumentById = useCallback(
		async (nextDocId: string) => {
			userSelectedRef.current = true;
			setIsUploading(true);
			try {
				const info = await getDocument(nextDocId);
				applyDocumentState(info);
				await ensureSessionForDoc(info);
				await refreshRecentDocs();
			} catch (error) {
				console.error("Failed to open document:", error);
				toast.error("Failed to open document.");
			} finally {
				setIsUploading(false);
			}
		},
		[applyDocumentState, ensureSessionForDoc, refreshRecentDocs],
	);

	const importAndOpen = useCallback(
		async (file: File) => {
			userSelectedRef.current = true;
			setIsUploading(true);
			try {
				const info = await importDocument(file);
				applyDocumentState(info);
				await ensureSessionForDoc(info);
				await refreshRecentDocs();
			} catch (error) {
				console.error("Failed to import PDF:", error);
				toast.error("Failed to import PDF.");
			} finally {
				setIsUploading(false);
			}
		},
		[applyDocumentState, ensureSessionForDoc, refreshRecentDocs],
	);

	const handleFileInputChange = useCallback(
		async (event: React.ChangeEvent<HTMLInputElement>) => {
			const selectedFile = event.target.files?.[0];
			event.target.value = "";
			if (!selectedFile) return;
			await importAndOpen(selectedFile);
		},
		[importAndOpen],
	);

	const handleZoneSelect = useCallback(
		(file: File) => {
			void importAndOpen(file);
		},
		[importAndOpen],
	);

	useEffect(() => {
		if (!sessionId) return;
		let cancelled = false;
		const load = async () => {
			try {
				const [storedMessages, session] = await Promise.all([listMessages(sessionId), getSession(sessionId)]);
				if (cancelled) return;
				sessionRef.current = sessionId;
				const mapped = mapStoredMessages(storedMessages);
				// Track how many messages were loaded to avoid re-deriving titles.
				messageCountRef.current = mapped.length;
				replaceMessages(mapped);
				const derivedTitle = session.title ?? deriveSessionTitle(mapped) ?? null;
				if (!session.title && derivedTitle) {
					void updateSessionTitle(sessionId, derivedTitle);
				}
				setSessionTitle(derivedTitle);
				setSessionSubtitle(formatSessionSubtitle(session));
			} catch (error) {
				console.error("Failed to load session:", error);
				toast.error("Failed to load session.");
			}
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, [deriveSessionTitle, formatSessionSubtitle, mapStoredMessages, replaceMessages, sessionId]);

	useEffect(() => {
		if (!sessionId) return;
		if (sessionRef.current !== sessionId) {
			sessionRef.current = sessionId;
			messageCountRef.current = 0;
		}
		if (messages.length <= messageCountRef.current) return;
		const pending = messages.slice(messageCountRef.current);
		messageCountRef.current = messages.length;
		const timestamp = new Date().toLocaleString();
		if (!sessionTitle) {
			const derived = deriveSessionTitle(pending);
			if (derived) {
				setSessionTitle(derived);
				setSessionSubtitle(`Updated · ${timestamp}`);
				void updateSessionTitle(sessionId, derived);
				return;
			}
		}
		setSessionSubtitle(`Updated · ${timestamp}`);
	}, [deriveSessionTitle, messages, sessionId, sessionTitle]);

	// Persist document state (page position, range, session) with debounce
	useEffect(() => {
		if (!docId) return;
		const timer = setTimeout(() => {
			void updateDocumentState(docId, {
				last_page: currentPage,
				range_start: pageRange.start,
				range_end: pageRange.end,
				last_session_id: sessionId ?? null,
			});
		}, 400);
		return () => clearTimeout(timer);
	}, [currentPage, docId, pageRange.start, pageRange.end, sessionId]);

	const getBookContext = useCallback((): BookContext => {
		// Provide document context to the LLM without extra API roundtrips.
		return {
			title: docInfo?.title || docInfo?.filename,
			totalPages: docInfo?.total_pages,
			currentPage,
			selectedRange: `${pageRange.start}-${pageRange.end}`,
			outline,
			highlights: selectedTexts.length > 0 ? selectedTexts : undefined,
		};
	}, [docInfo, currentPage, pageRange, outline, selectedTexts]);

	const handleAddSelection = useCallback((text: string) => {
		setSelectedTexts((prev) => {
			// Limit to 5 highlights max
			if (prev.length >= 5) {
				return prev;
			}
			// Avoid duplicates
			if (prev.includes(text)) {
				return prev;
			}
			return [...prev, text];
		});
	}, []);

	const handleRemoveSelection = useCallback((index: number) => {
		setSelectedTexts((prev) => prev.filter((_, i) => i !== index));
	}, []);

	const handleRequestOpenFile = useCallback(() => {
		fileInputRef.current?.click();
	}, []);

	const handleOpenBookshelf = useCallback(async () => {
		setShowBookshelf(true);
		await refreshRecentDocs();
	}, [refreshRecentDocs]);

	const handleOpenRecent = useCallback(
		async (nextDocId: string) => {
			await openDocumentById(nextDocId);
		},
		[openDocumentById],
	);

	const handleNewSession = useCallback(async () => {
		if (!docId) return;
		const session = await createSession(docId);
		setSessionId(session.session_id);
		replaceMessages([]);
		setSessionTitle(null);
		setSessionSubtitle(null);
		if (showSessions) {
			void loadSessionsForDoc(docId);
		}
	}, [docId, loadSessionsForDoc, replaceMessages, showSessions]);

	const handleOpenSessionList = useCallback(() => {
		if (!docId) return;
		setShowSessions(true);
		void loadSessionsForDoc(docId);
	}, [docId, loadSessionsForDoc]);

	const handleOpenSession = useCallback(
		async (targetSessionId: string) => {
			if (!docId) return;
			setShowSessions(false);
			if (targetSessionId === sessionId) return;
			setSessionId(targetSessionId);
			replaceMessages([]);
			void updateDocumentState(docId, { last_session_id: targetSessionId });
		},
		[docId, replaceMessages, sessionId],
	);

	const handleClearSession = useCallback(async () => {
		if (!sessionId) return;
		replaceMessages([]);
		messageCountRef.current = 0;
		// Parallel execution - these operations are independent
		await Promise.all([clearMessages(sessionId), updateSessionTitle(sessionId, null)]);
		setSessionTitle(null);
		setSessionSubtitle(null);
		if (showSessions && docId) {
			void loadSessionsForDoc(docId);
		}
	}, [docId, loadSessionsForDoc, replaceMessages, sessionId, showSessions]);

	const handleSendMessage = useCallback(
		async (question: string) => {
			if (!docId || !sessionId) return;
			await sendMessage(docId, sessionId, pageRange.start, pageRange.end, question, getBookContext());
			if (showSessions && docId) {
				void loadSessionsForDoc(docId);
			}
			// Auto-clear highlights after sending to keep context fresh
			setSelectedTexts([]);
		},
		[docId, sessionId, pageRange, sendMessage, getBookContext, showSessions, loadSessionsForDoc],
	);

	const handleExplainSelection = useCallback(
		async (text: string) => {
			if (!docId || !sessionId) return;
			// Construct a direct question with the quoted text
			const question = `Please explain the following text:\n\n> ${text}`;
			// Send immediately. Note: we don't add to selectedTexts state as it's a one-off action.
			await sendMessage(docId, sessionId, pageRange.start, pageRange.end, question, getBookContext());
			// Clear any existing selections to avoid confusion
			setSelectedTexts([]);
		},
		[docId, sessionId, pageRange, sendMessage, getBookContext],
	);

	const handleSummarize = useCallback(() => {
		const prompt = `Please summarize the content of pages ${pageRange.start}-${pageRange.end}. Provide a clear and concise summary highlighting the main points.`;
		handleSendMessage(prompt);
	}, [pageRange, handleSendMessage]);

	const handleDeleteDocument = useCallback(
		async (deletedDocId: string) => {
			await refreshRecentDocs();
			if (docId === deletedDocId) {
				setDocId(null);
				setDocInfo(null);
				setFileUrl(null);
				setSessionId(null);
				setSessionList([]);
				replaceMessages([]);
				setOutline(undefined);
				setSessionTitle(null);
				setSessionSubtitle(null);
			}
		},
		[docId, refreshRecentDocs, replaceMessages],
	);

	const handleDeleteSession = useCallback(
		async (deletedSessionId: string) => {
			if (docId) {
				await loadSessionsForDoc(docId);
			}
			if (sessionId === deletedSessionId) {
				setSessionId(null);
				replaceMessages([]);
				setSessionTitle(null);
				setSessionSubtitle(null);
			}
		},
		[docId, sessionId, loadSessionsForDoc, replaceMessages],
	);

	return (
		<Layout>
			<Toaster position="top-center" richColors closeButton />

			<input
				ref={fileInputRef}
				type="file"
				accept="application/pdf"
				className="hidden"
				onChange={handleFileInputChange}
			/>

			<Header
				isUploading={isUploading}
				onOpenLibrary={handleOpenBookshelf}
				onOpenSettings={() => setShowSettings(true)}
			/>
			<div className="h-14 shrink-0" />

			{!docId ? (
				<UploadZone onFileSelect={handleZoneSelect} isUploading={isUploading || initialLoading} />
			) : (
				<Group orientation="horizontal" style={{ flex: 1, overflow: "hidden" }} className="min-w-0">
					<Panel defaultSize={75} minSize={20} className="bg-muted/30">
						<PdfViewer
							sourceUrl={fileUrl}
							onRequestOpenFile={handleRequestOpenFile}
							pageRange={pageRange}
							onPageRangeChange={setPageRange}
							onCurrentPageChange={setCurrentPage}
							onTextSelect={handleAddSelection}
							onExplainText={handleExplainSelection}
							initialPage={initialPage}
							autoFollow={true}
							contextWindow={3}
						/>
					</Panel>

					<Separator
						style={{
							width: "1px",
							background: "var(--border)",
							cursor: "col-resize",
						}}
						className="shrink-0 transition-colors hover:bg-primary/50"
					/>

					<Panel defaultSize={25} minSize={25} className="bg-background relative h-full flex flex-col min-h-0 min-w-0">
						<ChatPanel
							onSendMessage={handleSendMessage}
							onSummarize={handleSummarize}
							onNewSession={handleNewSession}
							onClear={handleClearSession}
							onOpenSessions={handleOpenSessionList}
							sessionTitle={sessionTitle}
							sessionSubtitle={sessionSubtitle}
							pageRange={docId ? pageRange : null}
							selectedTexts={selectedTexts}
							onRemoveSelection={handleRemoveSelection}
							messages={messages}
							isLoading={isLoading}
							streamingContent={streamingContent}
							streamingMeta={streamingMeta}
							disabled={!docId || !sessionId || isUploading}
						/>
					</Panel>
				</Group>
			)}

			<BookshelfModal
				isOpen={showBookshelf}
				onClose={() => setShowBookshelf(false)}
				documents={bookshelfDocs}
				onOpenDocument={(nextDocId) => {
					setShowBookshelf(false);
					void handleOpenRecent(nextDocId);
				}}
				onImportClick={() => {
					setShowBookshelf(false);
					handleRequestOpenFile();
				}}
				onDelete={handleDeleteDocument}
			/>
			<SessionListModal
				isOpen={showSessions}
				onClose={() => setShowSessions(false)}
				sessions={sessionList}
				activeSessionId={sessionId}
				onOpenSession={(nextSessionId) => {
					void handleOpenSession(nextSessionId);
				}}
				onDelete={handleDeleteSession}
			/>
			<ApiSettings
				isOpen={showSettings}
				onClose={() => setShowSettings(false)}
				config={apiConfig}
				onSave={setApiConfig}
			/>
		</Layout>
	);
}

export default App;

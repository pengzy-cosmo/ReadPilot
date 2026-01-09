import { useState, useCallback, useEffect, useRef } from "react";
import { Panel, Group, Separator } from "react-resizable-panels";
import { Toaster, toast } from "sonner";

import { PdfViewer } from "@/components/PdfViewer";
import { ChatPanel } from "@/components/ChatPanel";
import { ApiSettings } from "@/components/ApiSettings";
import { BookshelfModal } from "@/components/BookshelfModal";
import { SessionListModal } from "@/components/SessionListModal";
import { Layout } from "@/components/Layout";
import { Header } from "@/components/Header";
import { UploadZone } from "@/components/UploadZone";

import { loadApiConfig } from "@/lib/apiConfig";
import { useChat, type BookContext, type Message } from "@/hooks/useChat";
import { uploadPDF, formatOutline, type PDFInfo } from "@/lib/api";
import {
  appendMessages,
  buildDocKey,
  clearSessionMessages,
  createSession,
  getDocument,
  getRecentDocuments,
  getSession,
  listSessions,
  loadMessages,
  touchSession,
  updateSessionTitle,
  updateDocument,
  upsertDocument,
  type DocumentRecord,
  type SessionRecord,
  type StoredMessage,
} from "@/lib/readingStore";

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfId, setPdfId] = useState<string | null>(null);
  const [pdfInfo, setPdfInfo] = useState<PDFInfo | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [pageRange, setPageRange] = useState({ start: 1, end: 7 });
  const [currentPage, setCurrentPage] = useState(1);
  const [initialPage, setInitialPage] = useState(1);
  const [outline, setOutline] = useState<string | undefined>();
  const [docKey, setDocKey] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [sessionSubtitle, setSessionSubtitle] = useState<string | null>(null);
  const [apiConfig, setApiConfig] = useState(loadApiConfig);
  const [showSettings, setShowSettings] = useState(false);
  const [showBookshelf, setShowBookshelf] = useState(false);
  const [bookshelfDocs, setBookshelfDocs] = useState<DocumentRecord[]>([]);
  const [showSessions, setShowSessions] = useState(false);
  const [sessionList, setSessionList] = useState<SessionRecord[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const pendingOpenRef = useRef<{
    expectedDocKey?: string;
    sessionId?: string;
    createNewSession?: boolean;
  } | null>(null);
  const persistedCountRef = useRef(0);
  const sessionRef = useRef<string | null>(null);
  const {
    messages,
    isLoading,
    streamingContent,
    streamingMeta,
    sendMessage,
    replaceMessages,
  } = useChat(apiConfig);

  const refreshRecentDocs = useCallback(async () => {
    const docs = await getRecentDocuments(12);
    setBookshelfDocs(docs);
  }, []);

  const loadSessionsForDoc = useCallback(async (nextDocKey: string | null) => {
    if (!nextDocKey) {
      setSessionList([]);
      return;
    }
    const sessions = await listSessions(nextDocKey);
    setSessionList(sessions);
  }, []);

  const mapStoredMessages = useCallback(
    (items: StoredMessage[]): Message[] =>
      items.map((item) => ({
        role: item.role,
        content: item.content,
        meta: item.meta,
      })),
    []
  );

  const deriveSessionTitle = useCallback((items: Message[]) => {
    const firstUser = items.find(
      (message) => message.role === "user" && message.content.trim().length > 0
    );
    if (!firstUser) return null;
    const trimmed = firstUser.content.trim();
    return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
  }, []);

  const formatSessionSubtitle = useCallback((session?: SessionRecord | null) => {
    if (!session) return null;
    const updated = new Date(session.updatedAt).toLocaleString();
    return `Updated · ${updated}`;
  }, []);

  const openDocument = useCallback(
    async (params: {
      file: File;
      handle?: FileSystemFileHandle | null;
      expectedDocKey?: string;
      sessionId?: string;
      createNewSession?: boolean;
    }) => {
      const { file, handle, expectedDocKey, sessionId, createNewSession } =
        params;
      const nextDocKey = buildDocKey(file);
      if (expectedDocKey && expectedDocKey !== nextDocKey) {
        toast.error("Selected file does not match the expected document.");
        return;
      }

      const existing = await getDocument(nextDocKey);
      const nextRange = existing?.pageRange ?? { start: 1, end: 7 };
      const nextPage = existing?.lastPage ?? 1;
      let targetSessionId = sessionId ?? existing?.lastSessionId;
      if (!targetSessionId || createNewSession) {
        const session = await createSession(nextDocKey);
        targetSessionId = session.sessionId;
      }

      const titleFallback = file.name.replace(/\.pdf$/i, "");
      const record: DocumentRecord = {
        docKey: nextDocKey,
        title: existing?.title || titleFallback,
        fileName: file.name,
        fileSize: file.size,
        lastModified: file.lastModified,
        lastOpenedAt: Date.now(),
        lastPage: nextPage,
        pageRange: nextRange,
        totalPages: existing?.totalPages,
        lastSessionId: targetSessionId,
        fileHandle: handle ?? existing?.fileHandle ?? null,
      };

      await upsertDocument(record);
      setDocKey(nextDocKey);
      setFile(file);
      setIsUploading(true);
      setPdfId(null);
      setPdfInfo(null);
      setOutline(undefined);
      setCurrentPage(nextPage);
      setInitialPage(nextPage);
      setPageRange(nextRange);
      setSessionId(targetSessionId);
      setSessionTitle(null);
      setSessionSubtitle(null);
      replaceMessages([]);
      await refreshRecentDocs();
    },
    [refreshRecentDocs, replaceMessages]
  );

  const ensureHandlePermission = useCallback(
    async (handle: FileSystemFileHandle) => {
      try {
        const options = { mode: "read" as const };
        if (handle.queryPermission) {
          const status = await handle.queryPermission(options);
          if (status === "granted") return true;
          const request = await handle.requestPermission(options);
          return request === "granted";
        }
        return true;
      } catch (error) {
        console.warn("Failed to request file permission:", error);
        return false;
      }
    },
    []
  );

  const openFromHandle = useCallback(
    async (
      handle: FileSystemFileHandle,
      options?: {
        expectedDocKey?: string;
        sessionId?: string;
        createNewSession?: boolean;
      }
    ) => {
      const allowed = await ensureHandlePermission(handle);
      if (!allowed) {
        toast.error("File permission denied.");
        return;
      }
      const file = await handle.getFile();
      await openDocument({
        file,
        handle,
        expectedDocKey: options?.expectedDocKey,
        sessionId: options?.sessionId,
        createNewSession: options?.createNewSession,
      });
    },
    [ensureHandlePermission, openDocument]
  );

  const openFilePicker = useCallback(
    async (options?: {
      expectedDocKey?: string;
      sessionId?: string;
      createNewSession?: boolean;
    }) => {
      const picker = window.showOpenFilePicker;
      if (picker) {
        try {
          const [handle] = await picker({
            multiple: false,
            types: [
              {
                description: "PDF",
                accept: { "application/pdf": [".pdf"] },
              },
            ],
          });
          await openFromHandle(handle, options);
          return;
        } catch (error) {
          const name =
            error instanceof DOMException ? error.name : "UnknownError";
          if (name === "AbortError") {
            return;
          }
          console.warn("Failed to open file picker:", error);
        }
      }
      pendingOpenRef.current = options ?? null;
      fileInputRef.current?.click();
    },
    [openFromHandle]
  );

  const handleFileInputChange = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const selectedFile = event.target.files?.[0];
      event.target.value = "";
      if (!selectedFile) return;
      const pending = pendingOpenRef.current;
      pendingOpenRef.current = null;
      await openDocument({
        file: selectedFile,
        expectedDocKey: pending?.expectedDocKey,
        sessionId: pending?.sessionId,
        createNewSession: pending?.createNewSession,
      });
    },
    [openDocument]
  );

  // Called by UploadZone when a file is dropped or selected
  const handleZoneSelect = useCallback(
    (file: File) => {
      void openDocument({ file });
    },
    [openDocument]
  );

  // Upload file to backend when file changes
  useEffect(() => {
    if (file) {
      // Upload to backend
      uploadPDF(file)
        .then((info) => {
          setPdfId(info.pdf_id);
          setPdfInfo(info);
          if (info.outline.length > 0) {
            setOutline(formatOutline(info.outline));
          }
        })
        .catch((error) => {
          console.error("Failed to upload PDF:", error);
          toast.error("Failed to upload PDF to server.");
          setPdfId(null);
          setPdfInfo(null);
        })
        .finally(() => {
          setIsUploading(false);
        });
    }
  }, [file]);

  useEffect(() => {
    if (!docKey || !pdfInfo) return;
    void updateDocument(docKey, {
      title: pdfInfo.title || file?.name.replace(/\.pdf$/i, "") || "Untitled",
      totalPages: pdfInfo.total_pages,
    });
  }, [docKey, file, pdfInfo]);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    const load = async () => {
      const [storedMessages, session] = await Promise.all([
        loadMessages(sessionId),
        getSession(sessionId),
      ]);
      if (cancelled) return;
      const mapped = mapStoredMessages(storedMessages);
      persistedCountRef.current = mapped.length;
      sessionRef.current = sessionId;
      replaceMessages(mapped);
      const derivedTitle =
        session?.title ?? deriveSessionTitle(mapped) ?? null;
      if (!session?.title && derivedTitle) {
        void updateSessionTitle(sessionId, derivedTitle);
      }
      setSessionTitle(derivedTitle);
      setSessionSubtitle(formatSessionSubtitle(session ?? null));
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [
    deriveSessionTitle,
    formatSessionSubtitle,
    mapStoredMessages,
    replaceMessages,
    sessionId,
  ]);

  useEffect(() => {
    if (!sessionId) return;
    if (sessionRef.current !== sessionId) {
      sessionRef.current = sessionId;
      persistedCountRef.current = 0;
    }
    if (messages.length <= persistedCountRef.current) return;
    const pending = messages.slice(persistedCountRef.current);
    persistedCountRef.current = messages.length;
    void appendMessages(sessionId, pending).then(() => touchSession(sessionId));
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

  useEffect(() => {
    if (!docKey) return;
    const timer = setTimeout(() => {
      void updateDocument(docKey, {
        lastPage: currentPage,
        pageRange,
        lastSessionId: sessionId ?? undefined,
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [currentPage, docKey, pageRange, sessionId]);

  // Build book context
  const getBookContext = useCallback((): BookContext => {
    return {
      title: pdfInfo?.title || file?.name.replace(".pdf", ""),
      totalPages: pdfInfo?.total_pages,
      currentPage,
      selectedRange: `${pageRange.start}-${pageRange.end}`,
      outline,
    };
  }, [file, pdfInfo, currentPage, pageRange, outline]);

  const handleRequestOpenFile = useCallback(() => {
    void openFilePicker();
  }, [openFilePicker]);

  const handleOpenBookshelf = useCallback(async () => {
    setShowBookshelf(true);
    await refreshRecentDocs();
  }, [refreshRecentDocs]);

  const handleOpenRecent = useCallback(
    async (
      nextDocKey: string,
      options?: { sessionId?: string; createNewSession?: boolean }
    ) => {
      const record = await getDocument(nextDocKey);
      if (!record) return;
      if (record.fileHandle) {
        await openFromHandle(record.fileHandle, {
          expectedDocKey: nextDocKey,
          sessionId: options?.sessionId,
          createNewSession: options?.createNewSession,
        });
        return;
      }
      await openFilePicker({
        expectedDocKey: nextDocKey,
        sessionId: options?.sessionId,
        createNewSession: options?.createNewSession,
      });
    },
    [openFilePicker, openFromHandle]
  );

  const handleNewSession = useCallback(async () => {
    if (!docKey) return;
    const session = await createSession(docKey);
    setSessionId(session.sessionId);
    replaceMessages([]);
    setSessionTitle(null);
    setSessionSubtitle(null);
    void updateDocument(docKey, { lastSessionId: session.sessionId });
    if (showSessions) {
      void loadSessionsForDoc(docKey);
    }
  }, [docKey, loadSessionsForDoc, replaceMessages, showSessions]);

  const handleOpenSessionList = useCallback(() => {
    if (!docKey) return;
    setShowSessions(true);
    void loadSessionsForDoc(docKey);
  }, [docKey, loadSessionsForDoc]);

  const handleOpenSession = useCallback(
    async (targetSessionId: string) => {
      if (!docKey) return;
      setShowSessions(false);
      if (targetSessionId === sessionId) return;
      setSessionId(targetSessionId);
      replaceMessages([]);
      void updateDocument(docKey, { lastSessionId: targetSessionId });
    },
    [docKey, replaceMessages, sessionId]
  );

  const handleClearSession = useCallback(async () => {
    if (!sessionId) return;
    replaceMessages([]);
    persistedCountRef.current = 0;
    await clearSessionMessages(sessionId);
    await updateSessionTitle(sessionId, null);
    setSessionTitle(null);
    setSessionSubtitle(null);
    void touchSession(sessionId);
    if (showSessions) {
      void loadSessionsForDoc(docKey);
    }
  }, [docKey, loadSessionsForDoc, replaceMessages, sessionId, showSessions]);

  const handleSendMessage = useCallback(
    async (question: string) => {
      if (!pdfId) return;

      await sendMessage(
        pdfId,
        pageRange.start,
        pageRange.end,
        question,
        getBookContext()
      );
    },
    [pdfId, pageRange, sendMessage, getBookContext]
  );

  const handleSummarize = useCallback(() => {
    const prompt = `Please summarize the content of pages ${pageRange.start}-${pageRange.end}. Provide a clear and concise summary highlighting the main points.`;
    handleSendMessage(prompt);
  }, [pageRange, handleSendMessage]);

  return (
    <Layout>
      <Toaster position="top-center" richColors closeButton />

      {/* Hidden input for openFilePicker fallback */}
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
      {/* Spacer for fixed header */}
      <div className="h-14 shrink-0" />

      {!file ? (
        <UploadZone onFileSelect={handleZoneSelect} isUploading={isUploading} />
      ) : (
        <Group
          orientation="horizontal"
          style={{ flex: 1, overflow: "hidden" }}
          className="min-w-0"
        >
          {/* PDF Viewer - Left Panel */}
          <Panel defaultSize={75} minSize={20} className="bg-muted/30">
            <PdfViewer
              file={file}
              onRequestOpenFile={handleRequestOpenFile}
              pageRange={pageRange}
              onPageRangeChange={setPageRange}
              onCurrentPageChange={setCurrentPage}
              initialPage={initialPage}
              autoFollow={true}
              contextWindow={3}
            />
          </Panel>

          {/* Resize Handle */}
          <Separator
            style={{
              width: "1px",
              background: "var(--border)",
              cursor: "col-resize",
            }}
            className="shrink-0 transition-colors hover:bg-primary/50"
          />

          {/* Chat Panel - Right Panel */}
          <Panel defaultSize={25} minSize={25} className="bg-background relative h-full flex flex-col min-h-0 min-w-0">
            <ChatPanel
              onSendMessage={handleSendMessage}
              onSummarize={handleSummarize}
              onNewSession={handleNewSession}
              onClear={handleClearSession}
              onOpenSessions={handleOpenSessionList}
              sessionTitle={sessionTitle}
              sessionSubtitle={sessionSubtitle}
              messages={messages}
              isLoading={isLoading}
              streamingContent={streamingContent}
              streamingMeta={streamingMeta}
              disabled={!pdfId || isUploading}
            />
          </Panel>
        </Group>
      )}

      {/* Modals */}
      <BookshelfModal
        isOpen={showBookshelf}
        onClose={() => setShowBookshelf(false)}
        documents={bookshelfDocs}
        onOpenDocument={(nextDocKey) => {
          setShowBookshelf(false);
          void handleOpenRecent(nextDocKey);
        }}
      />
      <SessionListModal
        isOpen={showSessions}
        onClose={() => setShowSessions(false)}
        sessions={sessionList}
        activeSessionId={sessionId}
        onOpenSession={(nextSessionId) => {
          void handleOpenSession(nextSessionId);
        }}
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

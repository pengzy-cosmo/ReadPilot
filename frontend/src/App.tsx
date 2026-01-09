import { useState, useCallback, useEffect } from "react";
import { Panel, Group, Separator } from "react-resizable-panels";

import { PdfViewer } from "@/components/PdfViewer";
import { ChatPanel } from "@/components/ChatPanel";
import { ApiSettings } from "@/components/ApiSettings";
import { loadApiConfig } from "@/lib/apiConfig";
import { useChat, type BookContext } from "@/hooks/useChat";
import { uploadPDF, formatOutline, type PDFInfo } from "@/lib/api";
import { Button } from "@/components/ui/button";

function App() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfId, setPdfId] = useState<string | null>(null);
  const [pdfInfo, setPdfInfo] = useState<PDFInfo | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [pageRange, setPageRange] = useState({ start: 1, end: 7 });
  const [currentPage, setCurrentPage] = useState(1);
  const [outline, setOutline] = useState<string | undefined>();
  const [apiConfig, setApiConfig] = useState(loadApiConfig);
  const [showSettings, setShowSettings] = useState(false);
  const {
    messages,
    isLoading,
    streamingContent,
    streamingMeta,
    sendMessage,
    clearMessages,
  } = useChat(apiConfig);

  const handleFileChange = useCallback(
    (nextFile: File | null) => {
      if (!nextFile) {
        setPdfId(null);
        setPdfInfo(null);
        setOutline(undefined);
        setCurrentPage(1);
        setPageRange({ start: 1, end: 7 });
      }
      setFile(nextFile);
      if (nextFile) {
        setIsUploading(true);
        clearMessages();
      } else {
        setIsUploading(false);
        clearMessages();
      }
    },
    [clearMessages]
  );

  // Upload file to backend when file changes
  useEffect(() => {
    if (file) {
      // Upload to backend
      uploadPDF(file)
        .then((info) => {
          setPdfId(info.pdf_id);
          setPdfInfo(info);
          // Use outline from backend
          if (info.outline.length > 0) {
            setOutline(formatOutline(info.outline));
          }
        })
        .catch((error) => {
          console.error("Failed to upload PDF:", error);
          setPdfId(null);
          setPdfInfo(null);
        })
        .finally(() => {
          setIsUploading(false);
        });
    }
  }, [file]);

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
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Top Bar */}
      <header className="h-12 border-b flex items-center justify-between px-4 bg-background shrink-0">
        <h1 className="font-semibold">ReadPilot</h1>
        <div className="flex items-center gap-2">
          {isUploading && (
            <span className="text-sm text-muted-foreground">Uploading...</span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowSettings(true)}
          >
            API Settings
          </Button>
        </div>
      </header>

      {/* Main Content - Resizable Panels */}
      <Group
        orientation="horizontal"
        style={{ flex: 1, overflow: "hidden" }}
        className="min-w-0"
      >
        {/* PDF Viewer - Left Panel */}
        <Panel defaultSize={60} minSize={20}>
          <PdfViewer
            file={file}
            onFileChange={handleFileChange}
            pageRange={pageRange}
            onPageRangeChange={setPageRange}
            onCurrentPageChange={setCurrentPage}
            autoFollow={true}
            contextWindow={3}
          />
        </Panel>

        {/* Resize Handle */}
        <Separator
          style={{
            width: "6px",
            background: "var(--border)",
            cursor: "col-resize",
          }}
          className="shrink-0"
        />

        {/* Chat Panel - Right Panel */}
        <Panel defaultSize={40} minSize="320px">
          <ChatPanel
            onSendMessage={handleSendMessage}
            onSummarize={handleSummarize}
            onClear={clearMessages}
            messages={messages}
            isLoading={isLoading}
            streamingContent={streamingContent}
            streamingMeta={streamingMeta}
            disabled={!pdfId || isUploading}
          />
        </Panel>
      </Group>

      {/* API Settings Modal */}
      <ApiSettings
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        config={apiConfig}
        onSave={setApiConfig}
      />
    </div>
  );
}

export default App;

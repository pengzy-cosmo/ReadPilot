import { useState, useCallback, useRef } from "react";
import { getApiBaseUrl } from "../lib/apiBase";

export interface Message {
  role: "user" | "assistant";
  content: string;
  meta?: {
    pageStart: number;
    pageEnd: number;
  };
}

export interface BookContext {
  title?: string;
  totalPages?: number;
  currentPage?: number;
  selectedRange?: string;
  outline?: string;
  overview?: string;
}

interface ApiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

const API_URL = getApiBaseUrl();

const parseErrorDetail = (raw: string) => {
  try {
    const parsed = JSON.parse(raw) as { detail?: string };
    return parsed;
  } catch {
    return { detail: raw };
  }
};

const extractErrorMessage = (raw: string, fallback: string) => {
  const detail = parseErrorDetail(raw).detail;
  if (detail && typeof detail === "string") {
    return detail;
  }
  return fallback;
};

export function useChat(apiConfig: ApiConfig) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [streamingMeta, setStreamingMeta] = useState<{
    pageStart: number;
    pageEnd: number;
  } | null>(null);
  const messagesRef = useRef<Message[]>([]);

  // Keep ref in sync with state for use in callbacks
  messagesRef.current = messages;

  const replaceMessages = useCallback((next: Message[]) => {
    setMessages(next);
    setStreamingContent("");
    setStreamingMeta(null);
  }, []);

  const sendMessage = useCallback(
    async (
      docId: string,
      sessionId: string,
      pageStart: number,
      pageEnd: number,
      question: string,
      bookContext?: BookContext
    ) => {
      setIsLoading(true);
      const userMessage: Message = { role: "user", content: question };
      setMessages((prev) => [...prev, userMessage]);
      setStreamingContent("");
      setStreamingMeta({ pageStart, pageEnd });

      // Get history from ref (excludes current message)
      const history = messagesRef.current.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const requestOnce = async (targetDocId: string) => {
        const response = await fetch(`${API_URL}/api/chat`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            doc_id: targetDocId,
            session_id: sessionId,
            page_start: pageStart,
            page_end: pageEnd,
            question,
            history,
            book_context: bookContext
              ? {
                  title: bookContext.title,
                  total_pages: bookContext.totalPages,
                  current_page: bookContext.currentPage,
                  selected_range: bookContext.selectedRange,
                  outline: bookContext.outline,
                  overview: bookContext.overview,
                }
              : undefined,
            api_key: apiConfig.apiKey || undefined,
            base_url: apiConfig.baseUrl || undefined,
            model: apiConfig.model || "gpt-5.2",
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          const message = extractErrorMessage(errorText, "Request failed");
          const error = new Error(message) as Error & {
            status?: number;
            raw?: string;
          };
          error.status = response.status;
          error.raw = errorText;
          throw error;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let fullContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          fullContent += chunk;
          setStreamingContent(fullContent);
        }

        return fullContent;
      };

      try {
        const fullContent = await requestOnce(docId);

        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: fullContent,
            meta: { pageStart, pageEnd },
          },
        ]);
        setStreamingContent("");
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: `Error: ${errorMessage}`,
            meta: { pageStart, pageEnd },
          },
        ]);
        setStreamingContent("");
      } finally {
        setIsLoading(false);
        setStreamingMeta(null);
      }
    },
    [apiConfig]
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setStreamingContent("");
    setStreamingMeta(null);
  }, []);

  return {
    messages,
    isLoading,
    streamingContent,
    streamingMeta,
    sendMessage,
    clearMessages,
    replaceMessages,
  };
}

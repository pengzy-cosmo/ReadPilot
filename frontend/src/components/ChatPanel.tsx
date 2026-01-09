import { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card } from '@/components/ui/card';
import type { Message } from '@/hooks/useChat';

interface PageRangeMeta {
  pageStart: number;
  pageEnd: number;
}

interface ChatPanelProps {
  onSendMessage: (message: string) => Promise<void>;
  onSummarize: () => void;
  onClear: () => void;
  messages: Message[];
  isLoading: boolean;
  streamingContent: string;
  streamingMeta: PageRangeMeta | null;
  disabled: boolean;
}

export function ChatPanel({
  onSendMessage,
  onSummarize,
  onClear,
  messages,
  isLoading,
  streamingContent,
  streamingMeta,
  disabled,
}: ChatPanelProps) {
  const [input, setInput] = useState('');
  const scrollRootRef = useRef<HTMLDivElement>(null);
  const scrollViewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!scrollViewportRef.current && scrollRootRef.current) {
      scrollViewportRef.current = scrollRootRef.current.querySelector(
        '[data-slot="scroll-area-viewport"]'
      );
    }
    const viewport = scrollViewportRef.current;
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [messages, streamingContent]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || disabled) return;

    const message = input.trim();
    setInput('');
    await onSendMessage(message);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleClear = () => {
    setInput('');
    onClear();
  };

  const formatPageRange = (meta?: PageRangeMeta | null) => {
    if (!meta) return null;
    if (meta.pageStart === meta.pageEnd) {
      return `Based on page ${meta.pageStart}`;
    }
    return `Based on pages ${meta.pageStart}-${meta.pageEnd}`;
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Header */}
      <div className="p-3 border-b bg-muted/50">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Chat</h2>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              disabled={disabled || isLoading || messages.length === 0}
            >
              Clear
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={onSummarize}
              disabled={disabled || isLoading}
            >
              Summarize
            </Button>
          </div>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 min-h-0 h-full" ref={scrollRootRef}>
        <div className="space-y-4 p-4">
          {messages.length === 0 && !streamingContent && (
            <div className="text-center text-muted-foreground text-sm py-8">
              {disabled
                ? 'Open a PDF to start chatting'
                : 'Ask questions about the selected pages'}
            </div>
          )}

          {messages.map((msg, i) => (
            <Card
              key={i}
              className={`p-3 ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground ml-8'
                  : 'bg-muted mr-8'
              }`}
            >
              <div className="text-xs font-medium mb-1 opacity-70">
                {msg.role === 'user' ? 'You' : 'AI'}
              </div>
              {msg.role === 'assistant' && msg.meta && (
                <div className="text-[11px] text-muted-foreground mb-2">
                  {formatPageRange(msg.meta)}
                </div>
              )}
              {msg.role === 'user' ? (
                <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
              ) : (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex]}
                  >
                    {msg.content}
                  </ReactMarkdown>
                </div>
              )}
            </Card>
          ))}

          {streamingContent && (
            <Card className="p-3 bg-muted mr-8">
              <div className="text-xs font-medium mb-1 opacity-70">AI</div>
              {streamingMeta && (
                <div className="text-[11px] text-muted-foreground mb-2">
                  {formatPageRange(streamingMeta)}
                </div>
              )}
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                >
                  {streamingContent}
                </ReactMarkdown>
                <span className="animate-pulse">|</span>
              </div>
            </Card>
          )}

          {isLoading && !streamingContent && (
            <div className="text-center text-muted-foreground text-sm">
              Thinking...
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-3 border-t">
        <div className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about the selected pages..."
            disabled={disabled || isLoading}
            className="min-h-[60px] resize-none"
            rows={2}
          />
          <Button
            type="submit"
            disabled={!input.trim() || disabled || isLoading}
            className="self-end"
          >
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}

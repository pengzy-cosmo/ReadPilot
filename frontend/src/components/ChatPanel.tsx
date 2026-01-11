/** ChatPanel - AI chat interface with streaming responses and markdown support. */
import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { Bot, History, Loader2, Plus, SendHorizontal, Sparkles, Trash2, User } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import type { Message } from "@/hooks/useChat";
import { cn } from "@/lib/utils";

interface PageRangeMeta {
	pageStart: number;
	pageEnd: number;
}

interface ChatPanelProps {
	onSendMessage: (message: string) => Promise<void>;
	onSummarize: () => void;
	onNewSession: () => void;
	onClear: () => void;
	onOpenSessions: () => void;
	sessionTitle?: string | null;
	sessionSubtitle?: string | null;
	pageRange?: { start: number; end: number } | null;
	messages: Message[];
	isLoading: boolean;
	streamingContent: string;
	streamingMeta: PageRangeMeta | null;
	disabled: boolean;
}

export function ChatPanel({
	onSendMessage,
	onSummarize,
	onNewSession,
	onClear,
	onOpenSessions,
	sessionTitle,
	sessionSubtitle,
	pageRange,
	messages,
	isLoading,
	streamingContent,
	streamingMeta,
	disabled,
}: ChatPanelProps) {
	const [input, setInput] = useState("");
	const scrollRootRef = useRef<HTMLDivElement>(null);
	const scrollViewportRef = useRef<HTMLDivElement | null>(null);

	// Auto-scroll to bottom when new messages arrive or during streaming
	useEffect(() => {
		if (messages.length === 0 && !streamingContent) return;
		if (!scrollViewportRef.current && scrollRootRef.current) {
			scrollViewportRef.current = scrollRootRef.current.querySelector('[data-slot="scroll-area-viewport"]');
		}
		const viewport = scrollViewportRef.current;
		if (viewport) {
			requestAnimationFrame(() => {
				viewport.scrollTop = viewport.scrollHeight;
			});
		}
	}, [messages.length, streamingContent]);

	const formatPageRange = (meta?: PageRangeMeta | null) => {
		if (!meta) return null;
		if (meta.pageStart === meta.pageEnd) {
			return `Page ${meta.pageStart}`;
		}
		return `Pages ${meta.pageStart}-${meta.pageEnd}`;
	};

	const formatContextRange = (range?: { start: number; end: number } | null) => {
		if (!range) return null;
		if (range.start === range.end) {
			return `Page ${range.start}`;
		}
		return `Pages ${range.start}-${range.end}`;
	};

	const handleSubmitMessage = async () => {
		if (!input.trim() || isLoading || disabled) return;
		const message = input.trim();
		setInput("");
		await onSendMessage(message);
	};

	const handleSubmit = (event: React.FormEvent) => {
		event.preventDefault();
		void handleSubmitMessage();
	};

	const handleKeyDown = (event: React.KeyboardEvent) => {
		if (event.key === "Enter" && !event.shiftKey) {
			event.preventDefault();
			void handleSubmitMessage();
		}
	};

	const handleNewSession = () => {
		setInput("");
		onNewSession();
	};

	const handleClear = () => {
		setInput("");
		onClear();
	};

	/** Render markdown with GFM tables and LaTeX math support. */
	const renderMarkdown = (content: string, showCaret = false) => (
		<div className="prose prose-sm dark:prose-invert max-w-none break-words">
			<ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
				{content}
			</ReactMarkdown>
			{showCaret && <span className="animate-pulse inline-block w-1.5 h-3.5 bg-primary ml-0.5 align-middle" />}
		</div>
	);

	const renderTypingIndicator = () => (
		<div className="flex items-center gap-2 text-xs text-muted-foreground">
			<span>Thinking</span>
			<span className="flex items-center gap-1" aria-hidden="true">
				<span
					className="size-1.5 rounded-full bg-muted-foreground/70 animate-bounce"
					style={{ animationDelay: "0ms" }}
				/>
				<span
					className="size-1.5 rounded-full bg-muted-foreground/70 animate-bounce"
					style={{ animationDelay: "150ms" }}
				/>
				<span
					className="size-1.5 rounded-full bg-muted-foreground/70 animate-bounce"
					style={{ animationDelay: "300ms" }}
				/>
			</span>
		</div>
	);

	const showEmptyState = messages.length === 0 && !streamingContent;
	const showLoadingIndicator = isLoading && !streamingContent;

	return (
		<div className="flex-1 flex flex-col min-h-0 bg-background border-l border-border/40 overflow-hidden">
			<div className="h-14 flex items-center justify-between px-4 border-b border-border/40 bg-muted/20 shrink-0">
				<div className="min-w-0 pr-4">
					<h2 className="text-sm font-semibold truncate">{sessionTitle || "New chat"}</h2>
					<p className="text-xs text-muted-foreground truncate">{sessionSubtitle || "Ready to assist"}</p>
				</div>

				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="icon"
						onClick={onSummarize}
						disabled={disabled || isLoading}
						title="Summarize selected pages"
						className="h-8 w-8 text-muted-foreground hover:text-primary"
					>
						<Sparkles className="size-4" />
					</Button>
					<div className="h-4 w-px bg-border/60 mx-1" />
					<Button
						variant="ghost"
						size="icon"
						onClick={onOpenSessions}
						disabled={disabled}
						title="History"
						className="h-8 w-8 text-muted-foreground hover:text-foreground"
					>
						<History className="size-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						onClick={handleNewSession}
						disabled={disabled || isLoading}
						title="New session"
						className="h-8 w-8 text-muted-foreground hover:text-foreground"
					>
						<Plus className="size-4" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						onClick={handleClear}
						disabled={disabled || isLoading || messages.length === 0}
						title="Clear chat"
						className="h-8 w-8 text-muted-foreground hover:text-destructive"
					>
						<Trash2 className="size-4" />
					</Button>
				</div>
			</div>

			<ScrollArea className="flex-1 min-h-0" ref={scrollRootRef}>
				<div className="flex flex-col px-4 py-6 gap-6 max-w-3xl mx-auto w-full min-h-full justify-end">
					{showEmptyState && (
						<div className="flex flex-col items-center justify-center text-center mt-12 gap-4">
							<div className="size-12 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
								<Bot className="size-6" />
							</div>
							<div>
								<h3 className="font-medium text-foreground">{disabled ? "Open a PDF First" : "How can I help you?"}</h3>
								<p className="text-sm text-muted-foreground mt-1 max-w-xs mx-auto">
									{disabled
										? "Upload a document to start analyzing."
										: "Ask questions about the content, request summaries, or explore key concepts."}
								</p>
							</div>
							{!disabled && (
								<div className="flex flex-wrap items-center justify-center gap-2 mt-4">
									<Button
										variant="outline"
										size="sm"
										className="h-7 text-xs rounded-full bg-background"
										onClick={onSummarize}
									>
										<Sparkles className="size-3 mr-1.5 text-primary" />
										Summarize these pages
									</Button>
								</div>
							)}
						</div>
					)}

					{messages.map((message) => {
						const isUser = message.role === "user";
						return (
							<div key={message.id} className={cn("flex gap-3", isUser ? "flex-row-reverse" : "flex-row")}>
								<div
									className={cn(
										"size-8 shrink-0 rounded-lg flex items-center justify-center text-xs font-medium",
										isUser ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
									)}
								>
									{isUser ? <User className="size-4" /> : <Bot className="size-4" />}
								</div>

								<div className={cn("flex flex-col max-w-[85%] gap-1", isUser ? "items-end" : "items-start")}>
									{!isUser && message.meta && (
										<span className="text-[10px] uppercase font-medium text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
											{formatPageRange(message.meta)}
										</span>
									)}

									<div
										className={cn(
											"px-4 py-2.5 rounded-2xl shadow-sm text-sm leading-relaxed",
											isUser
												? "bg-primary/10 text-foreground border border-primary/20 rounded-tr-sm selection:bg-primary/20 selection:text-foreground"
												: "bg-card border border-border/50 rounded-tl-sm",
										)}
									>
										{isUser ? (
											<div className="whitespace-pre-wrap">{message.content}</div>
										) : (
											renderMarkdown(message.content)
										)}
									</div>
								</div>
							</div>
						);
					})}

					{streamingContent && (
						<div className="flex gap-3 flex-row">
							<div className="size-8 shrink-0 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
								<Bot className="size-4" />
							</div>
							<div className="flex flex-col max-w-[85%] gap-1 items-start">
								{streamingMeta && (
									<span className="text-[10px] uppercase font-medium text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
										{formatPageRange(streamingMeta)}
									</span>
								)}
								<div className="px-4 py-2.5 rounded-2xl rounded-tl-sm bg-card border border-border/50 shadow-sm text-sm leading-relaxed w-full">
									{renderMarkdown(streamingContent, true)}
								</div>
							</div>
						</div>
					)}

					{showLoadingIndicator && (
						<div className="flex gap-3 flex-row">
							<div className="size-8 shrink-0 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
								<Bot className="size-4" />
							</div>
							<div className="flex flex-col max-w-[85%] gap-1 items-start">
								{streamingMeta && (
									<span className="text-[10px] uppercase font-medium text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded">
										{formatPageRange(streamingMeta)}
									</span>
								)}
								<div className="px-4 py-2.5 rounded-2xl rounded-tl-sm bg-card border border-border/50 shadow-sm text-sm leading-relaxed w-full">
									{renderTypingIndicator()}
								</div>
							</div>
						</div>
					)}
				</div>
			</ScrollArea>

			<div className="p-4 bg-background border-t border-border/40">
				<div className="relative max-w-3xl mx-auto">
					<form
						onSubmit={handleSubmit}
						className="relative flex items-end gap-2 rounded-2xl border border-input bg-muted/20 shadow-sm focus-within:ring-1 focus-within:ring-ring transition-all hover:bg-muted/30"
					>
						{!disabled && pageRange && (
							<span
								className="pointer-events-none absolute left-3 top-0 -translate-y-1/2 rounded-full border border-border/60 bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
								title="Current context page range"
							>
								{formatContextRange(pageRange)}
							</span>
						)}
						<Textarea
							value={input}
							onChange={(event) => setInput(event.target.value)}
							onKeyDown={handleKeyDown}
							placeholder="Ask anything..."
							disabled={disabled || isLoading}
							className="resize-none min-h-[50px] max-h-[200px] border-0 focus-visible:ring-0 bg-transparent py-3.5 pl-4 pr-12 shadow-none scrollbar-hide"
							rows={1}
							style={{ height: input ? "auto" : "50px" }}
							onInput={(event) => {
								const target = event.target as HTMLTextAreaElement;
								target.style.height = "auto";
								target.style.height = `${target.scrollHeight}px`;
							}}
						/>
						<Button
							type="submit"
							size="icon"
							disabled={!input.trim() || disabled || isLoading}
							className={cn(
								"absolute right-1.5 bottom-1.5 size-8 rounded-xl transition-all",
								input.trim()
									? "bg-primary text-primary-foreground shadow-sm"
									: "bg-transparent text-muted-foreground hover:bg-muted",
							)}
						>
							{isLoading ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
							<span className="sr-only">Send</span>
						</Button>
					</form>
					<div className="text-[10px] text-center text-muted-foreground mt-2 opacity-60">
						AI can make mistakes. Please verify important information.
					</div>
				</div>
			</div>
		</div>
	);
}

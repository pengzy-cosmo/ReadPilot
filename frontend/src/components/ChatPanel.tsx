/** ChatPanel - AI chat interface with streaming responses and markdown support. */
import { memo, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import { Bot, History, Loader2, Plus, Quote, SendHorizontal, Sparkles, Trash2, User, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import type { Message } from "@/hooks/useChat";
import { cn, preprocessLaTeX, sanitizeAriaLabel } from "@/lib/utils";

const EMPTY_SELECTIONS: string[] = [];
const MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkMath];
const MARKDOWN_REHYPE_PLUGINS = [rehypeKatex];

const MarkdownMessage = memo(function MarkdownMessage({
	content,
	showCaret = false,
}: {
	content: string;
	showCaret?: boolean;
}) {
	return (
		<div className="prose prose-sm dark:prose-invert max-w-none break-words">
			<ReactMarkdown remarkPlugins={MARKDOWN_REMARK_PLUGINS} rehypePlugins={MARKDOWN_REHYPE_PLUGINS}>
				{preprocessLaTeX(content)}
			</ReactMarkdown>
			{showCaret && <span className="animate-pulse inline-block w-1.5 h-3.5 bg-primary ml-0.5 align-middle" />}
		</div>
	);
});

const TypingIndicator = memo(function TypingIndicator() {
	return (
		<div className="flex items-center gap-2 text-xs text-muted-foreground">
			<span>Thinking…</span>
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
});

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
	selectedTexts?: string[];
	onRemoveSelection?: (index: number) => void;
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
	selectedTexts = EMPTY_SELECTIONS,
	onRemoveSelection,
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

	const showEmptyState = messages.length === 0 && !streamingContent;
	const showLoadingIndicator = isLoading && !streamingContent;

	return (
		<div className="flex flex-1 min-h-0 flex-col overflow-hidden border-l border-border/60 bg-card/75 backdrop-blur-[2px]">
			<div className="flex h-14 shrink-0 items-center justify-between border-b border-border/60 bg-card/90 px-4">
				<div className="min-w-0 pr-4">
					<h2 className="truncate text-sm font-semibold text-foreground">{sessionTitle || "New chat"}</h2>
					<p className="truncate text-xs text-muted-foreground">{sessionSubtitle || "Ready to assist"}</p>
				</div>

				<div className="flex items-center gap-1">
					<Button
						variant="ghost"
						size="icon"
						onClick={onSummarize}
						disabled={disabled || isLoading}
						aria-label="Summarize selected pages"
						className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary"
					>
						<Sparkles className="size-4" aria-hidden="true" />
					</Button>
					<div className="h-4 w-px bg-border/60 mx-1" aria-hidden="true" />
					<Button
						variant="ghost"
						size="icon"
						onClick={onOpenSessions}
						disabled={disabled}
						aria-label="History"
						className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted/70 hover:text-foreground"
					>
						<History className="size-4" aria-hidden="true" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						onClick={handleNewSession}
						disabled={disabled || isLoading}
						aria-label="New session"
						className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-muted/70 hover:text-foreground"
					>
						<Plus className="size-4" aria-hidden="true" />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						onClick={handleClear}
						disabled={disabled || isLoading || messages.length === 0}
						aria-label="Clear chat"
						className="h-8 w-8 rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
					>
						<Trash2 className="size-4" aria-hidden="true" />
					</Button>
				</div>
			</div>

			<ScrollArea className="flex-1 min-h-0" ref={scrollRootRef}>
				<div className="mx-auto flex min-h-full w-full max-w-[46rem] flex-col justify-end gap-6 px-4 py-6">
					{showEmptyState && (
						<div className="mt-12 flex flex-col items-center justify-center gap-4 text-center">
							<div className="flex size-12 items-center justify-center rounded-2xl bg-primary/12 text-primary shadow-sm">
								<Bot className="size-6" aria-hidden="true" />
							</div>
							<div>
								<h3 className="font-medium text-foreground">{disabled ? "Open a PDF first" : "How can I help?"}</h3>
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
										className="h-7 rounded-full border-border/60 bg-card/90 text-xs"
										onClick={onSummarize}
									>
										<Sparkles className="size-3 mr-1.5 text-primary" aria-hidden="true" />
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
										"flex size-8 shrink-0 items-center justify-center rounded-xl text-xs font-medium",
										isUser ? "bg-primary text-primary-foreground" : "bg-muted/80 text-muted-foreground",
									)}
								>
									{isUser ? (
										<User className="size-4" aria-hidden="true" />
									) : (
										<Bot className="size-4" aria-hidden="true" />
									)}
								</div>

								<div className={cn("flex max-w-[88%] flex-col gap-1", isUser ? "items-end" : "items-start")}>
									{!isUser && message.meta && (
										<span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
											{formatPageRange(message.meta)}
										</span>
									)}

									<div
										className={cn(
											"rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm",
											isUser
												? "rounded-tr-sm border border-primary/25 bg-primary/12 text-foreground selection:bg-primary/25 selection:text-foreground"
												: "rounded-tl-sm border border-border/60 bg-card/95",
										)}
									>
										{isUser ? (
											<div className="whitespace-pre-wrap">{message.content}</div>
										) : (
											<MarkdownMessage content={message.content} />
										)}
									</div>
								</div>
							</div>
						);
					})}

					{streamingContent && (
						<div className="flex gap-3 flex-row">
							<div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted/80 text-muted-foreground">
								<Bot className="size-4" aria-hidden="true" />
							</div>
							<div className="flex max-w-[88%] flex-col gap-1 items-start">
								{streamingMeta && (
									<span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
										{formatPageRange(streamingMeta)}
									</span>
								)}
								<div className="w-full rounded-2xl rounded-tl-sm border border-border/60 bg-card/95 px-4 py-2.5 text-sm leading-relaxed shadow-sm">
									<MarkdownMessage content={streamingContent} showCaret />
								</div>
							</div>
						</div>
					)}

					{showLoadingIndicator && (
						<div className="flex gap-3 flex-row">
							<div className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted/80 text-muted-foreground">
								<Bot className="size-4" aria-hidden="true" />
							</div>
							<div className="flex max-w-[88%] flex-col gap-1 items-start">
								{streamingMeta && (
									<span className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
										{formatPageRange(streamingMeta)}
									</span>
								)}
								<div className="w-full rounded-2xl rounded-tl-sm border border-border/60 bg-card/95 px-4 py-2.5 text-sm leading-relaxed shadow-sm">
									<TypingIndicator />
								</div>
							</div>
						</div>
					)}
				</div>
			</ScrollArea>

			<div className="border-t border-border/60 bg-card/95 p-4">
				<div className="relative max-w-3xl mx-auto">
					{/* Selected highlights display - Removed old bulky list */}
					<form
						onSubmit={handleSubmit}
						className="relative flex items-end gap-2 rounded-2xl border border-input/85 bg-muted/35 shadow-sm transition-colors focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-ring hover:bg-muted/45"
					>
						{!disabled && (
							<div className="absolute left-3 top-0 -translate-y-1/2 flex items-center gap-2 max-w-[calc(100%-24px)] pointer-events-none">
								{pageRange && (
									<span
										className="shrink-0 rounded-full border border-border/70 bg-card px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-sm"
										title="Current context page range"
									>
										{formatContextRange(pageRange)}
									</span>
								)}
								{selectedTexts.map((text, index) => (
									<div
										key={text}
										className="pointer-events-auto group flex max-w-[120px] shrink-0 cursor-default items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary shadow-sm transition-colors hover:bg-primary/15 animate-in fade-in zoom-in-95 duration-200"
										title={text}
									>
										<Quote className="size-2.5 opacity-50" aria-hidden="true" />
										<span className="truncate">{text}</span>
										{onRemoveSelection && (
											<button
												type="button"
												onClick={() => onRemoveSelection(index)}
												className="ml-0.5 rounded-full p-0.5 opacity-0 transition-colors group-hover:opacity-100 hover:bg-destructive/20 hover:text-destructive"
												aria-label={`Remove highlight: ${sanitizeAriaLabel(text)}`}
											>
												<X className="size-2.5" aria-hidden="true" />
											</button>
										)}
									</div>
								))}
							</div>
						)}
						<label htmlFor="chat-input" className="sr-only">
							Message
						</label>
						<Textarea
							id="chat-input"
							value={input}
							onChange={(event) => setInput(event.target.value)}
							onKeyDown={handleKeyDown}
							placeholder={selectedTexts.length > 0 ? "Ask about the highlighted text…" : "Ask anything…"}
							disabled={disabled || isLoading}
							className="min-h-[50px] max-h-[200px] resize-none border-0 bg-transparent py-3.5 pl-4 pr-12 shadow-none scrollbar-hide focus-visible:ring-0"
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
								"absolute bottom-1.5 right-1.5 size-8 rounded-xl transition-all",
								input.trim()
									? "bg-primary text-primary-foreground shadow-sm"
									: "bg-transparent text-muted-foreground hover:bg-muted",
							)}
						>
							{isLoading ? (
								<Loader2 className="size-4 animate-spin" aria-hidden="true" />
							) : (
								<SendHorizontal className="size-4" aria-hidden="true" />
							)}
							<span className="sr-only">Send</span>
						</Button>
					</form>
					<div className="mt-2 text-center text-[10px] text-muted-foreground/80">
						AI can make mistakes. Please verify important information.
					</div>
				</div>
			</div>
		</div>
	);
}

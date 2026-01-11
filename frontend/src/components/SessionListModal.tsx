/** SessionListModal - Modal listing chat sessions for a document. */
import { History, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SessionInfo } from "@/lib/api";
import { cn } from "@/lib/utils";

interface SessionListModalProps {
	isOpen: boolean;
	onClose: () => void;
	sessions: SessionInfo[];
	activeSessionId: string | null;
	onOpenSession: (sessionId: string) => void;
}

const formatTimestamp = (value?: number) => {
	if (!value) return "Unknown";
	return new Date(value).toLocaleString();
};

export function SessionListModal({ isOpen, onClose, sessions, activeSessionId, onOpenSession }: SessionListModalProps) {
	if (!isOpen) return null;

	return (
		<div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
			<Card className="w-full max-w-3xl h-[70vh] border-border/60 bg-background/95 shadow-2xl flex flex-col">
				<CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border/40 px-6 py-4">
					<div className="flex items-center gap-2">
						<div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
							<History className="size-4" />
						</div>
						<div>
							<CardTitle className="text-base">Sessions</CardTitle>
							<p className="text-xs text-muted-foreground">Pick a recent conversation</p>
						</div>
					</div>
					<Button variant="ghost" size="icon" onClick={onClose}>
						<X className="size-4" />
						<span className="sr-only">Close</span>
					</Button>
				</CardHeader>
				<CardContent className="flex-1 min-h-0 p-0">
					<ScrollArea className="h-full">
						<div className="px-6 py-4 space-y-3">
							{sessions.length === 0 && (
								<div className="text-sm text-muted-foreground text-center py-12">No sessions yet.</div>
							)}
							{sessions.map((session, index) => {
								const isActive = session.session_id === activeSessionId;
								return (
									<button
										key={session.session_id}
										type="button"
										onClick={() => onOpenSession(session.session_id)}
										className={cn(
											"group w-full rounded-xl border px-4 py-3 text-left transition flex items-center justify-between gap-4",
											isActive
												? "border-primary/60 bg-primary/10"
												: "border-border/50 bg-card/40 hover:bg-muted/40 hover:border-border",
											"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
										)}
									>
										<div className="flex items-center gap-3 min-w-0 flex-1">
											<div
												className={cn(
													"size-9 rounded-lg flex items-center justify-center",
													isActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
												)}
											>
												<History className="size-4" />
											</div>
											<div className="min-w-0">
												<div className="font-medium truncate">
													{session.title || `Session ${sessions.length - index}`}
												</div>
												<div className="text-xs text-muted-foreground">
													Updated: {formatTimestamp(session.updated_at)}
												</div>
												<div className="text-xs text-muted-foreground">
													Created: {formatTimestamp(session.created_at)}
												</div>
											</div>
										</div>
									</button>
								);
							})}
						</div>
					</ScrollArea>
				</CardContent>
			</Card>
		</div>
	);
}

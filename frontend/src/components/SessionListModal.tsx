/** SessionListModal - Modal listing chat sessions for a document. */
import { History, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { deleteSession, type SessionInfo } from "@/lib/api";
import { cn } from "@/lib/utils";

interface SessionListModalProps {
	isOpen: boolean;
	onClose: () => void;
	sessions: SessionInfo[];
	activeSessionId: string | null;
	onOpenSession: (sessionId: string) => void;
	onDelete: (sessionId: string) => void;
}

const formatTimestamp = (value?: number) => {
	if (!value) return "Unknown";
	return new Date(value).toLocaleString();
};

export function SessionListModal({
	isOpen,
	onClose,
	sessions,
	activeSessionId,
	onOpenSession,
	onDelete,
}: SessionListModalProps) {
	if (!isOpen) return null;

	const handleDelete = async (e: React.MouseEvent, sessionId: string) => {
		e.stopPropagation();
		if (!confirm("Are you sure you want to delete this session?")) return;
		try {
			await deleteSession(sessionId);
			toast.success("Session deleted");
			onDelete(sessionId);
		} catch (error) {
			console.error("Failed to delete session:", error);
			toast.error("Failed to delete session");
		}
	};

	return (
		<div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50">
			<Card className="w-full max-w-3xl h-[70vh] border-border/60 bg-background/95 shadow-2xl flex flex-col">
				<CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border/40 px-6 py-4">
					<div className="flex items-center gap-2">
						<div className="size-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
							<History className="size-4" aria-hidden="true" />
						</div>
						<div>
							<CardTitle className="text-base">Sessions</CardTitle>
							<p className="text-xs text-muted-foreground">Pick a recent conversation</p>
						</div>
					</div>
					<Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
						<X className="size-4" aria-hidden="true" />
						<span className="sr-only">Close</span>
					</Button>
				</CardHeader>
				<CardContent className="flex-1 min-h-0 p-0">
					<ScrollArea className="h-full">
						<div className="pl-6 pr-6 py-4 space-y-3">
							{sessions.length === 0 && (
								<div className="text-sm text-muted-foreground text-center py-12">No sessions yet.</div>
							)}
							{sessions.map((session, index) => {
								const isActive = session.session_id === activeSessionId;
								return (
									<div
										key={session.session_id}
										className={cn(
											"group w-full rounded-xl border px-4 py-3 text-left transition grid grid-cols-[1fr_auto] gap-4 items-center",
											isActive
												? "border-primary/60 bg-primary/10"
												: "border-border/50 bg-card/40 hover:bg-muted/40 hover:border-border",
										)}
									>
										<button
											type="button"
											onClick={() => onOpenSession(session.session_id)}
											className="flex items-center gap-3 min-w-0 overflow-hidden text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 outline-none rounded-lg"
										>
											<div
												className={cn(
													"size-9 shrink-0 rounded-lg flex items-center justify-center",
													isActive ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
												)}
											>
												<History className="size-4" aria-hidden="true" />
											</div>
											<div className="min-w-0 flex-1">
												<div className="font-medium truncate">
													{session.title || `Session ${sessions.length - index}`}
												</div>
												<div className="text-xs text-muted-foreground truncate">
													Updated: {formatTimestamp(session.updated_at)}
												</div>
												<div className="text-xs text-muted-foreground truncate">
													Created: {formatTimestamp(session.created_at)}
												</div>
											</div>
										</button>
										<Button
											variant="ghost"
											size="icon"
											className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10 shrink-0"
											onClick={(e) => handleDelete(e, session.session_id)}
											aria-label={`Delete session ${session.title || `Session ${sessions.length - index}`}`}
										>
											<Trash2 className="size-4" aria-hidden="true" />
										</Button>
									</div>
								);
							})}
						</div>
					</ScrollArea>
				</CardContent>
			</Card>
		</div>
	);
}

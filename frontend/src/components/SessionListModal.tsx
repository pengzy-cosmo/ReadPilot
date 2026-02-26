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
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm p-4">
			<Card className="flex h-[70vh] w-full max-w-3xl flex-col rounded-2xl border-border/70 bg-card/95 shadow-2xl">
				<CardHeader className="flex flex-row items-center justify-between gap-3 border-b border-border/60 px-6 py-4">
					<div className="flex items-center gap-2">
						<div className="flex size-8 items-center justify-center rounded-lg bg-primary/12 text-primary">
							<History className="size-4" aria-hidden="true" />
						</div>
						<div>
							<CardTitle className="text-base">Sessions</CardTitle>
							<p className="text-xs text-muted-foreground">Pick a recent conversation</p>
						</div>
					</div>
					<Button
						variant="ghost"
						size="icon"
						onClick={onClose}
						aria-label="Close"
						className="rounded-lg hover:bg-muted/70"
					>
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
											"group grid w-full grid-cols-[1fr_auto] items-center gap-4 rounded-xl border px-4 py-3 text-left transition",
											isActive
												? "border-primary/55 bg-primary/10"
												: "border-border/60 bg-card/65 hover:border-border hover:bg-muted/45",
										)}
									>
										<button
											type="button"
											onClick={() => onOpenSession(session.session_id)}
											className="flex items-center gap-3 min-w-0 overflow-hidden text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 outline-none rounded-lg"
										>
											<div
												className={cn(
													"flex size-9 shrink-0 items-center justify-center rounded-lg",
													isActive ? "bg-primary/15 text-primary" : "bg-muted/75 text-muted-foreground",
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
											className="shrink-0 text-destructive opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-destructive/10 hover:text-destructive"
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

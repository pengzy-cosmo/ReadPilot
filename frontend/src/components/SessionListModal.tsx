import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SessionRecord } from "@/lib/readingStore";

interface SessionListModalProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: SessionRecord[];
  activeSessionId: string | null;
  onOpenSession: (sessionId: string) => void;
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
}: SessionListModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-3xl h-[70vh]">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Sessions</CardTitle>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </CardHeader>
        <CardContent className="h-[calc(70vh-5rem)]">
          <ScrollArea className="h-full">
            <div className="p-2 space-y-3">
              {sessions.length === 0 && (
                <div className="text-sm text-muted-foreground">
                  No sessions yet.
                </div>
              )}
              {sessions.map((session, index) => {
                const isActive = session.sessionId === activeSessionId;
                return (
                  <div
                    key={session.sessionId}
                    className={`rounded-md border p-4 flex items-center justify-between gap-4 ${
                      isActive
                        ? "border-primary bg-primary/10"
                        : "border-border"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {session.title || `Session ${sessions.length - index}`}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Updated: {formatTimestamp(session.updatedAt)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Created: {formatTimestamp(session.createdAt)}
                      </div>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => onOpenSession(session.sessionId)}
                    >
                      Open
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

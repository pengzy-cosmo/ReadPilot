import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { DocumentRecord } from "@/lib/readingStore";

interface BookshelfModalProps {
  isOpen: boolean;
  onClose: () => void;
  documents: DocumentRecord[];
  onOpenDocument: (docKey: string) => void;
}

const formatTimestamp = (value?: number) => {
  if (!value) return "Unknown";
  return new Date(value).toLocaleString();
};

export function BookshelfModal({
  isOpen,
  onClose,
  documents,
  onOpenDocument,
}: BookshelfModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <Card className="w-full max-w-4xl h-[75vh]">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Library</CardTitle>
          <Button variant="outline" size="sm" onClick={onClose}>
            Close
          </Button>
        </CardHeader>
        <CardContent className="h-[calc(75vh-5rem)]">
          <ScrollArea className="h-full">
            <div className="p-2 space-y-3">
              {documents.length === 0 && (
                <div className="text-sm text-muted-foreground">
                  No recent documents yet.
                </div>
              )}
              {documents.map((doc) => (
                <div
                  key={doc.docKey}
                  className="rounded-md border border-border p-4 flex items-center justify-between gap-4"
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">
                      {doc.title || doc.fileName}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">
                      {doc.fileName}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Last page: {doc.lastPage} · Last opened:{" "}
                      {formatTimestamp(doc.lastOpenedAt)}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onOpenDocument(doc.docKey)}
                  >
                    Open
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

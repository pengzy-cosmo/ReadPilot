const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

export interface OutlineItem {
  level: number;
  title: string;
  page: number;
}

export interface PDFInfo {
  pdf_id: string;
  filename: string;
  total_pages: number;
  title: string | null;
  outline: OutlineItem[];
  file_size: number;
}

export async function uploadPDF(file: File): Promise<PDFInfo> {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`${API_URL}/api/pdf/upload`, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || "Failed to upload PDF");
  }

  return response.json();
}

export async function getPDFInfo(pdfId: string): Promise<PDFInfo> {
  const response = await fetch(`${API_URL}/api/pdf/${pdfId}/info`);

  if (!response.ok) {
    throw new Error("PDF not found");
  }

  return response.json();
}

export async function deletePDF(pdfId: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/pdf/${pdfId}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("Failed to delete PDF");
  }
}

export function formatOutline(outline: OutlineItem[]): string {
  return outline
    .map((item) => {
      const indent = "  ".repeat(item.level - 1);
      return `${indent}- ${item.title} (p.${item.page})`;
    })
    .join("\n");
}

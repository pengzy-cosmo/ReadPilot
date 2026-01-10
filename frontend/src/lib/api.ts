import { getApiBaseUrl } from "./apiBase";

// Centralized API base URL for frontend requests.
const API_URL = getApiBaseUrl();

export interface OutlineItem {
	level: number;
	title: string;
	page: number;
}

export interface DocumentInfo {
	doc_id: string;
	filename: string;
	total_pages: number;
	title: string | null;
	outline: OutlineItem[];
	file_size: number;
	created_at: number;
	updated_at: number;
	last_opened_at: number;
	last_page: number;
	range_start: number;
	range_end: number;
	last_session_id: string | null;
}

export interface DocumentStatePatch {
	last_page?: number;
	range_start?: number;
	range_end?: number;
	last_session_id?: string | null;
}

export interface SessionInfo {
	session_id: string;
	doc_id: string;
	title: string | null;
	created_at: number;
	updated_at: number;
}

export interface MessageInfo {
	message_id: string;
	session_id: string;
	role: "user" | "assistant";
	content: string;
	created_at: number;
	page_start?: number | null;
	page_end?: number | null;
}

export async function importDocument(file: File): Promise<DocumentInfo> {
	// Use multipart/form-data to upload the PDF binary.
	const formData = new FormData();
	formData.append("file", file);

	const response = await fetch(`${API_URL}/api/library/import`, {
		method: "POST",
		body: formData,
	});

	if (!response.ok) {
		const error = await response.text();
		throw new Error(error || "Failed to import PDF");
	}

	return response.json();
}

export async function listDocuments(limit = 12): Promise<DocumentInfo[]> {
	const response = await fetch(`${API_URL}/api/library?limit=${limit}`);
	if (!response.ok) {
		throw new Error("Failed to load library");
	}
	return response.json();
}

export async function getDocument(docId: string): Promise<DocumentInfo> {
	const response = await fetch(`${API_URL}/api/library/${docId}`);
	if (!response.ok) {
		throw new Error("Document not found");
	}
	return response.json();
}

export async function updateDocumentState(docId: string, patch: DocumentStatePatch): Promise<DocumentInfo> {
	const response = await fetch(`${API_URL}/api/library/${docId}/state`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(patch),
	});
	if (!response.ok) {
		throw new Error("Failed to update document state");
	}
	return response.json();
}

export async function createSession(docId: string, title?: string | null): Promise<SessionInfo> {
	const response = await fetch(`${API_URL}/api/sessions`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ doc_id: docId, title: title ?? null }),
	});
	if (!response.ok) {
		throw new Error("Failed to create session");
	}
	return response.json();
}

export async function listSessions(docId: string): Promise<SessionInfo[]> {
	const response = await fetch(`${API_URL}/api/sessions?doc_id=${docId}`);
	if (!response.ok) {
		throw new Error("Failed to load sessions");
	}
	return response.json();
}

export async function getSession(sessionId: string): Promise<SessionInfo> {
	const response = await fetch(`${API_URL}/api/sessions/${sessionId}`);
	if (!response.ok) {
		throw new Error("Session not found");
	}
	return response.json();
}

export async function updateSessionTitle(sessionId: string, title: string | null): Promise<SessionInfo> {
	const response = await fetch(`${API_URL}/api/sessions/${sessionId}`, {
		method: "PATCH",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ title }),
	});
	if (!response.ok) {
		throw new Error("Failed to update session title");
	}
	return response.json();
}

export async function listMessages(sessionId: string): Promise<MessageInfo[]> {
	const response = await fetch(`${API_URL}/api/sessions/${sessionId}/messages`);
	if (!response.ok) {
		throw new Error("Failed to load messages");
	}
	return response.json();
}

export async function clearMessages(sessionId: string): Promise<void> {
	const response = await fetch(`${API_URL}/api/sessions/${sessionId}/messages`, {
		method: "DELETE",
	});
	if (!response.ok) {
		throw new Error("Failed to clear messages");
	}
}

export function getDocumentFileUrl(docId: string): string {
	// Direct file streaming endpoint used by react-pdf.
	return `${API_URL}/api/library/${docId}/file`;
}

export function formatOutline(outline: OutlineItem[]): string {
	// Convert outline items into a simple indented markdown list.
	return outline
		.map((item) => {
			const indent = "  ".repeat(item.level - 1);
			return `${indent}- ${item.title} (p.${item.page})`;
		})
		.join("\n");
}

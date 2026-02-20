/** api.test.ts - Tests for API client functions */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	clearMessages,
	createSession,
	deleteDocument,
	deleteSession,
	formatOutline,
	getDocument,
	getDocumentFileUrl,
	importDocument,
	listDocuments,
	listMessages,
	listSessions,
	updateDocumentState,
	updateSessionTitle,
} from "./api";

// Mock the API base URL
vi.mock("./apiBase", () => ({
	getApiBaseUrl: () => "http://localhost:8000",
}));

describe("API Client", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		global.fetch = vi.fn();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("importDocument", () => {
		it("should upload file and return document info", async () => {
			const mockFile = new File(["pdf content"], "test.pdf", { type: "application/pdf" });
			const mockResponse = {
				doc_id: "abc123",
				filename: "test.pdf",
				total_pages: 10,
				title: "Test Document",
				outline: [],
				file_size: 1000,
				created_at: Date.now(),
				updated_at: Date.now(),
				last_opened_at: Date.now(),
				last_page: 1,
				range_start: 1,
				range_end: 7,
				last_session_id: null,
			};

			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			} as Response);

			const result = await importDocument(mockFile);

			expect(fetch).toHaveBeenCalledWith(
				"http://localhost:8000/api/library/import",
				expect.objectContaining({
					method: "POST",
					body: expect.any(FormData),
				}),
			);
			expect(result).toEqual(mockResponse);
		});

		it("should throw error on failed import", async () => {
			const mockFile = new File(["pdf content"], "test.pdf", { type: "application/pdf" });

			vi.mocked(fetch).mockResolvedValueOnce({
				ok: false,
				text: () => Promise.resolve("Import failed"),
			} as Response);

			await expect(importDocument(mockFile)).rejects.toThrow("Import failed");
		});
	});

	describe("listDocuments", () => {
		it("should return list of documents", async () => {
			const mockDocuments = [
				{
					doc_id: "abc123",
					filename: "test1.pdf",
					total_pages: 10,
					title: "Test 1",
					outline: [],
					file_size: 1000,
					created_at: Date.now(),
					updated_at: Date.now(),
					last_opened_at: Date.now(),
					last_page: 1,
					range_start: 1,
					range_end: 7,
					last_session_id: null,
				},
			];

			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockDocuments),
			} as Response);

			const result = await listDocuments();

			expect(fetch).toHaveBeenCalledWith("http://localhost:8000/api/library?limit=12");
			expect(result).toEqual(mockDocuments);
		});

		it("should accept custom limit", async () => {
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve([]),
			} as Response);

			await listDocuments(20);

			expect(fetch).toHaveBeenCalledWith("http://localhost:8000/api/library?limit=20");
		});

		it("should throw error on failed request", async () => {
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: false,
			} as Response);

			await expect(listDocuments()).rejects.toThrow("Failed to load library");
		});
	});

	describe("getDocument", () => {
		it("should return document info", async () => {
			const mockDoc = {
				doc_id: "abc123",
				filename: "test.pdf",
				total_pages: 10,
				title: "Test",
				outline: [],
				file_size: 1000,
				created_at: Date.now(),
				updated_at: Date.now(),
				last_opened_at: Date.now(),
				last_page: 1,
				range_start: 1,
				range_end: 7,
				last_session_id: null,
			};

			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockDoc),
			} as Response);

			const result = await getDocument("abc123");

			expect(fetch).toHaveBeenCalledWith("http://localhost:8000/api/library/abc123");
			expect(result).toEqual(mockDoc);
		});

		it("should throw error when document not found", async () => {
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: false,
			} as Response);

			await expect(getDocument("invalid-id")).rejects.toThrow("Document not found");
		});
	});

	describe("updateDocumentState", () => {
		it("should update document state", async () => {
			const mockPatch = { last_page: 5, range_start: 1, range_end: 10 };
			const mockResponse = {
				doc_id: "abc123",
				filename: "test.pdf",
				total_pages: 10,
				title: "Test",
				outline: [],
				file_size: 1000,
				created_at: Date.now(),
				updated_at: Date.now(),
				last_opened_at: Date.now(),
				last_page: 5,
				range_start: 1,
				range_end: 10,
				last_session_id: null,
			};

			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockResponse),
			} as Response);

			const result = await updateDocumentState("abc123", mockPatch);

			expect(fetch).toHaveBeenCalledWith("http://localhost:8000/api/library/abc123/state", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(mockPatch),
			});
			expect(result).toEqual(mockResponse);
		});
	});

	describe("createSession", () => {
		it("should create session with title", async () => {
			const mockSession = {
				session_id: "session123",
				doc_id: "abc123",
				title: "My Session",
				created_at: Date.now(),
				updated_at: Date.now(),
			};

			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockSession),
			} as Response);

			const result = await createSession("abc123", "My Session");

			expect(fetch).toHaveBeenCalledWith("http://localhost:8000/api/sessions", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ doc_id: "abc123", title: "My Session" }),
			});
			expect(result).toEqual(mockSession);
		});

		it("should create session without title", async () => {
			const mockSession = {
				session_id: "session123",
				doc_id: "abc123",
				title: null,
				created_at: Date.now(),
				updated_at: Date.now(),
			};

			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockSession),
			} as Response);

			const result = await createSession("abc123");

			expect(fetch).toHaveBeenCalledWith(
				"http://localhost:8000/api/sessions",
				expect.objectContaining({
					body: JSON.stringify({ doc_id: "abc123", title: null }),
				}),
			);
			expect(result).toEqual(mockSession);
		});
	});

	describe("listSessions", () => {
		it("should return sessions for document", async () => {
			const mockSessions = [
				{
					session_id: "session1",
					doc_id: "abc123",
					title: "Session 1",
					created_at: Date.now(),
					updated_at: Date.now(),
				},
			];

			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockSessions),
			} as Response);

			const result = await listSessions("abc123");

			expect(fetch).toHaveBeenCalledWith("http://localhost:8000/api/sessions?doc_id=abc123");
			expect(result).toEqual(mockSessions);
		});
	});

	describe("updateSessionTitle", () => {
		it("should update session title", async () => {
			const mockSession = {
				session_id: "session1",
				doc_id: "abc123",
				title: "New Title",
				created_at: Date.now(),
				updated_at: Date.now(),
			};

			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockSession),
			} as Response);

			const result = await updateSessionTitle("session1", "New Title");

			expect(fetch).toHaveBeenCalledWith("http://localhost:8000/api/sessions/session1", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ title: "New Title" }),
			});
			expect(result).toEqual(mockSession);
		});

		it("should allow setting title to null", async () => {
			const mockSession = {
				session_id: "session1",
				doc_id: "abc123",
				title: null,
				created_at: Date.now(),
				updated_at: Date.now(),
			};

			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockSession),
			} as Response);

			const result = await updateSessionTitle("session1", null);

			expect(fetch).toHaveBeenCalledWith(
				"http://localhost:8000/api/sessions/session1",
				expect.objectContaining({
					body: JSON.stringify({ title: null }),
				}),
			);
			expect(result).toEqual(mockSession);
		});
	});

	describe("listMessages", () => {
		it("should return messages for session", async () => {
			const mockMessages = [
				{
					message_id: "msg1",
					session_id: "session1",
					role: "user",
					content: "Hello",
					created_at: Date.now(),
				},
				{
					message_id: "msg2",
					session_id: "session1",
					role: "assistant",
					content: "Hi there!",
					created_at: Date.now(),
				},
			];

			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
				json: () => Promise.resolve(mockMessages),
			} as Response);

			const result = await listMessages("session1");

			expect(fetch).toHaveBeenCalledWith("http://localhost:8000/api/sessions/session1/messages");
			expect(result).toEqual(mockMessages);
		});
	});

	describe("clearMessages", () => {
		it("should delete all messages for session", async () => {
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
			} as Response);

			await clearMessages("session1");

			expect(fetch).toHaveBeenCalledWith("http://localhost:8000/api/sessions/session1/messages", { method: "DELETE" });
		});
	});

	describe("deleteDocument", () => {
		it("should delete document", async () => {
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
			} as Response);

			await deleteDocument("abc123");

			expect(fetch).toHaveBeenCalledWith("http://localhost:8000/api/library/abc123", { method: "DELETE" });
		});
	});

	describe("deleteSession", () => {
		it("should delete session", async () => {
			vi.mocked(fetch).mockResolvedValueOnce({
				ok: true,
			} as Response);

			await deleteSession("session1");

			expect(fetch).toHaveBeenCalledWith("http://localhost:8000/api/sessions/session1", { method: "DELETE" });
		});
	});

	describe("getDocumentFileUrl", () => {
		it("should return document file URL", () => {
			const url = getDocumentFileUrl("abc123");
			expect(url).toBe("http://localhost:8000/api/library/abc123/file");
		});
	});

	describe("formatOutline", () => {
		it("should format outline as markdown list", () => {
			const outline = [
				{ level: 1, title: "Chapter 1", page: 1 },
				{ level: 2, title: "Section 1.1", page: 3 },
				{ level: 1, title: "Chapter 2", page: 10 },
			];

			const result = formatOutline(outline);

			expect(result).toBe("- Chapter 1 (p.1)\n  - Section 1.1 (p.3)\n- Chapter 2 (p.10)");
		});

		it("should handle empty outline", () => {
			expect(formatOutline([])).toBe("");
		});

		it("should handle deeply nested outline", () => {
			const outline = [
				{ level: 1, title: "A", page: 1 },
				{ level: 2, title: "B", page: 2 },
				{ level: 3, title: "C", page: 3 },
				{ level: 4, title: "D", page: 4 },
			];

			const result = formatOutline(outline);

			expect(result).toBe("- A (p.1)\n  - B (p.2)\n    - C (p.3)\n      - D (p.4)");
		});

		it("should handle titles with special characters", () => {
			const outline = [{ level: 1, title: "Chapter 1: Introduction & Overview", page: 1 }];

			const result = formatOutline(outline);

			expect(result).toBe("- Chapter 1: Introduction & Overview (p.1)");
		});
	});
});

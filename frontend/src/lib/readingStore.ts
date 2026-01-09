export interface DocumentRecord {
  docKey: string;
  title: string;
  fileName: string;
  fileSize: number;
  lastModified: number;
  lastOpenedAt: number;
  lastPage: number;
  pageRange: { start: number; end: number };
  totalPages?: number;
  lastSessionId?: string;
  fileHandle?: FileSystemFileHandle | null;
  fileBlob?: Blob | null;
}

export interface SessionRecord {
  sessionId: string;
  docKey: string;
  title?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface StoredMessage {
  messageId: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  meta?: {
    pageStart: number;
    pageEnd: number;
  };
}

const DB_NAME = "readpilot";
const DB_VERSION = 1;
const STORE_DOCUMENTS = "documents";
const STORE_SESSIONS = "sessions";
const STORE_MESSAGES = "messages";

let dbPromise: Promise<IDBDatabase> | null = null;

const requestToPromise = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const openDB = () => {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_DOCUMENTS)) {
          const store = db.createObjectStore(STORE_DOCUMENTS, {
            keyPath: "docKey",
          });
          store.createIndex("by_lastOpenedAt", "lastOpenedAt");
        }
        if (!db.objectStoreNames.contains(STORE_SESSIONS)) {
          const store = db.createObjectStore(STORE_SESSIONS, {
            keyPath: "sessionId",
          });
          store.createIndex("by_docKey", "docKey");
          store.createIndex("by_updatedAt", "updatedAt");
        }
        if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
          const store = db.createObjectStore(STORE_MESSAGES, {
            keyPath: "messageId",
          });
          store.createIndex("by_sessionId", "sessionId");
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
};

const runTransaction = async <T>(
  storeNames: string[] | string,
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => Promise<T> | T
) => {
  const db = await openDB();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result: T;
    Promise.resolve(fn(tx))
      .then((value) => {
        result = value;
      })
      .catch((error) => {
        try {
          tx.abort();
        } catch {
          // Ignore abort errors.
        }
        reject(error);
      });
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
};

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const buildDocKey = (file: File) =>
  `${file.name}|${file.size}|${file.lastModified}`;

export const getDocument = async (docKey: string) =>
  runTransaction<DocumentRecord | undefined>(
    STORE_DOCUMENTS,
    "readonly",
    (tx) =>
      requestToPromise(
        tx.objectStore(STORE_DOCUMENTS).get(docKey) as IDBRequest<DocumentRecord>
      )
  );

export const upsertDocument = async (record: DocumentRecord) => {
  await runTransaction(STORE_DOCUMENTS, "readwrite", (tx) =>
    requestToPromise(tx.objectStore(STORE_DOCUMENTS).put(record))
  );
};

export const updateDocument = async (
  docKey: string,
  patch: Partial<DocumentRecord>
) => {
  await runTransaction(STORE_DOCUMENTS, "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_DOCUMENTS);
    const existing = (await requestToPromise(
      store.get(docKey) as IDBRequest<DocumentRecord>
    )) as DocumentRecord | undefined;
    if (!existing) return;
    const next = { ...existing, ...patch };
    await requestToPromise(store.put(next));
  });
};

export const getRecentDocuments = async (limit = 12) =>
  runTransaction<DocumentRecord[]>(
    STORE_DOCUMENTS,
    "readonly",
    async (tx) => {
      const store = tx.objectStore(STORE_DOCUMENTS);
      const all = (await requestToPromise(
        store.getAll() as IDBRequest<DocumentRecord[]>
      )) as DocumentRecord[];
      all.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
      return all.slice(0, limit);
    }
  );

export const createSession = async (docKey: string, title?: string | null) =>
  runTransaction<SessionRecord>(STORE_SESSIONS, "readwrite", async (tx) => {
    const session: SessionRecord = {
      sessionId: createId(),
      docKey,
      title: title ?? null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await requestToPromise(tx.objectStore(STORE_SESSIONS).add(session));
    return session;
  });

export const listSessions = async (docKey: string) =>
  runTransaction<SessionRecord[]>(
    STORE_SESSIONS,
    "readonly",
    async (tx) => {
      const store = tx.objectStore(STORE_SESSIONS);
      const index = store.index("by_docKey");
      const items = (await requestToPromise(
        index.getAll(docKey) as IDBRequest<SessionRecord[]>
      )) as SessionRecord[];
      items.sort((a, b) => b.updatedAt - a.updatedAt);
      return items;
    }
  );

export const getSession = async (sessionId: string) =>
  runTransaction<SessionRecord | undefined>(
    STORE_SESSIONS,
    "readonly",
    (tx) =>
      requestToPromise(
        tx.objectStore(STORE_SESSIONS).get(sessionId) as IDBRequest<SessionRecord>
      )
  );

export const touchSession = async (sessionId: string) => {
  await runTransaction(STORE_SESSIONS, "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_SESSIONS);
    const existing = (await requestToPromise(
      store.get(sessionId) as IDBRequest<SessionRecord>
    )) as SessionRecord | undefined;
    if (!existing) return;
    await requestToPromise(
      store.put({ ...existing, updatedAt: Date.now() })
    );
  });
};

export const updateSessionTitle = async (
  sessionId: string,
  title: string | null
) => {
  await runTransaction(STORE_SESSIONS, "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_SESSIONS);
    const existing = (await requestToPromise(
      store.get(sessionId) as IDBRequest<SessionRecord>
    )) as SessionRecord | undefined;
    if (!existing) return;
    await requestToPromise(
      store.put({
        ...existing,
        title,
        updatedAt: Date.now(),
      })
    );
  });
};

export const deleteSession = async (sessionId: string) => {
  await runTransaction([STORE_SESSIONS, STORE_MESSAGES], "readwrite", async (tx) => {
    const sessionStore = tx.objectStore(STORE_SESSIONS);
    const messageStore = tx.objectStore(STORE_MESSAGES);
    const messageIndex = messageStore.index("by_sessionId");
    const keys = (await requestToPromise(
      messageIndex.getAllKeys(sessionId) as IDBRequest<IDBValidKey[]>
    )) as IDBValidKey[];
    keys.forEach((key) => messageStore.delete(key));
    await requestToPromise(sessionStore.delete(sessionId));
  });
};

export const clearSessionMessages = async (sessionId: string) => {
  await runTransaction(STORE_MESSAGES, "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_MESSAGES);
    const index = store.index("by_sessionId");
    const keys = (await requestToPromise(
      index.getAllKeys(sessionId) as IDBRequest<IDBValidKey[]>
    )) as IDBValidKey[];
    keys.forEach((key) => store.delete(key));
  });
};

export const appendMessages = async (
  sessionId: string,
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    meta?: { pageStart: number; pageEnd: number };
  }>
) => {
  if (messages.length === 0) return;
  await runTransaction(STORE_MESSAGES, "readwrite", async (tx) => {
    const store = tx.objectStore(STORE_MESSAGES);
    const now = Date.now();
    for (const message of messages) {
      const record: StoredMessage = {
        messageId: createId(),
        sessionId,
        role: message.role,
        content: message.content,
        meta: message.meta,
        createdAt: now,
      };
      store.add(record);
    }
  });
};

export const loadMessages = async (sessionId: string) =>
  runTransaction<StoredMessage[]>(
    STORE_MESSAGES,
    "readonly",
    async (tx) => {
      const store = tx.objectStore(STORE_MESSAGES);
      const index = store.index("by_sessionId");
      const items = (await requestToPromise(
        index.getAll(sessionId) as IDBRequest<StoredMessage[]>
      )) as StoredMessage[];
      items.sort((a, b) => a.createdAt - b.createdAt);
      return items;
    }
  );

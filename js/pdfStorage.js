/**
 * Axiom Studia — PDF Persistent Storage (IndexedDB)
 * Allows storing large PDF files (textbooks, lecture slides, reviewers)
 * without exceeding browser localStorage limits (5MB) or crashing memory.
 */

const DB_NAME = 'axiom_pdf_store';
const DB_VERSION = 1;
const STORE_NAME = 'pdf_files';

let dbPromise = null;

function getDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    try {
      if (!window.indexedDB) {
        resolve(null);
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => {
        console.warn('IndexedDB open error for PDF store:', e);
        resolve(null);
      };
    } catch (e) {
      console.warn('IndexedDB not supported or accessible:', e);
      resolve(null);
    }
  });
  return dbPromise;
}

export async function savePdfToStorage(id, fileOrBlob, filename) {
  try {
    const db = await getDb();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const record = {
          id,
          blob: fileOrBlob,
          name: filename || 'document.pdf',
          size: fileOrBlob.size,
          updatedAt: Date.now()
        };
        const req = store.put(record);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (err) {
        console.warn('savePdfToStorage error:', err);
        resolve(false);
      }
    });
  } catch (err) {
    console.warn('Failed to save PDF to IndexedDB:', err);
    return false;
  }
}

export async function getPdfFromStorage(id) {
  try {
    const db = await getDb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result ? req.result.blob : null);
        req.onerror = () => resolve(null);
      } catch (err) {
        console.warn('getPdfFromStorage error:', err);
        resolve(null);
      }
    });
  } catch (err) {
    console.warn('Failed to get PDF from IndexedDB:', err);
    return null;
  }
}

export async function deletePdfFromStorage(id) {
  try {
    const db = await getDb();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const req = store.delete(id);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
      } catch (err) {
        console.warn('deletePdfFromStorage error:', err);
        resolve(false);
      }
    });
  } catch (err) {
    console.warn('Failed to delete PDF from IndexedDB:', err);
    return false;
  }
}

export async function hasPdfInStorage(id) {
  try {
    const blob = await getPdfFromStorage(id);
    return Boolean(blob);
  } catch (_) {
    return false;
  }
}

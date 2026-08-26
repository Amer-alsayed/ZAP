// ==========================================
// Upload Manager
// ==========================================
// Module-level singleton that tracks file upload progress and cancellation
// OUTSIDE of React component state. This way the progress UI survives
// navigating away from a chat (ChatArea unmount) and re-attaches when the
// user returns, instead of silently continuing in the background.

export class UploadCancelledError extends Error {
  constructor() {
    super('Upload cancelled');
    this.name = 'UploadCancelledError';
    this.isCancelled = true;
  }
}

class UploadManager {
  constructor() {
    this.snapshot = { uploading: false, progress: null };
    this.listeners = new Set();
    this.cancelRequested = false;
    this.cancelHandlers = new Set();
  }

  getSnapshot() {
    return this.snapshot;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit() {
    this.listeners.forEach((listener) => {
      try {
        listener(this.snapshot);
      } catch (e) {}
    });
  }

  setUploading(value) {
    if (this.snapshot.uploading === value) return;
    this.snapshot = { ...this.snapshot, uploading: value };
    this.emit();
  }

  setProgress(progress) {
    const next = progress ? { ...progress } : null;
    this.snapshot = { ...this.snapshot, progress: next };
    this.emit();
  }

  // Called at the start of a new send batch to clear any stale cancel flag
  beginBatch() {
    this.cancelRequested = false;
    this.cancelHandlers.clear();
  }

  requestCancel() {
    this.cancelRequested = true;
    this.cancelHandlers.forEach((handler) => {
      try {
        handler();
      } catch (e) {}
    });
  }

  isCancelled() {
    return this.cancelRequested;
  }

  registerCancelHandler(handler) {
    this.cancelHandlers.add(handler);
    return () => {
      this.cancelHandlers.delete(handler);
    };
  }
}

export const uploadManager = new UploadManager();

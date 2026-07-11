export interface PendingOperation {
  id: string;
  idempotencyKey: string;
  type: string;
  createdAt: string;
  status: "pending" | "failed";
  payload?: Record<string, unknown>;
  lastError?: string;
}

const OFFLINE_QUEUE_KEY = "mining.offlineQueue.v1";
const listeners = new Set<(operations: PendingOperation[]) => void>();

function readQueue() {
  try {
    const parsed = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || "[]") as PendingOperation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(operations: PendingOperation[]) {
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(operations));
  listeners.forEach((listener) => listener(operations));
}

export function getPendingOperations() {
  return readQueue();
}

export function queueOperation(input: Omit<PendingOperation, "id" | "createdAt" | "status" | "idempotencyKey"> & { idempotencyKey?: string }) {
  const idempotencyKey = input.idempotencyKey || crypto.randomUUID();
  const existing = readQueue();
  if (existing.some((operation) => operation.idempotencyKey === idempotencyKey)) {
    return existing.find((operation) => operation.idempotencyKey === idempotencyKey)!;
  }

  const operation: PendingOperation = {
    ...input,
    id: crypto.randomUUID(),
    idempotencyKey,
    createdAt: new Date().toISOString(),
    status: "pending",
  };
  writeQueue([...existing, operation]);
  return operation;
}

export function removePendingOperation(id: string) {
  writeQueue(readQueue().filter((operation) => operation.id !== id));
}

export function clearOfflineQueue() {
  writeQueue([]);
}

export function subscribeOfflineQueue(listener: (operations: PendingOperation[]) => void) {
  listeners.add(listener);
  listener(readQueue());
  return () => listeners.delete(listener);
}

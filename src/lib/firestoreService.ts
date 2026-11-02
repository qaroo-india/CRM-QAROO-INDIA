/**
 * Cloud Firestore Standalone Database Service.
 *
 * Provides typed, robust operations to store, query, and synchronize all CRM
 * entities (users, students, courses, batches, leads, payments, attendance,
 * exams, etc.) with Cloud Firestore as a standalone cloud database.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit as firestoreLimit,
  serverTimestamp,
  onSnapshot,
  type DocumentData,
  type QueryConstraint,
  type Unsubscribe,
} from 'firebase/firestore';
import { firestore } from './firebase';

export interface FirestoreQueryOptions {
  whereClause?: [string, '<' | '<=' | '==' | '!=' | '>=' | '>' | 'array-contains' | 'in' | 'array-contains-any', unknown][];
  orderByField?: string;
  orderDirection?: 'asc' | 'desc';
  limitCount?: number;
}

/**
 * Fetch a single document by ID from a given collection.
 */
export async function getFirestoreDoc<T = DocumentData>(
  collectionName: string,
  docId: string,
): Promise<(T & { id: string }) | null> {
  const docRef = doc(firestore, collectionName, docId);
  const snap = await getDoc(docRef);
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as T) };
}

/**
 * Write or update a document with a specified ID.
 */
export async function setFirestoreDoc<T extends Record<string, unknown>>(
  collectionName: string,
  docId: string,
  data: T,
  merge = true,
): Promise<T & { id: string }> {
  const docRef = doc(firestore, collectionName, docId);
  const payload = {
    ...data,
    updatedAt: serverTimestamp(),
  };
  await setDoc(docRef, payload, { merge });
  return { id: docId, ...data };
}

/**
 * Add a new document with an auto-generated ID.
 */
export async function addFirestoreDoc<T extends Record<string, unknown>>(
  collectionName: string,
  data: T,
): Promise<T & { id: string }> {
  const colRef = collection(firestore, collectionName);
  const payload = {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  const docRef = await addDoc(colRef, payload);
  return { id: docRef.id, ...data };
}

/**
 * Update specific fields of an existing document.
 */
export async function updateFirestoreDoc<T extends Record<string, unknown>>(
  collectionName: string,
  docId: string,
  data: Partial<T>,
): Promise<void> {
  const docRef = doc(firestore, collectionName, docId);
  await updateDoc(docRef, {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

/**
 * Delete a document from Firestore.
 */
export async function deleteFirestoreDoc(
  collectionName: string,
  docId: string,
): Promise<void> {
  const docRef = doc(firestore, collectionName, docId);
  await deleteDoc(docRef);
}

/**
 * Query documents from a Firestore collection with optional filters, ordering, and limits.
 */
export async function listFirestoreDocs<T = DocumentData>(
  collectionName: string,
  options: FirestoreQueryOptions = {},
): Promise<(T & { id: string })[]> {
  const colRef = collection(firestore, collectionName);
  const constraints: QueryConstraint[] = [];

  if (options.whereClause) {
    for (const [field, op, val] of options.whereClause) {
      if (val !== undefined && val !== null) {
        constraints.push(where(field, op, val));
      }
    }
  }

  if (options.orderByField) {
    constraints.push(orderBy(options.orderByField, options.orderDirection || 'asc'));
  }

  if (options.limitCount && options.limitCount > 0) {
    constraints.push(firestoreLimit(options.limitCount));
  }

  const q = constraints.length > 0 ? query(colRef, ...constraints) : query(colRef);
  const snapshot = await getDocs(q);

  return snapshot.docs.map((d) => ({
    id: d.id,
    ...(d.data() as T),
  }));
}

/**
 * Subscribe to real-time updates for a collection or query.
 */
export function subscribeFirestoreDocs<T = DocumentData>(
  collectionName: string,
  onData: (data: (T & { id: string })[]) => void,
  onError?: (err: Error) => void,
  options: FirestoreQueryOptions = {},
): Unsubscribe {
  const colRef = collection(firestore, collectionName);
  const constraints: QueryConstraint[] = [];

  if (options.whereClause) {
    for (const [field, op, val] of options.whereClause) {
      if (val !== undefined && val !== null) {
        constraints.push(where(field, op, val));
      }
    }
  }

  if (options.orderByField) {
    constraints.push(orderBy(options.orderByField, options.orderDirection || 'asc'));
  }

  if (options.limitCount) {
    constraints.push(firestoreLimit(options.limitCount));
  }

  const q = constraints.length > 0 ? query(colRef, ...constraints) : query(colRef);

  return onSnapshot(
    q,
    (snapshot) => {
      const items = snapshot.docs.map((d) => ({
        id: d.id,
        ...(d.data() as T),
      }));
      onData(items);
    },
    (err) => {
      if (onError) onError(err);
      else console.error(`Firestore real-time subscription error [${collectionName}]:`, err);
    },
  );
}

/* ------------------------------------------------------------------ *
 * Specialized Domain Helpers
 * ------------------------------------------------------------------ */

export const firestoreDb = {
  // Students
  students: {
    list: (opts?: FirestoreQueryOptions) => listFirestoreDocs('students', opts),
    get: (id: string) => getFirestoreDoc('students', id),
    save: (id: string, data: Record<string, unknown>) => setFirestoreDoc('students', id, data),
    delete: (id: string) => deleteFirestoreDoc('students', id),
  },
  // Courses
  courses: {
    list: (opts?: FirestoreQueryOptions) => listFirestoreDocs('courses', opts),
    get: (id: string) => getFirestoreDoc('courses', id),
    save: (id: string, data: Record<string, unknown>) => setFirestoreDoc('courses', id, data),
  },
  // Batches
  batches: {
    list: (opts?: FirestoreQueryOptions) => listFirestoreDocs('batches', opts),
    get: (id: string) => getFirestoreDoc('batches', id),
    save: (id: string, data: Record<string, unknown>) => setFirestoreDoc('batches', id, data),
  },
  // Leads
  leads: {
    list: (opts?: FirestoreQueryOptions) => listFirestoreDocs('leads', opts),
    get: (id: string) => getFirestoreDoc('leads', id),
    save: (id: string, data: Record<string, unknown>) => setFirestoreDoc('leads', id, data),
    delete: (id: string) => deleteFirestoreDoc('leads', id),
  },
  // Admissions
  admissions: {
    list: (opts?: FirestoreQueryOptions) => listFirestoreDocs('admissions', opts),
    get: (id: string) => getFirestoreDoc('admissions', id),
    save: (id: string, data: Record<string, unknown>) => setFirestoreDoc('admissions', id, data),
  },
  // Payments
  payments: {
    list: (opts?: FirestoreQueryOptions) => listFirestoreDocs('payments', opts),
    get: (id: string) => getFirestoreDoc('payments', id),
    save: (id: string, data: Record<string, unknown>) => setFirestoreDoc('payments', id, data),
  },
  // Attendance
  attendance: {
    list: (opts?: FirestoreQueryOptions) => listFirestoreDocs('attendance', opts),
    save: (id: string, data: Record<string, unknown>) => setFirestoreDoc('attendance', id, data),
  },
  // Settings
  settings: {
    get: () => getFirestoreDoc('institute_settings', 'default'),
    save: (data: Record<string, unknown>) => setFirestoreDoc('institute_settings', 'default', data),
  },
  // Tasks
  tasks: {
    list: (opts?: FirestoreQueryOptions) => listFirestoreDocs('tasks', opts),
    save: (id: string, data: Record<string, unknown>) => setFirestoreDoc('tasks', id, data),
    delete: (id: string) => deleteFirestoreDoc('tasks', id),
  },
};

/**
 * Firestore User Data Operations.
 *
 * Stores and manages user documents in Cloud Firestore under the "users" collection.
 */

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  type DocumentData,
} from 'firebase/firestore';
import { firestore } from './firebase';

export interface FirebaseUserProfile {
  uid: string;
  email: string;
  name: string;
  role: 'owner' | 'staff' | 'trainer' | 'student';
  accountType: 'team' | 'faculty' | 'student';
  photoURL?: string | null;
  phone?: string | null;
  createdAt?: unknown;
  lastLoginAt?: unknown;
}

/**
 * Creates or updates the user profile in Firestore.
 */
export async function syncUserToFirestore(params: {
  uid: string;
  email: string;
  name?: string | null;
  photoURL?: string | null;
  role?: 'owner' | 'staff' | 'trainer' | 'student';
  accountType?: 'team' | 'faculty' | 'student';
}): Promise<FirebaseUserProfile> {
  const userRef = doc(firestore, 'users', params.uid);
  const snapshot = await getDoc(userRef);

  const isOwnerDefault =
    params.email.toLowerCase() === 'admin@qaroo.in' ||
    params.email.toLowerCase() === 'owner@institute.local';

  const assignedRole = params.role ?? (isOwnerDefault ? 'owner' : 'staff');
  const assignedAccountType = params.accountType ?? 'team';
  const name = params.name || params.email.split('@')[0] || 'User';

  if (!snapshot.exists()) {
    const newProfile: FirebaseUserProfile = {
      uid: params.uid,
      email: params.email.toLowerCase(),
      name,
      role: assignedRole,
      accountType: assignedAccountType,
      photoURL: params.photoURL || null,
      createdAt: serverTimestamp(),
      lastLoginAt: serverTimestamp(),
    };
    await setDoc(userRef, newProfile);
    return newProfile;
  }

  // Update existing user profile
  await updateDoc(userRef, {
    name: params.name || snapshot.data()?.name || name,
    photoURL: params.photoURL ?? snapshot.data()?.photoURL ?? null,
    lastLoginAt: serverTimestamp(),
  });

  return {
    ...snapshot.data(),
    uid: params.uid,
    email: params.email,
  } as FirebaseUserProfile;
}

/**
 * Retrieves a user document from Firestore by UID.
 */
export async function getUserFromFirestore(uid: string): Promise<DocumentData | null> {
  const userRef = doc(firestore, 'users', uid);
  const snapshot = await getDoc(userRef);
  return snapshot.exists() ? snapshot.data() : null;
}

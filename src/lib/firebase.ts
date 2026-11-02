/**
 * Firebase Client SDK Initialization.
 *
 * Configures Firebase Authentication and Cloud Firestore for CRM-QAROO.
 */

import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyCxaABFscGMDzIblR2zd_ekNMJeJc1ENhE',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'crm-qaroo.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'crm-qaroo',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'crm-qaroo.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '467452778873',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:467452778873:web:599a2ee7b2a1235f1fb7a8',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-EQGZ1MHJ61',
};

// Singleton initialization across hot module reloads
export const app: FirebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth: Auth = getAuth(app);
export const firestore: Firestore = getFirestore(app);

// Authentication Providers
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

// Firebase client config is public by design — it ships in the bundle and the
// protection comes from Firestore rules, not from hiding these values.
const firebaseConfig = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID,
};

const app: FirebaseApp = getApps().length
  ? getApps()[0]
  : initializeApp(firebaseConfig);

export const db = getFirestore(app);

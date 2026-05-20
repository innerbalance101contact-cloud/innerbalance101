/**
 * innerbalance101 — Firebase Auth Module
 * ─────────────────────────────────────
 * Import this script on any page that needs authentication.
 *
 * Usage:
 *   <script type="module" src="/js/auth.js"></script>
 *
 * Exports (via window.IB101Auth for non-module pages):
 *   signUp(email, password, displayName)
 *   signIn(email, password)
 *   signInWithGoogle()
 *   signOut()
 *   getCurrentUser()   → Firebase User object or null
 *   getUserProfile()   → Firestore profile doc
 *   onAuthChange(cb)   → cb(user) called on every auth state change
 *   requireAuth()      → redirects to /login.html if not signed in
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── CONFIG ──────────────────────────────────────────────────────────────────
// Replace these values with your Firebase project config.
// Get them from: Firebase Console → Project Settings → Your apps → SDK setup
const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID",
};

// ─── INITIALISE ───────────────────────────────────────────────────────────────
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/** Create or update the user's Firestore profile document */
async function upsertUserProfile(user, extras = {}) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      uid:         user.uid,
      email:       user.email,
      displayName: user.displayName || extras.displayName || "",
      photoURL:    user.photoURL    || "",
      createdAt:   serverTimestamp(),
      purchases:   [],
      progress:    {},
      assessment:  null,
      ...extras,
    });
  } else {
    // Keep email in sync in case it was changed
    await updateDoc(ref, { email: user.email, lastSeen: serverTimestamp() });
  }
  return getDoc(ref);
}

// ─── AUTH ACTIONS ─────────────────────────────────────────────────────────────

/**
 * Create a new account with email + password.
 * @returns {Promise<{user, profile}>}
 */
export async function signUp(email, password, displayName = "") {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) {
    await updateProfile(cred.user, { displayName });
  }
  const profileSnap = await upsertUserProfile(cred.user, { displayName });
  return { user: cred.user, profile: profileSnap.data() };
}

/**
 * Sign in with email + password.
 * @returns {Promise<{user, profile}>}
 */
export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  const profileSnap = await upsertUserProfile(cred.user);
  return { user: cred.user, profile: profileSnap.data() };
}

/**
 * Sign in with Google popup.
 * @returns {Promise<{user, profile}>}
 */
export async function signInWithGoogle() {
  const cred = await signInWithPopup(auth, googleProvider);
  const profileSnap = await upsertUserProfile(cred.user);
  return { user: cred.user, profile: profileSnap.data() };
}

/** Sign the current user out. */
export async function signOut() {
  await firebaseSignOut(auth);
}

/** Returns the currently signed-in user, or null. */
export function getCurrentUser() {
  return auth.currentUser;
}

/**
 * Fetch the current user's Firestore profile.
 * @returns {Promise<Object|null>}
 */
export async function getUserProfile() {
  const user = auth.currentUser;
  if (!user) return null;
  const snap = await getDoc(doc(db, "users", user.uid));
  return snap.exists() ? snap.data() : null;
}

/**
 * Subscribe to auth state changes.
 * @param {Function} callback  called with (user | null)
 * @returns unsubscribe function
 */
export function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

/**
 * Call at the top of any page that requires a logged-in user.
 * Redirects to /login.html if no session is found.
 */
export function requireAuth(redirectUrl = "/login.html") {
  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (user) => {
      unsub();
      if (!user) {
        window.location.href = redirectUrl + "?next=" + encodeURIComponent(window.location.pathname);
      } else {
        resolve(user);
      }
    });
  });
}

/**
 * Send a password-reset email.
 */
export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

/**
 * Update the user's Firestore profile with arbitrary fields.
 * Safe to call after assessment completion, progress updates, etc.
 */
export async function updateUserProfile(data) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  await updateDoc(doc(db, "users", user.uid), {
    ...data,
    updatedAt: serverTimestamp(),
  });
}

// ─── EXPOSE TO NON-MODULE PAGES ──────────────────────────────────────────────
// Pages that don't use ES modules can access these via window.IB101Auth
window.IB101Auth = {
  signUp, signIn, signInWithGoogle, signOut,
  getCurrentUser, getUserProfile, onAuthChange,
  requireAuth, resetPassword, updateUserProfile,
};

export { db, auth };

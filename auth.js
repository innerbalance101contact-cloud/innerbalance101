/**
 * innerbalance101 — Firebase Auth Module
 * ─────────────────────────────────────
 * Modular Firebase SDK (v10) loaded via CDN — no build step required.
 *
 * Usage on any page:
 *   <script type="module" src="/js/auth.js"></script>
 *
 * Named exports (ES module consumers):
 *   signUp(email, password, displayName)
 *   signIn(email, password)
 *   signInWithGoogle()
 *   signOut()
 *   getCurrentUser()        → Firebase User object or null
 *   getUserProfile()        → Firestore profile doc data or null
 *   onAuthChange(callback)  → callback(user | null); returns unsubscribe fn
 *   requireAuth()           → redirects to /login.html if not signed in
 *   resetPassword(email)
 *   updateUserProfile(data) → merge arbitrary fields into users/{uid}
 *
 * Non-module pages can also use: window.IB101Auth.<method>
 *
 * Firestore document written to users/{uid} on every login:
 *   { uid, email, displayName, photoURL, provider,
 *     createdAt (first login only), lastSeen, purchases, progress, assessment }
 *
 * ── SETUP ────────────────────────────────────────────────────────────────────
 * 1. Go to Firebase Console → Project Settings → Your apps → Web app
 * 2. Copy the firebaseConfig object and paste it below.
 * 3. In Firebase Console → Authentication → Sign-in method, enable:
 *      • Email/Password
 *      • Google
 * 4. In Firestore → Rules, make sure users/{uid} is writable by the owner.
 */

// ── Firebase SDK (modular, CDN) ───────────────────────────────────────────────
import { initializeApp }                       from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
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
}                                              from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
}                                              from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Firebase config ───────────────────────────────────────────────────────────
// Paste your project's config object here.
// Firebase Console → Project Settings → Your apps → SDK setup & configuration
const firebaseConfig = {
  apiKey:            "AIzaSyBZj4uFW0LSG8WTLqLuH0_rzij28-1A51U",
  authDomain:        "innerbalance101-33628.firebaseapp.com",
  projectId:         "innerbalance101-33628",
  storageBucket:     "innerbalance101-33628.firebasestorage.app",
  messagingSenderId: "682049993683",
  appId:             "1:682049993683:web:59ca5209a0039f86208d26",
  measurementId:     "G-GKSZK29P8Q",
};

// ─── INITIALISE ───────────────────────────────────────────────────────────────
const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// ─── HELPERS ──────────────────────────────────────────────────────────────────

/**
 * Resolve the sign-in provider label from Firebase providerData.
 * Returns "google" | "password" | the raw providerId string.
 */
function resolveProvider(user) {
  const id = user.providerData?.[0]?.providerId ?? "unknown";
  if (id === "google.com") return "google";
  if (id === "password")   return "password";
  return id;
}

/**
 * Create or update the user's Firestore document at users/{uid}.
 * Fields written on first login: uid, email, displayName, photoURL,
 *   provider, createdAt, purchases, progress, assessment.
 * Fields updated on every login: email, displayName, provider, lastSeen.
 */
async function upsertUserProfile(user, extras = {}) {
  const ref      = doc(db, "users", user.uid);
  const snap     = await getDoc(ref);
  const provider = resolveProvider(user);

  if (!snap.exists()) {
    // ── First login: create the full document ─────────────────────────────
    await setDoc(ref, {
      uid:         user.uid,
      email:       user.email,
      displayName: user.displayName || extras.displayName || "",
      photoURL:    user.photoURL    || "",
      provider,
      createdAt:   serverTimestamp(),
      lastSeen:    serverTimestamp(),
      purchases:   [],
      progress:    {},
      assessment:  null,
      ...extras,
    });
  } else {
    // ── Returning user: sync mutable fields ───────────────────────────────
    await updateDoc(ref, {
      email:       user.email,
      displayName: user.displayName || snap.data().displayName || "",
      provider,                        // update in case they switched methods
      lastSeen:    serverTimestamp(),
    });
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

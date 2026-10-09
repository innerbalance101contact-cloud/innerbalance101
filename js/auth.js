/**
 * innerbalance101 — sign-in module
 * ────────────────────────────────
 * Firebase handles identity only (who you are). What you have access to and
 * where you are in the program live on the server (see functions/).
 *
 * Flow: sign in with Firebase → verified email required → POST /api/session
 * trades the Firebase token for a secure session cookie → the server checks
 * the cookie on every protected page.
 *
 *   signUp(email, password, name)  → sends a verification email
 *   signIn(email, password)        → starts a session if the email is verified
 *   signInWithGoogle()             → Google emails are already verified
 *   signOut()                      → clears the session and the Firebase login
 *   resetPassword(email)
 *   getMe()                        → { ... } from /api/me, or null if signed out
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as firebaseSignOut,
  updateProfile,
  sendPasswordResetEmail,
  sendEmailVerification,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey:            "AIzaSyBZj4uFW0LSG8WTLqLuH0_rzij28-1A51U",
  authDomain:        "innerbalance101-33628.firebaseapp.com",
  projectId:         "innerbalance101-33628",
  storageBucket:     "innerbalance101-33628.firebasestorage.app",
  messagingSenderId: "682049993683",
  appId:             "1:682049993683:web:59ca5209a0039f86208d26",
  measurementId:     "G-GKSZK29P8Q",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

/** Error thrown when an email/password account has not verified its email yet. */
function unverifiedError(email) {
  const e = new Error("Please verify your email first.");
  e.code = "ib101/email-not-verified";
  e.email = email;
  return e;
}

/** Trade the Firebase login for the server session cookie. */
async function startSession(user) {
  const idToken = await user.getIdToken(true);
  const res = await fetch("/api/session", {
    method: "POST",
    headers: { Authorization: `Bearer ${idToken}` },
    credentials: "same-origin",
  });
  if (res.status === 403) throw unverifiedError(user.email);
  if (!res.ok) throw new Error("Could not start your session. Please try again.");
}

export async function signUp(email, password, displayName = "") {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  if (displayName) await updateProfile(cred.user, { displayName });
  await sendEmailVerification(cred.user, { url: `${location.origin}/login.html` });
  try {
    const token = await cred.user.getIdToken();
    await fetch("/api/trace", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ event: "signup_created" }) });
  } catch { /* bookkeeping only */ }
  await firebaseSignOut(auth);
  return { needsVerification: true, email };
}

export async function signIn(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  if (!cred.user.emailVerified) {
    try { await sendEmailVerification(cred.user, { url: `${location.origin}/login.html` }); } catch { /* rate limited */ }
    await firebaseSignOut(auth);
    throw unverifiedError(email);
  }
  await startSession(cred.user);
  return { email: cred.user.email };
}

export async function signInWithGoogle() {
  const cred = await signInWithPopup(auth, googleProvider);
  await startSession(cred.user);
  return { email: cred.user.email };
}

export async function signOut() {
  try { await fetch("/api/session", { method: "DELETE", credentials: "same-origin" }); } catch { /* offline */ }
  try { await firebaseSignOut(auth); } catch { /* already out */ }
}

/** Tell the admin page where someone got stuck. Never blocks the page. */
export function trace(event, email, code = "") {
  try {
    fetch("/api/trace", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event, email, code }), keepalive: true }).catch(() => {});
  } catch { /* ignore */ }
}

export async function resetPassword(email) {
  await sendPasswordResetEmail(auth, email);
}

/** Who is signed in, what they can open, and their progress. Null when signed out. */
export async function getMe() {
  const d = new Date();
  const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const res = await fetch(`/api/me?d=${local}`, { credentials: "same-origin" });
  return res.ok ? res.json() : null;
}

window.IB101Auth = { trace, signUp, signIn, signInWithGoogle, signOut, resetPassword, getMe };
export { auth };

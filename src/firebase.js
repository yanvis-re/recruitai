import { initializeApp } from "firebase/app";
import { getFirestore, doc, getDoc, setDoc } from "firebase/firestore";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBpiT0fZcyHkiPBxsMdryaepbZaMOUyl4g",
  authDomain: "recruitai-8cada.firebaseapp.com",
  projectId: "recruitai-8cada",
  storageBucket: "recruitai-8cada.firebasestorage.app",
  messagingSenderId: "974660602451",
  appId: "1:974660602451:web:023e8a7dfbd5c0ffc614a6"
};

const app = initializeApp(firebaseConfig);

export const db        = getFirestore(app);
export const auth      = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

export { doc, getDoc, setDoc, signInWithPopup, signOut, onAuthStateChanged };

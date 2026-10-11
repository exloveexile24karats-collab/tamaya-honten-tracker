import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// ★ 玉屋本店専用の Firebase プロジェクト（tamaya-honten-a0698）。
//   （プラザ2・雑餉隈のプロジェクトの値は絶対に使わないこと）
//   値が REPLACE_ME のままの間は、アプリは保存・読み込みをせず、
//   画面上部に「Firebase未設定」と表示します。
const firebaseConfig = {
  apiKey: "AIzaSyD9lUChVTHPaImIf8Z64Xh-ctB4_zd5RlA",
  authDomain: "tamaya-honten-a0698.firebaseapp.com",
  projectId: "tamaya-honten-a0698",
  storageBucket: "tamaya-honten-a0698.firebasestorage.app",
  messagingSenderId: "967116339050",
  appId: "1:967116339050:web:9b6139cb99c59873475713",
};

export const firebaseReady = !String(firebaseConfig.apiKey).startsWith("REPLACE");
export const app = firebaseReady ? initializeApp(firebaseConfig) : null;
export const db = firebaseReady ? getFirestore(app) : null;

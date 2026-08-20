// ここに Firebase コンソール(https://console.firebase.google.com/)で作成した
// プロジェクトの「ウェブアプリの構成」をそのまま貼り付けてください。
// 手順は README.md の「1. Firebase プロジェクトを作る」を参照。
//
// 例:
// export const firebaseConfig = {
//   apiKey: "AIzaSyxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
//   authDomain: "your-project.firebaseapp.com",
//   databaseURL: "https://your-project-default-rtdb.asia-southeast1.firebasedatabase.app",
//   projectId: "your-project",
//   storageBucket: "your-project.appspot.com",
//   messagingSenderId: "123456789012",
//   appId: "1:123456789012:web:xxxxxxxxxxxxxxxxxxxxxx",
// };
//
// databaseURL は Realtime Database を作成した後でないと表示されないことがあります。
// 見当たらない場合は、先にRealtime Databaseを作成してから、もう一度SDKの構成を確認してください。

export const firebaseConfig = {
  apiKey: "AIzaSyDahEkvZtMftsGJSjFj3L6VMKDB7IwrCOM",
  authDomain: "hamono-koukan.firebaseapp.com",
  databaseURL: "https://hamono-koukan-default-rtdb.firebaseio.com",
  projectId: "hamono-koukan",
  storageBucket: "hamono-koukan.firebasestorage.app",
  messagingSenderId: "772550996120",
  appId: "1:772550996120:web:8e0fdf156c671e63e920ed",
};

export const isConfigured = () =>
  firebaseConfig.apiKey && firebaseConfig.apiKey !== "YOUR_API_KEY";

// 共通パスコード用の「見せかけメールアドレス」。
// Firebaseコンソールの Authentication > Users で、このメールアドレスと
// 工場の共通パスコード（パスワードとして）を持つユーザーを1つ作成してください。
// 実在のメールアドレスである必要はありません。手順はREADME.mdを参照。
export const SHARED_LOGIN_EMAIL = "staff@hamono-app.local";

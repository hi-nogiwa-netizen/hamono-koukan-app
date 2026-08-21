// このアプリは、PWAのオフラインキャッシュ機能（Service Worker）の利用をやめることにした。
// 更新するたびに古いキャッシュが端末に残ってしまい、最新版が反映されない問題が
// 繰り返し起きたため。このファイルは「後片付け専用」で、
// 既に登録されてしまっている端末のService Workerを自動的に解除し、
// 溜まっていたキャッシュも削除したうえで、ページを最新の状態に読み込み直す。
// （app/js/app.js からも、新しくService Workerを登録する処理は削除済み）

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clientsList = await self.clients.matchAll({ type: "window" });
      clientsList.forEach((client) => client.navigate(client.url));
    })()
  );
});

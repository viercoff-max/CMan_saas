// Conversa service worker: shows notices. The push itself is EMPTY (no customer data passes through the browser's
// push service); the text is fetched from /api/push/latest with this person's own session.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let n = { title: "Conversa", body: "Tienes un aviso nuevo.", url: "/inbox", kind: "waiting", id: "" };
    try {
      const r = await fetch("/api/push/latest", { credentials: "include", cache: "no-store" });
      if (r.ok) { const j = await r.json(); if (j && j.notice) n = j.notice; }
    } catch { /* offline: generic notice */ }
    await self.registration.showNotification(n.title, {
      body: n.body, icon: "/icon-192.png", badge: "/icon-192.png", tag: n.id || n.kind,
      requireInteraction: n.kind === "urgent", data: { url: n.url },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/inbox";
  if (typeof url !== "string" || !url.startsWith("/")) return;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) { if ("focus" in c) { await c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  })());
});

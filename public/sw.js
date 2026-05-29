// This service worker replaces the old PWA cache and immediately unregisters itself.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", async () => {
  // Clear ALL old caches
  const keys = await caches.keys();
  await Promise.all(keys.map((k) => caches.delete(k)));
  // Unregister this SW so the new app runs cache-free
  await self.registration.unregister();
  // Force all clients to reload with fresh content
  const clients = await self.clients.matchAll({ type: "window" });
  clients.forEach((client) => client.navigate(client.url));
});

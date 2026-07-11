export type ServiceWorkerUpdateCallback = (registration: ServiceWorkerRegistration) => void;

export function registerServiceWorker(onUpdate?: ServiceWorkerUpdateCallback) {
  if (!("serviceWorker" in navigator) || !import.meta.env.PROD) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").then((registration) => {
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller) {
            onUpdate?.(registration);
            window.dispatchEvent(new CustomEvent("cmll:fms-update-ready"));
          }
        });
      });
    }).catch(() => {
      // Service worker support is optional; the app remains usable online.
    });
  });
}

export async function activateWaitingServiceWorker() {
  const registration = await navigator.serviceWorker?.getRegistration();
  registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
  window.location.reload();
}


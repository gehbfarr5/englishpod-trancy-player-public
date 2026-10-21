{{flutter_js}}
{{flutter_build_config}}

// Do not add a service worker until offline/update behavior has device evidence.
// Clean up only the legacy Flutter worker when replacing the old deployment.
(async () => {
  if ('serviceWorker' in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.filter(registration =>
      [registration.active, registration.waiting, registration.installing]
        .some(worker => worker &&
          new URL(worker.scriptURL).pathname.endsWith('/flutter_service_worker.js'))
    ).map(registration => registration.unregister()));
  }
})().catch(() => {});

_flutter.loader.load({
  onEntrypointLoaded: async engineInitializer => {
    try {
      const appRunner = await engineInitializer.initializeEngine();
      await appRunner.runApp();
      document.getElementById('loading')?.remove();
      window.englishpodBootComplete = true;
    } catch (error) {
      window.englishpodBootError = String(error);
      console.error('EnglishPod bootstrap failed', error);
    }
  }
});

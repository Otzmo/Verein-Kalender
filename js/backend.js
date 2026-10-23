// Wählt Firebase, sobald eine Konfiguration eingetragen ist, sonst den Demo-Modus.
import { firebaseConfig } from './firebase-config.js';

let backend;
if (firebaseConfig.apiKey) {
  const { createFirebaseBackend } = await import('./backend-firebase.js');
  backend = createFirebaseBackend(firebaseConfig);
} else {
  const { createDemoBackend } = await import('./backend-demo.js');
  backend = createDemoBackend();
}

export default backend;

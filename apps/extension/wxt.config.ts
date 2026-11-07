import { defineConfig } from 'wxt';
import manifest from './manifest.json';
export default defineConfig({
  manifest: { name: manifest.name, version: manifest.version, key: manifest.key, permissions: manifest.permissions,
    host_permissions: manifest.host_permissions, incognito: 'not_allowed' },
});

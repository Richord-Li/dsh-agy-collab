import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DSH_DESKTOP_PKG = path.join(os.homedir(), '.dsh', 'profiles', 'desktop', 'package.json');
const DSH_PLUGINS_DIR = path.join(os.homedir(), '.dsh', 'plugins');

export function listInstalledDshPlugins() {
  const plugins = [];
  const seen = new Set();

  if (fs.existsSync(DSH_DESKTOP_PKG)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(DSH_DESKTOP_PKG, 'utf8'));
      const deps = pkg.dependencies || {};
      const bundles = Array.isArray(pkg?.dsh?.profile?.bundles) ? pkg.dsh.profile.bundles : [];
      const enabledSet = new Set(bundles);

      for (const [name, spec] of Object.entries(deps)) {
        seen.add(name);
        plugins.push({
          name,
          versionSpec: spec,
          enabled: enabledSet.has(name),
          source: 'desktop-profile',
          callableViaBridge: true,
        });
      }
    } catch {
      // ignore malformed package.json
    }
  }

  if (fs.existsSync(DSH_PLUGINS_DIR)) {
    try {
      for (const entry of fs.readdirSync(DSH_PLUGINS_DIR, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        if (seen.has(entry.name)) continue;
        plugins.push({
          name: entry.name,
          versionSpec: 'local',
          enabled: true,
          source: 'plugins-dir',
          callableViaBridge: true,
        });
      }
    } catch {
      // ignore
    }
  }

  return plugins;
}

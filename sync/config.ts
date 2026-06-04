import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface MirrorConfig {
  backendUrl: string;
  mirrorHttpPort: number; // HTTP port of the backend API (default 3000)
  identityPath: string;
  stateCachePath: string;
  bridgePort: number;
}

const MIRROR_DIR = path.join(os.homedir(), '.mirror');

function loadConfigFile(): Partial<MirrorConfig> {
  const cfgPath = path.join(MIRROR_DIR, 'config.json');
  try {
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as Partial<MirrorConfig>;
  } catch {
    return {};
  }
}

export function loadConfig(): MirrorConfig {
  const file = loadConfigFile();
  return {
    backendUrl:
      process.env.MIRROR_BACKEND_URL ??
      file.backendUrl ??
      'wss://localhost:4000',
    mirrorHttpPort:
      Number(process.env.MIRROR_HTTP_PORT ?? file.mirrorHttpPort ?? 3000),
    identityPath:
      process.env.MIRROR_IDENTITY_PATH ??
      file.identityPath ??
      path.join(MIRROR_DIR, 'identity.json'),
    stateCachePath:
      process.env.MIRROR_STATE_CACHE_PATH ??
      file.stateCachePath ??
      path.join(MIRROR_DIR, 'state-cache.json'),
    bridgePort: Number(process.env.MIRROR_BRIDGE_PORT ?? file.bridgePort ?? 4002),
  };
}

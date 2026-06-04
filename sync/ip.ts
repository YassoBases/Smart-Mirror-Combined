import * as os from 'os';

/**
 * Returns the best local LAN IPv4 address for this machine.
 * Prefers 192.168.x.x, then 10.x.x.x, then 172.16-31.x.x.
 * Falls back to 127.0.0.1 if no LAN interface is found.
 */
export function getLocalIp(): string {
  const ifaces = os.networkInterfaces();
  const candidates: string[] = [];

  for (const addrs of Object.values(ifaces)) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) {
        candidates.push(addr.address);
      }
    }
  }

  return (
    candidates.find(ip => ip.startsWith('192.168.')) ??
    candidates.find(ip => ip.startsWith('10.')) ??
    candidates.find(ip => /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) ??
    candidates[0] ??
    '127.0.0.1'
  );
}

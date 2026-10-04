import { createServer } from "node:http";
import { lookup as dnsLookup } from "node:dns/promises";
import { connect as tcpConnect, isIP } from "node:net";
import { pathToFileURL } from "node:url";

export function isPublicAddress(address) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19));
  }
  if (isIP(address) === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) return isPublicAddress(normalized.slice(7));
    // Only globally routed unicast is supported; mapped/private/link-local/loopback are denied.
    return /^[23][a-f0-9]{3}:/.test(normalized) && !normalized.startsWith("2001:db8:") && !normalized.startsWith("2001:0:");
  }
  return false;
}
export function createEgressProxy({ allowedHosts, lookup = dnsLookup, connect = tcpConnect, maxConnections = 32 }) {
  const hosts = new Set(allowedHosts.map(value => value.toLowerCase()));
  if (!hosts.size || [...hosts].some(host => !/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(host) || isIP(host))) throw new Error("HTTPS egress requires an exact hostname allowlist");
  let active = 0;
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/healthz") { response.writeHead(200, { "Content-Type": "application/json" }); response.end('{"status":"ok"}'); }
    else { response.writeHead(403); response.end(); }
  });
  server.on("connect", (request, client, head) => {
    const denied = () => { if (!client.destroyed) { client.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); client.end(); } };
    if (active >= maxConnections || !request.url || !/^[a-zA-Z0-9][a-zA-Z0-9.-]*:443$/.test(request.url)) return denied();
    const host = request.url.slice(0, -4).toLowerCase();
    if (!hosts.has(host)) return denied();
    active++;
    let upstream;
    let released = false;
    const release = () => { if (!released) { released = true; active--; } upstream?.destroy(); };
    client.on("close", release); client.on("error", release); client.setTimeout(240_000, () => client.destroy());
    void (async () => {
      const addresses = await lookup(host, { all: true, verbatim: true });
      if (!addresses.length || addresses.some(entry => !isPublicAddress(entry.address)) || client.destroyed) { denied(); return; }
      upstream = connect({ host: addresses[0].address, family: addresses[0].family, port: 443 });
      upstream.setTimeout(240_000, () => { upstream.destroy(); client.destroy(); });
      upstream.once("error", () => { client.destroy(); release(); });
      upstream.once("connect", () => {
        if (client.destroyed) return release();
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        upstream.pipe(client); client.pipe(upstream);
      });
      upstream.once("close", () => { client.destroy(); release(); });
    })().catch(() => { denied(); release(); });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const allowedHosts = (process.env.BORAN_EGRESS_ALLOW_HOSTS ?? "").split(",").map(value => value.trim()).filter(Boolean);
  const server = createEgressProxy({ allowedHosts });
  server.listen(Number(process.env.BORAN_EGRESS_PROXY_PORT ?? 8080), "0.0.0.0", () => process.stdout.write(JSON.stringify({ service: "https-egress-proxy", allowedHostCount: allowedHosts.length }) + "\n"));
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close(() => process.exit(0)));
}

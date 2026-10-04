import test from "node:test";
import assert from "node:assert/strict";
import { connect } from "node:net";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const { initializePrivateRuntime }: { initializePrivateRuntime: (env: NodeJS.ProcessEnv) => Promise<{ credentialsKeyCreated: boolean; serviceKeyCreated: boolean }> } = await import(new URL("../../../scripts/initialize-private-runtime.mjs", import.meta.url).href);
const { createEgressProxy, isPublicAddress }: { isPublicAddress: (address: string) => boolean; createEgressProxy: (options: { allowedHosts: string[]; lookup?: () => Promise<Array<{ address: string; family: number }>> }) => Server } = await import(new URL("../../../scripts/egress-proxy.mjs", import.meta.url).href);

test("private runtime bootstraps independent persistent keys and blocks replacement after missing-key loss", async () => {
  const directory = await mkdtemp(join(tmpdir(), "boran-private-runtime-test-"));
  const env = { BORAN_SECRET_STORE_ROOT: join(directory, "store"), BORAN_SECRET_KEY_FILE: join(directory, "master.key"), BORAN_SERVICE_KEY_FILE: join(directory, "service.key"), BORAN_SOURCE_STORE_ROOT: join(directory, "sources"), BROWSER_LOCAL_REPLAY_ROOT: join(directory, "replay") };
  try {
    assert.deepEqual(await initializePrivateRuntime(env), { credentialsKeyCreated: true, serviceKeyCreated: true });
    const credentialKey = await readFile(env.BORAN_SECRET_KEY_FILE), serviceKey = await readFile(env.BORAN_SERVICE_KEY_FILE);
    assert.equal(credentialKey.length, 32); assert.equal(serviceKey.length, 32); assert.notDeepEqual(credentialKey, serviceKey);
    assert.deepEqual(await initializePrivateRuntime(env), { credentialsKeyCreated: false, serviceKeyCreated: false });
    assert.deepEqual(await readFile(env.BORAN_SECRET_KEY_FILE), credentialKey);
    await writeFile(join(env.BORAN_SECRET_STORE_ROOT, "existing-encrypted-reference.json"), "encrypted-synthetic-data");
    await rm(env.BORAN_SECRET_KEY_FILE);
    await assert.rejects(initializePrivateRuntime(env), /original key/);
    assert.deepEqual(await readFile(env.BORAN_SERVICE_KEY_FILE), serviceKey);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("restricted egress rejects unlisted hosts, non-HTTPS ports and DNS resolution into internal networks", async () => {
  let lookups = 0;
  const proxy = createEgressProxy({ allowedHosts: ["api.deepseek.com"], lookup: async () => { lookups++; return [{ address: "127.0.0.1", family: 4 }]; } });
  await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const address = proxy.address(); assert.ok(address && typeof address !== "string");
  const port = address.port;
  async function tunnel(host: string) {
    return new Promise<string>((resolve, reject) => {
      const socket = connect(port, "127.0.0.1"); let response = "";
      socket.on("connect", () => socket.write(`CONNECT ${host} HTTP/1.1\r\nHost: ${host}\r\n\r\n`));
      socket.on("data", chunk => { response += chunk.toString(); }); socket.on("end", () => resolve(response)); socket.on("error", reject); socket.setTimeout(1000, () => { socket.destroy(); reject(new Error("Proxy did not deny request")); });
    });
  }
  try {
    assert.match(await tunnel("unlisted.example:443"), /403 Forbidden/); assert.equal(lookups, 0);
    assert.match(await tunnel("api.deepseek.com:80"), /403 Forbidden/); assert.equal(lookups, 0);
    assert.match(await tunnel("api.deepseek.com:443"), /403 Forbidden/); assert.equal(lookups, 1);
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/arbitrary`)).status, 403);
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/healthz`)).status, 200);
  } finally { await new Promise<void>(resolve => proxy.close(() => resolve())); }
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.2", "169.254.169.254", "100.64.0.1", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1"]) assert.equal(isPublicAddress(ip), false, ip);
  assert.equal(isPublicAddress("8.8.8.8"), true); assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});

test("Node 24 fetch and native HTTPS both honor the readonly runtime proxy without dialing the source directly", async () => {
  const destinations: string[] = [];
  const proxy = createServer();
  proxy.on("connect", (request, socket) => { destinations.push(request.url!); socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); });
  await new Promise<void>(resolve => proxy.listen(0, "127.0.0.1", resolve));
  const address = proxy.address(); assert.ok(address && typeof address !== "string");
  const proxyUrl = `http://127.0.0.1:${address.port}`;
  const script = `import https from 'node:https'; let directLookups=0; const native=()=>new Promise(resolve=>{const request=https.request('https://proxy-target.invalid/',{lookup:()=>{directLookups++;throw new Error('Direct target lookup must not occur');}},()=>resolve(false));request.on('error',()=>resolve(true));request.end();}); const outcomes=await Promise.all([native(),fetch('https://proxy-target.invalid/').then(()=>false,()=>true)]);process.stdout.write(JSON.stringify({outcomes,directLookups}));`;
  try {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, NODE_USE_ENV_PROXY: "1", HTTP_PROXY: proxyUrl, HTTPS_PROXY: proxyUrl, http_proxy: proxyUrl, https_proxy: proxyUrl, NO_PROXY: "", no_proxy: "" }, stdio: ["ignore", "pipe", "ignore"] });
      let text = ""; child.stdout.on("data", chunk => { text += chunk.toString(); }); child.once("error", reject);
      const timeout = setTimeout(() => { child.kill(); reject(new Error("Runtime proxy verification timed out")); }, 10_000);
      child.once("exit", code => { clearTimeout(timeout); if (code === 0) resolve(text); else reject(new Error("Runtime proxy verification failed")); });
    });
    assert.deepEqual(JSON.parse(output), { outcomes: [true, true], directLookups: 0 });
    assert.deepEqual(destinations.sort(), ["proxy-target.invalid:443", "proxy-target.invalid:443"]);
  } finally { await new Promise<void>(resolve => proxy.close(() => resolve())); }
});

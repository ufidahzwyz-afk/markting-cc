import { spawn } from 'node:child_process';

// An explicit local preview; production startup never inherits mock identity.
const previewEnvironment = {
  ...process.env,
  APP_ENV: 'development',
  AUTH_MODE: 'mock',
  AI_MODE: 'mock',
  WRITE_ENABLED: 'false',
  ADS_WRITE_ENABLED: 'false',
  PUBLISH_ENABLED: 'false',
  PRODUCTION_PII_AUTOMATION_ENABLED: 'false',
  TZ: 'Asia/Shanghai',
  NEXT_TELEMETRY_DISABLED: '1',
};
console.log('Local UI preview: mock data only; all external writes disabled.');
const child = spawn('npm', ['run', 'dev', '--workspace', '@boran/ops'], {
  stdio: 'inherit',
  env: previewEnvironment,
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 1; });

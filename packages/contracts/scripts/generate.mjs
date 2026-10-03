import {readFile, writeFile} from 'node:fs/promises';
import openapiTS, {astToString} from 'openapi-typescript';
import {compile} from 'json-schema-to-typescript';
const root = new URL('../', import.meta.url);
const openapi = JSON.parse(await readFile(new URL('schemas/openapi.json', root), 'utf8'));
await writeFile(new URL('src/openapi.generated.ts', root), astToString(await openapiTS(openapi)));
for (const [file, name, output] of [['ai_outputs.schema.json', 'AiOutput', 'ai.generated.ts'], ['page_modules.schema.json', 'PageModules', 'pages.generated.ts']]) {
  const schema = JSON.parse(await readFile(new URL(`schemas/${file}`, root), 'utf8'));
  await writeFile(new URL(`src/${output}`, root), await compile({...schema, title: name}, name, {ignoreMinAndMaxItems: true,bannerComment: '/* Generated from the engineering contract. Run npm run generate -w @boran/contracts. */', additionalProperties: false, format: true}));
}

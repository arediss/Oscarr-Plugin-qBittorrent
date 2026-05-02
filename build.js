import { build } from 'esbuild';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { builtinModules } from 'module';
import { spawn, spawnSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));

const nodeExternals = [
  ...builtinModules,
  ...builtinModules.map((m) => `node:${m}`),
  'fastify',
];

await build({
  entryPoints: [resolve(__dirname, 'src/index.ts')],
  outfile: resolve(__dirname, 'dist/index.js'),
  platform: 'node',
  target: 'node20',
  format: 'esm',
  bundle: true,
  minify: false,
  sourcemap: true,
  external: nodeExternals,
  banner: {
    js: `import { createRequire } from 'module'; const require = createRequire(import.meta.url);`,
  },
  logLevel: 'info',
});
console.log('Backend built → dist/index.js');

const frontendCommon = {
  platform: 'browser',
  target: ['es2022'],
  format: 'esm',
  bundle: true,
  minify: false,
  sourcemap: true,
  jsx: 'automatic',
  jsxImportSource: 'react',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  logLevel: 'info',
};

await build({
  ...frontendCommon,
  entryPoints: [resolve(__dirname, 'frontend/index.tsx')],
  outfile: resolve(__dirname, 'dist/frontend/index.js'),
});
console.log('Frontend (page) built → dist/frontend/index.js');

await build({
  ...frontendCommon,
  entryPoints: [resolve(__dirname, 'frontend/hooks/admin.dashboard.widget.tsx')],
  outfile: resolve(__dirname, 'dist/frontend/hooks/admin.dashboard.widget.js'),
});
console.log('Frontend (widget hook) built → dist/frontend/hooks/admin.dashboard.widget.js');

const twWatch = process.argv.includes('--watch');
const tailwindArgs = [
  '-c', resolve(__dirname, 'tailwind.config.js'),
  '-i', resolve(__dirname, 'frontend/index.css'),
  '-o', resolve(__dirname, 'dist/frontend/index.css'),
  ...(twWatch ? ['--watch'] : ['--minify']),
];

if (twWatch) {
  const twChild = spawn('npx', ['tailwindcss', ...tailwindArgs], { stdio: 'inherit', cwd: __dirname });
  twChild.on('exit', (code) => { if (code !== null && code !== 0) process.exit(code); });
} else {
  const twResult = spawnSync('npx', ['tailwindcss', ...tailwindArgs], { stdio: 'inherit', cwd: __dirname });
  if (twResult.status !== 0) process.exit(twResult.status || 1);
  console.log('Frontend (CSS) built → dist/frontend/index.css');
}

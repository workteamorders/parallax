import { createRequire } from 'node:module';

// Reuse the already-installed workspace lint toolchain without another install.
const workspaceRequire = createRequire(new URL('../../web/package.json', import.meta.url));
const { ESLint } = workspaceRequire('eslint');
const toolchainRequire = createRequire(workspaceRequire.resolve('eslint-config-next'));
const parser = toolchainRequire('@typescript-eslint/parser');
const typescript = toolchainRequire('@typescript-eslint/eslint-plugin');
const eslint = new ESLint({
  overrideConfigFile: true,
  errorOnUnmatchedPattern: false,
  overrideConfig: [{
    files: ['**/*.ts', '**/*.mjs'],
    ignores: ['dist/**', 'node_modules/**'],
    languageOptions: { parser, ecmaVersion: 'latest', sourceType: 'module' },
    plugins: { '@typescript-eslint': typescript },
    rules: {
      'constructor-super': 'error', 'for-direction': 'error', 'getter-return': 'error',
      'no-async-promise-executor': 'error', 'no-constant-binary-expression': 'error',
      'no-constant-condition': 'error', 'no-debugger': 'error', 'no-duplicate-case': 'error',
      'no-empty': 'error', 'no-ex-assign': 'error', 'no-fallthrough': 'error',
      'no-invalid-regexp': 'error', 'no-loss-of-precision': 'error', 'no-prototype-builtins': 'error',
      'no-self-assign': 'error', 'no-sparse-arrays': 'error', 'no-unexpected-multiline': 'error',
      'no-unsafe-finally': 'error', 'no-unsafe-negation': 'error', 'no-unused-labels': 'error',
      'no-useless-catch': 'error', 'no-var': 'error', 'prefer-const': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  }],
});
const results = await eslint.lintFiles(['src/**/*.ts', 'test/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.mjs']);
const formatter = await eslint.loadFormatter('stylish');
const text = formatter.format(results);
if (text) process.stdout.write(text);
process.exitCode = results.some(result => result.errorCount > 0) ? 1 : 0;

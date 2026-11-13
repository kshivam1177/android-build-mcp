import tseslint from 'typescript-eslint';
import boundaries from 'eslint-plugin-boundaries';
import jsdoc from 'eslint-plugin-jsdoc';
import importPlugin from 'eslint-plugin-import';

export default [
  { ignores: ['build/**', 'dist/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      // This repository contains thin adapters around untyped Android/CLI JSON.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'off'
    }
  },
  {
    // TestOrbit (src/testorbit/) is held to the enterprise standards in the plan
    // (Part D): strict typing, layered imports, file/function size caps,
    // JSDoc on public functions, no import cycles. These rules apply ONLY
    // to src/testorbit/ — the existing 118-tool codebase keeps its own rules.
    files: ['src/testorbit/**/*.ts'],
    plugins: {
      boundaries,
      jsdoc,
      import: importPlugin,
    },
    settings: {
      'boundaries/elements': [
        { type: 'core', pattern: 'src/testorbit/core/*' },
        { type: 'domain', pattern: 'src/testorbit/domain/*' },
        { type: 'application', pattern: 'src/testorbit/application/*' },
        { type: 'infrastructure', pattern: 'src/testorbit/infrastructure/*' },
        { type: 'cli', pattern: 'src/testorbit/cli/**/*' },
        { type: 'config', pattern: 'src/testorbit/config/*' },
      ],
      'import/resolver': {
        typescript: {
          project: ['tsconfig.json', 'tsconfig.testorbit.json'],
          noWarnOnMultipleProjects: true,
        },
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'boundaries/element-types': ['error', {
        default: 'disallow',
        rules: [
          { from: 'core', allow: ['core', 'domain'] },
          { from: 'domain', allow: ['domain'] },
          { from: 'application', allow: ['core', 'domain', 'application', 'infrastructure'] },
          { from: 'infrastructure', allow: ['core', 'domain', 'infrastructure'] },
          { from: 'cli', allow: ['core', 'domain', 'application', 'infrastructure', 'cli', 'config'] },
          { from: 'config', allow: ['domain', 'config'] },
        ],
      }],
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 50, skipBlankLines: true, skipComments: true, IIFEs: true }],
      'jsdoc/require-jsdoc': ['error', { publicOnly: true }],
      'import/no-cycle': 'error',
    },
  },
];

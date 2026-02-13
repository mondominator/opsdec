import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';

export default [
  js.configs.recommended,
  {
    files: ['backend/src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-unreachable': 'error',
      'no-constant-condition': 'warn',
      'no-empty': 'warn',
    },
  },
  {
    files: ['frontend/src/**/*.{js,jsx}'],
    plugins: { react },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...react.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-unreachable': 'error',
      'no-constant-condition': 'warn',
      'no-empty': 'warn',
    },
  },
  {
    ignores: ['node_modules/', 'frontend/dist/', 'data/', '**/*.test.js', '**/*.test.jsx', '**/__tests__/', 'frontend/public/'],
  },
];

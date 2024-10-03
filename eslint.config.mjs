import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";


export default [
  { files: ['content/*.ts'],
  },
  { ignores: ['gen/', 'esbuild.js', 'build/'],
  },
  { languageOptions: { globals: globals.browser }},
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  { rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-unused-vars': ['error', { 'argsIgnorePattern': '^_' }],
    '@typescript-eslint/no-require-imports': 'off',
    'prefer-rest-params': 'off',
    'no-cond-assign': 'off'
  }},
];

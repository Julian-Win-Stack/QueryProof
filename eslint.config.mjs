import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['data/**', 'gold/**', '.next/**', 'next-env.d.ts'] },
  js.configs.recommended,
  tseslint.configs.recommended,
);

import tseslint from 'typescript-eslint';
export default tseslint.config(
  {ignores:['node_modules/**','dist/**','**/.wxt/**','**/.output/**','**/.build/**','.local/**','docs/decisions/evidence/**']},
  ...tseslint.configs.recommended,
  {files:['**/*.ts','**/*.tsx'],rules:{'@typescript-eslint/no-explicit-any':'off','@typescript-eslint/no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}],'@typescript-eslint/ban-ts-comment':['error',{'ts-expect-error':'allow-with-description'}]}},
  // Legacy probe JS is retained and exercised through the real browser tests.
  {files:['**/*.js','**/*.mjs'],rules:{'@typescript-eslint/no-unused-vars':'off','@typescript-eslint/no-require-imports':'off'}}
);

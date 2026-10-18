// eslint.config.js - minimálny linter: chytá preklepy v názvoch premenných (no-undef) a mŕtvy kód.
// Žiadne štýlové pravidlá - formátovanie ostáva na autorovi. Spustenie: npm run lint
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**", ".difftest_old/**", "tools/sprites-*/**", "tools/pride-lion/**"] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2023, sourceType: "module" },
    rules: {
      "no-unused-vars": ["warn", { args: "none", caughtErrors: "none", varsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  // engine, server, testy, nástroje bežia v Node
  { files: ["*.js", "engine/**", "shared/**", "test/**", "tools/**"], languageOptions: { globals: globals.node } },
  { files: ["**/*.cjs"], languageOptions: { sourceType: "commonjs", globals: globals.node } },
  // klient beží v prehliadači (io = globál zo /socket.io/socket.io.js)
  { files: ["public/**"], languageOptions: { globals: { ...globals.browser, io: "readonly" } } },
];

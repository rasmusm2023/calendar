import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * Arkitekturregler från PROJECT.md §7 uttryckta som lint-fel.
 */

// All Google-kommunikation går via src/lib/google/. Inga strängar mot googleapis.com någon annanstans.
const noGoogleApiOutsideLib = [
  {
    selector: 'Literal[value=/googleapis\\.com/]',
    message: 'Anrop mot Google får bara finnas i src/lib/google/ (PROJECT.md §7).',
  },
  {
    selector: 'TemplateElement[value.raw=/googleapis\\.com/]',
    message: 'Anrop mot Google får bara finnas i src/lib/google/ (PROJECT.md §7).',
  },
]

// Inga hårdkodade hex-värden i komponenter. Använd Tailwind-tokens, CSS-variabler eller resolveEventStyle.
const noHexInComponents = [
  {
    selector: 'Literal[value=/^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/]',
    message:
      'Inga hårdkodade hex-värden i komponenter. Använd Tailwind-tokens, CSS-variabler eller resolveEventStyle.',
  },
]

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'playwright-report', 'test-results', 'functions/lib'] },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-restricted-syntax': ['error', ...noGoogleApiOutsideLib],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@fullcalendar/*'],
              message:
                'FullCalendar får bara importeras i src/features/calendar/adapter/ (PROJECT.md §2).',
            },
            {
              group: ['@/features/*/*'],
              message: 'Importera en feature via dess publika API (index.ts).',
            },
          ],
        },
      ],
    },
  },

  // Komponenter (.tsx): även förbud mot hex-värden.
  {
    files: ['src/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...noGoogleApiOutsideLib, ...noHexInComponents],
    },
  },

  // Undantag: Google-klienten får prata med Google.
  {
    files: ['src/lib/google/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // Undantag: FullCalendar-adaptern får importera FullCalendar. (Djupa importer inom en feature är tillåtna via relativa sökvägar.)
  {
    files: ['src/features/calendar/adapter/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/features/*/*'],
              message: 'Importera en feature via dess publika API (index.ts).',
            },
          ],
        },
      ],
    },
  },

  // shadcn-genererade komponenter exporterar t.ex. variants tillsammans med komponenten.
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },

  // Konfigfiler (Node).
  {
    files: ['*.config.{ts,js}'],
    languageOptions: { globals: globals.node },
  },

  // Vanliga JS-filer typkontrolleras inte.
  {
    files: ['**/*.js'],
    ...tseslint.configs.disableTypeChecked,
  },

  // Måste vara sist: stänger av regler som krockar med Prettier.
  prettier,
)

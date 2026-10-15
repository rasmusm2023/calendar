import 'i18next'
import type sv from './sv.json'

// Typade översättningsnycklar: sv.json är källan, en.json måste ha samma nycklar (se i18n.test.ts).
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: {
      translation: typeof sv
    }
  }
}

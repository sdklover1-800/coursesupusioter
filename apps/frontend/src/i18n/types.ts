/**
 * Типизация локалей (§6.2): русская локаль — канонический набор ключей.
 * Файлы пространств kk/en типизируются как Loc<typeof ruNamespace>: пропущенный ключ —
 * ошибка tsc, а формы множественного числа (_zero/_one/_two/_few/_many/_other)
 * необязательны — у казахского и английского свои правила (i18next + Intl.PluralRules).
 */
type PluralSuffix = '_zero' | '_one' | '_two' | '_few' | '_many' | '_other';
type IsPluralKey<K> = K extends `${string}${PluralSuffix}` ? true : false;

/** Строковые листья → string (перевод не обязан совпадать с русским литералом). */
export type Loc<T> = T extends string
  ? string
  : T extends object
    ? { [K in keyof T as IsPluralKey<K> extends true ? never : K]: Loc<T[K]> } & {
        [K in keyof T as IsPluralKey<K> extends true ? K : never]?: Loc<T[K]>;
      }
    : T;

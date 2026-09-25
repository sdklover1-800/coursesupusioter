import { useEffect } from 'react';

const APP = 'EduOpen';

/**
 * Заголовок вкладки по шаблону «<страница> · EduOpen» (design_direction §10).
 * Пустой title (данные ещё грузятся) → просто «EduOpen». При размонтировании — «EduOpen».
 */
export function useDocumentTitle(title: string | null | undefined): void {
  useEffect(() => {
    document.title = title ? `${title} · ${APP}` : APP;
  }, [title]);
  useEffect(
    () => () => {
      document.title = APP;
    },
    [],
  );
}

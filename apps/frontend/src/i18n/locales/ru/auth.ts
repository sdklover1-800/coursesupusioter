/** Вход, регистрация (общие поля), смена пароля — владелец FE1. */
export const auth = {
  tagline: 'Учиться — значит задавать правильные вопросы',
  subtitle: 'Образовательная платформа с сократическим ИИ-ассистентом',
  email: 'Email', password: 'Пароль', signIn: 'Войти',
  wrongCredentials: 'Неверный email или пароль', welcome: 'С возвращением',
  changePassword: 'Смена пароля', currentPassword: 'Текущий пароль', newPassword: 'Новый пароль',
  mustChange: 'Задайте новый пароль для продолжения', passwordChanged: 'Пароль изменён',
  // Вход / смена пароля (screen_specs «Onboarding»)
  loginTitle: 'Вход',
  confirmPassword: 'Повторите новый пароль',
  passwordHint: 'Не менее {{min}} символов',
  errMismatch: 'Пароли не совпадают',
  errShort: 'Пароль должен быть не короче {{min}} символов',
  errLong: 'Пароль слишком длинный (не более {{max}} символов)',
  errRequired: 'Заполните это поле',
  errCurrent: 'Текущий пароль неверен',
  errTooMany: 'Слишком много попыток входа. Подождите минуту и попробуйте снова.',
  consentDeclinedTitle: 'Вы вышли из аккаунта',
  consentDeclined: 'Без согласия на участие в исследовании доступ к курсу закрыт. Вопросы — исследовательской группе.',
};

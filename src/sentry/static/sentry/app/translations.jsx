import * as Sentry from '@sentry/browser';

// zh-cn => zh_CN
function convertToDjangoLocaleFormat(language) {
  const [left, right] = language.split('-');
  return left + (right ? '_' + right.toUpperCase() : '');
}

export function getTranslations(language) {
  language = convertToDjangoLocaleFormat(language);

  try {
    // todo: 仅汉语
    return require(`sentry-locale/zh_CN/LC_MESSAGES/django.po`);
  } catch (e) {
    Sentry.withScope(scope => {
      scope.setLevel('warning');
      scope.setFingerprint(['sentry-locale-not-found']);
      scope.setExtra('locale', 'zh_CN');
      Sentry.captureException(e);
    });

    // Default locale if not found
    return require('sentry-locale/en/LC_MESSAGES/django.po');
  }
}

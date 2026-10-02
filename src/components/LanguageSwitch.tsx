import { LANG_LABEL, LANGS, setLang, useT } from '../i18n'

/**
 * 语言开关。
 *
 * 做成**两个都显示出来的分段控件**（中文 | English），而不是一个「切换」按钮 ——
 * 因为按钮上只能写一个词，用户得先猜「按下去会变成什么」；
 * 两个选项摆出来，当前语言是哪个人一眼就知道，也不会有「点错了要再点回来」的犹豫。
 *
 * 只有两种语言，所以不需要下拉菜单。
 */
export function LanguageSwitch() {
  const { lang, t } = useT()

  return (
    <div className="lang-switch" role="group" aria-label={t('common.language')}>
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          className={`lang-switch__btn${code === lang ? ' is-active' : ''}`}
          aria-pressed={code === lang}
          title={t('common.languageSwitchTo', { lang: LANG_LABEL[code] })}
          onClick={() => setLang(code)}
        >
          {LANG_LABEL[code]}
        </button>
      ))}
    </div>
  )
}

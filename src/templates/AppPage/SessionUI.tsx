import cn from 'classnames'
import useStore from '../../store/useStore'
import { ExternalNav } from './SessionUI/ExternalNav'
import InputField from './SessionUI/InputField'
import MockTextDisplay from './SessionUI/MockTextDisplay'
import { ProgressIndicator } from './SessionUI/ProgressIndicator'
import { ResultsDisplay } from './SessionUI/ResultsDisplay'
import SessionTimer from './SessionUI/SessionTimer'
import CSS from './SessionUI/SessionUI.module.css'
import TextDisplay from './SessionUI/TextDisplay'
import { VariantLinks } from './SessionUI/VariantLinks'
import { ThemeToggle } from './SessionUI/ThemeToggle'
import { useThemeDOMEffect } from './useThemeDOMEffect'
import React from 'react'

function SessionUI() {
  const { state } = useStore()
  useThemeDOMEffect()
  useDynamicTheming()
  const inProgress = state.session.status === 'ongoing'

  return (
    <div className={CSS.wrap}>
      <label className={CSS.root}>
        <div className={CSS.articleBox}>
          <div className={CSS.article}>
            <div className={CSS.articleContent}>
              <div className={CSS.articleSpacer} />
              {state.session.status === 'pending' ? (
                <MockTextDisplay />
              ) : (
                <TextDisplay />
              )}
              {/* <div className={CSS.articleSpacer} /> */}
            </div>
          </div>
        </div>

        {state.session.status === 'ongoing' ? (
          <div className={CSS.ongoingInput}>
            <span className={CSS.inputField}>
              <InputField />
            </span>
            <span className={CSS.timer}>
              <SessionTimer startedAt={state.session.startedAt} />
            </span>
          </div>
        ) : state.session.status === 'pending' ? (
          <div className={CSS.idleInput}>
            <InputField disabled />
          </div>
        ) : (
          <div className={CSS.idleInput}>
            <InputField />
          </div>
        )}

        <div className={CSS.indicatorArea}>
          <ProgressIndicator />
        </div>
      </label>

      <div className={cn(CSS.results, CSS.mutable, { [CSS.mute]: inProgress })}>
        <ResultsDisplay />
      </div>

      <div
        className={cn(CSS.bottomNav, CSS.mutable, { [CSS.mute]: inProgress })}
      >
        <VariantLinks />
      </div>

      <div
        className={cn(CSS.externalNav, CSS.mutable, { [CSS.mute]: inProgress })}
      >
        <ThemeToggle />
        <ExternalNav />
      </div>
    </div>
  )
}

function useDynamicTheming() {
  const { actions } = useStore()

  React.useEffect(() => {
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    mql.addListener(apply)

    function apply() {
      const theme = mql.matches ? 'night' : 'day'
      actions.setThemeStyle(theme)
    }

    apply()

    return () => {
      mql.removeListener(apply)
    }
  }, [])
}

export default SessionUI

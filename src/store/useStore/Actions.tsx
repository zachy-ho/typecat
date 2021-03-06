import { get as getDistance } from 'fast-levenshtein'
import {
  State,
  Token,
  Article,
  Store,
  GeneratorConfig,
  getDefaults,
  ThemeStyle,
} from '../useStore'
import { fetchArticles } from './fetchArticles'
import { buildResult } from './buildResult'
import produce from 'immer'
import { PartialState } from 'zustand'

/** How many articles to keep in the queue */
const MAX_QUEUE_DEPTH = 1

class Actions {
  set: (state: PartialState<Store>) => void
  get: () => Store

  constructor(set: (state: PartialState<Store>) => void, get: () => Store) {
    this.set = set
    this.get = get
  }

  /**
   * Modify `state` using immer.
   *
   * @example
   *     this.update(({ state }) => {
   *       state.session.
   *     })
   */

  update = (fn: (store: Store) => any): void => {
    return this.set(produce(fn))
  }

  /**
   * Start a new session. Cancels the current one, if there is one.
   */

  startNewSession = async (options?: { force?: boolean }): Promise<void> => {
    let { state } = this.get()

    // Don't start new sessions if the current one doesn't have anything typed
    // in yet. Unless force mode is on.
    if (!options || !options.force) {
      if (state.session.status === 'ready') return
    }

    this.update(({ state }) => {
      // Clear the session and start over.
      resetSession(state)

      // If there is a queued article, load it in.
      popArticleQueue(state)
    })

    // Replenish the queue by fetching remotely.
    state = this.get().state
    const needed = MAX_QUEUE_DEPTH + 1 - state.articleQueue.length
    return fetchArticles(needed, state.generator).then((articles) => {
      this.receiveArticles(articles)
    })
  }

  receiveArticles = (articles: Article[]) => {
    this.update(({ state }) => {
      if (hasArticle(state)) {
        // There's already an article loaded, so just queue the rest up
        state.articleQueue = articles
      } else {
        // Its waiting for an article, so load it
        const [article, ...tail] = articles
        state.articleQueue = tail
        loadArticle(state, article)
      }
    })
  }

  setInputValue = (value: string): void => {
    this.update(({ state }) => setInputValue(state, value))
  }

  inputWhitespace = async (): Promise<void> => {
    let action: ReturnType<typeof inputWhitespace>

    this.update(({ state }) => {
      action = inputWhitespace(state)
    })

    if (action?.done) {
      this.update(({ state }) => generateResults(state))
      return this.startNewSession()
    }
  }

  setGeneratorConfig = (generator?: GeneratorConfig) => {
    this.update(({ state }) => {
      state.generator = generator ?? getDefaults().generator

      // The queue is now invalidated
      state.articleQueue = []
    })
  }

  updatePreferences = (fn: (preferences: State['preferences']) => void) => {
    this.update(({ state }) => {
      fn(state.preferences)
    })
  }

  setThemeStyle = (value: ThemeStyle) => {
    this.update(({ state }) => {
      state.preferences.themeStyle = value
    })
  }
}

/**
 * Inputs a whitespace; check if done afterwards
 */

export function inputWhitespace(state: State): { done: true } | undefined {
  // Only if a session's started
  if (state.session.status !== 'ongoing') return

  const tokens = state.article.tokens
  const index = state.currentInput.tokenIndex
  const token = tokens[index]
  const currentValue = state.currentInput.value

  // Double enter
  if (currentValue === '') {
    state.currentInput.charIndex = 0
    return
  }

  // Get the number of mistakes using Levenshtein
  const mistakes = getInaccuracyCount(token.value, currentValue)

  // Mark as done
  state.currentInput.finishedTokens[index] = {
    value: currentValue,
    mistakes,
  }

  // Carry over the whitespace tokens
  let nextIndex = index + 1,
    nextToken = tokens[nextIndex]
  while (nextToken?.type === 'whitespace') {
    state.currentInput.finishedTokens[nextIndex] = {
      value: ' ',
      mistakes: 0,
    }
    nextIndex += 1
    nextToken = tokens[nextIndex]
  }

  // Check if done
  if (nextIndex >= tokens.length) {
    return { done: true }
  } else {
    state.currentInput.tokenIndex = nextIndex
    state.currentInput.charIndex = 0
    state.currentInput.value = ''
    state.currentInput.isAccurate = true

    buildInterimResult(state)
  }
}

function buildInterimResult(state: State) {
  if (state.session.status !== 'ongoing') return
  const tokens = state.article.tokens
  const durationMs = +new Date() - +state.session.startedAt
  const nextIndex = state.currentInput.tokenIndex + 1

  state.interimResult = buildResult({
    isInterim: true,
    durationMs,
    tokens: tokens.slice(0, nextIndex),
    finishedTokens: state.currentInput.finishedTokens.slice(0, nextIndex),
  })
}

/**
 * Generates results.
 */

export function generateResults(state: State): void {
  if (state.session.status !== 'ongoing') throw new Error('Invariant violation')

  // Get the duration
  const now = +new Date()
  const durationMs = now - +state.session.startedAt

  const result = buildResult({
    durationMs,
    tokens: state.article.tokens,
    finishedTokens: state.currentInput.finishedTokens,
  })
  state.results.push(result)
}

/**
 * Resets the current session to the 'pending' state.
 */

export function resetSession(state: State): void {
  state.session = { status: 'pending' }

  state.interimResult = null

  state.currentInput = {
    tokenIndex: 0,
    charIndex: 0,
    value: '',
    isAccurate: true,
    finishedTokens: [],
  }

  state.article.tokens = []
}

/**
 * Returns the current token.
 */

function getCurrentToken(state: State): Token {
  return state.article.tokens[state.currentInput.tokenIndex]
}

/**
 * Updates an input value.
 */

export function setInputValue(state: State, value: string) {
  const token = getCurrentToken(state)

  // Start if not started
  if (state.session.status === 'ready') {
    state.session = { status: 'ongoing', startedAt: new Date() }
  }

  if (token?.value?.substr(0, value.length) !== value) {
    state.currentInput.isAccurate = false
  } else {
    state.currentInput.isAccurate = true
  }

  state.currentInput.value = value
  state.currentInput.charIndex = value.length
}

/**
 * Pick an article from the queue, if there are any queued.
 */

export function popArticleQueue(state: State): void {
  // Only work in pending mode, and if there's an article queued up.
  if (!state.articleQueue.length) return
  if (state.session.status !== 'pending') return

  // Get the first article in the queue and promote it as the next one
  const article = state.articleQueue.shift()
  loadArticle(state, article)
}

/**
 * Load an article as the current one
 */

function loadArticle(state: State, article: Article): void {
  resetSession(state)
  state.session = { status: 'ready' }
  state.article = article
}

function hasArticle(state: State): boolean {
  return Boolean(state.article?.tokens?.length)
}

function getInaccuracyCount(expected: string, actual: string): number {
  if (expected === actual) return 0
  return Math.min(getDistance(expected, actual), expected.length)
}

export default Actions

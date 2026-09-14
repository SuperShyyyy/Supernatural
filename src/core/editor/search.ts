import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

import { DocumentIndex, type TextMatch } from '../../services/search/DocumentIndex';

export interface SearchState {
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly matches: readonly TextMatch[];
  readonly current: number;
}

type SearchMeta =
  | { readonly type: 'set'; readonly query: string; readonly caseSensitive: boolean }
  | { readonly type: 'move'; readonly delta: number }
  | { readonly type: 'goto'; readonly index: number }
  | { readonly type: 'close' };

const EMPTY_STATE: SearchState = {
  query: '',
  caseSensitive: false,
  matches: [],
  current: -1,
};

export const searchPluginKey = new PluginKey<SearchState>('md-editer-search');

/** 查找/替换插件：只负责状态与高亮，UI 在 ui/searchPanel.ts。 */
export function createSearchPlugin(): Plugin<SearchState> {
  return new Plugin<SearchState>({
    key: searchPluginKey,
    state: {
      init: () => EMPTY_STATE,
      apply(transaction, previous, _oldState, newState) {
        const meta = transaction.getMeta(searchPluginKey) as SearchMeta | undefined;

        if (meta === undefined) {
          // 文档变了 → 之前的匹配位置全部失效，必须重算（面板关闭时 query 为空，直接跳过）
          if (previous.query.length === 0) return previous;
          return recompute(newState.doc, previous.query, previous.caseSensitive, previous.current);
        }

        switch (meta.type) {
          case 'set':
            return recompute(newState.doc, meta.query, meta.caseSensitive, -1);
          case 'move': {
            if (previous.matches.length === 0) return previous;
            const total = previous.matches.length;
            const next = ((previous.current + meta.delta) % total + total) % total;
            return { ...previous, current: next };
          }
          case 'goto':
            return { ...previous, current: Math.max(0, Math.min(previous.matches.length - 1, meta.index)) };
          case 'close':
            return EMPTY_STATE;
          default:
            return previous;
        }
      },
    },
    props: {
      decorations(state) {
        const search = searchPluginKey.getState(state);
        if (search === undefined || search.matches.length === 0) return DecorationSet.empty;

        return DecorationSet.create(
          state.doc,
          search.matches.map((match, index) =>
            Decoration.inline(match.from, match.to, {
              class: index === search.current ? 'md-search-hit md-search-hit--current' : 'md-search-hit',
            }),
          ),
        );
      },
    },
  });
}

function recompute(
  doc: PMNode,
  query: string,
  caseSensitive: boolean,
  current: number,
): SearchState {
  if (query.length === 0) return EMPTY_STATE;
  const matches = DocumentIndex.build(doc).findAll(query, caseSensitive);
  return {
    query,
    caseSensitive,
    matches,
    current: matches.length === 0 ? -1 : Math.min(Math.max(current, 0), matches.length - 1),
  };
}

export function getSearchState(view: EditorView): SearchState | undefined {
  return searchPluginKey.getState(view.state);
}

export function setSearchQuery(view: EditorView, query: string, caseSensitive: boolean): void {
  view.dispatch(view.state.tr.setMeta(searchPluginKey, { type: 'set', query, caseSensitive }));
}

export function moveSearch(view: EditorView, delta: number): void {
  const state = getSearchState(view);
  if (state === undefined || state.matches.length === 0) return;

  const total = state.matches.length;
  const next = ((state.current + delta) % total + total) % total;
  const tr = view.state.tr.setMeta(searchPluginKey, { type: 'goto', index: next });
  const match = state.matches[next];
  if (match !== undefined) {
    tr.setSelection(TextSelection.create(tr.doc, match.from, match.to));
    tr.scrollIntoView();
  }
  view.dispatch(tr);
}

export function closeSearch(view: EditorView): void {
  view.dispatch(view.state.tr.setMeta(searchPluginKey, { type: 'close' }));
}

export function replaceCurrent(view: EditorView, replacement: string): boolean {
  const state = getSearchState(view);
  const match = state?.matches[state.current];
  if (state === undefined || match === undefined) return false;

  view.dispatch(view.state.tr.replaceWith(match.from, match.to, view.state.schema.text(replacement)));
  return true;
}

export function replaceAll(view: EditorView, replacement: string): number {
  const state = getSearchState(view);
  if (state === undefined || state.matches.length === 0) return 0;

  const tr = view.state.tr;
  // 从后往前替换，前面的位置才不会被后面的替换影响
  for (let i = state.matches.length - 1; i >= 0; i -= 1) {
    const match = state.matches[i];
    if (match !== undefined) tr.replaceWith(match.from, match.to, view.state.schema.text(replacement));
  }
  view.dispatch(tr);
  return state.matches.length;
}

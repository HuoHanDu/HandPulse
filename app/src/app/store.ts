import { createContext, useContext, type Dispatch } from 'react';
import type { RangeKey } from '../ipc/types';

export type Route = 'keyboard' | 'mouse' | 'gamepad' | 'stats' | 'data' | 'settings';
export type Disp = 'all' | 'heat' | 'real';
export type Layout = 104 | 87;
export type Layer = 'clicks' | 'move';
export type HistTab = 'top20' | 'hours' | 'gaps';
export type HeatTab = 'week' | 'cal' | 'month';
export type ModalKind = 'clear' | 'reset' | null;

export interface Cell {
  x: number;
  y: number;
  v: number;
}

export interface AppState {
  route: Route;
  ranges: Record<Route, RangeKey>;
  disp: Disp;
  layout: Layout;
  sel: string | null;
  hover: string | null;
  paused: boolean;
  pausedAt: number;
  empty: boolean;
  viewReset: boolean;
  layer: Layer;
  cell: Cell | null;
  hist: HistTab;
  heat: HeatTab;
  page: number;
  granularity: 10 | 30 | 60;
  retention: 7 | 30 | 90;
  autoStart: boolean;
  dataVersion: number;
  modal: ModalKind;
  toast: string | null;
}

export type Action =
  | { type: 'setRoute'; route: Route }
  | { type: 'setRange'; route: Route; range: RangeKey }
  | { type: 'setDisp'; disp: Disp }
  | { type: 'setLayout'; layout: Layout }
  | { type: 'select'; label: string | null }
  | { type: 'hover'; label: string | null }
  | { type: 'togglePause' }
  | { type: 'clearData' }
  | { type: 'resetView' }
  | { type: 'restore' }
  | { type: 'setLayer'; layer: Layer }
  | { type: 'setCell'; cell: Cell | null }
  | { type: 'setHist'; hist: HistTab }
  | { type: 'setHeat'; heat: HeatTab }
  | { type: 'setPage'; page: number }
  | { type: 'setGranularity'; value: 10 | 30 | 60 }
  | { type: 'setRetention'; value: 7 | 30 | 90 }
  | { type: 'setAutoStart'; value: boolean }
  | { type: 'setDataVersion'; value: number }
  | { type: 'modal'; modal: ModalKind }
  | { type: 'toast'; message: string }
  | { type: 'hideToast' };

export const initialState: AppState = {
  route: 'keyboard',
  ranges: { keyboard: 'today', mouse: 'today', gamepad: 'today', stats: 'today', data: 'today', settings: 'today' },
  disp: 'all',
  layout: 104,
  sel: 'A',
  hover: null,
  paused: false,
  pausedAt: 0,
  empty: false,
  viewReset: false,
  layer: 'clicks',
  cell: null,
  hist: 'top20',
  heat: 'week',
  page: 0,
  granularity: 60,
  retention: 30,
  autoStart: true,
  dataVersion: 1,
  modal: null,
  toast: null
};

export function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'setRoute':
      return { ...state, route: action.route, hover: null, page: 0 };
    case 'setRange':
      return { ...state, ranges: { ...state.ranges, [action.route]: action.range }, page: 0, cell: null };
    case 'setDisp':
      return { ...state, disp: action.disp };
    case 'setLayout':
      return { ...state, layout: action.layout };
    case 'select':
      return { ...state, sel: action.label, hover: null };
    case 'hover':
      return { ...state, hover: action.label };
    case 'togglePause':
      return { ...state, paused: !state.paused, pausedAt: state.paused ? 0 : Date.now() };
    case 'clearData':
      return { ...state, empty: true, page: 0, cell: null, modal: null };
    case 'resetView':
      return { ...state, viewReset: true, modal: null };
    case 'restore':
      return { ...state, empty: false, viewReset: false, page: 0, cell: null };
    case 'setLayer':
      return { ...state, layer: action.layer, cell: null };
    case 'setCell':
      return { ...state, cell: action.cell };
    case 'setHist':
      return { ...state, hist: action.hist };
    case 'setHeat':
      return { ...state, heat: action.heat };
    case 'setPage':
      return { ...state, page: action.page };
    case 'setGranularity':
      return { ...state, granularity: action.value };
    case 'setRetention':
      return { ...state, retention: action.value };
    case 'setAutoStart':
      return { ...state, autoStart: action.value };
    case 'setDataVersion':
      return { ...state, dataVersion: action.value };
    case 'modal':
      return { ...state, modal: action.modal };
    case 'toast':
      return { ...state, toast: action.message };
    case 'hideToast':
      return { ...state, toast: null };
    default:
      return state;
  }
}

export const AppContext = createContext<{ state: AppState; dispatch: Dispatch<Action> } | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('AppContext missing');
  return ctx;
}

export const TITLES: Record<Route, string> = {
  keyboard: '键盘',
  mouse: '鼠标',
  gamepad: '手柄',
  stats: '数据',
  data: '数据浏览',
  settings: '设置'
};

export const SUBS: Record<Route, string> = {
  keyboard: '键位 · A',
  mouse: '点击分布',
  gamepad: '适配与测试',
  stats: '图表摘要',
  data: '自定义范围',
  settings: '采集与存储'
};

export const RANGE_OPTS: Record<Route, Array<[RangeKey, string]>> = {
  keyboard: [['session', '本次'], ['today', '今日'], ['week', '7 天']],
  mouse: [['session', '本次'], ['today', '今日'], ['week', '7 天']],
  gamepad: [['session', '本次'], ['today', '今日'], ['week', '7 天']],
  stats: [['today', '今日'], ['week', '7 天'], ['month', '30 天']],
  data: [['today', '今日'], ['week', '7 天'], ['month', '30 天']],
  settings: [['session', '本次'], ['today', '今日'], ['week', '7 天']]
};

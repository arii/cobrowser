// Types for the shared playback planner. The implementation stays plain JS so
// the unpacked extension loads it without a build step; Node tests resolve
// these declarations for typechecking.
export declare const PLAYBACK_VERSION: 1;
export declare const PLAYBACK_EVENT_LIMIT: 2000;
export declare const DIRECT_SCROLL_DELTA_Y: 200;
export type PlaybackMode = 'direct' | 'filtered';
export type PlaybackEventKind = 'click' | 'change' | 'submit' | 'scroll' | 'page-visible' | 'pointer' | 'key';
export type PlaybackEventTag = 'INPUT' | 'SELECT' | 'TEXTAREA' | 'BUTTON' | 'A' | 'FORM' | 'PAGE' | 'OTHER';
export type PlaybackKey = 'Tab' | 'Enter' | 'Escape' | 'Backspace' | 'Delete' | 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight';
export interface PlaybackEventInput {
  id: string;
  at: string;
  origin: string;
  kind: PlaybackEventKind;
  tag: PlaybackEventTag;
  x?: number;
  y?: number;
  key?: PlaybackKey;
  [key: string]: unknown;
}
export type PlaybackStep =
  | { eventId: string; at: string; origin: string; kind: 'click'; tag: PlaybackEventTag; x: number; y: number }
  | { eventId: string; at: string; origin: string; kind: 'move'; tag: PlaybackEventTag; x: number; y: number }
  | { eventId: string; at: string; origin: string; kind: 'scroll'; tag: PlaybackEventTag; deltaY: number; assumed: true }
  | { eventId: string; at: string; origin: string; kind: 'key'; tag: PlaybackEventTag; key: PlaybackKey }
  | { eventId: string; at: string; origin: string; kind: 'submit'; tag: PlaybackEventTag }
  | { eventId: string; at: string; origin: string; kind: 'input'; tag: PlaybackEventTag };
export interface PlaybackSkipped {
  eventId: string;
  at: string;
  origin: string;
  kind: PlaybackEventKind;
  reason: 'filtered-noise' | 'non-actionable' | 'missing-coordinates' | 'other-origin';
}
export interface PlaybackPlan {
  version: 1;
  mode: PlaybackMode;
  totalEvents: number;
  steps: PlaybackStep[];
  skipped: PlaybackSkipped[];
  origins: string[];
  warnings: string[];
}
export declare function planPlayback(events: PlaybackEventInput[], options?: { mode?: PlaybackMode; origin?: string }): PlaybackPlan;

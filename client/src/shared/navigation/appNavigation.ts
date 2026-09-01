import type { SectionId } from '../types/navigation';

export interface AppNavigationRequest {
  section: SectionId;
  settingsTab?: string;
}

const EVENT_NAME = 'yibiao:navigate-app-section';
const DECISION_EVENT_NAME = 'yibiao:show-remote-knowledge-decision';
let pendingNavigation: AppNavigationRequest | null = null;

export function navigateToAppSection(section: SectionId, options: Omit<AppNavigationRequest, 'section'> = {}) {
  pendingNavigation = { section, ...options };
  window.dispatchEvent(new CustomEvent<AppNavigationRequest>(EVENT_NAME, { detail: pendingNavigation }));
}

export function consumePendingAppNavigation(section?: SectionId) {
  if (!pendingNavigation || (section && pendingNavigation.section !== section)) return null;
  const request = pendingNavigation;
  pendingNavigation = null;
  return request;
}

export function onAppNavigation(callback: (request: AppNavigationRequest) => void) {
  const listener = (event: Event) => callback((event as CustomEvent<AppNavigationRequest>).detail);
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}

export function showRemoteKnowledgeDecision() {
  window.dispatchEvent(new Event(DECISION_EVENT_NAME));
}

export function onRemoteKnowledgeDecision(callback: () => void) {
  window.addEventListener(DECISION_EVENT_NAME, callback);
  return () => window.removeEventListener(DECISION_EVENT_NAME, callback);
}

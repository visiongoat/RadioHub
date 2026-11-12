import React from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import HomeStationGuide from '../src/components/HomeStationGuide';
import { HOME_STATION_GUIDE, FRENCH_HOME_STATION_GUIDE } from '@workspace/seo-shared/home-station-guide';
import { getStationEditorial } from '@workspace/seo-shared/station-editorial';
import { renderHomeStationGuideBody } from '../../api-server/src/seo/home-station-guide-body';

vi.mock('@/hooks/useSeoRouting', () => ({
  useSeoRouting: () => ({ currentLanguage: window.location.pathname.split('/')[1] }),
}));
afterEach(cleanup);

it('links the English home to the actual German editorial pilot in both HTML and React', () => {
  window.history.replaceState({}, '', '/en');
  const view = render(<HomeStationGuide />);
  const link = screen.getByRole('link', { name: HOME_STATION_GUIDE.label });
  expect(link).toHaveAttribute('href', '/de/sender/orf-hitradio-o3');
  expect(link).toHaveAttribute('hreflang', 'de');
  expect(link).not.toHaveAttribute('rel', expect.stringContaining('nofollow'));
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(HOME_STATION_GUIDE.heading);
  expect(view.container.querySelector('section')).toHaveAttribute('lang', 'en');
  const server = document.createElement('div');
  server.innerHTML = renderHomeStationGuideBody('en');
  const content = (root: Element) => [...root.querySelectorAll('h2, p, a')].map(node => node.textContent);
  expect(content(server)).toEqual(content(view.container));
  expect(server.querySelector('a')?.getAttribute('href')).toBe(link.getAttribute('href'));
  expect(server.querySelector('section')).toHaveAttribute('lang', 'en');
  expect(getStationEditorial({ _id: '68a8c483bd66579311ab2ffa', slug: 'orf-hitradio-o3' }, 'de')).not.toBeNull();
});

it('links the French home directly to the French editorial pilot in both initial HTML and React', () => {
  window.history.replaceState({}, '', '/fr');
  const view = render(<HomeStationGuide />);
  const link = screen.getByRole('link', { name: FRENCH_HOME_STATION_GUIDE.label });
  expect(link).toHaveAttribute('href', '/fr/station/radio-couleur-chartreuse');
  expect(link).toHaveAttribute('hreflang', 'fr');
  expect(link).not.toHaveAttribute('rel', expect.stringContaining('nofollow'));
  expect(view.container.querySelector('section')).toHaveAttribute('lang', 'fr');
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(FRENCH_HOME_STATION_GUIDE.heading);
  expect(view.container).not.toHaveTextContent('Ö3');
  const server = document.createElement('div');
  server.innerHTML = renderHomeStationGuideBody('fr');
  const content = (root: Element) => [...root.querySelectorAll('h2, p, a')].map(node => node.textContent);
  expect(content(server)).toEqual(content(view.container));
  expect(server.querySelector('section')).toHaveAttribute('lang', 'fr');
  expect(server.querySelector('a')).toHaveAttribute('href', FRENCH_HOME_STATION_GUIDE.href);
  expect(server.querySelector('a')).toHaveAttribute('hreflang', 'fr');
  expect(server.querySelector('a')?.rel).not.toContain('nofollow');
  expect(getStationEditorial({ _id: '68a8c48abd66579311ab4280', slug: 'radio-couleur-chartreuse' },
    'fr', FRENCH_HOME_STATION_GUIDE.href)?.kind).toBe('reviewed');
});

it.each(['de', 'tr', 'es', 'pt', 'it', 'ru', 'ar', 'zh', 'ja', 'ko', 'hi', 'he', 'nl', 'sv', 'invalid'])(
  'keeps the existing %s homepage unchanged', language => {
    window.history.replaceState({}, '', `/${language}`);
    const view = render(<HomeStationGuide />);
    expect(view.container).toBeEmptyDOMElement();
    expect(renderHomeStationGuideBody(language)).toBe('');
  },
);

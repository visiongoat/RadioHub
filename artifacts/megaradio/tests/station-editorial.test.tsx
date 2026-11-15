import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it } from 'vitest';
import { getStationEditorial } from '@workspace/seo-shared/station-editorial';
import { ACTIVE_SITEMAP_LANGUAGES } from '@workspace/seo-shared/seo-config';
import { renderStationEditorialHtml } from '@workspace/seo-shared/station-editorial-html';
import { StationEditorial } from '../src/components/stations/station-editorial';

const station = { _id: '68a8c483bd66579311ab2ffa', slug: 'orf-hitradio-o3' };
const pilot = getStationEditorial(station, 'de');
if (pilot?.kind !== 'pilot') throw new Error('Expected the original Ö3 pilot');
const content = pilot;
afterEach(cleanup);

it('only enables the explicitly selected German Ö3 record', () => {
  expect(content).not.toBeNull();
  for (const language of ACTIVE_SITEMAP_LANGUAGES.filter(language => language !== 'de')) {
    expect(getStationEditorial(station, language)).toBeNull();
    expect(renderStationEditorialHtml(station, language)).toBe('');
  }
  for (const record of [undefined, null, {}, { slug: station.slug }, { ...station, _id: 'fm4' }, { ...station, slug: 'fm4-orf' }]) {
    expect(getStationEditorial(record, 'de')).toBeNull();
  }
});

it('retains the pilot on the verified merge survivor without leaking to aliases or other locales', () => {
  const survivor = { ...station, _id: '68a8c483bd66579311ab2ffe' };
  for (const record of [station, survivor]) {
    expect(getStationEditorial(record, 'de')).toBe(content);
    expect(getStationEditorial(record, 'de', '/de/sender/orf-hitradio-o3')).toBe(content);
    for (const pathname of ['/de/sender/orf-hitradio-o3-hq', '/en/station/orf-hitradio-o3', '/de/stations/' + record._id]) {
      expect(getStationEditorial(record, 'de', pathname)).toBeNull();
    }
    expect(getStationEditorial({ ...record, stationPageMode: 'information' }, 'de')).toBeNull();
    expect(getStationEditorial({ ...record, slug: 'orf-hitradio-o3-hq' }, 'de')).toBeNull();
    for (const language of ACTIVE_SITEMAP_LANGUAGES.filter(language => language !== 'de')) {
      expect(getStationEditorial(record, language)).toBeNull();
    }
  }
  expect(renderStationEditorialHtml(survivor, 'de')).toBe(renderStationEditorialHtml(station, 'de'));
});

it('renders the complete editorial and real source links without starting a player', () => {
  const { container } = render(<StationEditorial content={content} />);
  for (const paragraph of content.paragraphs) expect(screen.getByText(paragraph)).toBeInTheDocument();
  expect(container.querySelector('audio,video,iframe')).toBeNull();
  expect(container.querySelector('.line-clamp-3')).toBeNull();
  expect(screen.getByRole('link', { name: 'Ö3-Website' })).toHaveAttribute('href', 'https://oe3.orf.at/');
  for (const link of container.querySelectorAll('a')) {
    if (link.getAttribute('href')?.startsWith('/')) {
      expect(['/de/genres/pop', '/de/regionen/europe/austria']).toContain(link.getAttribute('href'));
      expect(link).not.toHaveAttribute('target');
      continue;
    }
    expect(new URL(link.href).protocol).toBe('https:');
    expect(['oe3.orf.at', 'sound.orf.at', 'der.orf.at', 'science.orf.at', 'data.rtr.at']).toContain(new URL(link.href).hostname);
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  }
  expect(container.querySelectorAll('h1')).toHaveLength(0);
  expect(container.querySelectorAll('details')).toHaveLength(3);
  expect(container.querySelectorAll('time')).toHaveLength(3);
});

it('adds sourced history and studio facts with crawlable local category links', () => {
  render(<StationEditorial content={content} />);
  const section = screen.getByRole('region', { name: content.historyHeading });
  expect(section).toHaveTextContent('1. Oktober 1967');
  expect(section).toHaveTextContent('November 2022');
  expect(section).toHaveTextContent('deutschsprachige');
  for (const item of content.relatedLinks) expect(screen.getByRole('link', { name: item.label })).toHaveAttribute('href', item.href);
  expect(section).not.toHaveTextContent('Nachrichten, Wetter und Verkehr');
});

it('adds an Austrian-music section instead of repeating the upper station overview', () => {
  render(<StationEditorial content={content} />);
  const section = screen.getByRole('region', { name: 'Österreichische Musik bei Ö3' });
  expect(section).toHaveTextContent('Studio-Sessions');
  expect(section).toHaveTextContent('Donauinselfest');
  expect(section.querySelectorAll('p')).toHaveLength(1);
  expect(section).not.toHaveTextContent(/österreichweite Popradio|1980er|1990er|2000er|Nachrichten|Wetter|Verkehr/);
  expect(screen.queryByRole('heading', { name: 'Über Hitradio Ö3' })).not.toBeInTheDocument();
});

it('distinguishes live listening, replay and podcasts without invented first-hand claims', () => {
  expect(content.summary).toContain('Livestream');
  expect(content.podcasts[0].text).toContain('das gesamte Gespräch');
  expect(content.podcasts[0].text).not.toContain('ausgewählte Teile');
  expect(content.questions[0].answer).toContain('MegaRadio führt kein eigenes Ö3-Sendungsarchiv');
  expect(content.questions[0].answer).toContain('Nachhörrechte');
  expect(content.questions[1].answer).toContain('ungefähre Uhrzeit');
  expect(content.questions[1].answer).toContain('unvollständig');
  const prose = [content.summary, ...content.paragraphs, content.programmeText,
    ...content.podcasts.map(item => item.text), content.listeningText,
    ...content.questions.map(item => item.answer)].join(' ');
  expect(prose).not.toMatch(/wir haben (gehört|getestet)|unser Hörtest|Nummer eins|beste Sender|garantiert indexiert/i);
});

it('links every described podcast to its verified official listening page', () => {
  render(<StationEditorial content={content} />);
  const paths = ['fruehstueck-bei-mir', 'oe3-pop-podcast', 'off-records---der-oe3-wecker-podcast'];
  for (const [index, podcast] of content.podcasts.entries()) {
    const link = screen.getByRole('link', { name: podcast.link.label });
    expect(link).toHaveAttribute('href', `https://sound.orf.at/podcast/oe3/${paths[index]}`);
    expect(link.closest('li')).toContainElement(screen.getByRole('heading', { name: podcast.name, exact: true }));
  }
});

it('links to the current official schedule without publishing a fixed timetable or presenter list', () => {
  render(<StationEditorial content={content} />);
  const programme = screen.getByRole('region', { name: 'Aktuelles Ö3-Programm' });
  expect(programme).toHaveTextContent(content.programmeText);
  expect(programme.querySelector('ul,table,h3,time')).toBeNull();
  expect(screen.getByRole('link', { name: content.programmeLink.label })).toHaveAttribute('href', 'https://oe3.orf.at/sendungen/');
  expect(screen.getByTestId('station-editorial-intro')).not.toHaveTextContent(/Gabi Hiller|Philipp Hansa|Ö3 Heimatsound|Ö3 Pop-Magazin/);
});

it('shows nine sourced frequency allocations with units, accessible headers and honest dates', () => {
  render(<StationEditorial content={content} />);
  expect(screen.getByTestId('station-frequencies')).toHaveClass('w-full', 'max-w-4xl', 'lg:mx-auto');
  expect(screen.getByRole('heading', { name: content.listeningHeading })).toHaveClass('max-w-4xl', 'lg:mx-auto', 'lg:text-center');
  expect(screen.getByText(content.listeningText)).toHaveClass('max-w-4xl', 'lg:mx-auto', 'lg:text-center');
  const table = screen.getByRole('table', { name: 'Ausgewählte UKW-Frequenzen für Hitradio Ö3' });
  expect(table.querySelectorAll('thead th[scope="col"]')).toHaveLength(3);
  expect(table.querySelectorAll('tbody th[scope="row"]')).toHaveLength(9);
  expect(Array.from(table.querySelectorAll('tbody tr'), row => Array.from(row.querySelectorAll('th,td'), cell => cell.textContent))).toEqual([
    ['Wien', 'Kahlenberg', '99,9'], ['St. Pölten', 'Jauerling', '89,4'],
    ['Linz', 'Lichtenberg', '88,8'], ['Salzburg', 'Gaisberg', '99,0'],
    ['Graz', 'Schöckl', '89,2'], ['Klagenfurt', 'Dobratsch', '90,4'],
    ['Innsbruck', 'Patscherkofel', '88,5'], ['Bregenz', 'Pfänder', '89,6'],
    ['Rechnitz', 'Hirschenstein', '87,9'],
  ]);
  expect(screen.getByRole('columnheader', { name: 'MHz' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: content.frequencies!.source.label })).toHaveAttribute('href', 'https://data.rtr.at/pages/open-data/m-freqbuch');
  expect(screen.getByText(content.frequencies!.note)).toHaveTextContent('keine vollständige Frequenzliste');
  expect(screen.getByText(content.frequencies!.sourceDateLabel)).toHaveAttribute('datetime', '2026-11-08');
  expect(screen.getByText(content.frequencies!.checkedLabel)).toHaveAttribute('datetime', '2026-11-08');
});

it('does not fabricate a frequency table when verified rows are absent', () => {
  render(<StationEditorial content={{ ...content, frequencies: undefined }} />);
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});

it('keeps FAQ answers in HTML before interaction, with native keyboard-accessible disclosures', () => {
  const { container } = render(<StationEditorial content={content} />);
  const disclosures = Array.from(container.querySelectorAll('details'));
  content.questions.forEach((item, index) => {
    expect(disclosures[index].querySelector('summary')).toHaveTextContent(item.question);
    expect(disclosures[index]).toHaveTextContent(item.answer);
    expect(disclosures[index].open).toBe(false);
  });
});

it('serves the same editorial text, sources and FAQ in initial HTML and React', () => {
  const server = document.createElement('div');
  server.innerHTML = renderStationEditorialHtml(station, 'de');
  const client = document.createElement('div');
  client.innerHTML = renderToStaticMarkup(<StationEditorial content={content} />);
  const normalize = (element: Element) => element.textContent?.replace(/\s+/g, ' ').trim();
  for (const selector of ['h2', 'h3', 'p', 'summary', 'time', 'caption', 'th', 'td']) {
    expect(Array.from(server.querySelectorAll(selector), normalize)).toEqual(Array.from(client.querySelectorAll(selector), normalize));
  }
  expect(Array.from(server.querySelectorAll('a'), a => a.href)).toEqual(Array.from(client.querySelectorAll('a'), a => a.href));
});

it('escapes editorial text in the server renderer', () => {
  const original = content.questions;
  try {
    content.questions = [{ question: '<script>alert(1)</script>', answer: 'A & B < C' }];
    const html = renderStationEditorialHtml(station, 'de');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A &amp; B &lt; C');
  } finally { content.questions = original; }
});

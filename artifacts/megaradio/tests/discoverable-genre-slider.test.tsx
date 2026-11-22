import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

vi.mock('swiper/react', () => ({
  Swiper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SwiperSlide: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('swiper/modules', () => ({ Pagination: {}, Mousewheel: {} }));
vi.mock('wouter', () => ({
  Link: ({ to, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) => <a href={to} {...props}>{children}</a>,
}));
vi.mock('@/hooks/useSeoRouting', () => ({ useSeoRouting: () => ({ getLocalizedUrl: (path: string) => `/de${path}` }) }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ language: 'en', t: (_key: string, fallback: string) => fallback }) }));

import DiscoverableGenreSlider from '../src/components/DiscoverableGenreSlider';
import { getGenreImageSources } from '../src/components/DiscoverableGenreImage';
import jazzDiscoverableImage from '../src/assets/jazz-discoverable.png';

const rock = { _id: 'rock', name: 'Rock', slug: 'rock', discoverableImage: '/uploads/genres/discoverable/rock.png' };
const jazz = {
  _id: 'genre-jazz',
  name: 'Jazz Music',
  slug: 'jazz',
  discoverableImage: '/uploads/genres/discoverable/genre-dfd155a5-8ea0-47f6-8c09-d3ba856c4853.png',
};
const gradient = (card: Element) => card.querySelector<HTMLElement>('[style]')!;

it('layers a decorative uploaded image above a gradient without changing the genre destination', () => {
  render(<DiscoverableGenreSlider genres={[rock]} />);
  const card = screen.getByRole('link', { name: 'Rock Discover all the stations' });
  expect(card).toHaveAttribute('href', '/de/genres/rock');
  expect(gradient(card).style.backgroundImage).toContain('linear-gradient');
  const image = card.querySelector('img')!;
  expect(image).toHaveAttribute('src', rock.discoverableImage);
  expect(image).toHaveAttribute('alt', '');
  expect(image).toHaveAttribute('aria-hidden', 'true');
  expect(image).toHaveAttribute('loading', 'lazy');
  expect(image).toHaveAttribute('decoding', 'async');
  expect(image).toHaveAttribute('draggable', 'false');
  expect(image).toBeVisible();
});

it('keeps a gradient and readable link when no discoverable image was configured', () => {
  render(<DiscoverableGenreSlider genres={[{ ...rock, discoverableImage: undefined }]} />);
  const card = screen.getByRole('link', { name: /Rock/ });
  expect(card.querySelector('img')).toBeNull();
  expect(gradient(card).style.backgroundImage).toContain('linear-gradient');
  expect(screen.getByText('Rock')).toBeVisible();
});

it('reveals the gradient after a missing image fails and keeps the genre usable', () => {
  render(<DiscoverableGenreSlider genres={[rock]} />);
  const card = screen.getByRole('link', { name: /Rock/ });
  const background = gradient(card);
  fireEvent.error(card.querySelector('img')!);
  expect(card.querySelector('img')).toBeNull();
  expect(background).toBeVisible();
  expect(background.style.backgroundImage).toContain('linear-gradient');
  expect(screen.getByText('Rock')).toBeVisible();
  expect(card).toHaveAttribute('href', '/de/genres/rock');
});

it('tries a replacement image instead of retaining the failed image state', () => {
  const view = render(<DiscoverableGenreSlider genres={[rock]} />);
  const card = screen.getByRole('link', { name: /Rock/ });
  const failedImage = card.querySelector('img')!;
  fireEvent.error(failedImage);
  view.rerender(<DiscoverableGenreSlider genres={[{ ...rock, discoverableImage: '/uploads/genres/discoverable/restored-rock.png' }]} />);
  const replacement = card.querySelector('img')!;
  expect(replacement).not.toBe(failedImage);
  expect(replacement).toHaveAttribute('src', '/uploads/genres/discoverable/restored-rock.png');
  expect(replacement).toBeVisible();
  expect(gradient(card).style.backgroundImage).toContain('linear-gradient');
});

it('uses the bundled Jazz artwork for its original upload path', () => {
  render(<DiscoverableGenreSlider genres={[jazz]} />);
  const card = screen.getByRole('link', { name: 'Jazz Discover all the stations' });
  expect(card.querySelector('img')).toHaveAttribute('src', jazzDiscoverableImage);
  expect(card.querySelector('img')).toBeVisible();
  expect(card).toHaveAttribute('href', '/de/genres/jazz');
});

it.each([undefined, ''])('uses the bundled Jazz artwork when its configured image is %s', (discoverableImage) => {
  render(<DiscoverableGenreSlider genres={[{ ...jazz, discoverableImage }]} />);
  const card = screen.getByRole('link', { name: /Jazz/ });
  expect(card.querySelector('img')).toHaveAttribute('src', jazzDiscoverableImage);
  expect(card.querySelector('img')).toBeVisible();
});

it('tries a custom Jazz image first and falls back to the bundled artwork once', () => {
  const customJazz = { ...jazz, discoverableImage: '/uploads/genres/discoverable/custom-jazz.png' };
  const view = render(<DiscoverableGenreSlider genres={[customJazz]} />);
  const card = screen.getByRole('link', { name: /Jazz/ });
  expect(card.querySelector('img')).toHaveAttribute('src', customJazz.discoverableImage);

  fireEvent.error(card.querySelector('img')!);
  expect(card.querySelector('img')).toHaveAttribute('src', jazzDiscoverableImage);
  expect(card.querySelector('img')).toBeVisible();

  fireEvent.error(card.querySelector('img')!);
  expect(card.querySelector('img')).toBeNull();
  expect(gradient(card)).toBeVisible();
  expect(screen.getByText('Jazz')).toBeVisible();
  expect(card).toHaveAttribute('href', '/de/genres/jazz');

  view.rerender(<DiscoverableGenreSlider genres={[{ ...customJazz }]} />);
  expect(card.querySelector('img')).toBeNull();
});

it('tries the original Jazz upload once if the bundled image fails, then stops at the gradient', () => {
  const view = render(<DiscoverableGenreSlider genres={[jazz]} />);
  const card = screen.getByRole('link', { name: /Jazz/ });
  fireEvent.error(card.querySelector('img')!);
  expect(card.querySelector('img')).toHaveAttribute('src', jazz.discoverableImage);
  expect(card.querySelector('img')).toBeVisible();
  fireEvent.error(card.querySelector('img')!);
  expect(card.querySelector('img')).toBeNull();
  expect(gradient(card)).toBeVisible();

  view.rerender(<DiscoverableGenreSlider genres={[{ ...jazz }]} />);
  expect(card.querySelector('img')).toBeNull();
});

it.each(['themegaradio.com', 'www.themegaradio.com', 'api.themegaradio.com'])(
  'uses bundled Jazz artwork for the absolute original upload on %s',
  (hostname) => {
    expect(getGenreImageSources({ ...jazz, discoverableImage: `https://${hostname}${jazz.discoverableImage}` }))
      .toEqual([jazzDiscoverableImage, jazz.discoverableImage]);
  },
);

it('respects an external Jazz image even when its path matches the original upload', () => {
  const customUrl = `https://artwork.example.com${jazz.discoverableImage}`;
  expect(getGenreImageSources({ ...jazz, discoverableImage: customUrl }))
    .toEqual([customUrl, jazzDiscoverableImage]);
});

it('retries a changed custom Jazz source after both previous sources failed', () => {
  const customJazz = { ...jazz, discoverableImage: '/uploads/genres/discoverable/custom-jazz.png' };
  const view = render(<DiscoverableGenreSlider genres={[customJazz]} />);
  const card = screen.getByRole('link', { name: /Jazz/ });
  fireEvent.error(card.querySelector('img')!);
  fireEvent.error(card.querySelector('img')!);
  expect(card.querySelector('img')).toBeNull();

  const replacementUrl = '/uploads/genres/discoverable/replacement-jazz.png';
  view.rerender(<DiscoverableGenreSlider genres={[{ ...jazz, discoverableImage: replacementUrl }]} />);
  expect(card.querySelector('img')).toHaveAttribute('src', replacementUrl);
  expect(card.querySelector('img')).toBeVisible();

  fireEvent.error(card.querySelector('img')!);
  expect(card.querySelector('img')).toHaveAttribute('src', jazzDiscoverableImage);
  fireEvent.error(card.querySelector('img')!);
  expect(card.querySelector('img')).toBeNull();
});

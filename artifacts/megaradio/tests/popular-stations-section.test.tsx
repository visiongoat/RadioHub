import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
const state = vi.hoisted(() => ({ inView: true, language: 'en', translations: {} as Record<string, string> }));
vi.mock('@/components/ui/in-view', () => ({ InView: ({ children, className }: { children: (visible: boolean) => React.ReactNode; className?: string }) =>
  <div data-testid="in-view" className={className}>{children(state.inView)}</div> }));
vi.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ language: state.language,
  t: (key: string, fallback: string) => state.translations[key] ?? fallback }) }));
vi.mock('@/components/ui/station-card', () => ({ default: ({ station, onPlay, showVotes }: any) =>
  <button onClick={() => onPlay(station, 'random')} data-votes={showVotes}>{station.name}</button> }));
import PopularStationsSection from '../src/components/PopularStationsSection';
const stations = [{ _id: 'one', name: 'Radio One' }, { _id: 'two', name: 'Radio Two' }];
beforeEach(() => { sessionStorage.clear(); state.inView = true; state.language = 'en'; state.translations = {}; });

describe('popular section bounded loading reservation', () => {
  it('releases its mobile height entirely when a pending query settles empty or fails', () => {
    const props = { stations: [], activeCountry: 'all', onPlay: vi.fn() };
    const { container, rerender } = render(<PopularStationsSection {...props} isPending />);
    expect(screen.getByTestId('in-view')).toHaveClass('min-h-[1400px]');
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(12);
    rerender(<PopularStationsSection {...props} isPending={false} />);
    expect(container).toBeEmptyDOMElement();
  });
  it('shows only actual rows without a persistent minimum height and preserves playback and votes', () => {
    const onPlay = vi.fn();
    render(<PopularStationsSection stations={stations} isPending={false} activeCountry="Austria" onPlay={onPlay} />);
    expect(screen.getByTestId('in-view')).not.toHaveAttribute('class');
    expect(screen.getAllByRole('button', {name:/^Radio /})).toHaveLength(2); expect(screen.getByText('from Austria')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Radio One' }));
    expect(onPlay).toHaveBeenCalledWith(stations[0], 'random');
    expect(screen.getByRole('button', { name: 'Radio One' })).toHaveAttribute('data-votes', 'true');
  });
  it('retains lazy content mounting with the real row count rather than twelve empty slots', () => {
    state.inView = false;
    const props = { stations, isPending: false, activeCountry: 'all', onPlay: vi.fn() };
    const { container, rerender } = render(<PopularStationsSection {...props} />);
    expect(screen.queryByRole('button', {name:/^Radio /})).toBeNull(); expect(container.querySelectorAll('.animate-pulse')).toHaveLength(2);
    state.inView = true; rerender(<PopularStationsSection {...props} />);
    expect(screen.getAllByRole('button', {name:/^Radio /})).toHaveLength(2); expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0);
  });
  it('preserves the twelve-card limit and existing responsive grid classes', () => {
    const { container } = render(<PopularStationsSection stations={Array.from({ length: 20 }, (_, i) => ({ _id: i, name: `Radio ${i}` }))}
      isPending={false} activeCountry="all" onPlay={vi.fn()} />);
    expect(screen.getAllByRole('button', {name:/^Radio /})).toHaveLength(12);
    expect(container.querySelector('.grid')).toHaveClass('grid-cols-1', 'lg:grid-cols-2', 'xl:grid-cols-3', 'gap-y-[20px]');
  });
  it('changes only on request and preserves the selected batch after returning Home', () => {
    const pool=Array.from({length:24},(_,i)=>({_id:String(i),name:`Radio ${i}`}));
    const props={stations:pool,isPending:false,activeCountry:'all',onPlay:vi.fn()};
    const {rerender,unmount}=render(<PopularStationsSection {...props}/>);
    expect(screen.getByRole('button',{name:'Radio 0'})).toBeInTheDocument();
    rerender(<PopularStationsSection {...props} stations={[...pool]}/>);
    expect(screen.getByRole('button',{name:'Radio 0'})).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button',{name:'Change stations'}));
    expect(screen.queryByRole('button',{name:'Radio 0'})).toBeNull();
    expect(screen.getByRole('button',{name:'Radio 12'})).toBeInTheDocument();
    unmount();render(<PopularStationsSection {...props}/>);
    expect(screen.getByRole('button',{name:'Radio 12'})).toBeInTheDocument();
  });
  it('uses the existing translated qualifier and localized country without changing API country values', () => {
    state.language = 'de'; state.translations = { from: 'aus', homepage_popular_stations: 'Beliebte Sender' };
    render(<PopularStationsSection stations={stations} isPending={false} activeCountry="Austria" onPlay={vi.fn()} />);
    expect(screen.getByText('aus Österreich')).toBeInTheDocument();
    expect(screen.getByRole('heading')).toHaveTextContent('Beliebte Sender');
  });
});

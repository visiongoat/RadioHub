import React from 'react';
import {cleanup,render,screen} from '@testing-library/react';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {genreDisplayName,genreDisplayLanguage,genreSearchQuery} from '@workspace/seo-shared/genre-localization';
const state=vi.hoisted(()=>({language:'tr'}));
vi.mock('swiper/react',()=>({Swiper:({children}:any)=><div>{children}</div>,SwiperSlide:({children}:any)=><div>{children}</div>}));
vi.mock('swiper/modules',()=>({Pagination:{},Mousewheel:{}}));
vi.mock('wouter',()=>({Link:({to,children,...props}:any)=><a href={to} {...props}>{children}</a>}));
vi.mock('@/hooks/useTranslation',()=>({useTranslation:()=>({language:state.language,t:()=>state.language==='tr'?'Tüm istasyonları keşfet':'Alle Sender entdecken'})}));
vi.mock('@/hooks/useSeoRouting',()=>({useSeoRouting:()=>({getLocalizedUrl:(path:string)=>'/'+state.language+path})}));
import DiscoverableGenreSlider from '@/components/DiscoverableGenreSlider';
afterEach(cleanup);
describe('shared genre display contract',()=>{
 it('uses the mobile14-language catalogue, including regional locales and aliases',()=>{
  const news={en:'News',tr:'Haberler',de:'Nachrichten',fr:'Actualités',es:'Noticias',it:'Notizie',pt:'Notícias',hi:'समाचार',he:'חדשות',ru:'Новости',ja:'ニュース',ko:'뉴스',zh:'新闻',ar:'أخبار'};
  for(const [locale,label] of Object.entries(news))expect(genreDisplayName({slug:'news',name:'News'},locale)).toBe(label);
  expect(genreDisplayLanguage('TR_tr')).toBe('tr');
  expect(genreDisplayName({slug:'jazz',name:'Jazz'},'tr-TR')).toBe('Caz');
  expect(genreDisplayName({slug:'talk-radio'},'tr')).toBe('Sohbet');
  expect(genreDisplayName({slug:'classic-hits'},'tr')).toBe('Klasik hitler');
  expect(genreDisplayName({slug:'90s'},'tr')).toBe("90'lar");
  expect(genreDisplayName({slug:'rare-style',name:'Rare Style'},'tr')).toBe('Rare Style');
  expect(genreDisplayName({slug:'news'})).toBe('News');
 });
 it('maps complete localized search names to canonical filters while retaining raw names and prefixes',()=>{
  expect(genreSearchQuery('Caz','tr')).toBe('jazz');
  expect(genreSearchQuery(' KLASİK ','tr-TR')).toBe('classical');
  expect(genreSearchQuery('Klassik','de')).toBe('classical');
  expect(genreSearchQuery('Nachrichten','de')).toBe('news');
  for(const query of ['Jazz','jazz','classical','Classical','Rare Style','Ca','Klas']){
   expect(genreSearchQuery(query,'tr')).toBe(query);
  }
  expect(genreSearchQuery('Caz','en')).toBe('Caz');
 });
 it('changes cached Home banners immediately with language, retaining raw values and canonical destinations',()=>{
  const genres=[{_id:'news',slug:'news',name:'News',discoverable_label:'English-only description'},{_id:'jazz',slug:'jazz',name:'Jazz'}];
  const before=JSON.stringify(genres);state.language='tr';
  const view=render(<DiscoverableGenreSlider genres={genres}/>);
  expect(screen.getByRole('link',{name:'Haberler Tüm istasyonları keşfet'})).toHaveAttribute('href','/tr/genres/news');
  expect(screen.getByRole('link',{name:'Caz Tüm istasyonları keşfet'})).toHaveAttribute('href','/tr/genres/jazz');
  expect(screen.queryByText('English-only description')).not.toBeInTheDocument();
  state.language='de';view.rerender(<DiscoverableGenreSlider genres={genres}/>);
  expect(screen.getByRole('link',{name:'Nachrichten Alle Sender entdecken'})).toHaveAttribute('href','/de/genres/news');
  expect(screen.getByRole('link',{name:'Jazz Alle Sender entdecken'})).toHaveAttribute('href','/de/genres/jazz');
  expect(JSON.stringify(genres)).toBe(before);
 });
});

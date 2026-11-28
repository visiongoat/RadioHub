import { ChevronRight } from 'lucide-react';
import { Link } from 'wouter';

interface GenrePageTitleProps {
  title: string;
  parent?: { label: string; href: string };
  currentHref?: string;
}

export function GenrePageTitle({ title, parent, currentHref }: GenrePageTitleProps) {
  return (
    <div className="md:bg-[#151515]">
      <div className="container flex min-h-[56px] items-center py-4 max-sm:!px-5 text-sm font-bold text-white md:min-h-[100px] md:text-[36px] md:leading-[41px]">
        {parent && currentHref ? (
          <nav className="breadcrumb min-w-0" aria-label="breadcrumb">
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 md:gap-x-3">
              <li><Link href={parent.href} className="hover:text-[#ff4199]">{parent.label}</Link></li>
              <li className="flex min-w-0 items-center gap-2 md:gap-3">
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 rtl:rotate-180 md:size-6" />
                <h1 className="min-w-0 break-words">
                  <Link href={currentHref} aria-current="page">{title}</Link>
                </h1>
              </li>
            </ol>
          </nav>
        ) : <h1 className="min-w-0 break-words">{title}</h1>}
      </div>
    </div>
  );
}

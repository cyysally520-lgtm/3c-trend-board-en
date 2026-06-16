import React from 'react';
import { Clock, Cpu, TrendingUp, Users, Banknote, Star } from 'lucide-react';
import { InvestItem } from '../types';

interface Props {
  item: InvestItem;
  isFavorite?: boolean;
  onToggleFavorite?: (id: string) => void;
  variant?: 'default' | 'featured';
  key?: React.Key;
}

// 工具：取英文字段，回退到原字段（保留外语原文）
const en = (a?: string, b?: string) => (a && a.trim() ? a : (b ?? ''));

function relativeTime(daysAgo: number): string {
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return '1d ago';
  return `${daysAgo}d ago`;
}

export function InvestCard({ item, isFavorite, onToggleFavorite, variant = 'default' }: Props) {
  const taglineChips = item.tagline ? [item.tagline.trim()] : [];
  const name = en(item.name_en, item.name);
  const category = en(item.category_en, item.category);
  const tech = en(item.tech_en, item.tech);
  const business = en(item.business_en, item.business);
  const team = en(item.team_en, item.team);
  const operations = en(item.operations_en, item.operations);
  const funding = en(item.funding_en, item.funding);

  if (variant === 'featured') {
    return (
      <div
        data-invest-id={item.id}
        className="group relative bg-gradient-to-br from-slate-900 to-slate-950 rounded-xl border border-slate-700 ring-1 ring-emerald-500/10 shadow-md hover:ring-emerald-400/40 hover:-translate-y-0.5 transition-all duration-200 p-4 flex flex-col gap-2 text-white min-h-[180px]"
      >
        <div className="flex items-center flex-wrap gap-1.5">
          <span className="text-[11px] font-mono font-bold text-slate-500">#{item.rank}</span>
          <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
            {category}
          </span>
          {taglineChips.slice(0, 1).map((chip, i) => (
            <span
              key={i}
              className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-700/60 text-slate-300 border border-slate-600"
            >
              {chip}
            </span>
          ))}
        </div>
        <h3 className="font-bold text-white text-base leading-snug">{name}</h3>
        {(tech || business || item.tagline) && (
          <p className="text-[12px] text-slate-300 leading-relaxed line-clamp-3">
            {tech || business || item.tagline}
          </p>
        )}
      </div>
    );
  }

  return (
    <div
      data-invest-id={item.id}
      className="group relative bg-gradient-to-br from-white to-slate-50 rounded-xl border border-slate-300 ring-1 ring-slate-200 shadow-sm hover:shadow-lg hover:ring-emerald-300/40 hover:-translate-y-0.5 transition-all duration-200 flex flex-col overflow-hidden"
    >
      <div className="px-4 pt-4 pb-3 flex flex-col gap-3 flex-grow">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center flex-wrap gap-1.5 mb-1.5">
              <span className="text-[11px] font-mono font-bold text-slate-400">#{item.rank}</span>
              <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                {category}
              </span>
              {taglineChips.map((chip, i) => (
                <span
                  key={i}
                  className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-50 text-slate-600 border border-slate-200"
                >
                  {chip}
                </span>
              ))}
            </div>
            <h3 className="font-bold text-slate-900 text-[14px] leading-snug group-hover:text-emerald-700 transition-colors">
              {name}
            </h3>
          </div>

          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onToggleFavorite?.(item.id)}
              className={`p-1 rounded-full transition cursor-pointer ${
                isFavorite ? 'text-emerald-500' : 'text-slate-300 hover:text-emerald-500'
              }`}
              title={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
              aria-label="favorite"
            >
              <Star className={`w-4 h-4 ${isFavorite ? 'fill-emerald-500' : ''}`} />
            </button>
            <div className="flex items-center gap-1 text-[11px] text-slate-400">
              <Clock className="w-3 h-3" />
              <span>{relativeTime(item.daysAgo)}</span>
            </div>
          </div>
        </div>

        {tech && (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <Cpu className="w-3 h-3 text-violet-500" />
              <span className="text-[10px] font-bold text-violet-600">Tech</span>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed pl-4">{tech}</p>
          </div>
        )}

        {(business || operations) && (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-3 h-3 text-emerald-500" />
              <span className="text-[10px] font-bold text-emerald-600">Business / Ops</span>
            </div>
            <div className="pl-4 space-y-0.5">
              {business && (
                <p className="text-xs text-slate-700 leading-relaxed">{business}</p>
              )}
              {operations && (
                <p className="text-xs text-slate-700 leading-relaxed">{operations}</p>
              )}
            </div>
          </div>
        )}

        {team && (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <Users className="w-3 h-3 text-amber-500" />
              <span className="text-[10px] font-bold text-amber-600">Team</span>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed pl-4">{team}</p>
          </div>
        )}

        {funding && (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <Banknote className="w-3 h-3 text-red-500" />
              <span className="text-[10px] font-bold text-red-600">Funding</span>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed pl-4">{funding}</p>
          </div>
        )}
      </div>
    </div>
  );
}

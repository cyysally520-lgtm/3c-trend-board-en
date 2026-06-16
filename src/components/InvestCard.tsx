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

export function InvestCard({ item, isFavorite, onToggleFavorite, variant = 'default' }: Props) {
  // tagline 整体当一个药丸显示（不再用分隔符拆，避免破坏 "GitHub 2,795★" 这种含逗号数字）
  const taglineChips = item.tagline ? [item.tagline.trim()] : [];

  // featured 变体：用于「今日精选」横排深色卡。仅显示头部 + 简短简介
  if (variant === 'featured') {
    return (
      <div
        data-invest-id={item.id}
        className="group relative bg-gradient-to-br from-slate-900 to-slate-950 rounded-xl border border-slate-700 ring-1 ring-emerald-500/10 shadow-md hover:ring-emerald-400/40 hover:-translate-y-0.5 transition-all duration-200 p-4 flex flex-col gap-2 text-white min-h-[180px]"
      >
        <div className="flex items-center flex-wrap gap-1.5">
          <span className="text-[11px] font-mono font-bold text-slate-500">#{item.rank}</span>
          <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
            {item.category}
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
        <h3 className="font-bold text-white text-base leading-snug">{item.name}</h3>
        {(item.tagline || item.tech) && (
          <p className="text-[12px] text-slate-300 leading-relaxed line-clamp-3">
            {item.tech || item.business || item.tagline}
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
        {/* 头部：标签 chips + ⭐ 收藏 + 时间 */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center flex-wrap gap-1.5 mb-1.5">
              <span className="text-[11px] font-mono font-bold text-slate-400">#{item.rank}</span>
              <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                {item.category}
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
            {/* 项目名称 */}
            <h3 className="font-bold text-slate-900 text-[14px] leading-snug group-hover:text-emerald-700 transition-colors">
              {item.name}
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
              <span>{item.daysAgo === 0 ? '今日更新' : `${item.daysAgo}天前`}</span>
            </div>
          </div>
        </div>

        {/* 1. 技术 */}
        {item.tech && (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <Cpu className="w-3 h-3 text-violet-500" />
              <span className="text-[10px] font-bold text-violet-600">技术</span>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed pl-4">{item.tech}</p>
          </div>
        )}

        {/* 2. 商业 / 运营 */}
        {(item.business || item.operations) && (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-3 h-3 text-emerald-500" />
              <span className="text-[10px] font-bold text-emerald-600">商业 / 运营</span>
            </div>
            <div className="pl-4 space-y-0.5">
              {item.business && (
                <p className="text-xs text-slate-700 leading-relaxed">{item.business}</p>
              )}
              {item.operations && (
                <p className="text-xs text-slate-700 leading-relaxed">{item.operations}</p>
              )}
            </div>
          </div>
        )}

        {/* 3. 团队 */}
        {item.team && (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <Users className="w-3 h-3 text-amber-500" />
              <span className="text-[10px] font-bold text-amber-600">团队</span>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed pl-4">{item.team}</p>
          </div>
        )}

        {/* 4. 融资 */}
        {item.funding && (
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5">
              <Banknote className="w-3 h-3 text-red-500" />
              <span className="text-[10px] font-bold text-red-600">融资</span>
            </div>
            <p className="text-xs text-slate-700 leading-relaxed pl-4">{item.funding}</p>
          </div>
        )}
      </div>
    </div>
  );
}
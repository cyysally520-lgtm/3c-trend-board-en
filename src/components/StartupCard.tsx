import React, { useState } from 'react';
import { Trophy, MapPin, Users, ChevronDown, ChevronUp, ArrowUpRight } from 'lucide-react';
import { StartupItem } from '../types';
import { motion, AnimatePresence } from 'motion/react';

interface StartupCardProps {
  item: StartupItem;
}

export const StartupCard: React.FC<StartupCardProps> = ({ item }) => {
  const [showAiAnalysis, setShowAiAnalysis] = useState(true);

  // Logo 方块文字：名字开头 1-2 个字母
  const logoLetters = (item.name || '?').replace(/[^A-Za-z]/g, '').slice(0, 2) || '?';

  return (
    <div
      id={`startup-card-${item.id}`}
      className="group bg-white rounded-xl border border-slate-100 p-5 flex flex-col justify-between shadow-xs hover:shadow-md hover:border-slate-200 transition-all duration-300"
    >
      <div className="space-y-4">
        {/* Header: logo + name + batch + YC/a16z badge */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            {/* Logo 方块：有 URL 用图，没有就用首字母占位；图加载失败也回退字母 */}
            <div className="shrink-0 w-12 h-12 rounded-lg border border-slate-200 bg-white flex items-center justify-center overflow-hidden relative">
              {item.logo ? (
                <img
                  src={item.logo}
                  alt={item.name}
                  className="w-full h-full object-contain"
                  referrerPolicy="no-referrer"
                  onError={(e) => {
                    const img = e.currentTarget;
                    img.style.display = 'none';
                    const sibling = img.nextElementSibling as HTMLElement | null;
                    if (sibling) sibling.style.display = 'flex';
                  }}
                />
              ) : null}
              <span
                className="absolute inset-0 items-center justify-center font-mono font-black text-[13px] tracking-tight text-slate-700 select-none"
                style={{ display: item.logo ? 'none' : 'flex' }}
              >
                {logoLetters}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <h3 className="text-[15px] font-bold text-[#1e293b] group-hover:text-emerald-700 transition-colors">
                  {item.name}
                </h3>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold font-mono border ${
                  item.source === 'a16z'
                    ? 'bg-blue-50 text-blue-800 border-blue-200'
                    : 'bg-orange-100 text-orange-800 border-orange-200'
                }`}>
                  {item.source === 'a16z' ? `a16z ${item.batch}` : `YC ${item.batch}`}
                </span>
              </div>
              {/* Intro */}
              {item.intro && (
                <p className="text-[13px] text-slate-600 leading-relaxed mt-1.5 line-clamp-3">
                  {item.intro.trim()}
                </p>
              )}
            </div>
          </div>

          {/* YC / a16z 角标 */}
          <div className={`shrink-0 font-mono font-black text-[11px] select-none px-2 py-1 rounded shadow-3xs ${
            item.source === 'a16z' ? 'bg-sky-950 text-[#38bdf8]' : 'bg-[#ff6600] text-white'
          }`} title={item.source === 'a16z' ? 'Andreessen Horowitz Portfolio' : 'Y Combinator Incubation'}>
            {item.source === 'a16z' ? 'a16z' : 'YC'}
          </div>
        </div>

        {/* AI Insight deep analysis */}
        <div className="space-y-1.5 pt-2">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setShowAiAnalysis(!showAiAnalysis)}
              className="flex items-center gap-1.5 text-xs font-bold text-emerald-800 hover:text-emerald-700 bg-emerald-50/65 hover:bg-emerald-100/50 px-2.5 py-1.5 rounded-lg transition select-none cursor-pointer"
            >
              <Trophy className="w-3.5 h-3.5 text-[#10b981]" />
              AI Unicorn Analysis
            </button>
            <button
              onClick={() => setShowAiAnalysis(!showAiAnalysis)}
              className="text-slate-400 hover:text-slate-600 transition"
            >
              {showAiAnalysis ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>

          <AnimatePresence initial={false}>
            {showAiAnalysis && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="bg-gradient-to-br from-emerald-50/40 to-slate-50 border border-emerald-100/50 p-3.5 rounded-lg space-y-1.5 mt-1">
                  {(item.intro_en && item.intro_en.length > 0 ? item.intro_en : item.intro_zh).map((bullet, idx) => (
                    <div key={idx} className="text-xs text-slate-600 leading-normal flex items-start gap-1.5">
                      <span className="text-[#10b981] font-extrabold select-none mt-0.5 shrink-0">•</span>
                      <span>{bullet}</span>
                    </div>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Meta row: a16z 用 Posted/Feature；YC 用 Team size/Location */}
        <div className="pt-3 grid grid-cols-2 gap-4 text-[11px] border-t border-slate-100/85">
          {item.source === 'a16z' ? (
            <>
              <div className="space-y-0.5">
                <span className="text-slate-400 flex items-center gap-1">
                  <Users className="w-3 h-3 text-slate-400" />
                  Posted
                </span>
                <p className="font-semibold text-slate-700 truncate">
                  {item.team_size || '—'}
                </p>
              </div>
              <div className="space-y-0.5">
                <span className="text-slate-400 flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-slate-400" />
                  Feature
                </span>
                {item.location ? (
                  <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 truncate max-w-full" title={item.location}>
                    {item.location}
                  </span>
                ) : (
                  <p className="font-semibold text-slate-700 truncate">—</p>
                )}
              </div>
            </>
          ) : (
            <>
              <div className="space-y-0.5">
                <span className="text-slate-400 flex items-center gap-1">
                  <Users className="w-3 h-3 text-slate-400" />
                  Team size
                </span>
                <p className="font-semibold text-slate-700 truncate" title={item.team_size || item.founders}>
                  {item.team_size || item.founders || '—'}
                </p>
              </div>
              <div className="space-y-0.5">
                <span className="text-slate-400 flex items-center gap-1">
                  <MapPin className="w-3 h-3 text-slate-400" />
                  Location
                </span>
                <p className="font-semibold text-slate-700 truncate" title={item.location}>
                  {item.location}
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Footer：左 source 链接 + 右 公司官网 */}
      <div className="mt-4 pt-3 border-t border-slate-50 flex items-center justify-between">
        {item.source === 'a16z' ? (
          <a
            href={item.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-bold hover:underline inline-flex items-center gap-0.5 cursor-pointer text-sky-600 hover:text-sky-700"
          >
            View on a16z
            <ArrowUpRight className="w-3.5 h-3.5" />
          </a>
        ) : (
          <a
            href={`https://www.ycombinator.com/companies/${item.id.replace('yc-', '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-bold hover:underline inline-flex items-center gap-0.5 cursor-pointer text-orange-600 hover:text-orange-700"
          >
            YC profile
            <ArrowUpRight className="w-3.5 h-3.5" />
          </a>
        )}
        {(item.source === 'a16z' ? item.company_url : item.url) && (
          <a
            href={item.source === 'a16z' ? item.company_url : item.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`text-xs font-bold hover:underline inline-flex items-center gap-0.5 cursor-pointer ${
              item.source === 'a16z' ? 'text-sky-600 hover:text-sky-700' : 'text-orange-600 hover:text-orange-700'
            }`}
          >
            Company website
            <ArrowUpRight className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
    </div>
  );
};
